// Run locally with a downloaded Desktop OAuth client JSON. Never commit that file.
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
const file = process.argv[2];
if (!file) {
  console.error(
    "사용법: node scripts/connect-drive.mjs <다운로드한 OAuth 클라이언트 JSON 경로>",
  );
  process.exit(1);
}
const { installed: client } = JSON.parse(await readFile(resolve(file), "utf8"));
if (!client?.client_id || !client?.client_secret)
  throw new Error("데스크톱 앱 유형의 OAuth 클라이언트 JSON이 필요합니다.");
const state = randomBytes(32).toString("base64url"),
  verifier = randomBytes(32).toString("base64url");
const server = createServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const redirect = `http://127.0.0.1:${server.address().port}/callback`;
const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
url.search = new URLSearchParams({
  client_id: client.client_id,
  redirect_uri: redirect,
  response_type: "code",
  scope: "https://www.googleapis.com/auth/drive",
  access_type: "offline",
  prompt: "consent",
  state,
  code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  code_challenge_method: "S256",
}).toString();
console.log(
  "소유자 계정으로 연결하세요. 앱 이용자에게는 이 과정이 없습니다.\n" +
    url.href,
);
if (process.platform === "win32")
  spawn("rundll32", ["url.dll,FileProtocolHandler", url.href], {
    windowsHide: true,
    stdio: "ignore",
  });
const timer = setTimeout(() => {
  console.error("연결 대기 시간이 만료되었습니다. 다시 실행하세요.");
  server.close();
}, 600000);
server.on("request", async (req, res) => {
  const callback = new URL(req.url, redirect);
  if (callback.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }
  if (callback.searchParams.get("state") !== state) {
    res.writeHead(403).end("Invalid state");
    return;
  }
  try {
    if (callback.searchParams.has("error"))
      throw new Error("Google 연결을 승인하지 않았습니다.");
    const code = callback.searchParams.get("code");
    if (!code) throw new Error("인증 코드가 없습니다.");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: client.client_id,
        client_secret: client.client_secret,
        redirect_uri: redirect,
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
      }),
    });
    const token = await response.json();
    if (!response.ok || !token.refresh_token)
      throw new Error("연결 토큰을 받지 못했습니다. 다시 연결하세요.");
    const values = {
      GOOGLE_CLIENT_ID: client.client_id,
      GOOGLE_CLIENT_SECRET: client.client_secret,
      GOOGLE_REFRESH_TOKEN: token.refresh_token,
    };
    await writeFile(
      ".env.drive",
      Object.entries(values)
        .map(([k, v]) => `${k}=${v}`)
        .join("\n") + "\n",
      { mode: 0o600 },
    );
    res
      .writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      })
      .end(
        "<h1>Google Drive 연결 승인 완료</h1><p>로컬 .env.drive 파일을 Vercel 환경 변수로 가져오고 다시 배포하세요. 이 창은 닫아도 됩니다.</p>",
      );
    console.log(
      "연결 승인 완료. 비밀값은 출력하지 않았습니다. .env.drive를 Vercel Production 환경 변수로 가져온 뒤 재배포하세요.",
    );
  } catch (e) {
    console.error(e.message);
    res
      .writeHead(400, { "Content-Type": "text/plain; charset=utf-8" })
      .end(e.message);
  } finally {
    clearTimeout(timer);
    server.close();
  }
});
