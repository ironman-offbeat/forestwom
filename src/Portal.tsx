import { useEffect, useState, lazy, Suspense } from "react";
import {
  request,
  descriptors,
  upload,
  download,
  readAsset,
  states,
  template,
  prompt,
  type CaseRecord,
  type Analysis,
  type Asset,
} from "./portal-api";
import { folderUrl } from "./storage";
import "./portal.css";
const Review = lazy(() => import("./App"));
function Report({ r }: { r: Analysis }) {
  return (
    <section className="analysis">
      <h2>검토 결과</h2>
      <p className="summary">{r.summary}</p>
      <p className="muted">
        {r.reviewer} · {r.reviewedAt}
      </p>
      {r.findings.map((f, i) => (
        <article key={i}>
          <span className="pill">{f.status}</span>
          <h3>{f.title}</h3>
          <p>{f.detail}</p>
          {f.sources.map((s, j) => (
            <blockquote key={j}>
              {s.file} · PDF {s.page}페이지
              <br />
              {s.quote}
            </blockquote>
          ))}
        </article>
      ))}
      {!!r.holds.length && (
        <>
          <h3>추가 확인·보류</h3>
          <ul>
            {r.holds.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </>
      )}
      <h3>법령 확인 기록</h3>
      <p>
        {r.lawCheckedAt || "미확인"} · {r.lawNote || "확인 기록 없음"}
      </p>
    </section>
  );
}
export default function Portal() {
  const [route, setRoute] = useState(location.hash);
  useEffect(() => {
    const change = () => setRoute(location.hash);
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  const parts = route.replace(/^#\/?/, "").split("/");
  if (parts[0] === "review")
    return (
      <Suspense fallback={<p>검토 도구를 여는 중입니다.</p>}>
        <a className="portal-return" href="#/">
          접수 화면으로
        </a>
        <Review />
      </Suspense>
    );
  return (
    <div className="portal">
      <header>
        <a className="brand" href="#/">
          F <strong>Forestwom</strong>
        </a>
        <nav>
          <a href="#/">도면 등록</a>
          <a href="#/result">결과 확인</a>
          <a href={folderUrl} target="_blank" rel="noreferrer">
            저장소 보기 ↗
          </a>
          <a href="#/admin">관리자</a>
        </nav>
      </header>
      <main key={route}>
        {parts[0] === "admin" ? (
          <Admin id={parts[1]} />
        ) : parts[0] === "result" ? (
          <Result id={parts[1]} />
        ) : (
          <Intake />
        )}
      </main>
      <footer>도면 등록 → 담당자 분석 → 결과 확인</footer>
    </div>
  );
}
function Intake() {
  const [files, setFiles] = useState<File[]>([]),
    [name, setName] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [pending, setPending] = useState<{
      id: string;
      session: string;
    } | null>(null),
    [uploaded, setUploaded] = useState(false);
  async function submit() {
    setBusy(true);
    setError("");
    try {
      let s = pending;
      if (!s) {
        const ds = await descriptors(files);
        s = await request("begin", {
          name: name || files[0].name.replace(/\.pdf$/i, ""),
          note,
          files: ds,
        });
        setPending(s);
      }
      if (!uploaded) {
        await upload(s!.session, files, setMessage);
        setUploaded(true);
      }
      setMessage("원본을 검증하고 요청을 접수하고 있습니다.");
      const done = await request("finish", { session: s!.session });
      location.hash = `/result/${done.id}`;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="eyebrow">도면 검토 요청</p>
      <h1>
        PDF를 넣으면
        <br />
        검토 준비가 끝나요.
      </h1>
      <p className="lead">
        도면과 신청서를 등록해 주세요.
        <br />
        담당자가 자료를 분석한 뒤, 결과 페이지에 의견서를 올립니다.
      </p>
      <section className="card">
        <label className="drop">
          PDF 선택
          <input
            aria-label="접수 PDF 선택"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            disabled={busy || !!pending}
            onChange={(e) => {
              const f = Array.from(e.target.files || []);
              setError("");
              if (
                !f.length ||
                f.length > 10 ||
                f.some(
                  (x) =>
                    !x.name.toLowerCase().endsWith(".pdf") ||
                    x.size > 30 * 1024 * 1024 ||
                    !x.size,
                ) ||
                f.reduce((s, x) => s + x.size, 0) > 100 * 1024 * 1024 ||
                new Set(f.map((x) => x.name)).size !== f.length
              ) {
                setError(
                  "PDF 최대 10개, 파일당 30MB·합계 100MB, 서로 다른 파일명으로 선택하세요.",
                );
                return;
              }
              setFiles(f);
              setName(f[0].name.replace(/\.pdf$/i, ""));
            }}
          />
          <small>최대 10개 · 파일당 30MB · 합계 100MB</small>
        </label>
        {!!files.length && (
          <div className="reveal">
            <ul className="files">
              {files.map((f) => (
                <li key={f.name}>
                  {f.name}
                  <small>{(f.size / 1024 / 1024).toFixed(1)} MB</small>
                </li>
              ))}
            </ul>
            <label>
              도면 이름
              <input
                maxLength={120}
                value={name}
                disabled={busy || !!pending}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              요청 메모 <small>선택</small>
              <textarea
                maxLength={4000}
                value={note}
                disabled={busy || !!pending}
                onChange={(e) => setNote(e.target.value)}
                placeholder="중점적으로 확인할 내용을 적어주세요."
              />
            </label>
            <p className="muted">
              등록한 PDF는 연결된 Google Drive에 저장됩니다. 스캔 도면은
              담당자가 원본을 확인합니다.
            </p>
            <button className="primary" disabled={busy} onClick={submit}>
              {busy
                ? "저장하고 있어요…"
                : uploaded
                  ? "접수 완료 다시 확인"
                  : pending
                    ? "업로드 다시 시도"
                    : "검토 요청하기"}
            </button>
          </div>
        )}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert">{error}</p>}
        {pending && error && (
          <p>
            새로고침 전에 접수번호를 보관하세요:{" "}
            <a href={`#/result/${pending.id}`}>{pending.id}</a>. 업로드 중단 시
            일부 파일이 남을 수 있습니다.
          </p>
        )}
      </section>
      <p className="muted">
        등록 후 발급되는 결과 링크를 보관해 주세요. AI 분석은 담당자가 이
        채팅에서 진행하며, 접수 즉시 자동 분석되지는 않습니다.
      </p>
    </>
  );
}
function Result({ id }: { id?: string }) {
  const [lookup, setLookup] = useState(""),
    [data, setData] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function refresh() {
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      setData(await request("get", { id }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [id]);
  async function pdf() {
    setBusy(true);
    setError("");
    try {
      download(await readAsset(id!, data.pdf), "검토의견서.pdf");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="eyebrow">결과 확인</p>
      <h1>
        {data?.state === "published"
          ? "검토 결과가 도착했어요."
          : "검토 진행 상황을 확인하세요."}
      </h1>
      {!id ? (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            const v = lookup.trim();
            location.hash = `/result/${v.includes("/result/") ? v.split("/result/")[1] : v}`;
          }}
        >
          <label>
            접수번호 또는 결과 링크
            <input
              required
              value={lookup}
              onChange={(e) => setLookup(e.target.value)}
            />
          </label>
          <button className="primary">결과 찾기</button>
        </form>
      ) : (
        <section className="card">
          <p className="pill">{states[data?.state] || "확인 중"}</p>
          <h2>{data?.name}</h2>
          <label>
            결과 링크
            <input
              readOnly
              value={`${location.origin}${location.pathname}#/result/${id}`}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <p className="muted">
            접수번호: {id}
            <br />이 링크를 보관하면 다른 기기에서도 결과를 확인할 수 있습니다.
          </p>
          {data && !data.result && (
            <p>
              {data.state === "needs_material"
                ? "추가 자료가 필요합니다. 담당자에게 확인한 뒤 새 요청에 기존 접수번호를 적어주세요."
                : "담당자가 원본을 확인하고 분석한 뒤 결과를 등록합니다."}
            </p>
          )}
          {data?.notification?.state !== "sent" && data && (
            <p className="muted">
              요청은 접수되었습니다. Slack 알림은 아직 전달되지 않아 관리자
              확인이 필요합니다.
            </p>
          )}
          <button disabled={busy} onClick={refresh}>
            상태 새로고침
          </button>
          {data?.pdf && (
            <button className="primary" disabled={busy} onClick={pdf}>
              결과 PDF 다운로드
            </button>
          )}
        </section>
      )}
      {error && <p role="alert">{error}</p>}
      {data?.result && <Report r={data.result} />}
    </>
  );
}
function Admin({ id }: { id?: string }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [items, setItems] = useState<any[]>([]),
    [cursor, setCursor] = useState<string>(),
    [c, setCase] = useState<CaseRecord | null>(null),
    [slack, setSlack] = useState(false);
  const [pdf, setPdf] = useState<File | null>(null),
    [json, setJson] = useState<File | null>(null),
    [preview, setPreview] = useState<Analysis | null>(null),
    [pdfUrl, setPdfUrl] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    if (!pdf) {
      setPdfUrl("");
      return;
    }
    const u = URL.createObjectURL(pdf);
    setPdfUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [pdf]);
  async function work(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    if (id) setCase(await request("detail", { id }));
    else {
      const r = await request("list");
      setItems(r.files);
      setCursor(r.nextPageToken);
    }
    setSlack((await request("health")).slack);
  }
  useEffect(() => {
    void work(load);
  }, [id]);
  async function openJson(f: File) {
    setJson(null);
    setPreview(null);
    setConfirmed(false);
    if (f.size > 1000000) throw Error("JSON은 1MB 이하로 등록하세요.");
    const r = JSON.parse(await f.text());
    const { validateResult } = await import("./result-validation");
    validateResult(r, c!);
    setJson(f);
    setPreview(r);
  }
  async function publish() {
    if (!c || !pdf || !json || !preview || !confirmed) return;
    await work(async () => {
      const files = [
        new File([pdf], "report.pdf", { type: "application/pdf" }),
        new File([json], "result.json", { type: "application/json" }),
      ];
      const { session } = await request("resultBegin", {
        id: c.id,
        files: await descriptors(files),
      });
      await upload(session, files, setMessage);
      setCase(await request("publish", { id: c.id, session, confirmed: true }));
      setMessage("결과가 공개되었습니다.");
      setConfirmed(false);
    });
  }
  async function fetchFile(f: Asset) {
    await work(async () => download(await readAsset(c!.id, f), f.name));
  }
  return (
    <>
      <p className="eyebrow">관리자</p>
      <h1>{c ? c.name : "검토 요청 관리"}</h1>
      <>
        <div className="toolbar">
          <a href="#/admin">접수 목록</a>
          <a href="#/review">원본 대조·검산 도구</a>
          <button disabled={busy} onClick={() => work(load)}>
            새로고침
          </button>
        </div>
        {!slack && (
          <p className="notice">
            Slack 연결이 필요합니다. 접수는 저장되며, 연결 후 각 요청에서 알림을
            재전송할 수 있습니다.
          </p>
        )}
        {!id ? (
          <section className="card">
            <h2>접수 목록</h2>
            {!items.length ? (
              <p>접수된 자료가 없습니다.</p>
            ) : (
              items.map((x) => (
                <a className="case-link" href={`#/admin/${x.id}`} key={x.id}>
                  {x.name}
                  <small>
                    {new Date(x.createdTime).toLocaleString("ko-KR")}
                  </small>
                </a>
              ))
            )}
            {cursor && (
              <button
                disabled={busy}
                onClick={() =>
                  work(async () => {
                    const r = await request("list", { cursor });
                    setItems([...items, ...r.files]);
                    setCursor(r.nextPageToken);
                  })
                }
              >
                더 보기
              </button>
            )}
          </section>
        ) : (
          c && (
            <>
              <section className="card">
                <span className="pill">{states[c.state]}</span>
                <p>접수번호: {c.id}</p>
                <p>{c.note || "요청 메모 없음"}</p>
                <a href={`#/result/${c.id}`}>결과 페이지 열기 ↗</a>
                <div className="toolbar">
                  <button
                    disabled={busy || c.state === "uploading"}
                    onClick={() =>
                      work(async () =>
                        setCase(
                          await request("state", {
                            id: c.id,
                            state: "analyzing",
                          }),
                        ),
                      )
                    }
                  >
                    분석 시작
                  </button>
                  <button
                    disabled={busy || c.state === "uploading"}
                    onClick={() =>
                      work(async () =>
                        setCase(
                          await request("state", {
                            id: c.id,
                            state: "needs_material",
                          }),
                        ),
                      )
                    }
                  >
                    추가 자료 필요
                  </button>
                </div>
                <p>
                  Slack 알림:{" "}
                  {
                    (
                      {
                        sent: "전송 완료",
                        failed: "전송 실패",
                        pending: "연결 대기",
                        unknown: "전송 상태 확인 필요",
                      } as Record<string, string>
                    )[c.notification.state]
                  }
                </p>
                <button
                  disabled={
                    busy ||
                    c.notification.state === "sent" ||
                    c.state === "uploading"
                  }
                  onClick={() =>
                    work(async () => {
                      await request("notify", { id: c.id });
                      await load();
                    })
                  }
                >
                  Slack 알림 재전송
                </button>
              </section>
              <section className="card">
                <h2>1. ChatGPT에서 분석하기</h2>
                <p>
                  원본 PDF와 분석 요청문을 받아 ChatGPT에 첨부하세요. 분석 후
                  의견서 PDF와 JSON을 아래에 등록합니다.
                </p>
                {c.originals.map((f) => (
                  <button
                    key={f.name}
                    disabled={busy || !f.id}
                    onClick={() => fetchFile(f)}
                  >
                    {f.name} 다운로드
                  </button>
                ))}
                <div className="toolbar">
                  <button
                    onClick={() =>
                      download(
                        new Blob([prompt(c)], {
                          type: "text/plain;charset=utf-8",
                        }),
                        "분석요청문.txt",
                      )
                    }
                  >
                    분석 요청문 다운로드
                  </button>
                  <button
                    onClick={() =>
                      download(
                        new Blob([JSON.stringify(template(c), null, 2)], {
                          type: "application/json",
                        }),
                        "result-template.json",
                      )
                    }
                  >
                    JSON 템플릿 다운로드
                  </button>
                </div>
              </section>
              <section className="card">
                <h2>2. 결과를 확인하고 공개하기</h2>
                <label>
                  결과 PDF
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      setConfirmed(false);
                      setPdf(null);
                      if (
                        f &&
                        f.size <= 30 * 1024 * 1024 &&
                        f.size > 0 &&
                        /\.pdf$/i.test(f.name)
                      )
                        setPdf(f);
                      else setError("결과 PDF는 30MB 이하로 등록하세요.");
                    }}
                  />
                </label>
                <label>
                  결과 JSON
                  <input
                    type="file"
                    accept="application/json,.json"
                    disabled={busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void work(() => openJson(f));
                    }}
                  />
                </label>
                {pdfUrl && <iframe title="결과 PDF 미리보기" src={pdfUrl} />}
                {preview && <Report r={preview} />}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy || !pdf || !preview}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  PDF·JSON 내용과 근거, 법령 최신성을 대조했습니다. 이 결과를
                  공개합니다.
                </label>
                <button
                  className="primary"
                  disabled={busy || !confirmed || !pdf || !json}
                  onClick={publish}
                >
                  검토 결과 공개
                </button>
              </section>
              {!!c.versions.length && (
                <section className="card">
                  <h2>보관된 결과 버전</h2>
                  {c.versions.map((v, i) => (
                    <div key={v.id}>
                      <p>
                        {i + 1}차 ·{" "}
                        {new Date(v.publishedAt).toLocaleString("ko-KR")}
                      </p>
                      <button disabled={busy} onClick={() => fetchFile(v.pdf)}>
                        PDF 다운로드
                      </button>
                      <button disabled={busy} onClick={() => fetchFile(v.json)}>
                        JSON 다운로드
                      </button>
                    </div>
                  ))}
                </section>
              )}
            </>
          )
        )}
      </>
      {busy && <p role="status">{message || "처리 중입니다…"}</p>}
      {!busy && message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
