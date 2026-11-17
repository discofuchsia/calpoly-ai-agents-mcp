// Build the static site: web/ -> dist/ (deck, demo UI, replay, fonts, QR). No server code.
import { cp, mkdir, readFile, readdir, rm, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB = path.join(ROOT, "web");
const DIST = path.join(ROOT, "dist");
const MODULES = path.join(ROOT, "node_modules");

const FONTS = [
  ["@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", "inter-latin-wght-normal.woff2"],
  ["@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2", "jetbrains-mono-latin-400-normal.woff2"],
  ["@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2", "jetbrains-mono-latin-700-normal.woff2"],
  ["@fontsource-variable/inter/LICENSE", "inter-LICENSE.txt"],
  ["@fontsource/jetbrains-mono/LICENSE", "jetbrains-mono-LICENSE.txt"],
];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function countFiles(dir) {
  let n = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? await countFiles(path.join(dir, entry.name)) : 1;
  }
  return n;
}

const config = JSON.parse(await readFile(path.join(ROOT, "talk.config.json"), "utf8"));
const contactUrl = String(config.contactUrl || "");
const contactLabel = String(config.contactLabel || contactUrl);
if (!/^https:\/\/[^\s"'<>]+$/.test(contactUrl)) {
  throw new Error(`talk.config.json contactUrl must be an https URL, got: ${contactUrl}`);
}

await rm(DIST, { recursive: true, force: true });
await cp(WEB, DIST, { recursive: true, filter: (src) => path.basename(src) !== ".DS_Store" });

const indexPath = path.join(DIST, "index.html");
const html = (await readFile(indexPath, "utf8"))
  .replaceAll("{{CONTACT_URL}}", escapeHtml(contactUrl))
  .replaceAll("{{CONTACT_LABEL}}", escapeHtml(contactLabel));
await writeFile(indexPath, html);

const assets = path.join(DIST, "assets");
const fonts = path.join(assets, "fonts");
await mkdir(fonts, { recursive: true });
const svg = await QRCode.toString(contactUrl, {
  type: "svg",
  margin: 1,
  color: { dark: "#0b0b12", light: "#ffffff" },
});
await writeFile(path.join(assets, "qr.svg"), svg);
for (const [from, to] of FONTS) await copyFile(path.join(MODULES, from), path.join(fonts, to));
await writeFile(path.join(DIST, ".nojekyll"), "");

console.log(`Built dist/ (${await countFiles(DIST)} files)`);
