export function mockDrive() {
  let n = 0;
  const db = new Map<string, any>();
  let slack = 0;
  const response = (data: any, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const fetcher = async (url: string, opts: any = {}) => {
    if (url.includes("oauth2.googleapis.com"))
      return response({ access_token: "token" });
    if (url.includes("slack.com")) {
      slack++;
      return response({ ok: false, error: "invalid_auth" });
    }
    const u = new URL(url),
      path = u.pathname,
      method = opts.method || "GET";
    if (
      path.includes("/upload/") &&
      method === "POST" &&
      u.searchParams.get("uploadType") === "resumable"
    ) {
      const b = JSON.parse(opts.body),
        id = `file_${String(++n).padStart(12, "0")}`;
      db.set(id, {
        ...b,
        id,
        bytes: Buffer.alloc(Number(opts.headers["X-Upload-Content-Length"])),
        size: 0,
      });
      return new Response("{}", {
        headers: { Location: `https://www.googleapis.com/upload/mock/${id}` },
      });
    }
    if (path.includes("/upload/mock/") && method === "PUT") {
      const f = db.get(path.split("/").pop()!);
      const range = opts.headers["Content-Range"].match(
        /bytes (\d+)-(\d+)\/(\d+)/,
      );
      Buffer.from(opts.body).copy(f.bytes, Number(range[1]));
      if (Number(range[2]) + 1 < Number(range[3]))
        return new Response(null, { status: 308 });
      f.size = f.bytes.length;
      return response({ id: f.id });
    }
    if (path.includes("/upload/") && method === "PATCH") {
      const f = db.get(path.split("/").pop()!);
      if (
        opts.headers?.["If-Match"] &&
        opts.headers["If-Match"] !== `"${f.version || 0}"`
      )
        return response({}, 412);
      f.version = (f.version || 0) + 1;
      f.bytes = Buffer.from(opts.body);
      f.size = f.bytes.length;
      return response({ id: f.id });
    }
    if (path.endsWith("/files") && method === "POST") {
      const b = JSON.parse(opts.body),
        id = `file_${String(++n).padStart(12, "0")}`;
      db.set(id, { ...b, id, bytes: Buffer.alloc(0), size: 0 });
      return response({ id });
    }
    if (path.endsWith("/files")) {
      const parent = u.searchParams
        .get("q")
        ?.match(/'([^']+)' in parents/)?.[1];
      return response({
        files: [...db.values()]
          .filter((f) => f.parents?.includes(parent))
          .map(({ bytes, ...f }) => f),
      });
    }
    const f = db.get(path.split("/").pop()!);
    if (!f) return response({}, 404);
    if (u.searchParams.get("alt") === "media") {
      const range = opts.headers?.Range?.match(/bytes=(\d+)-(\d+)/);
      return new Response(
        range
          ? f.bytes.subarray(Number(range[1]), Number(range[2]) + 1)
          : f.bytes,
        { status: range ? 206 : 200, headers: { ETag: `"${f.version || 0}"` } },
      );
    }
    return response(f);
  };
  const add = (folder: string, f: any, b: Buffer) => {
    const id = `file_${String(++n).padStart(12, "0")}`;
    db.set(id, {
      ...f,
      id,
      parents: [folder],
      bytes: Buffer.from(b),
      size: b.length,
    });
    return id;
  };
  return { db, fetcher, add, slack: () => slack };
}
