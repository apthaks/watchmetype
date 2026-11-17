// Shared test helpers: a seeded PRNG, a random editing session, a simulated
// typist, and a way to hand-build raw v1 payloads for hostile-link tests.

import { Recorder } from '../js/recorder.js';
import { Writer, utf8, deflateRaw, toBase64Url } from '../js/codec/bytes.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (rand, n) => Math.floor(rand() * n);
const pick = (rand, list) => list[int(rand, list.length)];

const ALPHABETS = [
  [...'abcdefghijklmnopqrstuvwxyz      .,!?\'"-'],
  [...'ABCDEFGHIJ0123456789 éüñøß'],
  [...'日本語のテキストを書きます。'],
  [...'नमस्ते दुनिया यह एक परीक्षण है'],
  [...'😀🎉👍🏽👩‍💻🏳️‍🌈🇮🇳'],
  ['\n'],
];

function gap(rand) {
  const r = rand();
  if (r < 0.05) return 0;
  if (r < 0.8) return 30 + int(rand, 400);
  if (r < 0.95) return int(rand, 3000);
  if (r < 0.99) return 3001 + int(rand, 60000);
  return 3001 + int(rand, 4e8);
}

// Random edits of every kind, fed through the real Recorder the way a
// textarea would feed it. Returns the recorder (events + final text).
export function randomSession(rand, steps) {
  const rec = new Recorder();
  let chars = [];
  let caret = 0;
  let now = 0;
  for (let i = 0; i < steps; i++) {
    const r = rand();
    const alphabet = rand() < 0.7 ? ALPHABETS[0] : pick(rand, ALPHABETS);
    if (r < 0.55) {
      chars.splice(caret, 0, pick(rand, alphabet));
      caret++;
    } else if (r < 0.72) {
      if (caret) chars.splice(--caret, 1);
    } else if (r < 0.8) {
      caret = int(rand, chars.length + 1);
      continue;
    } else if (r < 0.88) {
      const from = int(rand, chars.length + 1);
      const len = int(rand, Math.min(12, chars.length - from) + 1);
      const word = Array.from({ length: int(rand, 9) }, () => pick(rand, alphabet));
      chars.splice(from, len, ...word);
      caret = from + word.length;
    } else if (r < 0.95) {
      const word = Array.from({ length: 2 + int(rand, 8) }, () => pick(rand, alphabet));
      chars.splice(caret, 0, ...word);
      caret += word.length;
    } else {
      chars.splice(caret, 1 + int(rand, 3));
    }
    now += gap(rand);
    if (!rec.input(chars.join(''), now)) {
      chars = [...rec.text];
      caret = Math.min(caret, chars.length);
    }
  }
  return rec;
}

const WORDS = (
  'the of and to a in is it you that he was for on are with as I his they be at one have this from or had by ' +
  'not but what all were we when your can said there use an each which she do how their if will up other about ' +
  'out many then them these so some her would make like him into time has look two more write go see number no ' +
  'way could people my than first water been call who oil its now find long down day did get come made may part ' +
  'honestly really coffee morning weekend thought working people always never something because through little ' +
  'tonight together remember probably favorite tomorrow question between another without different important'
).split(' ');

export function sentence(rand, length) {
  let out = '';
  let start = true;
  while (out.length < length) {
    let word = pick(rand, WORDS);
    if (start) word = word[0].toUpperCase() + word.slice(1);
    start = false;
    out += word;
    const r = rand();
    if (r < 0.1) {
      out += '. ';
      start = true;
    } else if (r < 0.16) out += ', ';
    else out += ' ';
  }
  return out.slice(0, length).trimEnd();
}

// A person typing `text`: uneven rhythm, typos fixed with backspace,
// pauses at punctuation, the odd long think.
export function typist(rand, text) {
  const rec = new Recorder();
  const keys = 'abcdefghijklmnopqrstuvwxyz';
  let typed = '';
  let now = 0;
  const key = (value, wait) => {
    now += wait;
    typed = value;
    rec.input(typed, now);
  };
  const rhythm = () => Math.round(60 + 110 * -Math.log(1 - rand() * 0.98));
  for (const ch of text) {
    if (rand() < 0.04) {
      const n = 1 + int(rand, 3);
      for (let i = 0; i < n; i++) key(typed + keys[int(rand, 26)], rhythm());
      now += 200 + int(rand, 500);
      for (let i = 0; i < n; i++) key(typed.slice(0, -1), 90 + int(rand, 80));
    }
    let wait = rhythm();
    if ('.,'.includes(typed.slice(-2, -1))) wait += 300 + int(rand, 1500);
    if (rand() < 0.01) wait += 3000 + int(rand, 20000);
    key(typed + ch, wait);
  }
  return rec;
}

// Build link data from raw v1 fields, valid or not.
export async function craft(f) {
  const w = new Writer();
  w.bytes(f.id || new Uint8Array(8));
  w.varint(f.day || 0);
  w.varint(f.flags || 0);
  w.varint(f.n);
  const sum = f.sum >>> 0;
  w.bytes([sum >>> 24, (sum >>> 16) & 255, (sum >>> 8) & 255, sum & 255]);
  const varints = (list) => {
    const s = new Writer();
    for (const v of list || []) s.varint(v);
    return s.done();
  };
  w.stream(Uint8Array.from(f.T || []));
  w.stream(varints(f.L));
  w.stream(varints(f.N));
  w.stream(typeof f.K === 'string' ? utf8(f.K) : Uint8Array.from(f.K || []));
  w.stream(varints(f.J));
  if (f.extra) w.bytes(f.extra);
  return '1' + toBase64Url(await deflateRaw(w.done()));
}
