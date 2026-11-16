// Anthropic API provider. Key comes only from ANTHROPIC_API_KEY; never logged.
import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";

export function fromAnthropicResponse(resp) {
  const blocks = resp?.content ?? [];
  const text = blocks
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  const toolCalls = blocks
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ id: b.id, name: b.name, input: b.input ?? {} }));
  return { text, toolCalls, stopReason: resp?.stop_reason ?? null };
}

export function createAnthropicLLM(env = process.env) {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  const model = env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
  const ready = Boolean(apiKey);
  let client = null;

  return {
    name: "anthropic",
    model,
    ready,
    reason: ready ? null : "ANTHROPIC_API_KEY is not set",
    async chat({ system, messages, tools, signal }) {
      if (!ready) throw new Error("ANTHROPIC_API_KEY is not set");
      client ??= new Anthropic({ apiKey });
      const resp = await client.messages.create(
        { model, max_tokens: 2048, system, messages, tools },
        { signal },
      );
      return fromAnthropicResponse(resp);
    },
  };
}
