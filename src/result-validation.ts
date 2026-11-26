import type { CaseRecord } from "./portal-api";
export function validateResult(r: any, c: CaseRecord): void {
  if (
    !r ||
    r.schemaVersion !== 1 ||
    r.requestId !== c.id ||
    typeof r.summary !== "string" ||
    !r.summary.trim() ||
    typeof r.reviewer !== "string" ||
    !r.reviewer.trim() ||
    !Array.isArray(r.originals) ||
    r.originals.length !== c.originals.length ||
    new Set(r.originals.map((x: any) => x.name)).size !== r.originals.length ||
    r.originals.some(
      (x: any) =>
        !c.originals.some((o) => o.name === x.name && o.hash === x.hash),
    ) ||
    !Array.isArray(r.findings) ||
    !Array.isArray(r.holds) ||
    r.holds.some((x: any) => typeof x !== "string") ||
    typeof r.lawNote !== "string" ||
    typeof r.lawCheckedAt !== "string"
  )
    throw Error(
      "JSONの접수번호·원본 해시·요약·검토자·항목 형식을 확인하세요.".replace(
        "の",
        "의 ",
      ),
    );
  for (const f of r.findings)
    if (
      !f ||
      typeof f.title !== "string" ||
      typeof f.detail !== "string" ||
      !["확인", "보완", "보류"].includes(f.status) ||
      !Array.isArray(f.sources) ||
      f.sources.some(
        (s: any) =>
          !s ||
          typeof s.quote !== "string" ||
          !c.originals.some((o) => o.name === s.file) ||
          !Number.isInteger(s.page) ||
          s.page < 1 ||
          s.page > 100,
      )
    )
      throw Error("JSON 근거 파일과 PDF 페이지 번호를 확인하세요.");
}
