/* Talk deck runtime. Classic script (ES modules do not load from file:// in Chrome).
 * Audience view: index.html#/<n>. Presenter view: index.html#presenter (opened with P).
 * Cross-window messages are validated with event.source; file:// origins are "null". */
(function () {
  "use strict";

  var STAGE_W = 1920;
  var STAGE_H = 1080;
  var TARGET_MS = 30 * 60 * 1000;

  var $ = function (id) { return document.getElementById(id); };
  var slides = Array.prototype.slice.call(document.querySelectorAll(".stage > .slide"));
  var total = slides.length;
  var demoFrame = document.querySelector(".demo-frame");
  var demoIndex = slides.findIndex(function (s) { return s.contains(demoFrame); });
  var isPresenter = location.hash === "#presenter" || /[?&]presenter\b/.test(location.search);
  var readingQuery = window.matchMedia("(orientation: portrait), (max-width: 760px)");

  var state = { index: 0, step: 0 };
  var presenterWin = null;

  var cumulative = [];
  (function () {
    var sum = 0;
    slides.forEach(function (s) {
      cumulative.push(sum);
      sum += parseFloat(s.getAttribute("data-minutes")) || 0;
    });
    cumulative.push(sum);
  })();

  function maxStep(i) {
    var max = 0;
    slides[i].querySelectorAll("[data-step]").forEach(function (el) {
      max = Math.max(max, parseInt(el.getAttribute("data-step"), 10) || 0);
    });
    return max;
  }

  function clampIndex(i) { return Math.min(total - 1, Math.max(0, i)); }

  function applySteps(root, step) {
    root.querySelectorAll("[data-step]").forEach(function (el) {
      el.classList.toggle("shown", (parseInt(el.getAttribute("data-step"), 10) || 0) <= step);
    });
  }

  function notesText(i) {
    var n = slides[i] && slides[i].querySelector(".notes");
    return n ? n.textContent.trim() : "";
  }

  // ---------- navigation ----------
  function go(index, step, opts) {
    opts = opts || {};
    var i = clampIndex(index);
    var s = Math.min(Math.max(0, step), maxStep(i));
    var changed = i !== state.index || s !== state.step;
    state.index = i;
    state.step = s;
    render();
    if (changed && !opts.remote) sync();
    if (changed && isPresenter) timer.autoStart();
  }

  function next() {
    if (state.step < maxStep(state.index)) go(state.index, state.step + 1);
    else if (state.index < total - 1) go(state.index + 1, 0);
  }

  function prev() {
    if (state.step > 0) go(state.index, state.step - 1);
    else if (state.index > 0) go(state.index - 1, maxStep(state.index - 1));
  }

  function render() {
    if (isPresenter) { renderPresenter(); return; }
    slides.forEach(function (s, i) {
      s.classList.toggle("active", i === state.index);
      s.classList.toggle("past", i < state.index);
      s.setAttribute("aria-hidden", i === state.index ? "false" : "true");
      applySteps(s, i === state.index ? state.step : (i < state.index ? maxStep(i) : 0));
    });
    $("progress-bar").style.width = (total > 1 ? (state.index / (total - 1)) * 100 : 100) + "%";
    var hash = "#/" + (state.index + 1);
    if (location.hash !== hash) history.replaceState(null, "", hash);
    document.title = (slides[state.index].getAttribute("data-title") || "") + " | A Day in the Life of an AI Engineer";
    // Leaving the demo: take keyboard focus back from the iframe.
    if (state.index !== demoIndex && document.activeElement === demoFrame) {
      demoFrame.blur();
      window.focus();
    }
  }

  function readHash() {
    var m = /^#\/(\d+)$/.exec(location.hash);
    return m ? parseInt(m[1], 10) - 1 : null;
  }

  // ---------- scaling / reading mode ----------
  function layout() {
    if (isPresenter) { scalePresenter(); return; }
    var reading = readingQuery.matches;
    document.body.classList.toggle("reading", reading);
    if (!reading) {
      var scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
      document.documentElement.style.setProperty("--scale", String(scale));
    }
  }

  // ---------- clones (overview + presenter) ----------
  function cloneSlide(i, step) {
    var c = slides[i].cloneNode(true);
    c.classList.add("active");
    c.classList.remove("past");
    c.removeAttribute("aria-hidden");
    var notes = c.querySelector(".notes");
    if (notes) notes.remove();
    c.querySelectorAll("iframe").forEach(function (f) {
      var ph = document.createElement("div");
      ph.className = "demo-placeholder";
      ph.textContent = "Demo plays in the audience window";
      f.replaceWith(ph);
    });
    applySteps(c, step);
    var wrap = document.createElement("div");
    wrap.className = "mini";
    wrap.appendChild(c);
    return wrap;
  }

  function fitMini(container) {
    var mini = container.querySelector(".mini");
    if (mini) mini.style.transform = "scale(" + (container.clientWidth / STAGE_W) + ")";
  }

  // ---------- overlays ----------
  function toggle(id, force) {
    var el = $(id);
    var show = typeof force === "boolean" ? force : el.hidden;
    el.hidden = !show;
    return show;
  }

  function openOverview() {
    var grid = $("overview-grid");
    grid.textContent = "";
    slides.forEach(function (s, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "thumb" + (i === state.index ? " current" : "");
      b.setAttribute("aria-label", (i + 1) + ". " + (s.getAttribute("data-title") || ""));
      var mini = cloneSlide(i, maxStep(i));
      mini.style.transform = "scale(" + (384 / STAGE_W) + ")";
      b.appendChild(mini);
      var num = document.createElement("span");
      num.className = "thumb-num";
      num.textContent = (i + 1) + " · " + (s.getAttribute("data-title") || "");
      b.appendChild(num);
      b.addEventListener("click", function () { toggle("overview", false); go(i, 0); });
      grid.appendChild(b);
    });
    toggle("overview", true);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
  }

  function openPresenter() {
    if (presenterWin && !presenterWin.closed) { presenterWin.focus(); sync(); return; }
    var url = location.href.split("#")[0] + "#presenter";
    presenterWin = window.open(url, "deck-presenter", "width=1280,height=800");
  }

  // ---------- cross-window sync ----------
  function sync() {
    var msg = { type: "deck-goto", index: state.index, step: state.step };
    if (isPresenter) {
      if (window.opener && !window.opener.closed) window.opener.postMessage(msg, "*");
    } else if (presenterWin && !presenterWin.closed) {
      presenterWin.postMessage(msg, "*");
    }
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "deck-nav" && !isPresenter && demoFrame && e.source === demoFrame.contentWindow) {
      if (d.dir === "next") next();
      else if (d.dir === "prev") prev();
      return;
    }
    var fromPeer = isPresenter ? (window.opener && e.source === window.opener) : (presenterWin && e.source === presenterWin);
    if (!fromPeer) return;
    if (d.type === "deck-hello") { sync(); return; }
    if (d.type === "deck-goto" && Number.isInteger(d.index) && Number.isInteger(d.step)) {
      go(d.index, d.step, { remote: true });
    }
  });

  // ---------- presenter view ----------
  var timer = {
    startedAt: null, elapsed: 0, running: false,
    now: function () { return this.elapsed + (this.running ? Date.now() - this.startedAt : 0); },
    autoStart: function () { if (!this.running && this.elapsed === 0) this.start(); },
    start: function () { this.startedAt = Date.now(); this.running = true; },
    pause: function () { this.elapsed = this.now(); this.running = false; },
    toggle: function () { if (this.running) this.pause(); else this.start(); },
    reset: function () { this.elapsed = 0; this.running = false; this.startedAt = null; }
  };

  function fmt(ms) {
    var sec = Math.floor(ms / 1000);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  function tickPresenter() {
    var ms = timer.now();
    $("pv-timer").textContent = fmt(ms);
    $("pv-timer-state").textContent = timer.running ? "running · T pause · R reset"
      : (ms > 0 ? "paused · T resume · R reset" : "press → to start · T start · R reset");
    // Pace: compare elapsed time with the planned window for the current slide.
    var startMin = cumulative[state.index];
    var endMin = cumulative[state.index + 1];
    var min = ms / 60000;
    var pace = $("pv-pace");
    var slack = 0.5;
    var cls = "";
    var label = "on time";
    if (min > endMin + slack) { cls = "behind"; label = "behind " + fmt((min - endMin) * 60000); }
    else if (min < startMin - slack) { cls = "ahead"; label = "ahead " + fmt((startMin - min) * 60000); }
    pace.className = "pv-pace" + (cls ? " " + cls : "");
    pace.textContent = label;
    $("pv-clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (ms > TARGET_MS) $("pv-timer").style.color = "var(--bad)";
    else $("pv-timer").style.color = "";
  }

  function renderPresenter() {
    var cur = $("pv-current");
    var nxt = $("pv-next");
    cur.textContent = "";
    nxt.textContent = "";
    cur.appendChild(cloneSlide(state.index, state.step));
    var remaining = maxStep(state.index) - state.step;
    if (state.index < total - 1) {
      nxt.appendChild(cloneSlide(state.index + 1, maxStep(state.index + 1)));
      $("pv-next-title").textContent = (remaining > 0 ? remaining + " more build" + (remaining > 1 ? "s" : "") + " here, then: " : "") +
        (slides[state.index + 1].getAttribute("data-title") || "");
    } else {
      $("pv-next-title").textContent = remaining > 0 ? remaining + " more build(s), then end" : "End of deck";
    }
    $("pv-pos").textContent = (state.index + 1) + " / " + total + " · " + (slides[state.index].getAttribute("data-title") || "") +
      " · planned " + slides[state.index].getAttribute("data-minutes") + " min";
    $("pv-notes").textContent = notesText(state.index);
    scalePresenter();
    tickPresenter();
  }

  function scalePresenter() {
    fitMini($("pv-current"));
    fitMini($("pv-next"));
  }

  // ---------- input ----------
  var NEXT_KEYS = { ArrowRight: 1, " ": 1, PageDown: 1, ArrowDown: 1 };
  var PREV_KEYS = { ArrowLeft: 1, PageUp: 1, ArrowUp: 1 };

  document.addEventListener("keydown", function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    var reading = document.body.classList.contains("reading");
    var k = e.key;
    if (k === "Escape") {
      toggle("help", false); toggle("overview", false); toggle("blackout", false);
      return;
    }
    if (reading && !isPresenter) return; // natural scrolling on phones
    if (NEXT_KEYS[k]) { e.preventDefault(); next(); return; }
    if (PREV_KEYS[k]) { e.preventDefault(); prev(); return; }
    if (k === "Home") { e.preventDefault(); go(0, 0); return; }
    if (k === "End") { e.preventDefault(); go(total - 1, maxStep(total - 1)); return; }
    var lower = k.length === 1 ? k.toLowerCase() : "";
    if (isPresenter) {
      if (lower === "t") { timer.toggle(); tickPresenter(); }
      else if (lower === "r") { timer.reset(); tickPresenter(); }
      return;
    }
    if (lower === "f") toggleFullscreen();
    else if (lower === "p") openPresenter();
    else if (lower === "b") toggle("blackout");
    else if (lower === "d" && demoIndex >= 0) go(demoIndex, 0);
    else if (lower === "g") { if ($("overview").hidden) openOverview(); else toggle("overview", false); }
    else if (k === "?") toggle("help");
  });

  var touch = null;
  document.addEventListener("touchstart", function (e) {
    if (e.touches.length === 1) touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  document.addEventListener("touchend", function (e) {
    if (!touch || document.body.classList.contains("reading")) { touch = null; return; }
    var dx = e.changedTouches[0].clientX - touch.x;
    var dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { if (dx < 0) next(); else prev(); }
  }, { passive: true });

  $("blackout").addEventListener("click", function () { toggle("blackout", false); });
  $("help").addEventListener("click", function () { toggle("help", false); });

  window.addEventListener("resize", layout);
  if (readingQuery.addEventListener) readingQuery.addEventListener("change", layout);

  // ---------- boot ----------
  if (isPresenter) {
    document.body.classList.add("presenter");
    $("presenter-root").hidden = false;
    document.title = "Presenter | A Day in the Life of an AI Engineer";
    setInterval(tickPresenter, 500);
    render();
    if (window.opener) window.opener.postMessage({ type: "deck-hello" }, "*");
  } else {
    window.addEventListener("hashchange", function () {
      var i = readHash();
      if (i !== null && i !== state.index) go(i, 0);
    });
    var start = readHash();
    state.index = clampIndex(start === null ? 0 : start);
    layout();
    render();
  }
  layout();
})();
