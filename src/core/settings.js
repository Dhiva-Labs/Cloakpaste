import { TYPES } from './types.js';

// Sites Cloakpaste protects out of the box. Users can add more from the popup.
export const BUILTIN_SITES = [
  'chatgpt.com',
  'chat.openai.com',
  'claude.ai',
  'gemini.google.com',
  'aistudio.google.com',
  'copilot.microsoft.com',
  'www.perplexity.ai',
  'chat.deepseek.com',
  'chat.mistral.ai',
  'grok.com',
  'poe.com',
  'huggingface.co',
  'chat.qwen.ai',
  'www.meta.ai',
];

export const DEFAULT_SETTINGS = {
  enabled: true,
  // hostname -> false to switch a site off
  sites: {},
  // type -> boolean; missing means TYPES[type].enabled
  types: Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, v.enabled])),
  model: true,
  modelMaxChars: 50000,
  highEntropy: false,
  customTerms: [],
  allowlist: [],
  // 'highlight': mark placeholders in replies and show originals on hover
  // 'replace': swap originals into the page text (the site's scripts can read them)
  // 'off': leave replies alone
  restoreMode: 'highlight',
  restoreOnCopy: true,
  toastSeconds: 8,
};

export function withDefaults(stored = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    types: { ...DEFAULT_SETTINGS.types, ...(stored.types || {}) },
    sites: { ...(stored.sites || {}) },
  };
}

export function siteEnabled(settings, hostname) {
  return settings.enabled && settings.sites[hostname] !== false;
}
