// offscreen.js — pdf.js needs DOM + Worker APIs that the service worker lacks.

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdf.worker.min.js");

function base64ToUint8Array(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function loadPdfSource(msg) {
  if (msg.base64) return { data: base64ToUint8Array(msg.base64) };
  if (!msg.url) throw new Error("No PDF url or data provided");
  const res = await fetch(msg.url);
  if (!res.ok) throw new Error(`Failed to fetch PDF (${res.status}) for ${msg.url}`);
  return { data: new Uint8Array(await res.arrayBuffer()) };
}

async function extractPdfText(msg) {
  const pdf = await pdfjsLib.getDocument(await loadPdfSource(msg)).promise;
  const pageTexts = [];
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const pageText = content.items.map((item) => item.str).join(" ");
    pageTexts.push(pageText);
  }
  return pageTexts.join("\n\n").replace(/\s+/g, " ").trim();
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "EXTRACT_PDF_TEXT") return undefined;

  extractPdfText(msg)
    .then((text) => sendResponse({ ok: true, url: msg.url, text }))
    .catch((err) => sendResponse({ ok: false, url: msg.url, error: String(err && err.message ? err.message : err) }));

  return true;
});
