# Chatdown

Chrome extension that exports ChatGPT, Codex, Claude and Claude Code conversations to Markdown, with per-turn selection of which requests and responses to include.

## Install (unpacked)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder
3. Open a conversation and click the Chatdown toolbar icon. The export panel opens in Chrome's side panel.

## Use

- Every request and response is listed as a card. Click to include or exclude it, and Shift-click to toggle a range.
- Quick selects: **All**, **None**, **Requests**, **Responses**, **Invert**.
- **Show** previews a single turn as Markdown.
- **Options**: thinking, tool calls and results (optionally collapsed in `<details>`), timestamps and model, YAML front matter, speaker style and labels. Options persist.
- **Preview**, **Copy** or **Download .md**.

## How it reads conversations

| Site | URL | Method |
| --- | --- | --- |
| ChatGPT | `chatgpt.com/c/<id>` | Same-origin API (`/backend-api/conversation/<id>`), falls back to the DOM |
| Claude | `claude.ai/chat/<id>` | Same-origin API (`/api/organizations/<org>/chat_conversations/<id>`), falls back to the DOM |
| Codex | `chatgpt.com/codex/...` | DOM only (best-effort selectors) |
| Claude Code | `claude.ai/code/...` | DOM only (best-effort selectors) |

The API path exports only the active branch (edited or regenerated alternatives are skipped) and includes thinking, tool calls and tool results, artifacts, and attachments. The DOM path captures what is rendered: text, code, lists, tables, links and math. The panel shows which method was used.

All requests go to the site you are on, using your existing session. Nothing is sent anywhere else.

## Layout

```
manifest.json
src/background.js         opens the side panel on toolbar click
src/content/parsers.js    provider API JSON → normalized conversation (pure)
src/content/html2md.js    rendered DOM → Markdown (fallback)
src/content/extractors.js site detection, API fetch, DOM strategies
src/content/content.js    message handler for the panel
src/shared/markdown.js    turn grouping + Markdown rendering (pure)
src/panel/                side panel UI
dev/harness.html          panel in a normal tab with stubbed chrome.* and sample data
```

## Develop

```bash
npm test                          # parser + renderer unit tests (node:test, no deps)
python3 -m http.server 8765       # then open http://localhost:8765/dev/harness.html[?mode=dom]
python3 scripts/make-icons.py     # regenerate icons/
npm run zip                       # chatdown.zip for the Chrome Web Store
```

After code changes, press reload on the extension card in `chrome://extensions`.
