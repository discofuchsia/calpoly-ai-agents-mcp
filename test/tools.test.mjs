import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CRITERIA,
  RUBRIC_MARKDOWN,
  draftLandingPage,
  escapeHtml,
  scanCompetitors,
  scorePitch,
  sizeMarket,
  threatLevel,
  toolDefs,
} from "../server/tools.mjs";

test("sizeMarket computes TAM, SAM and SOM rounded to whole dollars", () => {
  const out = sizeMarket({
    segment: "Students",
    customer_count: 1234,
    annual_price_usd: 9.99,
    serviceable_share: 0.3,
    obtainable_share: 0.07,
    assumptions: ["a"],
  });
  assert.equal(out.tam_usd, Math.round(1234 * 9.99));
  assert.equal(out.sam_usd, Math.round(1234 * 9.99 * 0.3));
  assert.equal(out.som_usd, Math.round(1234 * 9.99 * 0.3 * 0.07));
  assert.match(out.formula, /TAM = 1,234 customers/);
  assert.deepEqual(out.assumptions, ["a"]);
});

test("threat levels follow kind and strengths", () => {
  assert.equal(threatLevel({ kind: "direct", strengths: [] }), "high");
  assert.equal(threatLevel({ kind: "indirect", strengths: [] }), "medium");
  assert.equal(threatLevel({ kind: "status_quo", strengths: ["a", "b"] }), "medium");
  assert.equal(threatLevel({ kind: "status_quo", strengths: ["a"] }), "low");
});

test("scanCompetitors finds white space the edge addresses, else all weaknesses", () => {
  const competitors = [
    { name: "A", kind: "direct", strengths: [], weaknesses: ["No payments", "Slow support"] },
    { name: "B", kind: "status_quo", strengths: ["Free"], weaknesses: ["Manual scheduling"] },
  ];
  const hit = scanCompetitors({ idea: "x", competitors, our_edge: "Built-in payments and scheduling" });
  assert.deepEqual(hit.white_space, ["No payments", "Manual scheduling"]);
  assert.deepEqual(hit.competitors.map((c) => c.threat), ["high", "low"]);
  assert.match(hit.summary, /1 high, 0 medium, 1 low/);

  const miss = scanCompetitors({ idea: "x", competitors, our_edge: "Prettier colors" });
  assert.deepEqual(miss.white_space, ["No payments", "Slow support", "Manual scheduling"]);
});

test("draftLandingPage escapes every text field and has no scripts", () => {
  const evil = '<script>alert("x")</script>';
  const out = draftLandingPage({
    product_name: evil,
    headline: evil,
    subheadline: evil,
    features: [
      { title: evil, body: evil },
      { title: evil, body: evil },
      { title: evil, body: evil },
    ],
    cta: evil,
    accent_hex: "#7c5cff",
  });
  assert.ok(!out.html.includes("<script"), "raw <script> must not appear");
  // 10 text fields; product_name appears twice (<title> and header).
  assert.equal(out.html.split("&lt;script&gt;").length - 1, 11);
  assert.ok(out.html.includes("#7c5cff"));
  assert.ok(out.word_count > 0);
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("scorePitch applies weights, grade and top risk", () => {
  const s = (score, rationale) => ({ score, rationale });
  const out = scorePitch({
    problem: s(10, "p"),
    market: s(10, "m"),
    differentiation: s(10, "d"),
    feasibility: s(10, "f"),
    business_model: s(2, "money is unclear"),
  });
  assert.equal(out.total, 25 + 20 + 25 + 15 + 3);
  assert.equal(out.grade, "A");
  assert.equal(out.top_risk, "money is unclear");
  assert.equal(out.next_step, CRITERIA.find((c) => c.key === "business_model").next_step);
  assert.deepEqual(out.breakdown.map((b) => b.weight), [25, 20, 25, 15, 15]);

  const mid = scorePitch({
    problem: s(7, "p"),
    market: s(6, "m"),
    differentiation: s(6, "d"),
    feasibility: s(8, "f"),
    business_model: s(5, "b"),
  });
  assert.equal(mid.total, 64);
  assert.equal(mid.grade, "C");
  assert.equal(mid.top_risk, "b");
  assert.equal(scorePitch({ problem: s(1, "p"), market: s(1, "m"), differentiation: s(1, "d"), feasibility: s(1, "f"), business_model: s(1, "b") }).grade, "D");
});

test("weights sum to 100 and appear in the rubric", () => {
  assert.equal(CRITERIA.reduce((n, c) => n + c.weight, 0), 100);
  for (const c of CRITERIA) assert.ok(RUBRIC_MARKDOWN.includes(`| ${c.label} | ${c.weight}% |`));
  assert.deepEqual(toolDefs.map((d) => d.name), ["size_market", "scan_competitors", "draft_landing_page", "score_pitch"]);
});
