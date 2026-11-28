import type { Analysis, CaseRecord } from "./portal-api";
import { validateResult } from "./result-validation";
export function parseAnalysis(text: string, record: CaseRecord): Analysis {
  if (new TextEncoder().encode(text).length > 1000000)
    throw Error("분석 결과는 1MB 이하로 가져오세요.");
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "");
  let value;
  try {
    value = JSON.parse(cleaned);
  } catch {
    throw Error(
      "JSON 형식을 확인하세요. ChatGPT의 result.json 또는 JSON 코드 블록만 가져오세요.",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("JSON 객체를 가져오세요.");
  // The reviewer must fill the actual name and confirm law evidence in this app.
  value.reviewer =
    typeof value.reviewer === "string" && value.reviewer.trim()
      ? value.reviewer
      : "담당자 미확인";
  validateResult(value, record);
  return { ...value, lawConfirmed: false };
}
export function analysisBasis(c: CaseRecord) {
  return JSON.stringify([
    c.sourceRevision || 0,
    c.review?.revision || 0,
    c.originals.map((f) => [f.id, f.hash]),
  ]);
}
