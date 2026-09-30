// rag.js — chunking + TF-IDF retrieval. ES module imported by background.js.

export function chunkText(text, chunkSize = 180, overlap = 30) {
  const words = String(text || "")
    .split(/\s+/)
    .filter(Boolean);
  const chunks = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    chunks.push(words.slice(start, end).join(" "));
    if (end === words.length) break;
    start = end - overlap;
  }
  return chunks;
}

export function sampleForSummary(text, maxChars = 100000) {
  const t = String(text || "");
  if (t.length <= maxChars) return t;
  const headLen = Math.floor(maxChars * 0.45);
  const midLen = Math.floor(maxChars * 0.3);
  const tailLen = maxChars - headLen - midLen;
  const midStart = Math.floor((t.length - midLen) / 2);
  return [
    t.slice(0, headLen),
    "\n\n[... middle of page omitted ...]\n\n",
    t.slice(midStart, midStart + midLen),
    "\n\n[... later content omitted ...]\n\n",
    t.slice(-tailLen),
  ].join("");
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s.-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

export function buildIndex(chunks) {
  const docTermFreqs = chunks.map((chunk) => {
    const terms = tokenize(chunk);
    const freq = {};
    for (const t of terms) freq[t] = (freq[t] || 0) + 1;
    return freq;
  });

  const docFreq = {};
  for (const freq of docTermFreqs) {
    for (const term of Object.keys(freq)) {
      docFreq[term] = (docFreq[term] || 0) + 1;
    }
  }

  const N = chunks.length;
  const idf = {};
  for (const term of Object.keys(docFreq)) {
    idf[term] = Math.log((N + 1) / (docFreq[term] + 1)) + 1;
  }

  const vectors = docTermFreqs.map((freq) => {
    const vec = {};
    for (const [term, count] of Object.entries(freq)) {
      vec[term] = count * idf[term];
    }
    return vec;
  });

  return { chunks, vectors, idf };
}

function cosineSim(vecA, vecB) {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const val of Object.values(vecA)) magA += val * val;
  for (const val of Object.values(vecB)) magB += val * val;
  for (const term of Object.keys(vecA)) {
    if (vecB[term]) dot += vecA[term] * vecB[term];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function retrieveTopChunks(index, query, k = 5) {
  const queryTerms = tokenize(query);
  const queryFreq = {};
  for (const t of queryTerms) queryFreq[t] = (queryFreq[t] || 0) + 1;

  const queryVec = {};
  for (const [term, count] of Object.entries(queryFreq)) {
    if (index.idf[term]) queryVec[term] = count * index.idf[term];
  }

  const scored = index.vectors.map((vec, i) => ({
    text: index.chunks[i],
    score: cosineSim(queryVec, vec),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).slice(0, k);
}
