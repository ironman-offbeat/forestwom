import { validateResult } from "../shared/result-validation.mjs";
import { type Analysis, type CaseRecord } from "./portal-api";
import { type Worksheet, caseHolds } from "./case-review";
import { evaluate, fields, todayKorea, type Page } from "./engine";
import { validateItems } from "../shared/review-items.mjs";
export function worksheetResult(
  record: CaseRecord,
  draft: Worksheet,
  pages: Page[],
  revision: number,
): Analysis {
  if (!draft.reviewer.trim())
    throw Error("검토자를 입력하고 검토표를 저장하세요.");
  const items = validateItems(
    draft.items,
    draft.documents,
    draft.gates.basisDate,
  );
  const calc = evaluate(draft.entries, pages, draft.gates);
  const holds = [...caseHolds(draft.info), ...calc.holds];
  const sources = (keys: string[]) =>
    keys.flatMap((key) => {
      const entry = draft.entries[key as keyof typeof draft.entries];
      const page = pages.find((p) => p.id === entry.pageId);
      return page
        ? [
            {
              file: page.file,
              page: page.number,
              quote: `${fields.find((f) => f[0] === key)?.[1]} ${entry.value}㎡ · ${entry.note}`,
            },
          ]
        : [];
    });
  const findings: Analysis["findings"] = [
    ...(!holds.length
      ? calc.checks.map((check, index) => ({
          title: check.name,
          status: check.pass ? "확인" : "보완",
          detail: `${check.source}\n산식: ${check.formula}\n필요면적: ${check.required}㎡ / 계획면적: ${check.actual}㎡\n${check.pass ? "계산 범위 내 수치 충족" : `${check.required - check.actual}㎡ 부족`}`,
          sources: sources([
            "site",
            "gross",
            ["landscape", "planting", "natural"][index],
          ]),
        }))
      : []),
    ...items.map((item) => ({
      title: item.title,
      decision: item.status,
      nextAction: item.nextAction,
      law: item.law,
      status:
        item.status === "판단 보류"
          ? "보류"
          : item.status === "미충족"
            ? "보완"
            : item.status === "해당 없음"
              ? "해당 없음"
              : "확인",
      detail: `판정: ${item.status}\n${item.detail}\n${item.law.name} ${item.law.article}\n시행일: ${item.law.effectiveAt || "미확인"} / 원문 확인일: ${item.law.checkedAt || "미확인"}\n${item.law.reason}\n${item.law.url}\n${item.nextAction}`,
      sources: item.sources.map((s) => ({
        file: draft.documents.find((d) => d.id === s.fileId)!.name,
        page: s.page,
        quote: s.quote,
      })),
    })),
  ];
  if (findings.some((f) => f.detail.length > 5000))
    throw Error("항목별 법령·판정 설명을 합계 5,000자 이내로 줄여 주세요.");
  const analysis: Analysis = {
    schemaVersion: 1,
    basisDate: draft.gates.basisDate,
    ruleVersion: draft.ruleVersion,
    worksheetRevision: revision,
    requestId: record.id,
    reviewer: draft.reviewer,
    reviewedAt: todayKorea(),
    summary: `성남시 조경 검토 · 검토표 ${revision}차\n${holds.length ? "미확인 사항이 있어 관련 판정을 보류합니다." : "면적 검산 및 등록된 항목을 검토했습니다."}\n검토 범위는 아래 항목에 한정하며 건축 도면 전체의 적합 판정이 아닙니다.\n${draft.remarks}`,
    originals: record.originals.map(({ name, hash }) => ({ name, hash })),
    findings,
    holds: [
      ...holds,
      ...items
        .filter((i) => i.status === "판단 보류")
        .map((i) => `${i.title}: ${i.nextAction || "추가 확인 필요"}`),
      "미등록 법규 항목, 수목·배치·공개공지·특례 등은 별도 검토가 필요합니다.",
    ],
    lawConfirmed: draft.gates.law,
    lawCheckedAt: draft.gates.lawDate,
    lawNote: `적용기준일: ${draft.gates.basisDate} / 규칙 버전: ${draft.ruleVersion}\n${draft.gates.lawNote}`,
  };
  validateResult(analysis, { ...record, originals: record.originals.map(o=>({...o,pageCount:draft.documents.find(d=>d.id===o.id)?.pageCount})) }, todayKorea());
  return analysis;
}
