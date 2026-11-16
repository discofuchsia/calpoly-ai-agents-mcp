// "startup-cofounder" MCP server. Runs over stdio when executed directly:
// stdout carries only MCP JSON-RPC messages, logs go to stderr.
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RUBRIC_MARKDOWN, toolDefs } from "./tools.mjs";

export const SERVER_INFO = { name: "startup-cofounder", version: "1.0.0" };
export const RUBRIC_URI = "playbook://pitch-rubric";
export const RUBRIC_TITLE = "Pitch rubric";

export function createServer() {
  const server = new McpServer(SERVER_INFO);

  for (const def of toolDefs) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema,
        outputSchema: def.outputSchema,
      },
      async (args) => {
        const out = def.handler(args);
        return { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: out };
      },
    );
  }

  server.registerResource(
    "pitch-rubric",
    RUBRIC_URI,
    {
      title: RUBRIC_TITLE,
      description: "How the co-founder agent scores a pitch: criteria, weights and grade bands.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "text/markdown", text: RUBRIC_MARKDOWN }],
    }),
  );

  return server;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error(`[${SERVER_INFO.name}] MCP server ready on stdio`);
}
