$env:DATABASE_URL="file:C:/Users/moham/AppData/Local/Temp/opencode/opencrm-dev.db"
Set-Location "C:\Users\moham\OneDrive\Documents\Default Project\opencrm\packages\db"
node -e '
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
prisma.page.findMany({ orderBy: { updatedAt: "desc" }, take: 3 }).then(r => {
  console.log("Pages in DB:", r.length);
  for (const p of r) {
    console.log("- id:", p.id.slice(0, 16), "| title:", p.title, "| doc type:", typeof p.document);
    if (typeof p.document === "string") {
      console.log("  raw doc len:", p.document.length);
      try { const j = JSON.parse(p.document); console.log("  sections found:", j.sections?.length ?? 0); } catch (e) { console.log("  parse failed:", e.message.slice(0, 60)); }
    } else {
      console.log("  object doc — sections:", p.document.sections ? p.document.sections.length : 0);
    }
  }
  process.exit(0);
}).catch(e => { console.error("ERROR:", e.message); process.exit(1); });
'
