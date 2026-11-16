import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server/mcp-server.mjs";
import { connectMcp } from "../agent/mcp-client.mjs";

const NAMES = ["size_market", "scan_competitors", "draft_landing_page", "score_pitch"];

const VALID = {
  size_market: {
    segment: "Students",
    customer_count: 100,
    annual_price_usd: 10,
    serviceable_share: 0.5,
    obtainable_share: 0.5,
    assumptions: ["test"],
  },
  scan_competitors: {
    idea: "x",
    competitors: [{ name: "Spreadsheets", kind: "status_quo", strengths: ["Free"], weaknesses: ["Manual"] }],
    our_edge: "Automatic",
  },
  draft_landing_page: {
    product_name: "P",
    headline: "H",
    subheadline: "S",
    features: [
      { title: "a", body: "b" },
      { title: "c", body: "d" },
      { title: "e", body: "f" },
    ],
    cta: "Go",
    accent_hex: "#112233",
  },
  score_pitch: Object.fromEntries(
    ["problem", "market", "differentiation", "feasibility", "business_model"].map((k) => [k, { score: 5, rationale: k }]),
  ),
};

let client;
let server;

before(async () => {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  server = createServer();
  client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
});

after(async () => {
  await client.close();
  await server.close();
});

test("server identifies as startup-cofounder", () => {
  assert.deepEqual(client.getServerVersion(), { name: "startup-cofounder", version: "1.0.0" });
});

test("listTools returns the 4 tools with input and output schemas", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), NAMES);
  for (const t of tools) {
    assert.equal(t.inputSchema.type, "object");
    assert.ok(Object.keys(t.inputSchema.properties).length > 0, `${t.name} has input properties`);
    assert.equal(t.outputSchema?.type, "object");
    assert.ok(t.description);
  }
});

test("each tool returns structuredContent and matching text", async () => {
  for (const name of NAMES) {
    const r = await client.callTool({ name, arguments: VALID[name] });
    assert.notEqual(r.isError, true, name);
    assert.ok(r.structuredContent, name);
    assert.deepEqual(JSON.parse(r.content[0].text), r.structuredContent);
  }
});

test("invalid input returns isError", async () => {
  const r = await client.callTool({ name: "draft_landing_page", arguments: { ...VALID.draft_landing_page, accent_hex: "red" } });
  assert.equal(r.isError, true);
  const r2 = await client.callTool({ name: "size_market", arguments: { ...VALID.size_market, customer_count: -1 } });
  assert.equal(r2.isError, true);
});

test("pitch rubric resource can be listed and read", async () => {
  const { resources } = await client.listResources();
  const rubric = resources.find((r) => r.uri === "playbook://pitch-rubric");
  assert.ok(rubric);
  assert.equal(rubric.mimeType, "text/markdown");
  const { contents } = await client.readResource({ uri: "playbook://pitch-rubric" });
  assert.match(contents[0].text, /Differentiation \| 25%/);
});

test("server works over a real stdio child process", async () => {
  const mcp = await connectMcp();
  try {
    const { tools } = await mcp.client.listTools();
    assert.deepEqual(tools.map((t) => t.name), NAMES);
    const r = await mcp.client.callTool({ name: "size_market", arguments: VALID.size_market });
    assert.equal(r.structuredContent.som_usd, 250);
  } finally {
    await mcp.close();
  }
});
