# PageWise

PageWise is a Chrome extension for summarizing webpages and documents, asking follow-up questions, and keeping conversations organized by document.

## Features

- Summarize a page and ask questions about its contents.
- Continue a conversation with earlier questions and answers as context.
- Read text from webpages, embedded frames, PDFs, and supported Google Docs.
- Keep separate chats for different documents, browse a document's chat history, or view all history.
- Open the conversation in Chrome's Side Panel so it stays beside the page.
- Format common Markdown and math notation in answers.

## Install in Chrome

PageWise is not currently distributed through the Chrome Web Store. To load it locally:

1. Download or clone this repository and unzip it if needed.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Select **Load unpacked** and choose the project folder containing `manifest.json`.
5. To read local PDF files, open the extension's details and turn on **Allow access to file URLs**.

After changing the code, return to `chrome://extensions` and click the extension's **Reload** button.

## Configure Gemini

PageWise uses the Gemini API to generate summaries and answers. You need your own Gemini API key:

1. Open `chrome://extensions`.
2. Select **Details** on the PageWise extension card.
3. Select **Extension options**.
4. Paste your key and save it.
5. Leave the model field at its default, or enter a model available to your API key.

Keep your API key private. Do not add it to source files, screenshots, or commits.

## Use PageWise

1. Open a webpage or document in Chrome and select the PageWise toolbar button.
2. Choose **Summarize this page** or type a question.
3. Use **New** to begin a separate conversation, **History** to revisit chats, or **All history** to browse conversations across documents.
4. Select **Open chat** or use the Side Panel to keep the conversation visible next to the page.

Document histories are associated with the page URL. When the page URL changes to a different document, PageWise starts a fresh chat for that visit and keeps earlier chats in History.

## How it works

PageWise extracts readable page text in the browser. For questions, it divides the text into overlapping chunks and uses keyword relevance to select passages for Gemini. For summaries, it sends a sample of the page text. Gemini generates the response, which PageWise displays in the chat.

## Privacy

- Page text and your question are sent to Google's Gemini API when you request a summary or answer.
- Your Gemini API key and saved conversations are stored in Chrome extension storage on your device.
- PageWise does not include a separate app server in this project.

Avoid sending sensitive or confidential pages to an AI service unless you are allowed to share that content with it.

## Limitations

- Some sites restrict access to their content or use frames that Chrome does not allow extensions to read.
- Image-only or scanned PDFs may not contain extractable text.
- Keyword-based retrieval can miss relevant passages when the wording in your question differs from the page.
- Document history depends on URL changes. Switching documents inside a viewer that keeps the same URL may not be recognized as a new document.
- Gemini model availability, limits, and response times depend on Google's API and your account.

## Project files

- `manifest.json` — Chrome extension settings, permissions, and entry points.
- `popup.html`, `sidepanel.html`, `popup.js`, and `popup.css` — chat interface and its behavior.
- `content.js` — extracts text from webpages and frames.
- `background.js` — indexes page content and calls the Gemini API.
- `rag.js` — splits text into chunks and ranks chunks by keyword relevance.
- `offscreen.js` — extracts text from PDFs using the bundled PDF.js files in `lib/`.
- `options.html` and `options.js` — Gemini API key and model settings.

## License

No license has been added yet. Until a license is included, others should not assume they have permission to reuse or redistribute the code.
