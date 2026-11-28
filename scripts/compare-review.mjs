// Compare expert-labelled findings with an exported result. No LLM grading.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
export function compareReview(expected, actual) {
  if (
    !expected.requestId ||
    expected.requestId !== actual.requestId ||
    !Array.isArray(expected.findings) ||
    !expected.findings.length
  )
    throw Error("동일 접수의 전문가 정답 항목이 필요합니다.");
  if (
    !Array.isArray(expected.originals) ||
    JSON.stringify(expected.originals.map((f) => [f.name, f.hash]).sort()) !==
      JSON.stringify(actual.originals.map((f) => [f.name, f.hash]).sort())
  )
    throw Error("정답과 분석의 원본 해시가 다릅니다.");
  const titles = expected.findings.map((f) => f.title);
  if (new Set(titles).size !== titles.length)
    throw Error("정답 항목 제목은 중복될 수 없습니다.");
  const checks = expected.findings.map((e) => {
    const found = actual.findings.filter((a) => a.title === e.title);
    const a = found[0];
    return {
      title: e.title,
      missing: !a,
      duplicate: found.length > 1,
      statusMatch: found.length === 1 && a.status === e.status,
      evidenceMatch:
        found.length === 1 &&
        Array.isArray(e.sources) &&
        e.sources.length > 0 &&
        e.sources.every((s) =>
          a.sources.some((t) => t.file === s.file && t.page === s.page),
        ),
    };
  });
  return {
    requestId: actual.requestId,
    checkedAt: new Date().toISOString(),
    checks,
    extra: actual.findings
      .filter((a) => !titles.includes(a.title))
      .map((a) => a.title),
    notice:
      "제목·판정·파일·페이지 비교입니다. 법령 해석과 인용의 타당성은 전문가가 별도 확인해야 합니다.",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [expectedPath, actualPath, output] = process.argv.slice(2);
  if (!output)
    throw Error(
      "사용법: node scripts/compare-review.mjs expert.json result.json comparison.json",
    );
  const result = compareReview(
    JSON.parse(await readFile(expectedPath, "utf8")),
    JSON.parse(await readFile(actualPath, "utf8")),
  );
  await writeFile(output, JSON.stringify(result, null, 2));
  console.log(`비교 완료: ${result.checks.length}항목 → ${output}`);
}
