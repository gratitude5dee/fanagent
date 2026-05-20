// Shared single-HTMLAudioElement engine for the lyric template wizard.
// Times are clip-relative seconds; loop window clamps playback.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export interface AudioEngine {
  isReady: boolean;
  isPlaying: boolean;
  currentTime: number; // clip-relative seconds
  duration: number;
  load: (url: string | null) => void;
  play: () => Promise<void>;
  pause: () => void;
  toggle: () => Promise<void>;
  seek: (clipRelativeSec: number) => void;
  setLoop: (startSec: number, endSec: number, opts?: { loop?: boolean }) => void;
}

export function useAudioEngine(): AudioEngine {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const loopRef = useRef({ start: 0, end: 0, loop: true });
  const rafRef = useRef<number | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  if (!audioRef.current && typeof Audio !== "undefined") {
    audioRef.current = new Audio();
    audioRef.current.preload = "auto";
  }

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const tick = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    const { start, end, loop } = loopRef.current;
    const t = a.currentTime;
    if (end > start && t >= end) {
      if (loop) {
        a.currentTime = start;
        setCurrentTime(0);
      } else {
        a.pause();
        a.currentTime = start;
        setCurrentTime(0);
        return;
      }
    } else {
      setCurrentTime(Math.max(0, t - start));
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onLoaded = () => setIsReady(true);
    const onPlay = () => {
      setIsPlaying(true);
      stopRaf();
      rafRef.current = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setIsPlaying(false);
      stopRaf();
    };
    const onEnded = () => {
      setIsPlaying(false);
      stopRaf();
      const { start, end } = loopRef.current;
      if (end > start) {
        a.currentTime = start;
        setCurrentTime(0);
      }
    };
    const onError = () => {
      const code = a.error?.code;
      setIsReady(false);
      setIsPlaying(false);
      stopRaf();
      toast.error(`Audio playback failed${code ? ` (code ${code})` : ""}`);
    };
    a.addEventListener("loadedmetadata", onLoaded);
    a.addEventListener("canplay", onLoaded);
    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);
    a.addEventListener("error", onError);
    return () => {
      a.removeEventListener("loadedmetadata", onLoaded);
      a.removeEventListener("canplay", onLoaded);
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
      a.removeEventListener("error", onError);
      stopRaf();
    };
  }, [tick, stopRaf]);

  const load = useCallback(
    (url: string | null) => {
      const a = audioRef.current;
      if (!a) return;
      stopRaf();
      setIsReady(false);
      setIsPlaying(false);
      setCurrentTime(0);
      a.removeAttribute("crossorigin"); // Supabase signed URLs serve without CORS
      if (!url) {
        a.pause();
        a.removeAttribute("src");
        a.load();
        return;
      }
      if (a.src !== url) {
        a.src = url;
        a.load();
      } else {
        setIsReady(true);
      }
    },
    [stopRaf],
  );

  const play = useCallback(async () => {
    const a = audioRef.current;
    if (!a) return;
    const { start, end } = loopRef.current;
    if (end > start && (a.currentTime < start || a.currentTime >= end)) a.currentTime = start;
    try {
      await a.play();
    } catch (e) {
      console.warn("[audio] play rejected", e);
      toast.error("Tap play again — the browser blocked autoplay.");
    }
  }, []);

  const pause = useCallback(() => audioRef.current?.pause(), []);

  const toggle = useCallback(async () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) await play();
    else a.pause();
  }, [play]);

  const seek = useCallback((s: number) => {
    const a = audioRef.current;
    if (!a) return;
    const { start, end } = loopRef.current;
    const clipDur = Math.max(0, end - start);
    const clamped = Math.max(0, Math.min(clipDur, s));
    a.currentTime = start + clamped;
    setCurrentTime(clamped);
  }, []);

  const setLoop = useCallback(
    (startSec: number, endSec: number, opts?: { loop?: boolean }) => {
      const loop = opts?.loop ?? true;
      const start = Math.max(0, startSec);
      const end = Math.max(start, endSec);
      loopRef.current = { start, end, loop };
      setDuration(Math.max(0, end - start));
      const a = audioRef.current;
      if (a && (a.currentTime < start || a.currentTime >= end)) {
        a.currentTime = start;
        setCurrentTime(0);
      }
    },
    [],
  );

  return { isReady, isPlaying, currentTime, duration, load, play, pause, toggle, seek, setLoop };
}
