# PasteGuard

Hides secrets and personal data before you paste them into AI chats, by **DhivaLabs**.

Paste a stack trace, an email thread or a config file into ChatGPT, Claude or
Gemini, and PasteGuard swaps the sensitive parts for placeholders before the
text lands in the chat box:

```
Hi team, ping John O'Neill (john.oneill@acme.io) about the Chennai rollout.
OPENAI_API_KEY=sk-proj-Q8m2N4b7X1c9V3z5K6j0L2p4R7t9W1y3
```

becomes

```
Hi team, ping [PERSON_1] ([EMAIL_1]) about the [LOCATION_1] rollout.
OPENAI_API_KEY=[API_KEY_1]
```

When the AI replies with `[EMAIL_1]`, hover the placeholder to see the original,
or copy the reply to get the originals back on your clipboard.

Detection runs on your device. There is no server, account or analytics, and
the extension makes no network requests.

## What it catches

| Kind | How |
|---|---|
| API keys and tokens: OpenAI, Anthropic, AWS, GitHub, GitLab, Slack, Stripe, Google, Hugging Face, npm, SendGrid, Twilio, Telegram, Discord, JWTs, bearer tokens | Vendor patterns |
| Private keys (PEM, OpenSSH, PGP) | Patterns |
| Passwords and secrets in config: `DB_PASSWORD=...`, `"client_secret": "..."`, `postgres://user:pass@host`, "my password is ..." | Key-name patterns with code-aware filtering, plus the model |
| Card numbers, IBANs | Checksums (Luhn, mod-97) and issuer prefixes |
| US SSN, Aadhaar, PAN | Format rules; Aadhaar is Verhoeff-checked |
| Emails, phone numbers (international, US, India) | Patterns |
| IPv4, IPv6 and MAC addresses | Patterns with validation; loopback is ignored |
| People's names, places and street addresses | On-device model |
| Your own words: client names, project codenames | "Always hide" list |

Organisation names and random-looking strings can also be switched on in
settings. They're off by default because they flag product names, hashes and
IDs in ordinary code.

## How it works

```
paste ──► content script ──► service worker ──► offscreen document
             (holds the            │              (PII model, ONNX
              paste)               │               runtime in WASM)
                                   ▼
                     pattern detectors + model spans
                     + values seen in earlier pastes
                                   │
                        merge overlaps, assign placeholders
                        from this site's vault
                                   ▼
             redacted text inserted the way the editor expects
             (execCommand for textareas, a synthetic paste for
              ProseMirror and other rich editors)
```

- **Model.** [`gravitee-io/bert-small-pii-detection`](https://huggingface.co/gravitee-io/bert-small-pii-detection)
  (4-layer BERT, int8, 29 MB, Apache-2.0) runs through transformers.js in an offscreen
  document. A typical paste takes 10–80 ms. The first paste after the browser
  starts takes about a second while the model loads.
- **Offsets.** transformers.js doesn't return character offsets for BERT
  tokens, so PasteGuard aligns WordPiece tokens back to the original text
  itself (`src/ner/decode.js`), then cleans up the entities: it trims filler
  words ("Ping John" becomes "John"), joins names split in two, and rejects
  code identifiers.
- **Consistent placeholders.** Each site has its own vault, kept in
  `chrome.storage.session`, which is in memory only and cleared when the
  browser closes. The same value always gets the same placeholder, so the AI
  can still follow who is who. Values hidden once stay hidden in later pastes,
  even where the model misses them.
- **Replies.** Placeholders in replies are marked with the CSS Custom
  Highlight API, which doesn't change the page DOM. Originals appear only in a
  closed-shadow tooltip, so the site's own scripts never see them. A "swap
  into page" mode exists for readability, with that trade-off spelled out in
  settings.
- **Fails closed.** If a paste can't be checked, it's held back and a toast
  offers "Paste anyway".

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/EVALUATION.md](docs/EVALUATION.md).

## Accuracy

On the bundled evaluation set (40 texts: 25 with names or places, plus 15
of code, logs and questions):

| | Precision | Recall |
|---|---|---|
| People's names | 1.00 | 0.97 |
| Places and addresses | 1.00 | 1.00 |
| Code, logs and questions with no findings | 15/15 | |

The set is small and hand-written, so treat these numbers as a regression
check rather than a benchmark. Run `npm run eval:ner` to reproduce them.

## Sites

ChatGPT, Claude, Gemini, Google AI Studio, Microsoft Copilot, Perplexity,
DeepSeek, Mistral Le Chat, Grok, Poe, HuggingChat, Qwen Chat and Meta AI. To
protect any other site, such as a self-hosted Open WebUI or an internal tool,
open it and choose **Protect this site** in the PasteGuard menu. Each site
can be switched off on its own.

## Limits

- Only pastes are checked. Text you type yourself and files you upload are
  not.
- A site's own "Copy" button writes placeholders to the clipboard. Select the
  text and copy it instead to get the originals.
- The model is English-focused. Pattern detection works in any language.
- No detector is perfect. PasteGuard reduces accidental leaks; it doesn't
  guarantee none.

## Development

```bash
npm install
npm run fetch:model      # downloads the 29 MB model and checks its SHA-256
npm test                 # unit tests (detectors, checksums, vault, decoding)
npm run eval:ner         # precision/recall sweep for the model thresholds
npm run build:test       # dist/extension, also matching http://127.0.0.1
npm run test:e2e         # headless Chrome: textarea, contenteditable, ProseMirror
npm run build            # production build in dist/extension
```

To try it, open `chrome://extensions`, turn on Developer mode, choose
**Load unpacked** and select `dist/extension`. The settings page includes a
playground that shows what would be hidden in any text.

Requires Chrome 116 or later.
