// Local demo backend. Binds only to 127.0.0.1 (hard-coded, not configurable).
//   GET  /api/health  -> { ok, provider, model, ready, reason }
//   POST /api/run     -> NDJSON stream of agent events
//   GET  /*           -> static files from dist/
// Host allowlist (DNS rebinding), Origin check on POST, JSON-only bodies
// (forces a CORS preflight we never answer), 4 KB body cap, one run at a time.
import http from "node:http";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLLM } from "../agent/llm/index.mjs";
import { connectMcp } from "../agent/mcp-client.mjs";
import { runAgent } from "../agent/run-agent.mjs";

const HOST = "127.0.0.1";
const MAX_BODY_BYTES = 4096;
const DEFAULT_ROOT = fileURLToPath(new URL("../dist", import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body === "object";
  const payload = isJson ? JSON.stringify(body) : String(body ?? "");
  res.writeHead(status, {
    "Content-Type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        // Stop buffering but keep draining, so the 413 response can still be delivered.
        if (!tooLarge) reject(Object.assign(new Error("Body too large"), { status: 413 }));
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!tooLarge) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

export async function startServer({ port = Number(process.env.PORT ?? 8787), root = DEFAULT_ROOT, env = process.env } = {}) {
  const llm = createLLM(env);
  const rootDir = path.resolve(root);
  let activeRun = null;
  let actualPort = port;

  const allowedHosts = () => new Set([`${HOST}:${actualPort}`, `localhost:${actualPort}`]);
  const allowedOrigins = () => new Set([`http://${HOST}:${actualPort}`, `http://localhost:${actualPort}`]);

  async function handleRun(req, res) {
    const origin = req.headers.origin;
    if (!origin || !allowedOrigins().has(origin)) return send(res, 403, { error: "Forbidden origin" });
    const ctype = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (ctype !== "application/json") return send(res, 415, { error: "Content-Type must be application/json" });
    if (Number(req.headers["content-length"] ?? 0) > MAX_BODY_BYTES) {
      return send(res, 413, { error: "Body too large" }, { Connection: "close" });
    }

    let body;
    try {
      body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (err) {
      if (err.status === 413) return send(res, 413, { error: "Body too large" }, { Connection: "close" });
      return send(res, 400, { error: "Invalid JSON" });
    }
    const idea = typeof body?.idea === "string" ? body.idea.trim() : "";
    if (idea.length < 3 || idea.length > 500) return send(res, 400, { error: "idea must be 3-500 characters" });
    if (activeRun) return send(res, 409, { error: "A run is already in progress" });

    const controller = new AbortController();
    activeRun = controller;
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.on("close", () => {
      if (!res.writableFinished) controller.abort();
    });

    const emit = (event) => {
      if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify(event) + "\n");
    };
    let mcp = null;
    try {
      mcp = await connectMcp();
      await runAgent({ idea, llm, client: mcp.client, emit, signal: controller.signal });
    } catch (err) {
      emit({ t: 0, type: "error", message: err.message });
      emit({ t: 0, type: "run_end", steps: 0, ms: 0 });
    } finally {
      activeRun = null;
      await mcp?.close().catch(() => {});
      if (!res.writableEnded) res.end();
    }
  }

  async function handleStatic(req, res, pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return send(res, 400, "Bad request");
    }
    if (decoded.includes("\0")) return send(res, 400, "Bad request");
    // Resolve without clamping so any ".." that escapes root is rejected, not rewritten.
    let file = path.resolve(rootDir, "." + decoded);
    if (file !== rootDir && !file.startsWith(rootDir + path.sep)) return send(res, 403, "Forbidden");

    try {
      let info = await stat(file);
      if (info.isDirectory()) {
        if (!pathname.endsWith("/")) return send(res, 301, "", { Location: pathname + "/" });
        file = path.join(file, "index.html");
        info = await stat(file);
      }
      if (!info.isFile()) return send(res, 404, "Not found");
      const data = await readFile(file);
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": data.length,
        "Cache-Control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      send(res, 404, "Not found");
    }
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      if (!allowedHosts().has(String(req.headers.host ?? "").toLowerCase())) {
        return send(res, 421, "Misdirected request");
      }
      const { pathname } = new URL(req.url, `http://${HOST}`);

      if (pathname === "/api/health") {
        if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" }, { Allow: "GET" });
        return send(res, 200, { ok: true, provider: llm.name, model: llm.model, ready: llm.ready, reason: llm.reason });
      }
      if (pathname === "/api/run") {
        if (req.method !== "POST") return send(res, 405, { error: "Method not allowed" }, { Allow: "POST" });
        return await handleRun(req, res);
      }
      if (pathname.startsWith("/api/")) return send(res, 404, { error: "Not found" });
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", { Allow: "GET, HEAD" });
      return await handleStatic(req, res, pathname);
    } catch (err) {
      if (!res.headersSent) send(res, 500, "Internal error");
      else res.end();
      console.error("[backend] request failed:", err.message);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  actualPort = server.address().port;

  return {
    server,
    port: actualPort,
    llm,
    close: () =>
      new Promise((resolve) => {
        activeRun?.abort();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  if (!existsSync(path.join(DEFAULT_ROOT, "index.html"))) {
    console.error("dist/index.html is missing: run npm run build");
    process.exit(1);
  }
  try {
    const { port, llm, close } = await startServer();
    console.error(`Demo backend: http://${HOST}:${port}/`);
    console.error(`LLM provider: ${llm.name} (${llm.model})${llm.ready ? "" : ` - not ready: ${llm.reason}`}`);
    const stop = () => close().then(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (err) {
    console.error(`Failed to start: ${err.message}`);
    process.exit(1);
  }
}
