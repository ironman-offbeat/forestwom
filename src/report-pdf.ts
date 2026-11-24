import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
export async function reportPDF(element: HTMLElement): Promise<Blob> {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".no-print").forEach((n) => n.remove());
  clone
    .querySelectorAll("br")
    .forEach((n) => n.replaceWith(document.createTextNode(" / ")));
  clone
    .querySelectorAll("small")
    .forEach((n) => n.prepend(document.createTextNode(" / ")));
  clone.querySelectorAll("table").forEach((table) => {
    const headings = Array.from(
      table.querySelectorAll("thead th"),
      (n) => n.textContent || "",
    );
    const block = document.createElement("div");
    table.querySelectorAll("tbody tr").forEach((row) => {
      const p = document.createElement("p");
      p.textContent = Array.from(
        row.children,
        (cell, i) => `${headings[i]}: ${cell.textContent}`,
      ).join(" | ");
      block.append(p);
    });
    table.replaceWith(block);
  });
  clone.querySelectorAll("a[href]").forEach((link) => {
    link.textContent += ` (${link.getAttribute("href")})`;
  });
  clone.style.cssText = "position:absolute;left:-10000px;top:0;width:700px";
  document.body.append(clone);
  const text = clone.innerText;
  clone.remove();
  const response = await fetch(
    `${import.meta.env.BASE_URL}fonts/NanumGothic-Regular.ttf`,
  );
  if (!response.ok) throw new Error("PDF 한글 글꼴을 불러오지 못했습니다.");
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await response.arrayBuffer(), {
    subset: true,
  });
  const supported = new Set(font.getCharacterSet());
  const lines: { text: string; size: number }[] = [];
  for (const paragraph of text
    .replaceAll("㎡", "m2")
    .replaceAll("\t", "   ")
    .split("\n")) {
    const size =
      paragraph === "건축협의 조경 검토 의견서"
        ? 18
        : /^\d\. /.test(paragraph)
          ? 12
          : 10;
    let line = "";
    for (const original of paragraph) {
      const char = supported.has(original.codePointAt(0)!) ? original : " ";
      if (font.widthOfTextAtSize(line + char, size) > 499) {
        lines.push({ text: line, size });
        line = "";
      }
      line += char;
    }
    lines.push({ text: line, size });
  }
  let page = pdf.addPage([595.28, 841.89]),
    y = 790;
  for (const line of lines) {
    if (y < 55) {
      page = pdf.addPage([595.28, 841.89]);
      y = 790;
    }
    page.drawText(line.text, {
      x: 48,
      y,
      size: line.size,
      font,
      color: rgb(0.1, 0.17, 0.14),
    });
    y -= line.size + 7;
  }
  pdf
    .getPages()
    .forEach((p, i, pages) =>
      p.drawText(`Forestwom | ${i + 1} / ${pages.length}`, {
        x: 48,
        y: 28,
        size: 8,
        font,
      }),
    );
  pdf.setTitle("건축협의 조경 검토 의견서");
  return new Blob([new Uint8Array(await pdf.save())], {
    type: "application/pdf",
  });
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
