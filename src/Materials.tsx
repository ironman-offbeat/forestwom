import { useState } from "react";
import {
  request,
  descriptors,
  upload,
  type CaseRecord,
  type MaterialRequest,
} from "./portal-api";

export function MaterialHistory({
  requests,
  submissions = [],
}: {
  requests: MaterialRequest[];
  submissions?: {
    id: string;
    submittedAt: string;
    files: { name: string }[];
  }[];
}) {
  return (
    <section className="card">
      <h2>보완 요청·제출 이력</h2>
      {!requests.length && <p>보완 요청이 없습니다.</p>}
      {requests.map((r, i) => (
        <article key={r.id}>
          <h3>
            {i + 1}차 보완 요청 ·{" "}
            {r.state === "open"
              ? "자료 제출 대기"
              : r.state === "cancelled"
                ? "요청 취소"
                : "자료 제출 완료·재검토 필요"}
          </h3>
          <p>
            {new Date(r.createdAt).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
            })}
          </p>
          {r.cancelReason && <p>취소 사유: {r.cancelReason}</p>}
          <ol>
            {r.items.map((item, j) => (
              <li key={j}>
                <strong>{item.title}</strong>
                <p>사유: {item.reason}</p>
                <p>필요 자료: {item.requested}</p>
                <p>관련 도면: {item.reference || "별도 지정 없음"}</p>
              </li>
            ))}
          </ol>
        </article>
      ))}
      {submissions.map((s) => (
        <p key={s.id}>
          {new Date(s.submittedAt).toLocaleString("ko-KR", {
            timeZone: "Asia/Seoul",
          })}{" "}
          제출: {s.files.map((f) => f.name).join(", ")}
        </p>
      ))}
    </section>
  );
}
export function RequestMaterials({
  record,
  onSaved,
}: {
  record: CaseRecord;
  onSaved: (c: CaseRecord) => void;
}) {
  const [items, setItems] = useState([
    { title: "", reason: "", requested: "", reference: "" },
  ]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      onSaved(
        await request("requestMaterials", {
          id: record.id,
          sourceRevision: record.sourceRevision || 0,
          items,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const [cancelReason, setCancelReason] = useState("");
  async function cancel() {
    setBusy(true);
    setError("");
    try {
      onSaved(
        await request("cancelMaterials", {
          id: record.id,
          materialId: record.materialRequests?.at(-1)?.id,
          reason: cancelReason,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const open = record.materialRequests?.some((r) => r.state === "open");
  return (
    <>
      <MaterialHistory
        requests={record.materialRequests || []}
        submissions={record.submissions}
      />
      {open && (
        <section className="card">
          <label>
            보완 요청 취소 사유
            <input
              maxLength={2000}
              value={cancelReason}
              disabled={busy}
              onChange={(e) => setCancelReason(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !cancelReason.trim()}
            onClick={() => void cancel()}
          >
            보완 요청 취소
          </button>
          {error && <p role="alert">{error}</p>}
        </section>
      )}
      {!open && record.state !== "uploading" && (
        <section className="card">
          <h2>보완 요청 작성</h2>
          <p>
            게시하면 결과 링크에서 요청 내용을 확인하고 같은 접수번호로 PDF를
            추가 제출할 수 있습니다.
          </p>
          <fieldset disabled={busy} className="app-fields">
            {items.map((item, i) => (
              <div className="case-fact" key={i}>
                {(
                  [
                    ["title", "보완 제목"],
                    ["reason", "요청 사유"],
                    ["requested", "필요 자료"],
                    ["reference", "관련 도면·페이지"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <textarea
                      maxLength={2000}
                      value={item[key]}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, [key]: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </label>
                ))}
                {items.length > 1 && (
                  <button
                    onClick={() =>
                      setItems((prev) => prev.filter((_, j) => j !== i))
                    }
                  >
                    보완 항목 삭제
                  </button>
                )}
              </div>
            ))}
            <button
              disabled={items.length >= 10}
              onClick={() =>
                setItems((prev) => [
                  ...prev,
                  { title: "", reason: "", requested: "", reference: "" },
                ])
              }
            >
              보완 항목 추가
            </button>
            <button className="primary" onClick={() => void submit()}>
              보완 요청 게시
            </button>
          </fieldset>
          {error && <p role="alert">{error}</p>}
        </section>
      )}
    </>
  );
}
export function SubmitMaterials({
  id,
  material,
  onDone,
}: {
  id: string;
  material: MaterialRequest;
  onDone: () => Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]),
    [session, setSession] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function submit() {
    setBusy(true);
    setError("");
    try {
      let token = session;
      if (!token) {
        const response = await request("supplementBegin", {
          id,
          materialId: material.id,
          files: await descriptors(files),
        });
        token = response.session;
        setSession(token);
      }
      await upload(token, files, setMessage);
      await request("supplementFinish", { id, session: token });
      setMessage("보완 자료가 제출되었습니다. 담당자가 다시 검토합니다.");
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <h2>보완 자료 제출</h2>
      <p>
        기존 원본을 보존하고 새 PDF를 추가합니다. 수정 도면은 수정본임을
        파일명에 표시하세요. 기존 자료를 포함해 최대 10개·합계 100MB, 파일당
        30MB·100페이지입니다.
      </p>
      <label>
        보완 PDF
        <input
          type="file"
          accept=".pdf,application/pdf"
          multiple
          disabled={busy || !!session}
          onChange={(e) => {
            setFiles(Array.from(e.target.files || []));
            setError("");
          }}
        />
      </label>
      <ul>
        {files.map((f, i) => (
          <li key={i}>{f.name}</li>
        ))}
      </ul>
      <button disabled={busy || !files.length} onClick={() => void submit()}>
        {busy
          ? "제출 중…"
          : session
            ? "보완 제출 다시 시도"
            : "보완 자료 제출하기"}
      </button>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {session && error && !busy && (
        <button
          onClick={() => {
            setSession("");
            setFiles([]);
            setError("");
          }}
        >
          새 파일로 다시 선택
        </button>
      )}
    </section>
  );
}
