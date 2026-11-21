import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encode, decode, LinkError } from '../js/codec/index.js';
import { Writer, Reader, deflateRaw, inflateRaw, toBase64Url, fromBase64Url, fnv1a, utf8 } from '../js/codec/bytes.js';
import { showEdited } from '../js/time.js';
import { rng, randomSession, craft } from './helpers.mjs';

const post = { id: '0123456789abcdef', createdDay: 325,
  editedAt: Date.UTC(2026, 10, 22, 16, 45, 59, 999),
  events: [{ t: 0, pos: 0, del: 0, ins: 'A thought. 🙂' }] };

test('edit date: writer and shared replay display the same recorded GMT minute', async () => {
  const writer = {}, replay = {};
  showEdited(writer, post.editedAt);
  const link = await encode(post);
  assert.ok(link.startsWith('1'));
  const back = await decode(link);
  assert.equal(back.editedAt, Date.UTC(2026, 10, 22, 16, 45));
  assert.equal(back.createdDay, post.createdDay);
  showEdited(replay, back.editedAt);
  assert.deepEqual(replay, writer);
  assert.equal(replay.textContent, 'edited 22 Nov 2026 · 16:45 GMT');
  assert.equal(replay.dateTime, '2026-11-22T16:45:00.000Z');
});

test('edit date: GMT date changes at midnight, and missing timestamps stay hidden', () => {
  const node = {};
  showEdited(node, Date.UTC(2026, 11, 31, 23, 59, 59));
  assert.equal(node.textContent, 'edited 31 Dec 2026 · 23:59 GMT');
  showEdited(node, Date.UTC(2027, 0, 1));
  assert.equal(node.textContent, 'edited 01 Jan 2027 · 00:00 GMT');
  showEdited(node, 0);
  assert.equal(node.textContent, 'edited 01 Jan 1970 · 00:00 GMT');
  showEdited(node, undefined);
  assert.equal(node.hidden, true);
});

test('edit date: original fixtures have no invented last-edit time', async () => {
  const [link] = readFileSync(new URL('./fixtures/v1/typing.txt', import.meta.url), 'utf8').split('\n');
  assert.equal((await decode(link)).editedAt, undefined);
});

test('edit date: randomized sessions and timestamp boundaries round trip', async () => {
  const rand = rng(20261122);
  for (let run = 0; run < 120; run++) {
    const rec = randomSession(rand, 1 + Math.floor(rand() * 300));
    const editedAt = Math.floor(rand() * 0x100000000) * 60000;
    const back = await decode(await encode({ ...post, events: rec.events, editedAt }));
    assert.equal(back.text, rec.text);
    assert.equal(back.editedAt, editedAt);
    assert.equal(await encode(back), await encode({ ...post, events: rec.events, editedAt }));
  }
  for (const editedAt of [0, 127 * 60000, 128 * 60000, 0xffffffff * 60000 + 59999]) {
    assert.equal((await decode(await encode({ ...post, editedAt }))).editedAt, Math.floor(editedAt / 60000) * 60000);
  }
  for (const editedAt of [-1, NaN, Infinity, 'today', 1.5, 0x100000000 * 60000]) {
    await assert.rejects(encode({ ...post, editedAt }));
  }
});

test('edit date: timestamped links reject truncation and malformed timestamp fields', async () => {
  const broken = link => assert.rejects(decode(link), err => err instanceof LinkError && err.code === 'broken');
  const link = await encode(post);
  for (let n = 0; n < link.length; n++) await broken(link.slice(0, n));
  const raw = await inflateRaw(fromBase64Url(link.slice(1)), 65536);
  const r = new Reader(raw);
  r.take(8);
  r.varint();
  r.varint();
  const start = r.at;
  r.varint();
  const tail = raw.slice(r.at);
  for (const field of [[], [0x80], [0x80, 0], [0xff, 0xff, 0xff, 0xff, 0x7f], [0xff, 0xff, 0xff, 0xff, 0xff]]) {
    const w = new Writer();
    w.bytes(raw.slice(0, start));
    w.bytes(field);
    if (field.length > 1) w.bytes(tail);
    await broken('1' + toBase64Url(await deflateRaw(w.done())));
  }
  await broken(await craft({ flags: 3, n: 1, sum: fnv1a(utf8('x')), T: [0], N: [1], K: 'x' }));
});

test('edit date: corrupt timestamped payloads always fail with LinkError or decode safely', async () => {
  const rand = rng(22);
  const link = await encode(post);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  for (let i = 0; i < 300; i++) {
    const chars = [...link];
    chars[1 + Math.floor(rand() * (chars.length - 1))] = alphabet[Math.floor(rand() * 64)];
    try {
      const back = await decode(chars.join(''));
      assert.ok(back.editedAt == null || Number.isSafeInteger(back.editedAt));
      assert.ok([...back.text].length <= 500);
    } catch (err) {
      assert.ok(err instanceof LinkError);
    }
  }
});
