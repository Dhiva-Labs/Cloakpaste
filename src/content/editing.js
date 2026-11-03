// Putting text into chat composers. Sites use plain <textarea>s or rich
// editors (ProseMirror on ChatGPT and Claude, Quill-style on Gemini), and
// each reacts to a different kind of input, so we pick the path the editor
// itself listens to.

export function editableTarget(node) {
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el) return null;
  if (el instanceof HTMLTextAreaElement) return el.readOnly || el.disabled ? null : el;
  if (el instanceof HTMLInputElement) {
    return /^(?:text|search|url|email|tel)$/i.test(el.type || 'text') && !el.readOnly && !el.disabled ? el : null;
  }
  const host = el.closest('[contenteditable]');
  return host && host.isContentEditable ? host : null;
}

export const isTextField = (el) => el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;

export function captureSelection(target) {
  if (isTextField(target)) return { kind: 'field', start: target.selectionStart, end: target.selectionEnd };
  const sel = getSelection();
  return { kind: 'range', range: sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null };
}

// Scanning is async; put the caret back where the paste happened.
export function restoreSelection(target, snap) {
  target.focus({ preventScroll: true });
  if (snap.kind === 'field') {
    if (target.selectionStart !== snap.start || target.selectionEnd !== snap.end) {
      target.setSelectionRange(snap.start, snap.end);
    }
  } else if (snap.range && target.contains(snap.range.startContainer)) {
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(snap.range);
  }
}

/**
 * Insert text at the current selection the way a real paste would.
 * @param {HTMLElement} target the editable element
 * @param {string} text
 * @param {string} [html] only used when nothing was redacted, to keep formatting
 * @param {EventTarget} [dispatchTo] element that received the original paste
 */
export function insertText(target, text, html = '', dispatchTo = target) {
  if (isTextField(target)) {
    // execCommand keeps the native undo stack and fires the input events
    // React-controlled fields listen for.
    if (!document.execCommand('insertText', false, text)) {
      const { selectionStart: s, selectionEnd: e } = target;
      target.setRangeText(text, s, e, 'end');
      target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text }));
    }
    return;
  }
  // Rich editors handle paste events themselves; hand them a synthetic one.
  const dt = new DataTransfer();
  dt.setData('text/plain', text);
  if (html) dt.setData('text/html', html);
  const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true });
  (dispatchTo.isConnected ? dispatchTo : target).dispatchEvent(ev);
  if (!ev.defaultPrevented) document.execCommand('insertText', false, text);
}

const graphemes = (s) => {
  try {
    return [...new Intl.Segmenter().segment(s)].length;
  } catch {
    return [...s].length;
  }
};
const squash = (s) => s.replace(/\s+/g, '').trim();

/** Remember where an insertion starts so it can be swapped out later. */
export function beginInsertRecord(target) {
  return isTextField(target) ? { kind: 'field', start: target.selectionStart } : { kind: 'range' };
}

export function finishInsertRecord(record, target, text) {
  if (record.kind === 'field') {
    record.end = target.selectionEnd;
  } else {
    const sel = getSelection();
    record.after = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  }
  record.text = text;
  return record;
}

/** Select text inserted earlier. Returns false when it can't be found intact. */
export function selectInserted(target, record) {
  target.focus({ preventScroll: true });
  if (record.kind === 'field') {
    if (target.value.slice(record.start, record.end) !== record.text) return false;
    target.setSelectionRange(record.start, record.end);
    return true;
  }
  if (!record.after || !target.contains(record.after.endContainer)) return false;
  const sel = getSelection();
  sel.removeAllRanges();
  const caret = record.after.cloneRange();
  caret.collapse(false);
  sel.addRange(caret);
  const n = graphemes(record.text);
  for (let i = 0; i < n; i++) sel.modify('extend', 'backward', 'character');
  return squash(sel.toString()) === squash(record.text);
}
