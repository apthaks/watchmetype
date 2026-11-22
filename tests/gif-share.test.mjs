import test from 'node:test';
import assert from 'node:assert/strict';

const model = { text: 'A thought.', events: [{ t: 0, pos: 0, del: 0, ins: 'A thought.' }] };

async function sharing(t, name) {
  const elements = new Map(), workers = [], closeEvents = [], revoked = [], timers = new Map();
  let timer = 0, url = 0, links = 0;
  const node = () => ({
    hidden: true, textContent: '', open: false, listeners: new Map(),
    addEventListener(type, fn) { this.listeners.set(type, fn); },
    removeAttribute(name) { delete this[name]; },
    focus() {}, showModal() { this.open = true; },
    close() { this.open = false; closeEvents.push(() => this.listeners.get('close')()); },
  });
  const ctx = { setTransform() {}, measureText: text => ({ width: [...text].length * 16 }) };
  const globals = {
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); },
      fonts: { load: async () => [] }, createElement: () => ({ getContext: () => ctx }),
    },
    matchMedia: () => ({ matches: false }), HTMLDialogElement: function () {},
    navigator: { share: async () => {}, canShare: () => true },
    Worker: class {
      constructor() { this.stopped = false; workers.push(this); }
      postMessage(message) { this.message = message; }
      terminate() { this.stopped = true; }
      emit(data) { this.onmessage({ data }); }
    },
    setTimeout: fn => { timers.set(++timer, fn); return timer; }, clearTimeout: id => timers.delete(id),
  };
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  const createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL;
  URL.createObjectURL = () => `blob:test-${++url}`;
  URL.revokeObjectURL = value => revoked.push(value);
  t.after(() => { URL.createObjectURL = createURL; URL.revokeObjectURL = revokeURL; });
  const app = await import(`../js/gif-share.js?${name}`);
  const el = id => document.getElementById(id);
  const open = () => app.openGifShare(model, () => { links++; }, () => true);
  await open();
  return {
    ...app, el, workers, revoked, open,
    async generate() { await el('make-gif').onclick(); return workers.at(-1); },
    ready(worker = workers.at(-1)) { worker.emit({ type: 'done', bytes: new Uint8Array([71, 73, 70]) }); },
    flushClose() { while (closeEvents.length) closeEvents.shift()(); },
    get links() { return links; },
  };
}

test('GIF file sharing sends only the file and unsupported capability checks keep download working', async t => {
  const app = await sharing(t, 'file-only');
  const worker = await app.generate();
  let shared;
  navigator.share = async data => { shared = data; };
  app.ready(worker);
  await app.el('share-gif').listeners.get('click')();
  assert.deepEqual(Object.keys(shared), ['files']);
  assert.equal(shared.files[0].type, 'image/gif');
  assert.equal(shared.files[0].name, 'watchmetype.gif');

  await app.generate();
  navigator.canShare = () => { throw new Error('blocked by browser'); };
  app.ready();
  assert.match(app.el('gif-status').textContent, /^gif ready/);
  assert.equal(app.el('share-gif').hidden, true);
  assert.equal(app.el('gif-file-actions').hidden, false);
  assert.ok(app.el('download-gif').href);
});

test('Escape releases the generated GIF and closing during export ignores late worker results', async t => {
  const app = await sharing(t, 'escape');
  await app.generate();
  app.ready();
  const url = app.el('gif-preview').src;
  app.el('share-dialog').listeners.get('cancel')();
  assert.ok(app.revoked.includes(url));
  assert.equal(app.el('gif-preview').src, undefined);
  assert.equal(app.el('download-gif').href, undefined);
  assert.equal(app.el('gif-file-actions').hidden, true);
  app.closeGifShare();
  await app.open();
  const worker = await app.generate();
  app.closeGifShare();
  assert.equal(worker.stopped, true);
  app.ready(worker);
  assert.equal(app.el('gif-preview').src, undefined);
});

test('A queued close event from the previous dialog cannot cancel a new export', async t => {
  const app = await sharing(t, 'reopen');
  await app.generate();
  app.closeGifShare();
  await app.open();
  const worker = await app.generate();
  app.flushClose();
  assert.equal(worker.stopped, false);
  app.ready(worker);
  assert.match(app.el('gif-status').textContent, /^gif ready/);
});

test('A late native-share failure cannot overwrite a reopened dialog', async t => {
  const app = await sharing(t, 'late-share');
  await app.generate();
  app.ready();
  let reject;
  navigator.share = () => new Promise((resolve, fail) => { reject = fail; });
  const pending = app.el('share-gif').listeners.get('click')();
  app.closeGifShare();
  await app.open();
  const status = app.el('gif-status').textContent;
  reject(new Error('share failed'));
  await pending;
  assert.equal(app.el('gif-status').textContent, status);
});

test('GIF export failure allows retry and reopening restores the link choice', async t => {
  const app = await sharing(t, 'retry');
  const worker = await app.generate();
  worker.emit({ type: 'error', message: 'export failed' });
  assert.equal(worker.stopped, true);
  assert.equal(app.el('make-gif').hidden, false);
  assert.equal(app.el('share-link').hidden, true);
  const retry = await app.generate();
  app.ready(retry);
  assert.match(app.el('gif-status').textContent, /^gif ready/);
  app.closeGifShare();
  await app.open();
  assert.equal(app.el('share-link').hidden, false);
  app.el('share-link').onclick();
  assert.equal(app.links, 1);
});
