// Amazon Bedrock provider via the Converse API. Credentials come from the
// default AWS credential chain (AWS_PROFILE, AWS_REGION, ...), never from code.
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

export const DEFAULT_BEDROCK_MODEL = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
export const DEFAULT_BEDROCK_REGION = "us-west-2";

function toConverseBlock(block) {
  switch (block.type) {
    case "text":
      return block.text ? { text: block.text } : null;
    case "tool_use":
      return { toolUse: { toolUseId: block.id, name: block.name, input: block.input ?? {} } };
    case "tool_result": {
      const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
      return {
        toolResult: {
          toolUseId: block.tool_use_id,
          content: [{ text: text || "(empty)" }],
          status: block.is_error ? "error" : "success",
        },
      };
    }
    default:
      return null;
  }
}

export function toConverseRequest({ modelId, system, messages, tools, maxTokens = 2048 }) {
  const req = {
    modelId,
    messages: messages.map((m) => ({
      role: m.role,
      content: (typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content)
        .map(toConverseBlock)
        .filter(Boolean),
    })),
    inferenceConfig: { maxTokens },
  };
  if (system) req.system = [{ text: system }];
  if (tools?.length) {
    req.toolConfig = {
      tools: tools.map((t) => ({
        toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.input_schema } },
      })),
    };
  }
  return req;
}

export function fromConverseResponse(resp) {
  const blocks = resp?.output?.message?.content ?? [];
  const text = blocks
    .filter((b) => typeof b.text === "string")
    .map((b) => b.text)
    .join("\n")
    .trim();
  const toolCalls = blocks
    .filter((b) => b.toolUse)
    .map((b) => ({ id: b.toolUse.toolUseId, name: b.toolUse.name, input: b.toolUse.input ?? {} }));
  return { text, toolCalls, stopReason: resp?.stopReason ?? null };
}

export function createBedrockLLM(env = process.env) {
  const model = env.BEDROCK_MODEL_ID?.trim() || DEFAULT_BEDROCK_MODEL;
  const region = env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim() || DEFAULT_BEDROCK_REGION;
  let client = null;

  return {
    name: "bedrock",
    model,
    // Credentials resolve lazily on the first call; a missing profile surfaces as an error event.
    ready: true,
    reason: null,
    async chat({ system, messages, tools, signal }) {
      client ??= new BedrockRuntimeClient({ region });
      const resp = await client.send(
        new ConverseCommand(toConverseRequest({ modelId: model, system, messages, tools })),
        { abortSignal: signal },
      );
      return fromConverseResponse(resp);
    },
  };
}
