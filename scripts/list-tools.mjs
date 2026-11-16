// Connects to the MCP server over stdio like any MCP host would, lists its
// tools and resources, and calls size_market once.
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = fileURLToPath(new URL("../server/mcp-server.mjs", import.meta.url));

const client = new Client({ name: "list-tools", version: "1.0.0" });
const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], stderr: "ignore" });

try {
  await client.connect(transport);
  const info = client.getServerVersion();
  console.log(`Server: ${info.name} ${info.version}\n`);

  const { tools } = await client.listTools();
  console.log(`Tools (${tools.length}):`);
  for (const t of tools) {
    const params = Object.keys(t.inputSchema?.properties ?? {}).join(", ");
    console.log(`  - ${t.name}(${params})`);
  }

  const { resources } = await client.listResources();
  console.log(`\nResources (${resources.length}):`);
  for (const r of resources) console.log(`  - ${r.uri}  ${r.title ?? r.name} [${r.mimeType}]`);

  const result = await client.callTool({
    name: "size_market",
    arguments: {
      segment: "Example segment",
      customer_count: 1000,
      annual_price_usd: 100,
      serviceable_share: 0.5,
      obtainable_share: 0.1,
      assumptions: ["Example numbers for a smoke test"],
    },
  });
  console.log(`\ncall size_market -> ${JSON.stringify(result.structuredContent)}`);
} finally {
  await client.close();
}
