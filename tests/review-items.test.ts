import { it, expect } from "vitest";
import {
  validateItems,
  invalidateItems,
  type ReviewItem,
} from "../shared/review-items.mjs";
const today = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
}).format(new Date());
const documents = [{ id: "source", pageCount: 2 }];
const item = (): ReviewItem => ({
  id: "one",
  title: "면적",
  status: "기준 충족",
  detail: "원본 대조 및 산식 확인",
  nextAction: "",
  law: {
    name: "성남시 건축 조례",
    article: "제19조",
    effectiveAt: "2025-03-10",
    checkedAt: today,
    url: "https://www.law.go.kr/ordinInfoP.do?ordinSeq=2019919",
    reason: "일반 건축물 적용",
  },
  sources: [{ fileId: "source", page: 1, quote: "계획면적 160㎡" }],
});
it("requires legal evidence and an existing source page for a decision", () => {
  const i = item();
  expect(validateItems([i], documents, today)[0].status).toBe("기준 충족");
  i.sources[0].page = 3;
  expect(() => validateItems([i], documents, today)).toThrow("근거 페이지");
  i.sources[0].page = 1;
  i.law.reason = "";
  expect(() => validateItems([i], documents, today)).toThrow("적용 사유");
});
it("rejects stale, future, invalid and inapplicable dates and unsafe links", () => {
  for (const checkedAt of ["2020-01-01", "2099-01-01", "2026-02-30"]) {
    const i = item();
    i.law.checkedAt = checkedAt;
    expect(() => validateItems([i], documents, today)).toThrow();
  }
  const i = item();
  i.law.effectiveAt = "2099-01-01";
  expect(() => validateItems([i], documents, today)).toThrow();
  i.law.url = "javascript:alert(1)";
  expect(() => validateItems([i], documents, today)).toThrow("원문 링크");
});
it("preserves exclusion reasons and invalidates decisions without dropping evidence", () => {
  const i = item();
  i.status = "해당 없음";
  i.sources = [];
  expect(validateItems([i], documents, today)[0].status).toBe("해당 없음");
  const reset = invalidateItems([i]);
  expect(reset[0].status).toBe("판단 보류");
  expect(reset[0].law).toEqual(i.law);
  i.status = "미충족";
  expect(() => validateItems([i], documents, today)).toThrow();
});

it("historical published legal records remain readable but cannot be republished as fresh", async () => {
  const { validateResult } = await import("../shared/result-validation.mjs");
  const i = item();
  i.law.checkedAt = "2025-04-01";
  const record = {
    id: "case",
    originals: [
      { id: "source", name: "drawing.pdf", hash: "a".repeat(64), pageCount: 2 },
    ],
  };
  const r = {
    schemaVersion: 1,
    requestId: record.id,
    summary: "과거 결과",
    reviewer: "담당자",
    reviewedAt: "2025-04-01",
    basisDate: "2025-04-01",
    originals: record.originals,
    holds: [],
    lawNote: "당시 확인",
    lawConfirmed: true,
    lawCheckedAt: "2025-04-01",
    findings: [
      {
        title: i.title,
        status: "확인",
        decision: i.status,
        detail: i.detail,
        law: i.law,
        sources: [{ file: "drawing.pdf", page: 1, quote: "160㎡" }],
      },
    ],
  };
  expect(validateResult(r, record)).toBe(r);
  expect(()=>validateResult({...r,findings:[{...r.findings[0],status:"보완"}]},record)).toThrow("표시 상태");
  expect(() => validateResult(r, record, today)).toThrow("확인 기록");
});
