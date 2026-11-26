import { test, expect } from "@playwright/test";
test('administrator previews and explicitly publishes matching result files',async({page})=>{
 const c={id:'case_1234567890',name:'한글 도면',state:'submitted',note:'',notification:{state:'sent'},originals:[{id:'pdf_1234567890',name:'korean.pdf',hash:'a'.repeat(64),size:100,type:'application/pdf'}],versions:[]};
 let published=false;
 await page.route('**/api/requests',route=>{const b=route.request().postDataJSON();if(b.action==='publish'){published=b.confirmed;return route.fulfill({json:{...c,state:'published'}});}const data:any={session:{admin:true},health:{slack:true},detail:c,resultBegin:{session:'result-session'},upload:{ticket:'t'},chunk:{complete:true}};return route.fulfill({json:data[b.action]||{}});});
 await page.goto('/#/admin/case_1234567890');
 await page.getByLabel('결과 PDF',{exact:true}).setInputFiles('public/samples/korean.pdf');
 const result={schemaVersion:1,requestId:c.id,summary:'원본 대조 완료',reviewer:'담당자',reviewedAt:'2026-11-26',originals:c.originals,findings:[],holds:[],lawConfirmed:true,lawCheckedAt:'2026-11-26',lawNote:'확인'};
 await page.getByLabel('결과 JSON',{exact:true}).setInputFiles({name:'result.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(result))});
 await expect(page.getByText('원본 대조 완료',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'검토 결과 공개'})).toBeDisabled();
 await page.getByRole('checkbox').check();await page.getByRole('button',{name:'검토 결과 공개'}).click();
 await expect(page.getByRole('status')).toContainText('결과가 공개되었습니다.');expect(published).toBe(true);
});
test('intake fits a mobile viewport',async({page})=>{await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.getByRole('heading',{level:1})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);});
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
test("administrator login and JSON mismatch block publication", async ({
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
  await page.goto("/#/admin/case_1234567890");
  await page.getByLabel("관리자 키").fill("test-only-key");
  await page.getByRole("button", { name: "관리자 로그인" }).click();
  await expect(
    page.getByRole("heading", { name: "한글 도면", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("결과 JSON", { exact: true })
    .setInputFiles({
      name: "wrong.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({ schemaVersion: 1, requestId: "wrong" }),
      ),
    });
  await expect(page.getByRole("alert")).toContainText("접수번호");
  await expect(
    page.getByRole("button", { name: "검토 결과 공개" }),
  ).toBeDisabled();
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
  await expect(page.getByText("도면.pdf · PDF 2페이지")).toBeVisible();
  await expect(page.getByText("수목 상세도 보완")).toBeVisible();
});
