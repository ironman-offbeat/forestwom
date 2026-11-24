import { test, expect, type Page } from "@playwright/test";
const labels = [
  "대지면적",
  "연면적",
  "계획 조경면적",
  "식재면적",
  "자연지반면적",
  "옥상조경면적",
  "벽면녹화면적",
];
async function start(page: Page, sample = "정상 수치") {
  await page.goto("/");
  await page
    .getByLabel("실제 민원자료가 아닌 가상·비식별 자료임을 확인했습니다.")
    .check();
  await page.getByRole("button", { name: sample, exact: true }).click();
  await expect(page.getByRole("status")).toContainText("등록됨");
}
async function confirm(page: Page) {
  for (const label of labels) {
    await page.getByLabel(`${label} 후보`, { exact: true }).selectOption("0");
    await page
      .getByLabel(`${label} 검수 사유`, { exact: true })
      .fill("가상 PDF 산출표 원본 대조");
    await page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: label, exact: true }) })
      .getByRole("button", { name: "원본 대조 확정", exact: true })
      .click();
  }
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
  }).format(new Date());
  await page.getByLabel("사건 적용기준일", { exact: true }).fill(today);
  await page.getByLabel("법령 원문 확인일", { exact: true }).fill(today);
  await page
    .getByLabel("법령 확인 기록", { exact: true })
    .fill("가상 시험: 조례 제19조 및 조경기준 제4·5조, 일반 건축물 적용 가정");
  await page
    .getByLabel("대지 300㎡ 이상 일반 건축물이며,", { exact: false })
    .check();
  await page
    .getByLabel("사건 적용일의 법령 원문·부칙", { exact: false })
    .check();
  await page.getByLabel("상충 규칙을 검토했고,", { exact: false }).check();
}
test("normal PDF render → confirmation → rules → reviewer → print; no external transfers or storage", async ({
  page,
}) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:4173") &&
      !r.url().startsWith("blob:") &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator(".report-status")).toContainText("검토 보류");
  await confirm(page);
  await expect(page.locator(".report-status")).toContainText(
    "계산 범위 내 수치 충족",
  );
  await page.getByLabel("검토자", { exact: true }).fill("테스트 검토자");
  await page
    .getByLabel("담당자 검토 메모", { exact: true })
    .fill("실험용. 수목 및 공개공지 별도 검토 필요.");
  await page.getByRole("button", { name: "담당자 초안 검토 기록" }).click();
  await expect(page.locator(".report-status")).toContainText(
    "담당자 검토 기록 있음",
  );
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("#input")).toBeHidden();
  await expect(page.locator("#report")).toBeVisible();
  await page.pdf({ path: "test-results/review-memo.pdf", format: "A4" });
  await page.emulateMedia({ media: "screen" });
  await page.getByLabel("대지면적 검수값", { exact: true }).fill("1100");
  await expect(page.locator(".report-status")).toContainText("검토 보류");
  await expect(page.locator(".report-status")).toContainText("담당자 검토 전");
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  expect(
    await page.evaluate(async () => (await indexedDB.databases()).length),
  ).toBe(0);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  await page.reload();
  await expect(page.getByRole("status")).toContainText(
    "등록된 자료가 없습니다",
  );
});
test("deficient fixture produces three specific deficits", async ({ page }) => {
  await start(page, "기준 미달");
  await confirm(page);
  await expect(page.locator(".report-status")).toContainText("기준 미달");
  await expect(page.locator("#report")).toContainText("50㎡ 부족");
  await expect(page.locator("#report")).toContainText("45㎡ 부족");
  await expect(page.locator("#report")).toContainText("10㎡ 부족");
});
test("conflicting pages preserve both candidates and require deliberate confirmation", async ({
  page,
}) => {
  await start(page, "도면 불일치");
  await expect(
    page.getByText("도면 간 수치 불일치 —", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByLabel("대지면적 후보", { exact: true }).locator("option"),
  ).toHaveCount(3);
  await expect(page.locator(".report-status")).toContainText("검토 보류");
});
test("scan and mixed documents stay held", async ({ page }) => {
  await start(page, "스캔본");
  await expect(page.locator("#report")).toContainText(
    "텍스트 부족·스캔 의심 페이지",
  );
  await page.getByRole("button", { name: "검토 초기화" }).click();
  await page.getByRole("button", { name: "혼합 문서", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("2페이지");
  await confirm(page);
  await expect(page.locator(".report-status")).toContainText("검토 보류");
});
test("file picker handles corrupt PDF with explicit failure", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("실제 민원자료가 아닌 가상·비식별 자료임을 확인했습니다.")
    .check();
  await page
    .getByLabel("PDF 파일 선택")
    .setInputFiles("public/samples/corrupt.pdf");
  await expect(page.getByRole("alert")).toContainText("손상");
});
test("uploading another document revokes previous confirmations", async ({
  page,
}) => {
  await start(page);
  await confirm(page);
  await page.getByRole("button", { name: "도면 불일치", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("등록됨");
  await expect(page.locator(".report-status")).toContainText("검토 보류");
  await expect(page.locator(".badge.good")).toHaveCount(0);
});
test("mobile layout remains within viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
});
test("failed documents cannot be silently omitted and reset recovers", async ({
  page,
}) => {
  await start(page);
  await page
    .getByLabel("PDF 파일 선택")
    .setInputFiles("public/samples/corrupt.pdf");
  await expect(page.getByRole("alert")).toContainText("손상");
  await confirm(page);
  await expect(page.locator(".report-status")).toContainText("검토 보류");
  await expect(page.locator("#report")).toContainText("읽기 실패 자료");
  await page.getByRole("button", { name: "검토 초기화" }).click();
  await expect(page.locator("#report")).not.toContainText("읽기 실패 자료");
});
test("Korean CMap PDF extraction and rendering use local assets", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("실제 민원자료가 아닌 가상·비식별 자료임을 확인했습니다.")
    .check();
  await page
    .getByLabel("PDF 파일 선택")
    .setInputFiles("public/samples/korean.pdf");
  await expect(page.getByRole("status")).toContainText("등록됨");
  await expect(
    page.getByLabel("대지면적 후보", { exact: true }).locator("option"),
  ).toHaveCount(2);
  await confirm(page);
  await expect(page.locator(".report-status")).toContainText("수치 충족");
  await page.getByRole("link", { name: "02 원본 대조" }).click();
  await page.screenshot({ path: "test-results/korean-review.png" });
});
