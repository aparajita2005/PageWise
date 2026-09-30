// background.js — MV3 service worker (ES module).
import { buildIndex, chunkText, retrieveTopChunks, sampleForSummary } from "./rag.js";

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const GEMINI_ENDPOINT = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

function isTransientGeminiStatus(status) {
  return status === 429 || status === 500 || status === 503;
}

const tabIndex = new Map(); // tabId -> { title, url, text, pdfCount, warnings, extractedAt }
const searchIndexCache = new Map();

async function persistTabData(tabId, data) {
  tabIndex.set(tabId, data);
  searchIndexCache.delete(tabId);
  try {
    await chrome.storage.session.set({ [`tab_${tabId}`]: data });
  } catch (err) {
    console.warn("Session persist failed (page may be very large):", err);
  }
}

async function getTabData(tabId) {
  if (tabIndex.has(tabId)) return tabIndex.get(tabId);
  const stored = await chrome.storage.session.get(`tab_${tabId}`);
  const data = stored[`tab_${tabId}`] || null;
  if (data) tabIndex.set(tabId, data);
  return data;
}

async function hasOffscreenDocument() {
  if (chrome.offscreen.hasDocument) return chrome.offscreen.hasDocument();
  const contexts = await chrome.runtime.getContexts?.({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
  });
  return Boolean(contexts && contexts.length);
}

async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["WORKERS", "BLOBS", "DOM_PARSER"],
    justification: "Run pdf.js (needs DOM + Worker) to extract text from PDFs.",
  });
}

function sendToOffscreen(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function extractPdf({ url, base64, label }) {
  await ensureOffscreenDocument();
  const payload = base64
    ? { type: "EXTRACT_PDF_TEXT", base64, url: label || url }
    : { type: "EXTRACT_PDF_TEXT", url };
  let response;
  try {
    response = await sendToOffscreen(payload);
  } catch (err) {
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      /* none open */
    }
    await ensureOffscreenDocument();
    response = await sendToOffscreen(payload);
  }
  if (!response?.ok) throw new Error(response?.error || "PDF extraction failed");
  return response.text;
}

function looksLikePdfUrl(url) {
  if (!url) return false;
  return /\.pdf(\?|#|$)/i.test(url);
}

async function urlHasPdfContentType(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/pdf")) return true;
  } catch {
    /* HEAD not supported */
  }
  return false;
}

function tabLooksLikePdf(tab) {
  const url = tab.url || "";
  if (looksLikePdfUrl(url)) return true;
  if (tab.title && /\.pdf(\s|$)/i.test(tab.title)) return true;
  return false;
}

function frameResults(injectionResults) {
  return (injectionResults || [])
    .map((r) => r.result)
    .filter(
      (payload) =>
        payload &&
        (payload.text ||
          (payload.pdfUrls && payload.pdfUrls.length) ||
          (payload.blobPdfs && payload.blobPdfs.length))
    );
}

async function collectFromFrames(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content.js"],
  });
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: async () => {
      if (typeof self.__pageragExtract !== "function") return null;
      return self.__pageragExtract();
    },
  });
  return frameResults(results);
}

async function indexTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const warnings = [];
  const textParts = [];
  const seenPdfs = new Set();
  let pdfCount = 0;
  let title = tab.title || "Untitled";
  const pageUrl = tab.url || "";

  const appendPdf = async (source) => {
    const key = source.url || source.label || `blob-${pdfCount}`;
    if (seenPdfs.has(key)) return;
    seenPdfs.add(key);
    try {
      const pdfText = await extractPdf(source);
      if (!pdfText) {
        warnings.push(`PDF had no extractable text: ${key}`);
        return;
      }
      pdfCount += 1;
      textParts.push(`[PDF: ${key}]\n${pdfText}`);
    } catch (err) {
      warnings.push(`Could not read PDF (${key}): ${err.message || err}`);
    }
  };

  if (tabLooksLikePdf(tab)) {
    await appendPdf({ url: pageUrl });
  } else {
    let frames = [];
    try {
      frames = await collectFromFrames(tabId);
    } catch (err) {
      // Typical for Chrome's built-in PDF viewer, chrome:// pages, Web Store.
      if (looksLikePdfUrl(pageUrl) || (await urlHasPdfContentType(pageUrl))) {
        await appendPdf({ url: pageUrl });
      } else {
        throw new Error(
          `Can't read this page (${err.message || err}). Try a normal http(s) page, or enable "Allow access to file URLs" for local files.`
        );
      }
    }

    const top = frames.find((f) => f.isTopFrame) || frames[0];
    if (top?.title) title = top.title;

    for (const frame of frames) {
      if (frame.text) {
        textParts.push(frame.isTopFrame ? frame.text : `[Embedded frame: ${frame.title || frame.url}]\n${frame.text}`);
      }
      for (const pdfUrl of frame.pdfUrls || []) {
        await appendPdf({ url: pdfUrl });
      }
      for (const blob of frame.blobPdfs || []) {
        await appendPdf({ base64: blob.base64, label: blob.name || "embedded.pdf" });
      }
    }

    // Last resort: page injected nothing usable, but the tab URL is still a PDF.
    if (textParts.length === 0 && (looksLikePdfUrl(pageUrl) || (await urlHasPdfContentType(pageUrl)))) {
      await appendPdf({ url: pageUrl });
    }
  }

  const text = textParts.join("\n\n").trim();
  if (!text) {
    throw new Error("No readable text found on this page (empty page, image-only PDF, or blocked frame).");
  }

  const data = {
    title,
    url: pageUrl,
    text,
    pdfCount,
    warnings,
    extractedAt: Date.now(),
  };
  await persistTabData(tabId, data);
  return data;
}

async function callGeminiOnce(apiKey, model, prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${GEMINI_ENDPOINT(model)}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: controller.signal,
    });
    const body = await res.text();
    if (!res.ok) {
      const err = new Error(body);
      err.status = res.status;
      throw err;
    }
    const data = JSON.parse(body);
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || "(empty response)";
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutError = new Error(`Gemini did not respond within 15 seconds using ${model}.`);
      timeoutError.retryable = true;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini(prompt) {
  const { geminiApiKey, geminiModel } = await chrome.storage.local.get([
    "geminiApiKey",
    "geminiModel",
  ]);
  if (!geminiApiKey) {
    throw new Error("No Gemini API key set. Add one in the extension's options page.");
  }

  // Migrate the extension's previous default to the newer low-latency default.
  const preferred = !geminiModel || geminiModel === "gemini-2.5-flash"
    ? DEFAULT_MODEL
    : geminiModel;
  if (geminiModel === "gemini-2.5-flash") {
    await chrome.storage.local.set({ geminiModel: DEFAULT_MODEL });
  }
  const fallback = preferred === DEFAULT_MODEL ? "gemini-2.5-flash" : DEFAULT_MODEL;
  const models = [preferred, fallback];
  let lastError = null;

  for (const model of models) {
    try {
      return await callGeminiOnce(geminiApiKey, model, prompt);
    } catch (err) {
      lastError = err;
      // Try one current fallback after overload or a model that is unavailable.
      if (model === models[models.length - 1] || !(err.retryable || isTransientGeminiStatus(err.status) || err.status === 404)) break;
    }
  }

  const status = lastError?.status;
  if (status === 503 || status === 429) {
    throw new Error(
      "Gemini is busy right now. The extension tried the selected model and one fast fallback. Wait a moment and try again, or choose gemini-3.5-flash-lite in Options."
    );
  }
  throw new Error(`Gemini API error (${status || "unknown"}): ${lastError?.message || lastError}`);
}

function buildPrompt(question, topChunks, pageTitle, history = []) {
  const context = topChunks.map((c, i) => `[Excerpt ${i + 1}]\n${c.text}`).join("\n\n");
  const prior = history.map((turn, i) => `Earlier question ${i + 1}: ${turn.question}\nEarlier answer ${i + 1}: ${turn.answer}`).join("\n\n");
  return `Answer using the page excerpts below. Use prior conversation only to resolve follow-up references; factual claims must be supported by the excerpts. If the excerpts don't contain the answer, say so plainly instead of guessing.\nPage: "${pageTitle}"\n\n${prior ? `Prior conversation:\n${prior}\n\n` : ""}Page excerpts:\n${context}\n\nCurrent question: ${question}\n\nAnswer:`;
}

async function answerQuestion(tabId, question, history = []) {
  const data = await getTabData(tabId);
  if (!data || !data.text) {
    throw new Error("No page content indexed yet. Open the popup on the page first.");
  }

  let indexed = searchIndexCache.get(tabId);
  if (!indexed || indexed.extractedAt !== data.extractedAt) {
    const chunks = chunkText(data.text);
    indexed = { extractedAt: data.extractedAt, index: buildIndex(chunks) };
    searchIndexCache.set(tabId, indexed);
  }
  const retrievalContext = history.slice(-4)
    .map((turn) => `${turn.question} ${String(turn.answer || "").slice(0, 500)}`)
    .join(" ");
  let topChunks = retrieveTopChunks(indexed.index, `${retrievalContext} ${question}`, 8);

  if (topChunks.length === 0) {
    topChunks = [{ text: sampleForSummary(data.text, 60000) }];
  }

  const prompt = buildPrompt(question, topChunks, data.title, history);
  const answer = await callGemini(prompt);
  return { answer, sources: topChunks.map((c) => c.text) };
}

async function summarizePage(tabId) {
  const data = await getTabData(tabId);
  if (!data || !data.text) {
    throw new Error("No page content indexed yet. Open the popup on the page first.");
  }

  const excerpt = sampleForSummary(data.text, 100000);
  const prompt = `Summarize the following content from the page "${data.title}" in 4–8 concise bullet points. Cover the main claims, facts, and any important details from later sections, not just the beginning. If the content is a PDF or mixed HTML+PDF, treat it as one document.

${excerpt}`;
  return callGemini(prompt);
}

function statusPayload(data) {
  if (!data?.text) {
    return { ok: true, hasContent: false, title: null, charCount: 0, pdfCount: 0, warnings: [] };
  }
  return {
    ok: true,
    hasContent: true,
    title: data.title,
    charCount: data.text.length,
    pdfCount: data.pdfCount || 0,
    warnings: data.warnings || [],
  };
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabIndex.delete(tabId);
  searchIndexCache.delete(tabId);
  chrome.storage.session.remove(`tab_${tabId}`);
  chrome.storage.session.remove(`pagerag_visit_${tabId}`);
  chrome.storage.session.remove(`pagerag_active_chat_${tabId}`);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    tabIndex.delete(tabId);
    searchIndexCache.delete(tabId);
    chrome.storage.session.remove(`tab_${tabId}`);
    chrome.storage.session.set({
      [`pagerag_visit_${tabId}`]: { url: changeInfo.url, visitId: crypto.randomUUID() },
    });
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "INDEX_TAB") {
    indexTab(msg.tabId)
      .then((data) => sendResponse(statusPayload(data)))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (msg.type === "ASK_QUESTION") {
    answerQuestion(msg.tabId, msg.question, msg.history || [])
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (msg.type === "SUMMARIZE_PAGE") {
    summarizePage(msg.tabId)
      .then((summary) => sendResponse({ ok: true, summary }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (msg.type === "GET_TAB_STATUS") {
    getTabData(msg.tabId)
      .then((data) => sendResponse(statusPayload(data)))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  return false;
});
