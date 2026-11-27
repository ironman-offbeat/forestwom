import {
  caseFields,
  type CaseInfo,
  type CaseFact,
  type CaseKey,
} from "./case-review";

export default function CaseInfoForm({
  value,
  onChange,
}: {
  value: CaseInfo;
  onChange: (key: CaseKey, fact: CaseFact) => void;
}) {
  return (
    <section className="panel no-print" aria-labelledby="case-info-title">
      <h2 id="case-info-title">사건 정보</h2>
      <p>
        자료에 없는 정보는 미확인으로 남겨 두세요. 확인 근거에는 파일·페이지
        또는 확인한 자료를 적습니다.
      </p>
      <div className="case-info-grid">
        {caseFields.map(([key, label]) => {
          const fact = value[key];
          return (
            <div className="case-fact" key={key}>
              <label>
                {label}
                <input
                  aria-label={label}
                  maxLength={500}
                  type={key === "applicationDate" ? "date" : "text"}
                  placeholder={key === "jurisdiction" ? "성남시" : "미확인"}
                  value={fact.value}
                  onChange={(e) =>
                    onChange(key, {
                      ...fact,
                      value: e.target.value,
                      status: e.target.value ? "candidate" : "unknown",
                    })
                  }
                />
              </label>
              <label>
                {label} 확인 근거
                <input
                  maxLength={2000}
                  value={fact.source}
                  onChange={(e) =>
                    onChange(key, {
                      ...fact,
                      source: e.target.value,
                      status: fact.value ? "candidate" : "unknown",
                    })
                  }
                />
              </label>
              <label>
                {label} 확인 상태
                <select
                  aria-label={`${label} 확인 상태`}
                  value={fact.status}
                  onChange={(e) =>
                    onChange(key, {
                      ...fact,
                      status: e.target.value as CaseFact["status"],
                    })
                  }
                >
                  <option value="unknown">미확인</option>
                  <option value="candidate">추출·입력 후보</option>
                  <option
                    value="confirmed"
                    disabled={!fact.value.trim() || !fact.source.trim()}
                  >
                    담당자 확인
                  </option>
                </select>
              </label>
            </div>
          );
        })}
      </div>
    </section>
  );
}
