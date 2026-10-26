// Small Markdown → HTML converter for chat text (GitHub-flavoured subset:
// headings, paragraphs with line breaks, lists incl. nesting and tasks,
// fenced code, block math, quotes, tables, rules, inline code/emphasis/links).
// All source text is escaped; only http(s) and mailto links survive, so chat
// content can never inject markup or script into an export.
// Loaded by the panel, the print page and the website, and via require() in tests.
(function (root) {
  "use strict";

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function safeUrl(u) {
    const v = String(u).trim();
    return /^(https?:|mailto:)/i.test(v) ? v : null;
  }

  // ---------- inline ----------

  function inline(text) {
    const stash = [];
    const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;
    let s = String(text);

    s = s.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_, _t, code) => keep(`<code>${esc(code.replace(/^ ([\s\S]*) $/, "$1"))}</code>`));
    s = s.replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/g, (m, alt, url) => {
      const v = safeUrl(url);
      return v ? keep(`<img src="${esc(v)}" alt="${esc(alt)}">`) : alt;
    });
    s = s.replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/g, (m, label, url) => {
      const v = safeUrl(url);
      return v ? keep(`<a href="${esc(v)}">`) + label + keep("</a>") : label;
    });
    s = s.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, (_, url) => keep(`<a href="${esc(url)}">${esc(url)}</a>`));

    s = esc(s);
    s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>").replace(/__(?=\S)([\s\S]*?\S)__/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g, "$1<em>$2</em>");
    s = s.replace(/(^|[^_\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?![_\w])/g, "$1<em>$2</em>");
    s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>");
    s = s.replace(/\n/g, "<br>\n");
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => stash[+i]);
  }

  // ---------- blocks ----------

  const LIST = /^( {0,3})([-*+]|\d{1,9}[.)])( +|$)/;
  const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
  const TABLE_SEP = /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/;

  const blank = (l) => !l || !l.trim();
  const indentOf = (l) => l.match(/^ */)[0].length;

  function startsBlock(line, next) {
    return (
      FENCE.test(line) ||
      /^ {0,3}\$\$\s*$/.test(line) ||
      /^ {0,3}#{1,6}\s/.test(line) ||
      /^ {0,3}([-*_])( *\1){2,}\s*$/.test(line) ||
      /^ {0,3}>/.test(line) ||
      LIST.test(line) ||
      (line.includes("|") && next !== undefined && TABLE_SEP.test(next))
    );
  }

  function splitRow(line) {
    return line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, "|"));
  }

  function blocks(src) {
    const lines = String(src).replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      let m;
      if (blank(line)) {
        i++;
        continue;
      }

      if ((m = line.match(FENCE))) {
        const mark = m[1];
        const close = new RegExp(`^ {0,3}${mark[0] === "`" ? "`" : "~"}{${mark.length},}\\s*$`);
        const body = [];
        i++;
        while (i < lines.length && !close.test(lines[i])) body.push(lines[i++]);
        i++;
        out.push(`<pre><code${m[2] ? ` class="language-${esc(m[2])}"` : ""}>${esc(body.join("\n"))}</code></pre>`);
        continue;
      }

      if (/^ {0,3}\$\$\s*$/.test(line)) {
        const body = [];
        i++;
        while (i < lines.length && !/^ {0,3}\$\$\s*$/.test(lines[i])) body.push(lines[i++]);
        i++;
        out.push(`<pre class="math">${esc(body.join("\n"))}</pre>`);
        continue;
      }

      if ((m = line.match(/^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/))) {
        const n = m[1].length;
        out.push(`<h${n}>${inline(m[2])}</h${n}>`);
        i++;
        continue;
      }

      if (/^ {0,3}([-*_])( *\1){2,}\s*$/.test(line)) {
        out.push("<hr>");
        i++;
        continue;
      }

      if (/^ {0,3}>/.test(line)) {
        const body = [];
        while (i < lines.length && /^ {0,3}>/.test(lines[i])) body.push(lines[i++].replace(/^ {0,3}> ?/, ""));
        out.push(`<blockquote>\n${blocks(body.join("\n"))}\n</blockquote>`);
        continue;
      }

      if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
        const head = splitRow(line);
        const aligns = splitRow(lines[i + 1]).map((c) =>
          c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""
        );
        i += 2;
        const rows = [];
        while (i < lines.length && !blank(lines[i]) && lines[i].includes("|")) rows.push(splitRow(lines[i++]));
        const cell = (tag, c, j) => `<${tag}${aligns[j] ? ` style="text-align:${aligns[j]}"` : ""}>${inline(c || "")}</${tag}>`;
        out.push(
          `<table>\n<thead><tr>${head.map((c, j) => cell("th", c, j)).join("")}</tr></thead>\n<tbody>\n` +
            rows.map((r) => `<tr>${head.map((_, j) => cell("td", r[j], j)).join("")}</tr>`).join("\n") +
            "\n</tbody>\n</table>"
        );
        continue;
      }

      if ((m = line.match(LIST))) {
        const r = list(lines, i, m);
        out.push(r.html);
        i = r.next;
        continue;
      }

      const para = [];
      while (i < lines.length && !blank(lines[i]) && (para.length === 0 || !startsBlock(lines[i], lines[i + 1]))) {
        para.push(lines[i++].replace(/^ +/, ""));
      }
      out.push(`<p>${inline(para.join("\n"))}</p>`);
    }
    return out.join("\n");
  }

  function list(lines, i, first) {
    const base = first[1].length;
    const ordered = /\d/.test(first[2]);
    const start = ordered ? parseInt(first[2], 10) : 1;
    const sibling = (mm) => mm && mm[1].length <= base + 1 && /\d/.test(mm[2]) === ordered;
    const items = [];
    let cur = null;
    let loose = false;
    let sawBlank = false;

    while (i < lines.length) {
      const l = lines[i];
      const mm = l.match(LIST);
      if (sibling(mm)) {
        if (cur && sawBlank) loose = true;
        cur = { lines: [l.slice(mm[0].length)], indent: mm[0].length || mm[1].length + mm[2].length + 1 };
        items.push(cur);
        sawBlank = false;
        i++;
        continue;
      }
      if (blank(l)) {
        let j = i + 1;
        while (j < lines.length && blank(lines[j])) j++;
        if (j < lines.length && (sibling(lines[j].match(LIST)) || indentOf(lines[j]) >= cur.indent)) {
          cur.lines.push("");
          sawBlank = true;
          i++;
          continue;
        }
        break;
      }
      const ind = indentOf(l);
      if (ind >= Math.min(cur.indent, base + 2)) {
        cur.lines.push(l.slice(Math.min(ind, cur.indent)));
        i++;
        continue;
      }
      if (!sawBlank && !startsBlock(l, lines[i + 1])) {
        cur.lines.push(l.trim()); // lazy continuation of the item's paragraph
        i++;
        continue;
      }
      break;
    }

    const tag = ordered ? "ol" : "ul";
    const lis = items.map((it) => {
      let text = it.lines.join("\n");
      let box = "";
      const task = text.match(/^\[( |x|X)\]\s+/);
      if (task) {
        box = `<input type="checkbox" disabled${task[1] === " " ? "" : " checked"}> `;
        text = text.slice(task[0].length);
      }
      let inner = blocks(text);
      if (!loose) inner = inner.replace(/<p>([\s\S]*?)<\/p>/g, "$1");
      return `<li${task ? ' class="task"' : ""}>${box}${inner}</li>`;
    });
    return {
      html: `<${tag}${ordered && start !== 1 ? ` start="${start}"` : ""}>\n${lis.join("\n")}\n</${tag}>`,
      next: i,
    };
  }

  const api = { markdownToHtml: blocks, inlineToHtml: inline, escapeHtml: esc };
  root.ChatdownMd2Html = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
