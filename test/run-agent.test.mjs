import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server/mcp-server.mjs";
import { createLLM } from "../agent/llm/index.mjs";
import { runAgent } from "../agent/run-agent.mjs";

let client;
let server;

beforeEach(async () => {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  server = createServer();
  client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
});

afterEach(async () => {
  await client.close();
  await server.close();
});

async function collect(llm, opts = {}) {
  const events = [];
  await runAgent({ idea: "An app that matches students with local farms", llm, client, emit: (e) => events.push(e), ...opts });
  return events;
}

test("happy path with the mock LLM emits the protocol in order", async () => {
  const events = await collect(createLLM({}));
  const types = events.map((e) => e.type);
  const expected = ["run_start", "resource_read"];
  for (let i = 0; i < 4; i++) expected.push("thinking", "tool_call", "tool_result");
  expected.push("final", "run_end");
  assert.deepEqual(types, expected);

  assert.equal(events[0].provider, "mock");
  assert.deepEqual(events[0].tools, ["size_market", "scan_competitors", "draft_landing_page", "score_pitch"]);
  assert.equal(events[1].uri, "playbook://pitch-rubric");
  const results = events.filter((e) => e.type === "tool_result");
  assert.deepEqual(results.map((r) => r.name), ["size_market", "scan_competitors", "draft_landing_page", "score_pitch"]);
  for (const r of results) {
    assert.equal(r.isError, false, r.name);
    assert.equal(typeof r.ms, "number");
    assert.ok(r.output);
  }
  assert.match(events.at(-2).text, /Pitch score:\*\* \d+\/100/);
  assert.equal(events.at(-1).steps, 5);
  for (let i = 1; i < events.length; i++) assert.ok(events[i].t >= events[i - 1].t);
});

test("an LLM that never stops hits maxSteps", async () => {
  let n = 0;
  const looping = {
    name: "fake",
    model: "loop",
    ready: true,
    reason: null,
    async chat() {
      n += 1;
      return { text: "", toolCalls: [{ id: `c${n}`, name: "size_market", input: { segment: "s", customer_count: 1, annual_price_usd: 1, serviceable_share: 1, obtainable_share: 1, assumptions: [] } }], stopReason: "tool_use" };
    },
  };
  const events = await collect(looping, { maxSteps: 3 });
  assert.equal(n, 3);
  assert.equal(events.at(-2).type, "error");
  assert.match(events.at(-2).message, /3 steps/);
  assert.deepEqual(events.at(-1).type, "run_end");
  assert.equal(events.at(-1).steps, 3);
});

test("an unknown tool becomes an error result fed back to the model", async () => {
  let seen = null;
  const fake = {
    name: "fake",
    model: "unknown-tool",
    ready: true,
    reason: null,
    async chat({ messages }) {
      const last = messages.at(-1);
      if (last.content[0].type === "tool_result") {
        seen = last.content[0];
        return { text: "done", toolCalls: [], stopReason: "end_turn" };
      }
      return { text: "", toolCalls: [{ id: "x1", name: "does_not_exist", input: {} }], stopReason: "tool_use" };
    },
  };
  const events = await collect(fake);
  const result = events.find((e) => e.type === "tool_result");
  assert.equal(result.isError, true);
  assert.equal(seen.is_error, true);
  assert.equal(events.at(-2).type, "final");
  assert.equal(events.at(-1).type, "run_end");
});

test("a provider that is not ready yields error and run_end, no throw", async () => {
  const events = await collect(createLLM({ LLM_PROVIDER: "anthropic" }));
  assert.deepEqual(events.map((e) => e.type), ["run_start", "error", "run_end"]);
  assert.match(events[1].message, /ANTHROPIC_API_KEY/);
});
