// Keeps text that was not typed out of the textarea: paste, drop, yank and
// autocorrect replacement are blocked, and input stops at the character cap.
// Composition (IME, Android keyboards) cannot be cancelled, so it is allowed
// and the recorder simply records what it did.

// If blocking autocorrect replacement breaks typing on iOS, set this to false
// and it is recorded as an edit instead.
const BLOCK_REPLACEMENT = true;

const BLOCKED = new Set([
  'insertFromPaste',
  'insertFromPasteAsQuotation',
  'insertFromDrop',
  'deleteByDrag',
  'insertFromYank',
]);
if (BLOCK_REPLACEMENT) BLOCKED.add('insertReplacementText');

const PASTE_HINT = 'Pasting is off — type it.';
const count = (str) => [...str].length;

// isFull(): true once the event cap is reached and nothing more can be recorded.
// Returns refresh(), to call whenever the textarea's value changes.
export function guard(el, { max, isFull, hint }) {
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    hint(PASTE_HINT);
  });
  el.addEventListener('drop', (e) => e.preventDefault());
  el.addEventListener('dragstart', (e) => e.preventDefault());

  el.addEventListener('beforeinput', (e) => {
    const type = e.inputType;
    if (BLOCKED.has(type)) {
      e.preventDefault();
      if (type.startsWith('insertFromPaste')) hint(PASTE_HINT);
      return;
    }
    if (!e.cancelable || e.isComposing) return;
    if (isFull()) {
      e.preventDefault();
      return;
    }
    if (type.startsWith('insert')) {
      const adding = e.data == null ? 1 : count(e.data);
      const selected = count(el.value.slice(el.selectionStart, el.selectionEnd));
      if (count(el.value) - selected + adding > max) e.preventDefault();
    }
  });

  // maxlength counts UTF-16 units but the cap counts code points, so the
  // attribute is kept at "current length + code points still allowed".
  const refresh = () => {
    el.maxLength = el.value.length + Math.max(0, max - count(el.value));
  };
  refresh();
  return refresh;
}
