import { it, expect } from "vitest";
import { parseAnalysis, analysisBasis } from "../src/analysis-import";
import type { CaseRecord } from "../src/portal-api";
const c = {
  id: "case_12345",
  originals: [{ id: "pdf_12345", name: "도면.pdf", hash: "a".repeat(64) }],
} as CaseRecord;
const result = {
  schemaVersion: 1,
  requestId: c.id,
  reviewer: "AI",
  reviewedAt: "2026-11-28",
  summary: "검토",
  originals: c.originals,
  findings: [],
  holds: [],
  lawConfirmed: true,
  lawCheckedAt: "2026-11-28",
  lawNote: "확인",
};
it("imports JSON and code fences but always resets AI law confirmation", () => {
  expect(
    parseAnalysis("```json\n" + JSON.stringify(result) + "\n```", c)
      .lawConfirmed,
  ).toBe(false);
  expect(() => parseAnalysis("{", c)).toThrow("JSON");
  expect(() =>
    parseAnalysis(JSON.stringify({ ...result, requestId: "other" }), c),
  ).toThrow();
  expect(() =>
    parseAnalysis(JSON.stringify({ ...result, originals: [] }), c),
  ).toThrow();
  expect(() =>
    parseAnalysis(
      JSON.stringify({
        ...result,
        findings: [
          {
            title: "A",
            status: "확인",
            detail: "B",
            sources: [{ file: "other.pdf", page: 1, quote: "" }],
          },
        ],
      }),
      c,
    ),
  ).toThrow();
  expect(analysisBasis(c)).not.toBe(analysisBasis({ ...c, sourceRevision: 1 }));
});
