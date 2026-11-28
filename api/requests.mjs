import { isReviewer, exchangeLink, sessionCookie } from "../server/access.mjs";
import { appOrigins } from "../server/origins.mjs";
import { requestAction } from "../server/requests.mjs";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST")
    return res.status(405).json({ error: "POST 요청만 지원합니다." });
  const origin = req.headers.origin;
  if (origin && !appOrigins().includes(origin))
    return res.status(403).json({ error: "허용되지 않은 앱 주소입니다." });
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!b || JSON.stringify(b).length > 1500000)
      return res.status(413).json({ error: "요청 크기를 초과했습니다." });
    const admin = isReviewer(req, process.env.ADMIN_KEY);
    if (b.action === "login") {
      if (!origin || !appOrigins().includes(origin))
        return res.status(403).json({ error: "앱에서 검토자 링크를 여세요." });
      const token = exchangeLink(b.token, process.env.ADMIN_KEY);
      res.setHeader("Set-Cookie", sessionCookie(token));
      return res.json({ ok: true });
    }
    if (b.action === "logout") {
      res.setHeader("Set-Cookie", sessionCookie(""));
      return res.json({ ok: true });
    }
    if (b.action === "session") return res.json({ admin });
    res.json(await requestAction(b.action, b, process.env, fetch, admin));
  } catch (e) {
    res.status(400).json({
      error: e instanceof Error ? e.message : "요청을 처리하지 못했습니다.",
    });
  }
}
