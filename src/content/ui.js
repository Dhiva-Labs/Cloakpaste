// In-page UI: a toast after each paste and a tooltip over placeholders.
// It lives in a closed shadow root so the page's scripts and styles can't
// reach in, which matters because the tooltip shows original values.

const STYLE = `
:host { all: initial; --paper: #FFFDF7; --ink: #161513; --muted: #6B665C; --line: #E4DECF; --bar: #161513; --hi: #F2C200; }
@media (prefers-color-scheme: dark) {
  :host { --paper: #1C1B18; --ink: #EFEBE0; --muted: #A39E92; --line: #34322C; --bar: #F2C200; --hi: #161513; }
}
* { box-sizing: border-box; }
.wrap { position: fixed; z-index: 2147483647; right: 20px; bottom: 20px; width: min(380px, calc(100vw - 32px));
  font: 13px/1.45 "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif; color: var(--ink); }
.toast { background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px;
  box-shadow: 0 8px 28px rgba(0,0,0,.18); }
.head { display: flex; gap: 10px; align-items: flex-start; }
.mark { flex: none; width: 22px; height: 22px; border-radius: 5px; background: var(--bar); color: var(--hi);
  display: grid; place-items: center; font: 600 12px/1 "IBM Plex Mono", ui-monospace, monospace; }
.title { font-weight: 600; }
.detail { color: var(--muted); margin-top: 2px; }
.close { margin-left: auto; border: 0; background: none; color: var(--muted); cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 4px; }
.actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
button.act { font: inherit; border: 1px solid var(--line); background: transparent; color: var(--ink); border-radius: 6px;
  padding: 4px 10px; cursor: pointer; }
button.act:hover { border-color: var(--muted); }
button.act.primary { background: var(--bar); color: var(--hi); border-color: var(--bar); }
.items { margin: 10px 0 0; padding: 0; list-style: none; max-height: 180px; overflow: auto; border-top: 1px solid var(--line); }
.items li { display: flex; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--line); align-items: baseline; }
.ph { flex: none; background: var(--bar); color: var(--hi); border-radius: 4px; padding: 0 6px;
  font: 12px/1.6 "IBM Plex Mono", ui-monospace, monospace; }
.val { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: "IBM Plex Mono", ui-monospace, monospace; font-size: 12px; }
.busy .mark { animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .35; } }
.tip { position: fixed; z-index: 2147483647; max-width: 360px; background: var(--paper); color: var(--ink);
  border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; box-shadow: 0 6px 20px rgba(0,0,0,.18);
  font: 12px/1.45 "IBM Plex Sans", system-ui, sans-serif; display: flex; gap: 8px; align-items: center; }
.tip .val { color: var(--ink); white-space: pre-wrap; word-break: break-all; max-height: 120px; overflow: auto; }
.tip .kind { color: var(--muted); }
.flash { position: fixed; z-index: 2147483647; left: 50%; bottom: 24px; transform: translateX(-50%); background: var(--bar);
  color: var(--hi); border-radius: 6px; padding: 6px 12px; font: 12px "IBM Plex Sans", system-ui, sans-serif; }
`;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

/** Hide most of a value so a glance over the shoulder doesn't reveal it. */
export function maskValue(value) {
  const v = value.replace(/\s+/g, ' ');
  if (v.length <= 4) return '•'.repeat(v.length);
  const at = v.indexOf('@');
  if (at > 0) return v[0] + '•••' + v.slice(at);
  const keep = Math.min(3, Math.floor(v.length / 4));
  return v.slice(0, keep) + '•'.repeat(Math.min(8, v.length - keep * 2)) + v.slice(-keep);
}

export function createUi() {
  const host = document.createElement('pasteguard-ui');
  const root = host.attachShadow({ mode: 'closed' });
  const style = el('style');
  style.textContent = STYLE;
  root.append(style);
  const attach = () => {
    if (!host.isConnected) document.documentElement.append(host);
  };

  let toastNode = null;
  let toastTimer = null;
  let tipNode = null;
  let tipHideTimer = null;
  let tipFor = null;

  function closeToast() {
    clearTimeout(toastTimer);
    toastNode?.remove();
    toastNode = null;
  }

  /**
   * @param {{ title: string, detail?: string, busy?: boolean, timeout?: number,
   *   actions?: Array<{label: string, primary?: boolean, onClick: () => void}>,
   *   items?: Array<{placeholder: string, value: string}> }} opts
   */
  function toast(opts) {
    attach();
    closeToast();
    const wrap = el('div', 'wrap' + (opts.busy ? ' busy' : ''));
    wrap.setAttribute('role', 'status');
    const box = el('div', 'toast');
    const head = el('div', 'head');
    head.append(el('div', 'mark', '▮'));
    const txt = el('div');
    txt.append(el('div', 'title', opts.title));
    if (opts.detail) txt.append(el('div', 'detail', opts.detail));
    head.append(txt);
    const x = el('button', 'close', '×');
    x.setAttribute('aria-label', 'Dismiss');
    x.addEventListener('click', closeToast);
    head.append(x);
    box.append(head);

    let list = null;
    const actions = [...(opts.actions || [])];
    if (opts.items?.length) {
      actions.push({
        label: 'Details',
        keepOpen: true,
        onClick: (btn) => {
          if (list) {
            list.remove();
            list = null;
            btn.textContent = 'Details';
            return;
          }
          list = el('ul', 'items');
          const seen = new Set();
          for (const it of opts.items) {
            if (seen.has(it.placeholder)) continue;
            seen.add(it.placeholder);
            const li = el('li');
            li.append(el('span', 'ph', it.placeholder.replace(/^\[|\]$/g, '')), el('span', 'val', maskValue(it.value)));
            list.append(li);
          }
          box.append(list);
          btn.textContent = 'Hide details';
          clearTimeout(toastTimer);
        },
      });
    }
    if (actions.length) {
      const row = el('div', 'actions');
      for (const a of actions) {
        const b = el('button', 'act' + (a.primary ? ' primary' : ''), a.label);
        b.addEventListener('click', () => {
          a.onClick(b);
          if (!a.keepOpen) closeToast();
        });
        row.append(b);
      }
      box.append(row);
    }
    wrap.append(box);
    // Pause auto-dismiss while the pointer is over the toast.
    wrap.addEventListener('mouseenter', () => clearTimeout(toastTimer));
    wrap.addEventListener('mouseleave', () => arm(opts.timeout));
    root.append(wrap);
    toastNode = wrap;
    const arm = (t) => {
      clearTimeout(toastTimer);
      if (t) toastTimer = setTimeout(closeToast, t);
    };
    arm(opts.timeout);
    return { close: closeToast };
  }

  function flash(message) {
    attach();
    const n = el('div', 'flash', message);
    root.append(n);
    setTimeout(() => n.remove(), 1800);
  }

  function showTip(rect, { key, entry }) {
    attach();
    clearTimeout(tipHideTimer);
    if (tipFor === key && tipNode) return;
    hideTipNow();
    tipFor = key;
    tipNode = el('div', 'tip');
    tipNode.append(el('span', 'ph', key), el('span', 'val', entry.value));
    const copy = el('button', 'act', 'Copy');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(entry.value);
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Copy failed';
      }
    });
    tipNode.append(copy);
    tipNode.addEventListener('mouseenter', () => clearTimeout(tipHideTimer));
    tipNode.addEventListener('mouseleave', () => hideTip());
    root.append(tipNode);
    const w = tipNode.offsetWidth;
    const h = tipNode.offsetHeight;
    const left = Math.max(8, Math.min(rect.left, innerWidth - w - 8));
    const top = rect.top - h - 6 > 8 ? rect.top - h - 6 : rect.bottom + 6;
    tipNode.style.left = `${left}px`;
    tipNode.style.top = `${top}px`;
  }

  function hideTipNow() {
    tipNode?.remove();
    tipNode = null;
    tipFor = null;
  }

  function hideTip() {
    clearTimeout(tipHideTimer);
    tipHideTimer = setTimeout(hideTipNow, 250);
  }

  return { toast, closeToast, flash, showTip, hideTip, host };
}
