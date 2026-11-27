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
  };
}
