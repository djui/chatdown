// Shows the export page the panel left in session storage and opens the
// print dialog, where "Save as PDF" produces the file.
(async function () {
  "use strict";
  const { printHtml } = await chrome.storage.session.get("printHtml");
  if (!printHtml) {
    document.querySelector("p").textContent = "Nothing to print. Choose PDF in the Chatdown panel and export again.";
    return;
  }
  await chrome.storage.session.remove("printHtml");

  // The export is static HTML with an inline stylesheet and no scripts.
  const doc = new DOMParser().parseFromString(printHtml, "text/html");
  document.replaceChild(document.adoptNode(doc.documentElement), document.documentElement);
  // Give layout and images a moment before the dialog snapshots the page.
  setTimeout(() => window.print(), 300);
})();
