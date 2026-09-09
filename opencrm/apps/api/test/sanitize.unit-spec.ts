/** sanitizeAiDocument unit tests — repair, don't nuke. */
import { sanitizeAiDocument } from "../src/ai/sanitize";
import { pageDocumentSchema } from "@opencrm/shared";

describe("sanitizeAiDocument", () => {
  it("repairs a messy-but-salvageable doc into a valid PageDocument", () => {
    const messy = {
      version: 2,
      theme: { colors: { primary: "not-a-check-but-string-ok" } },
      sections: [{
        // missing id + name
        styles: { fontSize: 9999, opacity: 5, padding: { top: -20, left: 50 } },
        rows: [{ columns: [
          { widthPercent: 60, blocks: [
            { type: "heading", props: { text: "Hi" } },          // missing level + id
            { type: "mystery-widget", props: {} },               // unknown → dropped
            { type: "button", props: { text: "Go", variant: "mega", size: "xl" } },
            { type: "image", props: { src: "notaurl", alt: "x" } },
          ] },
          { widthPercent: 60, blocks: [] },                      // 60+60 → renormalized to 50/50
        ] }],
      }],
      customJs: "alert(1)",
      rawHtml: "<script>alert(1)</script>",
    };
    const { candidate, droppedBlocks, notes } = sanitizeAiDocument(messy as any);
    expect(droppedBlocks).toBe(1);
    expect(notes.join(" ")).toMatch(/dropped-blocks:1/);
    const checked = pageDocumentSchema.safeParse(candidate);
    expect(checked.success).toBe(true);
    const doc = checked.data as any;
    expect(doc.sections[0].id).toBeTruthy();
    expect(doc.sections[0].rows[0].columns[0].blocks.length).toBe(3);
    expect(doc.sections[0].rows[0].columns[0].blocks[0].props.level).toBe("h2");
    expect(doc.sections[0].rows[0].columns[0].blocks[1].props.variant).toBe("primary");
    expect(doc.sections[0].rows[0].columns[0].blocks[2].props.src).toMatch(/^https:\/\/picsum/);
    const widths = doc.sections[0].rows[0].columns.map((c: any) => c.widthPercent);
    expect(widths.reduce((a: number, b: number) => a + b, 0)).toBeCloseTo(100, 5);
    expect(doc.sections[0].styles.fontSize).toBeLessThanOrEqual(144);
    expect(doc.sections[0].styles.opacity).toBeLessThanOrEqual(1);
    expect((candidate as any).customJs).toBeUndefined();
    expect((candidate as any).rawHtml).toBeUndefined();
  });

  it("flags non-objects without throwing", () => {
    expect(sanitizeAiDocument(null).notes).toContain("not-an-object");
    expect(sanitizeAiDocument("junk").notes).toContain("not-an-object");
    expect(sanitizeAiDocument([]).notes).toContain("not-an-object");
  });

  it("keeps a clean doc intact (zero drops)", () => {
    const clean = {
      version: 2, theme: {}, mode: "structured",
      sections: [{ id: "s_1", name: "Hero", styles: {}, fullWidth: true, rows: [{ id: "r_1", styles: {}, columns: [{ id: "c_1", widthPercent: 100, styles: {}, blocks: [{ id: "b_1", type: "heading", styles: {}, hidden: false, props: { text: "Hi", level: "h1" } }] }] }] }],
    };
    const { candidate, droppedBlocks } = sanitizeAiDocument(clean);
    expect(droppedBlocks).toBe(0);
    expect(pageDocumentSchema.safeParse(candidate).success).toBe(true);
  });
});
