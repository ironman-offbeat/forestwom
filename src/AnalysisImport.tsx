import { useEffect, useState } from "react";
import PublishWorksheet from "./PublishWorksheet";
import {
  download,
  prompt,
  readAsset,
  request,
  type CaseRecord,
  type Analysis,
} from "./portal-api";
import { parseAnalysis, analysisBasis } from "./analysis-import";
import { draftKey, readDraft, writeDraft } from "./local-draft";
export default function AnalysisImport({ record }: { record: CaseRecord }) {
  const [raw, setRaw] = useState(""),
    [analysis, setAnalysis] = useState<Analysis | null>(null),
    [reviewer, setReviewer] = useState(""),
    [law, setLaw] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [recovery, setRecovery] = useState<string | null>(null),
    [ready, setReady] = useState(false);
  const basis = analysisBasis(record),
    key = draftKey(record.id, "analysis");
  useEffect(() => {
    try {
      setRecovery(readDraft(key, basis)?.content || null);
    } catch {
      setMessage("이 브라우저에서는 임시 저장을 읽을 수 없습니다.");
    }
    setReady(true);
  }, [key, basis]);
  useEffect(() => {
    if (!ready || recovery !== null || !raw) return;
    try {
      writeDraft(key, basis, raw);
      setMessage(
        "입력 내용이 이 기기에 임시 저장되었습니다. 보관 기간은 7일이며 공개되지 않습니다.",
      );
    } catch {
      setMessage("임시 저장 공간이 부족합니다. JSON 파일을 따로 보관하세요.");
    }
  }, [raw, key, basis, ready, recovery]);
  async function bundle() {
    setBusy(true);
    setError("");
    try {
      const { zipSync, strToU8 } = await import("fflate");
      const files: Record<string, Uint8Array> = {
        "분석요청문.txt": strToU8(prompt(record)),
      };
      for (const f of record.originals) {
        if (files[f.name])
          throw Error("동일한 파일명이 있습니다. 원본 파일명을 확인하세요.");
        files[f.name] = new Uint8Array(
          await (await readAsset(record.id, f)).arrayBuffer(),
        );
      }
      const bytes = zipSync(files, { level: 0 });
      download(
        new Blob([bytes as BlobPart], { type: "application/zip" }),
        "ChatGPT-분석자료.zip",
      );
      setMessage(
        "ZIP을 풀어 원본 PDF 전부와 분석요청문을 ChatGPT에 첨부하세요.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function importResult() {
    setBusy(true);
    setError("");
    setAnalysis(null);
    setLaw(false);
    try {
      const latest = await request<CaseRecord>("detail", { id: record.id });
      if (analysisBasis(latest) !== basis)
        throw Error(
          "원본 또는 검토표가 변경되었습니다. 페이지를 새로 열고 최신 자료로 분석하세요.",
        );
      setAnalysis(parseAnalysis(raw, latest));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const result = analysis
    ? { ...analysis, reviewer: reviewer.trim(), lawConfirmed: law }
    : null;
  return (
    <section className="card">
      <h2>ChatGPT 분석 결과 가져오기</h2>
      <p>
        ① 분석 자료 받기 → ZIP을 풀어 ChatGPT에 첨부 → ② result.json 가져오기 →
        ③ 근거 확인 후 PDF 생성·공개
      </p>
      <button disabled={busy} onClick={() => void bundle()}>
        분석 자료 한 번에 받기
      </button>
      <p>
        ChatGPT에는 JSON 결과만 요청합니다. 화면과 PDF는 앱에서 같은 데이터로
        만듭니다.
      </p>
      {recovery !== null && (
        <div role="status">
          <p>이 기기에 저장된 분석 입력이 있습니다.</p>
          <button
            onClick={() => {
              setRaw(recovery);
              setRecovery(null);
            }}
          >
            임시 입력 복원
          </button>
          <button
            onClick={() => {
              localStorage.removeItem(key);
              setRecovery(null);
            }}
          >
            임시 입력 버리기
          </button>
        </div>
      )}
      <label>
        ChatGPT 결과 JSON 파일
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 1000000) {
              setError("JSON은 1MB 이하로 가져오세요.");
              return;
            }
            setRaw(await f.text());
            setAnalysis(null);
            setLaw(false);
          }}
        />
      </label>
      <label>
        또는 JSON 붙여넣기
        <textarea
          rows={10}
          value={raw}
          disabled={busy}
          onChange={(e) => {
            setRaw(e.target.value);
            setAnalysis(null);
            setLaw(false);
          }}
        />
      </label>
      <button
        disabled={busy || !raw.trim()}
        onClick={() => void importResult()}
      >
        분석 결과 검증·가져오기
      </button>
      {analysis && (
        <>
          <label>
            최종 검토자
            <input
              value={reviewer}
              onChange={(e) => setReviewer(e.target.value)}
            />
          </label>
          <p>
            법령 확인일: {analysis.lawCheckedAt || "미입력"} · 확인 기록:{" "}
            {analysis.lawNote || "미입력"}
          </p>
          <label>
            <input
              type="checkbox"
              checked={law}
              onChange={(e) => setLaw(e.target.checked)}
            />
            법령 원문·적용 시점·확인 기록을 직접 대조했습니다.
          </label>
          <p>
            수정할 항목은 위 JSON에서 고친 후 다시 가져오세요. ChatGPT의 법령
            확인 표시는 자동 승인하지 않습니다.
          </p>
        </>
      )}
      {result && (
        <PublishWorksheet
          key={JSON.stringify(result)}
          analysis={result}
          revision={record.review?.revision || 0}
          sourceRevision={record.sourceRevision || 0}
          blocked={
            !reviewer.trim() ||
            !law ||
            !!record.materialRequests?.some((r) => r.state === "open")
          }
          onPublished={() => {
            try {
              localStorage.removeItem(key);
            } catch {}
            setMessage("공개 완료. 이 기기의 임시 입력을 삭제했습니다.");
          }}
        />
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
