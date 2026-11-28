import { validateItems } from "./review-items.mjs";
const text = (v, max) => typeof v === "string" && v.length <= max;
const fail = (message) => {
  throw Error(message);
};
export function validateResult(r, record, atDate) {
  if (
    !r ||
    r.schemaVersion !== 1 ||
    r.requestId !== record.id ||
    !text(r.summary, 10000) ||
    !r.summary.trim() ||
    !text(r.reviewer, 200) ||
    !r.reviewer.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(r.reviewedAt || "") ||
    !Number.isFinite(Date.parse(r.reviewedAt)) ||
    new Date(r.reviewedAt).toISOString().slice(0, 10) !== r.reviewedAt ||
    (atDate && r.reviewedAt > atDate) ||
    !Array.isArray(r.originals) ||
    r.originals.length !== record.originals.length ||
    new Set(r.originals.map((f) => f.name)).size !== r.originals.length ||
    r.originals.some(
      (f) =>
        !record.originals.some((o) => o.name === f.name && o.hash === f.hash),
    )
  )
    fail("결과 JSON의 접수번호·원본 해시·검토자·요약을 확인하세요.");
  if (
    !Array.isArray(r.findings) ||
    r.findings.length > 200 ||
    !Array.isArray(r.holds) ||
    r.holds.length > 100 ||
    r.holds.some((h) => !text(h, 2000)) ||
    !text(r.lawCheckedAt, 20) ||
    !text(r.lawNote, 10000) ||
    typeof r.lawConfirmed !== "boolean"
  )
    fail("결과 JSON 항목 형식을 확인하세요.");
  for (const f of r.findings) {
    if (
      !f ||
      !text(f.title, 300) ||
      !text(f.detail, 5000) ||
      !["확인", "보완", "보류", "해당 없음"].includes(f.status) ||
      !Array.isArray(f.sources) ||
      f.sources.length > 50 ||
      f.sources.some(
        (s) =>
          !record.originals.some((o) => o.name === s.file) ||
          !Number.isInteger(s.page) ||
          s.page < 1 ||
          s.page >
            (record.originals.find((o) => o.name === s.file)?.pageCount ||
              100) ||
          !text(s.quote, 2000),
      )
    )
      fail("검토 항목의 상태·근거 파일·페이지를 확인하세요.");
    if (
      f.law !== undefined &&
      {
        "기준 충족": "확인",
        미충족: "보완",
        "판단 보류": "보류",
        "해당 없음": "해당 없음",
      }[f.decision] !== f.status
    )
      fail("항목 판정과 표시 상태가 일치하지 않습니다.");
    if (f.law !== undefined)
      validateItems(
        [
          {
            id: "published-item",
            title: f.title,
            status: f.decision,
            detail: f.detail,
            nextAction: f.nextAction || "",
            law: f.law,
            sources: f.sources.map((s) => ({
              fileId: record.originals.find((o) => o.name === s.file)?.id,
              page: s.page,
              quote: s.quote,
            })),
          },
        ],
        record.originals.map((o) => ({
          id: o.id,
          pageCount: o.pageCount || 100,
        })),
        r.basisDate,
        atDate || r.reviewedAt,
      );
    if (f.status === "확인" && !f.sources.length)
      fail("확인 항목에는 원본 근거 페이지가 필요합니다.");
  }
  return r;
}
