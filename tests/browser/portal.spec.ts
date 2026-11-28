import { test, expect } from "@playwright/test";
test("result formatting preserves evidence and renders safe readable lists on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/requests", (route) =>
    route.fulfill({
      json: {
        name: "서식 확인 도면",
        state: "published",
        notification: { state: "sent" },
        result: {
          summary: "**추가 자료 필요**\n\n수치와 근거를 확인하세요.",
          reviewer: "담당자",
          reviewedAt: "2026-11-27",
          findings: [
            {
              title: "면적 검토",
              status: "보완",
              detail:
                "### 확인 사항\n- **대지면적**: 1,000㎡\n- 조경면적: 160㎡\n\n1. 산출표 확인\n2. 원본 대조\n\n<script>window.bad = true</script>",
              sources: [
                {
                  file: "한글도면.pdf",
                  page: 1,
                  quote: "계획 조경면적: 160 m2",
                },
              ],
            },
          ],
          holds: ["배치도 제출"],
          lawConfirmed: false,
          lawCheckedAt: "",
          lawNote: "적용 시점 확인 필요",
        },
      },
    }),
  );
  await page.goto("/#/result/format-case");
  await expect(page.locator(".report-summary strong")).toHaveText(
    "추가 자료 필요",
  );
  await expect(page.locator("article .report-text ul > li")).toHaveCount(2);
  await expect(page.locator("article .report-text ol > li")).toHaveCount(2);
  await expect(page.locator(".finding-number")).toHaveText("01");
  await expect(page.locator(".source-location")).toContainText("PDF 1페이지");
  await expect(page.locator(".analysis script")).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
test("administrator previews and explicitly publishes matching result files", async ({
  page,
}) => {
  const c = {
    id: "case_1234567890",
    name: "한글 도면",
    state: "submitted",
    note: "",
    notification: { state: "sent" },
    originals: [
      {
        id: "pdf_1234567890",
        name: "korean.pdf",
        hash: "a".repeat(64),
        size: 100,
        type: "application/pdf",
      },
    ],
    versions: [],
  };
  let published = false;
  await page.route("**/api/requests", (route) => {
    const b = route.request().postDataJSON();
    if (b.action === "publish") {
      published = b.confirmed;
      return route.fulfill({ json: { ...c, state: "published" } });
    }
    const data: any = {
      session: { admin: true },
      health: { slack: true },
      detail: c,
      resultBegin: { session: "result-session" },
      upload: { ticket: "t" },
      chunk: { complete: true },
    };
    return route.fulfill({ json: data[b.action] || {} });
  });
  await page.goto("/#/admin/case_1234567890");
  const result = {
    schemaVersion: 1,
    requestId: c.id,
    summary: "원본 대조 완료",
    reviewer: "담당자",
    reviewedAt: "2026-11-26",
    originals: c.originals,
    findings: [],
    holds: [],
    lawConfirmed: true,
    lawCheckedAt: "2026-11-26",
    lawNote: "확인",
  };
  await page
    .getByLabel("ChatGPT 결과 JSON 파일", { exact: true })
    .setInputFiles({
      name: "result.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(result)),
    });
  await page.getByRole("button", { name: "분석 결과 검증·가져오기" }).click();
  await expect(page.getByText("원본 대조 완료", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "미리보기 PDF 생성" }),
  ).toBeDisabled();
  await page.getByLabel("최종 검토자").fill("실제 담당자");
  await page
    .getByLabel("법령 원문·적용 시점·확인 기록을 직접 대조했습니다.")
    .check();
  await page.getByRole("button", { name: "미리보기 PDF 생성" }).click();
  await page
    .getByLabel(
      "도면 근거·적용 법령·PDF와 화면 내용을 대조했고 이 결과를 공개합니다.",
    )
    .check();
  await page.getByRole("button", { name: "검토표 결과 공개" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "검토 결과가 공개" }),
  ).toContainText("결과가 공개되었습니다.");
  expect(published).toBe(true);
});
test("intake fits a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});
test("intake reveals only required inputs, submits and shows pending result link", async ({
  page,
}) => {
  const actions: string[] = [];
  await page.route("**/api/requests", (route) => {
    const b = route.request().postDataJSON();
    actions.push(b.action);
    const data: any = {
      begin: { id: "case_1234567890", session: "s" },
      upload: { ticket: "t" },
      chunk: { complete: true },
      finish: { id: "case_1234567890" },
      get: {
        id: "case_1234567890",
        name: "korean",
        state: "submitted",
        notification: { state: "pending" },
      },
    };
    return route.fulfill({ json: data[b.action] || {} });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "원본 대조 및 수치 확정" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("도면 이름", { exact: true })).toHaveCount(0);
  await page
    .getByLabel("접수 PDF 선택")
    .setInputFiles("public/samples/korean.pdf");
  await expect(page.getByLabel("도면 이름", { exact: true })).toHaveValue(
    "korean",
  );
  await page
    .getByRole("button", { name: "검토 요청하기", exact: true })
    .click();
  await expect(page).toHaveURL(/result\/case_1234567890/);
  await expect(page.getByText("검토 요청 접수", { exact: true })).toBeVisible();
  expect(actions.indexOf("finish")).toBeGreaterThan(actions.indexOf("chunk"));
  await expect(
    page.getByText("Slack 알림은 아직", { exact: false }),
  ).toBeVisible();
});
test("failed upload remains on intake and retries same session", async ({
  page,
}) => {
  let began = 0,
    fail = true;
  await page.route("**/api/requests", (route) => {
    const b = route.request().postDataJSON();
    if (b.action === "begin") {
      began++;
      return route.fulfill({ json: { id: "case_1234567890", session: "s" } });
    }
    if (b.action === "upload") return route.fulfill({ json: { ticket: "t" } });
    if (b.action === "chunk" && fail) {
      fail = false;
      return route.fulfill({
        status: 400,
        json: { error: "업로드 연결 실패" },
      });
    }
    if (b.action === "finish")
      return route.fulfill({ json: { id: "case_1234567890" } });
    if (b.action === "get")
      return route.fulfill({
        json: {
          name: "korean",
          state: "submitted",
          notification: { state: "sent" },
        },
      });
    return route.fulfill({ json: { complete: true } });
  });
  await page.goto("/");
  await page
    .getByLabel("접수 PDF 선택")
    .setInputFiles("public/samples/korean.pdf");
  await page
    .getByRole("button", { name: "검토 요청하기", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("업로드 연결 실패");
  await page
    .getByRole("button", { name: "업로드 다시 시도", exact: true })
    .click();
  await expect(page).toHaveURL(/result/);
  expect(began).toBe(1);
});
test("Slack review link opens without login and JSON mismatch blocks publication", async ({
  page,
}) => {
  let admin = false;
  await page.route("**/api/requests", (route) => {
    const b = route.request().postDataJSON();
    if (b.action === "login") {
      admin = true;
      return route.fulfill({ json: { ok: true } });
    }
    const data: any = {
      session: { admin },
      health: { slack: false },
      detail: {
        id: "case_1234567890",
        name: "한글 도면",
        state: "submitted",
        note: "면적 확인",
        notification: { state: "pending" },
        originals: [
          {
            id: "pdf_1234567890",
            name: "korean.pdf",
            hash: "a".repeat(64),
            size: 100,
            type: "application/pdf",
          },
        ],
        versions: [],
      },
    };
    return route.fulfill({ json: data[b.action] || {} });
  });
  await page.goto("/#/access/test-token/case_1234567890");
  await expect(page.getByLabel("관리자 키")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "한글 도면", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("ChatGPT 결과 JSON 파일", { exact: true })
    .setInputFiles({
      name: "wrong.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ schemaVersion: 1, requestId: "wrong" }),
      ),
    });
  await page.getByRole("button", { name: "분석 결과 검증·가져오기" }).click();
  await expect(page.getByRole("alert")).toContainText("접수번호");
  await expect(
    page.getByRole("button", { name: "검토표 결과 공개" }),
  ).toHaveCount(0);
});
test("published result renders source pages and holds", async ({ page }) => {
  await page.route("**/api/requests", (route) =>
    route.fulfill({
      json: {
        name: "가상",
        state: "published",
        notification: { state: "sent" },
        result: {
          summary: "조경면적 확인",
          reviewer: "검토자",
          reviewedAt: "2026-11-26",
          findings: [
            {
              title: "대지면적",
              detail: "1000㎡",
              status: "확인",
              sources: [{ file: "도면.pdf", page: 2, quote: "대지면적 1000" }],
            },
          ],
          holds: ["수목 상세도 보완"],
          lawCheckedAt: "2026-11-26",
          lawNote: "원문 대조",
        },
      },
    }),
  );
  await page.goto("/#/result/case_1234567890");
  await expect(page.locator(".source-location strong")).toHaveText("도면.pdf");
  await expect(page.locator(".source-location span")).toHaveText("PDF 2페이지");
  await expect(page.getByText("수목 상세도 보완")).toBeVisible();
});

test("anonymous reviewer routes are blocked and cannot request case records", async ({
  page,
}) => {
  const actions: string[] = [];
  await page.route("**/api/requests", (route) => {
    const b = route.request().postDataJSON();
    actions.push(b.action);
    return route.fulfill({ json: { admin: false } });
  });
  await page.goto("/#/admin/private-case");
  await expect(
    page.getByRole("heading", { name: "검토자 전용 화면" }),
  ).toBeVisible();
  expect(actions).toEqual(["session"]);
  await page.goto("/#/case-review/private-case");
  await expect(
    page.getByRole("heading", { name: "검토자 전용 화면" }),
  ).toBeVisible();
  expect(actions.every((a) => a === "session")).toBe(true);
});
