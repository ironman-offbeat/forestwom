import { useEffect, useState } from "react";
import App from "./App";
import { request, type CaseRecord } from "./portal-api";

export default function CaseReview({ id }: { id: string }) {
  const [record, setRecord] = useState<CaseRecord | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    request<CaseRecord>("detail", { id })
      .then((c) => {
        if (c.state === "uploading")
          throw Error("접수가 완료된 후 검토할 수 있습니다.");
        if (!cancelled) setRecord(c);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return (
    <>
      <a className="portal-return" href={`#/admin/${id}`}>
        접수 상세로 돌아가기
      </a>
      {error ? (
        <p role="alert">{error}</p>
      ) : record ? (
        <App linkedCase={record} />
      ) : (
        <p role="status">접수 기록을 불러오는 중입니다…</p>
      )}
    </>
  );
}
