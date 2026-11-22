import test from 'node:test';
import assert from 'node:assert/strict';
import { revealLine, keyboardSpace } from '../js/viewport.js';

function global(t, name, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name]);
}

function browser(t, view = { height: 400, offsetTop: 0, scale: 1 }) {
  const scrolls = [];
  global(t, 'window', {
    visualViewport: view,
    scrollBy: (options) => scrolls.push(options.top),
  });
  return scrolls;
}

test('scrolling: a line below the keyboard moves only enough to become visible', (t) => {
  const scrolls = browser(t);
  revealLine({ top: 450, bottom: 480, height: 30 });
  assert.deepEqual(scrolls, [104]);
});

test('scrolling: Safari viewport panning is included in the visible bounds', (t) => {
  const scrolls = browser(t, { height: 400, offsetTop: 80, scale: 1 });
  revealLine({ top: 70, bottom: 100, height: 30 });
  revealLine({ top: 410, bottom: 440, height: 30 });
  assert.deepEqual(scrolls, [-34]);
});

test('scrolling: leave room for replay controls', (t) => {
  const scrolls = browser(t);
  revealLine({ top: 310, bottom: 340, height: 30 }, 100);
  assert.deepEqual(scrolls, [40]);
});

test('scrolling: do not fight zoom, hidden carets or a viewport shorter than one line', (t) => {
  const scrolls = browser(t, { height: 400, offsetTop: 0, scale: 2 });
  revealLine({ top: 500, bottom: 530, height: 30 });
  window.visualViewport.scale = 1;
  revealLine({ top: 500, bottom: 500, height: 0 });
  window.visualViewport.height = 40;
  revealLine({ top: 500, bottom: 530, height: 30 });
  assert.deepEqual(scrolls, []);
});

test('scrolling: browsers without VisualViewport still reveal the line', (t) => {
  const scrolls = browser(t, undefined);
  window.visualViewport = undefined;
  global(t, 'innerHeight', 600);
  revealLine({ top: 620, bottom: 650, height: 30 });
  assert.deepEqual(scrolls, [74]);
});

test('keyboard: reserve space, track the visible bottom during panning, and reset outside the writer', (t) => {
  browser(t, { height: 400.5, offsetTop: 80, scale: 1 });
  const values = new Map();
  let writes = 0;
  const style = { setProperty: (name, value) => { values.set(name, value); writes++; } };
  const sheet = { href: 'http://localhost:8788/style.css', cssRules: [], insertRule: () => { sheet.cssRules.push({ style }); return 0; } };
  global(t, 'document', { documentElement: { clientHeight: 800 }, styleSheets: [sheet] });
  keyboardSpace(true);
  assert.equal(values.get('--keyboard-space'), '400px');
  assert.equal(values.get('--keyboard-bottom'), '320px');
  const before = writes;
  keyboardSpace(true);
  assert.equal(writes, before, 'unchanged bounds do not trigger more style writes');
  window.visualViewport.offsetTop = 100;
  keyboardSpace(true);
  assert.equal(values.get('--keyboard-space'), '400px');
  assert.equal(values.get('--keyboard-bottom'), '300px');
  window.visualViewport.height = 800;
  keyboardSpace(true);
  assert.equal(values.get('--keyboard-space'), '0px');
  assert.equal(values.get('--keyboard-bottom'), '0px');
  window.visualViewport.height = 400;
  window.visualViewport.scale = 2;
  keyboardSpace(true);
  assert.equal(values.get('--keyboard-space'), '0px');
  assert.equal(values.get('--keyboard-bottom'), '0px');
  window.visualViewport.scale = 1;
  keyboardSpace(false);
  assert.equal(values.get('--keyboard-space'), '0px');
  assert.equal(values.get('--keyboard-bottom'), '0px');
});
