import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { mockDrive } from "../helpers/request-drive";
// @ts-ignore native server module
import { requestAction } from "../../server/requests.mjs";
import { caseFields } from "../../src/case-review";

const env = {
  ADMIN_KEY: "a".repeat(48),
  GOOGLE_REFRESH_TOKEN: "refresh",
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
};
async function setup(page: Page) {
  const m = mockDrive();
  const pdf = readFileSync("public/samples/normal.pdf");
  const asset = {
    name: "normal.pdf",
    size: pdf.length,
    type: "application/pdf",
    hash: createHash("sha256").update(pdf).digest("hex"),
  };
  const started = await requestAction(
    "begin",
    { name: "접수 연계 검산", files: [asset] },
    env,
    m.fetcher,
  );
  const file = m.add(started.id, asset, pdf);
  await requestAction("finish", { session: started.session }, env, m.fetcher);
  const call = (action: string, body: object = {}) =>
    requestAction(action, { id: started.id, ...body }, env, m.fetcher, true);
  await page.route("**/api/requests", async (route) => {
    const { action, ...body } = route.request().postDataJSON();
    try {
      await route.fulfill({
        json: await requestAction(action, body, env, m.fetcher, true),
      });
    } catch (e) {
      await route.fulfill({
        status: 400,
        json: { error: (e as Error).message },
      });
    }
  });
  return { id: started.id, file, m, call };
}
async function fillCase(page: Page) {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
  }).format(new Date());
  for (const [key, label] of caseFields) {
    await page
      .getByLabel(label, { exact: true })
      .fill(
        key === "jurisdiction"
          ? "성남시"
          : key === "applicationDate"
            ? today
            : "가상 시험 확인값",
      );
    await page
      .getByLabel(`${label} 확인 근거`, { exact: true })
      .fill("가상 신청서 1쪽 확인");
    await page
      .getByLabel(`${label} 확인 상태`, { exact: true })
      .selectOption("confirmed");
  }
  for (const label of [
    "대지면적",
    "연면적",
    "계획 조경면적",
    "식재면적",
    "자연지반면적",
    "옥상조경면적",
    "벽면녹화면적",
  ]) {
    await page.getByLabel(`${label} 후보`, { exact: true }).selectOption("0");
    await page
      .getByLabel(`${label} 검수 사유`, { exact: true })
      .fill("가상 원본 산출표 대조");
    await page
      .locator("article")
      .filter({ has: page.getByRole("heading", { name: label, exact: true }) })
      .getByRole("button", { name: "원본 대조 확정", exact: true })
      .click();
  }
  await page.getByLabel("사건 적용기준일", { exact: true }).fill(today);
  await page.getByLabel("법령 원문 확인일", { exact: true }).fill(today);
  await page
    .getByLabel("법령 확인 기록", { exact: true })
    .fill("가상 시험: 조례 제19조 및 조경기준 제4·5조");
  await page
    .getByLabel("대지 300㎡ 이상 일반 건축물이며,", { exact: false })
    .check();
  await page
    .getByLabel("사건 적용일의 법령 원문·부칙", { exact: false })
    .check();
  await page.getByLabel("상충 규칙을 검토했고,", { exact: false }).check();
}

test("case detail → actual source → calculation → signed save → reload, then invalidate changed facts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { id, call } = await setup(page);
  await page.goto(`/#/admin/${id}`);
  await page.getByRole("link", { name: "사건 검토표 열기" }).click();
  await expect(
    page.getByRole("button", { name: "사건 검토표 저장" }),
  ).toBeEnabled();
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator(".report-status")).toContainText("검토 보류");
  await expect(page.getByLabel("PDF 파일 선택")).toHaveCount(0);
  await fillCase(page);
  await expect(page.locator(".report-status")).toContainText(
    "계산 범위 내 수치 충족",
  );
  await page.getByRole("button", { name: "사건 검토표 저장" }).click();
  await expect(page.getByText(/검토표 저장 완료/)).toBeVisible();
  const saved = await call("detail");
  expect(saved.review.draft.entries.site.value).toBe("1000");
  expect(saved.review.draft.documents[0].pageCount).toBe(1);
  expect(saved.state).toBe("submitted");
  await page.reload();
  await expect(
    page.getByText("저장된 검토표와 원본을 불러왔습니다."),
  ).toBeVisible();
  await expect(page.getByLabel("대지면적 검수값", { exact: true })).toHaveValue(
    "1000",
  );
  await expect(page.locator(".report-status")).toContainText(
    "계산 범위 내 수치 충족",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: "test-results/case-review-mobile.png",
    fullPage: true,
  });
  await page.getByLabel("건축물 용도", { exact: true }).fill("변경된 용도");
  await expect(
    page.getByLabel("건축물 용도 확인 상태", { exact: true }),
  ).toHaveValue("candidate");
  await expect(page.locator(".report-status")).toContainText("검토 보류");
  await expect(
    page.getByLabel("사건 적용일의 법령 원문·부칙", { exact: false }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "사건 검토표 저장" }).click();
  await expect(page.getByText(/2차 저장/)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("건축물 용도", { exact: true })).toHaveValue(
    "변경된 용도",
  );
  await expect(page.locator(".report-status")).toContainText("검토 보류");
  expect(errors).toEqual([]);
});

test("source tampering prevents opening a saved case", async ({ page }) => {
  const { id, file, m } = await setup(page);
  m.db.get(file).bytes[20] ^= 1;
  await page.goto(`/#/case-review/${id}`);
  await expect(page.getByRole("alert")).toContainText("저장 파일이 변경");
  await expect(
    page.getByRole("button", { name: "사건 검토표 저장" }),
  ).toBeDisabled();
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("stale save retains local edits and shows a conflict", async ({
  page,
}) => {
  const { id, call } = await setup(page);
  await page.goto(`/#/case-review/${id}`);
  await expect(
    page.getByRole("button", { name: "사건 검토표 저장" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "사건 검토표 저장" }).click();
  await expect(page.getByText(/1차 저장/)).toBeVisible();
  const c = await call("detail");
  await call("saveReview", { revision: 1, draft: c.review.draft });
  await page.getByLabel("소재지", { exact: true }).fill("보존할 편집값");
  await page.getByRole("button", { name: "사건 검토표 저장" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "다른 작업에서 검토표가 변경",
  );
  await expect(page.getByLabel("소재지", { exact: true })).toHaveValue(
    "보존할 편집값",
  );
});
