import { withDefaults, siteEnabled, BUILTIN_SITES } from '../core/settings.js';
import { typeInfo } from '../core/types.js';
import { maskValue } from '../content/ui.js';

const $ = (id) => document.getElementById(id);

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getSettings() {
  return withDefaults((await chrome.storage.local.get('settings')).settings);
}

async function saveSettings(patch) {
  const s = await getSettings();
  await chrome.storage.local.set({ settings: { ...s, ...patch } });
}

async function render() {
  const settings = await getSettings();
  $('global').checked = settings.enabled;

  const tab = await currentTab();
  let url = null;
  try {
    url = new URL(tab?.url || '');
  } catch {}
  const web = url && /^https?:$/.test(url.protocol);
  $('host').textContent = web ? url.hostname : 'This page';

  const { customSites = [] } = await chrome.storage.local.get('customSites');
  const covered = web && (BUILTIN_SITES.includes(url.hostname) || customSites.includes(url.origin));
  $('site-switch').hidden = !covered;
  $('add-site').hidden = !web || covered;
  if (!web) $('status').textContent = "PasteGuard only works on web pages.";
  else if (!covered) $('status').textContent = 'Not protected. Add it if you use an AI tool here.';
  else if (!settings.enabled) $('status').textContent = 'PasteGuard is off everywhere.';
  else $('status').textContent = siteEnabled(settings, url.hostname) ? 'Pastes are checked before they land.' : 'Off for this site.';
  $('site').checked = covered && settings.sites[url.hostname] !== false;

  const origin = web ? url.origin : null;
  const key = `vault:${origin}`;
  const sess = origin ? await chrome.storage.session.get([key, 'stats']) : {};
  const entries = Object.entries(sess[key]?.entries || {}).sort((a, b) => b[1].at - a[1].at);
  const stats = sess.stats?.[origin];
  $('count').textContent = stats ? `${stats.items} in ${stats.pastes} paste${stats.pastes === 1 ? '' : 's'}` : '';
  $('empty').hidden = entries.length > 0;
  $('forget-all').hidden = entries.length === 0;

  const list = $('items');
  list.replaceChildren();
  for (const [k, e] of entries) {
    const li = document.createElement('li');
    const ph = document.createElement('span');
    ph.className = 'ph';
    ph.textContent = k;
    ph.title = typeInfo(e.type).label;
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = maskValue(e.value);
    const reveal = document.createElement('button');
    reveal.textContent = 'Show';
    reveal.onclick = () => {
      const shown = val.textContent === e.value;
      val.textContent = shown ? maskValue(e.value) : e.value;
      reveal.textContent = shown ? 'Show' : 'Hide';
    };
    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    copy.onclick = async () => {
      await navigator.clipboard.writeText(e.value);
      copy.textContent = 'Copied';
    };
    const forget = document.createElement('button');
    forget.textContent = 'Forget';
    forget.title = 'Remove from this browser. Replies that use this placeholder will no longer show the original.';
    forget.onclick = async () => {
      await chrome.runtime.sendMessage({ type: 'pg:vault:forget', origin, key: k });
      render();
    };
    li.append(ph, val, reveal, copy, forget);
    list.append(li);
  }

  $('forget-all').onclick = async () => {
    await chrome.runtime.sendMessage({ type: 'pg:vault:forget', origin });
    render();
  };

  $('add-site').onclick = async () => {
    const granted = await chrome.permissions.request({ origins: [`${url.origin}/*`] });
    if (!granted) return;
    await chrome.runtime.sendMessage({ type: 'pg:site:add', origin: url.origin });
    $('reload-note').hidden = false;
    render();
  };
}

$('global').addEventListener('change', (e) => saveSettings({ enabled: e.target.checked }).then(render));
$('site').addEventListener('change', async (e) => {
  const settings = await getSettings();
  const url = new URL((await currentTab()).url);
  const sites = { ...settings.sites };
  if (e.target.checked) delete sites[url.hostname];
  else sites[url.hostname] = false;
  await saveSettings({ sites });
  render();
});
$('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

render();
