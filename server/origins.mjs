export function appOrigins(env = process.env) {
  const origins = ["https://forestwom.2hayoung.com", "https://forestwom-261.vercel.app"];
  // Trust platform-provided exact hostnames, never the client Host header or a wildcard.
  for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) {
    if (typeof host === "string" && /^[a-z0-9-]+\.vercel\.app$/i.test(host)) origins.push(`https://${host}`);
  }
  return origins;
}
