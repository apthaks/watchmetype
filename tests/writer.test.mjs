import test from 'node:test';
import assert from 'node:assert/strict';
import { decode } from '../js/codec/index.js';

async function writer(t, name) {
  const elements = new Map(), storage = new Map(), copied = [], frames = new Map();
  let frame = 0;
  const node = () => ({
    value: '', textContent: '', hidden: true, listeners: new Map(),
    classList: { toggle() {} },
    addEventListener(type, fn) { this.listeners.set(type, fn); },
    contains() { return false; }, setSelectionRange() {}, focus() {}, select() {},
  });
  const globals = {
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
      fonts: { ready: Promise.resolve() }, styleSheets: [], addEventListener() {},
      documentElement: { clientHeight: 812, classList: { toggle() {} } },
    },
    window: {}, location: { origin: 'https://watchmetype.com' },
    addEventListener() {},
    requestAnimationFrame: fn => { frames.set(++frame, fn); return frame; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: () => 1, clearTimeout() {}, matchMedia: () => ({ matches: false }),
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
    },
    navigator: { clipboard: { writeText: async value => copied.push(value) } },
  };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  const app = await import(`../js/writer.js?${name}`);
  app.show();
  return {
    ...app, elements, storage, copied,
    layout() { const queued = [...frames.values()]; frames.clear(); for (const fn of queued) fn(); },
    type(value) { const text = elements.get('text'); text.value = value; text.listeners.get('input')({}); },
    share() { return elements.get('share').listeners.get('click')(); },
  };
}

test('Share stops if typing changes the draft during link preparation; retry shares the current replay', async t => {
  const app = await writer(t, 'typing');
  app.type('First thought');
  const pending = app.share();
  app.type('Second thought 🙂');
  await pending;
  assert.deepEqual(app.copied, []);
  assert.equal(app.storage.has('wmt:posts'), false);
  assert.equal(app.elements.get('watch').hidden, true);
  assert.equal(app.elements.get('hint').textContent, 'Your draft changed. Share again.');

  await app.share();
  const url = app.elements.get('watch').href;
  const replay = await decode(url);
  assert.equal(replay.text, 'Second thought 🙂');
  assert.deepEqual(app.copied, [`Second thought 🙂\n\nwatch it → ${url}`]);
  const saved = JSON.parse(app.storage.get('wmt:posts'))[0];
  assert.equal(saved.id, replay.id);
  assert.equal(Math.floor(saved.at / 60000) * 60000, replay.editedAt);
  assert.equal(saved.events.length, replay.events.length);
});

test('Keyboard editing leaves caret scrolling to the native textarea, including blank lines', async t => {
  const app = await writer(t, 'native-scroll');
  const text = app.elements.get('text');
  document.activeElement = text;
  window.visualViewport = { height: 360, offsetTop: 80, scale: 1 };
  document.createRange = () => { throw new Error('mirror must not drive keyboard caret scrolling'); };
  window.scrollBy = () => { throw new Error('do not scroll the document while the keyboard editor is active'); };
  app.type('Hi\n' + '\nS'.repeat(35) + '\n\n');
  text.scrollTop = 640;
  app.layout();
  assert.equal(text.scrollTop, 640, 'preserve native caret scroll after input');
  window.visualViewport.offsetTop = 20;
  app.layout();
  assert.equal(text.scrollTop, 640, 'viewport panning must not reset the textarea');
  app.type(text.value + 'A wrapped line with 🙂 and more words');
  app.layout();
  assert.equal(text.scrollTop, 640);
});

test('Share drops an earlier attempt when the writer is reopened with the same event count', async t => {
  const app = await writer(t, 'reopened');
  app.type('A thought');
  const pending = app.share();
  app.hide();
  app.show();
  await pending;
  assert.deepEqual(app.copied, []);
  assert.equal(app.storage.has('wmt:posts'), false);
  assert.equal(app.elements.get('watch').hidden, true);
});

test('Unavailable clipboard exposes the complete share message from its beginning', async t => {
  const app = await writer(t, 'manual-copy');
  navigator.clipboard = undefined;
  app.type('A thought 🙂');
  const fallback = app.elements.get('fallback');
  fallback.select = () => { fallback.scrollTop = 900; };
  await app.share();
  assert.equal(fallback.hidden, false);
  assert.equal(fallback.scrollTop, 0);
  assert.equal(fallback.value, `A thought 🙂\n\nwatch it → ${app.elements.get('watch').href}`);
  assert.match(app.elements.get('hint').textContent, /Automatic sharing is unavailable/);
  app.type('Another thought');
  assert.equal(fallback.hidden, true);
});

test('A cancelled native share does not expose a copy box', async t => {
  const app = await writer(t, 'cancel-share');
  globalThis.matchMedia = () => ({ matches: true });
  navigator.share = async () => { throw Object.assign(new Error(), { name: 'AbortError' }); };
  app.type('A thought');
  await app.share();
  assert.equal(app.elements.get('fallback').hidden, true);
  assert.deepEqual(app.copied, []);
});

test('A delayed clipboard failure cannot reopen fallback after leaving the writer', async t => {
  const app = await writer(t, 'late-copy');
  let reject;
  navigator.clipboard.writeText = () => new Promise((_, fail) => { reject = fail; });
  app.type('A thought');
  const pending = app.share();
  while (!reject) await new Promise(resolve => setImmediate(resolve));
  app.hide();
  reject(new Error('Denied'));
  await pending;
  assert.equal(app.elements.get('fallback').hidden, true);
});
