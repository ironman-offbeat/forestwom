import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { mockDrive } from "./helpers/request-drive";
// @ts-ignore native server modules
import { requestAction } from "../server/requests.mjs";
// @ts-ignore native validator
import { validateWorksheet } from "../server/worksheet.mjs";
import {
  emptyCaseInfo,
  caseHolds,
  restoreWorksheet,
  type Worksheet,
} from "../src/case-review";
import { emptyEntries, emptyGates, RULE_VERSION } from "../src/engine";

const env = {
  ADMIN_KEY: "a".repeat(48),
  GOOGLE_REFRESH_TOKEN: "refresh",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
};
const pdf = readFileSync("public/samples/normal.pdf");
const asset = {
  name: "normal.pdf",
  size: pdf.length,
  type: "application/pdf",
  hash: createHash("sha256").update(pdf).digest("hex"),
};
function draft(id: string): Worksheet {
  return {
    schemaVersion: 1,
    ruleVersion: RULE_VERSION,
    info: emptyCaseInfo(),
    documents: [{ id, name: asset.name, hash: asset.hash, pageCount: 1 }],
    entries: emptyEntries(),
    gates: emptyGates(),
    reviewer: "",
    remarks: "",
    history: [],
  };
}
async function setup() {
  const m = mockDrive();
  const begin = await requestAction(
    "begin",
    { name: "검토표 시험", files: [asset] },
    env,
    m.fetcher,
  );
  const file = m.add(begin.id, asset, pdf);
  await requestAction("finish", { session: begin.session }, env, m.fetcher);
  const call = (action: string, body: object = {}) =>
    requestAction(action, { id: begin.id, ...body }, env, m.fetcher, true);
  return { m, call, file, begin };
}
describe("case worksheet", () => {
  it("stores partial facts in signed records, restores entries, and does not publish", async () => {
    const { call, file } = await setup();
    const d = draft(file);
    d.entries.site = {
      value: "1000",
      pageId: `${file}:1`,
      note: "원본 표 확인",
      confirmed: true,
    };
    const result = await call("saveReview", { revision: 0, draft: d });
    expect(result.revision).toBe(1);
    const detail = await call("detail");
    expect(detail.review.draft).toEqual(d);
    expect(detail.state).toBe("submitted");
    expect(detail.versions).toEqual([]);
    expect((await call("get")).review).toBeUndefined();
    expect((await call("saveReview", { revision: 1, draft: d })).revision).toBe(
      2,
    );
    await expect(call("saveReview", { revision: 1, draft: d })).rejects.toThrow(
      "변경",
    );
  });
  it("checks actual PDF page counts rather than trusting client metadata", async () => {
    const { call, file } = await setup();
    const d = draft(file);
    d.documents[0].pageCount = 50;
    await expect(call("saveReview", { revision: 0, draft: d })).rejects.toThrow(
      "근거 페이지",
    );
    d.documents[0].pageCount = 1;
    d.entries.site.pageId = `${file}:2`;
    await expect(call("saveReview", { revision: 0, draft: d })).rejects.toThrow(
      "근거 페이지",
    );
  });
  it("rejects changed source bytes and leaves the previous worksheet intact", async () => {
    const { call, file, m } = await setup();
    await call("saveReview", { revision: 0, draft: draft(file) });
    m.db.get(file).bytes[20] ^= 1;
    await expect(
      call("saveReview", { revision: 1, draft: draft(file) }),
    ).rejects.toThrow("원본 파일이 변경");
    expect((await call("detail")).review.revision).toBe(1);
  });
  it("rejects a concurrent metadata write at the conditional save boundary", async () => {
    const { m, file, begin } = await setup();
    const fetcher = async (url: string, options: any) => {
      if (url.includes("/upload/") && options.headers?.["If-Match"]) {
        const metadata = [...m.db.values()].find(
          (f) => f.name === "request.signed.json",
        );
        metadata.version++;
      }
      return m.fetcher(url, options);
    };
    await expect(
      requestAction(
        "saveReview",
        { id: begin.id, revision: 0, draft: draft(file) },
        env,
        fetcher,
        true,
      ),
    ).rejects.toThrow("다른 작업");
  });
  it("requires complete facts for calculations and revokes confirmations on rule changes", () => {
    const d = draft("source_12345");
    expect(caseHolds(d.info).length).toBeGreaterThan(0);
    for (const f of Object.values(d.info))
      Object.assign(f, {
        value: "확인값",
        source: "신청서 1쪽",
        status: "confirmed",
      });
    d.info.jurisdiction.value = "성남시";
    d.info.applicationDate.value = "2026-11-27";
    expect(caseHolds(d.info)).toEqual([]);
    d.entries.site.confirmed = true;
    d.gates.law = true;
    expect(restoreWorksheet(d, d.documents).entries.site.confirmed).toBe(true);
    const restored = restoreWorksheet(
      { ...d, ruleVersion: "old" },
      d.documents,
    );
    expect(restored.entries.site.confirmed).toBe(false);
    expect(restored.gates.law).toBe(false);
    expect(() =>
      restoreWorksheet(d, [{ ...d.documents[0], hash: "b".repeat(64) }]),
    ).toThrow("원본");
  });
  it("rejects missing evidence, malformed fields, and oversized drafts", () => {
    const d = draft("source_12345");
    const validate = () => validateWorksheet(d, d.documents);
    expect(validate()).toEqual(d);
    d.info.address.status = "confirmed";
    expect(validate).toThrow();
    d.info.address.status = "unknown";
    d.entries.site.confirmed = true;
    expect(validate).toThrow();
    d.entries.site.confirmed = false;
    d.remarks = "a".repeat(10001);
    expect(validate).toThrow();
  });
});
