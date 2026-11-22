import test from 'node:test';
import assert from 'node:assert/strict';
import { decode } from '../js/codec/index.js';

async function writer(t, name) {
  const elements = new Map(), storage = new Map(), copied = [], frames = new Map(), listeners = new Map();
  const viewport = new EventTarget();
  Object.assign(viewport, { height: 400, offsetTop: 80, scale: 1 });
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
      fonts: { ready: Promise.resolve() }, documentElement: { clientHeight: 812 }, styleSheets: [], addEventListener() {},
    },
    window: { visualViewport: viewport }, location: { origin: 'https://watchmetype.com' },
    addEventListener: (type, fn) => listeners.set(type, fn),
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
    ...app, elements, storage, copied, viewport, listeners,
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

test('Caret follows late browser panning after newlines, but manual scrolling stops following', async t => {
  const app = await writer(t, 'caret');
  const text = app.elements.get('text');
  const measure = app.elements.get('measure');
  app.elements.get('write-tools').offsetHeight = 110;
  document.activeElement = text;
  let lineTop = 650;
  const scrolls = [];
  window.scrollBy = ({ top }) => { scrolls.push(top); lineTop -= top; };
  document.createRange = () => ({
    setStart() {}, setEnd() {},
    getBoundingClientRect() {
      assert.equal(text.scrollTop, 0, 'reset native textarea scrolling before measuring');
      return { top: lineTop, bottom: lineTop + 38, height: 38 };
    },
  });
  Object.defineProperty(measure, 'firstChild', { get: () => ({ length: measure.textContent.length }) });
  text.scrollTop = 38;
  text.selectionEnd = 40;
  app.type('D\n'.repeat(20));
  app.layout();
  assert.equal(lineTop + 38, 480 - 134, 'entire line clears the toolbar');

  // iOS can pan its viewport after our input frame has already completed.
  app.viewport.offsetTop = 20;
  app.viewport.dispatchEvent(new Event('scroll'));
  app.layout();
  assert.equal(lineTop + 38, 420 - 134, 'late viewport movement reveals the line again');

  lineTop += 100;
  app.listeners.get('scroll')();
  app.layout();
  assert.equal(lineTop + 38, 420 - 134, 'late document scrolling is corrected too');

  for (const type of ['touchmove', 'wheel']) {
    app.type('D\n'.repeat(21));
    app.layout();
    app.listeners.get(type)();
    lineTop += 100;
    const before = scrolls.length;
    app.viewport.dispatchEvent(new Event('scroll'));
    app.listeners.get('scroll')();
    app.layout();
    assert.equal(scrolls.length, before, `${type} lets the reader scroll freely`);
  }
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
