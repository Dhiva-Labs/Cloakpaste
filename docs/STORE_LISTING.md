# Chrome Web Store listing

Upload `dist/pasteguard-<version>.zip` (built by `npm run package`).
Images are in `store-assets/` (rendered by `node scripts/store-shots.mjs`
after `npm run build:test`).

## Store listing

**Name:** PasteGuard

**Summary** (132 characters max):
Hides emails, keys, card numbers and names before you paste into AI chats. Runs fully on your device.

**Category:** Privacy & Security
**Language:** English

**Description:**

PasteGuard keeps private data out of AI chats.

Paste a stack trace, an email thread or a config file into ChatGPT, Claude, Gemini or another AI chat, and PasteGuard swaps the sensitive parts for placeholders before the text lands in the chat box:

  Hi Priya Raman, reach me at arjun@northwind.dev
  becomes
  Hi [PERSON_1], reach me at [EMAIL_1]

When the AI replies with a placeholder, hover it to see the original, or copy the reply to get the real values back on your clipboard.

WHAT IT HIDES
• API keys and tokens: OpenAI, Anthropic, AWS, GitHub, GitLab, Slack, Stripe, Google, Hugging Face and more
• Passwords and secrets in config files and connection strings
• Private keys
• Card numbers and IBANs, checked with checksums
• Aadhaar, PAN and US SSN
• Email addresses, phone numbers, IP and MAC addresses
• People's names, places and street addresses, found by a small on-device model
• Your own words: client names, project codenames

PRIVATE BY DESIGN
• Everything runs in your browser. The model ships with the extension, and PasteGuard makes no network requests.
• No account, no server, no analytics, no tracking.
• Placeholder mappings are kept in memory only and cleared when you close the browser.
• Originals are shown in PasteGuard's own tooltip, so the chat site's scripts never see them.

IN YOUR CONTROL
• "Paste original" undoes any redaction.
• Switch each kind of data on or off, or switch off individual sites.
• Add any other site, such as a self-hosted chat UI, with "Protect this site".
• Try anything in the built-in playground.

Works on ChatGPT, Claude, Gemini, Google AI Studio, Microsoft Copilot, Perplexity, DeepSeek, Mistral Le Chat, Grok, Poe, HuggingChat, Qwen Chat and Meta AI.

Only pasted text is checked. Text you type yourself and files you upload are not. PasteGuard reduces accidental leaks; no detector catches everything.

Source code: https://github.com/Dhiva-Labs/PasteGuard

**Images**
- Store icon: `icons/icon128.png`
- Screenshots (1280×800): `store-assets/screenshot-1.png`, `-2.png`, `-3.png`
- Small promo tile (440×280): `store-assets/promo-small-440x280.png`
- Marquee (1400×560): `store-assets/promo-marquee-1400x560.png`

**Website:** https://github.com/Dhiva-Labs/PasteGuard
**Support:** https://github.com/Dhiva-Labs/PasteGuard/issues

## Privacy practices tab

**Single purpose:**
Hide sensitive data in text pasted into AI chat websites by replacing it with placeholders, and show the user the original values behind those placeholders.

**Permission justifications:**
- `storage`: Saves the user's settings (which data types to hide, custom word lists, per-site switches). Also keeps the placeholder-to-value mapping in session storage, which is cleared when the browser closes.
- `offscreen`: Runs the bundled on-device name-detection model (ONNX Runtime WebAssembly) in an offscreen document, because MV3 service workers can't load it.
- `scripting`: Registers the content script on extra sites only when the user chooses "Protect this site" and grants access to that site.
- Host permissions (content script matches): Needed to intercept paste events and mark placeholders on the listed AI chat sites. No other pages are read.
- Optional host permissions (`https://*/*`, `http://*/*`): Requested one origin at a time, only when the user adds a site with "Protect this site".

**Remote code:** No. All JavaScript, WebAssembly and model weights are in the package. `wasm-unsafe-eval` in the CSP is required to compile the bundled WebAssembly.

**Data usage:** PasteGuard reads pasted text on the device to redact it. Nothing is transmitted. The categories it handles locally are personally identifiable information (names, emails, phone numbers, ID numbers, addresses), authentication information (passwords, API keys, tokens), financial and payment information (card numbers, IBANs) and website content (the pasted text).

Certify all three:
- Not sold or transferred to third parties, outside approved use cases
- Not used or transferred for purposes unrelated to the item's single purpose
- Not used or transferred to determine creditworthiness or for lending

**Privacy policy URL:** https://github.com/Dhiva-Labs/PasteGuard/blob/main/PRIVACY.md

## Distribution

- Visibility: Public
- Regions: All
