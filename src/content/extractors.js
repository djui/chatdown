// Site detection and conversation extraction. Prefers each provider's own
// same-origin API (complete, includes tool calls and thinking) and falls back
// to scraping the rendered DOM.
(function (root) {
  "use strict";

  const { parseChatGPT, parseClaude } = root.ChatdownParsers;
  const { htmlToMarkdown } = root.ChatdownHtml2Md;

  const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

  function detectSite(loc) {
    const host = loc.hostname;
    const path = loc.pathname;
    if (host === "chatgpt.com" || host === "chat.openai.com") {
      if (path.startsWith("/codex")) return { source: "codex", id: null };
      const m = path.match(new RegExp(`/c/(${UUID})`, "i"));
      return { source: "chatgpt", id: m ? m[1] : null };
    }
    if (host === "claude.ai") {
      if (path.startsWith("/code")) return { source: "claude-code", id: null };
      const m = path.match(new RegExp(`/chat/(${UUID})`, "i"));
      return { source: "claude", id: m ? m[1] : null };
    }
    return null;
  }

  async function getJSON(url, init) {
    const res = await fetch(url, Object.assign({ credentials: "include" }, init));
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
    return res.json();
  }

  function cookie(name) {
    const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : null;
  }

  // ---------- API extractors ----------

  async function chatgptViaApi(id) {
    const session = await getJSON("/api/auth/session");
    if (!session || !session.accessToken) throw new Error("Not signed in to ChatGPT");
    const headers = { Authorization: `Bearer ${session.accessToken}` };
    const deviceId = cookie("oai-did");
    if (deviceId) headers["oai-device-id"] = deviceId;
    const data = await getJSON(`/backend-api/conversation/${id}`, { headers });
    return parseChatGPT(data, location.href);
  }

  async function claudeOrgId() {
    const fromCookie = cookie("lastActiveOrg");
    if (fromCookie) return fromCookie;
    const orgs = await getJSON("/api/organizations");
    const org = orgs.find((o) => (o.capabilities || []).includes("chat")) || orgs[0];
    if (!org) throw new Error("No Claude organization found");
    return org.uuid;
  }

  async function claudeViaApi(id) {
    const org = await claudeOrgId();
    const data = await getJSON(
      `/api/organizations/${org}/chat_conversations/${id}?tree=True&rendering_mode=messages&render_all_tools=true`
    );
    return parseClaude(data, location.href);
  }

  // ---------- DOM extractors ----------

  // Each strategy returns [{ role, el }] in document order, or [] if it doesn't apply.
  const DOM_STRATEGIES = {
    chatgpt: [
      () =>
        [...document.querySelectorAll("[data-message-author-role]")].map((el) => ({
          role: el.getAttribute("data-message-author-role"),
          el: el.querySelector(".markdown") || el.querySelector(".whitespace-pre-wrap") || el,
        })),
    ],
    claude: [claudeDom],
    // Codex and Claude Code reuse their chat components in places; try those first,
    // then fall back to role-tagged elements, then the whole main pane.
    codex: [
      () =>
        [...document.querySelectorAll("[data-message-author-role]")].map((el) => ({
          role: el.getAttribute("data-message-author-role"),
          el: el.querySelector(".markdown") || el,
        })),
      roleTagged,
      mainPane,
    ],
    "claude-code": [claudeDom, roleTagged, mainPane],
  };

  function claudeDom() {
    const sel = '[data-testid="user-message"], .font-claude-response, .font-claude-message';
    const all = [...document.querySelectorAll(sel)];
    return all
      .filter((el) => !all.some((other) => other !== el && other.contains(el)))
      .map((el) => ({ role: el.matches('[data-testid="user-message"]') ? "user" : "assistant", el }));
  }

  function roleTagged() {
    const all = [
      ...document.querySelectorAll(
        '[data-role="user"], [data-role="assistant"], [data-testid*="user-message" i], [data-testid*="assistant-message" i], [data-testid*="agent-message" i]'
      ),
    ];
    return all
      .filter((el) => !all.some((other) => other !== el && other.contains(el)))
      .map((el) => {
        const tag = (el.getAttribute("data-role") || el.getAttribute("data-testid") || "").toLowerCase();
        return { role: tag.includes("user") ? "user" : "assistant", el };
      });
  }

  function mainPane() {
    const el = document.querySelector("main") || document.body;
    return [{ role: "assistant", el }];
  }

  function cleanTitle(source) {
    let t = document.title || "";
    t = t.replace(/\s*[-|–]\s*(ChatGPT|Claude|Codex)\s*$/i, "").trim();
    if (!t || /^(ChatGPT|Claude|Codex)$/i.test(t)) t = { codex: "Codex task", "claude-code": "Claude Code session" }[source] || "Conversation";
    return t;
  }

  function viaDom(source) {
    for (const strategy of DOM_STRATEGIES[source] || []) {
      const found = strategy().filter((x) => x.el);
      if (!found.length) continue;
      const messages = found
        .map((x, i) => {
          const isUser = x.role === "user";
          // User prompts are plain text; keep them verbatim rather than reinterpreting as HTML.
          const text = isUser ? (x.el.innerText || x.el.textContent || "").trim() : htmlToMarkdown(x.el);
          return {
            id: `dom-${i}`,
            role: isUser ? "user" : "assistant",
            createdAt: null,
            model: null,
            blocks: text ? [{ type: "text", text }] : [],
          };
        })
        .filter((m) => m.blocks.length);
      if (messages.length) {
        return { source, title: cleanTitle(source), url: location.href, createdAt: null, model: null, messages };
      }
    }
    throw new Error("No messages found on this page");
  }

  async function extract() {
    const site = detectSite(location);
    if (!site) throw new Error("Unsupported page");
    const warnings = [];
    if (site.id && (site.source === "chatgpt" || site.source === "claude")) {
      try {
        const conv = site.source === "chatgpt" ? await chatgptViaApi(site.id) : await claudeViaApi(site.id);
        if (conv.messages.length) return { conversation: conv, method: "api", warnings };
        warnings.push("API returned no messages; used page content instead.");
      } catch (err) {
        warnings.push(`API export failed (${err.message}); used page content instead. Thinking and tool calls may be missing.`);
      }
    } else if (site.source === "chatgpt" || site.source === "claude") {
      throw new Error("Open a conversation to export it");
    }
    return { conversation: viaDom(site.source), method: "dom", warnings };
  }

  root.ChatdownExtractors = { detectSite, extract };
})(typeof globalThis !== "undefined" ? globalThis : this);
