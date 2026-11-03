// Shows originals behind placeholders in the page.
//
// Default ("highlight") never writes originals into the page: placeholders
// are marked with the CSS Custom Highlight API (no DOM changes, so React and
// ProseMirror are unaffected) and the original appears in PasteGuard's own
// closed-shadow tooltip on hover. "replace" mode swaps the text in place,
// which is friendlier to read but lets the site's scripts see the originals.

const HIGHLIGHT = 'pasteguard';
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'PASTEGUARD-UI']);
const MAYBE_PLACEHOLDER = /[A-Z]_\d/;

export function createRestorer({ getVault, getSettings, ui }) {
  const canHighlight = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
  /** @type {Array<{ range: Range, node: Text, start: number, end: number, key: string, entry: object }>} */
  let hits = [];
  let timer = null;
  let lastRun = 0;
  let observer = null;

  function injectStyle() {
    if (document.getElementById('pasteguard-highlight')) return;
    const s = document.createElement('style');
    s.id = 'pasteguard-highlight';
    s.textContent = `::highlight(${HIGHLIGHT}) { background-color: #F2C200; color: #161513; }`;
    (document.head || document.documentElement).append(s);
  }

  function textNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
        return MAYBE_PLACEHOLDER.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      },
    });
    const out = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n);
    return out;
  }

  function scan() {
    lastRun = performance.now();
    const vault = getVault();
    const mode = getSettings().restoreMode;
    hits = [];
    if (mode === 'off' || !vault.size || !document.body) {
      if (canHighlight) CSS.highlights.delete(HIGHLIGHT);
      return;
    }
    for (const node of textNodes(document.body)) {
      const found = vault.findPlaceholders(node.nodeValue);
      if (!found.length) continue;
      const editable = node.parentElement.isContentEditable;
      if (mode === 'replace' && !editable) {
        // Never in the composer: that text is about to be sent.
        node.nodeValue = vault.restore(node.nodeValue);
        continue;
      }
      for (const f of found) {
        const range = document.createRange();
        range.setStart(node, f.start);
        range.setEnd(node, f.end);
        hits.push({ range, node, start: f.start, end: f.end, key: f.key, entry: f.entry });
      }
    }
    if (canHighlight) {
      if (hits.length) {
        injectStyle();
        CSS.highlights.set(HIGHLIGHT, new Highlight(...hits.map((h) => h.range)));
      } else {
        CSS.highlights.delete(HIGHLIGHT);
      }
    }
  }

  // Replies stream in token by token; batch the work.
  function schedule() {
    if (timer) return;
    const wait = Math.max(0, 300 - (performance.now() - lastRun));
    timer = setTimeout(() => {
      timer = null;
      scan();
    }, wait);
  }

  function caretAt(x, y) {
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      return p && { node: p.offsetNode, offset: p.offset };
    }
    const r = document.caretRangeFromPoint?.(x, y);
    return r && { node: r.startContainer, offset: r.startOffset };
  }

  let moveQueued = false;
  function onMove(e) {
    if (!hits.length || moveQueued) return;
    moveQueued = true;
    requestAnimationFrame(() => {
      moveQueued = false;
      const c = caretAt(e.clientX, e.clientY);
      const hit = c && hits.find((h) => h.node === c.node && c.offset >= h.start && c.offset <= h.end);
      if (hit) {
        const rect = [...hit.range.getClientRects()].find(
          (r) => e.clientX >= r.left - 2 && e.clientX <= r.right + 2 && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2,
        );
        if (rect) {
          ui.showTip(rect, hit);
          return;
        }
      }
      ui.hideTip();
    });
  }

  function selectedText() {
    const a = document.activeElement;
    const field = a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && typeof a.selectionStart === 'number');
    if (field && a.selectionStart !== a.selectionEnd) {
      return { text: a.value.slice(a.selectionStart, a.selectionEnd), field: true };
    }
    const sel = getSelection();
    return { text: sel ? sel.toString() : '', field: false };
  }

  // Copying a reply puts the originals on the clipboard, so the code or email
  // the AI wrote is ready to use.
  function onCopy(e) {
    if (!getSettings().restoreOnCopy || !e.clipboardData) return;
    const vault = getVault();
    if (!vault.size) return;
    const { text, field } = selectedText();
    if (!text || !vault.findPlaceholders(text).length) return;
    e.clipboardData.setData('text/plain', vault.restore(text));
    const sel = getSelection();
    if (!field && sel?.rangeCount) {
      const box = document.createElement('div');
      box.append(sel.getRangeAt(0).cloneContents());
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) n.nodeValue = vault.restore(n.nodeValue);
      e.clipboardData.setData('text/html', box.innerHTML);
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    ui.flash('Copied with the original values');
  }

  return {
    start() {
      scan();
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
      document.addEventListener('mousemove', onMove, { passive: true, capture: true });
      document.addEventListener('copy', onCopy, true);
    },
    refresh: scan,
    stop() {
      observer?.disconnect();
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('copy', onCopy, true);
      if (canHighlight) CSS.highlights.delete(HIGHLIGHT);
    },
  };
}
