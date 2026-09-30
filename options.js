const apiKeyEl = document.getElementById("apiKey");
const modelEl = document.getElementById("model");
const saveBtn = document.getElementById("saveBtn");
const savedMsg = document.getElementById("savedMsg");

(async () => {
  const { geminiApiKey, geminiModel } = await chrome.storage.local.get([
    "geminiApiKey",
    "geminiModel",
  ]);
  if (geminiApiKey) apiKeyEl.value = geminiApiKey;
  modelEl.value = geminiModel || "gemini-3.5-flash-lite";
})();

saveBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({
    geminiApiKey: apiKeyEl.value.trim(),
    geminiModel: modelEl.value.trim() || "gemini-3.5-flash-lite",
  });
  savedMsg.style.display = "inline";
  setTimeout(() => (savedMsg.style.display = "none"), 1500);
});
