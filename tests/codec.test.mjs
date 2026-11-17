import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { encode, decode, LinkError } from '../js/codec/index.js';
import { utf8, fnv1a, deflateRaw, toBase64Url, fromBase64Url, Writer, Reader } from '../js/codec/bytes.js';
import { rng, randomSession, typist, sentence, craft } from './helpers.mjs';

const ID = '0123456789abcdef';
const post = (events, day = 42) => ({ id: ID, createdDay: day, events });

async function broken(link, code = 'broken') {
  await assert.rejects(decode(link), (err) => {
    assert.ok(err instanceof LinkError, `expected LinkError, got ${err}`);
    assert.equal(err.code, code);
    return true;
  });
}

// How far a recorded delay may move when it is rounded to its bucket.
const tolerance = (t) => (t <= 200 ? 5 : t <= 500 ? 12.5 : 50);

test('bytes: varints and base64url round trip', () => {
  const w = new Writer();
  const values = [0, 1, 127, 128, 300, 16383, 16384, 2 ** 31, 0xffffffff];
  for (const v of values) w.varint(v);
  const r = new Reader(w.done());
  for (const v of values) assert.equal(r.varint(), v);
  r.end();
  assert.throws(() => new Writer().varint(-1));
  assert.throws(() => new Writer().varint(2 ** 32));
  for (let n = 0; n < 40; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
    assert.deepEqual(fromBase64Url(toBase64Url(bytes)), bytes);
  }
  assert.equal(fnv1a(utf8('')), 0x811c9dc5);
  assert.equal(fnv1a(utf8('a')), 0xe40c292c);
});

test('simple post round trips', async () => {
  const events = [
    { t: 0, pos: 0, del: 0, ins: 'H' },
    { t: 130, pos: 1, del: 0, ins: 'i' },
    { t: 240, pos: 2, del: 0, ins: '!' },
    { t: 900, pos: 2, del: 1, ins: '' },
    { t: 65000, pos: 0, del: 1, ins: 'Oh h' },
  ];
  const link = await encode(post(events));
  assert.match(link, /^1[A-Za-z0-9_-]+$/);
  const back = await decode(link);
  assert.equal(back.id, ID);
  assert.equal(back.createdDay, 42);
  assert.equal(back.text, 'Oh hi');
  assert.deepEqual(back.events, [
    { t: 0, pos: 0, del: 0, ins: 'H' },
    { t: 130, pos: 1, del: 0, ins: 'i' },
    { t: 250, pos: 2, del: 0, ins: '!' },
    { t: 900, pos: 2, del: 1, ins: '' },
    { t: 65000, pauseSec: 65, pos: 0, del: 1, ins: 'Oh h' },
  ]);
});

test('decode accepts a full URL, a hash, or bare data', async () => {
  const link = await encode(post([{ t: 0, pos: 0, del: 0, ins: 'x' }]));
  for (const form of [link, '#' + link, 'https://watchmetype.com/#' + link, `  https://watchmetype.com/#${link}\n`]) {
    assert.equal((await decode(form)).text, 'x');
  }
});

test('fuzz: random edit sessions round trip exactly', async () => {
  const rand = rng(20260101);
  for (let run = 0; run < 300; run++) {
    const rec = randomSession(rand, 1 + Math.floor(rand() * 400));
    if (!rec.events.length) continue;
    const link = await encode(post(rec.events, run));
    const back = await decode(link);
    assert.equal(back.text, rec.text, `run ${run}`);
    assert.equal(back.events.length, rec.events.length);
    rec.events.forEach((e, i) => {
      const d = back.events[i];
      assert.deepEqual([d.pos, d.del, d.ins], [e.pos, e.del, e.ins], `run ${run} event ${i}`);
      if (e.t > 3000) {
        assert.equal(d.pauseSec, Math.max(3, Math.round(e.t / 1000)));
        assert.equal(d.t, d.pauseSec * 1000);
      } else {
        assert.equal(d.pauseSec, undefined);
        assert.ok(Math.abs(d.t - e.t) <= tolerance(e.t), `delay ${e.t} came back ${d.t}`);
      }
    });
    // Re-encoding the decoded model gives the same link.
    assert.equal(await encode({ id: back.id, createdDay: back.createdDay, events: back.events }), link);
  }
});

test('fuzz: sessions at the event cap still fit and round trip', async () => {
  const rand = rng(7);
  const rec = randomSession(rand, 6000);
  assert.equal(rec.events.length, 4000);
  const back = await decode(await encode(post(rec.events)));
  assert.equal(back.text, rec.text);
});

test('encoder refuses input it could not decode', async () => {
  const cases = [
    [{ t: 0, pos: 1, del: 0, ins: 'a' }],
    [{ t: 0, pos: 0, del: 1, ins: 'a' }],
    [{ t: 0, pos: 0, del: 0, ins: '' }],
    [{ t: 0, pos: 0, del: 0, ins: 'a\u0001' }],
    [{ t: 0, pos: 0, del: 0, ins: '\b' }],
    [{ t: 0, pos: 0, del: 0, ins: 'x'.repeat(501) }],
    Array.from({ length: 4001 }, (_, i) => ({ t: 0, pos: 0, del: i ? 1 : 0, ins: 'a' })),
  ];
  for (const events of cases) await assert.rejects(encode(post(events)));
  await assert.rejects(encode({ id: 'nope', createdDay: 0, events: [{ t: 0, pos: 0, del: 0, ins: 'a' }] }));
});

test('golden fixtures: every link ever made keeps working', async () => {
  const root = new URL('./fixtures/', import.meta.url);
  let seen = 0;
  for (const version of readdirSync(root)) {
    const dir = new URL(`${version}/`, root);
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.txt'))) {
      const [link, expected] = readFileSync(new URL(name, dir), 'utf8').split('\n');
      const back = await decode(link);
      assert.equal(back.text, JSON.parse(expected), `${version}/${name}`);
      seen++;
    }
  }
  assert.ok(seen >= 6, 'fixtures are missing');
});

test('hostile: links cut off at any point are rejected', async () => {
  const rec = typist(rng(3), sentence(rng(4), 300));
  const link = await encode(post(rec.events));
  for (let n = 0; n < link.length; n++) await broken(link.slice(0, n));
  await broken('');
  await broken('#');
  await broken('https://watchmetype.com/');
  await broken(link + '=');
  await broken(link + '%20');
  await broken(link + 'AAAA');
});

test('hostile: unknown versions and junk', async () => {
  const link = await encode(post([{ t: 0, pos: 0, del: 0, ins: 'x' }]));
  await broken('2' + link.slice(1), 'version');
  await broken('Z' + link.slice(1), 'version');
  await broken('0' + link.slice(1));
  await broken('about');
  await broken('1' + '!'.repeat(10));
  await broken('__proto__');
  await broken('constructor');
});

test('hostile: random corruption never crashes the decoder', async () => {
  const rand = rng(99);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const rec = randomSession(rng(5), 250);
  const link = await encode(post(rec.events));
  let rejected = 0;
  for (let i = 0; i < 1500; i++) {
    const chars = [...link];
    const flips = 1 + Math.floor(rand() * 3);
    for (let f = 0; f < flips; f++) {
      chars[1 + Math.floor(rand() * (chars.length - 1))] = alphabet[Math.floor(rand() * 64)];
    }
    try {
      const back = await decode(chars.join(''));
      assert.ok([...back.text].length <= 500);
    } catch (err) {
      assert.ok(err instanceof LinkError, `unexpected ${err}`);
      rejected++;
    }
  }
  assert.ok(rejected > 1000);
});

test('hostile: random payloads inside a valid envelope are rejected', async () => {
  const rand = rng(1234);
  for (let i = 0; i < 300; i++) {
    const raw = Uint8Array.from({ length: Math.floor(rand() * 200) }, () => Math.floor(rand() * 256));
    await broken('1' + toBase64Url(await deflateRaw(raw)));
  }
});

test('hostile: oversized payloads are stopped at the cap', async () => {
  const bomb = '1' + toBase64Url(await deflateRaw(new Uint8Array(32 * 1024 * 1024)));
  assert.ok(bomb.length < 90000);
  await broken(bomb);
  await broken('1' + toBase64Url(await deflateRaw(new Uint8Array(65537))));
  await broken('1' + 'A'.repeat(90001));
});

test('hostile: hand-built payloads that break each rule', async () => {
  const sum = (text) => fnv1a(utf8(text));
  // Sanity: the crafting helper produces a valid link when the fields are valid.
  const good = await craft({ n: 2, sum: sum('b'), T: [0, 12], N: [1, 2], K: 'a\bb' });
  assert.equal((await decode(good)).text, 'b');

  const cases = {
    'wrong checksum': { n: 1, sum: sum('b'), T: [0], N: [1], K: 'a' },
    'nonzero flags': { flags: 1, n: 1, sum: sum('a'), T: [0], N: [1], K: 'a' },
    'huge event count': { n: 0xffffffff, sum: sum('a'), T: [0], N: [1], K: 'a' },
    'too many events': { n: 4001, sum: sum(''), T: Array(4001).fill(0), N: Array(4001).fill(1), K: 'a'.repeat(4001) },
    'event count over timing stream': { n: 2, sum: sum('a'), T: [0], N: [1], K: 'a' },
    'timing stream over event count': { n: 1, sum: sum('a'), T: [0, 0], N: [1], K: 'a' },
    'huge token count': { n: 1, sum: sum('a'), T: [0], N: [0xffffffff], K: 'a' },
    'token count past the ops': { n: 1, sum: sum('a'), T: [0], N: [2], K: 'a' },
    'zero token count': { n: 1, sum: sum(''), T: [0], N: [0], K: '' },
    'unused ops': { n: 1, sum: sum('a'), T: [0], N: [1], K: 'ab' },
    'unused counts': { n: 1, sum: sum('a'), T: [0], N: [1, 1], K: 'a' },
    'missing counts': { n: 2, sum: sum('ab'), T: [0, 0], N: [1], K: 'ab' },
    'jump past the text': { n: 2, sum: sum('ab'), T: [0, 0], N: [1, 2], K: 'a\u0001b', J: [2] },
    'huge jump': { n: 2, sum: sum('ab'), T: [0, 0], N: [1, 2], K: 'a\u0001b', J: [0xffffffff] },
    'jump with no target': { n: 2, sum: sum('ab'), T: [0, 0], N: [1, 2], K: 'a\u0001b' },
    'unused jump target': { n: 1, sum: sum('a'), T: [0], N: [1], K: 'a', J: [0] },
    'jump-only event': { n: 2, sum: sum('a'), T: [0, 0], N: [1, 1], K: 'a\u0001', J: [0] },
    'jump after an insert': { n: 1, sum: sum('ab'), T: [0], N: [3], K: 'a\u0001b', J: [0] },
    'delete before the start': { n: 1, sum: sum(''), T: [0], N: [1], K: '\b' },
    'delete more than typed': { n: 2, sum: sum(''), T: [0, 0], N: [1, 2], K: 'a\b\b' },
    'backspace after an insert': { n: 1, sum: sum(''), T: [0], N: [2], K: 'a\b' },
    'control character': { n: 1, sum: sum('a\u0007'), T: [0], N: [2], K: 'a\u0007' },
    'carriage return': { n: 1, sum: sum('\r'), T: [0], N: [1], K: '\r' },
    'invalid utf-8': { n: 1, sum: 0, T: [0], N: [1], K: [0xff] },
    'cut-off utf-8': { n: 1, sum: 0, T: [0], N: [1], K: [0xf0, 0x9f, 0x98] },
    'encoded surrogate': { n: 1, sum: 0, T: [0], N: [1], K: [0xed, 0xa0, 0x80] },
    'undefined delay bucket': { n: 1, sum: sum('a'), T: [58], N: [1], K: 'a' },
    'undefined delay bucket 254': { n: 1, sum: sum('a'), T: [254], N: [1], K: 'a' },
    'long pause with no length': { n: 1, sum: sum('a'), T: [255], N: [1], K: 'a' },
    'long pause too short': { n: 1, sum: sum('a'), T: [255], L: [2], N: [1], K: 'a' },
    'unused pause length': { n: 1, sum: sum('a'), T: [0], L: [9], N: [1], K: 'a' },
    'text over 500 characters': { n: 1, sum: sum('a'.repeat(501)), T: [0], N: [501], K: 'a'.repeat(501) },
    'trailing bytes': { n: 1, sum: sum('a'), T: [0], N: [1], K: 'a', extra: [0] },
  };
  for (const [name, fields] of Object.entries(cases)) {
    await assert.rejects(decode(await craft(fields)), (err) => err instanceof LinkError && err.code === 'broken', name);
  }
});

test('hostile: stream length larger than the payload', async () => {
  const w = new Writer();
  w.bytes(new Uint8Array(8));
  for (const v of [0, 0, 1]) w.varint(v);
  w.bytes([0, 0, 0, 0]);
  w.varint(0xffffffff);
  w.byte(0);
  await broken('1' + toBase64Url(await deflateRaw(w.done())));
  // overlong and unterminated varints
  for (const tail of [[0x80, 0x00], [0xff, 0xff, 0xff, 0xff, 0xff], [0xff, 0xff, 0xff, 0xff, 0x7f]]) {
    const v = new Writer();
    v.bytes(new Uint8Array(8));
    v.bytes(tail);
    await broken('1' + toBase64Url(await deflateRaw(v.done())));
  }
});

test('size budget: a simulated 500-character post stays near 2 KB', async () => {
  const rand = rng(2026);
  const sizes = [];
  for (let i = 0; i < 60; i++) {
    const rec = typist(rand, sentence(rand, 500));
    sizes.push(('https://watchmetype.com/#' + (await encode(post(rec.events)))).length);
  }
  sizes.sort((a, b) => a - b);
  const median = sizes[sizes.length >> 1];
  const worst = sizes[sizes.length - 1];
  console.log(`simulated 500-char links: median ${median} B, worst ${worst} B`);
  assert.ok(median <= 2000, `median ${median}`);
  assert.ok(worst <= 2500, `worst ${worst}`);
});
