// Prints the blocklist key for a reported link. Add the key to
// blocklist.json and push; the post stops playing within minutes.
//   node tools/blockhash.mjs 'https://watchmetype.com/#1…'

import { decode } from '../js/codec/index.js';
import { blockKey } from '../js/codec/bytes.js';

const link = process.argv[2];
if (!link) {
  console.error("usage: node tools/blockhash.mjs '<link>'");
  process.exit(1);
}

try {
  const post = await decode(link);
  console.log(await blockKey(post.text));
  console.error(`post ${post.id}: ${JSON.stringify(post.text)}`);
} catch (err) {
  console.error(`could not read that link (${err.message})`);
  process.exit(1);
}
