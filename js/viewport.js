// Keep the active line above the keyboard; leave pinch zoom to the browser.
export function revealLine(rect, bottomInset = 24) {
  const view = window.visualViewport;
  if (view && Math.abs(view.scale - 1) > 0.01) return;
  if (!rect.height) return;
  const top = (view?.offsetTop || 0) + 24;
  const bottom = (view?.offsetTop || 0) + (view?.height || innerHeight) - bottomInset;
  if (bottom - top < rect.height) return;
  const delta = rect.top < top ? rect.top - top : Math.max(0, rect.bottom - bottom);
  if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: 'auto' });
}

let keyboardRule;
let keyboardHeight = -1;

export function keyboardSpace(focused) {
  const view = window.visualViewport;
  const height = focused && view && Math.abs(view.scale - 1) < 0.01
    ? Math.max(0, document.documentElement.clientHeight - view.height) : 0;
  const next = Math.ceil(height);
  if (next === keyboardHeight) return;
  // Use the same-origin stylesheet's CSSOM, not inline styles (strict CSP).
  if (!keyboardRule) {
    const sheet = [...document.styleSheets].find((s) => s.href && new URL(s.href).pathname === '/style.css');
    if (!sheet) return;
    keyboardRule = sheet.cssRules[sheet.insertRule(':root { --keyboard-space: 0px; }', sheet.cssRules.length)].style;
  }
  keyboardRule.setProperty('--keyboard-space', `${next}px`);
  keyboardHeight = next;
}
