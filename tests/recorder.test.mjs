import test from 'node:test';
import assert from 'node:assert/strict';
import { Recorder, diff, normalize, MAX_CHARS, MAX_EVENTS } from '../js/recorder.js';

const cps = (s) => [...s];

test('diff: insert, delete, replace, no change', () => {
  assert.deepEqual(diff(cps('helo'), cps('hello')), { pos: 3, del: 0, ins: 'l' });
  assert.deepEqual(diff(cps('hello'), cps('hell')), { pos: 4, del: 1, ins: '' });
  assert.deepEqual(diff(cps('the cat sat'), cps('the dog sat')), { pos: 4, del: 3, ins: 'dog' });
  assert.deepEqual(diff(cps(''), cps('a')), { pos: 0, del: 0, ins: 'a' });
  assert.deepEqual(diff(cps('abc'), cps('')), { pos: 0, del: 3, ins: '' });
  assert.equal(diff(cps('same'), cps('same')), null);
});

test('diff: repeated characters never overlap prefix and suffix', () => {
  assert.deepEqual(diff(cps('aa'), cps('aaa')), { pos: 2, del: 0, ins: 'a' });
  assert.deepEqual(diff(cps('aaa'), cps('aa')), { pos: 2, del: 1, ins: '' });
  assert.deepEqual(diff(cps('abab'), cps('ab')), { pos: 2, del: 2, ins: '' });
});

test('diff: emoji are one position and never split', () => {
  assert.deepEqual(diff(cps('a😀'), cps('a😁')), { pos: 1, del: 1, ins: '😁' });
  assert.deepEqual(diff(cps('😀'), cps('😀😀')), { pos: 1, del: 0, ins: '😀' });
});

test('normalize: line endings, control characters, lone surrogates', () => {
  assert.equal(normalize('a\r\nb\rc\n'), 'a\nb\nc\n');
  assert.equal(normalize('a\tb\u0000c\u007fd\u0085e'), 'abcde');
  assert.equal(normalize('x\ud83dy'), 'x�y');
  assert.equal(normalize('ok 😀 नमस्ते'), 'ok 😀 नमस्ते');
});

test('records typing, a fix and a mid-text edit with timing', () => {
  const rec = new Recorder();
  rec.input('h', 1000);
  rec.input('hu', 1120);
  rec.input('h', 1400);
  rec.input('hi', 1490);
  rec.input('oh hi', 6000);
  assert.deepEqual(rec.events, [
    { t: 0, pos: 0, del: 0, ins: 'h' },
    { t: 120, pos: 1, del: 0, ins: 'u' },
    { t: 280, pos: 1, del: 1, ins: '' },
    { t: 90, pos: 1, del: 0, ins: 'i' },
    { t: 4510, pos: 0, del: 0, ins: 'oh ' },
  ]);
  assert.equal(rec.text, 'oh hi');
});

test('unchanged value records nothing', () => {
  const rec = new Recorder();
  assert.equal(rec.input('', 5), true);
  rec.input('a', 10);
  assert.equal(rec.input('a', 20), true);
  assert.equal(rec.events.length, 1);
});

test('character cap counts code points and refuses the overflow', () => {
  const rec = new Recorder();
  const full = '😀'.repeat(MAX_CHARS);
  assert.equal(rec.input(full, 0), true);
  assert.equal(rec.input(full + 'x', 10), false);
  assert.equal(rec.text, full);
  assert.equal(rec.events.length, 1);
  assert.equal(rec.input(full.slice(2), 20), true);
});

test('event cap stops recording', () => {
  const rec = new Recorder();
  for (let i = 0; i < MAX_EVENTS; i++) rec.input(i % 2 ? '' : 'a', i);
  assert.equal(rec.full, true);
  const before = rec.text;
  assert.equal(rec.input(before + 'z', 99999), false);
  assert.equal(rec.events.length, MAX_EVENTS);
  assert.equal(rec.text, before);
});

test('a restored log continues, and the time away is a long pause', () => {
  const first = new Recorder();
  first.input('a', 0);
  first.input('ab', 100);
  const second = new Recorder(first.events, 90000);
  assert.equal(second.text, 'ab');
  second.input('abc', 5);
  second.input('abcd', 55);
  assert.equal(second.events[2].t, 90000);
  assert.equal(second.events[3].t, 50);
  const third = new Recorder(first.events, 0);
  third.input('abc', 5);
  assert.ok(third.events[2].t > 3000);
});

test('a corrupt stored log is rejected', () => {
  const bad = [
    [{ t: 0, pos: 1, del: 0, ins: 'a' }],
    [{ t: 0, pos: 0, del: 1, ins: 'a' }],
    [{ t: 0, pos: 0, del: 0, ins: '' }],
    [{ t: 0, pos: 0, del: 0, ins: 'a\tb' }],
    [{ t: -1, pos: 0, del: 0, ins: 'a' }],
    [{ t: 0, pos: 0.5, del: 0, ins: 'a' }],
    [{ t: 0, pos: 0, del: 0, ins: 7 }],
    [null],
    [{ t: 0, pos: 0, del: 0, ins: 'x'.repeat(MAX_CHARS + 1) }],
  ];
  for (const log of bad) assert.throws(() => new Recorder(log));
});
