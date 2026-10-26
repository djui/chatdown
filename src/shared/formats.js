// Export formats besides Markdown: a self-contained HTML page (also used for
// PDF via the browser's print dialog), plain text and JSON. Same inputs and
// options as renderMarkdown in markdown.js.
// Loaded after markdown.js and md2html.js by the panel and the website, and via require() in tests.
(function (root) {
  "use strict";

  const md = root.ChatdownMarkdown || require("./markdown.js");
  const { markdownToHtml, escapeHtml: esc } = root.ChatdownMd2Html || require("./md2html.js");
  const { DEFAULT_OPTIONS, SOURCE_NAMES, assistantName, renderMarkdown, filenameFor } = md;

  const FORMATS = {
    markdown: { label: "Markdown", ext: "md", mime: "text/markdown" },
    html: { label: "HTML", ext: "html", mime: "text/html" },
    pdf: { label: "PDF", ext: "pdf", mime: null },
    text: { label: "Plain text", ext: "txt", mime: "text/plain" },
    json: { label: "JSON", ext: "json", mime: "application/json" },
  };

  function prepare(conversation, turns, selectedIds, options) {
    const opts = Object.assign({}, DEFAULT_OPTIONS, options || {});
    const selected = selectedIds ? new Set(selectedIds) : null;
    const chosen = turns.filter((t) => !selected || selected.has(t.id));
    const speaker = (t) => (t.role === "user" ? opts.userLabel || DEFAULT_OPTIONS.userLabel : assistantName(conversation, opts));
    const keep = (b) =>
      (b.type !== "thinking" || opts.includeThinking) && ((b.type !== "tool_use" && b.type !== "tool_result") || opts.includeTools);
    return { opts, chosen, speaker, keep };
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? String(iso) : d.toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
  }

  function toolInput(input) {
    if (typeof input === "string") return input;
    if (input && typeof input === "object") {
      const keys = Object.keys(input);
      if (keys.length === 1 && typeof input[keys[0]] === "string") return input[keys[0]];
    }
    return JSON.stringify(input, null, 2);
  }

  // ---------- HTML ----------

  const CSS = `
:root { color-scheme: light dark; --bg: #fff; --fg: #1d1d1f; --muted: #6e6e73; --line: #e3e3e8; --mine: #f2f2f5; --code: #f6f6f8; --accent: #0a66e0; }
@media (prefers-color-scheme: dark) { :root { --bg: #1c1c1e; --fg: #f2f2f7; --muted: #98989f; --line: #3a3a3c; --mine: #2c2c2e; --code: #242426; --accent: #4c9bff; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 48px 24px 64px; }
header { margin-bottom: 32px; }
h1.title { font-size: 28px; line-height: 1.2; letter-spacing: -0.02em; margin: 0 0 8px; }
.meta { color: var(--muted); font-size: 14px; margin: 0; }
.meta a { color: inherit; }
section.turn { margin: 0 0 24px; }
section.turn.user { background: var(--mine); border-radius: 14px; padding: 14px 18px; }
.speaker { font-size: 13px; font-weight: 650; margin: 0 0 6px; }
.speaker time { font-weight: 400; color: var(--muted); margin-left: 6px; }
.body > :first-child { margin-top: 0; } .body > :last-child { margin-bottom: 0; }
a { color: var(--accent); }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.2em 0 0.5em; }
.body h1 { font-size: 1.4em; } .body h2 { font-size: 1.25em; } .body h3 { font-size: 1.1em; }
p, ul, ol, pre, table, blockquote, details, figure { margin: 0 0 0.9em; }
ul, ol { padding-left: 1.5em; } li { margin: 0.2em 0; } li.task { list-style: none; margin-left: -1.3em; }
code { font: 0.88em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--code); padding: 0.1em 0.35em; border-radius: 4px; }
pre { background: var(--code); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; overflow-x: auto; }
pre code { background: none; padding: 0; font-size: 13px; line-height: 1.5; }
blockquote { border-left: 3px solid var(--line); margin-left: 0; padding-left: 14px; color: var(--muted); }
table { border-collapse: collapse; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; }
th { background: var(--code); }
hr { border: 0; border-top: 1px solid var(--line); margin: 1.5em 0; }
img { max-width: 100%; }
details { border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
details > summary { cursor: pointer; color: var(--muted); font-size: 14px; }
details[open] > summary { margin-bottom: 8px; }
details.thinking .md { color: var(--muted); }
figure.artifact figcaption { font-weight: 600; font-size: 14px; margin-bottom: 6px; }
.attachment { color: var(--muted); font-size: 14px; }
footer { color: var(--muted); font-size: 12px; margin-top: 40px; }
@media print {
  :root { --bg: #fff; --fg: #000; --muted: #555; --line: #ccc; --mine: #f2f2f5; --code: #f6f6f8; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; font-size: 11pt; }
  main { max-width: none; padding: 0; }
  pre, pre code { white-space: pre-wrap; word-break: break-word; }
  pre, table, figure, section.turn.user { break-inside: avoid; }
  a { color: inherit; }
}
@page { margin: 18mm 16mm; }
`.trim();

  function htmlBlock(b, opts) {
    const open = opts.forPrint || !opts.collapseDetails ? " open" : "";
    switch (b.type) {
      case "text":
        return `<div class="md">${markdownToHtml(b.text)}</div>`;
      case "code":
        return `<pre><code${b.language ? ` class="language-${esc(b.language)}"` : ""}>${esc(b.text)}</code></pre>`;
      case "artifact":
        return `<figure class="artifact"><figcaption>${esc(b.title)}</figcaption><pre><code>${esc(b.text)}</code></pre></figure>`;
      case "attachment":
        if (b.text && opts.includeTools) {
          return `<details${open}><summary>Attachment: ${esc(b.name)}</summary><pre>${esc(b.text)}</pre></details>`;
        }
        return `<p class="attachment">📎 ${esc(b.name)}</p>`;
      case "thinking":
        return `<details class="thinking"${open}><summary>Thinking</summary><div class="md">${markdownToHtml(b.text)}</div></details>`;
      case "tool_use":
        return `<details class="tool"${open}><summary>Used ${esc(b.name)}</summary><pre>${esc(toolInput(b.input))}</pre></details>`;
      case "tool_result":
        return `<details class="tool"${open}><summary>${b.isError ? "Error from" : "Result from"} ${esc(b.name)}</summary><pre>${esc(b.text || "(empty)")}</pre></details>`;
      default:
        return "";
    }
  }

  function renderHtml(conversation, turns, selectedIds, options) {
    const { opts, chosen, speaker, keep } = prepare(conversation, turns, selectedIds, options);
    const source = SOURCE_NAMES[conversation.source] || conversation.source;
    const meta = [source];
    if (conversation.createdAt) meta.push(esc(formatDate(conversation.createdAt)));
    if (conversation.url && /^https?:/.test(conversation.url)) meta.push(`<a href="${esc(conversation.url)}">Open original</a>`);

    const sections = chosen.map((t) => {
      const time = opts.includeTimestamps && t.createdAt ? `<time datetime="${esc(t.createdAt)}">${esc(formatDate(t.createdAt))}</time>` : "";
      const body = t.blocks.filter(keep).map((b) => htmlBlock(b, opts)).filter(Boolean).join("\n");
      return `<section class="turn ${t.role}">\n<h2 class="speaker">${esc(speaker(t))}${time}</h2>\n<div class="body">\n${body}\n</div>\n</section>`;
    });

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(conversation.title)}</title>
<style>
${CSS}
</style>
</head>
<body>
<main>
<header>
<h1 class="title">${esc(conversation.title)}</h1>
${opts.frontMatter ? `<p class="meta">${meta.join(" · ")}</p>` : ""}
</header>
${sections.join("\n")}
<footer>Exported with Chatdown</footer>
</main>
</body>
</html>
`;
  }

  // ---------- plain text ----------

  function indent(text) {
    return String(text)
      .split("\n")
      .map((l) => (l ? `    ${l}` : ""))
      .join("\n");
  }

  function textBlock(b) {
    switch (b.type) {
      case "text":
        return b.text;
      case "code":
        return indent(b.text);
      case "artifact":
        return `${b.title}:\n\n${indent(b.text)}`;
      case "attachment":
        return `[Attachment: ${b.name}]`;
      case "thinking":
        return `[Thinking]\n${indent(b.text)}`;
      case "tool_use":
        return `[Used ${b.name}]\n${indent(toolInput(b.input))}`;
      case "tool_result":
        return `[${b.isError ? "Error from" : "Result from"} ${b.name}]\n${indent(b.text || "(empty)")}`;
      default:
        return "";
    }
  }

  function renderText(conversation, turns, selectedIds, options) {
    const { opts, chosen, speaker, keep } = prepare(conversation, turns, selectedIds, options);
    const head = [conversation.title, "=".repeat(Math.min(String(conversation.title).length, 72))];
    if (opts.frontMatter) {
      const meta = [SOURCE_NAMES[conversation.source] || conversation.source];
      if (conversation.createdAt) meta.push(formatDate(conversation.createdAt));
      if (conversation.url) meta.push(conversation.url);
      head.push(meta.join(" · "));
    }
    const body = chosen.map((t) => {
      const time = opts.includeTimestamps && t.createdAt ? ` (${formatDate(t.createdAt)})` : "";
      const text = t.blocks.filter(keep).map(textBlock).filter((s) => s && s.trim()).join("\n\n");
      return `${speaker(t)}${time}:\n${text}`;
    });
    return [head.join("\n"), ...body].join("\n\n") + "\n";
  }

  // ---------- JSON ----------

  function renderJson(conversation, turns, selectedIds, options) {
    const { opts, chosen, speaker, keep } = prepare(conversation, turns, selectedIds, options);
    const data = {
      title: conversation.title,
      source: SOURCE_NAMES[conversation.source] || conversation.source,
      url: conversation.url || null,
      model: conversation.model || null,
      createdAt: conversation.createdAt || null,
      exportedAt: new Date().toISOString(),
      messages: chosen.map((t) => ({
        role: t.role,
        speaker: speaker(t),
        createdAt: opts.includeTimestamps ? t.createdAt || null : undefined,
        model: opts.includeTimestamps ? t.model || null : undefined,
        content: t.blocks.filter(keep),
      })),
    };
    return JSON.stringify(data, null, 2) + "\n";
  }

  // ---------- dispatch ----------

  function render(format, conversation, turns, selectedIds, options) {
    switch (format) {
      case "html":
        return renderHtml(conversation, turns, selectedIds, options);
      case "pdf":
        return renderHtml(conversation, turns, selectedIds, Object.assign({}, options, { forPrint: true }));
      case "text":
        return renderText(conversation, turns, selectedIds, options);
      case "json":
        return renderJson(conversation, turns, selectedIds, options);
      default:
        return renderMarkdown(conversation, turns, selectedIds, options);
    }
  }

  function filenameForFormat(conversation, format) {
    return filenameFor(conversation, (FORMATS[format] || FORMATS.markdown).ext);
  }

  const api = { FORMATS, render, renderHtml, renderText, renderJson, filenameForFormat };
  root.ChatdownFormats = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
