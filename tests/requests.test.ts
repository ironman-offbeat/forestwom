import { mockDrive } from "./helpers/request-drive";
import { describe, it, expect } from "vitest";
// @ts-ignore server module is intentionally native ESM.
import {
  requestAction,
  validDescriptors,
  validateResult,
  login,
  adminSession,
  sendNotification,
} from "../server/requests.mjs";
// @ts-ignore
import { seal, ROOT } from "../server/drive.mjs";
import { createHash } from "node:crypto";
const env = {
  ADMIN_KEY: "a".repeat(48),
  GOOGLE_REFRESH_TOKEN: "refresh",
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
};
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const pdf = Buffer.from("%PDF-1.7\nsynthetic\n%%EOF");
const descriptor = {
  name: "drawing.pdf",
  size: pdf.length,
  type: "application/pdf",
  hash: sha(pdf),
};
describe("request boundaries", () => {
  it("requires strong administrator key and verifies cookie signature and expiry", () => {
    const token = login(env.ADMIN_KEY, env);
    expect(adminSession(`fw_admin=${token}`, env)).toBe(true);
    expect(adminSession(`fw_admin=${token}x`, env)).toBe(false);
    expect(
      adminSession(
        `fw_admin=${seal({ kind: "admin", exp: 0 }, env.ADMIN_KEY)}`,
        env,
      ),
    ).toBe(false);
    expect(() => login("wrong", env)).toThrow();
  });
  it("rejects anonymous admin actions before Drive access", async () => {
    for (const action of [
      "list",
      "detail",
      "state",
      "notify",
      "resultBegin",
      "publish",
      "saveReview",
      "requestMaterials",
      "cancelMaterials",
    ])
      await expect(
        requestAction(
          action,
          {},
          env,
          () => {
            throw Error("network should not run");
          },
          false,
        ),
      ).rejects.toThrow("관리자");
  });
  it("validates original sizes types and duplicate names", () => {
    expect(validDescriptors([descriptor])).toBe(true);
    for (const files of [
      [],
      [descriptor, descriptor],
      [{ ...descriptor, size: 0 }],
      [{ ...descriptor, type: "text/html" }],
      [{ ...descriptor, hash: "x" }],
    ])
      expect(validDescriptors(files)).toBe(false);
  });
  it("requires exact result files", () => {
    expect(validDescriptors([descriptor], true)).toBe(false);
    expect(
      validDescriptors(
        [
          { ...descriptor, name: "report.pdf" },
          { ...descriptor, name: "result.json", type: "application/json" },
        ],
        true,
      ),
    ).toBe(true);
  });
  it("requires source binding and evidence for confirmed findings", () => {
    const c = { id: "request1", originals: [descriptor] };
    const r = {
      schemaVersion: 1,
      requestId: c.id,
      reviewer: "담당자",
      reviewedAt: "2026-11-26",
      summary: "요약",
      originals: [descriptor],
      findings: [],
      holds: [],
      lawConfirmed: false,
      lawCheckedAt: "",
      lawNote: "",
    };
    expect(validateResult(r, c)).toBe(r);
    expect(() => validateResult({ ...r, requestId: "other" }, c)).toThrow();
    expect(() =>
      validateResult(
        { ...r, originals: [{ ...descriptor, hash: "f".repeat(64) }] },
        c,
      ),
    ).toThrow();
    expect(() =>
      validateResult(
        {
          ...r,
          findings: [
            { title: "면적", detail: "확인", status: "확인", sources: [] },
          ],
        },
        c,
      ),
    ).toThrow();
    expect(() =>
      validateResult(
        {
          ...r,
          findings: [
            {
              title: "면적",
              detail: "확인",
              status: "보완",
              sources: [{ file: "drawing.pdf", page: 0, quote: "" }],
            },
          ],
        },
        c,
      ),
    ).toThrow();
  });
  it("records missing and failed Slack separately without rejecting intake", async () => {
    const record = {
      id: "r",
      name: "<@everyone>",
      originals: [descriptor],
      notificationId: "abc",
    };
    expect((await sendNotification(record, env)).state).toBe("pending");
    let sent: any;
    const result = await sendNotification(
      record,
      { ...env, SLACK_BOT_TOKEN: "bot" },
      async (_u: string, o: any) => {
        sent = JSON.parse(o.body);
        return new Response(JSON.stringify({ ok: false }));
      },
    );
    expect(result.state).toBe("failed");
    expect(sent.channel).toBe("U0AF5B880F3");
    expect(sent.mrkdwn).toBe(false);
  });
  it("only completes after all originals match and repeated finish does not resend", async () => {
    const m = mockDrive(),
      e = { ...env, SLACK_BOT_TOKEN: "bot" };
    const s = await requestAction(
      "begin",
      { name: "가상", files: [descriptor] },
      e,
      m.fetcher,
    );
    await expect(
      requestAction("finish", { session: s.session }, e, m.fetcher),
    ).rejects.toThrow("누락");
    expect(m.slack()).toBe(0);
    m.add(s.id, descriptor, pdf);
    const done = await requestAction(
      "finish",
      { session: s.session },
      e,
      m.fetcher,
    );
    expect(done.state).toBe("submitted");
    expect(done.notification.state).toBe("failed");
    expect(m.slack()).toBe(1);
    await requestAction("finish", { session: s.session }, e, m.fetcher);
    expect(m.slack()).toBe(1);
    const get = await requestAction("get", { id: s.id }, e, m.fetcher);
    expect(get.result).toBeUndefined();
    expect(get.originals).toBeUndefined();
  });
  it("detects original tampering and signed metadata replacement", async () => {
    const m = mockDrive();
    const s = await requestAction(
      "begin",
      { name: "가상", files: [descriptor] },
      env,
      m.fetcher,
    );
    m.add(
      s.id,
      descriptor,
      Buffer.from(pdf.toString().replace("synthetic", "tampered!")),
    );
    await expect(
      requestAction("finish", { session: s.session }, env, m.fetcher),
    ).rejects.toThrow("해시");
    const meta = [...m.db.values()].find(
      (f) => f.name === "request.signed.json",
    );
    meta.bytes = Buffer.from(JSON.stringify({ signed: "forged" }));
    meta.size = meta.bytes.length;
    await expect(
      requestAction("detail", { id: s.id }, env, m.fetcher, true),
    ).rejects.toThrow("변경");
  });
  it("rejects unrelated folders and public original downloads", async () => {
    const m = mockDrive();
    m.db.set("other_folder_123", {
      id: "other_folder_123",
      parents: ["other"],
      appProperties: { request: "1" },
    });
    await expect(
      requestAction("get", { id: "other_folder_123" }, env, m.fetcher),
    ).rejects.toThrow("없는");
    const s = await requestAction(
      "begin",
      { name: "가상", files: [descriptor] },
      env,
      m.fetcher,
    );
    const file = m.add(s.id, descriptor, pdf);
    await requestAction("finish", { session: s.session }, env, m.fetcher);
    await expect(
      requestAction("read", { id: s.id, file, offset: 0 }, env, m.fetcher),
    ).rejects.toThrow("권한");
  });
  it("requires publication confirmation and preserves result versions", async () => {
    const m = mockDrive();
    const s = await requestAction(
      "begin",
      { name: "가상", files: [descriptor] },
      env,
      m.fetcher,
    );
    m.add(s.id, descriptor, pdf);
    await requestAction("finish", { session: s.session }, env, m.fetcher);
    const date = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Seoul",
    });
    const result = {
      schemaVersion: 1,
      requestId: s.id,
      reviewer: "담당자",
      reviewedAt: date,
      summary: "요약",
      originals: [descriptor],
      findings: [],
      holds: ["수목 확인"],
      lawConfirmed: true,
      lawCheckedAt: date,
      lawNote: "원문 확인",
    };
    const json = Buffer.from(JSON.stringify(result));
    const expected = [
      { ...descriptor, name: "report.pdf" },
      {
        name: "result.json",
        type: "application/json",
        hash: sha(json),
        size: json.length,
      },
    ];
    const session = seal(
      {
        kind: "result",
        folder: s.id,
        version: "v1",
        files: expected,
        exp: Date.now() + 60000,
      },
      env.ADMIN_KEY,
    );
    m.add(s.id, expected[0], pdf);
    m.add(s.id, expected[1], json);
    await expect(
      requestAction("publish", { id: s.id, session }, env, m.fetcher, true),
    ).rejects.toThrow("확인");
    const published = await requestAction(
      "publish",
      { id: s.id, session, confirmed: true },
      env,
      m.fetcher,
      true,
    );
    expect(published.versions).toHaveLength(1);
    expect(
      (await requestAction("get", { id: s.id }, env, m.fetcher)).result.summary,
    ).toBe("요약");
    const repeated = await requestAction(
      "publish",
      { id: s.id, session, confirmed: true },
      env,
      m.fetcher,
      true,
    );
    expect(repeated.versions).toHaveLength(1);
  });
});
