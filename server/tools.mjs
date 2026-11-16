// Pure tool logic for the "startup-cofounder" MCP server.
// Every tool computes only from assumptions the caller supplies. No network,
// no external data: results are labeled as assumption-based.
import { z } from "zod";

// ---------- helpers ----------

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

const STOPWORDS = new Set([
  "about", "after", "also", "and", "are", "but", "can", "for", "from", "have", "into", "just",
  "more", "most", "not", "our", "than", "that", "the", "their", "them", "then", "they", "this",
  "too", "very", "was", "were", "what", "when", "with", "without", "you", "your",
]);

function keywords(text) {
  return new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
      .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w)),
  );
}

function usd(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

// ---------- size_market ----------

export const sizeMarketInput = {
  segment: z.string().min(1).max(200).describe("Who the customers are"),
  customer_count: z.number().int().positive().describe("Number of potential customers in the segment"),
  annual_price_usd: z.number().positive().describe("Expected annual revenue per customer, in USD"),
  serviceable_share: z.number().min(0).max(1).describe("Share of the market you can serve (0..1)"),
  obtainable_share: z.number().min(0).max(1).describe("Share of the serviceable market you can win (0..1)"),
  assumptions: z.array(z.string().max(300)).max(10).describe("The assumptions behind these numbers"),
};

export const sizeMarketOutput = {
  segment: z.string(),
  tam_usd: z.number(),
  sam_usd: z.number(),
  som_usd: z.number(),
  formula: z.string(),
  assumptions: z.array(z.string()),
};

export function sizeMarket({ segment, customer_count, annual_price_usd, serviceable_share, obtainable_share, assumptions }) {
  const tam = customer_count * annual_price_usd;
  const sam = tam * serviceable_share;
  const som = sam * obtainable_share;
  return {
    segment,
    tam_usd: Math.round(tam),
    sam_usd: Math.round(sam),
    som_usd: Math.round(som),
    formula:
      `TAM = ${customer_count.toLocaleString("en-US")} customers x ${usd(annual_price_usd)}/yr = ${usd(tam)}; ` +
      `SAM = TAM x ${serviceable_share} = ${usd(sam)}; SOM = SAM x ${obtainable_share} = ${usd(som)}`,
    assumptions: [...assumptions],
  };
}

// ---------- scan_competitors ----------

const competitorShape = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["direct", "indirect", "status_quo"]),
  strengths: z.array(z.string().max(200)).max(8),
  weaknesses: z.array(z.string().max(200)).max(8),
});

export const scanCompetitorsInput = {
  idea: z.string().min(1).max(500),
  competitors: z.array(competitorShape).min(1).max(6).describe("Alternatives customers use today"),
  our_edge: z.string().min(1).max(300).describe("What this idea does better"),
};

export const scanCompetitorsOutput = {
  competitors: z.array(
    competitorShape.extend({ threat: z.enum(["high", "medium", "low"]) }),
  ),
  white_space: z.array(z.string()),
  summary: z.string(),
};

export function threatLevel({ kind, strengths }) {
  if (kind === "direct") return "high";
  if (kind === "indirect") return "medium";
  return strengths.length >= 2 ? "medium" : "low";
}

export function scanCompetitors({ idea, competitors, our_edge }) {
  const rated = competitors.map((c) => ({ ...c, threat: threatLevel(c) }));
  const edge = keywords(our_edge);
  const allWeaknesses = [...new Set(rated.flatMap((c) => c.weaknesses))];
  const addressed = allWeaknesses.filter((w) => [...keywords(w)].some((k) => edge.has(k)));
  const white_space = addressed.length > 0 ? addressed : allWeaknesses;
  const count = (level) => rated.filter((c) => c.threat === level).length;
  const summary =
    `${rated.length} alternative${rated.length === 1 ? "" : "s"} assessed for "${idea}": ` +
    `${count("high")} high, ${count("medium")} medium, ${count("low")} low threat. ` +
    (addressed.length > 0
      ? `Our edge ("${our_edge}") addresses ${addressed.length} known weakness${addressed.length === 1 ? "" : "es"}.`
      : `Our edge ("${our_edge}") does not clearly address a listed weakness yet.`) +
    " Based on the supplied assumptions, not market research.";
  return { competitors: rated, white_space, summary };
}

// ---------- draft_landing_page ----------

export const draftLandingPageInput = {
  product_name: z.string().min(1).max(60),
  headline: z.string().min(1).max(120),
  subheadline: z.string().min(1).max(240),
  features: z
    .array(z.object({ title: z.string().min(1).max(60), body: z.string().min(1).max(240) }))
    .length(3)
    .describe("Exactly three features"),
  cta: z.string().min(1).max(40).describe("Call-to-action button text"),
  accent_hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe("Accent color, e.g. #7c5cff"),
};

export const draftLandingPageOutput = {
  html: z.string(),
  word_count: z.number().int(),
};

export function draftLandingPage({ product_name, headline, subheadline, features, cta, accent_hex }) {
  const e = escapeHtml;
  const accent = e(accent_hex);
  const featureHtml = features
    .map((f) => `<div class="card"><h3>${e(f.title)}</h3><p>${e(f.body)}</p></div>`)
    .join("");
  const html =
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${e(product_name)}</title><style>` +
    `*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0d0d14;color:#f4f4f8;line-height:1.5}` +
    `header{padding:20px 32px;font-weight:700;letter-spacing:.02em;color:${accent}}` +
    `.hero{padding:48px 32px 32px;max-width:880px}` +
    `h1{font-size:44px;line-height:1.1;margin:0 0 16px}` +
    `.sub{font-size:20px;color:#b9b9c9;margin:0 0 28px}` +
    `.cta{display:inline-block;background:${accent};color:#0d0d14;font-weight:700;padding:14px 26px;border-radius:999px}` +
    `.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;padding:16px 32px 48px}` +
    `.card{background:#17172a;border:1px solid #2a2a44;border-top:3px solid ${accent};border-radius:14px;padding:20px}` +
    `.card h3{margin:0 0 8px;font-size:18px}.card p{margin:0;color:#b9b9c9}` +
    `</style></head><body>` +
    `<header>${e(product_name)}</header>` +
    `<main><section class="hero"><h1>${e(headline)}</h1><p class="sub">${e(subheadline)}</p>` +
    `<span class="cta">${e(cta)}</span></section>` +
    `<section class="grid">${featureHtml}</section></main></body></html>`;
  const text = [product_name, headline, subheadline, cta, ...features.flatMap((f) => [f.title, f.body])].join(" ");
  const word_count = text.split(/\s+/).filter(Boolean).length;
  return { html, word_count };
}

// ---------- score_pitch ----------

export const CRITERIA = [
  { key: "problem", label: "Problem", weight: 25, next_step: "Interview target customers this week and write down their exact words about the pain." },
  { key: "market", label: "Market", weight: 20, next_step: "Test the market assumptions with a small real signal, such as a landing page with a waitlist or pre-order." },
  { key: "differentiation", label: "Differentiation", weight: 25, next_step: "Name one thing you do that alternatives cannot copy quickly, and test it with users." },
  { key: "feasibility", label: "Feasibility", weight: 15, next_step: "Build the smallest version that delivers the core value, by hand if needed, and run it with a few users." },
  { key: "business_model", label: "Business model", weight: 15, next_step: "Ask early users to pay, even a small amount, to test willingness to pay." },
];

const criterionInput = z.object({
  score: z.number().int().min(1).max(10),
  rationale: z.string().min(1).max(400),
});

export const scorePitchInput = Object.fromEntries(
  CRITERIA.map((c) => [c.key, criterionInput.describe(`${c.label} (weight ${c.weight}%)`)]),
);

export const scorePitchOutput = {
  total: z.number(),
  grade: z.enum(["A", "B", "C", "D"]),
  breakdown: z.array(
    z.object({
      criterion: z.string(),
      label: z.string(),
      score: z.number(),
      weight: z.number(),
      points: z.number(),
      rationale: z.string(),
    }),
  ),
  top_risk: z.string(),
  next_step: z.string(),
};

export function gradeFor(total) {
  if (total >= 85) return "A";
  if (total >= 70) return "B";
  if (total >= 55) return "C";
  return "D";
}

export function scorePitch(input) {
  const breakdown = CRITERIA.map((c) => {
    const { score, rationale } = input[c.key];
    return {
      criterion: c.key,
      label: c.label,
      score,
      weight: c.weight,
      points: Math.round(score * c.weight) / 10,
      rationale,
    };
  });
  const total = Math.round(breakdown.reduce((sum, b) => sum + (b.score * b.weight) / 10, 0));
  // Lowest score wins; ties go to the higher-weighted criterion (it costs more points).
  const weakest = breakdown.reduce((low, b) =>
    b.score < low.score || (b.score === low.score && b.weight > low.weight) ? b : low,
  );
  return {
    total,
    grade: gradeFor(total),
    breakdown,
    top_risk: weakest.rationale,
    next_step: CRITERIA.find((c) => c.key === weakest.criterion).next_step,
  };
}

// ---------- resource ----------

export const RUBRIC_MARKDOWN = [
  "# Pitch rubric",
  "",
  "Score each criterion from 1 (weak) to 10 (strong) and give a one-sentence rationale.",
  "",
  "| Criterion | Weight | What a 10 looks like |",
  "|---|---|---|",
  "| Problem | 25% | A painful, frequent problem that a specific group of people clearly has |",
  "| Market | 20% | A reachable customer segment that is large enough to matter |",
  "| Differentiation | 25% | A clear reason to choose this over today's alternatives |",
  "| Feasibility | 15% | A small team can build and deliver a first version quickly |",
  "| Business model | 15% | Someone pays, and the unit economics can work |",
  "",
  "Total = sum of (score x weight / 10), from 10 to 100.",
  "Grades: A >= 85, B >= 70, C >= 55, D below 55.",
  "The lowest-scoring criterion is the top risk.",
  "",
].join("\n");

// ---------- registry ----------

export const toolDefs = [
  {
    name: "size_market",
    title: "Size the market",
    description:
      "Estimate TAM, SAM and SOM from supplied assumptions (TAM = customers x annual price; SAM = TAM x serviceable share; SOM = SAM x obtainable share). Results are assumption-based, not market research.",
    inputSchema: sizeMarketInput,
    outputSchema: sizeMarketOutput,
    handler: sizeMarket,
  },
  {
    name: "scan_competitors",
    title: "Scan competitors",
    description:
      "Rate supplied alternatives by threat (direct = high, indirect = medium, status quo = medium or low) and find white space: the weaknesses our edge addresses.",
    inputSchema: scanCompetitorsInput,
    outputSchema: scanCompetitorsOutput,
    handler: scanCompetitors,
  },
  {
    name: "draft_landing_page",
    title: "Draft a landing page",
    description:
      "Render a self-contained landing page (inline CSS, no scripts) from a product name, headline, subheadline, exactly three features, a call to action and an accent color.",
    inputSchema: draftLandingPageInput,
    outputSchema: draftLandingPageOutput,
    handler: draftLandingPage,
  },
  {
    name: "score_pitch",
    title: "Score the pitch",
    description:
      "Score the idea with the pitch rubric (problem 25%, market 20%, differentiation 25%, feasibility 15%, business model 15%). Returns total, grade, breakdown, top risk and a next step.",
    inputSchema: scorePitchInput,
    outputSchema: scorePitchOutput,
    handler: scorePitch,
  },
];
