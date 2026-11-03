// End-to-end tests: loads the built test extension into headless Chrome and
// pastes into a textarea, a plain contenteditable and a real ProseMirror
// editor, then checks reply highlighting, copy restore and the in-browser
// model. Run `npm run build:test` first.
//
//   CHROME=/path/to/chrome node tests/e2e/run.mjs [--shots dir]

import puppeteer from 'puppeteer-core';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtures = join(root, 'tests', 'e2e', 'fixtures');
const extPath = join(root, 'dist', 'extension');
const shotsIdx = process.argv.indexOf('--shots');
const shots = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
// The theme ignores the system setting; --light checks that it really does.
const light = process.argv.includes('--light');
const scheme = (p) => light && p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
if (shots) await mkdir(shots, { recursive: true });

// Synthetic secrets only; none of these are real.
const SECRET_TEXT = [
  "Hi, ping John O'Neill (john.oneill@acme.io, +44 20 7946 0958) about the review.",
  'Priya Raman from Chennai owns the rollout.',
  'OPENAI_API_KEY=sk-proj-Q8m2N4b7X1c9V3z5K6j0L2p4R7t9W1y3',
  'Card 4111 1111 1111 1111',
].join('\n');
const RAW_VALUES = ['john.oneill@acme.io', '+44 20 7946 0958', 'sk-proj-Q8m2N4b7X1c9V3z5K6j0L2p4R7t9W1y3', '4111 1111 1111 1111', 'Priya Raman'];

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
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const profile = await mkdtemp(join(tmpdir(), 'pasteguard-e2e-'));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true,
  pipe: true,
  enableExtensions: [extPath],
  userDataDir: profile,
  // Isolated from the desktop session: no display, no session bus.
  env: { HOME: profile, PATH: process.env.PATH, LANG: 'en_US.UTF-8' },
  args: ['--no-first-run', '--no-default-browser-check', '--window-size=1100,800'],
});

const errors = [];
const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ok  ${name} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  FAIL ${name}\n       ${String(err?.message || err).split('\n').join('\n       ')}`);
  }
}

try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('service-worker.js'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  const sw = await swTarget.worker();
  sw.on('console', (m) => m.type() === 'error' && errors.push(`[sw] ${m.text()}`));
  await browser.defaultBrowserContext().overridePermissions(ORIGIN, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);

  // The install hook opens the welcome page; close it.
  await new Promise((r) => setTimeout(r, 800));
  for (const p of await browser.pages()) if (p.url().includes('options.html')) await p.close();

  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[page] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[page] ${e.message}`));
  await scheme(page);
  await page.goto(ORIGIN + '/');
  await page.bringToFront();
  const cdp = await page.createCDPSession();

  const setClipboard = async (text) => {
    await page.bringToFront();
    await page.evaluate((t) => navigator.clipboard.writeText(t), text);
  };
  const getClipboard = () => page.evaluate(() => navigator.clipboard.readText());
  const pasteInto = async (selector) => {
    await page.click(selector);
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyV');
    await page.keyboard.up('Control');
  };

  // Click a button inside PasteGuard's closed shadow root by its label.
  async function clickShadowButton(label) {
    const { root: doc } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const stack = [doc];
    let found = null;
    while (stack.length && !found) {
      const n = stack.pop();
      if (n.nodeName === 'BUTTON' && n.children?.some((c) => c.nodeValue === label)) found = n;
      for (const k of [...(n.children || []), ...(n.shadowRoots || [])]) stack.push(k);
    }
    if (!found) throw new Error(`button "${label}" not found in shadow UI`);
    const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: found.backendNodeId });
    const [x1, y1, , , x3, y3] = model.content;
    await page.mouse.click((x1 + x3) / 2, (y1 + y3) / 2);
  }

  async function shadowText() {
    const { root: doc } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const out = [];
    const walk = (n, inside) => {
      const here = inside || n.nodeName === 'PASTEGUARD-UI';
      if (here && n.nodeType === 3) out.push(n.nodeValue);
      for (const k of [...(n.children || []), ...(n.shadowRoots || [])]) walk(k, here);
    };
    walk(doc, false);
    return out.join(' ');
  }

  console.log(`PasteGuard e2e on Chrome ${await browser.version()} (extension ${extId})`);

  await test('textarea paste is redacted', async () => {
    await setClipboard(SECRET_TEXT);
    await pasteInto('#ta');
    await page.waitForFunction(() => document.querySelector('#ta').value.includes('[EMAIL_'), { timeout: 20000 });
    const v = await page.$eval('#ta', (el) => el.value);
    for (const raw of RAW_VALUES) assert.ok(!v.includes(raw), `raw value leaked: ${raw}\n${v}`);
    assert.match(v, /\[PERSON_\d+\]/, 'model should hide names');
    assert.match(v, /\[API_KEY_1\]/);
    assert.match(v, /\[CARD_1\]/);
    assert.equal(v.split('\n').length, 4, 'line structure kept');
    const toast = await shadowText();
    assert.match(toast, /Hid \d+ items before pasting/);
    if (shots) await page.screenshot({ path: join(shots, 'e2e-textarea-toast.png') });
  });

  await test('same value gets the same placeholder across pastes', async () => {
    const before = await page.$eval('#ta', (el) => el.value);
    const email = before.match(/\[EMAIL_\d+\]/)[0];
    await page.$eval('#ta', (el) => (el.value = ''));
    await setClipboard('Reply to john.oneill@acme.io today');
    await pasteInto('#ta');
    await page.waitForFunction(() => document.querySelector('#ta').value.includes('[EMAIL_'), { timeout: 10000 });
    assert.equal(await page.$eval('#ta', (el) => el.value), `Reply to ${email} today`);
  });

  await test('ProseMirror paste is redacted and keeps paragraphs', async () => {
    await setClipboard(SECRET_TEXT);
    await pasteInto('#pm .ProseMirror');
    await page.waitForFunction(() => window.pmText().includes('[EMAIL_'), { timeout: 10000 });
    const v = await page.evaluate(() => window.pmText());
    for (const raw of RAW_VALUES) assert.ok(!v.includes(raw), `raw value leaked: ${raw}\n${v}`);
    assert.equal(v.split('\n').length, 4, `expected 4 paragraphs, got:\n${v}`);
  });

  await test('"Paste original" swaps ProseMirror text back', async () => {
    await clickShadowButton('Paste original');
    await page.waitForFunction(() => window.pmText().includes('john.oneill@acme.io'), { timeout: 5000 });
    const v = await page.evaluate(() => window.pmText());
    assert.ok(!v.includes('[EMAIL_'), `placeholders should be gone:\n${v}`);
    assert.equal(v.trim(), SECRET_TEXT);
  });

  await test('plain contenteditable paste is redacted', async () => {
    await setClipboard('mail me at priya.raman@example.org');
    await pasteInto('#ce');
    await page.waitForFunction(() => document.querySelector('#ce').innerText.includes('[EMAIL_'), { timeout: 10000 });
    assert.ok(!(await page.$eval('#ce', (el) => el.innerText)).includes('priya.raman@example.org'));
  });

  await test('clean text pastes through unchanged', async () => {
    await page.$eval('#ta', (el) => (el.value = ''));
    const clean = 'const total = items.reduce((a, b) => a + b.price, 0);';
    await setClipboard(clean);
    await pasteInto('#ta');
    await page.waitForFunction((c) => document.querySelector('#ta').value === c, { timeout: 10000 }, clean);
  });

  await test('placeholders in replies are highlighted', async () => {
    await page.$eval('#reply', (el) => (el.textContent = 'Sure. I drafted a note to [EMAIL_1] and rotated [API_KEY_1].'));
    await page.waitForFunction(() => CSS.highlights.has('pasteguard') && CSS.highlights.get('pasteguard').size >= 2, { timeout: 5000 });
  });

  await test('hovering a placeholder shows the original in the tooltip', async () => {
    const box = await page.evaluate(() => {
      const t = document.querySelector('#reply').firstChild;
      const i = t.nodeValue.indexOf('[EMAIL_1]');
      const r = document.createRange();
      r.setStart(t, i + 2);
      r.setEnd(t, i + 3);
      const b = r.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    await page.mouse.move(box.x - 50, box.y + 40);
    await page.mouse.move(box.x, box.y, { steps: 4 });
    await new Promise((r) => setTimeout(r, 300));
    const ui = await shadowText();
    assert.match(ui, /john\.oneill@acme\.io/, `tooltip text was: ${ui}`);
    if (shots) await page.screenshot({ path: join(shots, 'e2e-reply-tooltip.png') });
    assert.ok(!(await page.$eval('#reply', (el) => el.textContent)).includes('john.oneill'), 'original must not enter the page DOM');
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
    await new Promise((r) => setTimeout(r, 200));
    const clip = await getClipboard();
    assert.equal(clip, 'Sure. I drafted a note to john.oneill@acme.io and rotated sk-proj-Q8m2N4b7X1c9V3z5K6j0L2p4R7t9W1y3.');
  });

  await test('playground runs the model inside the extension', async () => {
    const opt = await browser.newPage();
    opt.on('pageerror', (e) => errors.push(`[options] ${e.message}`));
    await scheme(opt);
    await opt.goto(`chrome-extension://${extId}/src/options/options.html`);
    await opt.click('#pg-run');
    await opt.waitForFunction(() => /hidden/.test(document.querySelector('#pg-meta').textContent), { timeout: 20000 });
    const meta = await opt.$eval('#pg-meta', (el) => el.textContent);
    assert.match(meta, /model \d+ ms/, `model not used: ${meta}`);
    const out = await opt.$eval('#pg-output', (el) => el.textContent);
    assert.match(out, /PERSON_1/);
    assert.match(out, /LOCATION_1/);
    assert.ok(!out.includes('Priya Raman'));
    if (shots) {
      await opt.setViewport({ width: 900, height: 1100 });
      await opt.screenshot({ path: join(shots, 'e2e-playground.png'), fullPage: true });
    }
    console.log(`       ${meta}`);
    await opt.close();
  });

  await test('switching the site off lets pastes through', async () => {
    await sw.evaluate(async (host) => {
      const { settings } = await chrome.storage.local.get('settings');
      settings.sites[host] = false;
      await chrome.storage.local.set({ settings });
    }, '127.0.0.1');
    await new Promise((r) => setTimeout(r, 200));
    await page.$eval('#ta', (el) => (el.value = ''));
    await setClipboard('contact john.oneill@acme.io');
    await pasteInto('#ta');
    await page.waitForFunction(() => document.querySelector('#ta').value === 'contact john.oneill@acme.io', { timeout: 5000 });
  });

  await test('no errors in extension or page consoles', async () => {
    assert.deepEqual(errors, []);
  });
} finally {
  await browser.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
