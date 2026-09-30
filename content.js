// content.js — isolated world, every frame. Extraction is pull-based:
// background.js injects this file and then calls self.__pageragExtract().
(function pageragContentScript() {

const CHROME_PDF_VIEWER_ID = "mhjfbmdgcfjbbpaeojofohoefgiehjai";

function isVisible(el) {
  if (!(el instanceof Element)) return true;
  if (el.hidden) return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

function shouldSkipElement(el) {
  if (!(el instanceof Element)) return false;
  const tag = el.tagName;
  return tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "SVG";
}

function extractVisibleTextFrom(root) {
  const parts = [];

  function walk(node) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (parent && !shouldSkipElement(parent) && isVisible(parent)) {
        const t = node.textContent && node.textContent.trim();
        if (t) parts.push(t);
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      if (shouldSkipElement(node) || !isVisible(node)) return;
      if (node.shadowRoot) walk(node.shadowRoot);
    }
    for (const child of node.childNodes) walk(child);
  }

  walk(root);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function extractText() {
  const candidates = document.querySelectorAll(
    'article, [itemprop="articleBody"], [role="main"], main'
  );
  let best = "";
  for (const el of candidates) {
    const text = extractVisibleTextFrom(el);
    if (text.length > best.length) best = text;
  }
  if (best.length > 400) return best;
  return extractVisibleTextFrom(document.body || document.documentElement);
}

function maybePdfUrl(raw) {
  if (!raw) return null;
  try {
    return new URL(raw, location.href).href;
  } catch {
    return null;
  }
}

function isPdfHref(href) {
  return /\.pdf(\?|#|$)/i.test(href);
}

function findEmbeddedPdfUrls() {
  const urls = new Set();

  document.querySelectorAll("embed, object, iframe").forEach((el) => {
    const src = el.getAttribute("src") || el.getAttribute("data") || "";
    const type = (el.getAttribute("type") || el.type || "").toLowerCase();
    const abs = maybePdfUrl(src);
    if (!abs) return;

    if (type === "application/pdf" || isPdfHref(abs)) {
      urls.add(abs);
      return;
    }
    if (abs.startsWith(`chrome-extension://${CHROME_PDF_VIEWER_ID}`)) {
      try {
        const inner = new URL(abs).searchParams.get("file");
        if (inner) urls.add(decodeURIComponent(inner));
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      const fileParam = new URL(abs, location.href).searchParams.get("file");
      if (fileParam && isPdfHref(fileParam)) urls.add(fileParam);
    } catch {
      /* ignore */
    }
  });

  return Array.from(urls);
}

function findLinkedPdfUrls() {
  const urls = new Set();
  document.querySelectorAll("a[href]").forEach((a) => {
    if (isPdfHref(a.href)) urls.add(a.href);
  });
  return Array.from(urls);
}

function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function readBlobPdfs(pdfUrls) {
  const blobs = [];
  const remote = [];
  for (const url of pdfUrls) {
    if (url.startsWith("blob:")) {
      try {
        const buf = await fetch(url).then((r) => r.arrayBuffer());
        blobs.push({ name: url, base64: bufferToBase64(buf) });
      } catch {
        /* blob already revoked */
      }
    } else {
      remote.push(url);
    }
  }
  return { blobs, remote };
}

function googleDocIdFromUrl(url) {
  const doc = url.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (doc) return { type: "document", id: doc[1] };
  const sheet = url.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (sheet) return { type: "spreadsheets", id: sheet[1] };
  return null;
}

async function tryGoogleWorkspaceExport() {
  const info = googleDocIdFromUrl(location.href);
  if (!info) return "";
  const format = info.type === "spreadsheets" ? "csv" : "txt";
  const exportUrl = `https://docs.google.com/${info.type}/d/${info.id}/export?format=${format}`;
  try {
    const res = await fetch(exportUrl, { credentials: "include" });
    if (!res.ok) return "";
    const text = await res.text();
    if (text && !text.trim().startsWith("<!DOCTYPE") && !text.trim().startsWith("<html")) {
      return text.trim();
    }
  } catch {
    /* not signed in, or export blocked */
  }
  return "";
}

function isThisPageAPdf() {
  return document.contentType === "application/pdf";
}

self.__pageragExtract = async function pageragExtract() {
  const exported = await tryGoogleWorkspaceExport();
  const htmlText = isThisPageAPdf() ? "" : extractText();
  const text = exported || htmlText;
  let pdfUrls = [];
  if (isThisPageAPdf()) {
    pdfUrls = [location.href];
  } else {
    pdfUrls = findEmbeddedPdfUrls();
    // A nearly empty page with a single PDF link is often a wrapper around that file.
    if (pdfUrls.length === 0) {
      const linked = findLinkedPdfUrls();
      if (linked.length === 1 && (exported || htmlText).length < 400) pdfUrls = linked;
    }
  }
  const { blobs, remote } = await readBlobPdfs(pdfUrls);

  return {
    url: location.href,
    title: document.title,
    isTopFrame: window === window.top,
    text,
    pdfUrls: remote,
    blobPdfs: blobs,
    usedGoogleExport: Boolean(exported),
  };
};

if (!self.__pageragListenerAdded) {
  self.__pageragListenerAdded = true;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== "REQUEST_PAGE_CONTENT") return undefined;
    self
      .__pageragExtract()
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  });
}
})();
