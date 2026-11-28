import { it, expect, vi, afterEach } from "vitest";
import { readDraft, writeDraft, draftKey } from "../src/local-draft";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("recovery is scoped to the case, source and revision and expires in seven days", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) || null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
  const key = draftKey("one");
  writeDraft(key, "revision1", "초안");
  expect(readDraft(key, "revision1")?.content).toBe("초안");
  expect(readDraft(key, "revision2")).toBeNull();
  expect(readDraft(draftKey("two"), "revision1")).toBeNull();
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 8 * 86400000);
  expect(readDraft(key, "revision1")).toBeNull();
});
