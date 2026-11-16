import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startServer } from "../backend/server.mjs";

let srv;
let tmp;
let base;

function request({ method = "GET", path: p = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: srv.port, method, path: p, headers: { Host: `127.0.0.1:${srv.port}`, ...headers } },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const runHeaders = () => ({ "Content-Type": "application/json", Origin: `http://127.0.0.1:${srv.port}` });

before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "backend-test-"));
  const root = path.join(tmp, "dist");
  await mkdir(path.join(root, "demo"), { recursive: true });
  await writeFile(path.join(root, "index.html"), "<!doctype html><title>deck</title>");
  await writeFile(path.join(root, "demo", "index.html"), "<!doctype html><title>demo</title>");
  await writeFile(path.join(tmp, "secret.txt"), "TOP-SECRET-CONTENT");
  srv = await startServer({ port: 0, root, env: { LLM_PROVIDER: "mock", MOCK_LATENCY_MS: "50" } });
  base = `http://127.0.0.1:${srv.port}`;
});

after(async () => {
  await srv.close();
  await rm(tmp, { recursive: true, force: true });
});

test("listens on 127.0.0.1 only", () => {
  assert.equal(srv.server.address().address, "127.0.0.1");
  assert.ok(srv.port > 0);
});

test("health reports provider without secrets", async () => {
  const r = await request({ path: "/api/health" });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body), { ok: true, provider: "mock", model: "scripted-demo", ready: true, reason: null });
  assert.equal(r.headers["x-content-type-options"], "nosniff");
});

test("serves static files and index.html for directories", async () => {
  const r = await request({ path: "/" });
  assert.equal(r.status, 200);
  assert.match(r.headers["content-type"], /text\/html/);
  assert.match(r.body, /deck/);
  const redirect = await request({ path: "/demo" });
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.location, "/demo/");
  const demo = await request({ path: "/demo/" });
  assert.match(demo.body, /demo/);
  assert.equal((await request({ path: "/missing.js" })).status, 404);
});

test("path traversal never returns content outside root", async () => {
  for (const p of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/demo/..%2f..%2fsecret.txt", "/%2e%2e%2fsecret.txt", "/../package.json"]) {
    const r = await request({ path: p });
    assert.ok([403, 404].includes(r.status), `${p} -> ${r.status}`);
    assert.ok(!r.body.includes("TOP-SECRET-CONTENT"), p);
  }
});

test("foreign Host is rejected with 421", async () => {
  const r = await request({ path: "/api/health", headers: { Host: "evil.example" } });
  assert.equal(r.status, 421);
});

test("foreign or missing Origin is rejected with 403", async () => {
  const body = JSON.stringify({ idea: "A good idea" });
  const evil = await request({ method: "POST", path: "/api/run", headers: { ...runHeaders(), Origin: "https://evil.example" }, body });
  assert.equal(evil.status, 403);
  const { Origin, ...noOrigin } = runHeaders();
  assert.equal((await request({ method: "POST", path: "/api/run", headers: noOrigin, body })).status, 403);
});

test("wrong content type is rejected with 415", async () => {
  const r = await request({ method: "POST", path: "/api/run", headers: { ...runHeaders(), "Content-Type": "text/plain" }, body: '{"idea":"abc"}' });
  assert.equal(r.status, 415);
});

test("bad bodies are rejected", async () => {
  const post = (body) => request({ method: "POST", path: "/api/run", headers: runHeaders(), body });
  assert.equal((await post("not json")).status, 400);
  assert.equal((await post(JSON.stringify({ idea: "x" }))).status, 400);
  assert.equal((await post(JSON.stringify({ idea: "y".repeat(501) }))).status, 400);
  const big = JSON.stringify({ idea: "z".repeat(5000) });
  assert.equal((await post(big)).status, 413);
  const declared = await request({ method: "POST", path: "/api/run", headers: { ...runHeaders(), "Content-Length": Buffer.byteLength(big) }, body: big });
  assert.equal(declared.status, 413);
  assert.equal((await request({ method: "GET", path: "/api/run" })).status, 405);
});

test("run streams NDJSON events ending in run_end; concurrent run gets 409", async () => {
  const res = await fetch(`${base}/api/run`, {
    method: "POST",
    headers: runHeaders(),
    body: JSON.stringify({ idea: "An app that matches college students with local farms" }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /application\/x-ndjson/);

  const busy = await request({ method: "POST", path: "/api/run", headers: runHeaders(), body: JSON.stringify({ idea: "Second idea" }) });
  assert.equal(busy.status, 409);

  const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(lines.length >= 10, `got ${lines.length} lines`);
  assert.equal(lines[0].type, "run_start");
  assert.equal(lines.at(-1).type, "run_end");
  assert.ok(lines.some((e) => e.type === "final"));
  assert.equal(lines.filter((e) => e.type === "tool_result" && e.isError === false).length, 4);
});
