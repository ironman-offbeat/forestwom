import { appOrigins } from "../server/origins.mjs";
import { driveAction } from "../server/drive.mjs";
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const origins = [
    ...appOrigins(),
    "https://ironman-offbeat.github.io",
  ];
  const origin = req.headers.origin;
  if (origin && !origins.includes(origin))
    return res.status(403).json({ error: "허용되지 않은 앱 주소입니다." });
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "POST 요청만 지원합니다." });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!body || JSON.stringify(body).length > 1500000)
      return res.status(413).json({ error: "요청 크기를 초과했습니다." });
    res.status(200).json(await driveAction(body.action, body));
  } catch (error) {
    res
      .status(400)
      .json({
        error:
          error instanceof Error
            ? error.message
            : "저장소 요청에 실패했습니다.",
      });
  }
}
