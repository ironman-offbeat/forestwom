import { Fragment } from "react";

// Render a small, safe formatting vocabulary; submitted HTML stays plain text.
function Inline({ text }: { text: string }) {
  return <>{text.split(/(\*\*[^*\n]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={i}>{part.slice(2, -2)}</strong>
      : <Fragment key={i}>{part}</Fragment>,
  )}</>;
}

export function ReportText({ text }: { text: string }) {
  const blocks: { kind: "p" | "ul" | "ol" | "heading"; lines: string[]; start?: number }[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) { blocks.push({ kind: "p", lines: [] }); continue; }
    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    const heading = trimmed.match(/^#{1,6}\s+(.+)$/);
    const kind = bullet ? "ul" : numbered ? "ol" : heading ? "heading" : "p";
    const content = bullet?.[1] ?? numbered?.[2] ?? heading?.[1] ?? line;
    const previous = blocks.at(-1);
    if (previous?.kind === kind && previous.lines.length && kind !== "heading") previous.lines.push(content);
    else blocks.push({ kind, lines: [content], start: numbered ? Number(numbered[1]) : undefined });
  }
  return <div className="report-text">{blocks.filter(b => b.lines.length).map((b, i) => {
    if (b.kind === "ul" || b.kind === "ol") {
      const Tag = b.kind;
      return <Tag key={i} start={b.kind === "ol" ? b.start : undefined}>{b.lines.map((line, j) => <li key={j}><Inline text={line} /></li>)}</Tag>;
    }
    if (b.kind === "heading") return <p className="report-subheading" key={i}><Inline text={b.lines[0]} /></p>;
    return <p key={i}>{b.lines.map((line, j) => <Fragment key={j}>{j > 0 && <br />}<Inline text={line} /></Fragment>)}</p>;
  })}</div>;
}
