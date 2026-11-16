// Spawns the startup-cofounder MCP server as a child process and connects to
// it over stdio. No network listener is involved. The child gets the SDK's
// minimal default environment, so API keys are not passed to it.
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const SERVER_PATH = fileURLToPath(new URL("../server/mcp-server.mjs", import.meta.url));

export async function connectMcp({ name = "cofounder-agent", stderr = "ignore" } = {}) {
  const client = new Client({ name, version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [SERVER_PATH], stderr });
  await client.connect(transport);
  return {
    client,
    close: () => client.close(),
  };
}
