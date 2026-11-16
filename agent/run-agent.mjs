// The agent loop: model + tools + loop + context.
// Emits the agent event protocol ({ t, type, ... }) through `emit`; errors
// become `error` events and `run_end` is always emitted. Never throws.
import { toLlmTools } from "./llm/index.mjs";

export const RUBRIC_URI = "playbook://pitch-rubric";
export const TOOL_TIMEOUT_MS = 20_000;

export function buildSystemPrompt(rubric) {
  return [
    "You are a sharp, encouraging startup co-founder helping a student founder pressure-test an idea.",
    "Use the tools from the startup-cofounder MCP server. Call each of these four tools exactly once, in this order:",
    "1. size_market  2. scan_competitors  3. draft_landing_page  4. score_pitch.",
    "Before each tool call, say in one short sentence what you are doing and why.",
    "Give realistic assumptions and label them clearly as assumptions; do not present them as researched facts.",
    "Name competitors as categories of alternatives (for example \"spreadsheets + group chats\") unless a company is very well known.",
    "Score the pitch with the rubric below.",
    "After the last tool, finish with a short verdict: a bold one-line headline, 3-4 \"- \" bullets, and one next step. No tables, no headings.",
    "",
    "Pitch rubric:",
    rubric,
  ].join("\n");
}

function parseToolText(result) {
  const text = (result?.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return text ? { message: text } : {};
  }
}

export async function runAgent({ idea, llm, client, emit, maxSteps = 8, signal }) {
  const started = Date.now();
  const send = (type, data = {}) => {
    try {
      emit({ t: Date.now() - started, type, ...data });
    } catch {
      // A broken listener must not break the run.
    }
  };
  let steps = 0;

  try {
    const { tools: mcpTools } = await client.listTools();
    send("run_start", { idea, provider: llm.name, model: llm.model, tools: mcpTools.map((t) => t.name) });

    if (!llm.ready) throw new Error(llm.reason || `LLM provider "${llm.name}" is not ready`);

    const { resources = [] } = await client.listResources();
    const rubricMeta = resources.find((r) => r.uri === RUBRIC_URI);
    const rubricRes = await client.readResource({ uri: RUBRIC_URI });
    const rubric = rubricRes.contents?.map((c) => c.text ?? "").join("\n") ?? "";
    send("resource_read", { uri: RUBRIC_URI, title: rubricMeta?.title ?? rubricMeta?.name ?? "Pitch rubric" });

    const system = buildSystemPrompt(rubric);
    const tools = toLlmTools(mcpTools);
    const messages = [{ role: "user", content: [{ type: "text", text: `Startup idea: ${idea}` }] }];
    let finished = false;

    while (steps < maxSteps) {
      if (signal?.aborted) throw new Error("Run cancelled");
      steps += 1;
      const res = await llm.chat({ system, messages, tools, signal });
      const toolCalls = res.toolCalls ?? [];
      const text = (res.text ?? "").trim();

      if (toolCalls.length === 0) {
        send("final", { text });
        finished = true;
        break;
      }
      if (text) send("thinking", { text });

      const assistant = [];
      if (text) assistant.push({ type: "text", text });
      for (const call of toolCalls) assistant.push({ type: "tool_use", id: call.id, name: call.name, input: call.input ?? {} });
      messages.push({ role: "assistant", content: assistant });

      const results = [];
      for (const call of toolCalls) {
        if (signal?.aborted) throw new Error("Run cancelled");
        send("tool_call", { id: call.id, name: call.name, input: call.input ?? {} });
        const callStart = Date.now();
        let output;
        let isError;
        let resultText;
        try {
          const r = await client.callTool({ name: call.name, arguments: call.input ?? {} }, undefined, {
            timeout: TOOL_TIMEOUT_MS,
            signal,
          });
          isError = Boolean(r.isError);
          output = r.structuredContent ?? parseToolText(r);
          resultText = (r.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n") || JSON.stringify(output);
        } catch (err) {
          if (signal?.aborted) throw new Error("Run cancelled");
          isError = true;
          output = { error: err.message };
          resultText = `Error: ${err.message}`;
        }
        send("tool_result", { id: call.id, name: call.name, output, isError, ms: Date.now() - callStart });
        results.push({ type: "tool_result", tool_use_id: call.id, content: resultText, is_error: isError });
      }
      messages.push({ role: "user", content: results });
    }

    if (!finished) send("error", { message: `Stopped after ${maxSteps} steps without a final answer` });
  } catch (err) {
    send("error", { message: err?.message ?? String(err) });
  } finally {
    send("run_end", { steps, ms: Date.now() - started });
  }
}
