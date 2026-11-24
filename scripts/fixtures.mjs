import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir("public/samples", { recursive: true });
const vals = {
  site: 1000,
  gross: 2000,
  landscape: 160,
  planting: 80,
  natural: 20,
  roof: 0,
  wall: 0,
};
const labels = {
  site: "Site area",
  gross: "Gross floor area",
  landscape: "Landscape area",
  planting: "Planting area",
  natural: "Natural ground area",
  roof: "Roof area",
  wall: "Wall area",
};
async function make(
  name,
  overrides = {},
  extra = false,
  scan = false,
  mixed = false,
) {
  const doc = await PDFDocument.create();
  doc.setTitle(`SYNTHETIC TEST ONLY - ${name}`);
  doc.setAuthor("Forestwom synthetic fixture");
  doc.setCreationDate(new Date("2026-11-24T00:00:00Z"));
  doc.setModificationDate(new Date("2026-11-24T00:00:00Z"));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  function page(v, no) {
    const p = doc.addPage([595, 842]);
    p.drawText("FORESTWOM / SYNTHETIC TEST ONLY", {
      x: 45,
      y: 785,
      size: 18,
      font,
      color: rgb(0.1, 0.3, 0.22),
    });
    p.drawText(
      `Landscape schedule - L-00${no} - No real applicant or address`,
      { x: 45, y: 750, size: 11, font },
    );
    let y = 700;
    for (const [k, value] of Object.entries(v)) {
      p.drawText(`${labels[k]}: ${value} m2`, { x: 45, y, size: 15, font });
      y -= 38;
    }
    p.drawRectangle({
      x: 45,
      y: 130,
      width: 480,
      height: 230,
      borderWidth: 2,
      borderColor: rgb(0.2, 0.35, 0.2),
    });
    p.drawRectangle({
      x: 70,
      y: 150,
      width: 180,
      height: 120,
      color: rgb(0.78, 0.9, 0.8),
    });
    p.drawText("Diagram is illustrative. Not to scale.", {
      x: 65,
      y: 320,
      size: 12,
      font,
    });
    p.drawText("Check the schedule above. No roof / wall credits.", {
      x: 65,
      y: 295,
      size: 12,
      font,
    });
    p.drawText(`Page ${no}`, { x: 480, y: 50, size: 10, font });
  }
  function imageOnly() {
    const p = doc.addPage([595, 842]);
    p.drawRectangle({
      x: 40,
      y: 70,
      width: 500,
      height: 700,
      borderWidth: 4,
      borderColor: rgb(0.2, 0.3, 0.2),
    });
    for (let i = 0; i < 8; i++)
      p.drawRectangle({
        x: 60,
        y: 130 + i * 70,
        width: 350 - i * 20,
        height: 20,
        color: rgb(0.7, 0.7, 0.7),
      });
  }
  if (!scan) page({ ...vals, ...overrides }, 1);
  else imageOnly();
  if (extra) page({ ...vals, site: 1200 }, 2);
  if (mixed) imageOnly();
  await writeFile(`public/samples/${name}.pdf`, await doc.save());
}
await make("normal");
await make("deficient", { landscape: 100, planting: 30, natural: 5 });
await make("conflict", {}, true);
await make("scan", {}, false, true);
await make("mixed", {}, false, false, true);
await writeFile("public/samples/corrupt.pdf", "%PDF-invalid synthetic test");
console.log("Generated 6 synthetic PDF fixtures.");
