// Content script for AI chat sites. Catches pastes, sends the text to the
// service worker for redaction, and inserts the redacted version instead.

import { withDefaults, siteEnabled } from '../core/settings.js';
import { Vault } from '../core/vault.js';
import { summarize } from '../core/types.js';
import { createUi } from './ui.js';
import { createRestorer } from './restore.js';
import {
  editableTarget,
  isTextField,
  captureSelection,
  restoreSelection,
  insertText,
  beginInsertRecord,
  finishInsertRecord,
  selectInserted,
} from './editing.js';

(() => {
  if (globalThis.__pasteGuard) return; // built-in and user-added registrations can overlap
  globalThis.__pasteGuard = true;

  const VAULT_KEY = `vault:${location.origin}`;
  let settings = withDefaults();
  let vault = new Vault();
  let warmed = false;

  const ui = createUi();
  const restorer = createRestorer({ getVault: () => vault, getSettings: () => settings, ui });
  const active = () => siteEnabled(settings, location.hostname);

  async function load() {
    const [{ settings: s }, sess] = await Promise.all([
      chrome.storage.local.get('settings'),
      __FIREFOX__ ? chrome.runtime.sendMessage({ type: 'pg:vault:get' }).then((r) => r || {}, () => ({})) : chrome.storage.session.get(VAULT_KEY),
    ]);
    settings = withDefaults(s);
    vault = new Vault(sess[VAULT_KEY]);
    restorer.start();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      settings = withDefaults(changes.settings.newValue);
      restorer.refresh();
    }
    if (area === 'session' && changes[VAULT_KEY]) {
      vault = new Vault(changes[VAULT_KEY].newValue);
      restorer.refresh();
    }
  });

  if (__FIREFOX__) {
    // Firefox keeps session storage from content scripts, so the background
    // says when this site's vault changed and we ask for it again.
    let asked = 0;
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type !== 'pg:vault:changed') return;
      const n = ++asked;
      chrome.runtime.sendMessage({ type: 'pg:vault:get' }).then((sess) => {
        if (n !== asked) return; // a newer answer is on its way
        vault = new Vault(sess?.[VAULT_KEY]);
        restorer.refresh();
      }, () => {});
    });
  }

  // Load the model the first time someone focuses a text box, so the first
  // paste doesn't wait for it.
  document.addEventListener(
    'focusin',
    (e) => {
      if (warmed || !active() || !settings.model || !editableTarget(e.target)) return;
      warmed = true;
      chrome.runtime.sendMessage({ type: 'pg:warm' }).catch(() => {});
    },
    true,
  );

  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  async function onPaste(e) {
    if (!e.isTrusted || !active()) return;
    const target = editableTarget(e.target);
    const dt = e.clipboardData;
    if (!target || !dt) return;
    if ([...dt.types].includes('Files')) return; // images and files pass through untouched
    let text = dt.getData('text/plain');
    if (!text || text.trim().length < 3) return;
    text = text.replace(/\r\n?/g, '\n');
    const html = dt.getData('text/html');

    // Scanning is async, so hold the paste now and insert once we know.
    e.preventDefault();
    e.stopImmediatePropagation();
    const dispatchTo = e.target;
    const snap = captureSelection(target);

    let busy = null;
    const slow = setTimeout(() => {
      busy = ui.toast({ title: 'Checking paste for private data…', busy: true });
    }, 250);

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'pg:redact', text });
    } catch (err) {
      res = { error: String(err?.message || err) };
    }
    clearTimeout(slow);
    busy?.close();
    restoreSelection(target, snap);

    if (res?.skipped || (res && !res.error && !res.items.length)) {
      insertText(target, text, html, dispatchTo);
      return;
    }

    if (!res || res.error) {
      // Fail closed: an unchecked paste could leak exactly what we guard.
      ui.toast({
        title: 'Paste held back',
        detail: /context invalidated/i.test(res?.error || '')
          ? 'PasteGuard was updated. Reload this page to keep protecting pastes.'
          : "PasteGuard couldn't check this text.",
        actions: [{ label: 'Paste anyway', onClick: () => (restoreSelection(target, snap), insertText(target, text, html, dispatchTo)) }],
      });
      return;
    }

    const record = beginInsertRecord(target);
    insertText(target, res.text, '', dispatchTo);
    finishInsertRecord(record, target, isTextField(target) ? target.value.slice(record.start, target.selectionEnd) : res.text);

    const notes = [summarize(res.counts)];
    if (res.model?.error) notes.push('Name detection was unavailable for this paste.');
    else if (res.model?.truncated) notes.push(`Names were checked in the first ${res.model.scannedChars.toLocaleString()} characters.`);

    ui.toast({
      title: `Hid ${plural(res.items.length, 'item')} before pasting`,
      detail: notes.join(' '),
      items: res.items,
      timeout: settings.toastSeconds * 1000,
      actions: [
        {
          label: 'Paste original',
          onClick: async () => {
            if (selectInserted(target, record)) {
              // ProseMirror syncs its selection from selectionchange, which
              // fires asynchronously.
              await new Promise((r) => setTimeout(r, 50));
              insertText(target, text, html, target);
              ui.flash('Pasted the original text');
            } else {
              ui.toast({
                title: "Couldn't swap the text back",
                detail: 'The composer changed since the paste. Copy the original and paste it yourself.',
                actions: [{ label: 'Copy original', primary: true, onClick: () => navigator.clipboard.writeText(text) }],
              });
            }
          },
        },
      ],
    });
  }

  window.addEventListener('paste', onPaste, true);
  load();
})();
