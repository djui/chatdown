// Minimal DOM → Markdown converter for rendered chat messages.
// Used when a provider API is unavailable (Codex, Claude Code) or fails.
(function (root) {
  "use strict";

  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "BUTTON", "TEXTAREA", "INPUT", "SELECT", "TEMPLATE"]);
  const BLOCK = new Set(["P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "MAIN", "ASIDE", "FIGURE", "FIGCAPTION", "DETAILS", "SUMMARY", "DL", "DT", "DD"]);

  function htmlToMarkdown(el) {
    const ctx = { pre: false, fences: [] };
    let md = children(el, ctx);
    md = md
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    // Fenced code was held out so whitespace cleanup doesn't touch it.
    return md.replace(/\u0000(\d+)\u0000/g, (_, i) => ctx.fences[+i]);
  }

  function children(el, ctx) {
    let out = "";
    for (const n of el.childNodes) out += node(n, ctx);
    return out;
  }

  function node(n, ctx) {
    if (n.nodeType === 3) {
      return ctx.pre ? n.nodeValue : n.nodeValue.replace(/\s+/g, " ");
    }
    if (n.nodeType !== 1) return "";
    const tag = n.tagName.toUpperCase();

    // KaTeX: prefer the TeX source over the rendered HTML.
    if (n.classList && (n.classList.contains("katex-display") || n.classList.contains("katex"))) {
      const tex = n.querySelector('annotation[encoding="application/x-tex"]');
      if (tex) {
        return n.classList.contains("katex-display") ? `\n\n$$\n${tex.textContent.trim()}\n$$\n\n` : `$${tex.textContent.trim()}$`;
      }
    }

    if (SKIP.has(tag)) return "";
    if (n.getAttribute && (n.getAttribute("aria-hidden") === "true" || n.hidden)) return "";
    if (n.classList && n.classList.contains("sr-only")) return "";

    switch (tag) {
      case "H1":
      case "H2":
      case "H3":
      case "H4":
      case "H5":
      case "H6":
        return `\n\n${"#".repeat(+tag[1])} ${children(n, ctx).trim()}\n\n`;
      case "BR":
        return "\n";
      case "HR":
        return "\n\n---\n\n";
      case "STRONG":
      case "B":
        return wrapInline(children(n, ctx), "**");
      case "EM":
      case "I":
        return wrapInline(children(n, ctx), "*");
      case "DEL":
      case "S":
        return wrapInline(children(n, ctx), "~~");
      case "CODE":
        return inlineCode(n.textContent);
      case "PRE":
        return pre(n, ctx);
      case "A": {
        const text = children(n, ctx).trim();
        const href = n.getAttribute("href");
        if (!href || href.startsWith("javascript:")) return text;
        const abs = absolute(href);
        if (!text) return `<${abs}>`;
        return text === abs ? `<${abs}>` : `[${text}](${abs})`;
      }
      case "IMG": {
        const src = n.getAttribute("src");
        if (!src || src.startsWith("data:")) return n.getAttribute("alt") ? `[image: ${n.getAttribute("alt")}]` : "";
        return `![${n.getAttribute("alt") || ""}](${absolute(src)})`;
      }
      case "UL":
      case "OL":
        return `\n\n${list(n, ctx, tag === "OL")}\n\n`;
      case "BLOCKQUOTE": {
        const inner = htmlToMarkdownWith(n, ctx);
        return `\n\n${inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n")}\n\n`;
      }
      case "TABLE":
        return `\n\n${table(n, ctx)}\n\n`;
      default:
        if (BLOCK.has(tag)) {
          const inner = children(n, ctx).trim();
          return inner ? (tag === "DIV" ? `\n${inner}\n` : `\n\n${inner}\n\n`) : "";
        }
        return children(n, ctx);
    }
  }

  // Converts a subtree independently but shares the fence store.
  function htmlToMarkdownWith(el, ctx) {
    return children(el, ctx).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function wrapInline(s, mark) {
    const t = s.trim();
    if (!t) return s;
    const lead = s.match(/^\s*/)[0] ? " " : "";
    const trail = s.match(/\s*$/)[0] ? " " : "";
    return `${lead}${mark}${t}${mark}${trail}`;
  }

  function inlineCode(text) {
    const t = text.replace(/\n/g, " ");
    const runs = t.match(/`+/g) || [];
    const n = runs.reduce((m, r) => Math.max(m, r.length), 0) + 1;
    const tick = "`".repeat(n);
    const pad = t.startsWith("`") || t.endsWith("`") ? " " : "";
    return `${tick}${pad}${t}${pad}${tick}`;
  }

  function pre(n, ctx) {
    const code = n.querySelector("code");
    const src = code || n;
    let language = "";
    const cls = (code && code.className) || n.className || "";
    const m = String(cls).match(/(?:language|lang)-([\w+#.-]+)/);
    if (m) language = m[1];
    const text = src.textContent.replace(/\n+$/, "");
    const runs = text.match(/`{3,}/g) || [];
    const f = "`".repeat(runs.reduce((k, r) => Math.max(k, r.length), 2) + 1);
    ctx.fences.push(`${f}${language}\n${text}\n${f}`);
    return `\n\n\u0000${ctx.fences.length - 1}\u0000\n\n`;
  }

  function list(n, ctx, ordered) {
    const start = parseInt(n.getAttribute("start") || "1", 10) || 1;
    const items = [...n.children].filter((c) => c.tagName === "LI");
    return items
      .map((li, i) => {
        const marker = ordered ? `${start + i}. ` : "- ";
        let body = htmlToMarkdownWith(li, ctx);
        if (!body.includes("\u0000")) body = body.replace(/\n{2,}/g, "\n");
        const indent = " ".repeat(marker.length);
        return marker + body.split("\n").map((l, j) => (j === 0 || !l ? l : indent + l)).join("\n");
      })
      .join("\n");
  }

  function table(n, ctx) {
    const rows = [...n.querySelectorAll("tr")].map((tr) =>
      [...tr.children]
        .filter((c) => c.tagName === "TD" || c.tagName === "TH")
        .map((c) => htmlToMarkdownWith(c, ctx).replace(/\n+/g, " ").replace(/\|/g, "\\|"))
    );
    if (!rows.length) return "";
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r) => [...r, ...Array(width - r.length).fill("")];
    const lines = [`| ${pad(rows[0]).join(" | ")} |`, `| ${Array(width).fill("---").join(" | ")} |`];
    for (const r of rows.slice(1)) lines.push(`| ${pad(r).join(" | ")} |`);
    return lines.join("\n");
  }

  function absolute(href) {
    try {
      return new URL(href, root.location ? root.location.href : undefined).href;
    } catch {
      return href;
    }
  }

  root.ChatdownHtml2Md = { htmlToMarkdown };
  if (typeof module !== "undefined" && module.exports) module.exports = root.ChatdownHtml2Md;
})(typeof globalThis !== "undefined" ? globalThis : this);
