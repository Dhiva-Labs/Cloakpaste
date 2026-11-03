import { withDefaults, BUILTIN_SITES } from '../core/settings.js';
import { TYPES, GROUPS, typeInfo } from '../core/types.js';

const $ = (id) => document.getElementById(id);
let settings = withDefaults();

async function load() {
  settings = withDefaults((await chrome.storage.local.get('settings')).settings);
}

let savedTimer = null;
async function save(patch) {
  settings = { ...settings, ...patch };
  await chrome.storage.local.set({ settings });
  $('saved').textContent = 'Saved';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($('saved').textContent = ''), 1500);
}

const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

function renderTypes() {
  const box = $('types');
  box.replaceChildren();
  for (const [group, title] of Object.entries(GROUPS)) {
    const types = Object.entries(TYPES).filter(([, t]) => t.group === group);
    if (!types.length) continue;
    const col = document.createElement('div');
    const h = document.createElement('h3');
    h.textContent = title;
    col.append(h);
    for (const [id, t] of types) {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = settings.types[id] !== false;
      cb.onchange = () => save({ types: { ...settings.types, [id]: cb.checked } });
      label.append(cb, document.createTextNode(t.label));
      col.append(label);
    }
    box.append(col);
  }
}

async function renderSites() {
  const box = $('sites');
  box.replaceChildren();
  for (const host of BUILTIN_SITES) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = settings.sites[host] !== false;
    cb.onchange = () => {
      const sites = { ...settings.sites };
      if (cb.checked) delete sites[host];
      else sites[host] = false;
      save({ sites });
    };
    label.append(cb, document.createTextNode(host));
    box.append(label);
  }
  const { customSites = [] } = await chrome.storage.local.get('customSites');
  const custom = $('custom-sites');
  custom.replaceChildren();
  for (const origin of customSites) {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.textContent = origin;
    const rm = document.createElement('button');
    rm.textContent = 'Remove';
    rm.className = 'danger';
    rm.onclick = async () => {
      await chrome.runtime.sendMessage({ type: 'pg:site:remove', origin });
      renderSites();
    };
    row.append(name, rm);
    custom.append(row);
  }
}

function renderForm() {
  $('model').checked = settings.model;
  $('highEntropy').checked = settings.highEntropy;
  $('restoreOnCopy').checked = settings.restoreOnCopy;
  $('customTerms').value = settings.customTerms.join('\n');
  $('allowlist').value = settings.allowlist.join('\n');
  for (const r of document.querySelectorAll('input[name=restoreMode]')) r.checked = r.value === settings.restoreMode;
}

function bindForm() {
  for (const id of ['model', 'highEntropy', 'restoreOnCopy']) {
    $(id).onchange = (e) => save({ [id]: e.target.checked });
  }
  for (const id of ['customTerms', 'allowlist']) {
    $(id).onchange = (e) => save({ [id]: lines(e.target.value) });
  }
  for (const r of document.querySelectorAll('input[name=restoreMode]')) {
    r.onchange = () => save({ restoreMode: r.value });
  }
}

// Render redacted output with placeholders styled as redaction bars.
function renderOutput(text) {
  const out = $('pg-output');
  out.replaceChildren();
  let last = 0;
  for (const m of text.matchAll(/\[([A-Z][A-Z0-9_]*_\d+)\]/g)) {
    out.append(text.slice(last, m.index));
    const ph = document.createElement('span');
    ph.className = 'ph';
    ph.textContent = m[1];
    out.append(ph);
    last = m.index + m[0].length;
  }
  out.append(text.slice(last));
  out.hidden = false;
}

async function runPlayground() {
  const btn = $('pg-run');
  btn.disabled = true;
  $('pg-meta').textContent = 'Checking…';
  const t0 = performance.now();
  const res = await chrome.runtime.sendMessage({ type: 'pg:redact', text: $('pg-input').value });
  btn.disabled = false;
  if (!res || res.error) {
    $('pg-meta').textContent = `Couldn't check the text: ${res?.error || 'no response'}`;
    return;
  }
  const ms = Math.round(performance.now() - t0);
  const model = res.model?.used ? `model ${res.model.ms} ms` : res.model?.error ? `model unavailable (${res.model.error})` : 'model off';
  $('pg-meta').textContent = `${res.items.length} hidden · ${ms} ms total · ${model}`;
  renderOutput(res.text);
  const list = $('pg-items');
  list.replaceChildren();
  const seen = new Set();
  for (const it of res.items) {
    if (seen.has(it.placeholder)) continue;
    seen.add(it.placeholder);
    const li = document.createElement('li');
    const ph = document.createElement('span');
    ph.className = 'ph';
    ph.textContent = it.placeholder.slice(1, -1);
    const val = document.createElement('span');
    val.className = 'mono';
    val.textContent = it.value;
    const src = document.createElement('span');
    src.className = 'src';
    src.textContent = `${typeInfo(it.type).label} · ${it.source === 'model' ? 'model' : it.source === 'vault' ? 'seen before' : 'pattern'}`;
    li.append(ph, val, src);
    list.append(li);
  }
}

await load();
if (location.hash === '#welcome') $('welcome').hidden = false;
renderTypes();
renderForm();
bindForm();
renderSites();
$('pg-run').onclick = runPlayground;
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && c.settings) settings = withDefaults(c.settings.newValue);
});
