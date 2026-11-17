// Pre-publish audit. Scans the repo (minus .git/, node_modules/, .agents/ and local .env files)
// and dist/. Exits 1 on any hit. Patterns that would match this file are written so they don't.
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = path.join(ROOT, "dist");
const SKIP_DIRS = new Set([".git", "node_modules", ".agents"]);
const BINARY_EXT = new Set([".woff2", ".woff", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip"]);

// Internal names that must never ship, stored base64-encoded so this file holds no plain hits.
const DENYLIST_B64 = [
  "Q1BBX1BpcGVsaW5l", "Q1BBIFBpcGVsaW5l", "Y29udGVudC1zZWN1cml0eS1nZW5haS10b29scw==", "Q1BBIHJ1YnJpYw==",
  "QWlydGFibGU=", "QW1hbmRpbA==", "Z2VyYXdqdWw=", "YTJ6LmNvbQ==", "YW1hem9uLmRldg==", "Y29ycC5hbWF6b24=",
  "dy5hbWF6b24uY29t", "Y29kZS5hbWF6b24uY29t", "bWlkd2F5", "aXNlbmdhcmQ=", "cGhvbmV0b29s", "cXVpcA==",
  "Q1NBSQ==", "U2hhcmVQb2ludA==", "RWxyb25k", "Q1BB", "UXVhbHRyaWNz",
];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const DENYLIST = DENYLIST_B64.map((b, i) => ({
  id: i + 1,
  re: new RegExp(`(?<![A-Za-z0-9])${escapeRe(Buffer.from(b, "base64").toString("utf8"))}(?![A-Za-z0-9])`, "i"),
}));

const SECRETS = [
  ["Anthropic key", /sk-ant-[A-Za-z0-9_-]{10,}/],
  ["AWS access key id", /AKIA[0-9A-Z]{16}/],
  ["AWS secret assignment", /aws_secret_access_key\s*=\s*\S/i],
  ["Anthropic key assignment", /ANTHROPIC_API_KEY\s*=\s*\S/],
];

const BINDS = [
  ["wildcard IPv4 bind", new RegExp("(?<![\\d.])0\\.0\\.0\\.0(?![\\d.])")],
  ["wildcard IPv6 bind", /\[::\]/],
  ["wildcard IPv6 bind", /"\x3a:"/],
  ["host flag", /-{2}host\b/],
];

const URL_ALLOW = new Set(["https://github.com/discofuchsia", "http://www.w3.org/2000/svg"]);
const LEADING_SLASH = /(?:src|href)=\\?["']\/|url\(\s*["']?\//;

async function walk(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await walk(path.join(dir, entry.name), out);
    } else if (entry.isFile()) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const hits = [];
const hit = (file, line, what) => hits.push(`${path.relative(ROOT, file)}:${line}: ${what}`);

const files = await walk(ROOT);
let scanned = 0;
for (const file of files) {
  const rel = path.relative(ROOT, file);
  const base = path.basename(file);
  const inDist = file.startsWith(DIST + path.sep);
  // Local, git-ignored env files are never committed; dist must not contain any.
  if (!inDist && /^\.env(\.|$)/.test(base) && base !== ".env.example") continue;

  if (inDist) {
    const segs = path.relative(DIST, file).split(path.sep);
    if (file.endsWith(".mjs") || /^\.env/.test(base) || segs.some((s) => /^(backend|server|agent)(\.|$)/i.test(s))) {
      hit(file, 0, "server-side or env file in dist/");
    }
  }
  if (BINARY_EXT.has(path.extname(file).toLowerCase())) continue;
  const buf = await readFile(file);
  if (buf.includes(0)) continue;
  scanned++;
  const isFontLicense = inDist && rel.includes(`assets${path.sep}fonts${path.sep}`) && /LICENSE/i.test(base);
  const lines = buf.toString("utf8").split(/\r?\n/);
  lines.forEach((text, i) => {
    const n = i + 1;
    for (const d of DENYLIST) if (d.re.test(text)) hit(file, n, `internal term #${d.id} [redacted]`);
    for (const [label, re] of SECRETS) if (re.test(text)) hit(file, n, label);
    for (const [label, re] of BINDS) if (re.test(text)) hit(file, n, label);
    if (!inDist) return;
    if (LEADING_SLASH.test(text)) hit(file, n, "leading-slash path");
    if (!isFontLicense) {
      for (const m of text.matchAll(/https?:\/\/[^\s"'<>`)\\]+/g)) {
        if (!URL_ALLOW.has(m[0])) hit(file, n, `external URL ${m[0]}`);
      }
    }
  });
}

if (!(await stat(path.join(DIST, "index.html")).catch(() => null))) hit(DIST, 0, "dist/index.html missing (run npm run build)");

if (hits.length) {
  console.error(`audit: ${hits.length} hit(s) in ${scanned} files`);
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log(`audit: ok (${scanned} text files scanned, 0 hits)`);
