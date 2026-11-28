import { reviewerLink } from "./access.mjs";
import { validateResult } from "../shared/result-validation.mjs";
export { validateResult };
import { validateMaterialItems } from "./materials.mjs";
import { invalidateItems } from "../shared/review-items.mjs";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { validateWorksheet } from "./worksheet.mjs";
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
        text: `Forestwom 검토 요청\n도면: ${record.name}\n접수번호: ${record.id}\n원본: ${record.originals.length}개\n관리자: ${reviewerLink(record.id, env.ADMIN_KEY)}\n저장소: https://drive.google.com/drive/folders/${record.id}`,
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
    "saveReview",
    "requestMaterials",
    "cancelMaterials",
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
    const files = [];
    let cursor;
    do {
      const page = await api(
        `files?q=${encodeURIComponent(`'${id(folder)}' in parents and trashed=false`)}&pageSize=100&fields=files(id,name,size,mimeType),nextPageToken${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ""}`,
      );
      files.push(...page.files);
      cursor = page.nextPageToken;
    } while (cursor);
    return files;
  }
  async function bytes(file, limit = MAX, capture) {
    const meta = await api(`files/${id(file)}?fields=size`);
    if (!Number(meta.size) || Number(meta.size) > limit)
      fail("파일 크기를 확인하세요.");
    const r = await request(
      `https://www.googleapis.com/drive/v3/files/${file}?alt=media`,
      { headers },
    );
    if (!r.ok) fail("파일 읽기 실패");
    if (capture) capture.etag = r.headers.get("etag");
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
    const captured = {};
    try {
      record = unseal(
        JSON.parse((await bytes(metadata[0].id, 1000000, captured)).toString())
          .signed,
        secret,
        1000000,
      );
    } catch {
      fail("접수 기록이 변경되었습니다. 관리자 확인이 필요합니다.");
    }
    if (record.id !== folder || record.kind !== "request")
      fail("접수 기록이 일치하지 않습니다.");
    return { record, metadata: metadata[0].id, files, etag: captured.etag };
  }
  async function save(record, file, etag) {
    const payload = JSON.stringify({ signed: seal(record, secret) });
    if (Buffer.byteLength(payload) > 1000000)
      fail("접수 기록 크기를 초과했습니다. 검토 메모를 줄여 주세요.");
    const r = await request(
      `https://www.googleapis.com/upload/drive/v3/files/${id(file)}?uploadType=media`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          ...(etag ? { "If-Match": etag } : {}),
        },
        body: payload,
      },
    );
    if (r.status === 412)
      fail(
        "다른 작업에서 접수가 변경되었습니다. 새로 열어 변경 내용을 확인하세요.",
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
      !["intake", "result", "supplement"].includes(s.kind) ||
      !Number.isInteger(body.index) ||
      !s.files[body.index]
    )
      fail("잘못된 업로드 세션입니다.");
    const { record, files } = await load(s.folder);
    if (s.kind === "intake" && record.state !== "uploading")
      fail("이미 접수된 자료입니다.");
    if (
      s.kind === "supplement" &&
      (record.materialRequests?.at(-1)?.id !== s.materialId ||
        record.materialRequests.at(-1).state !== "open")
    )
      fail("현재 보완 요청의 업로드가 아닙니다.");
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
  const { record, metadata, files, etag } = await load(body.id);
  if (action === "cancelMaterials") {
    const material = record.materialRequests?.at(-1);
    if (
      !material ||
      material.id !== body.materialId ||
      material.state !== "open"
    )
      fail("취소할 보완 요청이 없습니다.");
    if (!text(body.reason, 2000) || !body.reason.trim())
      fail("취소 사유를 입력하세요.");
    material.state = "cancelled";
    material.cancelReason = body.reason;
    material.cancelledAt = new Date().toISOString();
    record.state = "analyzing";
    await save(record, metadata, etag);
    return record;
  }
  if (action === "requestMaterials") {
    if (record.state === "uploading") fail("접수 완료 후 요청하세요.");
    if ((record.materialRequests || []).some((r) => r.state === "open"))
      fail("진행 중인 보완 요청이 있습니다.");
    if ((record.materialRequests || []).length >= 20)
      fail("보완 요청은 접수별 최대 20차입니다.");
    if (
      !Number.isInteger(body.sourceRevision) ||
      body.sourceRevision !== (record.sourceRevision || 0)
    )
      fail("자료가 변경되었습니다. 접수를 새로 여세요.");
    const material = {
      id: randomUUID(),
      state: "open",
      createdAt: new Date().toISOString(),
      items: validateMaterialItems(body.items),
    };
    record.materialRequests = [...(record.materialRequests || []), material];
    record.state = "needs_material";
    await save(record, metadata, etag);
    return record;
  }
  if (action === "supplementBegin") {
    const material = record.materialRequests?.at(-1);
    if (
      !material ||
      material.id !== body.materialId ||
      material.state !== "open" ||
      record.state !== "needs_material"
    )
      fail("진행 중인 보완 요청이 없습니다.");
    if (
      !validDescriptors(body.files) ||
      record.originals.length + body.files.length > 10 ||
      [...record.originals, ...body.files].reduce((n, f) => n + f.size, 0) >
        100 * 1024 * 1024
    )
      fail("전체 원본은 최대 10개·합계 100MB입니다. PDF 구성을 확인하세요.");
    const round = randomUUID();
    return {
      session: seal(
        {
          kind: "supplement",
          folder: record.id,
          materialId: material.id,
          round,
          sourceRevision: record.sourceRevision || 0,
          files: body.files.map((f, i) => ({
            ...f,
            name: `보완-${round}-${i + 1}-${cleanName(f.name.replace(/\.pdf$/i, "")).slice(0, 80)}.pdf`,
          })),
          exp: Date.now() + 3600000,
        },
        secret,
      ),
    };
  }
  if (action === "supplementFinish") {
    const session = unseal(body.session, secret);
    if (session.kind !== "supplement" || session.folder !== record.id)
      fail("보완 제출 세션을 확인하세요.");
    if (record.submissions?.some((r) => r.id === session.round))
      return { id: record.id, state: record.state };
    const material = record.materialRequests?.at(-1);
    if (
      !material ||
      material.id !== session.materialId ||
      material.state !== "open" ||
      session.sourceRevision !== (record.sourceRevision || 0)
    )
      fail("보완 요청이나 원본이 변경되었습니다.");
    if (
      record.originals.length + session.files.length > 10 ||
      [...record.originals, ...session.files].reduce((n, f) => n + f.size, 0) >
        100 * 1024 * 1024
    )
      fail("전체 원본 크기·개수 제한을 초과했습니다.");
    const added = await verify(files, session.files);
    const { PDFDocument } = await import("pdf-lib");
    const newDocuments = [];
    for (const asset of added) {
      const data = await bytes(asset.id);
      if (hash(data) !== asset.hash) fail("보완 원본이 변경되었습니다.");
      let pdf;
      try {
        pdf = await PDFDocument.load(data);
      } catch {
        fail("보완 PDF를 읽을 수 없습니다.");
      }
      const pageCount = pdf.getPageCount();
      if (pageCount < 1 || pageCount > 100)
        fail("파일당 1~100페이지 PDF를 제출하세요.");
      newDocuments.push({
        id: asset.id,
        name: asset.name,
        hash: asset.hash,
        pageCount,
      });
    }
    for (const version of record.versions)
      version.originals ||= record.originals.map(
        ({ id, name, hash, pageCount }) => ({ id, name, hash, pageCount }),
      );
    record.originals = [...record.originals, ...added];
    record.sourceRevision = (record.sourceRevision || 0) + 1;
    record.submissions = [
      ...(record.submissions || []),
      {
        id: session.round,
        materialId: material.id,
        submittedAt: new Date().toISOString(),
        files: added,
      },
    ];
    material.state = "submitted";
    record.state = "analyzing";
    if (record.review) {
      const draft = record.review.draft;
      draft.documents.push(...newDocuments);
      for (const e of Object.values(draft.entries)) e.confirmed = false;
      for (const f of Object.values(draft.info))
        if (f.status === "confirmed") f.status = "candidate";
      draft.gates = {
        ...draft.gates,
        scope: false,
        law: false,
        conflicts: false,
      };
      draft.items = invalidateItems(draft.items);
      draft.history = [
        ...draft.history,
        "보완 자료 제출: 원본·사건 정보·적용 기준을 다시 확인하세요.",
      ].slice(-100);
      record.review.revision++;
      record.review.savedAt = new Date().toISOString();
    }
    record.notificationId = randomUUID();
    record.notification = { state: "pending" };
    await save(record, metadata, etag);
    const notification = await sendNotification(record, env, request);
    try {
      const latest = await load(record.id);
      if (latest.record.notificationId === record.notificationId) {
        latest.record.notification = notification;
        await save(latest.record, latest.metadata, latest.etag);
      }
    } catch {
      /* The submission is already saved; administrators can retry the notification. */
    }
    return { id: record.id, state: record.state };
  }
  if (action === "get") {
    if (record.state === "uploading") fail("아직 접수가 완료되지 않았습니다.");
    const version = record.versions.find((v) => v.id === record.published);
    let result;
    if (version) {
      const b = await bytes(version.json.id, 1000000);
      if (hash(b) !== version.json.hash)
        fail("공개 결과가 변경되었습니다. 관리자에게 문의하세요.");
      result = validateResult(JSON.parse(b.toString()), {
        ...record,
        originals: version.originals || record.originals,
      });
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
      resultIsPrevious: !!version && record.state !== "published",
      materialRequests: record.materialRequests || [],
      submissions: (record.submissions || []).map(({ files, ...r }) => ({
        ...r,
        files: files.map((f) => ({ name: f.name })),
      })),
    };
  }
  if (action === "saveReview") {
    if (record.state === "uploading")
      fail("접수 완료 후 검토표를 저장할 수 있습니다.");
    if (
      !Number.isInteger(body.revision) ||
      body.revision !== (record.review?.revision || 0)
    )
      fail(
        "다른 작업에서 검토표가 변경되었습니다. 새로 열어 변경 내용을 확인하세요.",
      );
    // Check the actual source bytes, not a page count supplied by the browser.
    const { PDFDocument } = await import("pdf-lib");
    const originals = [];
    for (const original of record.originals) {
      const b = await bytes(original.id);
      if (hash(b) !== original.hash)
        fail("원본 파일이 변경되었습니다. 검토표 저장을 중단했습니다.");
      let pdf;
      try {
        pdf = await PDFDocument.load(b);
      } catch {
        fail(
          "원본 PDF 페이지를 확인하지 못했습니다. 검토표 저장을 중단했습니다.",
        );
      }
      const pageCount = pdf.getPageCount();
      if (pageCount < 1 || pageCount > 100)
        fail("원본은 파일당 1~100페이지여야 합니다.");
      originals.push({ ...original, pageCount });
    }
    const draft = validateWorksheet(body.draft, originals);
    record.originals = originals;
    record.review = {
      revision: body.revision + 1,
      savedAt: new Date().toISOString(),
      draft,
    };
    await save(record, metadata, etag);
    return record.review;
  }
  if (action === "detail") return record;
  if (action === "state") {
    if (
      body.state === "analyzing" &&
      record.materialRequests?.some((r) => r.state === "open")
    )
      fail("진행 중인 보완 요청을 제출 또는 취소한 후 분석을 시작하세요.");
    if (
      !["analyzing", "needs_material"].includes(body.state) ||
      record.state === "uploading"
    )
      fail("변경할 수 없는 상태입니다.");
    record.state = body.state;
    await save(record, metadata, etag);
    return record;
  }
  if (action === "notify") {
    if (record.state === "uploading")
      fail("접수 완료 후 알림을 보낼 수 있습니다.");
    if (record.notification.state !== "sent") {
      record.notification = await sendNotification(record, env, request);
      await save(record, metadata, etag);
    }
    return record.notification;
  }
  if (action === "resultBegin") {
    if (
      body.sourceRevision !== undefined &&
      body.sourceRevision !== (record.sourceRevision || 0)
    )
      fail("원본이 변경되었습니다. 최신 자료로 다시 분석하세요.");
    if (record.materialRequests?.some((r) => r.state === "open"))
      fail("진행 중인 보완 요청을 먼저 처리하세요.");
    if (record.state === "uploading" || !validDescriptors(body.files, true))
      fail("결과 PDF와 JSON 파일을 확인하세요.");
    if (
      body.reviewRevision !== undefined &&
      body.reviewRevision !== (record.review?.revision || 0)
    )
      fail("검토표가 변경되었습니다. 다시 미리보기 하세요.");
    const version = randomUUID();
    return {
      session: seal(
        {
          kind: "result",
          reviewRevision: body.reviewRevision,
          sourceRevision: record.sourceRevision || 0,
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
    if (record.materialRequests?.some((r) => r.state === "open"))
      fail("진행 중인 보완 요청을 먼저 처리하세요.");
    const s = unseal(body.session, secret);
    if (
      s.kind !== "result" ||
      s.folder !== record.id ||
      body.confirmed !== true
    )
      fail("담당자 결과 확인이 필요합니다.");
    if (record.versions.some((v) => v.id === s.version)) return record;
    if (
      (s.sourceRevision ?? 0) !== (record.sourceRevision || 0) ||
      (s.reviewRevision !== undefined &&
        s.reviewRevision !== (record.review?.revision || 0))
    )
      fail("원본 또는 검토표가 변경되었습니다. 결과를 다시 준비하세요.");
    await verify(files, record.originals);
    const uploaded = await verify(files, s.files);
    const result = validateResult(
      JSON.parse((await bytes(uploaded[1].id, 1000000)).toString()),
      record,
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
        new Date(),
      ),
    );
    if (
      !result.lawConfirmed ||
      !/^\d{4}-\d{2}-\d{2}$/.test(result.lawCheckedAt) ||
      !Number.isFinite(Date.parse(result.lawCheckedAt)) ||
      new Date(result.lawCheckedAt).toISOString().slice(0, 10) !==
        result.lawCheckedAt ||
      !result.lawNote.trim()
    )
      fail("법령 최신성 확인일과 확인 기록이 필요합니다.");
    const age =
      Date.parse(
        new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
          new Date(),
        ),
      ) - Date.parse(result.lawCheckedAt);
    if (!Number.isFinite(age) || age < 0 || age > 30 * 86400000)
      fail("법령 확인일은 미래가 아닌 최근 30일 이내여야 합니다.");
    if (record.versions.length >= 30)
      fail("결과 버전은 최대 30개까지 보관합니다.");
    record.versions.push({
      id: s.version,
      originals: record.originals.map(({ id, name, hash, pageCount }) => ({
        id,
        name,
        hash,
        pageCount,
      })),
      pdf: uploaded[0],
      json: uploaded[1],
      publishedAt: new Date().toISOString(),
    });
    record.published = s.version;
    record.state = "published";
    await save(record, metadata, etag);
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
