import { createContext, useContext } from "react";
import type { AutopilotContextValue } from "./AutopilotContext";

export const AutopilotContext = createContext<AutopilotContextValue | null>(null);

export function useAutopilot() {
  const value = useContext(AutopilotContext);
  if (!value) throw new Error("useAutopilot must be used inside AutopilotProvider.");
  return value;
}
