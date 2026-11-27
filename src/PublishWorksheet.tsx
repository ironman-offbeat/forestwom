import { useEffect, useRef, useState } from "react";
import Report from "./Report";
import {
  descriptors,
  request,
  upload,
  download,
  type Analysis,
} from "./portal-api";
export default function PublishWorksheet({
  analysis,
  revision,
  blocked,
}: {
  analysis: Analysis;
  revision: number;
  blocked: boolean;
}) {
  const preview = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<Blob | null>(null),
    [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    if (!pdf) return;
    const value = URL.createObjectURL(pdf);
    setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [pdf]);
  async function makePDF() {
    setBusy(true);
    setError("");
    try {
      const { reportPDF } = await import("./report-pdf");
      setPdf(await reportPDF(preview.current!));
      setConfirmed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!pdf || !confirmed || blocked) return;
    setBusy(true);
    setError("");
    try {
      const files = [
        new File([pdf], "report.pdf", { type: "application/pdf" }),
        new File([JSON.stringify(analysis, null, 2)], "result.json", {
          type: "application/json",
        }),
      ];
      const { session } = await request("resultBegin", {
        id: analysis.requestId,
        reviewRevision: revision,
        files: await descriptors(files),
      });
      await upload(session, files, setMessage);
      await request("publish", {
        id: analysis.requestId,
        session,
        confirmed: true,
      });
      setMessage("검토 결과가 공개되었습니다.");
      setConfirmed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel no-print">
      <h2>공개 결과 미리보기</h2>
      <p>
        아래 확정 데이터에서 화면·JSON·PDF를 함께 만듭니다. 저장 후 내용을
        변경하면 PDF와 공개 확인을 다시 준비해야 합니다.
      </p>
      <div ref={preview}>
        <Report r={analysis} />
      </div>
      <button disabled={busy || blocked} onClick={() => void makePDF()}>
        미리보기 PDF 생성
      </button>
      {pdf && (
        <>
          <iframe
            title="생성된 의견서 PDF"
            src={url}
            style={{ width: "100%", height: 500, border: 0 }}
          />
          <button onClick={() => download(pdf, "검토의견서.pdf")}>
            생성 PDF 다운로드
          </button>
          <button
            onClick={() =>
              download(
                new Blob([JSON.stringify(analysis, null, 2)], {
                  type: "application/json",
                }),
                "result.json",
              )
            }
          >
            생성 JSON 다운로드
          </button>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || blocked}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            도면 근거·적용 법령·PDF와 화면 내용을 대조했고 이 결과를 공개합니다.
          </label>
          <button
            disabled={busy || blocked || !confirmed}
            onClick={() => void publish()}
          >
            검토표 결과 공개
          </button>
        </>
      )}
      {blocked && (
        <p>검토표를 먼저 저장하고 진행 중인 보완 요청을 처리하세요.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
