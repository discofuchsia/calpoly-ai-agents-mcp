/* Startup Co-founder Agent demo UI.
 * Classic script (no modules) so it runs from file://.
 * Live mode streams NDJSON from the local backend; replay mode plays a
 * recorded run (window.DEMO_REPLAY). Both feed the same event dispatcher.
 * All model and tool text is rendered with textContent; the drafted landing
 * page only ever goes into a sandboxed iframe's srcdoc.
 */
(function () {
  "use strict";

  var LOOPBACK = location.hostname === "127.0.0.1" || location.hostname === "localhost";
  var params = new URLSearchParams(location.search);
  var forceReplay = params.get("mode") === "replay";
  var speed = clamp(parseFloat(params.get("speed")) || 1, 0.1, 20);
  var replay = window.DEMO_REPLAY || null;

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    form: $("prompt-form"),
    idea: $("idea"),
    run: $("run-btn"),
    runLabel: document.querySelector("#run-btn .run-label"),
    status: $("status"),
    timeline: $("timeline"),
    artifacts: $("artifacts"),
    empty: $("artifacts-empty"),
    badge: $("provider-badge"),
    live: $("mode-live"),
    replay: $("mode-replay"),
    stepCount: $("step-count"),
    timelineCol: document.querySelector(".timeline-col"),
    artifactsCol: document.querySelector(".artifacts-col"),
  };

  var state = {
    mode: "replay",
    liveAvailable: false,
    health: null,
    running: false,
    token: 0,          // bumps on every new run / cancel; stale timers check it
    controller: null,  // AbortController for the live fetch
    toolItems: {},     // tool_call id -> timeline element
    toolCount: 0,
  };

  // ---------- helpers ----------
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = String(text);
    return node;
  }

  var usd = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1,
  });
  function money(n) { return typeof n === "number" && isFinite(n) ? usd.format(n) : "n/a"; }

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function pretty(value) {
    try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }
  }

  function scrollToEnd(col) {
    // Scroll only the column, never the parent deck.
    requestAnimationFrame(function () { col.scrollTop = col.scrollHeight; });
  }

  function setStatus(text, isError, action) {
    els.status.textContent = text || "";
    els.status.classList.toggle("error", !!isError);
    if (action) {
      var b = el("button", "link-btn", action.label);
      b.type = "button";
      b.addEventListener("click", action.onClick);
      els.status.appendChild(b);
    }
  }

  function setRunning(on) {
    state.running = on;
    els.run.disabled = on;
    els.run.classList.toggle("running", on);
    els.runLabel.textContent = on ? "Agent working" : "Run agent";
  }

  // Inline **bold** into a parent node using text nodes only.
  function appendInline(parent, text) {
    var parts = String(text).split(/(\*\*[^*]+\*\*)/g);
    parts.forEach(function (p) {
      if (!p) return;
      if (/^\*\*[^*]+\*\*$/.test(p)) parent.appendChild(el("strong", null, p.slice(2, -2)));
      else parent.appendChild(document.createTextNode(p));
    });
  }

  // Markdown-lite: paragraphs, "- " bullets, **bold**.
  function renderMarkdownLite(container, text) {
    var list = null;
    String(text || "").split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) { list = null; return; }
      var m = line.match(/^[-*]\s+(.*)$/);
      if (m) {
        if (!list) { list = el("ul"); container.appendChild(list); }
        var li = el("li");
        appendInline(li, m[1]);
        list.appendChild(li);
      } else {
        list = null;
        var p = el("p");
        appendInline(p, line.replace(/^#+\s*/, ""));
        container.appendChild(p);
      }
    });
  }

  // ---------- mode ----------
  function updateBadge() {
    if (state.mode === "live" && state.health) {
      els.badge.textContent = "live · " + state.health.provider + " · " + state.health.model;
      els.badge.classList.add("live");
    } else {
      var who = replay ? replay.provider + " · " + replay.model : "no recording";
      els.badge.textContent = "replay · " + who;
      els.badge.classList.remove("live");
    }
  }

  function setMode(mode) {
    if (mode === "live" && !state.liveAvailable) mode = "replay";
    if (state.running) cancelRun();
    state.mode = mode;
    els.live.setAttribute("aria-checked", String(mode === "live"));
    els.replay.setAttribute("aria-checked", String(mode === "replay"));
    updateBadge();
    if (mode === "replay") {
      if (replay) els.idea.value = replay.idea;
      setStatus(replay ? "Replay of a recorded run. No network needed." : "No recorded run found.", !replay);
    } else {
      setStatus("Live: the agent calls a real model and the real MCP server on this laptop.");
    }
  }

  function probeLive() {
    if (!LOOPBACK || forceReplay) return Promise.resolve();
    return fetch("../api/health", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (h) {
        if (!h || !h.ok) return;
        state.health = h;
        if (h.ready) {
          state.liveAvailable = true;
          els.live.disabled = false;
          els.live.title = "";
          setMode("live");
        } else {
          els.live.title = h.reason || "Live provider is not ready";
          setStatus("Live unavailable: " + (h.reason || "provider not ready") + ". Using replay.");
        }
      })
      .catch(function () { /* backend not running: stay in replay */ });
  }

  // ---------- rendering ----------
  function reset() {
    state.toolItems = {};
    state.toolCount = 0;
    els.timeline.textContent = "";
    els.artifacts.textContent = "";
    els.artifacts.appendChild(els.empty);
    els.empty.hidden = false;
    els.stepCount.textContent = "";
  }

  function addTimeline(cls, kind, title) {
    var li = el("li", "tl-item " + cls);
    var k = el("div", "tl-kind");
    k.appendChild(el("span", null, kind));
    li.appendChild(k);
    if (title != null) li.appendChild(el("div", "tl-title", title));
    els.timeline.appendChild(li);
    scrollToEnd(els.timelineCol);
    return li;
  }

  function ioBlock(label, value, open) {
    var d = el("details", "io");
    if (open) d.open = true;
    d.appendChild(el("summary", null, label));
    d.appendChild(el("pre", "json", pretty(value)));
    return d;
  }

  function addCard(cls, title, tool) {
    els.empty.hidden = true;
    var card = el("article", "card " + (cls || ""));
    var h = el("h3", null, title);
    if (tool) h.appendChild(el("span", "tool-tag", tool));
    card.appendChild(h);
    els.artifacts.appendChild(card);
    scrollToEnd(els.artifactsCol);
    return card;
  }

  function renderMarket(o) {
    var card = addCard("market", "Market size", "size_market");
    card.appendChild(el("p", "lede", o.segment || "Market"));
    var funnel = el("div", "funnel");
    var max = o.tam_usd || 1;
    [["TAM", o.tam_usd], ["SAM", o.sam_usd], ["SOM", o.som_usd]].forEach(function (row) {
      var r = el("div", "bar-row");
      r.appendChild(el("span", "bar-label", row[0]));
      var bar = el("div", "bar", money(row[1]));
      r.appendChild(bar);
      funnel.appendChild(r);
      var pct = Math.max(14, Math.round(((row[1] || 0) / max) * 100));
      requestAnimationFrame(function () { requestAnimationFrame(function () { bar.style.width = pct + "%"; }); });
    });
    card.appendChild(funnel);
    if (o.formula) card.appendChild(el("p", "note", o.formula));
    card.appendChild(el("p", "note", "Estimates from the agent's stated assumptions, not researched data."));
  }

  function renderCompetitors(o) {
    var card = addCard("competitors", "Competitive landscape", "scan_competitors");
    if (o.summary) card.appendChild(el("p", "lede", o.summary));
    var table = el("table", "comp");
    var head = el("tr");
    ["Alternative", "Weakness", "Threat"].forEach(function (h) { head.appendChild(el("th", null, h)); });
    var thead = el("thead"); thead.appendChild(head); table.appendChild(thead);
    var tbody = el("tbody");
    (o.competitors || []).forEach(function (c) {
      var tr = el("tr");
      tr.appendChild(el("td", null, c.name));
      tr.appendChild(el("td", null, (c.weaknesses || [])[0] || ""));
      var td = el("td");
      var level = ["high", "medium", "low"].indexOf(c.threat) >= 0 ? c.threat : "medium";
      td.appendChild(el("span", "threat " + level, c.threat));
      tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card.appendChild(table);
    if (o.white_space && o.white_space.length) {
      card.appendChild(el("p", "note", "White space"));
      var ul = el("ul", "chips");
      o.white_space.forEach(function (w) { ul.appendChild(el("li", null, w)); });
      card.appendChild(ul);
    }
  }

  function renderLanding(o) {
    var card = addCard("landing wide", "Landing page draft", "draft_landing_page");
    var b = el("div", "browser");
    var bar = el("div", "browser-bar");
    bar.appendChild(el("i")); bar.appendChild(el("i")); bar.appendChild(el("i"));
    bar.appendChild(el("span", null, "preview · " + (o.word_count || 0) + " words"));
    b.appendChild(bar);
    var frame = document.createElement("iframe");
    frame.setAttribute("sandbox", ""); // no scripts, no same-origin, no navigation
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("loading", "eager");
    frame.title = "Drafted landing page preview";
    frame.srcdoc = String(o.html || "");
    b.appendChild(frame);
    card.appendChild(b);
  }

  function renderScore(o) {
    var card = addCard("score-card wide", "Pitch score", "score_pitch");
    var wrap = el("div", "score");
    var dial = el("div", "dial");
    var circ = 2 * Math.PI * 64;
    // Static SVG markup lives in a <template> in index.html.
    var s = document.getElementById("dial-template").content.firstElementChild.cloneNode(true);
    var val = s.querySelector(".value");
    val.setAttribute("stroke-dasharray", String(circ));
    val.setAttribute("stroke-dashoffset", String(circ));
    dial.appendChild(s);
    var center = el("div", "dial-center");
    var num = el("div", "dial-num", "0");
    center.appendChild(num);
    center.appendChild(el("div", "dial-grade", "grade " + (o.grade || "?")));
    dial.appendChild(center);
    wrap.appendChild(dial);

    var bd = el("div", "breakdown");
    var fills = [];
    (o.breakdown || []).forEach(function (row) {
      var line = el("div", "bd-row");
      line.appendChild(el("span", null, row.label || row.criterion));
      var track = el("div", "bd-track");
      var fill = el("div", "bd-fill");
      track.appendChild(fill);
      line.appendChild(track);
      line.appendChild(el("span", "bd-pts", (row.score != null ? row.score : "?") + "/10"));
      bd.appendChild(line);
      fills.push([fill, clamp((row.score || 0) * 10, 0, 100)]);
    });
    wrap.appendChild(bd);
    card.appendChild(wrap);

    if (o.top_risk) {
      var risk = el("div", "risk");
      risk.appendChild(el("b", null, "Top risk: "));
      risk.appendChild(document.createTextNode(o.top_risk));
      card.appendChild(risk);
    }
    if (o.next_step) card.appendChild(el("p", "note", "Next step: " + o.next_step));

    var total = clamp(Number(o.total) || 0, 0, 100);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        val.setAttribute("stroke-dashoffset", String(circ * (1 - total / 100)));
        fills.forEach(function (f) { f[0].style.width = f[1] + "%"; });
      });
    });
    countUp(num, total, 1400);
  }

  function countUp(node, target, ms) {
    var start = performance.now();
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { node.textContent = String(target); return; }
    (function frame(now) {
      var p = clamp((now - start) / ms, 0, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      node.textContent = String(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(frame);
    })(start);
  }

  function renderGeneric(name, o) {
    var card = addCard("", "Result", name);
    card.appendChild(el("pre", "json", pretty(o)));
  }

  var RENDERERS = {
    size_market: renderMarket,
    scan_competitors: renderCompetitors,
    draft_landing_page: renderLanding,
    score_pitch: renderScore,
  };

  function summarizeOutput(name, o) {
    if (name === "draft_landing_page" && o && typeof o.html === "string") {
      return { word_count: o.word_count, html: "(" + o.html.length + " chars, rendered in the preview)" };
    }
    return o;
  }

  function finishRun(ok) {
    setRunning(false);
    if (state.mode === "replay" && replay) {
      setStatus(ok ? "Replay finished." : "Replay stopped.", false, { label: "Replay again", onClick: start });
    }
  }

  function liveFailed(message) {
    setStatus("Live run failed: " + message, true,
      replay ? { label: "Switch to replay", onClick: function () { setMode("replay"); start(); } } : null);
  }

  // ---------- the dispatcher (shared by live and replay) ----------
  function handle(ev) {
    if (!ev || typeof ev.type !== "string") return;
    switch (ev.type) {
      case "run_start": {
        var li = addTimeline("start", "run start", "Agent connected to MCP server");
        li.appendChild(el("div", "tl-kind", (ev.tools || []).length + " tools: " + (ev.tools || []).join(", ")));
        break;
      }
      case "resource_read": {
        addTimeline("resource", "resource read", ev.title || ev.uri)
          .appendChild(el("div", "tl-kind", ev.uri));
        break;
      }
      case "thinking": {
        addTimeline("thinking", "thinking").appendChild(el("div", null, ev.text));
        break;
      }
      case "tool_call": {
        state.toolCount += 1;
        els.stepCount.textContent = "tool calls: " + state.toolCount;
        var item = addTimeline("tool pending", "tool call", ev.name);
        var ms = el("span", "ms", "running…");
        item.querySelector(".tl-kind").appendChild(ms);
        item.appendChild(ioBlock("input", ev.input, false));
        state.toolItems[ev.id] = item;
        break;
      }
      case "tool_result": {
        var t = state.toolItems[ev.id] || addTimeline("tool", "tool result", ev.name);
        t.classList.remove("pending");
        t.classList.add(ev.isError ? "failed" : "done");
        var msEl = t.querySelector(".ms");
        if (msEl) msEl.textContent = (ev.isError ? "error · " : "") + (ev.ms != null ? ev.ms + " ms" : "");
        t.appendChild(ioBlock(ev.isError ? "error" : "result", summarizeOutput(ev.name, ev.output), !!ev.isError));
        if (!ev.isError && ev.output) (RENDERERS[ev.name] || function (o) { renderGeneric(ev.name, o); })(ev.output);
        break;
      }
      case "final": {
        addTimeline("final", "final answer", "Verdict ready");
        var card = addCard("verdict wide", "Co-founder verdict");
        var body = el("div");
        renderMarkdownLite(body, ev.text);
        card.appendChild(body);
        if (state.mode === "replay" && replay) {
          var actions = el("div", "actions");
          var again = el("button", "ghost-btn", "Replay again");
          again.type = "button";
          again.addEventListener("click", start);
          actions.appendChild(again);
          card.appendChild(actions);
        }
        break;
      }
      case "error": {
        addTimeline("error", "error", ev.message || "Unknown error");
        if (state.mode === "live") liveFailed(ev.message || "unknown error");
        break;
      }
      case "run_end": {
        addTimeline("end", "run end", (ev.steps || 0) + " model turns · " + ((ev.ms || 0) / 1000).toFixed(1) + " s");
        break;
      }
    }
  }

  // ---------- runners ----------
  function cancelRun() {
    state.token += 1;
    if (state.controller) { state.controller.abort(); state.controller = null; }
    setRunning(false);
  }

  function typeIdea(text, token) {
    els.idea.value = "";
    var perChar = 22 / speed;
    var i = 0;
    return new Promise(function (resolve) {
      (function tick() {
        if (token !== state.token) return resolve(false);
        i += 1;
        els.idea.value = text.slice(0, i);
        if (i >= text.length) return resolve(true);
        setTimeout(tick, perChar);
      })();
    });
  }

  function runReplay() {
    var token = ++state.token;
    reset();
    setRunning(true);
    setStatus("Replaying a recorded run…");
    var events = (replay.events || []).slice();
    return typeIdea(String(replay.idea || ""), token)
      .then(function (ok) { return ok && wait(350 / speed); })
      .then(function () {
        if (token !== state.token) return false;
        var t0 = performance.now();
        return events.reduce(function (p, ev) {
          return p.then(function (alive) {
            if (!alive || token !== state.token) return false;
            var due = (Number(ev.t) || 0) / speed - (performance.now() - t0);
            return wait(Math.max(0, due)).then(function () {
              if (token !== state.token) return false;
              handle(ev);
              return true;
            });
          });
        }, Promise.resolve(true));
      })
      .then(function (ok) { if (token === state.token) finishRun(!!ok); });
  }

  function runLive() {
    var idea = els.idea.value.trim();
    if (idea.length < 3) { setStatus("Type an idea of at least 3 characters.", true); els.idea.focus(); return; }
    var token = ++state.token;
    reset();
    setRunning(true);
    setStatus("Live run in progress…");
    var controller = new AbortController();
    state.controller = controller;
    var sawEnd = false;
    var sawError = false;
    var dispatch = function (ev) {
      if (token !== state.token) return;
      if (ev.type === "error") sawError = true;
      if (ev.type === "run_end") sawEnd = true;
      handle(ev);
    };

    fetch("../api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idea: idea }),
      signal: controller.signal,
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          throw new Error(j.error || "HTTP " + res.status);
        });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = "";
      function flushLine(line) {
        line = line.trim();
        if (!line) return;
        try { dispatch(JSON.parse(line)); } catch (e) { /* ignore a malformed line */ }
      }
      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) { flushLine(buf); buf = ""; return; }
          buf += decoder.decode(chunk.value, { stream: true });
          var idx;
          while ((idx = buf.indexOf("\n")) >= 0) {
            flushLine(buf.slice(0, idx));
            buf = buf.slice(idx + 1);
          }
          return pump();
        });
      }
      return pump();
    }).then(function () {
      if (token !== state.token) return;
      state.controller = null;
      setRunning(false);
      if (!sawEnd) liveFailed("the stream ended early");
      else if (!sawError) setStatus("Live run finished.");
    }).catch(function (err) {
      if (token !== state.token) return;
      state.controller = null;
      setRunning(false);
      liveFailed(err && err.message ? err.message : "network error");
    });
  }

  function start() {
    if (state.running) return;
    if (state.mode === "live") runLive();
    else if (replay) runReplay();
    else setStatus("No recorded run found.", true);
  }

  // ---------- wiring ----------
  els.form.addEventListener("submit", function (e) { e.preventDefault(); start(); });
  els.live.addEventListener("click", function () { setMode("live"); });
  els.replay.addEventListener("click", function () { setMode("replay"); });

  var NAV = { ArrowLeft: "prev", PageUp: "prev", ArrowRight: "next", PageDown: "next" };
  document.addEventListener("keydown", function (e) {
    var t = e.target;
    var typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (NAV[e.key] && window.parent !== window) {
      e.preventDefault();
      window.parent.postMessage({ type: "deck-nav", dir: NAV[e.key] }, "*");
      return;
    }
    if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      setMode(state.mode === "live" ? "replay" : "live");
    }
  });

  setMode("replay");
  probeLive();
})();
