import { itemStatuses, type ReviewItem } from "../shared/review-items.mjs";
import type { Worksheet } from "./case-review";
export default function ReviewItems({
  items,
  documents,
  onChange,
  canDecide,
}: {
  items: ReviewItem[];
  documents: Worksheet["documents"];
  onChange: (items: ReviewItem[]) => void;
  canDecide: boolean;
}) {
  function update(index: number, patch: Partial<ReviewItem>, reset = true) {
    onChange(
      items.map((item, i) =>
        i === index
          ? {
              ...item,
              ...patch,
              ...(reset ? { status: "판단 보류" as const } : {}),
            }
          : item,
      ),
    );
  }
  return (
    <section className="panel no-print">
      <h2>항목별 법령·판정</h2>
      <p>
        원본 확인 상태와 법규 판정은 별도로 기록합니다. 변경한 항목은 판단
        보류로 돌아갑니다. 지원하지 않는 기준은 수동 검토 사유를 적어 주세요.
      </p>
      {items.map((item, index) => (
        <article
          className="case-fact"
          key={item.id}
          aria-label={`검토 항목 ${index + 1}`}
        >
          <label>
            항목 제목
            <input
              maxLength={300}
              value={item.title}
              onChange={(e) => update(index, { title: e.target.value })}
            />
          </label>
          <div className="case-info-grid">
            {(
              [
                ["name", "법령명"],
                ["article", "조·항·호"],
                ["effectiveAt", "시행일"],
                ["checkedAt", "원문 확인일"],
                ["url", "공식 원문 링크"],
                ["reason", "사건 적용·제외 사유"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  maxLength={2000}
                  type={key.endsWith("At") ? "date" : "text"}
                  value={item.law[key]}
                  onChange={(e) =>
                    update(index, {
                      law: { ...item.law, [key]: e.target.value },
                    })
                  }
                />
              </label>
            ))}
          </div>
          <label>
            판정 근거·계산 설명
            <textarea
              maxLength={5000}
              value={item.detail}
              onChange={(e) => update(index, { detail: e.target.value })}
            />
          </label>
          {item.sources.map((source, j) => (
            <div className="case-fact" key={j}>
              <label>
                근거 파일
                <select
                  aria-label={`항목 ${index + 1} 근거 파일 ${j + 1}`}
                  value={source.fileId}
                  onChange={(e) =>
                    update(index, {
                      sources: item.sources.map((s, k) =>
                        k === j ? { ...s, fileId: e.target.value, page: 1 } : s,
                      ),
                    })
                  }
                >
                  <option value="">선택</option>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                PDF 페이지
                <input
                  type="number"
                  min={1}
                  max={
                    documents.find((d) => d.id === source.fileId)?.pageCount ||
                    100
                  }
                  value={source.page}
                  onChange={(e) =>
                    update(index, {
                      sources: item.sources.map((s, k) =>
                        k === j ? { ...s, page: Number(e.target.value) } : s,
                      ),
                    })
                  }
                />
              </label>
              <label>
                도면 인용
                <textarea
                  maxLength={2000}
                  value={source.quote}
                  onChange={(e) =>
                    update(index, {
                      sources: item.sources.map((s, k) =>
                        k === j ? { ...s, quote: e.target.value } : s,
                      ),
                    })
                  }
                />
              </label>
              <button
                onClick={() =>
                  update(index, {
                    sources: item.sources.filter((_, k) => k !== j),
                  })
                }
              >
                근거 삭제
              </button>
            </div>
          ))}
          <button
            disabled={!documents.length || item.sources.length >= 20}
            onClick={() =>
              update(index, {
                sources: [
                  ...item.sources,
                  { fileId: documents[0].id, page: 1, quote: "" },
                ],
              })
            }
          >
            도면 근거 추가
          </button>
          <label>
            보완·후속 조치
            <textarea
              maxLength={2000}
              value={item.nextAction}
              onChange={(e) => update(index, { nextAction: e.target.value })}
            />
          </label>
          <label>
            항목 판정
            <select
              aria-label={`항목 ${index + 1} 판정`}
              value={item.status}
              onChange={(e) =>
                update(
                  index,
                  { status: e.target.value as ReviewItem["status"] },
                  false,
                )
              }
            >
              {itemStatuses.map((status) => (
                <option
                  key={status}
                  disabled={status !== "판단 보류" && !canDecide}
                >
                  {status}
                </option>
              ))}
            </select>
          </label>
          {!canDecide && (
            <p>사건 정보와 적용 기준을 확인한 후 판정할 수 있습니다.</p>
          )}
          <button onClick={() => onChange(items.filter((_, i) => i !== index))}>
            항목 삭제
          </button>
        </article>
      ))}
      <button
        disabled={items.length >= 30}
        onClick={() =>
          onChange([
            ...items,
            {
              id: crypto.randomUUID(),
              title: `검토 항목 ${items.length + 1}`,
              status: "판단 보류",
              detail: "",
              nextAction: "",
              law: {
                name: "",
                article: "",
                effectiveAt: "",
                checkedAt: "",
                url: "",
                reason: "",
              },
              sources: [],
            },
          ])
        }
      >
        검토 항목 추가
      </button>
    </section>
  );
}
export function ReviewItemsReport({
  items,
  documents,
}: {
  items: ReviewItem[];
  documents: Worksheet["documents"];
}) {
  return (
    <section>
      <h3>항목별 적용 법령과 판정</h3>
      {!items.length && (
        <p>등록된 항목 없음 · 전체 법규 검토 완료를 의미하지 않습니다.</p>
      )}
      {items.map((item) => (
        <article key={item.id}>
          <h4>
            {item.title} · {item.status}
          </h4>
          <p>{item.detail}</p>
          <p>
            {item.law.name} {item.law.article} · 시행일{" "}
            {item.law.effectiveAt || "미확인"} · 원문 확인일{" "}
            {item.law.checkedAt || "미확인"}
          </p>
          <p>{item.law.reason}</p>
          <p>{item.law.url}</p>
          {item.sources.map((s, i) => (
            <p key={i}>
              {documents.find((d) => d.id === s.fileId)?.name} · PDF {s.page}
              페이지: {s.quote}
            </p>
          ))}
          <p>{item.nextAction}</p>
        </article>
      ))}
    </section>
  );
}
