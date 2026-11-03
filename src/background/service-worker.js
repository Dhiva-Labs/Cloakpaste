// Background service worker: owns settings, the per-site vaults and the
// offscreen document that hosts the model. Content scripts send it pasted
// text and get redacted text back; nothing here talks to the network.

import { redactText } from '../core/redact.js';
import { Vault } from '../core/vault.js';
import { withDefaults, siteEnabled } from '../core/settings.js';

const OFFSCREEN_URL = 'src/offscreen/offscreen.html';
const MODEL_TIMEOUT_MS = 8000;
// First use compiles the WebAssembly runtime and loads the weights.
const MODEL_LOAD_TIMEOUT_MS = 30000;
const CUSTOM_SCRIPT_ID = 'pasteguard-custom-sites';

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { settings } = await chrome.storage.local.get('settings');
  await chrome.storage.local.set({ settings: withDefaults(settings) });
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html#welcome') });
});

// Content scripts read their site's vault directly to highlight placeholders.
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return withDefaults(settings);
}

// ---------------------------------------------------------------- offscreen

let creating = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (contexts.length) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: ['WORKERS'],
        justification: 'Runs the on-device model that finds names and addresses in pasted text.',
      })
      .catch((err) => {
        if (!String(err).includes('Only a single offscreen')) throw err;
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}

let modelReady = false;

// The offscreen document registers its listener a moment after it is
// created; retry until it answers.
async function sendToOffscreen(message) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await chrome.runtime.sendMessage({ target: 'offscreen', ...message });
    } catch (err) {
      if (attempt >= 40 || !/Receiving end does not exist/i.test(String(err))) throw err;
      await new Promise((r) => setTimeout(r, 75));
    }
  }
}

async function askModel(message) {
  await ensureOffscreen();
  const ms = modelReady ? MODEL_TIMEOUT_MS : MODEL_LOAD_TIMEOUT_MS;
  const timeout = new Promise((resolve) => setTimeout(() => resolve({ error: 'timeout' }), ms));
  const res = await Promise.race([sendToOffscreen(message), timeout]);
  if (res && !res.error) modelReady = true;
  return res;
}

// ---------------------------------------------------------------- vaults

// One vault per site origin, kept in session storage (memory only, cleared
// when the browser closes). Writes are serialised per origin.
const locks = new Map();

function withVault(origin, fn) {
  const prev = locks.get(origin) || Promise.resolve();
  const next = prev.then(async () => {
    const key = `vault:${origin}`;
    const stored = (await chrome.storage.session.get(key))[key];
    const vault = new Vault(stored);
    const result = await fn(vault);
    await chrome.storage.session.set({ [key]: vault.toJSON() });
    return result;
  });
  locks.set(origin, next.catch(() => {}));
  return next;
}

async function recordStats(origin, tabId, counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return;
  const { stats = {} } = await chrome.storage.session.get('stats');
  const s = (stats[origin] ||= { pastes: 0, items: 0, byType: {} });
  s.pastes += 1;
  s.items += total;
  for (const [t, n] of Object.entries(counts)) s.byType[t] = (s.byType[t] || 0) + n;
  await chrome.storage.session.set({ stats });

  if (tabId != null) {
    const key = `tab:${tabId}`;
    const n = ((await chrome.storage.session.get(key))[key] || 0) + total;
    await chrome.storage.session.set({ [key]: n });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#0B1029' });
    chrome.action.setBadgeTextColor?.({ tabId, color: '#BFF23A' });
    chrome.action.setBadgeText({ tabId, text: n > 99 ? '99+' : String(n) });
  }
}

// ---------------------------------------------------------------- redaction

async function handleRedact(msg, sender) {
  const settings = await getSettings();
  const fromExtensionPage = sender.url?.startsWith(chrome.runtime.getURL(''));
  const origin = fromExtensionPage ? 'playground' : sender.origin || new URL(sender.url).origin;
  const hostname = fromExtensionPage ? '' : new URL(origin).hostname;
  if (!fromExtensionPage && !siteEnabled(settings, hostname)) return { skipped: true };

  const text = String(msg.text || '');
  let nerSpans = [];
  let model = { used: false };
  if (settings.model) {
    const res = await askModel({ type: 'ner', text, maxChars: settings.modelMaxChars }).catch((e) => ({ error: String(e) }));
    if (res?.spans) {
      nerSpans = res.spans;
      model = { used: true, ms: res.ms, scannedChars: res.scannedChars, truncated: res.scannedChars < text.length };
    } else {
      model = { used: false, error: res?.error || 'unavailable' };
    }
  }

  const result = await withVault(origin, (vault) => redactText(text, { vault, nerSpans, settings }));
  if (!fromExtensionPage) await recordStats(origin, sender.tab?.id, result.counts);
  return { ...result, model };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'offscreen') return false;
  const handlers = {
    'pg:redact': () => handleRedact(msg, sender),
    'pg:warm': async () => {
      const settings = await getSettings();
      if (settings.model) await askModel({ type: 'warm' });
      return { ok: true };
    },
    'pg:vault:forget': () =>
      withVault(msg.origin, (vault) => {
        if (msg.key) vault.remove(msg.key);
        else for (const k of Object.keys(vault.entries)) vault.remove(k);
        return { ok: true };
      }),
    'pg:site:add': () => registerCustomSite(msg.origin),
    'pg:site:remove': () => unregisterCustomSite(msg.origin),
  };
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler().then(sendResponse, (err) => sendResponse({ error: String(err?.message || err) }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(`tab:${tabId}`));

// ---------------------------------------------------------------- extra sites

// Sites beyond the built-in list (self-hosted chat UIs, internal tools). The
// popup requests host permission first; here we register the content script.
async function syncCustomScripts() {
  const { customSites = [] } = await chrome.storage.local.get('customSites');
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [CUSTOM_SCRIPT_ID] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [CUSTOM_SCRIPT_ID] });
  if (!customSites.length) return;
  await chrome.scripting.registerContentScripts([
    {
      id: CUSTOM_SCRIPT_ID,
      matches: customSites.map((o) => `${o}/*`),
      js: ['src/content/content.js'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
  ]);
}

async function registerCustomSite(origin) {
  const { customSites = [] } = await chrome.storage.local.get('customSites');
  if (!customSites.includes(origin)) customSites.push(origin);
  await chrome.storage.local.set({ customSites });
  await syncCustomScripts();
  return { ok: true };
}

async function unregisterCustomSite(origin) {
  const { customSites = [] } = await chrome.storage.local.get('customSites');
  await chrome.storage.local.set({ customSites: customSites.filter((o) => o !== origin) });
  await syncCustomScripts();
  await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => {});
  return { ok: true };
}
