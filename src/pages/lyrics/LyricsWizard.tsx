import { useCallback } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, FileMusic } from "lucide-react";
import LyricsTemplateBuilder from "@/components/autopilot/LyricsTemplateBuilder";
import type { LyricTemplate } from "@/lib/lyrics/types";
import { appRoutes } from "@/lib/routes";

export default function LyricsWizard() {
  const params = useParams<{ templateId?: string }>();
  const nav = useNavigate();
  const templateId = params.templateId ?? null;

  const handleSaved = useCallback(
    (template: LyricTemplate) => {
      nav(appRoutes.lyricsRemix(template.id));
    },
    [nav],
  );

  const handleClose = useCallback(() => {
    nav(appRoutes.lyricsHome);
  }, [nav]);

  const handleTemplateIdChange = useCallback(
    (id: string | null) => {
      // When the wizard creates a brand-new template, keep the URL in sync so
      // a reload resumes the same template instead of starting over.
      if (id && id !== templateId) {
        nav(appRoutes.lyricsTemplate(id), { replace: true });
      }
    },
    [nav, templateId],
  );

  return (
    <main className="page lyrics-wizard">
      <header className="page-header">
        <Link to={appRoutes.lyricsHome} className="button ghost">
          <ChevronLeft size={14} /> Back to templates
        </Link>
        <h1>
          <FileMusic size={18} /> {templateId ? "Edit template" : "Create template"}
        </h1>
        <span />
      </header>
      <LyricsTemplateBuilder
        templateId={templateId}
        onTemplateIdChange={handleTemplateIdChange}
        onSaved={handleSaved}
        onClose={handleClose}
      />
    </main>
  );
}
