// Renders Chrome Web Store assets into store-assets/: three 1280x800
// screenshots with captions, a 440x280 promo tile and a 1400x560 marquee.
// Needs `npm run build:test` first (the demo page is served from 127.0.0.1).
import puppeteer from 'puppeteer-core';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'tests', 'e2e', 'fixtures');
const out = join(root, 'store-assets');
await mkdir(out, { recursive: true });
await build({ entryPoints: [join(fixtures, 'pm-editor.js')], bundle: true, outfile: join(fixtures, 'pm.bundle.js'), logLevel: 'warning' });

const server = createServer(async (req, res) => {
  try {
    const p = join(fixtures, new URL(req.url, 'http://x').pathname);
    res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript' }[extname(p)] || 'text/plain' });
    res.end(await readFile(p));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'pasteguard-shots-'));
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME || '/usr/bin/google-chrome',
  headless: true,
  pipe: true,
  enableExtensions: [join(root, 'dist', 'extension')],
  userDataDir: profile,
  env: { HOME: profile, PATH: process.env.PATH, LANG: 'en_US.UTF-8' },
  args: ['--no-first-run', '--no-default-browser-check', '--hide-scrollbars'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Synthetic people and keys only.
const PASTE = [
  'Hi Priya Raman, following up on the outage at our Chennai office.',
  'Reach me at arjun.mehta@northwind.dev or +91 98765 43210.',
  'Staging key for the repro: STRIPE_SECRET=sk_' + 'test_Q8m2N4b7X1c9V3z5K6j0L2p4',
  'DB: postgres://admin:S3cr3tPass@10.20.4.17:5432/billing',
].join('\n');

try {
  const sw = await browser.waitForTarget((t) => t.type() === 'service_worker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  await browser.defaultBrowserContext().overridePermissions(ORIGIN, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']);
  await sleep(800);
  for (const p of await browser.pages()) if (p.url().includes('options.html')) await p.close();

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${ORIGIN}/demo-chat.html`);
  const cdp = await page.createCDPSession();
  async function clickShadow(label) {
    const { root: doc } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const stack = [doc];
    while (stack.length) {
      const n = stack.pop();
      if (n.nodeName === 'BUTTON' && n.children?.some((c) => c.nodeValue === label)) {
        const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: n.backendNodeId });
        await page.mouse.click((model.content[0] + model.content[4]) / 2, (model.content[1] + model.content[5]) / 2);
        return;
      }
      stack.push(...(n.children || []), ...(n.shadowRoots || []));
    }
  }

  // 1. Paste with private data -> redacted, toast with details.
  await page.evaluate(() => {
    document.getElementById('log').innerHTML =
      '<div class="msg ai">Sure. Paste the incident notes and I’ll draft a reply to the customer.</div>';
  });
  await page.bringToFront();
  await page.evaluate((t) => navigator.clipboard.writeText(t), PASTE);
  await page.click('#pm .ProseMirror');
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyV');
  await page.keyboard.up('Control');
  await page.waitForFunction(() => window.pmText().includes('[EMAIL_'), { timeout: 30000 });
  await clickShadow('Details');
  await sleep(400);
  await page.mouse.move(640, 300);
  await page.screenshot({ path: join(out, 'raw-1-paste.png') });

  // 2. Reply that uses placeholders -> highlight + tooltip with the original.
  await clickShadow('×');
  const sent = await page.evaluate(() => window.pmText());
  await page.evaluate((sentText) => {
    const reply = 'Here’s a draft:\n\nHi [PERSON_1],\n\nThanks for flagging the issue at [LOCATION_1]. I’ve rotated the staging key and reset the database password. You can reach me at [EMAIL_1] or [PHONE_1] if anything else comes up.\n\nBest,\nArjun';
    document.getElementById('log').innerHTML = '';
    for (const [cls, text] of [['me', sentText], ['ai', reply]]) {
      const d = document.createElement('div');
      d.className = 'msg ' + cls;
      if (cls === 'me') {
        const b = document.createElement('div');
        b.textContent = text;
        d.append(b);
      } else d.textContent = text;
      document.getElementById('log').append(d);
    }
  }, sent);
  await page.evaluate(() => window.pmClear?.());
  await sleep(700);
  const box = await page.evaluate(() => {
    const ai = document.querySelector('.msg.ai');
    const walker = document.createTreeWalker(ai, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.nodeValue.indexOf('[PERSON_1]');
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i + 2);
        r.setEnd(n, i + 3);
        const b = r.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      }
    }
  });
  await page.mouse.move(box.x - 40, box.y + 30);
  await page.mouse.move(box.x, box.y, { steps: 5 });
  await sleep(400);
  await page.screenshot({ path: join(out, 'raw-2-reply.png') });

  // 3. Settings playground.
  const opt = await browser.newPage();
  await opt.setViewport({ width: 1280, height: 800 });
  await opt.goto(`chrome-extension://${extId}/src/options/options.html`);
  await opt.click('#pg-run');
  await opt.waitForFunction(() => /hidden/.test(document.querySelector('#pg-meta').textContent), { timeout: 30000 });
  await opt.evaluate(() => window.scrollTo(0, 0));
  await opt.screenshot({ path: join(out, 'raw-3-playground.png') });

  // Caption frames, promo tile and marquee, drawn in the extension palette.
  const icon = (await readFile(join(root, 'icons', 'icon128.png'))).toString('base64');
  const frame = await browser.newPage();
  const css = `body{margin:0;background:#010102;color:#F1EDFD;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
    .chip{background:#AD96F1;color:#010102;border-radius:5px;padding:1px 8px;font-family:ui-monospace,Menlo,monospace}
    .mint{color:#58F6B1}`;
  const shots = [
    ['raw-1-paste.png', 'screenshot-1.png', 'Hides private data <span class="mint">as you paste</span>', 'Names, emails, keys and passwords become placeholders before they reach the chat.'],
    ['raw-2-reply.png', 'screenshot-2.png', 'See the originals <span class="mint">only you can see</span>', 'Hover a placeholder in the reply. The site never gets the real value.'],
    ['raw-3-playground.png', 'screenshot-3.png', 'Runs <span class="mint">fully on your device</span>', 'A 29 MB model in the browser. No servers, no accounts, no tracking.'],
  ];
  for (const [raw, name, title, sub] of shots) {
    const img = (await readFile(join(out, raw))).toString('base64');
    await frame.setViewport({ width: 1280, height: 800 });
    await frame.setContent(`<style>${css}
      .wrap{height:800px;display:flex;flex-direction:column;align-items:center;padding-top:34px}
      h1{font-size:34px;font-weight:600;margin:0}p{margin:8px 0 22px;font-size:17px;color:rgba(241,237,253,.7)}
      img{width:1040px;border-radius:12px;border:1px solid rgba(241,237,253,.18);box-shadow:0 20px 60px rgba(0,0,0,.5)}</style>
      <div class="wrap"><h1>${title}</h1><p>${sub}</p><img src="data:image/png;base64,${img}"></div>`);
    await frame.screenshot({ path: join(out, name) });
    await rm(join(out, raw));
  }
  const promo = (w, h, big) => `<style>${css}
      .wrap{width:${w}px;height:${h}px;display:flex;align-items:center;gap:${big ? 40 : 18}px;padding:0 ${big ? 90 : 28}px;box-sizing:border-box}
      img{width:${big ? 150 : 76}px;height:${big ? 150 : 76}px}
      h1{margin:0;font-size:${big ? 64 : 30}px;font-weight:700}
      p{margin:${big ? 10 : 4}px 0 ${big ? 22 : 12}px;font-size:${big ? 26 : 14}px;color:rgba(241,237,253,.75)}
      .line{font-size:${big ? 22 : 12}px;color:rgba(241,237,253,.9)}</style>
      <div class="wrap"><img src="data:image/png;base64,${icon}"><div>
      <h1>PasteGuard</h1><p>Hide secrets before you paste into <span class="mint">AI chats</span></p>
      <div class="line">ping <span class="chip">PERSON_1</span> at <span class="chip">EMAIL_1</span></div></div></div>`;
  await frame.setViewport({ width: 440, height: 280 });
  await frame.setContent(promo(440, 280, false));
  await frame.screenshot({ path: join(out, 'promo-small-440x280.png') });
  await frame.setViewport({ width: 1400, height: 560 });
  await frame.setContent(promo(1400, 560, true));
  await frame.screenshot({ path: join(out, 'promo-marquee-1400x560.png') });
  console.log(`Store assets written to ${out}`);
} finally {
  await browser.close();
  server.close();
  await rm(profile, { recursive: true, force: true });
}
