"use client";
import type { PageDocument } from "@opencrm/shared";
import { BlockView, responsiveCss } from "./render";

/** Renders a complete PageDocument without editor chrome (used for live preview). */
export function PageRenderer({ doc, pageId }: { doc: PageDocument; pageId?: string }) {
  if (doc.mode === "html" && doc.rawHtml) {
    return (
      <iframe
        title="Preview"
        srcDoc={doc.rawHtml}
        style={{ width: "100%", height: "100vh", border: "none", display: "block" }}
        // No allow-scripts / allow-same-origin: AI/imported HTML must never reach the
        // parent page's storage or DOM (token theft via prompt-injected scripts).
        sandbox="allow-forms allow-popups"
      />
    );
  }
  return (
    <div>
      <style>{renderGlobalCss(doc)}</style>
      <style>{responsiveCss(doc)}</style>
      {doc.sections.map((s) => (
        <div key={s.id} className={`bl-sec bl-${s.id}`} style={sectionStyle(s.styles, s.fullWidth)}>
          {s.rows.map((r) => (
            <div key={r.id} className={`bl-row bl-${r.id}`} style={rowStyle(r.styles)}>
              {r.columns.map((c) => (
                <div key={c.id} className={`bl-col bl-${c.id}`} style={colStyle(c.styles, c.widthPercent)}>
                  {c.blocks.filter((b) => !b.hidden).map((b) => (
                    <div key={b.id} className={`bl-${b.id}`} style={{ display: "contents" }}>
                      <BlockView block={b} styles={b.styles} pageId={pageId} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      {doc.customCss ? <style>{doc.customCss}</style> : null}
      {doc.customJs ? <script dangerouslySetInnerHTML={{ __html: doc.customJs }} /> : null}
    </div>
  );
}

function px(v?: number) { return v === undefined ? undefined : `${v}px`; }

function sectionStyle(styles: any, fullWidth: boolean): React.CSSProperties {
  const { tablet, mobile, ...s } = styles ?? {};
  return {
    ...s,
    paddingTop: px(s.padding?.top), paddingBottom: px(s.padding?.bottom),
    paddingLeft: px(s.padding?.left), paddingRight: px(s.padding?.right),
    width: "100%", maxWidth: fullWidth ? "none" : 1200, margin: "0 auto",
  };
}
function rowStyle(styles: any): React.CSSProperties {
  const { tablet, mobile, ...s } = styles ?? {};
  return { ...s, display: "flex", gap: 16 };
}
function colStyle(styles: any, widthPercent: number): React.CSSProperties {
  const { tablet, mobile, ...s } = styles ?? {};
  return { ...s, width: `${widthPercent}%` };
}

function renderGlobalCss(doc: PageDocument): string {
  const t = doc.theme ?? {};
  return `body { font-family: "${t.fonts?.body ?? 'Inter'}", system-ui, sans-serif; color: ${t.colors?.text ?? '#0f172a'}; }`;
}