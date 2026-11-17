import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { toolDefs } from "../server/tools.mjs";

const FILE = new URL("../web/demo/replays/sample.js", import.meta.url);
const TYPES = new Set(["run_start", "resource_read", "thinking", "tool_call", "tool_result", "final", "error", "run_end"]);

async function load() {
  const src = await readFile(FILE, "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox, { filename: "sample.js" });
  return { src, replay: sandbox.window.DEMO_REPLAY };
}

test("replay file has the expected schema", async () => {
  const { replay } = await load();
  assert.equal(replay.version, 1);
  assert.ok(!Number.isNaN(Date.parse(replay.recordedAt)));
  for (const k of ["idea", "provider", "model"]) assert.equal(typeof replay[k], "string");
  assert.ok(replay.idea.length >= 3);
  assert.ok(Array.isArray(replay.events) && replay.events.length > 0);
  for (const e of replay.events) {
    assert.ok(TYPES.has(e.type), `unknown type ${e.type}`);
    assert.equal(typeof e.t, "number");
  }
});

test("events are in ascending time and end with run_end", async () => {
  const { replay } = await load();
  const ts = replay.events.map((e) => e.t);
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i] >= ts[i - 1], `t not ascending at ${i}`);
  assert.equal(replay.events[0].type, "run_start");
  assert.equal(replay.events.at(-1).type, "run_end");
  assert.ok(replay.events.some((e) => e.type === "final"));
});

test("every tool_call has a matching tool_result with a known tool name", async () => {
  const { replay } = await load();
  const known = new Set(toolDefs.map((d) => d.name));
  const calls = replay.events.filter((e) => e.type === "tool_call");
  const results = new Map(replay.events.filter((e) => e.type === "tool_result").map((e) => [e.id, e]));
  assert.ok(calls.length >= 1);
  for (const c of calls) {
    assert.ok(known.has(c.name), `unknown tool ${c.name}`);
    const r = results.get(c.id);
    assert.ok(r, `no result for ${c.id}`);
    assert.equal(r.name, c.name);
  }
  assert.equal(results.size, calls.length);
});

test("replay contains no key-like strings", async () => {
  const { src } = await load();
  assert.doesNotMatch(src, /sk-ant-/);
  assert.doesNotMatch(src, /AKIA[0-9A-Z]{16}/);
});
