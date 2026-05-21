import { useCallback, useEffect, useMemo, useReducer } from "react";
import {
  campaignsApi,
  type CampaignBatch,
  type CampaignItem,
  type CampaignListResponse,
  type CampaignPost,
} from "./api";

type CampaignsState = {
  batches: CampaignBatch[];
  items: CampaignItem[];
  posts: CampaignPost[];
  loading: boolean;
  error: string | null;
  data: CampaignListResponse | null;
};

type CampaignsAction =
  | { type: "loading" }
  | { type: "loaded"; data: CampaignListResponse }
  | { type: "error"; error: string }
  | { type: "patchBatch"; batchId: string; patch: Partial<CampaignBatch> }
  | { type: "patchItem"; itemId: string; patch: Partial<CampaignItem> };

const initialState: CampaignsState = {
  batches: [],
  items: [],
  posts: [],
  loading: true,
  error: null,
  data: null,
};

function reducer(state: CampaignsState, action: CampaignsAction): CampaignsState {
  switch (action.type) {
    case "loading":
      return { ...state, loading: true, error: null };
    case "loaded":
      return {
        batches: action.data.batches,
        items: action.data.items,
        posts: action.data.posts,
        loading: false,
        error: null,
        data: action.data,
      };
    case "error":
      return { ...state, loading: false, error: action.error };
    case "patchBatch":
      return {
        ...state,
        batches: state.batches.map((batch) =>
          batch.id === action.batchId ? { ...batch, ...action.patch } : batch,
        ),
      };
    case "patchItem":
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.itemId ? { ...item, ...action.patch } : item,
        ),
      };
    default:
      return state;
  }
}

export function useCampaigns({ accountId }: { accountId?: string | null } = {}) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const refresh = useCallback(async () => {
    dispatch({ type: "loading" });
    try {
      const data = await campaignsApi.list(accountId);
      dispatch({ type: "loaded", data });
    } catch (error) {
      dispatch({ type: "error", error: error instanceof Error ? error.message : String(error) });
    }
  }, [accountId]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const withRevalidate = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        await refresh();
      } catch (error) {
        dispatch({ type: "error", error: error instanceof Error ? error.message : String(error) });
        await refresh();
        throw error;
      }
    },
    [refresh],
  );

  const actions = useMemo(
    () => ({
      refresh,
      pause(batchId: string) {
        dispatch({
          type: "patchBatch",
          batchId,
          patch: { status: "paused", paused_at: new Date().toISOString() },
        });
        return withRevalidate(() => campaignsApi.pause(batchId));
      },
      resume(batchId: string) {
        dispatch({ type: "patchBatch", batchId, patch: { status: "pending", paused_at: null } });
        return withRevalidate(() => campaignsApi.resume(batchId));
      },
      cancel(batchId: string) {
        dispatch({
          type: "patchBatch",
          batchId,
          patch: { status: "failed", paused_at: new Date().toISOString() },
        });
        return withRevalidate(() => campaignsApi.cancel(batchId));
      },
      regenerate(itemId: string) {
        dispatch({
          type: "patchItem",
          itemId,
          patch: { status: "pending", error_message: null },
        });
        return withRevalidate(() => campaignsApi.regenerate(itemId));
      },
      skip(itemId: string) {
        dispatch({
          type: "patchItem",
          itemId,
          patch: { status: "skipped", error_message: "skipped by user" },
        });
        return withRevalidate(() => campaignsApi.skip(itemId));
      },
      setLyricTemplate(itemId: string, lyricTemplateId: string | null) {
        dispatch({ type: "patchItem", itemId, patch: { lyric_template_id: lyricTemplateId } });
        return withRevalidate(() => campaignsApi.setLyricTemplate(itemId, lyricTemplateId));
      },
    }),
    [refresh, withRevalidate],
  );

  return {
    batches: state.batches,
    items: state.items,
    posts: state.posts,
    loading: state.loading,
    error: state.error,
    mutate: refresh,
    actions,
    data: state.data,
  };
}
