import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { Recorder } from '../js/recorder.js';
import { encode, decode } from '../js/codec/index.js';
import { gifPlan, gifReason, gifStates, GIF_LIMITS, FINAL_HOLD_MS, GIF_ROOM_MESSAGE } from '../js/gif-model.js';
import { replaySteps, LEAD_MS, PAUSE_MS, TAIL_MS } from '../js/replay-timing.js';
import { wrapText, createRenderer, WIDTH, HEIGHT } from '../js/gif-render.js';
import { editedLabel } from '../js/time.js';

async function recording(values, times = values.map((_, i) => i * 160)) {
  const rec = new Recorder();
  values.forEach((value, i) => rec.input(value, times[i]));
  return decode(await encode({ id: '0123456789abcdef', createdDay: 325, events: rec.events }));
}

test('GIF preserves decoded replay delays, mid-text deletions and Unicode positions', async () => {
  const model = await recording(['A🙂', 'A🙂 typo', 'A🙂 type', 'A🙂 type!']);
  const frames = gifPlan(model);
  assert.equal(frames[0].delay, LEAD_MS);
  assert.deepEqual(frames.slice(1, -1).map(f => f.text), ['A🙂', 'A🙂 typo', 'A🙂 type', 'A🙂 type!']);
  assert.equal(frames[1].cursor, 2);
  const steps = replaySteps(model.events);
  frames.slice(1, -1).forEach((frame, i) => assert.ok(Math.abs(frame.at - (steps[i].at + LEAD_MS)) <= 10));
  assert.equal(frames.at(-2).delay, TAIL_MS);
  assert.equal(frames.at(-1).delay, FINAL_HOLD_MS);
  assert.equal(frames.at(-1).caret, false);
});

test('GIF long pauses match replay compression and carry the original pause label', async () => {
  const model = await recording(['A', 'AB', 'ABC'], [0, 60000, 60160]);
  const frames = gifPlan(model);
  assert.equal(frames[1].delay, PAUSE_MS);
  assert.equal(frames[1].pause, 'paused 1 min');
  assert.equal(frames[2].pause, '');
});

test('GIF eligibility checks every stage, code points, edit count and total loop duration', async () => {
  assert.ok(gifPlan(await recording(['🙂'.repeat(140)])));
  assert.equal(gifPlan(await recording(['🙂'.repeat(141), 'short'])), null);
  const values = Array.from({ length: 300 }, (_, i) => i % 2 ? 'ab' : 'a');
  const times = values.map((_, i) => i * 30);
  assert.ok(gifPlan(await recording(values, times)));
  assert.equal(gifPlan(await recording([...values, 'abc'], [...times, 9000])), null);
  assert.equal(gifPlan(await recording(['a', 'ab', 'abc'], [0, 1, 2])).at(-1).text, 'abc');
  assert.equal(gifPlan(await recording(Array.from({ length: 20 }, (_, i) => 'a'.repeat(i + 1)),
    Array.from({ length: 20 }, (_, i) => i * 2000))), null);
  assert.equal(gifPlan({ events: [], text: '' }), null);
  assert.equal(gifPlan(await recording(['   '])), null);
  const overflow = await recording(['a\n\n\n\n', 'short'], [0, 1]);
  assert.equal(gifPlan(overflow, text => text.split('\n').length <= 4), null);
});

test('GIF very fast edits coalesce on the display clock without lengthening playback', async () => {
  const frames = gifPlan(await recording(['a', 'ab', 'abc'], [0, 1, 2]));
  assert.deepEqual(frames.map(f => f.text), ['', 'abc', 'abc']);
  assert.equal(frames.reduce((sum, f) => sum + f.delay, 0), LEAD_MS + TAIL_MS + FINAL_HOLD_MS);
  assert.ok(frames.every(f => f.delay >= 20 && f.delay % 10 === 0));
});

test('GIF unavailability reasons agree with export gates and use compressed playback duration', async () => {
  const cases = [
    [await recording(['x'.repeat(141), 'short']), undefined, /too much text/],
    [await recording(Array.from({ length: 301 }, (_, i) => i % 2 ? 'ab' : 'a'), Array.from({ length: 301 }, (_, i) => i * 30)), undefined, /too many edits/],
    [await recording(Array.from({ length: 20 }, (_, i) => 'a'.repeat(i + 1)), Array.from({ length: 20 }, (_, i) => i * 2000)), undefined, /replay too long/],
    [await recording(['a\n\n\n\n', 'short'], [0, 1]), text => text.split('\n').length <= 4, /more room/],
  ];
  for (const [model, fits, message] of cases) {
    assert.match(gifReason(model, fits), message);
    assert.equal(gifPlan(model, fits), null);
  }
  const longPause = await recording(['a', 'ab'], [0, 600000]);
  assert.equal(gifReason(longPause), '');
  assert.ok(gifPlan(longPause));
  assert.equal(gifReason({ text: '', events: [] }), '');
});

const measure = { measureText: text => ({ width: [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length * 10 }) };

test('GIF layout preserves spaces, blank lines and graphemes; rejects overflowing intermediate states', () => {
  assert.deepEqual(wrapText(measure, 'one two', 45).map(l => l.text), ['one ', 'two']);
  assert.deepEqual(wrapText(measure, 'a\n\nb\n').map(l => l.text), ['a', '', 'b', '']);
  assert.deepEqual(wrapText(measure, '👩‍💻éx', 10).map(l => l.text), ['👩‍💻', 'é', 'x']);
  const drawn = [];
  const positions = [];
  const ctx = { ...measure, setTransform() {}, fillRect() {}, fillText: (text, x, y) => { drawn.push(text); positions.push({ text, x, y }); }, getImageData: () => ({ data: new Uint8ClampedArray(4) }) };
  const renderer = createRenderer({ getContext: () => ctx }, false, Date.UTC(2026, 10, 23, 12, 34));
  assert.equal(renderer.fits([{ text: 'short' }, { text: '\n'.repeat(4) }]), false);
  assert.equal(renderer.fits([{ text: 'short' }]), true);
  renderer.draw({ text: '<script>🙂</script>', caret: false, pause: '' });
  assert.ok(drawn.includes('edited 23 Nov 2026 · 12:34 GMT'));
  assert.ok(drawn.includes('<script>🙂</script>'));
  assert.ok(!drawn.includes('watchmetype'));
  assert.ok(!drawn.includes('a thought, taking shape.'));
  assert.ok(!drawn.includes('a witness, not a proof.'));
  const stamp = positions.find(p => p.text.startsWith('edited '));
  const brand = positions.find(p => p.text === 'watchmetype.com');
  assert.equal(brand?.text, 'watchmetype.com');
  assert.equal(stamp.y, brand.y);
  assert.ok(stamp.x < brand.x);
  assert.equal(WIDTH, 1200);
  assert.equal(HEIGHT, 720);
  assert.equal(editedLabel(undefined), '');
});

test('GIF chooses the largest of three sizes that fits four lines and the text area', () => {
  const ctx = {
    setTransform() {}, fillRect() {},
    measureText(text) { return { width: [...text].length * parseFloat(this.font) / 2 }; },
  };
  const renderer = createRenderer({ getContext: () => ctx }, false);
  for (const [text, size] of [['short thought', 48], ['x'.repeat(90), 40], ['x'.repeat(120), 32], ['a\nb\nc\nd', 40]]) {
    assert.equal(renderer.chooseSize([{ text }]), true);
    assert.equal(renderer.fontSize, size);
    assert.equal(renderer.fits([{ text }]), true);
  }
  assert.equal(renderer.chooseSize([{ text: 'a\nb\nc\nd\ne' }]), false);
  assert.equal(GIF_ROOM_MESSAGE, 'This recording needs more room. Share it as a link.');
  const overflow = { text: 'a\nb\nc\nd\ne', cursor: 0, caret: false, pause: '' };
  assert.equal(gifReason({ text: overflow.text, events: [{ t: 0, pos: 0, del: 0, ins: overflow.text }] }, text => renderer.fits([{ text }])), GIF_ROOM_MESSAGE);
  assert.throws(() => renderer.draw(overflow), { message: GIF_ROOM_MESSAGE });
  assert.equal(renderer.chooseSize([{ text: 'x'.repeat(133) }]), false);
});

test('GIF keeps one size across all frames, including transient edits removed before the final text', async () => {
  const model = await recording(['x'.repeat(120), 'short'], [0, 1]);
  const frames = gifPlan(model);
  assert.ok(!frames.some(frame => frame.text.length === 120), 'fast transient edit is coalesced from display frames');
  const drawnFonts = [];
  const ctx = {
    setTransform() {}, fillRect() {},
    measureText(text) { return { width: [...text].length * parseFloat(this.font) / 2 }; },
    fillText(text) { if (text === 'short') drawnFonts.push(this.font); },
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  };
  const renderer = createRenderer({ getContext: () => ctx }, false);
  assert.equal(renderer.chooseSize(gifStates(model)), true);
  assert.equal(renderer.fontSize, 32, 'size accounts for original edit history, not just the final text');
  for (const frame of frames) renderer.draw(frame);
  assert.ok(drawnFonts.every(font => font.startsWith('32px ')));
  assert.equal(renderer.fontSize, 32);
  const workerRenderer = createRenderer({ getContext: () => ctx }, false, undefined, renderer.fontSize);
  assert.equal(workerRenderer.fontSize, 32);
  assert.equal(workerRenderer.fits(frames), true);
});

// Parse independent GIF structure: dimensions, frame delays, loop extension,
// palettes and image blocks. Browser QA also verifies actual pixel rendering.
function inspectGif(bytes) {
  assert.equal(Buffer.from(bytes.slice(0, 6)).toString(), 'GIF89a');
  const word = at => bytes[at] | bytes[at + 1] << 8;
  const blocks = () => { while (bytes[at]) at += bytes[at] + 1; at++; };
  const width = word(6), height = word(8), delays = [];
  let at = 13 + (bytes[10] & 128 ? 3 * 2 ** ((bytes[10] & 7) + 1) : 0);
  while (bytes[at] !== 0x3b) {
    if (bytes[at] === 0x21) {
      const label = bytes[at + 1];
      at += 2;
      if (label === 0xf9) delays.push(word(at + 2) * 10);
      blocks();
    } else if (bytes[at] === 0x2c) {
      const packed = bytes[at + 9];
      at += 10 + (packed & 128 ? 3 * 2 ** ((packed & 7) + 1) : 0);
      at++; // LZW code size.
      blocks();
    } else assert.fail(`unexpected GIF block at ${at}`);
    assert.ok(at < bytes.length);
  }
  return { width, height, delays };
}

test('GIF worker fallback encodes valid looping files, merging identical frames without shortening pauses', async () => {
  const entry = new URL('../js/gif-worker.js', import.meta.url).href;
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    globalThis.self = globalThis;
    globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
    import(${JSON.stringify(entry)}).then(() => parentPort.on('message', data => self.onmessage({ data })));
  `, { eval: true });
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
  const frames = [{ delay: 600 }, { delay: 1200 }, { delay: 3000 }];
  try {
    const bytes = await new Promise((resolve, reject) => {
      worker.on('error', reject);
      worker.on('message', message => {
        if (message.type === 'frame') worker.postMessage({ type: 'pixels', pixels });
        if (message.type === 'error') reject(new Error(message.message));
        if (message.type === 'done') resolve(message.bytes);
      });
      worker.postMessage({ type: 'start', frames, fontURL: '' });
    });
    const result = inspectGif(bytes);
    assert.equal(result.width, WIDTH);
    assert.equal(result.height, HEIGHT);
    assert.deepEqual(result.delays, [4800]);
    assert.ok(Buffer.from(bytes).includes(Buffer.from('NETSCAPE2.0')));
    assert.ok(bytes.length < GIF_LIMITS.bytes);
  } finally { await worker.terminate(); }
});

test('GIF falls back to the checked page layout if worker font metrics do not fit', async () => {
  const entry = new URL('../js/gif-worker.js', import.meta.url).href;
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    globalThis.self = globalThis;
    globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
    globalThis.FontFace = class { async load() { return this; } };
    globalThis.fonts = { add() {} };
    globalThis.OffscreenCanvas = class {
      getContext() { return { setTransform() {}, measureText() { return { width: 1000000 }; } }; }
    };
    import(${JSON.stringify(entry)}).then(() => parentPort.on('message', data => self.onmessage({ data })));
  `, { eval: true });
  let fallback = false;
  try {
    const bytes = await new Promise((resolve, reject) => {
      worker.on('error', reject);
      worker.on('message', message => {
        if (message.type === 'frame') {
          fallback = true;
          worker.postMessage({ type: 'pixels', pixels: new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255) });
        }
        if (message.type === 'error') reject(new Error(message.message));
        if (message.type === 'done') resolve(message.bytes);
      });
      worker.postMessage({ type: 'start', fontURL: '', fontSize: 48,
        frames: [{ text: 'x', delay: 3000 }] });
    });
    assert.equal(fallback, true);
    assert.deepEqual(inspectGif(bytes).delays, [3000]);
  } finally { await worker.terminate(); }
});
