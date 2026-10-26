// Pure converters from provider API payloads to Chatdown's normalized model.
//
//   Conversation = { source, title, url, createdAt, model, messages: Message[] }
//   Message      = { id, role: "user"|"assistant"|"tool"|"system", createdAt, model, blocks: Block[] }
//   Block        = { type: "text", text }
//                | { type: "thinking", text }
//                | { type: "code", language, text }
//                | { type: "tool_use", name, input }
//                | { type: "tool_result", name, text, isError }
//                | { type: "artifact", title, language, text }
//                | { type: "attachment", name, text? }
//
// Loaded as a classic content script and via require() in tests.
(function (root) {
  "use strict";

  // ---------- ChatGPT ----------

  // Walks from current_node up to the root so only the visible branch is exported.
  function chatgptActiveChain(data) {
    const mapping = data.mapping || {};
    const chain = [];
    const seen = new Set();
    let nodeId = data.current_node;
    while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
      seen.add(nodeId);
      const node = mapping[nodeId];
      if (node.message) chain.push(node.message);
      nodeId = node.parent;
    }
    return chain.reverse();
  }

  // ChatGPT inlines citations as private-use-area markers (e.g. "citeturn0search1").
  // Replace referenced spans with their markdown alt text and drop any leftovers.
  function cleanChatgptText(text, metadata) {
    if (!text) return "";
    let out = text;
    const refs = (metadata && metadata.content_references) || [];
    for (const ref of refs) {
      if (!ref || !ref.matched_text) continue;
      let replacement = ref.alt || "";
      if (!replacement && Array.isArray(ref.items) && ref.items.length) {
        replacement = ref.items
          .filter((it) => it && it.url)
          .map((it) => ` ([${it.title || hostname(it.url)}](${it.url}))`)
          .join("");
      }
      out = out.split(ref.matched_text).join(replacement);
    }
    return out.replace(/[^]*/g, "").replace(/[-]/g, "");
  }

  function hostname(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  function isHiddenChatgpt(msg) {
    const md = msg.metadata || {};
    if (md.is_visually_hidden_from_conversation) return true;
    if (md.is_user_system_message) return true;
    const ct = msg.content && msg.content.content_type;
    if (ct === "user_editable_context" || ct === "model_editable_context") return true;
    if (msg.author && msg.author.role === "system") return true;
    return false;
  }

  function chatgptBlocks(msg) {
    const c = msg.content || {};
    const role = msg.author && msg.author.role;
    const recipient = msg.recipient || "all";
    const toolName = (msg.author && msg.author.name) || "tool";
    const md = msg.metadata || {};

    // Assistant addressing a tool (python, web.run, ...) is a tool call.
    if (role === "assistant" && recipient !== "all") {
      const input =
        c.content_type === "code"
          ? c.text
          : (c.parts || []).filter((p) => typeof p === "string").join("\n");
      return input ? [{ type: "tool_use", name: recipient, input }] : [];
    }

    switch (c.content_type) {
      case "text": {
        const text = cleanChatgptText((c.parts || []).join("\n"), md).trim();
        if (!text) return [];
        return role === "tool" ? [{ type: "tool_result", name: toolName, text, isError: false }] : [{ type: "text", text }];
      }
      case "multimodal_text": {
        const blocks = [];
        for (const part of c.parts || []) {
          if (typeof part === "string") {
            const text = cleanChatgptText(part, md).trim();
            if (text) blocks.push({ type: "text", text });
          } else if (part && part.content_type === "image_asset_pointer") {
            blocks.push({ type: "attachment", name: "image" });
          } else if (part && part.content_type === "audio_transcription" && part.text) {
            blocks.push({ type: "text", text: part.text });
          }
        }
        if (role === "tool") {
          const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
          return text ? [{ type: "tool_result", name: toolName, text, isError: false }] : [];
        }
        return blocks;
      }
      case "code":
        return c.text ? [{ type: "code", language: c.language && c.language !== "unknown" ? c.language : "", text: c.text }] : [];
      case "execution_output":
        return c.text ? [{ type: "tool_result", name: toolName, text: c.text, isError: false }] : [];
      case "system_error":
        return [{ type: "tool_result", name: c.name || toolName, text: c.text || "", isError: true }];
      case "thoughts": {
        const text = (c.thoughts || [])
          .map((t) => [t.summary ? `**${t.summary}**` : "", t.content || ""].filter(Boolean).join("\n\n"))
          .filter(Boolean)
          .join("\n\n");
        return text ? [{ type: "thinking", text }] : [];
      }
      case "reasoning_recap":
        return [];
      case "tether_browsing_display":
        return c.result ? [{ type: "tool_result", name: toolName, text: c.result, isError: false }] : [];
      case "tether_quote": {
        const text = [c.title && c.url ? `[${c.title}](${c.url})` : c.url || c.title || "", c.text || ""]
          .filter(Boolean)
          .join("\n\n");
        return text ? [{ type: "tool_result", name: toolName, text, isError: false }] : [];
      }
      default: {
        // Unknown types: keep any string parts so nothing silently disappears.
        const text = (c.parts || []).filter((p) => typeof p === "string").join("\n").trim() || c.text || "";
        if (!text) return [];
        return role === "tool" ? [{ type: "tool_result", name: toolName, text, isError: false }] : [{ type: "text", text }];
      }
    }
  }

  function parseChatGPT(data, url) {
    const messages = [];
    for (const msg of chatgptActiveChain(data)) {
      if (isHiddenChatgpt(msg)) continue;
      const blocks = chatgptBlocks(msg);
      if (!blocks.length) continue;
      messages.push({
        id: msg.id,
        role: msg.author.role,
        createdAt: msg.create_time ? new Date(msg.create_time * 1000).toISOString() : null,
        model: (msg.metadata && msg.metadata.model_slug) || null,
        blocks,
      });
    }
    return {
      source: "chatgpt",
      title: data.title || "ChatGPT conversation",
      url: url || null,
      createdAt: data.create_time ? new Date(data.create_time * 1000).toISOString() : null,
      model: data.default_model_slug || null,
      messages,
    };
  }

  // ---------- Claude ----------

  const CLAUDE_ROOT = "00000000-0000-4000-8000-000000000000";

  function claudeActiveChain(data) {
    const all = data.chat_messages || [];
    const byId = new Map(all.map((m) => [m.uuid, m]));
    const leaf = data.current_leaf_message_uuid;
    if (!leaf || !byId.has(leaf)) {
      return [...all].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    }
    const chain = [];
    const seen = new Set();
    let id = leaf;
    while (id && id !== CLAUDE_ROOT && byId.has(id) && !seen.has(id)) {
      seen.add(id);
      const m = byId.get(id);
      chain.push(m);
      id = m.parent_message_uuid;
    }
    return chain.reverse();
  }

  function claudeToolResultText(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return content ? JSON.stringify(content, null, 2) : "";
    return content
      .map((c) => {
        if (!c) return "";
        if (c.type === "text") return c.text || "";
        if (c.type === "knowledge") return [c.title && c.url ? `[${c.title}](${c.url})` : c.title || "", c.text || ""].filter(Boolean).join("\n");
        return JSON.stringify(c);
      })
      .filter(Boolean)
      .join("\n\n");
  }

  function claudeBlocks(msg) {
    const blocks = [];
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const b of content) {
      if (!b) continue;
      switch (b.type) {
        case "text":
          if (b.text && b.text.trim()) blocks.push({ type: "text", text: b.text.trim() });
          break;
        case "thinking":
          if (b.thinking && b.thinking.trim()) blocks.push({ type: "thinking", text: b.thinking.trim() });
          break;
        case "tool_use": {
          const input = b.input || {};
          if (b.name === "artifacts" && typeof input.content === "string") {
            blocks.push({
              type: "artifact",
              title: input.title || input.id || "Artifact",
              language: input.language || artifactLanguage(input.type),
              text: input.content,
            });
          } else {
            blocks.push({ type: "tool_use", name: b.name || "tool", input });
          }
          break;
        }
        case "tool_result":
          blocks.push({
            type: "tool_result",
            name: b.name || "tool",
            text: claudeToolResultText(b.content),
            isError: !!b.is_error,
          });
          break;
        default:
          break;
      }
    }
    if (!content.length && msg.text && msg.text.trim()) blocks.push({ type: "text", text: msg.text.trim() });

    for (const a of msg.attachments || []) {
      blocks.push({ type: "attachment", name: a.file_name || "attachment", text: a.extracted_content || "" });
    }
    for (const f of msg.files || msg.files_v2 || []) {
      blocks.push({ type: "attachment", name: f.file_name || "file" });
    }
    return blocks;
  }

  function artifactLanguage(type) {
    switch (type) {
      case "text/markdown":
        return "markdown";
      case "text/html":
        return "html";
      case "image/svg+xml":
        return "svg";
      case "application/vnd.ant.react":
        return "jsx";
      case "application/vnd.ant.mermaid":
        return "mermaid";
      default:
        return "";
    }
  }

  function parseClaude(data, url) {
    const messages = [];
    for (const msg of claudeActiveChain(data)) {
      const blocks = claudeBlocks(msg);
      if (!blocks.length) continue;
      messages.push({
        id: msg.uuid,
        role: msg.sender === "human" ? "user" : "assistant",
        createdAt: msg.created_at || null,
        model: null,
        blocks,
      });
    }
    return {
      source: "claude",
      title: data.name || "Claude conversation",
      url: url || null,
      createdAt: data.created_at || null,
      model: data.model || null,
      messages,
    };
  }

  const api = { parseChatGPT, parseClaude, cleanChatgptText };
  root.ChatdownParsers = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
