(function () {
  "use strict";

  const { DEFAULT_OPTIONS, assistantName, groupTurns, turnSnippet, renderMarkdown } = globalThis.ChatdownMarkdown;
  const { FORMATS, render: renderExport, filenameForFormat } = globalThis.ChatdownFormats;

  const SUPPORTED = /^https:\/\/(chatgpt\.com|chat\.openai\.com|claude\.ai)\//;
  const CONTENT_FILES = [
    "src/content/html2md.js",
    "src/content/parsers.js",
    "src/content/extractors.js",
    "src/content/content.js",
    "src/content/onpage.js",
  ];
  const PANEL_DEFAULTS = { format: "markdown", markOnPage: true };
  const SOURCE_NAMES = { chatgpt: "ChatGPT", codex: "Codex", claude: "Claude", "claude-code": "Claude Code" };

  const $ = (id) => document.getElementById(id);

  const state = {
    tabId: null,
    url: null,
    conversation: null,
    turns: [],
    selected: new Set(),
    knownIds: new Set(),
    expanded: new Set(),
    lastIndex: null,
    options: { ...DEFAULT_OPTIONS },
    loadSeq: 0,
    port: null,
    baseStatus: "",
  };

  // ---------- loading ----------

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  }

  async function requestExtract(tabId) {
    try {
      return await chrome.tabs.sendMessage(tabId, { type: "chatdown:extract" });
    } catch {
      // Tab predates the extension install/reload: inject and retry once.
      await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_FILES });
      return chrome.tabs.sendMessage(tabId, { type: "chatdown:extract" });
    }
  }

  async function load() {
    const seq = ++state.loadSeq;
    const tab = await activeTab();
    if (seq !== state.loadSeq) return;

    if (!tab || !tab.url || !SUPPORTED.test(tab.url)) {
      state.tabId = tab ? tab.id : null;
      state.url = tab ? tab.url : null;
      showEmpty("Open a ChatGPT, Codex, Claude or Claude Code conversation, then click Chatdown again or press ↻.");
      return;
    }

    const sameUrl = state.url === tab.url && state.conversation;
    if (state.tabId !== tab.id || !sameUrl) disconnectMarks();
    state.tabId = tab.id;
    state.url = tab.url;
    setStatus("Loading conversation…");

    let res;
    try {
      res = await requestExtract(tab.id);
    } catch (err) {
      res = { ok: false, error: err.message || String(err) };
    }
    if (seq !== state.loadSeq) return;

    if (!res || !res.ok) {
      showEmpty(res && res.error ? res.error : "Could not read this page.");
      return;
    }

    const prevSelected = state.selected;
    state.conversation = res.conversation;
    state.turns = groupTurns(res.conversation.messages);
    // Keep the user's selection across reloads of the same page; new turns start selected.
    const ids = state.turns.map((t) => t.id);
    state.selected = sameUrl ? new Set(ids.filter((id) => prevSelected.has(id) || !state.knownIds.has(id))) : new Set(ids);
    state.knownIds = new Set(ids);
    if (!sameUrl) state.expanded = new Set();
    state.lastIndex = null;

    const n = state.turns.length;
    const via = res.method === "api" ? "complete" : "read from the page";
    const warn = res.warnings && res.warnings.length ? "Read from the page, so thinking and tool use may be missing." : "";
    state.baseStatus = warn || `${n} message${n === 1 ? "" : "s"} · ${via}`;
    setStatus(state.baseStatus, !!warn);
    render();
    syncMarks();
  }

  // ---------- checkboxes on the page ----------

  function disconnectMarks() {
    if (!state.port) return;
    state.port.disconnect();
    state.port = null;
  }

  function syncMarks() {
    if (!state.options.markOnPage || !state.conversation || state.tabId == null) {
      disconnectMarks();
      return;
    }
    if (!state.port) {
      try {
        state.port = chrome.tabs.connect(state.tabId, { name: "chatdown-marks" });
      } catch {
        return;
      }
      const port = state.port;
      port.onDisconnect.addListener(() => {
        if (state.port === port) state.port = null;
      });
      port.onMessage.addListener((msg) => {
        if (msg.type === "toggle") {
          const index = state.turns.findIndex((t) => t.id === msg.id);
          if (index >= 0) toggle(index, msg.shift);
        } else if (msg.type === "status" && msg.total) {
          const off = msg.matched === 0;
          setStatus(off ? `${state.baseStatus} · Couldn't place checkboxes on this page` : state.baseStatus, $("status").classList.contains("warn"));
        }
      });
    }
    state.port.postMessage({
      type: "marks",
      turns: state.turns.map((t) => ({ id: t.id, role: t.role, messageIds: t.messageIds, selected: state.selected.has(t.id) })),
    });
  }

  // ---------- rendering ----------

  function showEmpty(text) {
    state.conversation = null;
    state.turns = [];
    $("title").textContent = "Chatdown";
    $("source").hidden = true;
    $("main").hidden = true;
    $("footer").hidden = true;
    $("empty").hidden = false;
    $("empty-text").textContent = text;
    setStatus("");
  }

  function setStatus(text, warn = false) {
    $("status").textContent = text;
    $("status").classList.toggle("warn", warn);
  }

  function render() {
    const conv = state.conversation;
    $("empty").hidden = true;
    $("main").hidden = false;
    $("footer").hidden = false;
    $("title").textContent = conv.title;
    $("title").title = conv.title;
    $("source").hidden = false;
    $("source").textContent = SOURCE_NAMES[conv.source] || conv.source;
    $("select-assistant").textContent = `${SOURCE_NAMES[conv.source] || "Assistant"}'s`;
    $("assistant-label").placeholder = SOURCE_NAMES[conv.source] || "Assistant";

    const list = $("turns");
    list.textContent = "";
    state.turns.forEach((turn, index) => list.appendChild(renderTurn(turn, index)));
    updateCount();
  }

  function speaker(turn) {
    return turn.role === "user" ? state.options.userLabel || DEFAULT_OPTIONS.userLabel : assistantName(state.conversation, state.options);
  }

  function renderTurn(turn, index) {
    const li = document.createElement("li");
    li.className = `turn ${turn.role}`;
    li.dataset.index = index;

    const box = document.createElement("input");
    box.type = "checkbox";
    box.tabIndex = -1;

    const meta = document.createElement("div");
    meta.className = "meta";
    const role = document.createElement("span");
    role.className = "role";
    role.textContent = speaker(turn);
    meta.appendChild(role);

    const counts = countBlocks(turn);
    if (counts.tools) meta.appendChild(chip("used tools"));
    if (counts.thinking) meta.appendChild(chip("thinking"));
    if (counts.code) meta.appendChild(chip("code"));
    if (counts.attachments) meta.appendChild(chip(`📎 ${counts.attachments}`));

    const expand = document.createElement("button");
    expand.className = "expand";
    expand.textContent = state.expanded.has(turn.id) ? "Hide" : "Show";
    expand.addEventListener("click", (e) => {
      e.stopPropagation();
      if (state.expanded.has(turn.id)) state.expanded.delete(turn.id);
      else state.expanded.add(turn.id);
      li.replaceWith(renderTurn(turn, index));
    });
    meta.appendChild(expand);

    const snippet = document.createElement("div");
    snippet.className = "snippet";
    snippet.textContent = turnSnippet(turn) || "(no text)";
    box.setAttribute("aria-label", `Include ${speaker(turn)}: ${snippet.textContent.slice(0, 60)}`);

    li.append(box, meta, document.createElement("span"), snippet);

    if (state.expanded.has(turn.id)) {
      const full = document.createElement("pre");
      full.className = "full";
      full.textContent = renderMarkdown(state.conversation, [turn], null, { ...state.options, frontMatter: false })
        .replace(/^# .*\n\n/, "")
        .trim();
      full.addEventListener("click", (e) => e.stopPropagation());
      li.appendChild(full);
    }

    li.addEventListener("click", (e) => toggle(index, e.shiftKey));
    applySelected(li, turn);
    return li;
  }

  function chip(text) {
    const s = document.createElement("span");
    s.className = "chip";
    s.textContent = text;
    return s;
  }

  function countBlocks(turn) {
    const c = { tools: 0, thinking: 0, code: 0, attachments: 0 };
    for (const b of turn.blocks) {
      if (b.type === "tool_use") c.tools++;
      else if (b.type === "thinking") c.thinking++;
      else if (b.type === "code" || b.type === "artifact" || (b.type === "text" && b.text.includes("```"))) c.code++;
      else if (b.type === "attachment") c.attachments++;
    }
    return c;
  }

  function applySelected(li, turn) {
    const on = state.selected.has(turn.id);
    li.classList.toggle("off", !on);
    li.querySelector("input").checked = on;
  }

  function refreshSelection() {
    for (const li of $("turns").children) applySelected(li, state.turns[+li.dataset.index]);
    updateCount();
    syncMarks();
  }

  function updateCount() {
    const n = state.selected.size;
    $("count").textContent = `${n} of ${state.turns.length} included`;
    for (const id of ["copy-btn", "download-btn", "preview-btn"]) $(id).disabled = n === 0;
  }

  // ---------- selection ----------

  function toggle(index, range) {
    const turn = state.turns[index];
    const on = !state.selected.has(turn.id);
    if (range && state.lastIndex !== null) {
      const [a, b] = [Math.min(state.lastIndex, index), Math.max(state.lastIndex, index)];
      for (let i = a; i <= b; i++) setSelected(state.turns[i].id, on);
    } else {
      setSelected(turn.id, on);
    }
    state.lastIndex = index;
    refreshSelection();
  }

  function setSelected(id, on) {
    if (on) state.selected.add(id);
    else state.selected.delete(id);
  }

  function quickSelect(kind) {
    const ids = state.turns.map((t) => t.id);
    switch (kind) {
      case "all":
        state.selected = new Set(ids);
        break;
      case "none":
        state.selected = new Set();
        break;
      case "user":
      case "assistant":
        state.selected = new Set(state.turns.filter((t) => t.role === kind).map((t) => t.id));
        break;
      case "invert":
        state.selected = new Set(ids.filter((id) => !state.selected.has(id)));
        break;
    }
    state.lastIndex = null;
    refreshSelection();
  }

  // ---------- output ----------

  function format() {
    return FORMATS[state.options.format] ? state.options.format : "markdown";
  }

  function selectedIds() {
    return state.turns.filter((t) => state.selected.has(t.id)).map((t) => t.id);
  }

  function output(fmt = format()) {
    return renderExport(fmt, state.conversation, state.turns, selectedIds(), state.options);
  }

  async function copy() {
    const fmt = format();
    const rich = fmt === "html" || fmt === "pdf";
    // HTML and PDF copy as rich text (pastes formatted into Docs, Notion, mail),
    // with the Markdown as the plain-text fallback.
    const plain = rich ? output("markdown") : output(fmt);
    try {
      if (rich) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([output("html")], { type: "text/html" }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
    } catch {
      const ta = document.createElement("textarea");
      ta.value = plain;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast(rich ? "Copied as formatted text" : `Copied ${FORMATS[fmt].label}`);
  }

  async function download() {
    const fmt = format();
    if (fmt === "pdf") {
      await chrome.storage.session.set({ printHtml: output("pdf") });
      await chrome.tabs.create({ url: chrome.runtime.getURL("src/print/print.html") });
      return;
    }
    const blob = new Blob([output(fmt)], { type: `${FORMATS[fmt].mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filenameForFormat(state.conversation, fmt);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function preview() {
    const fmt = format();
    const visual = fmt === "html" || fmt === "pdf";
    $("preview-title").textContent = `${FORMATS[fmt].label} preview`;
    $("preview-text").hidden = visual;
    $("preview-frame").hidden = !visual;
    if (visual) $("preview-frame").srcdoc = output(fmt);
    else $("preview-text").value = output(fmt);
    $("preview").showModal();
    $("preview-text").scrollTop = 0;
  }

  function updateFormatUi() {
    const fmt = format();
    $("format").value = fmt;
    $("download-btn").textContent = fmt === "pdf" ? "Save as PDF" : `Download .${FORMATS[fmt].ext}`;
  }

  function onFormatChange() {
    state.options.format = $("format").value;
    chrome.storage.local.set({ options: state.options });
    updateFormatUi();
  }

  let toastTimer;
  function toast(text) {
    const el = $("toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
  }

  // ---------- options ----------

  async function loadOptions() {
    try {
      const { options } = await chrome.storage.local.get("options");
      state.options = { ...DEFAULT_OPTIONS, ...PANEL_DEFAULTS, ...(options || {}) };
      // 0.1.0 stored its defaults; treat those as unset so the new names apply.
      if (state.options.userLabel === "User") state.options.userLabel = DEFAULT_OPTIONS.userLabel;
      if (state.options.assistantLabel === "Assistant") state.options.assistantLabel = DEFAULT_OPTIONS.assistantLabel;
    } catch {
      state.options = { ...DEFAULT_OPTIONS, ...PANEL_DEFAULTS };
    }
    for (const el of document.querySelectorAll("[data-opt]")) {
      const v = state.options[el.dataset.opt];
      if (el.type === "checkbox") el.checked = !!v;
      else el.value = v;
    }
    updateFormatUi();
  }

  function onOptionChange(e) {
    const el = e.target;
    if (!el.dataset.opt) return;
    let v = el.type === "checkbox" ? el.checked : el.value;
    if (el.type === "text" && !v.trim()) v = DEFAULT_OPTIONS[el.dataset.opt];
    state.options[el.dataset.opt] = v;
    chrome.storage.local.set({ options: state.options });
    if (el.dataset.opt === "markOnPage") syncMarks();
    if (state.conversation && (state.expanded.size || el.type === "text")) render();
  }

  // ---------- wiring ----------

  document.querySelectorAll("[data-select]").forEach((b) => b.addEventListener("click", () => quickSelect(b.dataset.select)));
  $("refresh").addEventListener("click", load);
  $("copy-btn").addEventListener("click", copy);
  $("download-btn").addEventListener("click", download);
  $("preview-btn").addEventListener("click", preview);
  $("options").addEventListener("change", onOptionChange);
  $("format").addEventListener("change", onFormatChange);

  chrome.tabs.onActivated.addListener(() => load());

  let navTimer;
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (tabId !== state.tabId) return;
    if (!info.url && info.status !== "complete") return;
    // SPA navigation updates the URL before the new chat renders; give it a moment.
    clearTimeout(navTimer);
    navTimer = setTimeout(load, 700);
  });

  loadOptions().then(load);
})();
