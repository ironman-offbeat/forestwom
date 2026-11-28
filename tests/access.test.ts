import { it, expect, vi, afterEach } from "vitest";
// @ts-ignore native module
import {
  reviewerLink,
  exchangeLink,
  isReviewer,
  COOKIE,
} from "../server/access.mjs";
// @ts-ignore native module
import { seal } from "../server/drive.mjs";
// @ts-ignore native handler
import storage from "../api/storage.mjs";
const secret = "x".repeat(48);
afterEach(() => vi.useRealTimers());
it("only authentic unexpired reviewer links issue sessions; upload and old admin tickets cannot elevate", () => {
  const link = reviewerLink("case_12345", secret)
    .split("/access/")[1]
    .split("/")[0];
  const token = exchangeLink(link, secret);
  const req = { headers: { cookie: `${COOKIE}=${token}` } };
  expect(isReviewer(req, secret)).toBe(true);
  for (const kind of ["upload", "admin", "reviewer-session"])
    expect(() =>
      exchangeLink(seal({ kind, exp: Date.now() + 10000 }, secret), secret),
    ).toThrow();
  expect(
    isReviewer({ headers: { cookie: `${COOKIE}=${token}x` } }, secret),
  ).toBe(false);
  expect(isReviewer({ headers: { cookie: `fw_admin=${token}` } }, secret)).toBe(
    false,
  );
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 13 * 3600000);
  expect(isReviewer(req, secret)).toBe(false);
  vi.setSystemTime(Date.now() + 8 * 86400000);
  expect(() => exchangeLink(link, secret)).toThrow();
});
it("legacy storage API denies anonymous reads and writes before Drive access", async () => {
  for (const action of ["list", "read", "begin", "finish"]) {
    const res: any = { setHeader: vi.fn(), json: vi.fn(), status: vi.fn() };
    res.status.mockReturnValue(res);
    await storage({ method: "POST", headers: {}, body: { action } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  }
});
