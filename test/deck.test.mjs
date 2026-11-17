import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const WEB = path.join(ROOT, "web");
const DIST = path.join(ROOT, "dist");
const html = readFileSync(path.join(WEB, "index.html"), "utf8");

function slideBlocks(src) {
  return src.split(/<section class="slide/).slice(1).map((s) => s.slice(0, s.indexOf("</section>")));
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test("deck has 18-20 slides, each with notes and data-minutes summing to 30", () => {
  const blocks = slideBlocks(html);
  assert.ok(blocks.length >= 18 && blocks.length <= 20, `slide count ${blocks.length}`);
  let sum = 0;
  blocks.forEach((b, i) => {
    const m = /data-minutes="([\d.]+)"/.exec(b);
    assert.ok(m, `slide ${i + 1} has data-minutes`);
    sum += Number(m[1]);
    assert.match(b, /data-title="[^"]+"/, `slide ${i + 1} has data-title`);
    const notes = /<aside class="notes">([\s\S]*?)<\/aside>/.exec(b);
    assert.ok(notes && notes[1].trim().length > 20, `slide ${i + 1} has notes`);
  });
  assert.ok(Math.abs(sum - 30) <= 0.5, `minutes sum ${sum}`);
});

test("slide 14 embeds the demo and slide 18 has the QR and contact placeholders", () => {
  const blocks = slideBlocks(html);
  assert.match(blocks[13], /<iframe class="demo-frame" src="demo\/index.html"/);
  assert.match(blocks[17], /src="assets\/qr.svg"/);
  assert.match(blocks[17], /href="\{\{CONTACT_URL\}\}"/);
  assert.match(blocks[17], /\{\{CONTACT_LABEL\}\}/);
});

test("web/ uses only relative, local asset paths", () => {
  const files = walk(WEB).filter((f) => /\.(html|css|js)$/.test(f));
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const rel = path.relative(ROOT, f);
    assert.doesNotMatch(src, /(?:src|href)="\/|url\(\s*["']?\//, `${rel}: leading-slash path`);
    const refs = [...src.matchAll(/(?:src|href)="([^"]*)"|url\(\s*["']?([^"')]+)/g)].map((m) => m[1] ?? m[2]);
    for (const ref of refs) {
      assert.doesNotMatch(ref, /^[a-z]+:\/\//i, `${rel}: external reference ${ref}`);
    }
  }
});

test("dist build output (skipped before the first build)", { skip: !existsSync(path.join(DIST, "index.html")) }, () => {
  const out = readFileSync(path.join(DIST, "index.html"), "utf8");
  assert.ok(out.includes('href="https://github.com/discofuchsia"'));
  assert.ok(!out.includes("{{CONTACT_"));
  assert.ok(existsSync(path.join(DIST, "assets", "qr.svg")));
  assert.match(readFileSync(path.join(DIST, "assets", "qr.svg"), "utf8"), /<svg/);
  assert.ok(existsSync(path.join(DIST, ".nojekyll")));
  for (const f of ["inter-latin-wght-normal.woff2", "jetbrains-mono-latin-400-normal.woff2", "jetbrains-mono-latin-700-normal.woff2"]) {
    assert.ok(existsSync(path.join(DIST, "assets", "fonts", f)), f);
  }
});
