// LLM provider selection. Every provider implements the same interface:
//   { name, model, ready, reason, chat({ system, messages, tools, signal }) }
// chat resolves to { text, toolCalls: [{ id, name, input }], stopReason }.
// Messages are Anthropic-shaped:
//   { role: "user"|"assistant", content: [
//       { type: "text", text } |
//       { type: "tool_use", id, name, input } |
//       { type: "tool_result", tool_use_id, content, is_error } ] }
// Tools are [{ name, description, input_schema }].
import { createAnthropicLLM } from "./anthropic.mjs";
import { createBedrockLLM } from "./bedrock.mjs";
import { createMockLLM } from "./mock.mjs";

export const PROVIDERS = {
  mock: createMockLLM,
  anthropic: createAnthropicLLM,
  bedrock: createBedrockLLM,
};

export function createLLM(env = process.env) {
  const name = String(env.LLM_PROVIDER ?? "").trim().toLowerCase() || "mock";
  const factory = PROVIDERS[name];
  if (!factory) {
    throw new Error(
      `Unknown LLM_PROVIDER "${env.LLM_PROVIDER}". Valid values: ${Object.keys(PROVIDERS).join(", ")}.`,
    );
  }
  return factory(env);
}

// Removes the top-level "$schema" key that the MCP SDK adds to JSON Schemas;
// model providers reject or ignore it.
export function stripSchema(schema) {
  if (!schema || typeof schema !== "object") return { type: "object", properties: {} };
  const { $schema, ...rest } = schema;
  return rest;
}

// Converts MCP tools (from client.listTools()) to the provider-neutral shape.
export function toLlmTools(mcpTools) {
  return mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? t.title ?? t.name,
    input_schema: stripSchema(t.inputSchema),
  }));
}
