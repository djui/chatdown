const test = require("node:test");
const assert = require("node:assert/strict");
const { parseChatGPT, parseClaude, cleanChatgptText } = require("../src/content/parsers.js");

function chatgptFixture() {
  const msg = (id, role, content, extra = {}) => ({
    id,
    author: { role, name: extra.name },
    content,
    recipient: extra.recipient || "all",
    create_time: 1700000000 + Number(id.replace(/\D/g, "") || 0),
    metadata: extra.metadata || {},
  });
  const nodes = [
    ["root", null, null],
    ["sys", "root", msg("sys", "system", { content_type: "text", parts: [""] })],
    ["u1", "sys", msg("u1", "user", { content_type: "text", parts: ["What is 2+2?"] })],
    ["a1", "u1", msg("a1", "assistant", { content_type: "code", language: "unknown", text: "print(2+2)" }, { recipient: "python" })],
    ["t1", "a1", msg("t1", "tool", { content_type: "execution_output", text: "4" }, { name: "python" })],
    ["a2", "t1", msg("a2", "assistant", { content_type: "text", parts: ["It is 4."] }, { metadata: { model_slug: "gpt-x" } })],
    // Abandoned branch: must not appear.
    ["a2b", "t1", msg("a2b", "assistant", { content_type: "text", parts: ["Old answer"] })],
    ["u2", "a2", msg("u2", "user", { content_type: "multimodal_text", parts: [{ content_type: "image_asset_pointer" }, "And this?"] })],
    ["a3", "u2", msg("a3", "assistant", { content_type: "thoughts", thoughts: [{ summary: "Looking", content: "An image." }] })],
    [
      "a4",
      "a3",
      msg(
        "a4",
        "assistant",
        { content_type: "text", parts: ["A cat citeturn0search0."] },
        { metadata: { content_references: [{ matched_text: "citeturn0search0", alt: "([Wiki](https://w.org))" }] } }
      ),
    ],
  ];
  const mapping = {};
  for (const [id, parent, message] of nodes) mapping[id] = { id, parent, message };
  return { title: "Math", create_time: 1700000000, current_node: "a4", mapping };
}

test("ChatGPT: follows active branch and maps content types", () => {
  const conv = parseChatGPT(chatgptFixture(), "https://chatgpt.com/c/x");
  assert.equal(conv.source, "chatgpt");
  assert.equal(conv.title, "Math");
  assert.deepEqual(
    conv.messages.map((m) => [m.id, m.role, m.blocks.map((b) => b.type).join(",")]),
    [
      ["u1", "user", "text"],
      ["a1", "assistant", "tool_use"],
      ["t1", "tool", "tool_result"],
      ["a2", "assistant", "text"],
      ["u2", "user", "attachment,text"],
      ["a3", "assistant", "thinking"],
      ["a4", "assistant", "text"],
    ]
  );
  assert.equal(conv.messages[1].blocks[0].name, "python");
  assert.equal(conv.messages[3].model, "gpt-x");
  assert.equal(conv.messages[6].blocks[0].text, "A cat ([Wiki](https://w.org)).");
});

test("ChatGPT: strips unreferenced citation markers", () => {
  assert.equal(cleanChatgptText("xciteturn1y", {}), "xy");
});

test("Claude: follows leaf branch, maps blocks, artifacts and attachments", () => {
  const ROOT = "00000000-0000-4000-8000-000000000000";
  const data = {
    name: "Plan",
    model: "claude-x",
    current_leaf_message_uuid: "m4",
    chat_messages: [
      { uuid: "m1", parent_message_uuid: ROOT, sender: "human", content: [{ type: "text", text: "Hi" }], attachments: [{ file_name: "a.txt", extracted_content: "data" }] },
      {
        uuid: "m2",
        parent_message_uuid: "m1",
        sender: "assistant",
        content: [
          { type: "thinking", thinking: "Hmm" },
          { type: "tool_use", name: "web_search", input: { query: "x" } },
          { type: "tool_result", name: "web_search", content: [{ type: "text", text: "result" }] },
          { type: "tool_use", name: "artifacts", input: { title: "Doc", type: "text/markdown", content: "# Doc" } },
          { type: "text", text: "Done" },
        ],
      },
      { uuid: "m3", parent_message_uuid: "m2", sender: "human", content: [{ type: "text", text: "Edited away" }] },
      { uuid: "m3b", parent_message_uuid: "m2", sender: "human", content: [{ type: "text", text: "Thanks" }] },
      { uuid: "m4", parent_message_uuid: "m3b", sender: "assistant", content: [], text: "Welcome" },
    ],
  };
  const conv = parseClaude(data, "https://claude.ai/chat/x");
  assert.equal(conv.title, "Plan");
  assert.deepEqual(conv.messages.map((m) => m.id), ["m1", "m2", "m3b", "m4"]);
  assert.deepEqual(conv.messages[0].blocks.map((b) => b.type), ["text", "attachment"]);
  assert.deepEqual(conv.messages[1].blocks.map((b) => b.type), ["thinking", "tool_use", "tool_result", "artifact", "text"]);
  assert.equal(conv.messages[1].blocks[3].language, "markdown");
  assert.equal(conv.messages[3].blocks[0].text, "Welcome");
});
