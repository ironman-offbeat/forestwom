export const itemStatuses = ["판단 보류", "기준 충족", "미충족", "해당 없음"];
const str = (v, max) => typeof v === "string" && v.length <= max;
const date = (v) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
export function invalidateItems(items = []) {
  return items.map((item) => ({
    ...item,
    status: "판단 보류",
    nextAction: "원본·수치·적용 조건 변경에 따라 다시 확인하세요.",
  }));
}
export function validateItems(
  items = [],
  documents,
  basisDate = "",
  today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  ),
) {
  if (
    !Array.isArray(items) ||
    items.length > 30 ||
    new Set(items.map((i) => i?.id)).size !== items.length
  )
    throw Error("검토 항목은 중복 없이 최대 30개입니다.");
  return items.map((i) => {
    if (
      !i ||
      !str(i.id, 100) ||
      !i.id ||
      !str(i.title, 300) ||
      !i.title.trim() ||
      !itemStatuses.includes(i.status) ||
      !str(i.detail, 5000) ||
      !str(i.nextAction, 2000) ||
      !i.law ||
      ["name", "article", "effectiveAt", "checkedAt", "url", "reason"].some(
        (k) => !str(i.law[k], 2000),
      ) ||
      !Array.isArray(i.sources) ||
      i.sources.length > 20 ||
      i.sources.some(
        (s) =>
          !s ||
          !str(s.quote, 2000) ||
          !documents.some(
            (d) =>
              d.id === s.fileId &&
              Number.isInteger(s.page) &&
              s.page >= 1 &&
              s.page <= d.pageCount,
          ),
      )
    )
      throw Error("검토 항목의 형식과 실제 원본 근거 페이지를 확인하세요.");
    if (i.law.url && !/^https:\/\/(?:www\.)?law\.go\.kr\//i.test(i.law.url))
      throw Error(
        "법령 출처는 국가법령정보센터의 HTTPS 원문 링크를 입력하세요.",
      );
    if (i.status !== "판단 보류") {
      const age = (Date.parse(today) - Date.parse(i.law.checkedAt)) / 86400000;
      if (
        !i.detail.trim() ||
        !i.law.name.trim() ||
        !i.law.article.trim() ||
        !i.law.reason.trim() ||
        !i.law.url ||
        !date(i.law.effectiveAt) ||
        !date(basisDate) ||
        i.law.effectiveAt > basisDate ||
        !date(i.law.checkedAt) ||
        age < 0 ||
        age > 30
      )
        throw Error(
          "판정에는 적용 조문·시행일·적용 사유·최근 30일 이내 확인 기록이 필요합니다.",
        );
      if (
        i.status !== "해당 없음" &&
        (!i.sources.length || i.sources.some((s) => !s.quote.trim()))
      )
        throw Error("충족·미충족 판정에는 원본 페이지와 인용이 필요합니다.");
      if (i.status === "미충족" && !i.nextAction.trim())
        throw Error("미충족 항목의 보완 내용을 입력하세요.");
    }
    return {
      id: i.id,
      title: i.title,
      status: i.status,
      detail: i.detail,
      nextAction: i.nextAction,
      law: Object.fromEntries(
        ["name", "article", "effectiveAt", "checkedAt", "url", "reason"].map(
          (k) => [k, i.law[k]],
        ),
      ),
      sources: i.sources.map((s) => ({
        fileId: s.fileId,
        page: s.page,
        quote: s.quote,
      })),
    };
  });
}
