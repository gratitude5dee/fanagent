import AutopilotWizard from "@/components/AutopilotWizard";

export type AutopilotPanelProps = {
  initialTab?: "campaign" | "lyrics";
  focusLyricsStepSignal?: number;
  initialLyricTemplateId?: string;
};

export default function AutopilotPanel(props: AutopilotPanelProps) {
  return <AutopilotWizard {...props} />;
}
