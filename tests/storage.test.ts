import { describe, it, expect } from "vitest";
import {
  configured,
  cleanName,
  seal,
  unseal,
  validFile,
  driveAction,
  ROOT,
} from "../server/drive.mjs";
const env = {
  GOOGLE_CLIENT_ID: "client",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_REFRESH_TOKEN: "refresh",
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
describe("Drive boundary", () => {
  it("reports missing owner connection without attempting a provider request", async () => {
    expect(
      await driveAction("status", {}, {}, () => {
        throw Error("network");
      }),
    ).toMatchObject({ ready: false });
    expect(configured({})).toBe(false);
    await expect(driveAction("begin", {}, {})).rejects.toThrow("연결");
  });
  it("rejects forged, expired and oversized session tickets", () => {
    const ticket = seal(
      { exp: Date.now() + 10000, folder: "folder12345" },
      "secret",
    );
    expect(unseal(ticket, "secret").folder).toBe("folder12345");
    expect(() => unseal(ticket, "wrong")).toThrow();
    expect(() => unseal(seal({ exp: 1 }, "secret"), "secret")).toThrow("만료");
    expect(() => unseal("x".repeat(10001), "secret")).toThrow();
  });
  it("limits uploads to PDFs and the one restore record", () => {
    expect(
      validFile({ name: "도면.pdf", size: 100, type: "application/pdf" }),
    ).toBe(true);
    expect(
      validFile({ name: "review.json", size: 100, type: "application/json" }),
    ).toBe(true);
    expect(validFile({ name: "a.html", size: 100, type: "text/html" })).toBe(
      false,
    );
    expect(
      validFile({
        name: "a.pdf",
        size: 31 * 1024 * 1024,
        type: "application/pdf",
      }),
    ).toBe(false);
    expect(
      validFile({
        name: "review.json",
        size: 2 * 1024 * 1024,
        type: "application/json",
      }),
    ).toBe(false);
    expect(cleanName("a/b\\c")).toBe("a_b_c");
  });
  it("does not read a file outside the dedicated repository", async () => {
    const request = async (url: string) =>
      url.includes("oauth2")
        ? json({ access_token: "private-token" })
        : json({
            id: "outside12345",
            parents: ["unrelated"],
            appProperties: { forestwom: "1", complete: "1" },
          });
    await expect(
      driveAction("files", { folder: "outside12345" }, env, request),
    ).rejects.toThrow("저장소");
  });
  it("rejects incomplete folders even if originals are present", async () => {
    const request = async (url: string) =>
      url.includes("oauth2")
        ? json({ access_token: "private-token" })
        : json({
            id: "folder12345",
            parents: [ROOT],
            appProperties: { forestwom: "1", complete: "0" },
          });
    await expect(
      driveAction("files", { folder: "folder12345" }, env, request),
    ).rejects.toThrow("완료");
  });
  it("cannot mark a partial save complete", async () => {
    const request = async (url: string) =>
      url.includes("oauth2")
        ? json({ access_token: "private-token" })
        : url.includes("files?")
          ? json({ files: [] })
          : json({ parents: [ROOT], appProperties: { forestwom: "1" } });
    const session = seal(
      {
        folder: "folder12345",
        files: [{ name: "a.pdf", size: 10 }],
        exp: Date.now() + 10000,
      },
      env.GOOGLE_REFRESH_TOKEN,
    );
    await expect(
      driveAction("finish", { session }, env, request),
    ).rejects.toThrow("일부 파일");
  });
  it("never forwards arbitrary upload URLs", async () => {
    const ticket = seal(
      {
        url: "https://attacker.example/upload",
        size: 10,
        exp: Date.now() + 10000,
      },
      env.GOOGLE_REFRESH_TOKEN,
    );
    const request = async (url: string) => {
      expect(url).toContain("oauth2.googleapis.com");
      return json({ access_token: "private-token" });
    };
    await expect(
      driveAction("chunk", { ticket, offset: 0, data: "YWJj" }, env, request),
    ).rejects.toThrow("잘못된");
  });
  it("refresh failures are actionable and do not leak credentials", async () => {
    await expect(
      driveAction("list", {}, env, async () =>
        json({ error: "invalid_grant" }, 400),
      ),
    ).rejects.toThrow("소유자");
  });
});
