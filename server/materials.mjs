export function validateMaterialItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 10)
    throw Error("보완 요청은 1~10개 항목으로 작성하세요.");
  return items.map((i) => {
    if (
      !i ||
      ["title", "reason", "requested", "reference"].some(
        (k) => typeof i[k] !== "string" || i[k].length > 2000,
      ) ||
      !i.title.trim() ||
      !i.reason.trim() ||
      !i.requested.trim()
    )
      throw Error("보완 항목의 제목·사유·필요 자료를 입력하세요.");
    return {
      title: i.title,
      reason: i.reason,
      requested: i.requested,
      reference: i.reference,
    };
  });
}
