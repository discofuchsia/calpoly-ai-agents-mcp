// Browser e2e against the built dist/ with puppeteer-core and the local Chrome.
// Cases a-d run from file:// with every non-local request aborted (proves offline).
// Case e runs the demo live against the mock backend on 127.0.0.1.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { startServer } from "../../backend/server.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIST = path.join(ROOT, "dist");
const DECK_URL = pathToFileURL(path.join(DIST, "index.html")).href;
const DEMO_URL = pathToFileURL(path.join(DIST, "demo", "index.html")).href;
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OFFLINE_OK = /^(file|data|about|blob):/;

if (!existsSync(path.join(DIST, "index.html"))) {
  console.error("dist/index.html missing: run npm run build first");
  process.exit(1);
}

const aborted = [];
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function guard(page, allow = OFFLINE_OK) {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (allow.test(req.url())) req.continue();
    else { aborted.push(req.url()); req.abort(); }
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(`console: ${msg.text()}`); });
  page.on("requestfailed", (req) => {
    if (!aborted.includes(req.url())) errors.push(`requestfailed: ${req.url()}`);
  });
}

const results = [];
async function run(name, fn) {
  const before = { aborted: aborted.length, errors: errors.length };
  try {
    await fn();
    assert.deepEqual(aborted.slice(before.aborted), [], "network requests were made");
    assert.deepEqual(errors.slice(before.errors), [], "page errors");
    results.push(["ok", name]);
    console.log(`ok - ${name}`);
  } catch (err) {
    results.push(["fail", name]);
    console.log(`not ok - ${name}\n  ${String(err && err.stack || err).split("\n").slice(0, 6).join("\n  ")}`);
  }
}

const activeTitle = (page) => page.$eval(".stage > .slide.active", (s) => s.getAttribute("data-title"));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-first-run", "--no-default-browser-check"] });
let server = null;
try {
  const deck = await browser.newPage();
  await deck.setViewport({ width: 1600, height: 900 });
  await guard(deck);

  await run("a. deck navigates all slides by keyboard from file://", async () => {
    await deck.goto(DECK_URL, { waitUntil: "load" });
    assert.equal(await activeTitle(deck), "Title");
    const total = await deck.$$eval(".stage > .slide", (s) => s.length);
    assert.equal(total, 19);
    const seen = new Set([1]);
    for (let i = 0; i < 200; i++) {
      if ((await deck.evaluate(() => location.hash)) === `#/${total}`) {
        const step = await deck.evaluate(() => document.querySelectorAll(".slide.active [data-step]:not(.shown)").length);
        if (step === 0) break;
      }
      await deck.keyboard.press("ArrowRight");
      seen.add(Number((await deck.evaluate(() => location.hash)).slice(2)));
    }
    assert.equal(await deck.evaluate(() => location.hash), "#/19");
    assert.equal(await activeTitle(deck), "Q&A");
    assert.equal(seen.size, 19, `visited ${[...seen].join(",")}`);
    await deck.keyboard.press("d");
    assert.equal(await activeTitle(deck), "Live demo");
    await deck.keyboard.press("End");
    assert.equal(await deck.evaluate(() => location.hash), "#/19");
  });

  await run("b. presenter view shows notes, runs a timer and follows the audience", async () => {
    const popupTarget = browser.waitForTarget((t) => t.url().endsWith("#presenter"), { timeout: 10000 });
    await deck.keyboard.press("p");
    const pres = await (await popupTarget).page();
    await guard(pres);
    await pres.waitForSelector("#pv-notes");
    const lastNotes = await deck.$eval(".stage > .slide:last-child .notes", (n) => n.textContent.trim());
    await pres.waitForFunction((t) => document.getElementById("pv-notes").textContent === t, { timeout: 5000 }, lastNotes);
    await deck.keyboard.press("Home");
    const firstNotes = await deck.$eval(".stage > .slide:first-child .notes", (n) => n.textContent.trim());
    await pres.waitForFunction((t) => document.getElementById("pv-notes").textContent === t, { timeout: 5000 }, firstNotes);
    await deck.keyboard.press("ArrowRight");
    await pres.waitForFunction(() => document.getElementById("pv-pos").textContent.startsWith("2 / 19"), { timeout: 5000 });
    const t1 = await pres.$eval("#pv-timer", (n) => n.textContent);
    await sleep(2100);
    const t2 = await pres.$eval("#pv-timer", (n) => n.textContent);
    assert.notEqual(t1, t2, "timer is running");
    // Presenter navigation drives the audience window too.
    await pres.bringToFront();
    await pres.keyboard.press("End");
    await deck.waitForFunction(() => location.hash === "#/19", { timeout: 5000 });
    await pres.close();
  });

  await run("c. replay demo completes offline with 4 result cards", async () => {
    const demo = await browser.newPage();
    await demo.setViewport({ width: 1920, height: 1080 });
    await guard(demo);
    await demo.goto(`${DEMO_URL}?mode=replay&speed=8`, { waitUntil: "load" });
    await demo.click("#run-btn");
    await demo.waitForSelector(".card.verdict", { timeout: 30000 });
    assert.equal(await demo.$$eval(".card:not(.verdict)", (c) => c.length), 4);
    assert.ok(await demo.$eval(".browser iframe", (f) => f.hasAttribute("srcdoc") && f.getAttribute("sandbox") === ""));
    await sleep(1600);
    const dial = await demo.$eval(".dial-num", (n) => n.textContent.trim());
    assert.ok(/^\d+$/.test(dial), `dial shows a number: ${dial}`);
    await demo.close();
  });

  await run("d. phone viewport uses reading mode and the title fits", async () => {
    const phone = await browser.newPage();
    await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await guard(phone);
    await phone.goto(DECK_URL, { waitUntil: "load" });
    assert.ok(await phone.evaluate(() => document.body.classList.contains("reading")));
    const box = await phone.$eval(".stage > .slide:first-child h1", (h) => {
      const r = h.getBoundingClientRect();
      return { left: r.left, right: r.right };
    });
    assert.ok(box.left >= 0 && box.right <= 390, `title box ${JSON.stringify(box)}`);
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= 390), "no horizontal overflow");
    await phone.close();
  });

  await run("e. live demo against the mock backend on 127.0.0.1", async () => {
    server = await startServer({ port: 0, root: DIST, env: { ...process.env, LLM_PROVIDER: "mock", MOCK_LATENCY_MS: "50" } });
    assert.equal(server.server.address().address, "127.0.0.1");
    const live = await browser.newPage();
    await live.setViewport({ width: 1920, height: 1080 });
    await guard(live, new RegExp(`^(data|about|blob):|^http://127\\.0\\.0\\.1:${server.port}/`));
    await live.goto(`http://127.0.0.1:${server.port}/demo/`, { waitUntil: "load" });
    await live.waitForFunction(() => !document.getElementById("mode-live").disabled, { timeout: 10000 });
    await live.click("#mode-live");
    assert.equal(await live.$eval("#mode-live", (b) => b.getAttribute("aria-checked")), "true");
    await live.click("#run-btn");
    await live.waitForSelector(".card.verdict", { timeout: 60000 });
    assert.equal(await live.$$eval(".card:not(.verdict)", (c) => c.length), 4);
    assert.match(await live.$eval("#provider-badge", (b) => b.textContent), /^live/);
    await live.close();
  });
} finally {
  await browser.close();
  if (server) await server.close();
}

const failed = results.filter((r) => r[0] === "fail").length;
console.log(`\n${results.length - failed}/${results.length} e2e cases passed`);
process.exit(failed ? 1 : 0);
