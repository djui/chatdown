const test = require("node:test");
const assert = require("node:assert/strict");
const { markdownToHtml } = require("../src/shared/md2html.js");
const { groupTurns } = require("../src/shared/markdown.js");
const { render, renderHtml, renderText, renderJson, filenameForFormat } = require("../src/shared/formats.js");

const conversation = {
  source: "claude",
  title: "Lists & <tags>",
  url: "https://claude.ai/chat/abc",
  createdAt: "2026-01-01T10:00:00.000Z",
  messages: [
    { id: "u1", role: "user", createdAt: "2026-01-01T10:00:00.000Z", blocks: [{ type: "text", text: "Make a list <script>alert(1)</script>" }] },
    {
      id: "a1",
      role: "assistant",
      blocks: [
        { type: "thinking", text: "short list" },
        { type: "tool_use", name: "web_search", input: { query: "lists" } },
        { type: "tool_result", name: "web_search", text: "3 results" },
        { type: "text", text: "Here:\n\n- one\n- two\n\n```js\nconst a = 1 < 2;\n```" },
      ],
    },
  ],
};
const turns = groupTurns(conversation.messages);

test("markdownToHtml: blocks, inline and nesting", () => {
  const html = markdownToHtml("# T\n\n**b** *i* `c`\n\n- a\n  - b\n- [x] done\n\n1. x\n\n| A | B |\n|---|--:|\n| 1 | 2 |\n\n> q");
  assert.match(html, /<h1>T<\/h1>/);
  assert.match(html, /<p><strong>b<\/strong> <em>i<\/em> <code>c<\/code><\/p>/);
  assert.match(html, /<ul>\n<li>a\n<ul>\n<li>b<\/li>\n<\/ul><\/li>/);
  assert.match(html, /<li class="task"><input type="checkbox" disabled checked> done<\/li>/);
  assert.match(html, /<ol>\n<li>x<\/li>\n<\/ol>/);
  assert.match(html, /<th style="text-align:right">B<\/th>/);
  assert.match(html, /<blockquote>\n<p>q<\/p>\n<\/blockquote>/);
});

test("markdownToHtml: escapes markup and drops unsafe links", () => {
  const html = markdownToHtml("<img src=x onerror=alert(1)> [x](javascript:alert(1)) [ok](https://e.com/a_(b)) ![i](data:x)");
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("javascript:"));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /<a href="https:\/\/e.com\/a_\(b\)">ok<\/a>/);
  assert.ok(!html.includes("data:x"));
});

test("markdownToHtml: snake_case and arithmetic stay plain", () => {
  assert.equal(markdownToHtml("snake_case_name and 2*3*4"), "<p>snake_case_name and 2*3*4</p>");
});

test("renderHtml: standalone page with escaped title, speakers and optional extras", () => {
  const html = renderHtml(conversation, turns, null, {});
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<title>Lists &amp; &lt;tags&gt;<\/title>/);
  assert.match(html, /<h2 class="speaker">You<\/h2>/);
  assert.match(html, /<h2 class="speaker">Claude<\/h2>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /<code class="language-js">const a = 1 &lt; 2;<\/code>/);
  assert.ok(!html.includes("Thinking"));
  assert.ok(!html.includes("<script"));

  const full = renderHtml(conversation, turns, null, { includeThinking: true, includeTools: true });
  assert.match(full, /<details class="thinking"><summary>Thinking<\/summary>/);
  assert.match(full, /<summary>Used web_search<\/summary><pre>lists<\/pre>/);
});

test("pdf renders the HTML page with extras expanded", () => {
  const pdf = render("pdf", conversation, turns, null, { includeThinking: true });
  assert.match(pdf, /<details class="thinking" open>/);
});

test("renderText: speakers, indented code, no markup", () => {
  const text = renderText(conversation, turns, ["a1"], { frontMatter: false });
  assert.equal(text.split("\n")[0], "Lists & <tags>");
  assert.match(text, /\n\nClaude:\nHere:/);
  assert.ok(!text.includes("You:"));
});

test("renderJson: selected messages with filtered blocks", () => {
  const data = JSON.parse(renderJson(conversation, turns, null, { includeTools: true }));
  assert.equal(data.source, "Claude");
  assert.deepEqual(data.messages.map((m) => [m.role, m.speaker]), [["user", "You"], ["assistant", "Claude"]]);
  assert.deepEqual(data.messages[1].content.map((b) => b.type), ["tool_use", "tool_result", "text"]);
});

test("filenameForFormat uses the format's extension", () => {
  assert.equal(filenameForFormat(conversation, "html"), "lists-tags.html");
  assert.equal(filenameForFormat(conversation, "json"), "lists-tags.json");
  assert.equal(filenameForFormat(conversation, "nope"), "lists-tags.md");
});
