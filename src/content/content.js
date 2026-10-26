// Answers extraction requests from the side panel. Guarded because the panel
// re-injects the scripts into tabs that were open before the extension loaded.
(function () {
  "use strict";
  if (globalThis.__chatdownListening) return;
  globalThis.__chatdownListening = true;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "chatdown:extract") return false;
    globalThis.ChatdownExtractors.extract()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true; // async response
  });
})();
