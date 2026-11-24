import {
  emptyEntries,
  emptyGates,
  fields,
  RULE_VERSION,
  type Entries,
  type Gates,
} from "./engine";
export const folderUrl =
  "https://drive.google.com/drive/folders/1yH_XntqOfSO0m9jJP9hyUh8u3B4JCoqh";
const endpoint =
  location.hostname === "ironman-offbeat.github.io"
    ? "https://forestwom.2hayoung.com/api/storage"
    : "/api/storage";
export async function storage<T = any>(
  action: string,
  values: object = {},
): Promise<T> {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...values }),
  });
  if (!r.headers.get("content-type")?.includes("application/json"))
    throw new Error("Google Drive 서버 연결이 필요합니다.");
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || "저장소 요청에 실패했습니다.");
  return result;
}
export async function sha256(file: Blob) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export type Snapshot = {
  schema: 1;
  ruleVersion: string;
  name: string;
  savedAt: string;
  documents: { id: string; name: string; storedName: string; hash: string }[];
  entries: Entries;
  gates: Gates;
  remarks: string;
  reviewer: string;
  approved: string;
  history: string[];
  failedFiles: string[];
};
export function validateSnapshot(value: unknown): Snapshot {
  const s = value as Snapshot;
  const str = (x: unknown, max = 20000): x is string =>
    typeof x === "string" && x.length <= max;
  if (
    !s ||
    s.schema !== 1 ||
    !str(s.ruleVersion, 100) ||
    !str(s.name, 120) ||
    !str(s.savedAt, 100) ||
    !Array.isArray(s.documents) ||
    !s.documents.length ||
    s.documents.length > 10 ||
    s.documents.some(
      (d) =>
        !d ||
        !str(d.id, 100) ||
        !/^[\w-]+$/.test(d.id) ||
        !str(d.name, 255) ||
        !str(d.storedName, 160) ||
        !/^[a-f0-9]{64}$/.test(d.hash),
    ) ||
    new Set(s.documents.map((d) => d.id)).size !== s.documents.length ||
    new Set(s.documents.map((d) => d.storedName)).size !== s.documents.length ||
    !s.entries ||
    fields.some(([k]) => {
      const e = s.entries[k];
      return (
        !e ||
        !str(e.value, 100) ||
        !str(e.pageId, 120) ||
        !str(e.note) ||
        typeof e.confirmed !== "boolean"
      );
    }) ||
    !s.gates ||
    ["scope", "law", "conflicts"].some(
      (k) => typeof s.gates[k as keyof Gates] !== "boolean",
    ) ||
    !str(s.gates.lawDate, 20) ||
    !str(s.gates.basisDate, 20) ||
    !str(s.gates.lawNote) ||
    !str(s.remarks) ||
    !str(s.reviewer, 200) ||
    !str(s.approved, 500) ||
    !Array.isArray(s.history) ||
    s.history.length > 2000 ||
    s.history.some((x) => !str(x)) ||
    !Array.isArray(s.failedFiles) ||
    s.failedFiles.length > 100 ||
    s.failedFiles.some((x) => !str(x))
  )
    throw new Error("저장된 검토 기록 형식이 올바르지 않습니다.");
  return s;
}
export function restoredState(s: Snapshot) {
  const entries = emptyEntries();
  for (const [k] of fields) entries[k] = { ...s.entries[k], confirmed: false };
  // Publicly editable snapshots are evidence, never trusted approvals.
  return {
    entries,
    gates: {
      ...emptyGates(),
      basisDate: s.gates.basisDate,
      lawDate: s.gates.lawDate,
      lawNote: s.gates.lawNote,
    },
    message: `${s.ruleVersion !== RULE_VERSION ? "규칙 버전이 변경되었습니다. " : ""}원본과 수치를 다시 대조하고 적용 기준을 확인하세요.`,
  };
}
function base64(bytes: Uint8Array) {
  let str = "";
  for (let i = 0; i < bytes.length; i += 8192)
    str += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(str);
}
export async function saveArchive(
  name: string,
  files: File[],
  progress: (message: string) => void,
) {
  const begin = await storage("begin", {
    name,
    files: files.map((f) => ({ name: f.name, size: f.size, type: f.type })),
  });
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    const { ticket } = await storage("upload", {
      session: begin.session,
      index,
    });
    for (let offset = 0; offset < file.size; offset += 1048576) {
      progress(
        `${index + 1}/${files.length} ${file.name} · ${Math.floor((offset / file.size) * 100)}% 저장 중`,
      );
      const result = await storage("chunk", {
        ticket,
        offset,
        data: base64(
          new Uint8Array(
            await file.slice(offset, offset + 1048576).arrayBuffer(),
          ),
        ),
      });
      if (offset + 1048576 >= file.size && !result.complete)
        throw new Error("파일 저장 완료를 확인하지 못했습니다.");
    }
  }
  await storage("finish", { session: begin.session });
  return begin;
}
export type StoredFile = {
  id: string;
  name: string;
  size: string;
  mimeType: string;
};
export async function readStored(
  folder: string,
  file: StoredFile,
): Promise<File> {
  const size = Number(file.size);
  if (!Number.isInteger(size) || size <= 0 || size > 30 * 1024 * 1024)
    throw new Error("저장 파일 크기를 확인하세요.");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; offset < size; offset += 1048576) {
    const { data } = await storage("read", { folder, file: file.id, offset });
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    if (bytes.length !== Math.min(1048576, size - offset))
      throw new Error("다운로드 파일 크기가 일치하지 않습니다.");
    chunks.push(bytes);
  }
  return new File(chunks, file.name, { type: file.mimeType });
}
