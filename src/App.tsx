import { useEffect, useMemo, useRef, useState } from "react";
import {
  emptyEntries,
  emptyGates,
  evaluate,
  extract,
  fields,
  parseNumber,
  RULE_VERSION,
  todayKorea,
  type Entries,
  type Entry,
  type Gates,
  type Key,
} from "./engine";
import { readPDF, type Document } from "./pdf";
import type { RenderTask } from "pdfjs-dist";

const sources = [
  [
    "건축법 제42조",
    "https://www.law.go.kr/법령/건축법/제42조",
    "의무 발생·위임 / 2026-11-12 시행 본문 확인",
  ],
  [
    "건축법 시행령 제27조",
    "https://www.law.go.kr/법령/건축법시행령/제27조",
    "면제·특례·옥상 산입 / 개별 검토",
  ],
  [
    "성남시 건축 조례 제19·20조",
    "https://www.law.go.kr/ordinInfoP.do?ordinSeq=2019919",
    "확인본: 2025-03-10 시행, 제4204호",
  ],
  [
    "국토교통부 조경기준 제4·5조",
    "https://www.law.go.kr/행정규칙/조경기준/",
    "확인본: 2022-01-07 시행, 제2021-1778호",
  ],
];
const manual = [
  "수목 수량·수종·규격 및 산정 기준",
  "배치·유효폭·토심·급배수·시설물",
  "옥상·벽면녹화·인공지반 산입",
  "공개공지 의무·중복 산입·완화",
  "심의 대상·지구단위계획·특례·경과조치",
];
const fmt = (n: number) =>
  n.toLocaleString("ko-KR", { maximumFractionDigits: 6 });
export default function App() {
  const [consent, setConsent] = useState(false),
    [docs, setDocs] = useState<Document[]>([]);
  const [entries, setEntries] = useState<Entries>(emptyEntries),
    [gates, setGates] = useState<Gates>(emptyGates);
  const [selected, setSelected] = useState(""),
    [zoom, setZoom] = useState(1),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [renderError, setRenderError] = useState("");
  const [failedFiles, setFailedFiles] = useState<string[]>([]);
  const [reviewer, setReviewer] = useState(""),
    [approved, setApproved] = useState("");
  const [remarks, setRemarks] = useState(""),
    [history, setHistory] = useState<string[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null),
    docsRef = useRef(docs);
  docsRef.current = docs;
  useEffect(
    () => () => {
      docsRef.current.forEach((d) => void d.pdf.loadingTask.destroy());
    },
    [],
  );
  const pages = useMemo(() => docs.flatMap((d) => d.pages), [docs]);
  const candidates = useMemo(() => extract(pages), [pages]);
  const current = pages.find((p) => p.id === selected);
  const computed = evaluate(entries, pages, gates);
  const result = failedFiles.length
    ? {
        ...computed,
        checks: [],
        holds: [
          ...computed.holds,
          ...failedFiles.map(
            (f) =>
              `읽기 실패 자료: ${f} — 검토 초기화 후 정상 자료로 다시 등록하세요.`,
          ),
        ],
      }
    : computed;
  const confirmed = fields.filter(([k]) => entries[k].confirmed).length;
  useEffect(() => {
    let cancelled = false,
      task: RenderTask | undefined;
    setRenderError("");
    const doc = docs.find((d) => d.pages.some((p) => p.id === selected));
    const pg = doc?.pages.find((p) => p.id === selected);
    const element = canvas.current;
    if (!doc || !pg || !element) return;
    (async () => {
      try {
        const page = await doc.pdf.getPage(pg.number);
        if (cancelled) return;
        const original = page.getViewport({ scale: 1 });
        const scale = Math.min(1.4, 1000 / original.width) * zoom;
        const viewport = page.getViewport({ scale });
        element.width = Math.ceil(viewport.width);
        element.height = Math.ceil(viewport.height);
        task = page.render({ canvas: element, viewport });
        await task.promise;
      } catch (e) {
        if (!cancelled)
          setRenderError(
            `원본 렌더링 실패: ${e instanceof Error ? e.message : "확인 필요"}`,
          );
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [docs, selected, zoom]);
  function change(k: Key, patch: Partial<Entry>) {
    setApproved("");
    setEntries((prev) => ({
      ...prev,
      [k]: { ...prev[k], ...patch, confirmed: false },
    }));
  }
  function gate(patch: Partial<Gates>) {
    setGates((prev) => ({ ...prev, ...patch }));
    setApproved("");
  }
  function confirm(k: Key) {
    const e = entries[k];
    if (
      parseNumber(e.value) === null ||
      !e.note.trim() ||
      !pages.some((p) => p.id === e.pageId && !p.held)
    )
      return;
    setEntries((prev) => ({ ...prev, [k]: { ...prev[k], confirmed: true } }));
    setApproved("");
    const p = pages.find((p) => p.id === e.pageId)!;
    setHistory((h) => [
      ...h,
      `${new Date().toLocaleTimeString("ko-KR")} ${fields.find((f) => f[0] === k)![1]} ${e.value}㎡ 확정 · ${p.file} p.${p.number} · ${e.note}`,
    ]);
  }
  async function addFiles(files: File[]) {
    if (!consent || busy) return;
    if (
      docs.length + files.length > 10 ||
      files.reduce((n, f) => n + f.size, 0) > 100 * 1024 * 1024
    ) {
      setError("최대 10개 파일, 한 번에 총 100MB 이하로 등록하세요.");
      return;
    }
    setBusy(true);
    setError("");
    setApproved("");
    // A newly added drawing can contradict any previous confirmation.
    setEntries(
      (prev) =>
        Object.fromEntries(
          Object.entries(prev).map(([k, e]) => [k, { ...e, confirmed: false }]),
        ) as Entries,
    );
    setGates((prev) => ({ ...prev, scope: false, conflicts: false }));
    const added: Document[] = [],
      failures: string[] = [];
    for (const f of files) {
      try {
        added.push(await readPDF(f));
      } catch (e) {
        failures.push(
          `${f.name}: ${e instanceof Error ? e.message : "읽기 실패"}`,
        );
      }
    }
    setDocs((prev) => [...prev, ...added]);
    if (added[0]) setSelected(added[0].pages[0].id);
    setFailedFiles((prev) => [...prev, ...failures]);
    setError(failures.join("\n"));
    setBusy(false);
  }
  async function sample(name: string) {
    if (!consent || busy) return;
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}samples/${name}.pdf`,
      );
      if (!response.ok) throw new Error("가상 자료를 불러오지 못했습니다.");
      await addFiles([
        new File([await response.arrayBuffer()], `${name}.pdf`, {
          type: "application/pdf",
        }),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패");
    }
  }
  function reset() {
    docs.forEach((d) => void d.pdf.loadingTask.destroy());
    setDocs([]);
    setEntries(emptyEntries());
    setGates(emptyGates());
    setSelected("");
    setHistory([]);
    setApproved("");
    setReviewer("");
    setRemarks("");
    setError("");
    setFailedFiles([]);
  }
  return (
    <>
      <header className="topbar">
        <a className="brand" href="#">
          F<span>Forestwom</span>
        </a>
        <span className="tag">성남시 · 조경 검토 실험실</span>
        <span className="privacy">브라우저 내 처리 · 자동 저장 없음</span>
      </header>
      <main>
        <section className="intro no-print">
          <div>
            <p className="eyebrow">LANDSCAPE REVIEW / EXPERIMENTAL</p>
            <h1>
              도면에서 근거까지,
              <br />
              확인하며 검토합니다.
            </h1>
            <p>
              PDF 원본과 수치를 대조하고, 확정한 값으로 검산하세요.
              <br />
              모든 결과는 비식별 실험용 초안입니다.
            </p>
          </div>
          <div className="summary">
            <strong>{pages.length.toString().padStart(2, "0")}</strong>
            <span>등록 페이지</span>
            <strong>{confirmed} / 7</strong>
            <span>원본 대조 확정</span>
          </div>
        </section>
        <div className="notice no-print">
          <strong>실자료 사용 금지</strong> 기관 보안 정책 확인 전에는
          가상·비식별 자료만 사용하세요. 파일은 이 탭의 메모리에서 처리되며
          새로고침하면 사라집니다.
        </div>
        <nav className="steps no-print">
          <a href="#input">01 자료 등록</a>
          <a href="#verify">02 원본 대조</a>
          <a href="#rules">03 적용 기준</a>
          <a href="#report">04 검토 의견서</a>
        </nav>
        <section id="input" className="panel no-print">
          <div className="section-title">
            <h2>자료 등록</h2>
            <button
              className="quiet"
              disabled={busy || (!docs.length && !failedFiles.length)}
              onClick={reset}
            >
              검토 초기화
            </button>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            />{" "}
            실제 민원자료가 아닌 가상·비식별 자료임을 확인했습니다.
          </label>
          <div className="upload">
            <div>
              <strong>신청서와 PDF 도면을 선택하세요</strong>
              <p>최대 10개 · 파일당 30MB / 100페이지 · 스캔본은 판독 보류</p>
            </div>
            <label className={`button ${!consent || busy ? "disabled" : ""}`}>
              PDF 선택
              <input
                aria-label="PDF 파일 선택"
                type="file"
                accept=".pdf,application/pdf"
                multiple
                disabled={!consent || busy}
                onChange={(e) => {
                  void addFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <div className="samples">
            <span>가상 PDF로 시작</span>
            {[
              ["normal", "정상 수치"],
              ["korean", "한글 도면"],
              ["deficient", "기준 미달"],
              ["conflict", "도면 불일치"],
              ["scan", "스캔본"],
              ["mixed", "혼합 문서"],
            ].map(([n, t]) => (
              <button
                key={n}
                disabled={!consent || busy}
                onClick={() => void sample(n)}
              >
                {t}
              </button>
            ))}
          </div>
          <p role="status">
            {busy
              ? "PDF를 브라우저에서 읽는 중입니다…"
              : docs.length
                ? `${docs.length}개 파일 · ${pages.length}페이지 등록됨. 페이지 분류는 키워드 기반 참고값입니다.`
                : "등록된 자료가 없습니다."}
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </section>
        <section id="verify" className="no-print">
          <div className="section-title">
            <h2>원본 대조 및 수치 확정</h2>
            <span>자동 추출값은 검수 전까지 계산하지 않습니다.</span>
          </div>
          <div className="review-grid">
            <div className="panel viewer">
              <div className="viewer-controls">
                <label>
                  출처 페이지
                  <select
                    aria-label="원본 페이지"
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value="">페이지 선택</option>
                    {pages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.file} · p.{p.number} ·{" "}
                        {p.held ? "판독 보류" : p.kind}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  확대
                  <select
                    aria-label="확대"
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                  >
                    <option value={1}>100%</option>
                    <option value={1.5}>150%</option>
                    <option value={2}>200%</option>
                  </select>
                </label>
              </div>
              <div className="canvas-wrap">
                {current ? (
                  <canvas ref={canvas} aria-label="PDF 원본 페이지" />
                ) : (
                  <div className="empty">
                    <span>PDF</span>
                    <p>
                      자료를 등록하면
                      <br />
                      원본 도면이 여기에 표시됩니다.
                    </p>
                  </div>
                )}
              </div>
              {renderError && (
                <p role="alert" className="error">
                  {renderError}
                </p>
              )}
              {current && (
                <>
                  <p className={current.held ? "error" : "muted"}>
                    {current.file} · p.{current.number}{" "}
                    {current.held
                      ? "— 텍스트 부족: 스캔·도형 페이지 의심. 자동 판정 보류."
                      : "— 문자 누락·읽기 순서·범례를 원본과 대조하세요."}
                  </p>
                  <details>
                    <summary>페이지 추출 텍스트 보기</summary>
                    <pre>{current.text || "(추출 가능한 텍스트 없음)"}</pre>
                  </details>
                </>
              )}
            </div>
            <div className="field-list">
              {fields.map(([k, label]) => {
                const e = entries[k],
                  list = candidates[k],
                  conflict =
                    new Set(list.map((c) => parseNumber(c.value))).size > 1;
                return (
                  <article className="panel field" key={k}>
                    <div className="field-heading">
                      <h3>{label}</h3>
                      <span className={e.confirmed ? "badge good" : "badge"}>
                        {e.confirmed ? "확정" : "검수 필요"}
                      </span>
                    </div>
                    {conflict && (
                      <p className="error">
                        도면 간 수치 불일치 — 모든 후보를 대조하고 채택 사유를
                        기록하세요.
                      </p>
                    )}
                    <label>
                      추출 후보
                      <select
                        aria-label={`${label} 후보`}
                        defaultValue=""
                        key={`${k}-${pages.length}`}
                        onChange={(event) => {
                          const c = list[Number(event.target.value)];
                          if (c) {
                            change(k, {
                              value: c.value,
                              pageId: c.pageId,
                              note: "",
                            });
                            setSelected(c.pageId);
                          }
                        }}
                      >
                        <option value="">
                          {list.length
                            ? `${list.length}개 후보 · 선택 후 검수`
                            : "후보 없음 · 원본 확인 후 직접 입력"}
                        </option>
                        {list.map((c, i) => {
                          const p = pages.find((p) => p.id === c.pageId)!;
                          return (
                            <option key={i} value={i}>
                              {c.value}㎡ · {p.file} p.{p.number}
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <div className="two-cols">
                      <label>
                        검수값 (㎡)
                        <input
                          aria-label={`${label} 검수값`}
                          inputMode="decimal"
                          value={e.value}
                          onChange={(event) =>
                            change(k, { value: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        근거 페이지
                        <select
                          aria-label={`${label} 근거 페이지`}
                          value={e.pageId}
                          onChange={(event) => {
                            change(k, { pageId: event.target.value });
                            setSelected(event.target.value);
                          }}
                        >
                          <option value="">선택</option>
                          {pages.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.file} p.{p.number}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label>
                      원본 대조·수정·채택 사유
                      <input
                        aria-label={`${label} 검수 사유`}
                        placeholder="표 위치, 원문 표기, 수정 사유 등"
                        value={e.note}
                        onChange={(event) =>
                          change(k, { note: event.target.value })
                        }
                      />
                    </label>
                    <div className="field-actions">
                      <button
                        className="quiet"
                        disabled={!e.pageId}
                        onClick={() => setSelected(e.pageId)}
                      >
                        근거 페이지 보기
                      </button>
                      <button
                        disabled={
                          busy ||
                          e.confirmed ||
                          parseNumber(e.value) === null ||
                          !e.note.trim() ||
                          !pages.some((p) => p.id === e.pageId && !p.held) ||
                          !!renderError
                        }
                        onClick={() => confirm(k)}
                      >
                        원본 대조 확정
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>
        <section id="rules" className="panel no-print">
          <h2>적용 기준 및 최신성 확인</h2>
          <p>
            수록 규칙은 제한된 실험용입니다. 법령을 자동 갱신하지 않습니다.
            원문·부칙·사건 적용시점을 직접 확인하세요.
          </p>
          <div className="source-grid">
            {sources.map(([title, url, note]) => (
              <a
                className="source"
                href={url}
                target="_blank"
                rel="noreferrer"
                key={url}
              >
                <strong>{title} ↗</strong>
                <span>{note}</span>
              </a>
            ))}
          </div>
          <div className="notice">
            <strong>상충·미확인 기록</strong>
            <ul>
              <li>
                기존 프로젝트 자료·정오표: 미확보. 실무 적용 근거로 사용할 수
                없습니다.
              </li>
              <li>
                구 조례의 식재 60% 등 삭제 조항과 현행 확인본을 구분합니다.
                제20조 제2·3·5·6호는 2025-03-10 삭제 표기입니다.
              </li>
              <li>
                옥상 2/3 산입과 조례상 특정 공간 1/2 산입은 적용 대상이
                다릅니다. 혼용하지 않고 이번 자동 계산에서 제외합니다.
              </li>
            </ul>
          </div>
          <div className="two-cols">
            <label>
              사건 적용기준일
              <input
                aria-label="사건 적용기준일"
                type="date"
                value={gates.basisDate}
                onChange={(e) => gate({ basisDate: e.target.value })}
              />
            </label>
            <label>
              법령 원문 확인일
              <input
                aria-label="법령 원문 확인일"
                type="date"
                value={gates.lawDate}
                max={todayKorea()}
                onChange={(e) => gate({ lawDate: e.target.value })}
              />
            </label>
          </div>
          <label>
            법령 확인 기록
            <textarea
              aria-label="법령 확인 기록"
              placeholder="확인한 시행일·조문·부칙·면제/특례·용도지역·건축물 용도 및 적용 사유"
              value={gates.lawNote}
              onChange={(e) => gate({ lawNote: e.target.value })}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={gates.scope}
              onChange={(e) => gate({ scope: e.target.checked })}
            />{" "}
            대지 300㎡ 이상 일반 건축물이며, 공장·녹지지역·면제·특례·별도
            사업계획·지구단위계획·특수공간 산입에 해당하지 않음을 검토했습니다.
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={gates.law}
              onChange={(e) => gate({ law: e.target.checked })}
            />{" "}
            사건 적용일의 법령 원문·부칙 및 이후 개정 여부를 대조했습니다. (확인
            기록 유효기간 30일은 앱 정책)
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={gates.conflicts}
              onChange={(e) => gate({ conflicts: e.target.checked })}
            />{" "}
            상충 규칙을 검토했고, 기존 자료·정오표 미확보 상태에서는 비식별
            실험만 진행함을 확인합니다.
          </label>
        </section>
        <section id="report" className="panel report">
          <div className="section-title">
            <div>
              <p className="eyebrow">REVIEW MEMO · {RULE_VERSION}</p>
              <h2>건축협의 조경 검토 의견서</h2>
            </div>
            <button className="no-print" onClick={() => window.print()}>
              초안 인쇄 / PDF 저장
            </button>
          </div>
          <p className="report-status">
            {result.holds.length
              ? "검토 보류"
              : result.checks.some((c) => !c.pass)
                ? "계산 범위 내 기준 미달"
                : "계산 범위 내 수치 충족"}{" "}
            · {approved ? "담당자 검토 기록 있음" : "담당자 검토 전"}
          </p>
          <p>
            <strong>
              비식별 실험용 초안 — 법적 적합 판정·최종 협의 회신이 아닙니다.
            </strong>{" "}
            기존 자료·정오표 미확보, 수목·배치·공개공지 등 수동 검토 항목이 남아
            있습니다.
          </p>
          <h3>1. 제출자료 판독 현황</h3>
          {pages.length ? (
            <ul>
              {pages.map((p) => (
                <li key={p.id}>
                  {p.file} · p.{p.number} · {p.kind} ·{" "}
                  {p.held ? "판독 보류" : "텍스트 추출 / 원본 대조 필요"}
                </li>
              ))}
            </ul>
          ) : (
            <p>미등록</p>
          )}
          <h3>2. 핵심 수치 및 근거</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>항목</th>
                  <th>검수값 (㎡)</th>
                  <th>원본 근거·검수 사유</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {fields.map(([k, label]) => {
                  const e = entries[k],
                    p = pages.find((p) => p.id === e.pageId);
                  return (
                    <tr key={k}>
                      <th>{label}</th>
                      <td>{e.value || "—"}</td>
                      <td>
                        {p ? `${p.file} p.${p.number}` : "근거 없음"}
                        <br />
                        {e.note}
                        <small>
                          {candidates[k]
                            .map((c) => {
                              const cp = pages.find((p) => p.id === c.pageId)!;
                              return `${cp.file} p.${cp.number}: ${c.excerpt}`;
                            })
                            .join(" / ")}
                        </small>
                      </td>
                      <td>{e.confirmed ? "확정" : "미확정"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <h3>3. 조경의무 및 면적 검산</h3>
          {result.checks.length ? (
            <table>
              <thead>
                <tr>
                  <th>검토</th>
                  <th>산식 / 필요면적</th>
                  <th>계획</th>
                  <th>결과</th>
                </tr>
              </thead>
              <tbody>
                {result.checks.map((c) => (
                  <tr key={c.name}>
                    <th>
                      {c.name}
                      <small>{c.source}</small>
                    </th>
                    <td>
                      {c.formula}
                      <br />
                      {fmt(c.required)}㎡
                    </td>
                    <td>{fmt(c.actual)}㎡</td>
                    <td className={c.pass ? "pass" : "error"}>
                      {c.pass ? "수치 충족" : "기준 미달"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>
              확인 단계가 완료되지 않아 검산하지 않았습니다. 면제 또는 의무
              없음으로 판단하지 않습니다.
            </p>
          )}
          <h3>4. 판독 불가·보완 요청</h3>
          <ul>
            {result.holds.map((h) => (
              <li key={h}>{h}</li>
            ))}
            {result.checks
              .filter((c) => !c.pass)
              .map((c) => (
                <li key={c.name}>
                  {c.name}: {fmt(c.required - c.actual)}㎡ 부족. 원본 산출표
                  확인 및 보완 필요.
                </li>
              ))}
            {manual.map((m) => (
              <li key={m}>{m}: 자동 판정 제외 · 담당자 검토 필요</li>
            ))}
          </ul>
          <h3>5. 적용 근거·담당자 검토</h3>
          <p>
            적용기준일: {gates.basisDate || "미확인"} / 원문 확인일:{" "}
            {gates.lawDate || "미확인"}
          </p>
          <p className="preserve">{gates.lawNote || "법령 확인 기록 없음"}</p>
          <ul>
            {sources.map(([title, url, note]) => (
              <li key={url}>
                <a href={url} target="_blank" rel="noreferrer">
                  {title}
                </a>{" "}
                — {note}
              </li>
            ))}
          </ul>
          <label className="no-print">
            담당자 검토 메모
            <textarea
              aria-label="담당자 검토 메모"
              value={remarks}
              onChange={(e) => {
                setRemarks(e.target.value);
                setApproved("");
              }}
              placeholder="보완 요청과 수동 검토 항목을 기록하세요."
            />
          </label>
          <p className="preserve">{remarks}</p>
          <div className="approval no-print">
            <label>
              검토자 (테스트용 별칭)
              <input
                aria-label="검토자"
                value={reviewer}
                onChange={(e) => {
                  setReviewer(e.target.value);
                  setApproved("");
                }}
              />
            </label>
            <button
              disabled={
                busy ||
                !!result.holds.length ||
                !reviewer.trim() ||
                !remarks.trim()
              }
              onClick={() =>
                setApproved(
                  `${reviewer} · ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`,
                )
              }
            >
              담당자 초안 검토 기록
            </button>
          </div>
          <p>
            <strong>
              {approved
                ? `검토 기록: ${approved}`
                : "담당자 승인 게이트: 미완료"}
            </strong>
          </p>
          <h3>6. 수치 확정 이력</h3>
          {history.length ? (
            <ol>
              {history.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ol>
          ) : (
            <p>확정 기록 없음</p>
          )}
        </section>
        <footer>
          Forestwom · 가상 자료 전용 / 자료·검토값은 저장되지 않습니다.{" "}
          <span>실무 전환에는 기관 보안 검토와 규칙 검증이 필요합니다.</span>
        </footer>
      </main>
    </>
  );
}
