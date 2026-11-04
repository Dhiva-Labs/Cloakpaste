// Firefox end-to-end tests: loads the Firefox test build into headless
// Firefox over WebDriver BiDi and checks the paths that differ from Chrome:
// the model in a background-page iframe, the vault handed to content scripts
// by message, sites added through permissions.onAdded, and the extension
// pages. Run `node scripts/build.mjs --firefox --test` first.
//
//   FIREFOX=/path/to/firefox node tests/e2e/firefox.mjs
//
// Checked on Firefox 157. On 140 ESR everything but the "Protect this site"
// test runs; its WebDriver BiDi can't reach the parent process (grantOrigin).

import puppeteer from 'puppeteer-core';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

if (!process.env.FIREFOX) {
  console.error('Set FIREFOX to a Firefox binary, e.g. one unpacked from an official tarball.');
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtures = join(root, 'tests', 'e2e', 'fixtures');
const extPath = join(root, 'dist', 'firefox');
const ID = 'pasteguard@dhiva-labs';
const UUID = '0b6a3c58-7c39-4a8e-9f0e-5a3f1d2c9e41';
const EXT = `moz-extension://${UUID}`;

// Synthetic secrets only; none of these are real.
const SECRET_TEXT = [
  "Hi, ping John O'Neill (john.oneill@acme.io, +44 20 7946 0958) about the review.",
  'Priya Raman from Chennai owns the rollout.',
  'Card 4111 1111 1111 1111',
].join('\n');
const RAW_VALUES = ['john.oneill@acme.io', '+44 20 7946 0958', '4111 1111 1111 1111', 'Priya Raman'];

await build({ entryPoints: [join(fixtures, 'pm-editor.js')], bundle: true, outfile: join(fixtures, 'pm.bundle.js'), logLevel: 'warning' });

const server = createServer(async (req, res) => {
  const path = join(fixtures, new URL(req.url, 'http://x').pathname.replace(/^\/$/, '/index.html'));
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript' }[extname(path)] || 'text/plain' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const ORIGIN = `http://127.0.0.1:${PORT}`;
// A second origin that only "Protect this site" covers.
const OTHER = `http://localhost:${PORT}`;

const IDLE_MS = 8000;
const home = await mkdtemp(join(tmpdir(), 'cloakpaste-ff-'));
const browser = await puppeteer.launch({
  browser: 'firefox',
  executablePath: process.env.FIREFOX,
  headless: true,
  // WebDriver may only open moz-extension:// pages (and reach the parent
  // process, see grantOrigin) with this flag.
  args: ['--remote-allow-system-access'],
  // Isolated from the desktop session: no display, no session bus.
  env: { HOME: home, TMPDIR: home, PATH: process.env.PATH, LANG: 'en_US.UTF-8' },
  extraPrefsFirefox: {
    'extensions.webextensions.uuids': JSON.stringify({ [ID]: UUID }),
    // Clipboard access without a real user gesture (headless clipboard only).
    'dom.events.testing.asyncClipboard': true,
    // Extension errors (background page included) go to stdout.
    'devtools.console.stdout.content': true,
    // Suspend the idle background page sooner than the default 30 s.
    'extensions.background.idle.timeout': IDLE_MS,
  },
});

const errors = [];
const watch = (stream) =>
  stream.on('data', (d) => {
    for (const line of String(d).split('\n')) {
      if ((line.includes(UUID) && /error/i.test(line)) || line.startsWith('console.error:')) errors.push(`[firefox] ${line.trim()}`);
    }
  });
watch(browser.process().stdout);
watch(browser.process().stderr);

const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok  ${name} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  FAIL ${name}\n       ${String(err?.message || err).split('\n').join('\n       ')}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const track = (p, tag) => {
  p.on('console', (m) => m.type() === 'error' && errors.push(`[${tag}] ${m.text()}`));
  p.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`));
  return p;
};

try {
  await browser.installExtension(extPath);
  // Puppeteer doesn't see navigations inside extension pages (they stay
  // "about:blank" to it, though evaluate works), so ask the page itself.
  const where = (p) => p.evaluate(() => `${location.href} ${document.readyState}`).catch(() => '');
  // Grants a host permission the way Firefox does once the user accepts the
  // permission prompt (headless can't click it). Runs in the parent process.
  async function grantOrigin(origin) {
    const { contexts } = (await browser.connection.send('browsingContext.getTree', { 'moz:scope': 'chrome' })).result;
    const { result } = await browser.connection.send('script.evaluate', {
      expression: `(async () => {
        const { ExtensionPermissions } = ChromeUtils.importESModule('resource://gre/modules/ExtensionPermissions.sys.mjs');
        const { extension } = WebExtensionPolicy.getByID(${JSON.stringify(ID)});
        await ExtensionPermissions.add(extension.id, { permissions: [], origins: [${JSON.stringify(origin)}] }, extension);
        return 'ok';
      })()`,
      target: { context: contexts[0].context },
      awaitPromise: true,
    });
    assert.equal(result.result?.value, 'ok', JSON.stringify(result));
  }
  // waitForFunction for extension pages, which older Firefox can't run there.
  async function until(p, fn, arg, ms = 5000) {
    for (const end = Date.now() + ms; !(await p.evaluate(fn, arg)); await sleep(100)) {
      if (Date.now() > end) throw new Error(`timed out: ${fn}`);
    }
  }
  const openExtPage = async (path, tag) => {
    const p = track(await browser.newPage(), tag);
    p.goto(EXT + path, { timeout: 0 }).catch(() => {}); // never settles; see above
    for (let i = 0; (await where(p)) !== `${EXT + path} complete`; i++) {
      if (i > 100) throw new Error(`${path} did not load`);
      await sleep(100);
    }
    return p;
  };
  // The install hook opens the welcome page; close it.
  await sleep(1500);
  for (const p of await browser.pages()) if ((await where(p)).includes('options.html#welcome')) await p.close();
  // An extension page for poking at storage and asking the runtime.
  const ext = await openExtPage('/src/popup/popup.html', 'ext');

  console.log(`Cloakpaste e2e on ${await browser.version()}`);
  const page = track(await browser.newPage(), 'page');
  await page.goto(ORIGIN + '/');

  const setClipboard = (text) => page.evaluate((t) => navigator.clipboard.writeText(t), text);
  const getClipboard = () => page.evaluate(() => navigator.clipboard.readText());
  const pasteInto = async (p, selector) => {
    await p.bringToFront();
    await p.click(selector);
    await p.keyboard.down('Control');
    await p.keyboard.press('KeyV');
    await p.keyboard.up('Control');
  };

  await test('textarea paste is redacted, names by the model', async () => {
    await setClipboard(SECRET_TEXT);
    const t0 = Date.now();
    await pasteInto(page, '#ta');
    await page.waitForFunction(() => document.querySelector('#ta').value.includes('[EMAIL_'), { timeout: 30000 });
    console.log(`       first paste (model load included) ${Date.now() - t0} ms`);
    const v = await page.$eval('#ta', (el) => el.value);
    for (const raw of RAW_VALUES) assert.ok(!v.includes(raw), `raw value leaked: ${raw}\n${v}`);
    assert.match(v, /\[PERSON_\d+\]/, 'model should hide names');
    assert.match(v, /\[CARD_1\]/);
    assert.equal(v.split('\n').length, 3, 'line structure kept');
    console.log(`       ${v.split('\n').join('\n       ')}`);
  });

  await test('same value gets the same placeholder across pastes', async () => {
    const before = await page.$eval('#ta', (el) => el.value);
    const email = before.match(/\[EMAIL_\d+\]/)[0];
    await page.$eval('#ta', (el) => (el.value = ''));
    await setClipboard('Reply to john.oneill@acme.io today');
    await pasteInto(page, '#ta');
    await page.waitForFunction(() => document.querySelector('#ta').value.includes('[EMAIL_'), { timeout: 10000 });
    assert.equal(await page.$eval('#ta', (el) => el.value), `Reply to ${email} today`);
  });

  await test('ProseMirror paste is redacted and keeps paragraphs', async () => {
    await setClipboard(SECRET_TEXT);
    await pasteInto(page, '#pm .ProseMirror');
    await page.waitForFunction(() => window.pmText().includes('[EMAIL_'), { timeout: 10000 });
    const v = await page.evaluate(() => window.pmText());
    for (const raw of RAW_VALUES) assert.ok(!v.includes(raw), `raw value leaked: ${raw}\n${v}`);
    assert.equal(v.split('\n').length, 3, `expected 3 paragraphs, got:\n${v}`);
  });

  await test('plain contenteditable paste is redacted', async () => {
    await setClipboard('mail me at priya.raman@example.org');
    await pasteInto(page, '#ce');
    await page.waitForFunction(() => document.querySelector('#ce').innerText.includes('[EMAIL_'), { timeout: 10000 });
    assert.ok(!(await page.$eval('#ce', (el) => el.innerText)).includes('priya.raman@example.org'));
  });

  await test('placeholders in replies are highlighted (vault reached the page)', async () => {
    await page.$eval('#reply', (el) => (el.textContent = 'Sure. I drafted a note to [EMAIL_1] about [CARD_1].'));
    await page.waitForFunction(() => CSS.highlights.has('pasteguard') && CSS.highlights.get('pasteguard').size >= 2, { timeout: 5000 });
  });

  await test('copying a reply restores originals on the clipboard', async () => {
    await page.evaluate(() => {
      document.activeElement?.blur();
      const r = document.createRange();
      r.selectNodeContents(document.querySelector('#reply'));
      getSelection().removeAllRanges();
      getSelection().addRange(r);
    });
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyC');
    await page.keyboard.up('Control');
    await sleep(300);
    const clip = await getClipboard();
    assert.equal(clip, 'Sure. I drafted a note to john.oneill@acme.io about 4111 1111 1111 1111.');
    console.log(`       clipboard: ${clip}`);
  });

  await test('popup page loads and lists nothing for a non-web tab', async () => {
    const popup = await openExtPage('/src/popup/popup.html', 'popup');
    await until(popup, () => document.querySelector('#status').textContent.length > 0);
    assert.match(await popup.$eval('#status', (el) => el.textContent), /only works on web pages/);
    await popup.close();
  });

  await test('options playground runs the model', async () => {
    const opt = await openExtPage('/src/options/options.html', 'options');
    // Input actions aren't allowed in extension pages; click from script.
    await opt.$eval('#pg-run', (el) => el.click());
    await until(opt, () => /hidden/.test(document.querySelector('#pg-meta').textContent), null, 30000);
    const meta = await opt.$eval('#pg-meta', (el) => el.textContent);
    assert.match(meta, /model \d+ ms/, `model not used: ${meta}`);
    const out = await opt.$eval('#pg-output', (el) => el.textContent);
    assert.match(out, /PERSON_1/);
    assert.ok(!out.includes('Priya Raman'));
    console.log(`       ${meta}`);

    // Forgetting from an extension page reaches the open tab.
    await opt.evaluate((origin) => chrome.runtime.sendMessage({ type: 'pg:vault:forget', origin }), ORIGIN);
    await page.waitForFunction(() => !CSS.highlights.has('pasteguard'), { timeout: 5000 });
    await opt.close();
  });

  await test('"Protect this site" registers a new origin via permissions.onAdded', async () => {
    // What the popup does before its permission request, then what the
    // prompt's Allow button does. The popup's own follow-up message is left
    // out, as if Firefox had closed the popup when the prompt opened.
    await ext.evaluate((origin) => chrome.storage.session.set({ pendingSite: origin }), OTHER);
    // Firefox patterns can't carry a port, so the popup asks for the host.
    await grantOrigin('http://localhost/*');
    await until(ext, async (origin) => (await chrome.storage.local.get('customSites')).customSites?.includes(origin), OTHER);
    const scripts = await ext.evaluate(() => chrome.scripting.getRegisteredContentScripts());
    assert.deepEqual(scripts.map((c) => c.matches), [['http://localhost/*']]);

    const other = track(await browser.newPage(), 'other');
    await other.goto(OTHER + '/');
    await other.evaluate(() => navigator.clipboard.writeText('contact john.oneill@acme.io'));
    await pasteInto(other, '#ta');
    await other.waitForFunction(() => document.querySelector('#ta').value.includes('[EMAIL_'), { timeout: 10000 });
    await other.close();
  });

  await test('pastes still work after the idle background page is suspended', async () => {
    // Forget first, so only the model can find the name below.
    await ext.evaluate((origin) => chrome.runtime.sendMessage({ type: 'pg:vault:forget', origin }), ORIGIN);
    const running = () => ext.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ['BACKGROUND'] })).length);
    const t0 = Date.now();
    while ((await running()) && Date.now() - t0 < IDLE_MS * 3) await sleep(500);
    assert.equal(await running(), 0, 'background page should have been suspended');
    console.log(`       suspended after ${Date.now() - t0} ms idle`);
    await page.$eval('#ta', (el) => (el.value = ''));
    await setClipboard('Ask Priya Raman, not john.oneill@acme.io');
    const t1 = Date.now();
    await pasteInto(page, '#ta');
    await page.waitForFunction(() => document.querySelector('#ta').value.includes('[EMAIL_'), { timeout: 30000 });
    const v = await page.$eval('#ta', (el) => el.value);
    assert.match(v, /^Ask \[PERSON_\d+\], not \[EMAIL_\d+\]$/, v);
    console.log(`       ${v} (${Date.now() - t1} ms, model reloaded)`);
  });

  await test('switching the site off lets pastes through', async () => {
    await ext.evaluate(async (host) => {
      const { settings } = await chrome.storage.local.get('settings');
      settings.sites[host] = false;
      await chrome.storage.local.set({ settings });
    }, '127.0.0.1');
    await sleep(200);
    await page.$eval('#ta', (el) => (el.value = ''));
    await setClipboard('contact john.oneill@acme.io');
    await pasteInto(page, '#ta');
    await page.waitForFunction(() => document.querySelector('#ta').value === 'contact john.oneill@acme.io', { timeout: 5000 });
  });

  await test('no errors in extension or page consoles', async () => {
    await sleep(300);
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  server.close();
  await rm(home, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
