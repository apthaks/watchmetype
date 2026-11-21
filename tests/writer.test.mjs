import test from 'node:test';
import assert from 'node:assert/strict';
import { decode } from '../js/codec/index.js';

async function writer(t, name) {
  const elements = new Map(), storage = new Map(), copied = [];
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
    },
    window: {}, location: { origin: 'https://watchmetype.com' },
    addEventListener() {}, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
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
