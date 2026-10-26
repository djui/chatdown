const test = require("node:test");
const assert = require("node:assert/strict");
const { matchTurns } = require("../src/content/onpage.js");

const turns = [
  { id: "u1", role: "user", messageIds: ["u1"] },
  { id: "a1", role: "assistant", messageIds: ["a1", "t1", "a2"] },
  { id: "u2", role: "user", messageIds: ["u2"] },
  { id: "a3", role: "assistant", messageIds: ["a3"] },
];

test("matches by message id when the page carries ids (ChatGPT)", () => {
  const groups = [
    { role: "user", ids: ["u1"], els: ["U1"] },
    { role: "assistant", ids: ["a2"], els: ["A2"] }, // only the visible answer part is rendered
    { role: "user", ids: ["u2"], els: ["U2"] },
    { role: "assistant", ids: ["a3"], els: ["A3"] },
  ];
  assert.deepEqual(matchTurns(turns, groups), [
    { id: "u1", els: ["U1"] },
    { id: "a1", els: ["A2"] },
    { id: "u2", els: ["U2"] },
    { id: "a3", els: ["A3"] },
  ]);
});

test("falls back to position per role when the page has no ids (Claude)", () => {
  const groups = [
    { role: "user", ids: [], els: ["U1"] },
    { role: "assistant", ids: [], els: ["A1"] },
    { role: "user", ids: [], els: ["U2"] },
    { role: "assistant", ids: [], els: ["A3"] },
  ];
  assert.deepEqual(
    matchTurns(turns, groups).map((m) => [m.id, m.els[0]]),
    [["u1", "U1"], ["a1", "A1"], ["u2", "U2"], ["a3", "A3"]]
  );
});

test("places nothing when the page shows a different number of messages", () => {
  const groups = [
    { role: "user", ids: [], els: ["U2"] },
    { role: "assistant", ids: [], els: ["A3"] },
  ];
  assert.deepEqual(matchTurns(turns, groups), []);
});
