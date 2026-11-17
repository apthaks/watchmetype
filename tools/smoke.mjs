// Post-deploy smoke test. Checks that a deployed site serves every file,
// sends the security headers, and is running the expected version.
//
//   node tools/smoke.mjs <base-url> [--version 2026.11.17-42] [--env dev|production] [--wait 120]
//
// --version  wait (up to --wait seconds) until /version.json reports it
// --env      dev expects an X-Robots-Tag noindex header; production expects none
//
// If CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are set, they are sent as
// Cloudflare Access service-token headers (for a dev site behind Access).

const args = process.argv.slice(2);
const base = (args[0] || '').replace(/\/+$/, '');
const arg = (name) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const expected = arg('version');
const env = arg('env');
const waitSec = Number(arg('wait') || 120);

if (!/^https?:\/\//.test(base)) {
  console.error('usage: node tools/smoke.mjs <base-url> [--version v] [--env dev|production] [--wait s]');
  process.exit(2);
}

const headers = { 'user-agent': 'watchmetype-smoke', 'cache-control': 'no-cache' };
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  headers['CF-Access-Client-Id'] = process.env.CF_ACCESS_CLIENT_ID;
  headers['CF-Access-Client-Secret'] = process.env.CF_ACCESS_CLIENT_SECRET;
}

const failures = [];
const check = (ok, msg) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!ok) failures.push(msg);
};
const get = (path) => fetch(base + path, { headers, redirect: 'follow' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. The expected version is live (deployments can take a few seconds to propagate).
let live = null;
const deadline = Date.now() + waitSec * 1000;
for (;;) {
  try {
    const res = await get(`/version.json?t=${Date.now()}`);
    if (res.ok) live = await res.json();
  } catch {}
  if (!expected || (live && live.version === expected) || Date.now() > deadline) break;
  await sleep(5000);
}
check(Boolean(live), `/version.json is served${live ? ` (version ${live.version}, commit ${String(live.commit).slice(0, 7)})` : ''}`);
if (expected) check(live && live.version === expected, `live version is ${expected}`);

// 2. Pages and their headers.
const home = await get('/');
const html = await home.text();
check(home.status === 200, `/ returns 200 (got ${home.status})`);
check(/text\/html/.test(home.headers.get('content-type') || ''), '/ is text/html');
check(html.includes('id="write"') && html.includes('/js/app.js'), '/ is the watchmetype app shell');
const csp = home.headers.get('content-security-policy') || '';
check(csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'"), 'Content-Security-Policy is set');
check(home.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options is nosniff');
check(home.headers.get('referrer-policy') === 'no-referrer', 'Referrer-Policy is no-referrer');
const robots = home.headers.get('x-robots-tag') || '';
if (env === 'dev') check(/noindex/.test(robots), 'dev sends X-Robots-Tag: noindex');
if (env === 'production') check(!/noindex/.test(robots), 'production is indexable (no noindex header)');

const about = await get('/about');
check(about.status === 200 && (await about.text()).includes('<h1>about</h1>'), '/about returns the about page');

const missing = await get('/this-page-does-not-exist');
check(missing.status === 404, `unknown paths return 404 (got ${missing.status})`);

// 3. Every module and asset the app loads.
const modules = [
  'app.js', 'writer.js', 'player.js', 'recorder.js', 'input-guard.js', 'store.js',
  'codec/index.js', 'codec/v1.js', 'codec/bytes.js',
];
for (const m of modules) {
  const res = await get(`/js/${m}`);
  check(res.ok && /javascript/.test(res.headers.get('content-type') || ''), `/js/${m} is served as JavaScript`);
}
const assets = [
  ['/style.css', /text\/css/],
  ['/fonts/fraunces-sub.woff2', /font\/woff2|octet-stream/],
  ['/og.png', /image\/png/],
  ['/favicon.svg', /image\/svg/],
];
for (const [path, type] of assets) {
  const res = await get(path);
  check(res.ok && type.test(res.headers.get('content-type') || ''), `${path} is served`);
}
const block = await get('/blocklist.json');
let list = null;
try {
  list = await block.json();
} catch {}
check(block.ok && Array.isArray(list), `/blocklist.json is a JSON array${Array.isArray(list) ? ` (${list.length} entries)` : ''}`);

if (failures.length) {
  console.error(`\n${failures.length} smoke check(s) failed for ${base}`);
  process.exit(1);
}
console.log(`\nall smoke checks passed for ${base}`);
