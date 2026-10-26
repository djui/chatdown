// Clicking the toolbar icon opens the export side panel.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error("Chatdown: setPanelBehavior failed", err));
