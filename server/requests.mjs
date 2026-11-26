import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { ROOT, cleanName, seal, unseal, driveAction } from "./drive.mjs";

const SITE = "https://forestwom.2hayoung.com";
const MAX = 30 * 1024 * 1024;
const hash = (b) => createHash("sha256").update(b).digest("hex");
const fail = (message) => {
  throw new Error(message);
};
const text = (v, max) => typeof v === "string" && v.length <= max;
export function validDescriptors(files, result = false) {
  if (
    !Array.isArray(files) ||
    !files.length ||
    files.length > (result ? 2 : 10)
  )
    return false;
  if (
    result &&
    (files.length !== 2 ||
      files[0].name !== "report.pdf" ||
      files[1].name !== "result.json")
  )
    return false;
  return (
    files.every(
      (f, i) =>
        f &&
        text(f.name, 160) &&
        f.name.length &&
        Number.isInteger(f.size) &&
        f.size > 0 &&
        f.size <= (result && i === 1 ? 1000000 : MAX) &&
        /^[a-f0-9]{64}$/.test(f.hash) &&
        (result && i === 1
          ? f.type === "application/json"
          : f.type === "application/pdf" && /\.pdf$/i.test(f.name)),
    ) &&
    new Set(files.map((f) => f.name)).size === files.length &&
    files.reduce((s, f) => s + f.size, 0) <= 100 * 1024 * 1024
  );
}
export function validateResult(r, record) {
  if (
    !r ||
    r.schemaVersion !== 1 ||
    r.requestId !== record.id ||
    !text(r.summary, 10000) ||
    !r.summary.trim() ||
    !text(r.reviewer, 200) ||
    !r.reviewer.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(r.reviewedAt || "") ||
    !Array.isArray(r.originals) ||
    r.originals.length !== record.originals.length ||
    new Set(r.originals.map((f) => f.name)).size !== r.originals.length ||
    r.originals.some(
      (f) =>
        !record.originals.some((o) => o.name === f.name && o.hash === f.hash),
    )
  )
    fail("결과 JSON의 접수번호·원본 해시·검토자·요약을 확인하세요.");
  if (
    !Array.isArray(r.findings) ||
    r.findings.length > 200 ||
    !Array.isArray(r.holds) ||
    r.holds.length > 100 ||
    r.holds.some((h) => !text(h, 2000)) ||
    !text(r.lawCheckedAt, 20) ||
    !text(r.lawNote, 10000) ||
    typeof r.lawConfirmed !== "boolean"
  )
    fail("결과 JSON 항목 형식을 확인하세요.");
  for (const f of r.findings) {
    if (
      !f ||
      !text(f.title, 300) ||
      !text(f.detail, 5000) ||
      !["확인", "보완", "보류"].includes(f.status) ||
      !Array.isArray(f.sources) ||
      f.sources.length > 50 ||
      f.sources.some(
        (s) =>
          !record.originals.some((o) => o.name === s.file) ||
          !Number.isInteger(s.page) ||
          s.page < 1 ||
          s.page > 100 ||
          !text(s.quote, 2000),
      )
    )
      fail("검토 항목의 상태·근거 파일·페이지를 확인하세요.");
    if (f.status === "확인" && !f.sources.length)
      fail("확인 항목에는 원본 근거 페이지가 필요합니다.");
  }
  return r;
}
export function adminSession(cookie, env) {
  try {
    const token = (cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("fw_admin="))
      ?.slice(9);
    const s = unseal(token, env.ADMIN_KEY);
    return s.kind === "admin" && Number.isFinite(s.exp) && s.exp > Date.now();
  } catch {
    return false;
  }
}
export function login(key, env) {
  if (!env.ADMIN_KEY || env.ADMIN_KEY.length < 32)
    fail("관리자 연결 설정이 필요합니다.");
  if (
    typeof key !== "string" ||
    !timingSafeEqual(
      createHash("sha256").update(key).digest(),
      createHash("sha256").update(env.ADMIN_KEY).digest(),
    )
  )
    fail("관리자 키가 올바르지 않습니다.");
  return seal({ kind: "admin", exp: Date.now() + 8 * 3600000 }, env.ADMIN_KEY);
}
export async function sendNotification(record, env, request = fetch) {
  if (!env.SLACK_CONNECTOR && !env.SLACK_BOT_TOKEN)
    return { state: "pending", message: "Slack 연결 필요" };
  try {
    let token = env.SLACK_BOT_TOKEN;
    if (env.SLACK_CONNECTOR) {
      const { getToken } = await import("@vercel/connect");
      token = await getToken(env.SLACK_CONNECTOR, { subject: { type: "app" } });
    }
    const r = await request("https://slack.com/api/chat.postMessage", {
      method: "POST",
      signal: AbortSignal.timeout(12000),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: "U0AF5B880F3",
        client_msg_id: record.notificationId,
        text: `Forestwom 검토 요청\n도면: ${record.name}\n접수번호: ${record.id}\n원본: ${record.originals.length}개\n관리자: ${SITE}/#/admin/${record.id}\n저장소: https://drive.google.com/drive/folders/${record.id}`,
        mrkdwn: false,
        unfurl_links: false,
        unfurl_media: false,
      }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok)
      return {
        state: "failed",
        message: "Slack 전송 실패. 연결 권한을 확인하고 재전송하세요.",
      };
    return { state: "sent", sentAt: new Date().toISOString() };
  } catch {
    return {
      state: "failed",
      message: "Slack 연결 또는 전송 시간 초과. 재전송하세요.",
    };
  }
}

export async function requestAction(
  action,
  body = {},
  env = process.env,
  request = fetch,
  admin = false,
) {
  const adminActions = [
    "list",
    "detail",
    "state",
    "notify",
    "resultBegin",
    "publish",
    "health",
  ];
  if (adminActions.includes(action) && !admin)
    fail("관리자 로그인이 필요합니다.");
  if (!env.ADMIN_KEY || !env.GOOGLE_REFRESH_TOKEN)
    fail("서버 연결 설정이 필요합니다.");
  const secret = env.ADMIN_KEY;
  if (action === "health")
    return { slack: !!(env.SLACK_CONNECTOR || env.SLACK_BOT_TOKEN) };
  if (action === "chunk") {
    const ticket = unseal(body.ticket, secret);
    if (ticket.kind !== "chunk" || ticket.exp < Date.now())
      fail("업로드 세션이 만료되었습니다.");
    return driveAction(
      "chunk",
      { ...body, ticket: ticket.ticket },
      env,
      request,
    );
  }
  const tr = await request("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const token = await tr.json();
  if (!tr.ok || !token.access_token) fail("Google Drive 연결을 확인하세요.");
  const headers = { Authorization: `Bearer ${token.access_token}` };
  async function api(path, options = {}) {
    const r = await request(`https://www.googleapis.com/drive/v3/${path}`, {
      ...options,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    if (!r.ok) fail(`Drive 요청 실패 (${r.status})`);
    return r.json();
  }
  const id = (v) =>
    typeof v === "string" && /^[\w-]{10,200}$/.test(v)
      ? v
      : fail("접수번호가 올바르지 않습니다.");
  async function children(folder) {
    return (
      await api(
        `files?q=${encodeURIComponent(`'${id(folder)}' in parents and trashed=false`)}&pageSize=100&fields=files(id,name,size,mimeType),nextPageToken`,
      )
    ).files;
  }
  async function bytes(file, limit = MAX) {
    const meta = await api(`files/${id(file)}?fields=size`);
    if (!Number(meta.size) || Number(meta.size) > limit)
      fail("파일 크기를 확인하세요.");
    const r = await request(
      `https://www.googleapis.com/drive/v3/files/${file}?alt=media`,
      { headers },
    );
    if (!r.ok) fail("파일 읽기 실패");
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length !== Number(meta.size)) fail("파일 크기가 변경되었습니다.");
    return b;
  }
  async function load(folder) {
    const f = await api(
      `files/${id(folder)}?fields=parents,appProperties,trashed`,
    );
    if (
      f.trashed ||
      !f.parents?.includes(ROOT) ||
      f.appProperties?.request !== "1"
    )
      fail("접수 저장소에 없는 항목입니다.");
    const files = await children(folder),
      metadata = files.filter((f) => f.name === "request.signed.json");
    if (metadata.length !== 1) fail("접수 기록을 확인할 수 없습니다.");
    let record;
    try {
      record = unseal(
        JSON.parse((await bytes(metadata[0].id, 1000000)).toString()).signed,
        secret,
      );
    } catch {
      fail("접수 기록이 변경되었습니다. 관리자 확인이 필요합니다.");
    }
    if (record.id !== folder || record.kind !== "request")
      fail("접수 기록이 일치하지 않습니다.");
    return { record, metadata: metadata[0].id, files };
  }
  async function save(record, file) {
    const r = await request(
      `https://www.googleapis.com/upload/drive/v3/files/${id(file)}?uploadType=media`,
      {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ signed: seal(record, secret) }),
      },
    );
    if (!r.ok) fail("접수 상태 저장 실패. 새로고침 후 상태를 확인하세요.");
  }
  async function signedFile(record) {
    const f = await api("files?fields=id", {
      method: "POST",
      body: JSON.stringify({
        name: "request.signed.json",
        parents: [record.id],
        mimeType: "application/json",
      }),
    });
    await save(record, f.id);
  }
  async function verify(files, expected) {
    const found = [];
    for (const e of expected) {
      const matches = files.filter(
        (f) => f.name === e.name && Number(f.size) === e.size,
      );
      if (matches.length !== 1)
        fail("업로드 파일이 누락되었거나 중복되었습니다.");
      const b = await bytes(matches[0].id);
      if (hash(b) !== e.hash) fail("원본 파일 해시가 일치하지 않습니다.");
      if (
        e.type === "application/pdf" &&
        !b.subarray(0, 1024).includes(Buffer.from("%PDF-"))
      )
        fail("PDF 형식이 올바르지 않습니다.");
      found.push({ ...e, id: matches[0].id });
    }
    return found;
  }
  if (action === "begin") {
    if (!validDescriptors(body.files) || !text(body.note || "", 4000))
      fail("PDF 파일 구성·크기·요청 메모를 확인하세요.");
    const name = cleanName(body.name).slice(0, 120),
      date = new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Seoul",
      }).format(new Date());
    const f = await api("files?fields=id", {
      method: "POST",
      body: JSON.stringify({
        name: `[${date}] ${name} · ${randomUUID().slice(0, 8)}`,
        mimeType: "application/vnd.google-apps.folder",
        parents: [ROOT],
        appProperties: { forestwom: "1", request: "1" },
      }),
    });
    const record = {
      kind: "request",
      id: f.id,
      name,
      note: body.note || "",
      createdAt: new Date().toISOString(),
      state: "uploading",
      originals: body.files,
      versions: [],
      notificationId: randomUUID(),
      notification: { state: "pending" },
    };
    await signedFile(record);
    return {
      id: f.id,
      session: seal(
        {
          kind: "intake",
          folder: f.id,
          files: body.files,
          exp: Date.now() + 3600000,
        },
        secret,
      ),
    };
  }
  if (action === "upload") {
    const s = unseal(body.session, secret);
    if (
      !["intake", "result"].includes(s.kind) ||
      !Number.isInteger(body.index) ||
      !s.files[body.index]
    )
      fail("잘못된 업로드 세션입니다.");
    const { record, files } = await load(s.folder);
    if (s.kind === "intake" && record.state !== "uploading")
      fail("이미 접수된 자료입니다.");
    const existing = files.filter((f) => f.name === s.files[body.index].name);
    if (
      existing.length === 1 &&
      Number(existing[0].size) === s.files[body.index].size
    )
      return { complete: true };
    if (existing.length) fail("같은 이름의 저장 파일을 확인하세요.");
    const legacy = seal(
      { folder: s.folder, files: s.files, exp: s.exp },
      env.GOOGLE_REFRESH_TOKEN,
    );
    const result = await driveAction(
      "upload",
      { session: legacy, index: body.index },
      env,
      request,
    );
    return {
      ticket: seal(
        { kind: "chunk", ticket: result.ticket, exp: s.exp },
        secret,
      ),
    };
  }
  if (action === "finish") {
    const s = unseal(body.session, secret);
    if (s.kind !== "intake") fail("접수 세션이 아닙니다.");
    const { record, metadata, files } = await load(s.folder);
    if (record.state === "uploading") {
      record.originals = await verify(files, s.files);
      record.state = "submitted";
      await save(record, metadata);
      record.notification = await sendNotification(record, env, request);
      try {
        await save(record, metadata);
      } catch {
        return {
          id: record.id,
          state: record.state,
          notification: { state: "unknown" },
        };
      }
    }
    return {
      id: record.id,
      state: record.state,
      notification: record.notification,
    };
  }
  if (action === "list") {
    const data = await api(
      `files?q=${encodeURIComponent(`'${ROOT}' in parents and trashed=false and appProperties has { key='request' and value='1' }`)}&orderBy=createdTime desc&pageSize=50&fields=files(id,name,createdTime),nextPageToken${body.cursor ? `&pageToken=${encodeURIComponent(String(body.cursor).slice(0, 2000))}` : ""}`,
    );
    return data;
  }
  const { record, metadata, files } = await load(body.id);
  if (action === "get") {
    if (record.state === "uploading") fail("아직 접수가 완료되지 않았습니다.");
    const version = record.versions.find((v) => v.id === record.published);
    let result;
    if (version) {
      const b = await bytes(version.json.id, 1000000);
      if (hash(b) !== version.json.hash)
        fail("공개 결과가 변경되었습니다. 관리자에게 문의하세요.");
      result = validateResult(JSON.parse(b.toString()), record);
    }
    return {
      id: record.id,
      name: record.name,
      state: record.state,
      createdAt: record.createdAt,
      notification: record.notification,
      result,
      version: version?.id,
      pdf: version?.pdf,
    };
  }
  if (action === "detail") return record;
  if (action === "state") {
    if (
      !["analyzing", "needs_material"].includes(body.state) ||
      record.state === "uploading"
    )
      fail("변경할 수 없는 상태입니다.");
    record.state = body.state;
    await save(record, metadata);
    return record;
  }
  if (action === "notify") {
    if (record.state === "uploading")
      fail("접수 완료 후 알림을 보낼 수 있습니다.");
    if (record.notification.state !== "sent") {
      record.notification = await sendNotification(record, env, request);
      await save(record, metadata);
    }
    return record.notification;
  }
  if (action === "resultBegin") {
    if (record.state === "uploading" || !validDescriptors(body.files, true))
      fail("결과 PDF와 JSON 파일을 확인하세요.");
    const version = randomUUID();
    return {
      session: seal(
        {
          kind: "result",
          folder: record.id,
          version,
          files: body.files.map((f) => ({
            ...f,
            name: `${version}-${f.name}`,
          })),
          exp: Date.now() + 3600000,
        },
        secret,
      ),
    };
  }
  if (action === "publish") {
    const s = unseal(body.session, secret);
    if (
      s.kind !== "result" ||
      s.folder !== record.id ||
      body.confirmed !== true
    )
      fail("담당자 결과 확인이 필요합니다.");
    if (record.versions.some((v) => v.id === s.version)) return record;
    await verify(files, record.originals);
    const uploaded = await verify(files, s.files);
    const result = validateResult(
      JSON.parse((await bytes(uploaded[1].id, 1000000)).toString()),
      record,
    );
    if (
      !result.lawConfirmed ||
      !/^\d{4}-\d{2}-\d{2}$/.test(result.lawCheckedAt) ||
      !result.lawNote.trim()
    )
      fail("법령 최신성 확인일과 확인 기록이 필요합니다.");
    const age =
      Date.now() - Date.parse(result.lawCheckedAt + "T00:00:00+09:00");
    if (!Number.isFinite(age) || age < 0 || age > 31 * 86400000)
      fail("법령 확인일은 미래가 아닌 최근 30일 이내여야 합니다.");
    if (record.versions.length >= 30)
      fail("결과 버전은 최대 30개까지 보관합니다.");
    record.versions.push({
      id: s.version,
      pdf: uploaded[0],
      json: uploaded[1],
      publishedAt: new Date().toISOString(),
    });
    record.published = s.version;
    record.state = "published";
    await save(record, metadata);
    return record;
  }
  if (action === "read") {
    const version = record.versions.find((v) => v.id === record.published);
    const allowed = admin
      ? [
          ...record.originals,
          ...record.versions.flatMap((v) => [v.pdf, v.json]),
        ]
      : version
        ? [version.pdf]
        : [];
    const f = allowed.find((f) => f.id === body.file);
    if (
      !f ||
      !Number.isInteger(body.offset) ||
      body.offset < 0 ||
      body.offset >= f.size
    )
      fail("다운로드 권한 또는 범위를 확인하세요.");
    const meta = files.find((x) => x.id === f.id);
    if (!meta || Number(meta.size) !== f.size)
      fail("저장 파일이 변경되었습니다.");
    const end = Math.min(body.offset + 1048576, f.size) - 1;
    const r = await request(
      `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`,
      { headers: { ...headers, Range: `bytes=${body.offset}-${end}` } },
    );
    if (!r.ok) fail("파일 다운로드 실패");
    const b = Buffer.from(await r.arrayBuffer());
    if (b.length !== end - body.offset + 1)
      fail("파일 길이가 일치하지 않습니다.");
    return { data: b.toString("base64") };
  }
  fail("지원하지 않는 요청입니다.");
}
