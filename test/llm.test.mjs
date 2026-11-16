import { test } from "node:test";
import assert from "node:assert/strict";
import { createLLM, stripSchema, toLlmTools } from "../agent/llm/index.mjs";
import { fromConverseResponse, toConverseRequest } from "../agent/llm/bedrock.mjs";
import { fromAnthropicResponse } from "../agent/llm/anthropic.mjs";

test("no env selects the mock provider", () => {
  const llm = createLLM({});
  assert.equal(llm.name, "mock");
  assert.equal(llm.ready, true);
});

test("anthropic without a key is not ready and does not throw", () => {
  const llm = createLLM({ LLM_PROVIDER: "anthropic" });
  assert.equal(llm.name, "anthropic");
  assert.equal(llm.ready, false);
  assert.equal(llm.reason, "ANTHROPIC_API_KEY is not set");
  assert.equal(llm.model, "claude-sonnet-4-5");
});

test("anthropic with a key is ready and honors ANTHROPIC_MODEL", () => {
  const llm = createLLM({ LLM_PROVIDER: "Anthropic", ANTHROPIC_API_KEY: "test-placeholder", ANTHROPIC_MODEL: "m1" });
  assert.equal(llm.ready, true);
  assert.equal(llm.model, "m1");
});

test("bedrock uses defaults and env overrides", () => {
  assert.equal(createLLM({ LLM_PROVIDER: "bedrock" }).model, "us.anthropic.claude-sonnet-4-5-20250929-v1:0");
  assert.equal(createLLM({ LLM_PROVIDER: "bedrock", BEDROCK_MODEL_ID: "x" }).model, "x");
});

test("unknown provider throws a clear error listing valid values", () => {
  assert.throws(() => createLLM({ LLM_PROVIDER: "nope" }), /Unknown LLM_PROVIDER "nope".*mock, anthropic, bedrock/);
});

test("stripSchema removes $schema", () => {
  const tools = toLlmTools([{ name: "t", description: "d", inputSchema: { $schema: "x", type: "object", properties: { a: {} } } }]);
  assert.deepEqual(tools, [{ name: "t", description: "d", input_schema: { type: "object", properties: { a: {} } } }]);
  assert.equal("$schema" in stripSchema({ $schema: "x" }), false);
});

test("Bedrock Converse request conversion", () => {
  const req = toConverseRequest({
    modelId: "m",
    system: "sys",
    tools: [{ name: "t", description: "d", input_schema: { type: "object" } }],
    messages: [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }, { type: "tool_use", id: "1", name: "t", input: { a: 1 } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "{}", is_error: false }, { type: "tool_result", tool_use_id: "2", content: "bad", is_error: true }] },
    ],
  });
  assert.equal(req.modelId, "m");
  assert.deepEqual(req.system, [{ text: "sys" }]);
  assert.deepEqual(req.toolConfig.tools[0].toolSpec, { name: "t", description: "d", inputSchema: { json: { type: "object" } } });
  assert.deepEqual(req.messages[1].content, [{ text: "ok" }, { toolUse: { toolUseId: "1", name: "t", input: { a: 1 } } }]);
  assert.deepEqual(req.messages[2].content[0], { toolResult: { toolUseId: "1", content: [{ text: "{}" }], status: "success" } });
  assert.equal(req.messages[2].content[1].toolResult.status, "error");
});

test("Bedrock Converse response conversion", () => {
  const out = fromConverseResponse({
    stopReason: "tool_use",
    output: { message: { role: "assistant", content: [{ text: "thinking" }, { toolUse: { toolUseId: "9", name: "t", input: { b: 2 } } }] } },
  });
  assert.deepEqual(out, { text: "thinking", toolCalls: [{ id: "9", name: "t", input: { b: 2 } }], stopReason: "tool_use" });
});

test("Anthropic response conversion", () => {
  const out = fromAnthropicResponse({
    stop_reason: "tool_use",
    content: [{ type: "text", text: "hi" }, { type: "tool_use", id: "a", name: "t", input: { c: 3 } }],
  });
  assert.deepEqual(out, { text: "hi", toolCalls: [{ id: "a", name: "t", input: { c: 3 } }], stopReason: "tool_use" });
});

test("mock calls the 4 tools in order, then answers", async () => {
  const llm = createLLM({});
  const messages = [{ role: "user", content: [{ type: "text", text: "Startup idea: An app for college students" }] }];
  const names = [];
  for (let i = 0; i < 4; i++) {
    const r = await llm.chat({ system: "", messages, tools: [] });
    assert.equal(r.toolCalls.length, 1);
    const call = r.toolCalls[0];
    names.push(call.name);
    messages.push({ role: "assistant", content: [{ type: "tool_use", id: call.id, name: call.name, input: call.input }] });
    messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: call.id, content: "{}", is_error: false }] });
  }
  assert.deepEqual(names, ["size_market", "scan_competitors", "draft_landing_page", "score_pitch"]);
  const final = await llm.chat({ system: "", messages, tools: [] });
  assert.equal(final.toolCalls.length, 0);
  assert.match(final.text, /\*\*Verdict/);
});
