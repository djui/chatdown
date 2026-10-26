// Live demo: real parsers.js + markdown.js from the extension, fed with
// API-shaped sample conversations. Also fills in the latest release version.
(function () {
  "use strict";

  const { parseClaude, parseChatGPT } = window.ChatdownParsers;
  const { DEFAULT_OPTIONS, assistantName, groupTurns, turnSnippet, renderMarkdown, filenameFor } = window.ChatdownMarkdown;

  // ---------- samples (shaped like each site's conversation API) ----------

  const ROOT = "00000000-0000-4000-8000-000000000000";

  const claudeSample = {
    name: "Debouncing a search box",
    model: "claude-sonnet",
    created_at: "2026-10-21T08:14:00Z",
    current_leaf_message_uuid: "c6",
    chat_messages: [
      { uuid: "c1", parent_message_uuid: ROOT, sender: "human", created_at: "2026-10-21T08:14:00Z",
        content: [{ type: "text", text: "My search box fires a request on every keystroke. Debounce or throttle?" }] },
      { uuid: "c2", parent_message_uuid: "c1", sender: "assistant", created_at: "2026-10-21T08:14:09Z",
        content: [
          { type: "thinking", thinking: "Search-as-you-type wants the final value, not periodic samples. That's debounce.\nWorth mentioning cancelling in-flight requests too." },
          { type: "text", text: "**Debounce.** You only care about what the user typed once they pause, so wait for a quiet gap and send one request:\n\n```ts\nfunction debounce<T extends unknown[]>(fn: (...a: T) => void, ms = 250) {\n  let t: ReturnType<typeof setTimeout>;\n  return (...a: T) => {\n    clearTimeout(t);\n    t = setTimeout(() => fn(...a), ms);\n  };\n}\n```\n\nThrottle fits continuous signals like scroll or resize, where you want regular samples." },
        ] },
      { uuid: "c3", parent_message_uuid: "c2", sender: "human", created_at: "2026-10-21T08:15:30Z",
        content: [{ type: "text", text: "Responses sometimes arrive out of order. Older results overwrite newer ones." }] },
      { uuid: "c4", parent_message_uuid: "c3", sender: "assistant", created_at: "2026-10-21T08:15:41Z",
        content: [
          { type: "tool_use", name: "web_search", input: { query: "AbortController fetch cancel previous request" } },
          { type: "tool_result", name: "web_search", content: [{ type: "text", text: "MDN: AbortController — abort one or more DOM requests as and when desired." }] },
          { type: "text", text: "Cancel the previous request when a new one starts. `AbortController` does exactly that:\n\n```ts\nlet ctrl: AbortController | undefined;\n\nasync function search(q: string) {\n  ctrl?.abort();\n  ctrl = new AbortController();\n  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });\n  render(await res.json());\n}\n```\n\nAn aborted fetch rejects with `AbortError`, which you can ignore." },
        ] },
      { uuid: "c5", parent_message_uuid: "c4", sender: "human", created_at: "2026-10-21T08:17:02Z",
        content: [{ type: "text", text: "Write this up as a short checklist for the team." }] },
      { uuid: "c6", parent_message_uuid: "c5", sender: "assistant", created_at: "2026-10-21T08:17:15Z",
        content: [
          { type: "tool_use", name: "artifacts", input: { title: "Search input checklist", type: "text/markdown", content: "# Search input checklist\n\n- [ ] Debounce input (~250 ms)\n- [ ] Abort the previous request\n- [ ] Ignore `AbortError`\n- [ ] Show a spinner only after 150 ms" } },
          { type: "text", text: "Here's a checklist you can paste into the PR template." },
        ] },
    ],
  };

  const gptNodes = [];
  const gptMsg = (id, parent, role, content, extra = {}) =>
    gptNodes.push([id, parent, {
      id, author: { role, name: extra.name }, recipient: extra.recipient || "all",
      create_time: 1792832400 + gptNodes.length * 20, content, metadata: extra.metadata || {},
    }]);
  gptNodes.push(["root", null, null]);
  gptMsg("g1", "root", "user", { content_type: "text", parts: ["Here's my expenses.csv. What did I spend most on in September?"] });
  gptMsg("g2", "g1", "assistant", { content_type: "thoughts", thoughts: [{ summary: "Planning", content: "Load the CSV, filter September, group by category, sum." }] });
  gptMsg("g3", "g2", "assistant", { content_type: "code", language: "python", text: "import pandas as pd\ndf = pd.read_csv('expenses.csv', parse_dates=['date'])\nsep = df[df.date.dt.month == 9]\nsep.groupby('category').amount.sum().sort_values(ascending=False).head(3)" }, { recipient: "python" });
  gptMsg("g4", "g3", "tool", { content_type: "execution_output", text: "category\nRent        1450.00\nGroceries    412.35\nTravel       389.90" }, { name: "python" });
  gptMsg("g5", "g4", "assistant", { content_type: "text", parts: ["Apart from **rent** ($1,450), your biggest category was **groceries** at $412.35, just ahead of travel at $389.90.\n\n| Category | Spent |\n| --- | ---: |\n| Rent | $1,450.00 |\n| Groceries | $412.35 |\n| Travel | $389.90 |"] }, { metadata: { model_slug: "gpt-5" } });
  gptMsg("g6", "g5", "user", { content_type: "text", parts: ["Is that a lot for groceries?"] });
  gptMsg("g7", "g6", "assistant", { content_type: "text", parts: ["It's in the typical range for a one-person household in a large city citeturn0search0. If you want to trim it, the usual levers are a weekly plan and fewer small top-up shops."] }, { metadata: { model_slug: "gpt-5", content_references: [{ matched_text: "citeturn0search0", alt: "([BLS](https://www.bls.gov/cex/))" }] } });
  const chatgptSample = { title: "September spending", create_time: 1792832400, default_model_slug: "gpt-5", current_node: "g7", mapping: {} };
  for (const [id, parent, message] of gptNodes) chatgptSample.mapping[id] = { id, parent, message };

  const SAMPLES = {
    claude: () => parseClaude(claudeSample, "https://claude.ai/chat/…"),
    chatgpt: () => parseChatGPT(chatgptSample, "https://chatgpt.com/c/…"),
  };
  const SOURCE = { claude: "Claude", chatgpt: "ChatGPT" };

  // ---------- state ----------

  const $ = (id) => document.getElementById(id);
  const state = {
    sample: "claude",
    conv: null,
    turns: [],
    selected: new Set(),
    last: null,
    opts: { ...DEFAULT_OPTIONS },
  };

  function load(sample) {
    state.sample = sample;
    state.conv = SAMPLES[sample]();
    state.turns = groupTurns(state.conv.messages);
    state.selected = new Set(state.turns.map((t) => t.id));
    state.last = null;
    $("d-source").textContent = SOURCE[sample];
    $("d-title").textContent = state.conv.title;
    $("d-file").textContent = filenameFor(state.conv);
    $("d-select-assistant").textContent = `${SOURCE[sample]}'s`;
    document.querySelectorAll("[data-sample]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.sample === sample)));
    renderTurns();
    renderOutput();
  }

  // ---------- panel ----------

  function renderTurns() {
    const list = $("d-turns");
    list.textContent = "";
    state.turns.forEach((turn, i) => {
      const li = document.createElement("li");
      li.className = `turn ${turn.role}`;
      li.dataset.index = i;
      li.tabIndex = 0;
      li.setAttribute("role", "checkbox");

      const box = document.createElement("input");
      box.type = "checkbox";
      box.tabIndex = -1;
      box.setAttribute("aria-hidden", "true");

      const meta = document.createElement("div");
      meta.className = "meta";
      const role = document.createElement("span");
      role.className = "role";
      role.textContent = turn.role === "user" ? DEFAULT_OPTIONS.userLabel : assistantName(state.conv, state.opts);
      meta.append(role, ...chips(turn));

      const snip = document.createElement("div");
      snip.className = "snippet";
      snip.textContent = turnSnippet(turn, 160);

      li.append(box, meta, document.createElement("span"), snip);
      li.setAttribute("aria-label", `${role.textContent}: ${snip.textContent}`);
      li.addEventListener("click", (e) => toggle(i, e.shiftKey));
      li.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          toggle(i, e.shiftKey);
        }
      });
      list.appendChild(li);
    });
    paintSelection();
  }

  function chips(turn) {
    const c = { tool: 0, thinking: 0, code: 0 };
    for (const b of turn.blocks) {
      if (b.type === "tool_use") c.tool++;
      else if (b.type === "thinking") c.thinking++;
      else if (b.type === "code" || b.type === "artifact" || (b.type === "text" && b.text.includes("```"))) c.code++;
    }
    const out = [];
    const chip = (t) => {
      const s = document.createElement("span");
      s.className = "chip";
      s.textContent = t;
      out.push(s);
    };
    if (c.tool) chip("used tools");
    if (c.thinking) chip("thinking");
    if (c.code) chip("code");
    return out;
  }

  function paintSelection() {
    for (const li of $("d-turns").children) {
      const on = state.selected.has(state.turns[+li.dataset.index].id);
      li.classList.toggle("off", !on);
      li.querySelector("input").checked = on;
      li.setAttribute("aria-checked", String(on));
    }
    $("d-count").textContent = `${state.selected.size} of ${state.turns.length} included`;
  }

  function toggle(i, range) {
    const on = !state.selected.has(state.turns[i].id);
    const [a, b] = range && state.last !== null ? [Math.min(state.last, i), Math.max(state.last, i)] : [i, i];
    for (let k = a; k <= b; k++) {
      if (on) state.selected.add(state.turns[k].id);
      else state.selected.delete(state.turns[k].id);
    }
    state.last = i;
    paintSelection();
    renderOutput();
  }

  function quick(kind) {
    const ids = state.turns.filter((t) => kind === "all" || t.role === kind).map((t) => t.id);
    state.selected = new Set(kind === "none" ? [] : ids);
    state.last = null;
    paintSelection();
    renderOutput();
  }

  // ---------- output ----------

  function markdown() {
    const ids = state.turns.filter((t) => state.selected.has(t.id)).map((t) => t.id);
    return renderMarkdown(state.conv, state.turns, ids, state.opts);
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function inline(s) {
    return s
      .replace(/(`+)([^`]+?)\1/g, '<span class="ic">$&</span>')
      .replace(/\*\*([^*]+)\*\*/g, '<span class="b">$&</span>');
  }

  // Line-based highlighter: just enough to make the structure readable.
  function highlight(md) {
    const lines = md.split("\n");
    let inFm = false;
    let fence = null;
    return lines
      .map((raw, i) => {
        const line = escapeHtml(raw);
        if (i === 0 && raw === "---") { inFm = true; return `<span class="fm">${line}</span>`; }
        if (inFm) { if (raw === "---") inFm = false; return `<span class="fm">${line}</span>`; }
        const f = raw.match(/^(`{3,})/);
        if (fence) {
          if (f && f[1].length >= fence.length && raw.trim() === f[1]) { fence = null; return `<span class="fence">${line}</span>`; }
          return `<span class="code">${line}</span>`;
        }
        if (f) { fence = f[1]; return `<span class="fence">${line}</span>`; }
        if (/^#{1,6} /.test(raw)) return `<span class="h">${line}</span>`;
        if (/^&lt;\/?(details|summary)/.test(line)) return `<span class="tag">${line}</span>`;
        if (/^&gt;/.test(line)) return `<span class="q">${line}</span>`;
        if (raw === "---") return `<span class="hr">${line}</span>`;
        return inline(line);
      })
      .join("\n");
  }

  function renderOutput() {
    const md = markdown();
    $("d-out").innerHTML = highlight(md);
    const lines = md.split("\n").length;
    $("d-stats").textContent = `${lines} lines · ${md.length.toLocaleString()} chars`;
  }

  // ---------- wiring ----------

  document.querySelectorAll("[data-sample]").forEach((b) => b.addEventListener("click", () => load(b.dataset.sample)));
  document.querySelectorAll("[data-select]").forEach((b) => b.addEventListener("click", () => quick(b.dataset.select)));
  document.querySelectorAll("[data-opt]").forEach((el) => {
    el.addEventListener("change", () => {
      if (el.dataset.opt === "boldStyle") state.opts.headingStyle = el.checked ? "bold" : "heading";
      else state.opts[el.dataset.opt] = el.checked;
      renderOutput();
    });
  });

  $("d-copy").addEventListener("click", async (e) => {
    try {
      await navigator.clipboard.writeText(markdown());
      e.target.textContent = "Copied";
    } catch {
      e.target.textContent = "Copy failed";
    }
    setTimeout(() => (e.target.textContent = "Copy"), 1400);
  });

  $("d-download").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([markdown()], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filenameFor(state.conv);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });

  load("claude");

  // ---------- latest release ----------

  fetch("https://api.github.com/repos/djui/chatdown/releases/latest")
    .then((r) => (r.ok ? r.json() : null))
    .then((rel) => {
      if (!rel || !rel.tag_name) return;
      const v = rel.tag_name;
      document.querySelectorAll("[data-version]").forEach((el) => (el.textContent = v));
      document.querySelectorAll("[data-version-bare]").forEach((el) => (el.textContent = v.replace(/^v/, "")));
      const zip = (rel.assets || []).find((a) => a.name.endsWith(".zip"));
      if (zip) document.getElementById("download").href = zip.browser_download_url;
    })
    .catch(() => {});
})();
