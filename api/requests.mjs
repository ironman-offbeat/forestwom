import { requestAction } from "../server/requests.mjs";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST")
    return res.status(405).json({ error: "POST 요청만 지원합니다." });
  const origin = req.headers.origin;
  if (
    origin &&
    ![
      "https://forestwom.2hayoung.com",
      "https://forestwom-261.vercel.app",
    ].includes(origin)
  )
    return res.status(403).json({ error: "허용되지 않은 앱 주소입니다." });
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!b || JSON.stringify(b).length > 1500000)
      return res.status(413).json({ error: "요청 크기를 초과했습니다." });
    // Owner explicitly chose an open review workflow: existing Slack links work
    // without a key, cookie, or login. ADMIN_KEY remains a server signing secret.
    const admin = true;
    if (b.action === "login") {
      return res.json({ ok: true });
    }
    if (b.action === "logout") {
      res.setHeader(
        "Set-Cookie",
        "fw_admin=; HttpOnly; Secure; SameSite=Strict; Path=/api/requests; Max-Age=0",
      );
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
