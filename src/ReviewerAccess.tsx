import { useEffect, useState, type ReactNode } from "react";
import { request } from "./portal-api";
export default function ReviewerAccess({
  children,
  token,
  id,
}: {
  children?: ReactNode;
  token?: string;
  id?: string;
}) {
  const [allowed, setAllowed] = useState(false),
    [error, setError] = useState(""),
    [waiting, setWaiting] = useState(true);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (token) {
          await request("login", { token });
          history.replaceState(null, "", `#/admin/${id || ""}`);
          location.reload();
          return;
        }
        const session = await request("session");
        if (active) setAllowed(session.admin);
      } catch (e) {
        if (active) setError((e as Error).message);
      } finally {
        if (active) setWaiting(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [token, id]);
  if (waiting) return <p role="status">검토자 권한을 확인하는 중입니다…</p>;
  if (!allowed)
    return (
      <section className="card">
        <h1>검토자 전용 화면</h1>
        <p>
          최근 7일 이내 접수 Slack 알림의 검토자 링크로 여세요. 접속 권한은
          12시간 유지됩니다. 링크를 다른 사람에게 공유하지 마세요.
        </p>
        {error && <p role="alert">{error}</p>}
        <a href="#/">접수 화면으로</a>
      </section>
    );
  return (
    <>
      <button
        onClick={async () => {
          await request("logout");
          location.reload();
        }}
      >
        검토자 접속 종료
      </button>
      {children}
    </>
  );
}
