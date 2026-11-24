import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
test("creates a real Korean PDF download and removes obsolete notices", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("body")).not.toContainText("실자료 사용 금지");
  await expect(page.locator("h1")).toContainText("PDF를 넣고");
  await page.getByRole("button", { name: "한글 도면", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("등록됨");
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "결과 PDF 다운로드" }).click();
  const download = await event;
  await download.saveAs("test-results/generated-review.pdf");
  const pdf = await PDFDocument.load(
    await readFile("test-results/generated-review.pdf"),
  );
  expect(pdf.getPageCount()).toBeGreaterThan(0);
  expect(pdf.getTitle()).toBe("건축협의 조경 검토 의견서");
  await expect(page.getByRole("link", { name: "저장소 보기" })).toHaveAttribute(
    "href",
    /drive.google.com\/drive\/folders\//,
  );
});
test("missing Google configuration does not claim successful saving", async ({
  page,
}) => {
  await page.route("**/api/storage", (route) =>
    route.fulfill({
      json: {
        ready: false,
        message: "소유자의 Google Drive 연결이 필요합니다.",
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "정상 수치", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("등록됨");
  await page.getByRole("button", { name: "저장소에 넣어두기" }).click();
  await expect(page.getByRole("alert")).toContainText("소유자");
  await expect(page.locator("body")).not.toContainText("저장 완료");
});
test("save and reopen preserve originals, notes and source pages; approvals require review", async ({
  page,
}) => {
  const uploaded = new Map<number, Buffer>();
  let descriptors: { name: string; size: number; type: string }[] = [];
  const actions: string[] = [];
  await page.route("**/api/storage", async (route) => {
    const b = route.request().postDataJSON();
    actions.push(b.action);
    let result: unknown = {};
    if (b.action === "status") result = { ready: true };
    if (b.action === "begin") {
      descriptors = b.files;
      result = { session: "session", name: "[2026-11-25] 한글 도면" };
    }
    if (b.action === "upload") result = { ticket: String(b.index) };
    if (b.action === "chunk") {
      const index = Number(b.ticket);
      uploaded.set(
        index,
        Buffer.concat([
          uploaded.get(index) || Buffer.alloc(0),
          Buffer.from(b.data, "base64"),
        ]),
      );
      result = {
        complete: uploaded.get(index)!.length === descriptors[index].size,
      };
    }
    if (b.action === "finish") result = { complete: true };
    if (b.action === "list")
      result = {
        files: [{ id: "saved-folder", name: "[2026-11-25] 한글 도면" }],
      };
    if (b.action === "files")
      result = {
        files: descriptors.map((d, i) => ({
          id: String(i),
          name: d.name,
          size: String(d.size),
          mimeType: d.type,
        })),
      };
    if (b.action === "read")
      result = {
        data: uploaded
          .get(Number(b.file))!
          .subarray(b.offset, b.offset + 1048576)
          .toString("base64"),
      };
    await route.fulfill({ json: result });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "한글 도면", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("등록됨");
  await page.getByLabel("대지면적 후보", { exact: true }).selectOption("0");
  await page
    .getByLabel("대지면적 검수 사유", { exact: true })
    .fill("원본 산출표 대조");
  await page
    .locator("article")
    .first()
    .getByRole("button", { name: "원본 대조 확정", exact: true })
    .click();
  await page
    .getByLabel("담당자 검토 메모", { exact: true })
    .fill("식재계획 추가 확인");
  await page.getByRole("button", { name: "저장소에 넣어두기" }).click();
  await expect(page.getByText("저장 완료 ·", { exact: false })).toBeVisible();
  expect(descriptors.map((d) => d.name)).toEqual([
    "01_korean.pdf",
    "검토의견서.pdf",
    "review.json",
  ]);
  expect(uploaded.get(0)).toEqual(await readFile("public/samples/korean.pdf"));
  expect(
    (await PDFDocument.load(uploaded.get(1)!)).getPageCount(),
  ).toBeGreaterThan(0);
  expect(actions.at(-1)).toBe("finish");
  await page.getByRole("button", { name: "검토 초기화" }).click();
  await page.getByRole("button", { name: "저장한 검토 다시 열기" }).click();
  await page
    .getByLabel("저장한 검토", { exact: true })
    .selectOption("saved-folder");
  await page.getByRole("button", { name: "선택한 검토 열기" }).click();
  await expect(
    page.getByText("불러오기 완료 ·", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("대지면적 검수값", { exact: true })).toHaveValue(
    "1000",
  );
  await expect(
    page.getByLabel("대지면적 검수 사유", { exact: true }),
  ).toHaveValue("원본 산출표 대조");
  await expect(
    page.getByLabel("담당자 검토 메모", { exact: true }),
  ).toHaveValue("식재계획 추가 확인");
  await expect(page.locator(".badge.good")).toHaveCount(0);
  await expect(page.locator("canvas")).toBeVisible();
  // An editor replacing a stored drawing must not silently inherit the old values.
  uploaded.set(0, Buffer.from(uploaded.get(0)!));
  uploaded.get(0)![20] ^= 1;
  await page.getByRole("button", { name: "저장한 검토 다시 열기" }).click();
  await page.getByRole("button", { name: "선택한 검토 열기" }).click();
  await expect(page.getByRole("alert")).toContainText("원본 도면이 변경");
  await expect(page.getByLabel("대지면적 검수값", { exact: true })).toHaveValue(
    "1000",
  );
});
