const test = require("node:test");
const assert = require("node:assert/strict");
const { groupTurns, turnSnippet, renderMarkdown, filenameFor, fence } = require("../src/shared/markdown.js");

const conversation = {
  source: "chatgpt",
  title: "Sorting: a quick look",
  url: "https://chatgpt.com/c/abc",
  messages: [
    { id: "u1", role: "user", createdAt: "2026-01-01T10:00:00.000Z", blocks: [{ type: "text", text: "Sort [3,1,2]" }] },
    { id: "a1", role: "assistant", model: "m1", blocks: [{ type: "thinking", text: "easy" }, { type: "tool_use", name: "python", input: "sorted([3,1,2])" }] },
    { id: "t1", role: "tool", blocks: [{ type: "tool_result", name: "python", text: "[1, 2, 3]" }] },
    { id: "a2", role: "assistant", blocks: [{ type: "text", text: "Result: `[1, 2, 3]`" }] },
    { id: "u2", role: "user", blocks: [{ type: "text", text: "Thanks" }] },
    { id: "a3", role: "assistant", blocks: [{ type: "text", text: "You're welcome." }] },
  ],
};

test("groupTurns folds consecutive non-user messages into one response", () => {
  const turns = groupTurns(conversation.messages);
  assert.deepEqual(turns.map((t) => [t.id, t.role, t.blocks.length]), [
    ["u1", "user", 1],
    ["a1", "assistant", 4],
    ["u2", "user", 1],
    ["a3", "assistant", 1],
  ]);
  assert.deepEqual(turns[1].messageIds, ["a1", "t1", "a2"]);
});

test("renderMarkdown includes only selected turns and hides tools/thinking by default", () => {
  const turns = groupTurns(conversation.messages);
  const md = renderMarkdown(conversation, turns, ["u1", "a1"], { frontMatter: false });
  assert.equal(md, "# Sorting: a quick look\n\n## You\n\nSort [3,1,2]\n\n## ChatGPT\n\nResult: `[1, 2, 3]`\n");
});

test("assistant name follows the site unless renamed", () => {
  const turns = groupTurns(conversation.messages);
  const claude = renderMarkdown({ ...conversation, source: "claude" }, turns, ["a1"], { frontMatter: false });
  assert.match(claude, /^## Claude$/m);
  const renamed = renderMarkdown(conversation, turns, ["a1"], { frontMatter: false, assistantLabel: "Bot" });
  assert.match(renamed, /^## Bot$/m);
});

test("previews leave out tool names", () => {
  const [, response] = groupTurns(conversation.messages);
  assert.equal(turnSnippet(response), "Result: [1, 2, 3]");
});

test("renderMarkdown renders tools and thinking in details when enabled", () => {
  const turns = groupTurns(conversation.messages);
  const md = renderMarkdown(conversation, turns, ["a1"], { frontMatter: false, includeTools: true, includeThinking: true });
  assert.match(md, /<summary>Thinking<\/summary>\n\n> easy/);
  assert.match(md, /<summary>Tool call: python<\/summary>\n\n```\nsorted\(\[3,1,2\]\)\n```/);
  assert.match(md, /<summary>Tool result: python<\/summary>/);
});

test("renderMarkdown front matter and bold style", () => {
  const turns = groupTurns(conversation.messages);
  const md = renderMarkdown(conversation, turns, ["u2", "a3"], { headingStyle: "bold", userLabel: "Me", assistantLabel: "Bot" });
  assert.match(md, /^---\ntitle: "Sorting: a quick look"\nsource: ChatGPT\nurl: https:\/\/chatgpt.com\/c\/abc\n/);
  assert.match(md, /turns: 2\/4\n---\n\n# Sorting/);
  assert.match(md, /\*\*Me\*\*\n\nThanks\n\n---\n\n\*\*Bot\*\*\n\nYou're welcome.\n$/);
});

test("fence grows past backtick runs in content", () => {
  assert.equal(fence("a\n```\nb", "md"), "````md\na\n```\nb\n````");
});

test("filenameFor slugifies titles", () => {
  assert.equal(filenameFor({ title: "Café: Résumé tips!" }), "cafe-resume-tips.md");
  assert.equal(filenameFor({ title: "" }), "chat.md");
});
