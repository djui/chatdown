// Checkboxes on the chat page itself, kept in sync with the side panel.
// While the panel is connected (a "chatdown-marks" port), each message gets a
// round checkbox in the margin and left-out messages are veiled. Everything is
// drawn in a fixed overlay inside a shadow root, so the site's own DOM and
// styles are never touched; closing the panel removes it.
(function (root) {
  "use strict";

  // Pairs panel turns with groups of rendered message elements. ChatGPT tags
  // elements with the same message ids its API uses; elsewhere fall back to
  // position, and only when the page shows exactly as many messages per role.
  function matchTurns(turns, groups) {
    const byId = [];
    const used = new Set();
    for (const t of turns) {
      const g = groups.find((g) => !used.has(g) && g.ids.some((id) => t.messageIds.includes(id)));
      if (g) {
        used.add(g);
        byId.push({ id: t.id, els: g.els });
      }
    }
    if (byId.length) return byId;

    const of = (list, role) => list.filter((x) => x.role === role);
    for (const role of ["user", "assistant"]) {
      if (of(turns, role).length !== of(groups, role).length) return [];
    }
    const queues = { user: of(groups, "user"), assistant: of(groups, "assistant") };
    return turns.map((t) => ({ id: t.id, els: queues[t.role].shift().els }));
  }

  // Rendered messages grouped like groupTurns does: consecutive answer parts form one turn.
  function pageGroups() {
    const X = root.ChatdownExtractors;
    const site = X && X.detectSite(location);
    if (!site) return [];
    const groups = [];
    for (const { role, el } of X.domMessages(site.source)) {
      const box = el.closest("[data-message-author-role]") || el;
      const r = role === "user" ? "user" : "assistant";
      const id = box.getAttribute("data-message-id");
      const last = groups[groups.length - 1];
      if (last && r === "assistant" && last.role === "assistant") {
        last.els.push(box);
        if (id) last.ids.push(id);
      } else {
        groups.push({ role: r, els: [box], ids: id ? [id] : [] });
      }
    }
    return groups;
  }

  if (typeof document === "undefined" || root.__chatdownMarks) {
    if (typeof module !== "undefined" && module.exports) module.exports = { matchTurns };
    return;
  }
  root.__chatdownMarks = true;

  const CSS = `
    :host { all: initial; }
    .mark {
      position: fixed; width: 24px; height: 24px; border-radius: 50%; padding: 0; margin: 0;
      display: grid; place-items: center; cursor: pointer; pointer-events: auto;
      border: 1.5px solid rgba(120, 120, 128, 0.6); background: #fff; color: #fff;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18); transition: background 0.12s, border-color 0.12s, transform 0.12s;
    }
    .mark:hover { transform: scale(1.08); }
    .mark:focus-visible { outline: 2px solid #0a66e0; outline-offset: 2px; }
    .mark.on { background: #0a66e0; border-color: #0a66e0; }
    .mark svg { width: 14px; height: 14px; opacity: 0; }
    .mark.on svg { opacity: 1; }
    .veil { position: fixed; pointer-events: none; border-radius: 10px; }
  `;
  const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  let port = null;
  let turns = [];
  let host = null;
  let layer = null;
  let observer = null;
  let raf = 0;
  let lastMatched = -1;
  const nodes = new Map(); // turn id -> { mark, veil }

  chrome.runtime.onConnect.addListener((p) => {
    if (p.name !== "chatdown-marks") return;
    if (port) port.disconnect();
    port = p;
    p.onMessage.addListener((msg) => {
      if (msg && msg.type === "marks") {
        turns = msg.turns || [];
        mount();
        schedule();
      }
    });
    p.onDisconnect.addListener(() => {
      if (port !== p) return;
      port = null;
      unmount();
    });
  });

  function mount() {
    if (host) return;
    host = document.createElement("chatdown-marks");
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${CSS}</style><div></div>`;
    layer = shadow.querySelector("div");
    document.documentElement.appendChild(host);
    addEventListener("scroll", schedule, true);
    addEventListener("resize", schedule);
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function unmount() {
    if (!host) return;
    removeEventListener("scroll", schedule, true);
    removeEventListener("resize", schedule);
    observer.disconnect();
    host.remove();
    host = layer = observer = null;
    nodes.clear();
    lastMatched = -1;
  }

  function schedule() {
    if (!raf) raf = requestAnimationFrame(draw);
  }

  function veilColor() {
    for (const el of [document.body, document.documentElement]) {
      const m = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
      if (!m) continue;
      const [r, g, b, a = "1"] = m[1].split(",").map((s) => s.trim());
      if (parseFloat(a) > 0) return `rgba(${r}, ${g}, ${b}, 0.62)`;
    }
    return matchMedia("(prefers-color-scheme: dark)").matches ? "rgba(20, 20, 22, 0.62)" : "rgba(255, 255, 255, 0.62)";
  }

  function nodeFor(id) {
    let n = nodes.get(id);
    if (n) return n;
    const veil = document.createElement("div");
    veil.className = "veil";
    const mark = document.createElement("button");
    mark.className = "mark";
    mark.innerHTML = CHECK;
    mark.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (port) port.postMessage({ type: "toggle", id, shift: e.shiftKey });
    });
    mark.addEventListener("mousedown", (e) => e.stopPropagation());
    layer.append(veil, mark);
    n = { mark, veil };
    nodes.set(id, n);
    return n;
  }

  function draw() {
    raf = 0;
    if (!layer) return;
    const matches = matchTurns(turns, pageGroups());
    if (port && matches.length !== lastMatched) {
      lastMatched = matches.length;
      port.postMessage({ type: "status", matched: matches.length, total: turns.length });
    }

    const live = new Set();
    const selected = new Map(turns.map((t) => [t.id, t.selected]));
    const tint = veilColor();
    for (const { id, els } of matches) {
      const rects = els.map((el) => el.getBoundingClientRect()).filter((r) => r.width || r.height);
      if (!rects.length) continue;
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      if (bottom < 0 || top > innerHeight) continue;

      live.add(id);
      const on = !!selected.get(id);
      const { mark, veil } = nodeFor(id);
      // Keep the checkbox in view while a long message scrolls past.
      const y = Math.min(Math.max(top + 2, 8), bottom - 26);
      mark.style.left = `${Math.max(4, left - 34)}px`;
      mark.style.top = `${y}px`;
      mark.style.display = "";
      mark.classList.toggle("on", on);
      mark.setAttribute("aria-pressed", String(on));
      mark.title = on ? "In the export. Click to leave out" : "Left out. Click to include";
      mark.setAttribute("aria-label", mark.title);
      Object.assign(veil.style, {
        display: on ? "none" : "",
        left: `${left - 6}px`,
        top: `${top - 4}px`,
        width: `${right - left + 12}px`,
        height: `${bottom - top + 8}px`,
        background: tint,
      });
    }
    for (const [id, n] of nodes) {
      if (live.has(id)) continue;
      n.mark.style.display = "none";
      n.veil.style.display = "none";
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
