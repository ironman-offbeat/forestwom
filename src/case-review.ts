import {
  fields,
  RULE_VERSION,
  validDate,
  todayKorea,
  type Entries,
  type Gates,
} from "./engine";

export const caseFields = [
  ["address", "소재지"],
  ["jurisdiction", "관할 지자체"],
  ["use", "건축물 용도"],
  ["zone", "용도지역"],
  ["applicationType", "신청 유형"],
  ["applicationDate", "신청일"],
  ["exceptions", "면제·특례 검토"],
  ["districtPlan", "지구단위계획 검토"],
] as const;
export type CaseKey = (typeof caseFields)[number][0];
export type CaseFact = {
  value: string;
  status: "unknown" | "candidate" | "confirmed";
  source: string;
};
export type CaseInfo = Record<CaseKey, CaseFact>;
export const emptyCaseInfo = (): CaseInfo =>
  Object.fromEntries(
    caseFields.map(([key]) => [
      key,
      { value: "", status: "unknown", source: "" },
    ]),
  ) as CaseInfo;
export type Worksheet = {
  schemaVersion: 1;
  ruleVersion: string;
  info: CaseInfo;
  documents: { id: string; name: string; hash: string; pageCount: number }[];
  entries: Entries;
  gates: Gates;
  reviewer: string;
  remarks: string;
  history: string[];
};
export type SavedWorksheet = {
  revision: number;
  savedAt: string;
  draft: Worksheet;
};
export function caseHolds(info: CaseInfo) {
  const holds: string[] = caseFields.flatMap(([key, label]) => {
    const f = info[key];
    return f.status !== "confirmed" || !f.value.trim() || !f.source.trim()
      ? [`${label}: 사건 정보와 확인 근거 확정 필요`]
      : [];
  });
  if (info.jurisdiction.value.trim() !== "성남시")
    holds.push("성남시 외 관할은 현재 검산 범위 밖입니다.");
  if (
    info.applicationDate.value &&
    (!validDate(info.applicationDate.value) ||
      info.applicationDate.value > todayKorea())
  )
    holds.push("신청일 형식을 확인하세요.");
  return holds;
}
export function restoreWorksheet(
  draft: Worksheet,
  documents: Worksheet["documents"],
) {
  if (
    documents.length !== draft.documents.length ||
    documents.some(
      (d) =>
        !draft.documents.some(
          (old) =>
            old.id === d.id &&
            old.hash === d.hash &&
            old.name === d.name &&
            old.pageCount === d.pageCount,
        ),
    )
  ) {
    throw Error(
      "원본 구성 또는 페이지 수가 변경되었습니다. 저장된 검토표를 복원할 수 없습니다.",
    );
  }
  // Calculations are always recomputed; a rule update requires fresh confirmation.
  if (draft.ruleVersion === RULE_VERSION) return draft;
  return {
    ...draft,
    entries: Object.fromEntries(
      fields.map(([k]) => [k, { ...draft.entries[k], confirmed: false }]),
    ) as Entries,
    gates: { ...draft.gates, scope: false, law: false, conflicts: false },
  };
}
