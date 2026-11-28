import type { Analysis } from "./portal-api";
import { ReportText } from "./ReportText";
export default function Report({ r }: { r: Analysis }) {
  return (
    <section className="analysis">
      <h2>검토 결과</h2>
      {r.requestId && <p className="muted">접수번호: {r.requestId}{r.basisDate ? ` · 적용기준일: ${r.basisDate}` : ""}{r.worksheetRevision ? ` · 검토표 ${r.worksheetRevision}차` : ""}</p>}
      <div className="report-summary">
        <h3>종합 의견</h3>
        <ReportText text={r.summary} />
      </div>
      <p className="muted">
        {r.reviewer} · {r.reviewedAt}
      </p>
      <ul className="report-counts" aria-label="검토 항목 현황">
        {["확인", "보완", "보류", "해당 없음"].map((status) => (
          <li key={status}>
            {status}{" "}
            <strong>
              {r.findings.filter((f) => f.status === status).length}건
            </strong>
          </li>
        ))}
      </ul>
      <h3 className="report-section-title">항목별 검토</h3>
      <ol className="report-findings">
        {r.findings.map((f, i) => (
          <li key={i}>
            <article>
              <div className="finding-heading">
                <h4>
                  <span className="finding-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {f.title}
                </h4>
                <span
                  className={`pill status-${f.status === "보완" ? "action" : f.status === "확인" ? "checked" : "hold"}`}
                >
                  {f.status}
                </span>
              </div>
              <ReportText text={f.detail} />
              {!!f.sources.length && (
                <div className="report-sources">
                  <h5>도면 근거</h5>
                  {f.sources.map((s, j) => (
                    <blockquote key={j}>
                      <p className="source-location">
                        <strong>{s.file}</strong>
                        {" · "}
                        <span>PDF {s.page}페이지</span>
                      </p>
                      <ReportText text={s.quote} />
                    </blockquote>
                  ))}
                </div>
              )}
            </article>
          </li>
        ))}
      </ol>
      {!!r.holds.length && (
        <div className="report-holds">
          <h3>추가 확인·보류</h3>
          <ul>
            {r.holds.map((h, i) => (
              <li key={i}>
                <ReportText text={h} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="report-law">
        <h3>법령 확인 기록</h3>
        <p className="muted">
          <strong>{r.lawConfirmed ? "확인 완료" : "확인 필요"}</strong> ·
          확인일: {r.lawCheckedAt || "미확인"}
        </p>
        <ReportText text={r.lawNote || "확인 기록 없음"} />
      </div>
    </section>
  );
}
