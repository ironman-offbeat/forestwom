export type LocalDraft = {
  schema: 1;
  basis: string;
  savedAt: number;
  content: string;
};
export function draftKey(id: string, kind = "worksheet") {
  return `forestwom:draft:v1:${kind}:${id}`;
}
export function readDraft(key: string, basis: string): LocalDraft | null {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const d = JSON.parse(raw);
  if (
    d.schema !== 1 ||
    d.basis !== basis ||
    typeof d.content !== "string" ||
    !Number.isFinite(d.savedAt) ||
    Date.now() - d.savedAt > 7 * 86400000
  )
    return null;
  return d;
}
export function writeDraft(key: string, basis: string, content: string) {
  localStorage.setItem(
    key,
    JSON.stringify({ schema: 1, basis, content, savedAt: Date.now() }),
  );
}
