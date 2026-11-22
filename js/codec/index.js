// Version registry. The first character of the link data picks the format.
// Every decoder returns the same model, which is all the player ever reads:
//   { id, createdDay, editedAt?, events: [{ t, pos, del, ins, pauseSec? }], text }
// New links always use the newest encoder. Old decoders are never removed.

import * as v1 from './v1.js?r=2';
import { LinkError } from './bytes.js?r=2';

export { LinkError };

const versions = { 1: v1 };
const LATEST = '1';

// Returns the link data: version character + payload (no '#').
export async function encode(post) {
  return LATEST + (await versions[LATEST].encode(post));
}

// Accepts a full URL, a '#…' hash, or bare link data. Throws LinkError only.
export async function decode(link) {
  const str = String(link).trim();
  const data = str.slice(str.indexOf('#') + 1);
  const version = data[0];
  const body = data.slice(1);
  if (!body || !/^[A-Za-z0-9_-]+$/.test(body)) throw new LinkError('broken', 'shape');
  if (!Object.hasOwn(versions, version)) {
    throw new LinkError(/^[2-9A-Z]$/.test(version) ? 'version' : 'broken', 'version');
  }
  try {
    return await versions[version].decode(body);
  } catch (err) {
    throw err instanceof LinkError ? err : new LinkError('broken', String(err));
  }
}
