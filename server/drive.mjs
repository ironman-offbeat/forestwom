import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
export const ROOT = "1yH_XntqOfSO0m9jJP9hyUh8u3B4JCoqh";
export const FOLDER_URL = `https://drive.google.com/drive/folders/${ROOT}`;
const API = "https://www.googleapis.com/drive/v3";
const MAX = 30 * 1024 * 1024;
export function configured(env = process.env) {
  return [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REFRESH_TOKEN",
  ].every((k) => !!env[k]);
}
export function cleanName(value) {
  if (typeof value !== "string" || !value.trim())
    throw new Error("도면 이름을 입력하세요.");
  return value
    .replace(/[\x00-\x1f/\\]/g, "_")
    .trim()
    .slice(0, 160);
}
export function seal(value, secret) {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return (
    body + "." + createHmac("sha256", secret).update(body).digest("base64url")
  );
}
export function unseal(value, secret) {
  if (typeof value !== "string" || value.length > 10000)
    throw new Error("저장 세션이 올바르지 않습니다.");
  const [body, mac] = value.split(".");
  const expected = createHmac("sha256", secret)
    .update(body || "")
    .digest();
  const actual = Buffer.from(mac || "", "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("저장 세션이 올바르지 않습니다.");
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString());
  if (parsed.exp < Date.now())
    throw new Error("저장 세션이 만료되었습니다. 다시 저장하세요.");
  return parsed;
}
export function validFile(file) {
  return (
    file &&
    typeof file.name === "string" &&
    file.name.length <= 160 &&
    Number.isInteger(file.size) &&
    file.size > 0 &&
    file.size <= MAX &&
    ((file.type === "application/pdf" && /\.pdf$/i.test(file.name)) ||
      (file.type === "application/json" &&
        file.name === "review.json" &&
        file.size <= 1024 * 1024))
  );
}
export async function driveAction(
  action,
  body = {},
  env = process.env,
  request = fetch,
) {
  if (action === "status" && !configured(env))
    return {
      ready: false,
      folderUrl: FOLDER_URL,
      message: "소유자의 Google Drive 연결이 필요합니다.",
    };
  if (!configured(env))
    throw new Error(
      "소유자의 Google Drive 연결이 필요합니다. 연결 후 다시 저장하세요.",
    );
  const tokenResponse = await request("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!tokenResponse.ok)
    throw new Error(
      "Google 연결이 만료되었거나 취소되었습니다. 소유자가 다시 연결해야 합니다.",
    );
  const { access_token } = await tokenResponse.json();
  if (!access_token) throw new Error("Google 연결 응답을 확인하지 못했습니다.");
  const headers = {
    Authorization: `Bearer ${access_token}`,
    "Content-Type": "application/json",
  };
  async function call(path, options = {}) {
    const r = await request(`${API}/${path}`, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
    if (!r.ok)
      throw new Error(
        `Drive 요청 실패 (${r.status}). 연결 권한·저장 공간을 확인하세요.`,
      );
    return r.status === 204 ? {} : r.json();
  }
  const id = (value) => {
    if (typeof value !== "string" || !/^[\w-]{10,200}$/.test(value))
      throw new Error("잘못된 저장 항목입니다.");
    return value;
  };
  async function folder(folderId, complete = false) {
    const f = await call(
      `files/${id(folderId)}?fields=id,parents,appProperties,trashed`,
    );
    if (
      f.trashed ||
      !f.parents?.includes(ROOT) ||
      f.appProperties?.forestwom !== "1" ||
      (complete && f.appProperties?.complete !== "1")
    )
      throw new Error("앱 저장소의 완료된 항목만 열 수 있습니다.");
    return f;
  }
  async function children(folderId) {
    return (
      await call(
        `files?q=${encodeURIComponent(`'${id(folderId)}' in parents and trashed=false`)}&pageSize=100&fields=files(id,name,size,mimeType),nextPageToken`,
      )
    ).files;
  }
  if (action === "status") {
    const root = await call(
      `files/${ROOT}?fields=id,capabilities(canAddChildren)`,
    );
    return {
      ready: !!root.capabilities?.canAddChildren,
      folderUrl: FOLDER_URL,
      message: root.capabilities?.canAddChildren
        ? "Google Drive 저장소 연결됨"
        : "저장소 쓰기 권한을 확인하세요.",
    };
  }
  if (action === "list") {
    return call(
      `files?q=${encodeURIComponent(`'${ROOT}' in parents and trashed=false and appProperties has { key='complete' and value='1' }`)}&orderBy=createdTime desc&pageSize=100&fields=files(id,name,createdTime),nextPageToken${body.cursor ? `&pageToken=${encodeURIComponent(String(body.cursor).slice(0, 2000))}` : ""}`,
    );
  }
  if (action === "begin") {
    const files = body.files;
    if (
      !Array.isArray(files) ||
      files.length < 3 ||
      files.length > 12 ||
      !files.every(validFile) ||
      files.filter((f) => f.type === "application/json").length !== 1 ||
      files.reduce((n, f) => n + f.size, 0) > 102 * 1024 * 1024
    )
      throw new Error("저장 파일 구성 또는 크기를 확인하세요.");
    // Only this dedicated folder is shared, never the owner's Drive root.
    const permissions = await call(
      `files/${ROOT}/permissions?fields=permissions(id,type,role)`,
    );
    const anyone = permissions.permissions?.find((p) => p.type === "anyone");
    if (anyone?.role !== "writer")
      throw new Error(
        "저장소의 링크 편집 권한이 변경되었습니다. 소유자가 Drive 공유 설정을 확인하세요.",
      );
    const date = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul",
    }).format(new Date());
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
      .format(new Date())
      .replaceAll(":", "");
    const name = `[${date}] ${cleanName(body.name)} · ${time}-${randomUUID().slice(0, 8)}`;
    const f = await call("files?fields=id,name", {
      method: "POST",
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [ROOT],
        appProperties: { forestwom: "1", complete: "0" },
      }),
    });
    const session = seal(
      { folder: f.id, files, exp: Date.now() + 3600000 },
      env.GOOGLE_REFRESH_TOKEN,
    );
    return {
      session,
      name,
      folderUrl: `https://drive.google.com/drive/folders/${f.id}`,
    };
  }
  if (action === "upload") {
    const s = unseal(body.session, env.GOOGLE_REFRESH_TOKEN);
    if (!Number.isInteger(body.index) || !s.files[body.index])
      throw new Error("잘못된 파일 번호입니다.");
    await folder(s.folder);
    const file = s.files[body.index];
    const r = await request(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size",
      {
        method: "POST",
        headers: {
          ...headers,
          "X-Upload-Content-Type": file.type,
          "X-Upload-Content-Length": String(file.size),
        },
        body: JSON.stringify({
          name: cleanName(file.name),
          mimeType: file.type,
          parents: [s.folder],
        }),
      },
    );
    const url = r.headers.get("location");
    if (!r.ok || !url?.startsWith("https://www.googleapis.com/upload/"))
      throw new Error("파일 업로드를 시작하지 못했습니다.");
    return {
      ticket: seal(
        { url, size: file.size, exp: s.exp },
        env.GOOGLE_REFRESH_TOKEN,
      ),
    };
  }
  if (action === "chunk") {
    const s = unseal(body.ticket, env.GOOGLE_REFRESH_TOKEN);
    const bytes = Buffer.from(
      typeof body.data === "string" ? body.data : "",
      "base64",
    );
    if (
      !s.url?.startsWith("https://www.googleapis.com/upload/") ||
      !Number.isInteger(body.offset) ||
      body.offset < 0 ||
      body.offset % 262144 ||
      bytes.length < 1 ||
      bytes.length > 1048576 ||
      body.offset + bytes.length > s.size ||
      (body.offset + bytes.length < s.size && bytes.length % 262144)
    )
      throw new Error("잘못된 업로드 조각입니다.");
    const r = await request(s.url, {
      method: "PUT",
      headers: {
        Authorization: headers.Authorization,
        "Content-Length": String(bytes.length),
        "Content-Range": `bytes ${body.offset}-${body.offset + bytes.length - 1}/${s.size}`,
      },
      body: bytes,
    });
    if (r.status === 308) return { complete: false };
    if (!r.ok)
      throw new Error(
        "업로드가 중단되었습니다. 완료되지 않은 폴더는 다시 열기 목록에서 제외됩니다.",
      );
    const f = await r.json();
    return { complete: true, id: f.id };
  }
  if (action === "finish") {
    const s = unseal(body.session, env.GOOGLE_REFRESH_TOKEN);
    await folder(s.folder);
    const files = await children(s.folder);
    if (
      files.length !== s.files.length ||
      s.files.some(
        (f) =>
          !files.some(
            (saved) =>
              saved.name === cleanName(f.name) && Number(saved.size) === f.size,
          ),
      )
    )
      throw new Error(
        "일부 파일이 저장되지 않았습니다. 저장 완료로 처리하지 않았습니다.",
      );
    await call(`files/${s.folder}`, {
      method: "PATCH",
      body: JSON.stringify({
        appProperties: { forestwom: "1", complete: "1" },
      }),
    });
    return { complete: true };
  }
  if (action === "files") {
    await folder(body.folder, true);
    return { files: await children(body.folder) };
  }
  if (action === "read") {
    await folder(body.folder, true);
    const files = await children(body.folder),
      f = files.find((f) => f.id === body.file);
    if (
      !f ||
      Number(f.size) > MAX ||
      !Number.isInteger(body.offset) ||
      body.offset < 0 ||
      body.offset >= Number(f.size)
    )
      throw new Error("저장 파일을 읽을 수 없습니다.");
    const end = Math.min(body.offset + 1048576, Number(f.size)) - 1;
    const r = await request(`${API}/files/${id(f.id)}?alt=media`, {
      headers: {
        Authorization: headers.Authorization,
        Range: `bytes=${body.offset}-${end}`,
      },
    });
    if (!r.ok) throw new Error("파일 다운로드에 실패했습니다.");
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length !== end - body.offset + 1)
      throw new Error("파일 길이가 일치하지 않습니다.");
    return { data: bytes.toString("base64") };
  }
  throw new Error("지원하지 않는 저장소 요청입니다.");
}
