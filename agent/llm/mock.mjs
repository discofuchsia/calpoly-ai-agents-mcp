// Scripted mock LLM with the same interface as the real providers. It needs
// no key or network: it calls the 4 tools in order (inputs templated from the
// idea), then writes a short verdict from the real tool results.
// All numbers it supplies are labeled illustrative assumptions.

const TOOL_ORDER = ["size_market", "scan_competitors", "draft_landing_page", "score_pitch"];

const AUDIENCES = [
  [/student|college|campus|universit/i, "College students"],
  [/parent|famil|kid|child/i, "Busy parents"],
  [/small business|shop|restaurant|store|cafe/i, "Small business owners"],
  [/developer|engineer|programmer|coder/i, "Software developers"],
  [/farm|grower|agricultur/i, "Local farms"],
];

const NAMES = [
  [/farm|harvest|garden|crop/i, "FieldShift"],
  [/food|meal|cook|recipe/i, "ForkFlow"],
  [/pet|dog|cat/i, "PawPal"],
  [/study|tutor|class|learn/i, "StudyLoop"],
  [/fitness|workout|gym/i, "RepRoute"],
];

function pick(table, text, fallback) {
  for (const [re, value] of table) if (re.test(text)) return value;
  return fallback;
}

function clip(text, max) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

function extractIdea(messages) {
  const first = messages.find((m) => m.role === "user");
  const content = typeof first?.content === "string" ? first.content : first?.content?.find((b) => b.type === "text")?.text;
  const text = content ?? "";
  const m = text.match(/Startup idea:\s*([\s\S]*)/i);
  return clip(m ? m[1] : text, 500) || "A new startup idea";
}

function toolResults(messages) {
  const results = [];
  for (const m of messages) {
    if (m.role !== "user" || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type !== "tool_result") continue;
      let data = null;
      try {
        data = JSON.parse(typeof b.content === "string" ? b.content : JSON.stringify(b.content));
      } catch {
        data = null;
      }
      results.push({ isError: Boolean(b.is_error), data });
    }
  }
  return results;
}

function usd(n) {
  return "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
}

function sleep(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

function turn(idea, step, results) {
  const audience = pick(AUDIENCES, idea, "Early adopters");
  const name = pick(NAMES, idea, "Launchpad");
  const id = `mock_tool_${step + 1}`;

  switch (TOOL_ORDER[step]) {
    case "size_market":
      return {
        text: `I read the pitch rubric. First I'll size the market for ${audience.toLowerCase()} with clearly labeled, illustrative assumptions.`,
        call: {
          id,
          name: "size_market",
          input: {
            segment: audience,
            customer_count: 1000000,
            annual_price_usd: 60,
            serviceable_share: 0.3,
            obtainable_share: 0.05,
            assumptions: [
              "Illustrative: 1,000,000 reachable customers in the first region",
              "Illustrative: $60 per customer per year",
              "Illustrative: 30% can be served at launch, 5% of those won in the first years",
            ],
          },
        },
      };
    case "scan_competitors":
      return {
        text: "Next, what do people use today instead? I'll compare the main alternatives by category.",
        call: {
          id,
          name: "scan_competitors",
          input: {
            idea,
            competitors: [
              {
                name: "Spreadsheets + group chats",
                kind: "status_quo",
                strengths: ["Free", "Everyone already uses them"],
                weaknesses: ["Manual coordination", "No trust or payments built in"],
              },
              {
                name: "Generic marketplace apps",
                kind: "indirect",
                strengths: ["Large existing audience"],
                weaknesses: ["Not built for this niche", "Low trust between strangers"],
              },
              {
                name: "Local word of mouth",
                kind: "status_quo",
                strengths: ["High trust"],
                weaknesses: ["Does not scale", "Hard to discover"],
              },
              {
                name: "Early niche startups",
                kind: "direct",
                strengths: ["Focused on the same problem"],
                weaknesses: ["Unproven", "Small networks"],
              },
            ],
            our_edge: "Purpose-built matching with trust, scheduling and payments in one place",
          },
        },
      };
    case "draft_landing_page":
      return {
        text: `The white space is trust and coordination. Let's draft a landing page for "${name}" to test demand.`,
        call: {
          id,
          name: "draft_landing_page",
          input: {
            product_name: name,
            headline: clip(idea.charAt(0).toUpperCase() + idea.slice(1), 110),
            subheadline: `Built for ${audience.toLowerCase()}. Simple to start, fair for everyone, and ready for a first pilot.`,
            features: [
              { title: "Smart matching", body: "Find the right match in minutes instead of chasing replies across group chats." },
              { title: "Built-in trust", body: "Profiles, reviews and verification so both sides know who they are dealing with." },
              { title: "Scheduling and payments", body: "Book, confirm and pay in one place, with no spreadsheets." },
            ],
            cta: "Join the waitlist",
            accent_hex: "#7c5cff",
          },
        },
      };
    case "score_pitch":
      return {
        text: "Finally, I'll score the pitch against the rubric so we know the biggest risk.",
        call: {
          id,
          name: "score_pitch",
          input: {
            problem: { score: 7, rationale: "The coordination pain is real and frequent for both sides." },
            market: { score: 6, rationale: "The segment is reachable, but the size rests on illustrative assumptions." },
            differentiation: { score: 6, rationale: "Trust and payments in one place help, but are copyable." },
            feasibility: { score: 8, rationale: "A small team can ship a first version quickly." },
            business_model: { score: 5, rationale: "Willingness to pay is unproven: who pays, and how much, still needs testing." },
          },
        },
      };
    default: {
      const [market, comp, page, score] = results.map((r) => (r.isError ? null : r.data));
      const lines = [`**Verdict: promising, so test it before you build it.**`, ""];
      if (market) lines.push(`- **Market:** SOM of ${usd(market.som_usd)} per year on illustrative assumptions (TAM ${usd(market.tam_usd)}).`);
      if (comp) lines.push(`- **Competition:** ${comp.competitors?.length ?? 0} alternatives; white space in ${(comp.white_space ?? []).slice(0, 2).join(" and ").toLowerCase() || "coordination"}.`);
      if (page) lines.push(`- **Landing page:** drafted for ${name} (${page.word_count} words), ready for a waitlist test.`);
      if (score) lines.push(`- **Pitch score:** ${score.total}/100, grade ${score.grade}. Top risk: ${score.top_risk}`);
      lines.push("", score ? `Next step: ${score.next_step}` : "Next step: talk to ten potential customers this week.");
      return { text: lines.join("\n"), call: null };
    }
  }
}

export function createMockLLM(env = process.env) {
  const latency = Math.max(0, Number(env.MOCK_LATENCY_MS) || 0);
  return {
    name: "mock",
    model: "scripted-demo",
    ready: true,
    reason: null,
    async chat({ messages, signal }) {
      await sleep(latency, signal);
      const results = toolResults(messages);
      const { text, call } = turn(extractIdea(messages), results.length, results);
      return call
        ? { text, toolCalls: [call], stopReason: "tool_use" }
        : { text, toolCalls: [], stopReason: "end_turn" };
    },
  };
}
