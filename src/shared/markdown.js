// Turn grouping and Markdown rendering for normalized conversations (see parsers.js).
// Loaded by the side panel and via require() in tests.
(function (root) {
  "use strict";

  const DEFAULT_OPTIONS = {
    includeThinking: false,
    includeTools: false,
    collapseDetails: true,
    includeTimestamps: false,
    frontMatter: true,
    headingStyle: "heading", // "heading" | "bold"
    userLabel: "You",
    assistantLabel: "", // empty: use the site's name (ChatGPT, Claude, ...)
  };

  const SOURCE_NAMES = {
    chatgpt: "ChatGPT",
    codex: "Codex",
    claude: "Claude",
    "claude-code": "Claude Code",
  };

  function assistantName(conversation, opts) {
    return (opts && opts.assistantLabel) || SOURCE_NAMES[conversation && conversation.source] || "Assistant";
  }

  // A turn is one request (user message) or one response (all consecutive
  // non-user messages, which folds tool calls and tool outputs into the answer).
  function groupTurns(messages) {
    const turns = [];
    for (const m of messages) {
      const role = m.role === "user" ? "user" : "assistant";
      const last = turns[turns.length - 1];
      if (role === "assistant" && last && last.role === "assistant") {
        last.blocks.push(...m.blocks);
        last.messageIds.push(m.id);
        if (!last.model && m.model) last.model = m.model;
        continue;
      }
      turns.push({
        id: m.id,
        role,
        createdAt: m.createdAt || null,
        model: m.model || null,
        messageIds: [m.id],
        blocks: [...m.blocks],
      });
    }
    return turns;
  }

  // Short plain-text preview for the selection list.
  function turnSnippet(turn, max = 220) {
    const parts = [];
    for (const b of turn.blocks) {
      if (b.type === "text") parts.push(b.text);
      else if (b.type === "code") parts.push(b.text);
      else if (b.type === "artifact") parts.push(`${b.title}:`);
      else if (b.type === "attachment") parts.push(`[${b.name}]`);
      if (parts.join(" ").length > max) break;
    }
    const s = parts
      .join(" ")
      .replace(/`{3,}[\w+-]*/g, " ")
      .replace(/(\*\*|__|`)/g, "")
      .replace(/^#+\s+/gm, "")
      .replace(/\s+/g, " ")
      .trim();
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  function fence(text, language = "") {
    const runs = String(text).match(/`{3,}/g) || [];
    const longest = runs.reduce((n, r) => Math.max(n, r.length), 2);
    const f = "`".repeat(longest + 1);
    return `${f}${language || ""}\n${String(text).replace(/\n+$/, "")}\n${f}`;
  }

  function details(summary, body, collapse) {
    if (!collapse) return `**${summary}**\n\n${body}`;
    return `<details>\n<summary>${escapeHtml(summary)}</summary>\n\n${body}\n\n</details>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function toolInputText(input) {
    if (typeof input === "string") return { text: input, language: "" };
    // Common single-field inputs read better unwrapped.
    if (input && typeof input === "object") {
      const keys = Object.keys(input);
      if (keys.length === 1 && typeof input[keys[0]] === "string" && /^(command|code|query|cmd)$/.test(keys[0])) {
        return { text: input[keys[0]], language: keys[0] === "query" ? "" : "sh" };
      }
    }
    return { text: JSON.stringify(input, null, 2), language: "json" };
  }

  function renderBlock(b, opts) {
    switch (b.type) {
      case "text":
        return b.text;
      case "code":
        return fence(b.text, b.language);
      case "artifact":
        return `**${b.title}**\n\n${fence(b.text, b.language)}`;
      case "attachment":
        if (b.text && opts.includeTools) {
          return details(`Attachment: ${b.name}`, fence(b.text), opts.collapseDetails);
        }
        return `> 📎 ${b.name}`;
      case "thinking":
        if (!opts.includeThinking) return null;
        return details("Thinking", b.text.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n"), opts.collapseDetails);
      case "tool_use": {
        if (!opts.includeTools) return null;
        const { text, language } = toolInputText(b.input);
        return details(`Tool call: ${b.name}`, fence(text, language), opts.collapseDetails);
      }
      case "tool_result":
        if (!opts.includeTools) return null;
        return details(`${b.isError ? "Tool error" : "Tool result"}: ${b.name}`, fence(b.text || "(empty)"), opts.collapseDetails);
      default:
        return null;
    }
  }

  function renderTurn(turn, opts, conversation) {
    const label = turn.role === "user" ? opts.userLabel || DEFAULT_OPTIONS.userLabel : assistantName(conversation, opts);
    const meta = [];
    if (opts.includeTimestamps && turn.createdAt) meta.push(formatDate(turn.createdAt));
    if (opts.includeTimestamps && turn.role === "assistant" && turn.model) meta.push(turn.model);
    const suffix = meta.length ? ` · ${meta.join(" · ")}` : "";
    const header = opts.headingStyle === "bold" ? `**${label}**${suffix ? ` *${suffix.slice(3)}*` : ""}` : `## ${label}${suffix}`;
    const body = turn.blocks
      .map((b) => renderBlock(b, opts))
      .filter((s) => s && s.trim())
      .join("\n\n");
    return `${header}\n\n${body || "_(empty)_"}`;
  }

  function formatDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toISOString().replace("T", " ").replace(/:\d\d\.\d+Z$/, " UTC");
  }

  function yamlString(s) {
    return JSON.stringify(String(s));
  }

  function renderMarkdown(conversation, turns, selectedIds, options) {
    const opts = Object.assign({}, DEFAULT_OPTIONS, options || {});
    const selected = selectedIds ? new Set(selectedIds) : null;
    const chosen = turns.filter((t) => !selected || selected.has(t.id));
    const head = [];

    if (opts.frontMatter) {
      const fm = ["---", `title: ${yamlString(conversation.title)}`, `source: ${SOURCE_NAMES[conversation.source] || conversation.source}`];
      if (conversation.url) fm.push(`url: ${conversation.url}`);
      if (conversation.model) fm.push(`model: ${yamlString(conversation.model)}`);
      if (conversation.createdAt) fm.push(`created: ${conversation.createdAt}`);
      fm.push(`exported: ${new Date().toISOString()}`);
      fm.push(`turns: ${chosen.length}/${turns.length}`);
      fm.push("---");
      head.push(fm.join("\n"));
    }
    head.push(`# ${conversation.title}`);

    // Bold labels have no heading to visually separate turns, so add rules.
    const sep = opts.headingStyle === "bold" ? "\n\n---\n\n" : "\n\n";
    const body = chosen.map((t) => renderTurn(t, opts, conversation)).join(sep);
    return head.join("\n\n") + (body ? "\n\n" + body : "") + "\n";
  }

  function filenameFor(conversation, ext = "md") {
    const slug = String(conversation.title || "chat")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    return `${slug || "chat"}.${ext}`;
  }

  const api = { DEFAULT_OPTIONS, SOURCE_NAMES, assistantName, groupTurns, turnSnippet, renderMarkdown, filenameFor, fence };
  root.ChatdownMarkdown = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
