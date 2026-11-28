export type ReviewItem = {
  id: string;
  title: string;
  status: "판단 보류" | "기준 충족" | "미충족" | "해당 없음";
  detail: string;
  nextAction: string;
  law: {
    name: string;
    article: string;
    effectiveAt: string;
    checkedAt: string;
    url: string;
    reason: string;
  };
  sources: { fileId: string; page: number; quote: string }[];
};
export const itemStatuses: ReviewItem["status"][];
export function invalidateItems(items?: ReviewItem[]): ReviewItem[];
export function validateItems(
  items: ReviewItem[] | undefined,
  documents: { id: string; pageCount: number }[],
  basisDate?: string,
  today?: string,
): ReviewItem[];
