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
let keyboardState;
export function keyboardSpace(active) {
  const view = window.visualViewport;
  const height = active && view && Math.abs(view.scale - 1) < 0.01
    ? Math.max(0, document.documentElement.clientHeight - view.height) : 0;
  const keyboard = height > 120;
  document.documentElement.classList.toggle('keyboard', keyboard);
  const top = keyboard ? Math.ceil(view.offsetTop) : 0;
  const bottom = keyboard ? Math.ceil(Math.max(0, height - view.offsetTop)) : 0;
  const state = `${top},${bottom}`;
  if (state === keyboardState) return keyboard;
  if (!keyboardRule) {
    const sheet = [...document.styleSheets].find((s) => s.href && new URL(s.href).pathname === '/style.css');
    if (!sheet) return keyboard;
    keyboardRule = sheet.cssRules[sheet.insertRule(':root {}', sheet.cssRules.length)].style;
  }
  keyboardRule.setProperty('--keyboard-top', `${top}px`);
  keyboardRule.setProperty('--keyboard-bottom', `${bottom}px`);
  keyboardState = state;
  return keyboard;
}
