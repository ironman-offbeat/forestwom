import { validateItems } from "../shared/review-items.mjs";
const keys = [
  "site",
  "gross",
  "landscape",
  "planting",
  "natural",
  "roof",
  "wall",
];
const facts = [
  "address",
  "jurisdiction",
  "use",
  "zone",
  "applicationType",
  "applicationDate",
  "exceptions",
  "districtPlan",
];
const str = (v, max) => typeof v === "string" && v.length <= max;
const fail = () => {
  throw Error("검토표 형식·원본·근거 페이지를 확인하세요.");
};
export function validateWorksheet(draft, originals) {
  if (
    !draft ||
    JSON.stringify(draft).length > 400000 ||
    draft.schemaVersion !== 1 ||
    !str(draft.ruleVersion, 100) ||
    !draft.info ||
    !draft.entries ||
    !draft.gates ||
    !Array.isArray(draft.documents) ||
    draft.documents.length !== originals.length ||
    new Set(draft.documents.map((d) => d?.id)).size !== originals.length ||
    !str(draft.reviewer, 200) ||
    !str(draft.remarks, 10000) ||
    !Array.isArray(draft.history) ||
    draft.history.length > 100 ||
    draft.history.some((h) => !str(h, 3000))
  )
    fail();
  const documents = draft.documents.map((d) => {
    if (
      !d ||
      !originals.some(
        (o) =>
          o.id === d.id &&
          o.name === d.name &&
          o.hash === d.hash &&
          o.pageCount === d.pageCount,
      )
    )
      fail();
    return { id: d.id, name: d.name, hash: d.hash, pageCount: d.pageCount };
  });
  const info = Object.fromEntries(
    facts.map((key) => {
      const f = draft.info[key];
      if (
        !f ||
        !str(f.value, 500) ||
        !str(f.source, 2000) ||
        !["unknown", "candidate", "confirmed"].includes(f.status) ||
        (f.status === "confirmed" && (!f.value.trim() || !f.source.trim()))
      )
        fail();
      return [key, { value: f.value, status: f.status, source: f.source }];
    }),
  );
  const entries = Object.fromEntries(
    keys.map((key) => {
      const e = draft.entries[key];
      if (
        !e ||
        !str(e.value, 100) ||
        !str(e.pageId, 240) ||
        !str(e.note, 2000) ||
        typeof e.confirmed !== "boolean"
      )
        fail();
      const hasPage = documents.some((d) => {
        const prefix = d.id + ":";
        if (!e.pageId.startsWith(prefix)) return false;
        const n = e.pageId.slice(prefix.length);
        return /^[1-9]\d*$/.test(n) && Number(n) <= d.pageCount;
      });
      if (e.pageId && !hasPage) fail();
      if (
        e.confirmed &&
        (!hasPage ||
          !e.note.trim() ||
          !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(e.value.trim()) ||
          Number(e.value.replaceAll(",", "")) > 1e9)
      )
        fail();
      return [
        key,
        {
          value: e.value,
          pageId: e.pageId,
          note: e.note,
          confirmed: e.confirmed,
        },
      ];
    }),
  );
  const g = draft.gates;
  if (
    ["scope", "law", "conflicts"].some((k) => typeof g[k] !== "boolean") ||
    !str(g.basisDate, 20) ||
    !str(g.lawDate, 20) ||
    !str(g.lawNote, 10000)
  )
    fail();
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
  }).format(new Date());
  const validDate = (value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  const lawAge = (Date.parse(today) - Date.parse(g.lawDate)) / 86400000;
  const values = Object.fromEntries(
    keys.map((k) => [k, Number(entries[k].value.replaceAll(",", ""))]),
  );
  const items =
    draft.items === undefined
      ? undefined
      : validateItems(draft.items, documents, g.basisDate);
  if (
    items?.some((item) => item.status !== "판단 보류") &&
    (facts.some((k) => info[k].status !== "confirmed") ||
      info.jurisdiction.value.trim() !== "성남시" ||
      !g.scope ||
      !g.law ||
      !g.conflicts ||
      !validDate(info.applicationDate.value) ||
      info.applicationDate.value > today ||
      !validDate(g.basisDate) ||
      g.basisDate < "2025-03-10" ||
      g.basisDate > today ||
      !validDate(g.lawDate) ||
      lawAge < 0 ||
      lawAge > 30 ||
      !g.lawNote.trim() ||
      values.site < 300 ||
      values.gross <= 0 ||
      values.roof > 0 ||
      values.wall > 0 ||
      values.landscape > values.site ||
      values.planting > values.landscape ||
      values.natural > values.landscape ||
      keys.some((k) => !entries[k].confirmed))
  )
    throw Error("항목 판정 전에 사건 정보·수치·적용 기준 확인을 완료하세요.");
  return {
    schemaVersion: 1,
    ruleVersion: draft.ruleVersion,
    info,
    documents,
    entries,
    gates: {
      scope: g.scope,
      law: g.law,
      conflicts: g.conflicts,
      basisDate: g.basisDate,
      lawDate: g.lawDate,
      lawNote: g.lawNote,
    },
    reviewer: draft.reviewer,
    remarks: draft.remarks,
    history: draft.history,
    ...(draft.items !== undefined ? { items } : {}),
  };
}
