const statusEl = document.getElementById("status");
const unsupportedNoteEl = document.getElementById("unsupportedNote");
const summarizeBtn = document.getElementById("summarizeBtn");
const questionInput = document.getElementById("questionInput");
const askBtn = document.getElementById("askBtn");
const askForm = document.getElementById("askForm");
const conversationEl = document.getElementById("conversation");
const optionsBtn = document.getElementById("optionsBtn");
const refreshPageBtn = document.getElementById("refreshPageBtn");
const openChatBtn = document.getElementById("openChatBtn");
const chatSizeBtn = document.getElementById("chatSizeBtn");
const historyBtn = document.getElementById("historyBtn");
const newChatBtn = document.getElementById("newChatBtn");
const clearChatBtn = document.getElementById("clearChatBtn");
const historyPanel = document.getElementById("historyPanel");
const historyList = document.getElementById("historyList");
const historyHeading = document.getElementById("historyHeading");
const historyScopeBtn = document.getElementById("historyScopeBtn");
const closeHistoryBtn = document.getElementById("closeHistoryBtn");
const requestedTabId = Number(new URLSearchParams(window.location.search).get("tabId"));
const isFullChat = Number.isInteger(requestedTabId) && requestedTabId > 0;
let conversation = [];
const chatDatabaseKey = "pagerag_chat_database";
let chatDatabase = { chats: [], activeByTab: {} };
let currentDoc = { id: "", url: "", title: "This document" };
let currentVisitId = null;
let selectedChatId = null;
let showAllHistory = false;
let viewingOtherDocument = false;
let pendingDocumentTabId = null;
let isBusy = false;

if (isFullChat) {
  document.body.classList.add("full-chat");
  openChatBtn.classList.add("hidden");
  chatSizeBtn.classList.remove("hidden");
}

optionsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

function appendFormattedText(container, value) {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  let paragraphLines = [];
  let list = null;
  let codeLines = null;

  const mathNS = "http://www.w3.org/1998/Math/MathML";
  const mathCommands = {
    times: "×", cdot: "·", div: "÷", pm: "±", le: "≤", leq: "≤", ge: "≥", geq: "≥",
    neq: "≠", approx: "≈", ne: "≠", infty: "∞", to: "→", rightarrow: "→", leftarrow: "←",
    sum: "∑", prod: "∏", int: "∫", partial: "∂", percent: "%", degree: "°",
    alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", theta: "θ", lambda: "λ",
    mu: "μ", sigma: "σ", pi: "π", rho: "ρ", tau: "τ", phi: "φ", omega: "ω",
  };

    const mathNode = (tag, text = "") => {
    const node = document.createElementNS(mathNS, tag);
    if (text) node.textContent = text;
    return node;
  };

  const renderMath = (target, source, display = false) => {
    const math = mathNode("math");
    if (display) math.setAttribute("display", "block");
    const root = mathNode("mrow");
    math.append(root);
    const stack = [root];
    const current = () => stack[stack.length - 1];
    const readRawArgument = (i) => {
      while (/\s/.test(source[i] || "") && i < source.length) i++;
      if (source[i] !== "{") return { text: source[i] || "", next: i + 1 };
      const start = i + 1;
      let depth = 1;
      i++;
      while (i < source.length && depth) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") depth--;
        i++;
      }
      return { text: source.slice(start, i - 1), next: i };
    };
    const appendArgument = (i) => {
      while (/\s/.test(source[i] || "") && i < source.length) i++;
      if (source[i] === "{") {
        const start = i + 1;
        let depth = 1;
        i++;
        while (i < source.length && depth) {
          if (source[i] === "{") depth++;
          else if (source[i] === "}") depth--;
          i++;
        }
        const inner = mathNode("mrow");
        parseInto(inner, source.slice(start, i - 1));
        return { node: inner, next: i };
      }
      if (i >= source.length) return { node: mathNode("mrow"), next: i };
      if (source[i] === "\\") {
        const commandMatch = source.slice(i).match(/^\\([a-zA-Z]+|.)/);
        if (commandMatch) {
          const command = commandMatch[1];
          const symbol = mathCommands[command];
          const node = symbol ? mathNode(/[a-z]/i.test(symbol) ? "mi" : "mo", symbol) : mathNode("mi", command);
          return { node, next: i + commandMatch[0].length };
        }
      }
      return { node: mathNode(/\d/.test(source[i]) ? "mn" : "mi", source[i]), next: i + 1 };
    };
    const parseInto = (parent, text) => {
      const savedSource = source;
      source = text;
      stack.push(parent);
      parseRange(0, text.length);
      stack.pop();
      source = savedSource;
    };
    const parseRange = (start, end) => {
      let i = start;
      while (i < end) {
        const char = source[i];
        if (/\s/.test(char)) {
          i++;
          continue;
        }
        if (char === "{") {
          const group = mathNode("mrow");
          current().append(group);
          stack.push(group);
          i = parseRange(i + 1, end);
          stack.pop();
          if (source[i] === "}") i++;
          continue;
        }
        if (char === "}") return i;
        if (char === "\\") {
          const match = source.slice(i, end).match(/^\\([a-zA-Z]+|.)/);
          if (!match) { i++; continue; }
          const command = match[1];
          i += match[0].length;
          if (command === "text" || command === "mathrm" || command === "operatorname") {
            if (command === "text") {
              const arg = readRawArgument(i);
              const textNode = mathNode("mtext", arg.text);
              textNode.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
              current().append(textNode);
              i = arg.next;
            } else {
              const arg = appendArgument(i);
              current().append(mathNode("mi", arg.node.textContent || ""));
              i = arg.next;
            }
          } else if (command === "frac") {
            const numerator = appendArgument(i);
            const denominator = appendArgument(numerator.next);
            const fraction = mathNode("mfrac");
            fraction.append(numerator.node, denominator.node);
            current().append(fraction);
            i = denominator.next;
          } else if (command === "sqrt") {
            const arg = appendArgument(i);
            const squareRoot = mathNode("msqrt");
            squareRoot.append(arg.node);
            current().append(squareRoot);
            i = arg.next;
          } else if (command === "left" || command === "right") {
            // LaTeX uses these commands to size delimiters; MathML sizes them naturally.
          } else if (command === "," || command === ";" || command === "!") {
            const space = mathNode("mspace");
            space.setAttribute("width", command === "!" ? "0.1em" : "0.25em");
            current().append(space);
          } else {
            current().append(mathNode(mathCommands[command] ? "mo" : "mi", mathCommands[command] || command));
          }
          continue;
        }
        if (char === "^" || char === "_") {
          const base = current().lastElementChild;
          const arg = appendArgument(i + 1);
          if (base) {
            const scripted = mathNode(char === "^" ? "msup" : "msub");
            base.replaceWith(scripted);
            scripted.append(base, arg.node);
          }
          i = arg.next;
          continue;
        }
        if (/\d/.test(char)) {
          const number = source.slice(i, end).match(/^\d+(?:\.\d+)?/)[0];
          current().append(mathNode("mn", number));
          i += number.length;
          continue;
        }
        if (/[a-zA-Z]/.test(char)) {
          const letters = source.slice(i, end).match(/^[a-zA-Z]+/)[0];
          current().append(mathNode("mi", letters));
          i += letters.length;
          continue;
        }
        current().append(mathNode("mo", char));
        i++;
      }
      return i;
    };
    parseRange(0, source.length);
    target.append(math);
  };

  const appendInline = (target, text) => {
    const pattern = /(\$\$[^$]+\$\$|\$[^$\n]+\$|\\\([^\n]*?\\\)|\\\[[^\n]*?\\\]|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|\^\{[^}]+\}|\^[+-]?\d+(?:\.\d+)?)/g;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      target.append(document.createTextNode(text.slice(last, match.index)));
      const token = match[0];
      let element;
      let content;
      if (token.startsWith("$$") || token.startsWith("$")) {
        renderMath(target, token.startsWith("$$") ? token.slice(2, -2) : token.slice(1, -1), token.startsWith("$$"));
      } else if (token.startsWith("\\(") || token.startsWith("\\[")) {
        renderMath(target, token.slice(2, -2), token.startsWith("\\["));
      } else if (token.startsWith("**") || token.startsWith("__")) {
        element = document.createElement("strong");
        content = token.slice(2, -2);
      } else if (token.startsWith("*") || token.startsWith("_")) {
        element = document.createElement("em");
        content = token.slice(1, -1);
      } else if (token.startsWith("`")) {
        element = document.createElement("code");
        content = token.slice(1, -1);
      } else {
        element = document.createElement("sup");
        content = token.startsWith("^{") ? token.slice(2, -1) : token.slice(1);
      }
      last = match.index + token.length;
      if (!element) continue;
      element.textContent = content;
      target.append(element);
    }
    target.append(document.createTextNode(text.slice(last)));
  };

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const paragraph = document.createElement("p");
    appendInline(paragraph, paragraphLines.join(" "));
    container.append(paragraph);
    paragraphLines = [];
  };
  const flushList = () => {
    if (list) container.append(list);
    list = null;
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      flushParagraph();
      flushList();
      if (codeLines) {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        code.textContent = codeLines.join("\n");
        pre.append(code);
        container.append(pre);
        codeLines = null;
      } else codeLines = [];
      continue;
    }
    if (codeLines) {
      codeLines.push(line);
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const headingEl = document.createElement(`h${heading[1].length + 2}`);
      appendInline(headingEl, heading[2]);
      container.append(headingEl);
    } else if (bullet || numbered) {
      flushParagraph();
      const isOrdered = Boolean(numbered);
      const desiredTag = isOrdered ? "OL" : "UL";
      if (list && list.tagName !== desiredTag) flushList();
      if (!list) list = document.createElement(isOrdered ? "ol" : "ul");
      const item = document.createElement("li");
      appendInline(item, (bullet || numbered)[1]);
      list.append(item);
    } else if (!line.trim()) {
      flushParagraph();
      flushList();
    } else {
      flushList();
      paragraphLines.push(line.trim());
    }
  }

  if (codeLines) {
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = codeLines.join("\n");
    pre.append(code);
    container.append(pre);
  }
  flushParagraph();
  flushList();
}

function setBusy(busy) {
  summarizeBtn.disabled = busy || viewingOtherDocument;
  askBtn.disabled = busy || viewingOtherDocument;
  questionInput.disabled = viewingOtherDocument;
}

function renderConversation() {
  conversationEl.replaceChildren();
  if (conversation.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "empty-state";
    const icon = document.createElement("span");
    icon.className = "empty-icon";
    icon.textContent = "✦";
    icon.setAttribute("aria-hidden", "true");
    const title = document.createElement("h2");
    title.textContent = "Ask this page anything";
    const hint = document.createElement("p");
    hint.textContent = "Your questions and answers will appear here. Follow up naturally—the chat keeps its context.";
    emptyState.append(icon, title, hint);
    conversationEl.append(emptyState);
    return;
  }
  conversation.forEach((turn, index) => {
    if (turn.kind === "summary") {
      const summary = document.createElement("div");
      summary.className = `message message-answer message-summary${turn.error ? " error" : ""}`;
      summary.dataset.turnIndex = String(index);
      summary.dataset.role = "answer";
      const summaryLabel = document.createElement("span");
      summaryLabel.className = "message-label";
      summaryLabel.textContent = turn.pending ? "Summarizing page…" : turn.error ? "Summary error" : "Page summary";
      summary.append(summaryLabel);
      const summaryContent = document.createElement("div");
      summaryContent.className = "formatted-answer";
      appendFormattedText(summaryContent, turn.answer);
      summary.append(summaryContent);
      if (!turn.pending) {
        const againButton = document.createElement("button");
        againButton.className = "message-action";
        againButton.type = "button";
        againButton.textContent = "Summarize again";
        againButton.disabled = isBusy || viewingOtherDocument;
        againButton.addEventListener("click", () => runSummary({ replaceIndex: index }));
        summary.append(againButton);
      }
      conversationEl.append(summary);
      return;
    }

    const question = document.createElement("div");
    question.className = "message message-question";
    question.dataset.turnIndex = String(index);
    question.dataset.role = "question";
    const questionLabel = document.createElement("span");
    questionLabel.className = "message-label";
    questionLabel.textContent = "You";
    question.append(questionLabel, document.createTextNode(turn.question));

    const editButton = document.createElement("button");
    editButton.className = "message-action";
    editButton.type = "button";
    editButton.textContent = "Edit";
    editButton.disabled = isBusy || viewingOtherDocument;
    editButton.addEventListener("click", () => editQuestion(index));
    question.append(editButton);
    conversationEl.append(question);

    const answer = document.createElement("div");
    answer.className = `message message-answer${turn.error ? " error" : ""}`;
    answer.dataset.turnIndex = String(index);
    answer.dataset.role = "answer";
    const answerLabel = document.createElement("span");
    answerLabel.className = "message-label";
    answerLabel.textContent = turn.pending ? "Thinking" : turn.error ? "Error" : "PageWise";
    answer.append(answerLabel);
    const answerContent = document.createElement("div");
    answerContent.className = "formatted-answer";
    appendFormattedText(answerContent, turn.answer);
    answer.append(answerContent);

    if (!turn.pending) {
      const regenerateButton = document.createElement("button");
      regenerateButton.className = "message-action";
      regenerateButton.type = "button";
      regenerateButton.textContent = "Regenerate";
      regenerateButton.disabled = isBusy || viewingOtherDocument;
      regenerateButton.addEventListener("click", () => runQuestion(turn.question, { replaceIndex: index }));
      answer.append(regenerateButton);
    }
    conversationEl.append(answer);
  });
  conversationEl.scrollTop = conversationEl.scrollHeight;
}

function editQuestion(index) {
  if (isBusy) return;
  const questionMessage = conversationEl.querySelector(`[data-turn-index="${index}"][data-role="question"]`);
  if (!questionMessage) return;
  questionMessage.replaceChildren();

  const editor = document.createElement("textarea");
  editor.className = "edit-question-input";
  editor.value = conversation[index].question;
  editor.setAttribute("aria-label", "Edit question");
  questionMessage.append(editor);

  const actions = document.createElement("div");
  actions.className = "edit-actions";
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "message-action";
  saveButton.textContent = "Save & resend";
  saveButton.addEventListener("click", () => {
    const updatedQuestion = editor.value.trim();
    if (updatedQuestion) runQuestion(updatedQuestion, { replaceIndex: index });
  });
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "message-action";
  cancelButton.textContent = "Cancel";
  cancelButton.addEventListener("click", renderConversation);
  actions.append(saveButton, cancelButton);
  questionMessage.append(actions);
  editor.focus();
}

async function runQuestion(question, { replaceIndex = null } = {}) {
  if (!question || isBusy || viewingOtherDocument || activeTabId === null) return;
  const historyEnd = replaceIndex === null ? conversation.length : replaceIndex;
  const history = conversation.slice(0, historyEnd)
    .filter((turn) => !turn.error && !turn.pending)
    .map(({ question: priorQuestion, answer }) => ({ question: priorQuestion, answer }));

  if (replaceIndex !== null) conversation = conversation.slice(0, replaceIndex);
  const turn = { question, answer: "", pending: true };
  conversation.push(turn);
  isBusy = true;
  askBtn.disabled = true;
  summarizeBtn.disabled = true;
  askBtn.textContent = "…";
  statusEl.textContent = "Sending your question to Gemini…";
  await saveConversation();
  renderConversation();

  const startedAt = Date.now();
  turn.answer = "Contacting Gemini…";
  const progressTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    turn.answer = seconds < 8
      ? `Contacting Gemini… ${seconds}s`
      : `Still waiting for Gemini… ${seconds}s. The request is active.`;
    statusEl.textContent = seconds < 8 ? "Gemini is working…" : `Waiting for Gemini (${seconds}s)…`;
    renderConversation();
  }, 1000);

  try {
    const res = await chrome.runtime.sendMessage({
      type: "ASK_QUESTION",
      tabId: activeTabId,
      question,
      history: history.slice(-8).map((prior) => ({
        ...prior,
        answer: String(prior.answer || "").slice(0, 1200),
      })),
    });
    turn.answer = res?.ok ? res.answer : (res?.error || "The request failed. Please try again.");
    turn.error = !res?.ok;
  } catch (err) {
    turn.answer = String(err?.message || err);
    turn.error = true;
  }

  clearInterval(progressTimer);
  turn.pending = false;
  isBusy = false;
  setBusy(false);
  askBtn.textContent = "↑";
  statusEl.textContent = turn.error ? "Reply failed. You can retry or edit the question." : "Ready for your next question.";
  await saveConversation();
  renderConversation();
  await processPendingDocumentChange();
}

async function runSummary({ replaceIndex = null } = {}) {
  if (isBusy || viewingOtherDocument || activeTabId === null) return;
  if (replaceIndex !== null) conversation = conversation.slice(0, replaceIndex);
  const turn = { kind: "summary", question: "Summarize this page", answer: "Reading the page…", pending: true };
  conversation.push(turn);
  isBusy = true;
  summarizeBtn.disabled = true;
  askBtn.disabled = true;
  summarizeBtn.textContent = "Summarizing…";
  statusEl.textContent = "Preparing page summary…";
  await saveConversation();
  renderConversation();

  const startedAt = Date.now();
  const progressTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    turn.answer = `Generating summary… ${seconds}s`;
    statusEl.textContent = `Summarizing page (${seconds}s)…`;
    renderConversation();
  }, 1000);

  try {
    const res = await chrome.runtime.sendMessage({ type: "SUMMARIZE_PAGE", tabId: activeTabId });
    turn.answer = res?.ok ? res.summary : (res?.error || "The summary request failed. Please try again.");
    turn.error = !res?.ok;
  } catch (err) {
    turn.answer = String(err?.message || err);
    turn.error = true;
  }

  clearInterval(progressTimer);
  turn.pending = false;
  isBusy = false;
  summarizeBtn.disabled = false;
  askBtn.disabled = false;
  summarizeBtn.textContent = "Summarize this page";
  statusEl.textContent = turn.error ? "Summary failed. You can try again." : "Summary added to chat.";
  await saveConversation();
  renderConversation();
  await processPendingDocumentChange();
}

async function saveConversation() {
  let active = chatDatabase.chats.find((chat) => chat.id === selectedChatId);
  if (!active) {
    active = createChatRecord();
    active.id = selectedChatId || active.id;
    chatDatabase.chats.push(active);
  }
  active.turns = conversation;
  active.updatedAt = Date.now();
  active.title = titleForConversation(conversation);
  chatDatabase.activeByTab[String(activeTabId)] = active.id;
  await chrome.storage.session.remove(activeChatSessionKey());
  await chrome.storage.local.set({ [chatDatabaseKey]: chatDatabase });
  renderHistory();
}

function titleForConversation(turns) {
  const question = turns.find((turn) => turn.question && turn.question !== "Summarize this page")?.question;
  if (question) return question.replace(/\s+/g, " ").trim().slice(0, 52);
  if (turns.some((turn) => turn.kind === "summary")) return "Page summary";
  return "New chat";
}

function renderHistory() {
  historyList.replaceChildren();
  historyHeading.textContent = showAllHistory ? "All conversations" : "Chats for this document";
  historyScopeBtn.textContent = showAllHistory ? "This document" : "All history";
  const chats = chatDatabase.chats
    .filter((chat) => (chat.turns || []).length > 0 && (showAllHistory || chat.docId === currentDoc.id))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (!chats.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "Your previous chats will appear here.";
    historyList.append(empty);
    return;
  }
  chats.forEach((chat) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `history-item${chat.id === selectedChatId ? " active" : ""}`;
    const title = document.createElement("span");
    title.className = "history-item-title";
    title.textContent = showAllHistory ? `${chat.title || "New chat"} · ${chat.docTitle || "Untitled document"}` : (chat.title || "New chat");
    const date = document.createElement("span");
    date.className = "history-item-date";
    date.textContent = new Date(chat.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    row.append(title, date);
    row.addEventListener("click", async () => {
      if (isBusy) return;
      selectedChatId = chat.id;
      conversation = chat.turns || [];
      viewingOtherDocument = chat.docId !== currentDoc.id;
      if (!viewingOtherDocument) {
        chatDatabase.activeByTab[String(activeTabId)] = chat.id;
        await chrome.storage.session.remove(activeChatSessionKey());
        await chrome.storage.local.set({ [chatDatabaseKey]: chatDatabase });
      }
      renderConversation();
      setBusy(isBusy);
      statusEl.textContent = viewingOtherDocument
        ? `Viewing history from “${chat.docTitle}”. Return to that document to continue.`
        : "Ready for your next question.";
      renderHistory();
      historyPanel.classList.add("hidden");
      historyBtn.setAttribute("aria-expanded", "false");
    });
    historyList.append(row);
  });
}

async function startNewChat() {
  if (isBusy || !currentDoc.id || (conversation.length === 0 && !viewingOtherDocument)) return;
  const chat = createChatRecord();
  selectedChatId = chat.id;
  conversation = [];
  viewingOtherDocument = false;
  await chrome.storage.session.set({ [activeChatSessionKey()]: chat });
  renderConversation();
  setBusy(isBusy);
  renderHistory();
  historyPanel.classList.add("hidden");
  questionInput.focus();
}

async function clearCurrentChat() {
  if (isBusy || !selectedChatId || viewingOtherDocument) return;
  chatDatabase.chats = chatDatabase.chats.filter((chat) => chat.id !== selectedChatId);
  if (chatDatabase.activeByTab[String(activeTabId)] === selectedChatId) {
    delete chatDatabase.activeByTab[String(activeTabId)];
  }
  const chat = createChatRecord();
  selectedChatId = chat.id;
  await chrome.storage.session.set({ [activeChatSessionKey()]: chat });
  conversation = [];
  await persistDatabase();
  renderConversation();
  renderHistory();
}

function createChatRecord() {
  return {
    id: crypto.randomUUID(),
    docId: currentDoc.id,
    docUrl: currentDoc.url,
    docTitle: currentDoc.title,
    visitId: currentVisitId,
    title: "New chat",
    turns: [],
    updatedAt: Date.now(),
  };
}

function identifyDocument(tab) {
  const url = tab?.url || "";
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid)/i.test(key)) parsed.searchParams.delete(key);
    }
    return { id: parsed.href, url, title: tab.title || parsed.hostname || "Untitled document" };
  } catch {
    return { id: url || `tab:${tab?.id}`, url, title: tab?.title || "Untitled document" };
  }
}

async function persistDatabase() {
  const saved = {
    ...chatDatabase,
    chats: chatDatabase.chats.filter((chat) => (chat.turns || []).length > 0),
  };
  await chrome.storage.local.set({ [chatDatabaseKey]: saved });
}

function activeChatSessionKey() {
  return `pagerag_active_chat_${activeTabId}`;
}

async function getDocumentVisitId(tab) {
  const key = `pagerag_visit_${activeTabId}`;
  const saved = await chrome.storage.session.get(key);
  const visit = saved[key];
  if (visit?.url === tab.url && visit.visitId) return visit.visitId;
  const visitId = crypto.randomUUID();
  await chrome.storage.session.set({ [key]: { url: tab.url || "", visitId } });
  return visitId;
}

async function activateDocument(tab, { forceNew = false } = {}) {
  currentDoc = identifyDocument(tab);
  currentVisitId = await getDocumentVisitId(tab);
  const activeSessionResult = await chrome.storage.session.get(activeChatSessionKey());
  const activeSession = activeSessionResult[activeChatSessionKey()];
  if (!forceNew && activeSession?.docId === currentDoc.id && activeSession?.visitId === currentVisitId) {
    selectedChatId = activeSession.id;
    conversation = activeSession.turns || [];
    viewingOtherDocument = false;
    renderConversation();
    renderHistory();
    setBusy(isBusy);
    return;
  }
  const storedActiveId = chatDatabase.activeByTab[String(activeTabId)];
  const storedActive = chatDatabase.chats.find((chat) => chat.id === storedActiveId);
  if (!forceNew && storedActive?.docId === currentDoc.id && storedActive?.visitId === currentVisitId) {
    selectedChatId = storedActive.id;
    conversation = storedActive.turns || [];
  } else {
    const chat = createChatRecord();
    selectedChatId = chat.id;
    conversation = [];
    await chrome.storage.session.set({ [activeChatSessionKey()]: chat });
  }
  viewingOtherDocument = false;
  if (chatDatabase.chats.some((chat) => chat.id === selectedChatId)) await persistDatabase();
  renderConversation();
  renderHistory();
  setBusy(isBusy);
}

function applyStatus(res) {
  if (res.ok && res.hasContent) {
    const chars = (res.charCount || 0).toLocaleString();
    const pdfs = res.pdfCount ? ` · ${res.pdfCount} PDF${res.pdfCount === 1 ? "" : "s"}` : "";
    statusEl.textContent = `Indexed "${res.title}" (${chars} chars${pdfs})`;
    setBusy(false);
    if (res.warnings && res.warnings.length) {
      unsupportedNoteEl.textContent = res.warnings.join(" ");
      unsupportedNoteEl.classList.remove("hidden");
    } else {
      unsupportedNoteEl.classList.add("hidden");
    }
  } else {
    setBusy(true);
    statusEl.textContent = res.error || "No content indexed yet.";
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

let activeTabId = null;

openChatBtn.addEventListener("click", async () => {
  if (activeTabId === null) return;
  const url = `${chrome.runtime.getURL("popup.html")}?tabId=${activeTabId}`;
  await chrome.tabs.create({ url });
});

chatSizeBtn.addEventListener("click", () => {
  returnToPage();
});

async function returnToPage() {
  try {
    const openPanel = chrome.sidePanel.open({ tabId: activeTabId });
    const activatePage = chrome.tabs.update(activeTabId, { active: true });
    const results = await Promise.allSettled([openPanel, activatePage]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
  } catch {
    statusEl.textContent = "Could not open the side panel. Use the PageWise toolbar button to reopen the chat.";
  }
}

async function indexCurrentPage(force = false) {
  if (activeTabId === null) return;
  refreshPageBtn.disabled = true;
  setBusy(true);
  statusEl.textContent = force ? "Refreshing page text…" : "Checking saved page text…";
  const startedAt = Date.now();
  const progressTimer = setInterval(() => {
    const seconds = Math.floor((Date.now() - startedAt) / 1000);
    statusEl.textContent = `${force ? "Refreshing" : "Reading"} page… ${seconds}s`;
  }, 1000);

  try {
    if (!force) {
      const cached = await chrome.runtime.sendMessage({ type: "GET_TAB_STATUS", tabId: activeTabId });
      if (cached?.ok && cached.hasContent) {
        applyStatus(cached);
        return;
      }
    }
    statusEl.textContent = "Reading this page for the first time…";
    const res = await chrome.runtime.sendMessage({ type: "INDEX_TAB", tabId: activeTabId });
    applyStatus(res);
  } catch (err) {
    statusEl.textContent = String(err?.message || err);
    setBusy(true);
  } finally {
    clearInterval(progressTimer);
    refreshPageBtn.disabled = false;
  }
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (tabId !== activeTabId || !changeInfo.url) return;
  if (isBusy) {
    pendingDocumentTabId = tabId;
    return;
  }
  await handleDocumentNavigation(tabId);
});

async function handleDocumentNavigation(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) return;
  const nextDoc = identifyDocument(tab);
  const nextVisitId = await getDocumentVisitId(tab);
  if (nextDoc.id === currentDoc.id && nextVisitId === currentVisitId) return;
  currentVisitId = nextVisitId;
  await activateDocument(tab, { forceNew: true });
  statusEl.textContent = `New document: ${currentDoc.title}. Starting a fresh chat.`;
  await indexCurrentPage(true);
}

async function processPendingDocumentChange() {
  if (pendingDocumentTabId === null || isBusy) return;
  const tabId = pendingDocumentTabId;
  pendingDocumentTabId = null;
  await handleDocumentNavigation(tabId);
}

(async () => {
  if (isFullChat) {
    activeTabId = requestedTabId;
  } else {
    const tab = await getActiveTab();
    activeTabId = tab?.id ?? null;
  }
  if (activeTabId === null) {
    statusEl.textContent = "No active tab.";
    return;
  }
  const tab = await chrome.tabs.get(activeTabId);
  currentDoc = identifyDocument(tab);
  const data = await chrome.storage.local.get(chatDatabaseKey);
  if (data[chatDatabaseKey]?.chats) {
    chatDatabase = data[chatDatabaseKey];
    chatDatabase.activeByTab ||= {};
    for (const chat of chatDatabase.chats) {
      const generatedTitle = titleForConversation(chat.turns || []);
      if (generatedTitle !== "New chat") chat.title = generatedTitle;
    }
  } else {
    chatDatabase = { chats: [], activeByTab: {} };
    const localValues = await chrome.storage.local.get(null);
    for (const [key, oldValue] of Object.entries(localValues)) {
      const match = key.match(/^conversation_(\d+)$/);
      if (!match) continue;
      const oldTabId = Number(match[1]);
      const oldTab = await chrome.tabs.get(oldTabId).catch(() => null);
      const oldDoc = identifyDocument(oldTab || (oldTabId === activeTabId ? tab : { id: oldTabId }));
      let oldChats = [];
      if (Array.isArray(oldValue)) {
        oldChats = [{ id: crypto.randomUUID(), title: titleForConversation(oldValue), turns: oldValue, updatedAt: Date.now() }];
      } else if (oldValue?.chats) {
        oldChats = oldValue.chats.map((chat) => ({ ...chat, turns: chat.turns || [] }));
      }
      if (!oldChats.length && oldTabId === activeTabId) {
        const session = await chrome.storage.session.get(key);
        const turns = session[key] || [];
        oldChats = [{ id: crypto.randomUUID(), title: titleForConversation(turns), turns, updatedAt: Date.now() }];
      }
      const migrated = oldChats.map((chat) => ({
        ...chat,
        id: chat.id || crypto.randomUUID(),
        title: titleForConversation(chat.turns || []),
        docId: oldDoc.id,
        docUrl: oldDoc.url,
        docTitle: oldDoc.title,
      }));
      chatDatabase.chats.push(...migrated);
      const oldActiveId = oldValue?.activeId;
      const active = migrated.find((chat) => chat.id === oldActiveId) || migrated[0];
      if (active) chatDatabase.activeByTab[String(oldTabId)] = active.id;
    }
  }
  chatDatabase.chats = chatDatabase.chats.filter((chat) => (chat.turns || []).length > 0);
  await persistDatabase();
  await activateDocument(tab);
  await indexCurrentPage();
  if (!askBtn.disabled) questionInput.focus();
})();

refreshPageBtn.addEventListener("click", () => indexCurrentPage(true));

historyBtn.addEventListener("click", () => {
  const willOpen = historyPanel.classList.contains("hidden");
  historyPanel.classList.toggle("hidden", !willOpen);
  historyBtn.setAttribute("aria-expanded", String(willOpen));
  if (willOpen) renderHistory();
});
historyScopeBtn.addEventListener("click", () => {
  showAllHistory = !showAllHistory;
  renderHistory();
});
closeHistoryBtn.addEventListener("click", () => {
  historyPanel.classList.add("hidden");
  historyBtn.setAttribute("aria-expanded", "false");
});
newChatBtn.addEventListener("click", startNewChat);
clearChatBtn.addEventListener("click", clearCurrentChat);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "session") {
    const visit = changes[`pagerag_visit_${activeTabId}`]?.newValue;
    if (visit?.url === currentDoc.url && visit.visitId) {
      currentVisitId = visit.visitId;
      const active = chatDatabase.chats.find((chat) => chat.id === selectedChatId);
      if (active?.docId === currentDoc.id) {
        active.visitId = visit.visitId;
        void persistDatabase();
      }
    }
    const activeSession = changes[activeChatSessionKey()]?.newValue;
    if (activeSession?.docId === currentDoc.id && activeSession?.visitId === currentVisitId) {
      selectedChatId = activeSession.id;
      conversation = activeSession.turns || [];
      viewingOtherDocument = false;
      renderConversation();
      renderHistory();
      setBusy(isBusy);
    }
    return;
  }
  if (areaName !== "local" || !changes[chatDatabaseKey] || isBusy) return;
  const updated = changes[chatDatabaseKey].newValue;
  if (!updated?.chats) return;
  chatDatabase = updated;
  const tabActiveId = chatDatabase.activeByTab?.[String(activeTabId)];
  const active = chatDatabase.chats.find((chat) => chat.id === tabActiveId);
  if (!viewingOtherDocument && active?.docId === currentDoc.id) selectedChatId = active.id;
  const selected = chatDatabase.chats.find((chat) => chat.id === selectedChatId);
  if (!selected || viewingOtherDocument) return;
  conversation = selected.turns || [];
  renderConversation();
  renderHistory();
});

summarizeBtn.addEventListener("click", () => runSummary());

async function ask() {
  const question = questionInput.value.trim();
  if (!question || isBusy) return;
  questionInput.value = "";
  questionInput.style.height = "auto";
  await runQuestion(question);
}

askForm.addEventListener("submit", (event) => {
  event.preventDefault();
  ask();
});

questionInput.addEventListener("input", () => {
  questionInput.style.height = "auto";
  questionInput.style.height = `${Math.min(questionInput.scrollHeight, 84)}px`;
});

questionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    ask();
  }
});
