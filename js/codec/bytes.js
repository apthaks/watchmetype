// Byte-level helpers shared by every codec version:
// varints, base64url, FNV-1a, deflate streams, and the blocklist hash.

export class LinkError extends Error {
  // code: 'broken' (cut off / corrupt) or 'version' (made by a newer format)
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'LinkError';
    this.code = code;
  }
}

export const bad = (detail) => new LinkError('broken', detail);

const MAX_VARINT = 0xffffffff;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export const utf8 = (str) => encoder.encode(str);

export function fromUtf8(bytes) {
  try {
    return decoder.decode(bytes);
  } catch {
    throw bad('utf8');
  }
}

export class Writer {
  constructor() {
    this.out = [];
  }
  byte(b) {
    this.out.push(b & 255);
  }
  bytes(u8) {
    for (let i = 0; i < u8.length; i++) this.out.push(u8[i]);
  }
  varint(n) {
    if (!Number.isInteger(n) || n < 0 || n > MAX_VARINT) throw new RangeError('varint');
    while (n > 127) {
      this.out.push((n & 127) | 128);
      n >>>= 7;
    }
    this.out.push(n);
  }
  stream(u8) {
    this.varint(u8.length);
    this.bytes(u8);
  }
  done() {
    return Uint8Array.from(this.out);
  }
}

export class Reader {
  constructor(u8) {
    this.buf = u8;
    this.at = 0;
  }
  get left() {
    return this.buf.length - this.at;
  }
  byte() {
    if (this.at >= this.buf.length) throw bad('eof');
    return this.buf[this.at++];
  }
  take(n) {
    if (n > this.left) throw bad('eof');
    const part = this.buf.subarray(this.at, this.at + n);
    this.at += n;
    return part;
  }
  varint() {
    let n = 0;
    for (let k = 0; k < 5; k++) {
      const b = this.byte();
      n += (b & 127) * 2 ** (7 * k);
      if (b < 128) {
        if (n > MAX_VARINT || (k && !b)) throw bad('varint');
        return n;
      }
    }
    throw bad('varint');
  }
  stream() {
    return new Reader(this.take(this.varint()));
  }
  end() {
    if (this.left) throw bad('trailing');
  }
}

export function toBase64Url(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(str) {
  if (!/^[A-Za-z0-9_-]*$/.test(str) || str.length % 4 === 1) throw bad('base64');
  let bin;
  try {
    bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    throw bad('base64');
  }
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export function fnv1a(u8) {
  let h = 0x811c9dc5;
  for (let i = 0; i < u8.length; i++) {
    h ^= u8[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');

export function fromHex(hex) {
  const u8 = new Uint8Array(hex.length / 2);
  for (let i = 0; i < u8.length; i++) u8[i] = parseInt(hex.substr(i * 2, 2), 16);
  return u8;
}

export function canCompress() {
  try {
    new CompressionStream('deflate-raw');
    new DecompressionStream('deflate-raw');
    return true;
  } catch {
    return false;
  }
}

// Push bytes through a (de)compression stream. Reading stops as soon as the
// output passes `cap`, so an oversized "zip bomb" link never fills memory.
async function pump(stream, bytes, cap) {
  const writer = stream.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = stream.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      reader.cancel().catch(() => {});
      throw bad('size');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

export const deflateRaw = (bytes) => pump(new CompressionStream('deflate-raw'), bytes, Infinity);

export async function inflateRaw(bytes, cap) {
  try {
    return await pump(new DecompressionStream('deflate-raw'), bytes, cap);
  } catch (err) {
    throw err instanceof LinkError ? err : bad('inflate');
  }
}

// Blocklist key: first 16 hex chars of SHA-256 over the normalized final text.
export async function blockKey(text) {
  const norm = text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const digest = await crypto.subtle.digest('SHA-256', utf8(norm));
  return toHex(new Uint8Array(digest).subarray(0, 8));
}
