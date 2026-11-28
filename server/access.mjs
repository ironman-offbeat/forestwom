import { seal, unseal } from "./drive.mjs";
export const COOKIE = "__Host-fw_reviewer";
export function reviewerLink(id, secret) {
  return `https://forestwom.2hayoung.com/#/access/${seal({ kind: "reviewer-link", exp: Date.now() + 7 * 86400000 }, secret)}/${id}`;
}
export function exchangeLink(token, secret) {
  const value = unseal(token, secret);
  if (value.kind !== "reviewer-link" || !Number.isFinite(value.exp))
    throw Error("검토자 링크가 올바르지 않습니다. 최신 Slack 링크를 여세요.");
  return seal(
    { kind: "reviewer-session", exp: Date.now() + 12 * 3600000 },
    secret,
  );
}
export function isReviewer(req, secret) {
  try {
    if (!secret) return false;
    const token = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(COOKIE + "="))
      ?.slice(COOKIE.length + 1);
    const value = unseal(token, secret);
    return value.kind === "reviewer-session" && Number.isFinite(value.exp);
  } catch {
    return false;
  }
}
export function sessionCookie(token) {
  return `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${token ? 43200 : 0}`;
}
