// Link format v1. FROZEN once shipped: any change here means a new version file.
//
// payload (before deflate-raw + base64url), integers are unsigned LEB128 varints:
//   postId 8 bytes · createdDay · flags (0) · nEvents · FNV-1a 32 of final text (big-endian)
//   then five streams, each prefixed with its byte length:
//   T timing  1 byte per event: delay bucket, 255 = long pause
//   L pauses  seconds, one per long pause
//   N counts  tokens in K per event
//   K ops     UTF-8, one token per code point: 0x01 jump, 0x08 backspace, else inserted char
//   J jumps   absolute cursor position, one per jump token
//
// Positions and lengths count code points, never UTF-16 units.

import {
  Writer, Reader, utf8, fromUtf8, fnv1a, toHex, fromHex,
  toBase64Url, fromBase64Url, deflateRaw, inflateRaw, bad,
} from './bytes.js';

const MAX_CHARS = 500;
const MAX_EVENTS = 4000;
const MAX_RAW = 65536; // decompressed payload cap
const MAX_LINK = 90000; // encoded length cap
const LONG_MS = 3000; // gaps above this become a long pause
const MIN_PAUSE_S = 3;
const MAX_PAUSE_S = 0xffffffff;
const LONG = 255;
const JUMP = '\x01';
const BKSP = '\b';

// Delay buckets in ms: 0-200 by 10, 225-500 by 25, 600-3000 by 100.
const BUCKETS = [];
for (let b = 0; b <= 20; b++) BUCKETS.push(b * 10);
for (let b = 21; b <= 32; b++) BUCKETS.push(200 + (b - 20) * 25);
for (let b = 33; b <= 57; b++) BUCKETS.push(500 + (b - 32) * 100);
Object.freeze(BUCKETS);

function bucketOf(ms) {
  let best = 0;
  for (let b = 1; b < BUCKETS.length; b++) {
    if (Math.abs(BUCKETS[b] - ms) < Math.abs(BUCKETS[best] - ms)) best = b;
  }
  return best;
}

// Newline, or anything that is not a control character or a lone surrogate.
function isTextChar(ch) {
  const c = ch.codePointAt(0);
  return c === 10 || (c >= 32 && (c < 0x7f || c > 0x9f) && (c < 0xd800 || c > 0xdfff));
}

const isCount = (n) => Number.isInteger(n) && n >= 0;

// post: { id: 16 hex chars, createdDay, events: [{ t, pos, del, ins, pauseSec? }] }
export async function encode({ id, createdDay, events }) {
  if (!/^[0-9a-f]{16}$/.test(id)) throw new Error('bad post id');
  if (events.length > MAX_EVENTS) throw new Error('too many events');
  const T = new Writer();
  const L = new Writer();
  const N = new Writer();
  const J = new Writer();
  let K = '';
  const text = [];
  let head = 0;

  for (const e of events) {
    const ins = [...e.ins];
    const { pos, del } = e;
    if (!isCount(pos) || !isCount(del) || pos + del > text.length) throw new Error('bad event');
    if (!del && !ins.length) throw new Error('empty event');
    if (!ins.every(isTextChar)) throw new Error('bad character');

    const t = Math.max(0, Math.round(e.t) || 0);
    if (e.pauseSec != null || t > LONG_MS) {
      const sec = e.pauseSec != null ? e.pauseSec : Math.round(t / 1000);
      T.byte(LONG);
      L.varint(Math.min(MAX_PAUSE_S, Math.max(MIN_PAUSE_S, sec)));
    } else {
      T.byte(bucketOf(t));
    }

    let tokens = del + ins.length;
    const target = pos + del;
    if (target !== head) {
      K += JUMP;
      J.varint(target);
      tokens++;
    }
    K += BKSP.repeat(del) + e.ins;
    N.varint(tokens);

    text.splice(pos, del, ...ins);
    if (text.length > MAX_CHARS) throw new Error('text too long');
    head = pos + ins.length;
  }

  const w = new Writer();
  w.bytes(fromHex(id));
  w.varint(createdDay);
  w.varint(0);
  w.varint(events.length);
  const sum = fnv1a(utf8(text.join('')));
  w.byte(sum >>> 24);
  w.byte(sum >>> 16);
  w.byte(sum >>> 8);
  w.byte(sum);
  for (const s of [T.done(), L.done(), N.done(), utf8(K), J.done()]) w.stream(s);
  return toBase64Url(await deflateRaw(w.done()));
}

// Links are untrusted input: every length, count and position is checked.
export async function decode(data) {
  if (!data || data.length > MAX_LINK) throw bad('size');
  const r = new Reader(await inflateRaw(fromBase64Url(data), MAX_RAW));

  const id = toHex(r.take(8));
  const createdDay = r.varint();
  if (r.varint() !== 0) throw bad('flags');
  const n = r.varint();
  if (n > MAX_EVENTS) throw bad('events');
  const s = r.take(4);
  const sum = ((s[0] << 24) | (s[1] << 16) | (s[2] << 8) | s[3]) >>> 0;
  const T = r.stream();
  const L = r.stream();
  const N = r.stream();
  const kBytes = r.stream();
  const J = r.stream();
  r.end();
  if (T.left !== n) throw bad('timing');

  const K = [...fromUtf8(kBytes.take(kBytes.left))];
  const text = [];
  const events = [];
  let k = 0;
  let head = 0;

  for (let i = 0; i < n; i++) {
    const event = {};
    const b = T.byte();
    if (b === LONG) {
      event.pauseSec = L.varint();
      if (event.pauseSec < MIN_PAUSE_S) throw bad('pause');
      event.t = event.pauseSec * 1000;
    } else if (b < BUCKETS.length) {
      event.t = BUCKETS[b];
    } else {
      throw bad('bucket');
    }

    let tokens = N.varint();
    if (!tokens || tokens > K.length - k) throw bad('count');

    let cursor = head;
    if (K[k] === JUMP) {
      cursor = J.varint();
      if (cursor > text.length) throw bad('jump');
      k++;
      tokens--;
    }
    let del = 0;
    while (tokens && K[k] === BKSP) {
      del++;
      k++;
      tokens--;
    }
    if (del > cursor) throw bad('delete');
    const ins = K.slice(k, k + tokens);
    k += tokens;
    if (!ins.every(isTextChar)) throw bad('char');
    if (!del && !ins.length) throw bad('empty');

    const pos = cursor - del;
    text.splice(pos, del, ...ins);
    if (text.length > MAX_CHARS) throw bad('length');
    head = pos + ins.length;

    event.pos = pos;
    event.del = del;
    event.ins = ins.join('');
    events.push(event);
  }

  if (k !== K.length || L.left || N.left || J.left) throw bad('trailing');
  const final = text.join('');
  if (fnv1a(utf8(final)) !== sum) throw bad('checksum');
  return { id, createdDay, events, text: final };
}
