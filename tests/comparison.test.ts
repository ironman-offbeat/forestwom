import { it, expect } from "vitest";
// @ts-ignore native script
import { compareReview } from "../scripts/compare-review.mjs";
it("reports missed violations and wrong evidence instead of claiming legal accuracy", () => {
  const e = {
    requestId: "case",
    originals: [{ name: "a.pdf", hash: "abc" }],
    findings: [
      {
        title: "조경면적",
        status: "보완",
        sources: [{ file: "a.pdf", page: 2 }],
      },
      { title: "수목", status: "보류", sources: [{ file: "a.pdf", page: 3 }] },
    ],
  };
  const result = compareReview(e, {
    ...e,
    findings: [
      {
        title: "조경면적",
        status: "확인",
        sources: [{ file: "a.pdf", page: 1 }],
      },
    ],
  });
  expect(result.checks[0]).toMatchObject({
    statusMatch: false,
    evidenceMatch: false,
  });
  expect(result.checks[1].missing).toBe(true);
  expect(() => compareReview(e, { ...e, originals: [] })).toThrow("해시");
});
