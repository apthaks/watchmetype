// Post-deploy smoke test. Checks that a deployed site serves every file,
// sends the security headers, and is running the expected version.
//
//   node tools/smoke.mjs <base-url> [--version 2026.11.17-42] [--env stg|prd] [--wait 120]
//
// --version  wait (up to --wait seconds) until /version.json reports it
// --env      stg expects an X-Robots-Tag noindex header; prd expects none
//
// If CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET are set, they are sent as
// Cloudflare Access service-token headers (for a stg site behind Access).

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
  console.error('usage: node tools/smoke.mjs <base-url> [--version v] [--env stg|prd] [--wait s]');
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

// Right after a deploy, some edge locations can still serve the previous
// HTML for a few seconds even though version.json (never cached) is new.
// Bust caches with a query string and retry until the page looks current.
async function fresh(path, looksCurrent) {
  const until = Date.now() + 60000;
  for (;;) {
    const res = await get(`${path}?smoke=${Date.now()}`);
    const body = await res.text();
    if (looksCurrent(body) || Date.now() > until) return { res, body };
    await sleep(5000);
  }
}

// 2. Pages and their headers.
const { res: home, body: html } = await fresh('/', (b) => b.includes('rel="canonical"') && b.includes('application/ld+json'));
check(home.status === 200, `/ returns 200 (got ${home.status})`);
check(/text\/html/.test(home.headers.get('content-type') || ''), '/ is text/html');
check(html.includes('id="write"') && html.includes('/js/app.js'), '/ is the watchmetype app shell');
const csp = home.headers.get('content-security-policy') || '';
check(csp.includes("script-src 'self'") && csp.includes("frame-ancestors 'none'"), 'Content-Security-Policy is set');
check(home.headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options is nosniff');
check(home.headers.get('referrer-policy') === 'no-referrer', 'Referrer-Policy is no-referrer');
const robots = home.headers.get('x-robots-tag') || '';
if (env === 'stg') check(/noindex/.test(robots), 'stg sends X-Robots-Tag: noindex');
if (env === 'prd') check(!/noindex/.test(robots), 'prd is indexable (no noindex header)');

const aboutCanonical = '<link rel="canonical" href="https://watchmetype.com/about">';
const about = await fresh('/about', (b) => b.includes(aboutCanonical));
check(about.res.status === 200 && about.body.includes(aboutCanonical), '/about returns the about page');

const missing = await get('/this-page-does-not-exist');
check(missing.status === 404, `unknown paths return 404 (got ${missing.status})`);

// 3. Every module and asset the app loads.
const modules = [
  'app.js', 'writer.js', 'player.js', 'recorder.js', 'input-guard.js', 'store.js', 'viewport.js',
  'time.js', 'codec/index.js', 'codec/v1.js', 'codec/bytes.js',
];
for (const m of modules) {
  const res = await get(`/js/${m}`);
  check(res.ok && /javascript/.test(res.headers.get('content-type') || ''), `/js/${m} is served as JavaScript`);
}
const assets = [
  ['/style.css', /text\/css/],
  ['/fonts/fraunces-sub.woff2', /font\/woff2|octet-stream/],
  ['/favicon.svg', /image\/svg/],
  ['/icon.png', /image\/png/],
  ['/apple-touch-icon.png', /image\/png/],
];
for (const [path, type] of assets) {
  const res = await get(path);
  check(res.ok && type.test(res.headers.get('content-type') || ''), `${path} is served`);
}
// 4. What search engines read.
check(html.includes('<link rel="canonical" href="https://watchmetype.com/">'), '/ has its canonical link');
check(html.includes('application/ld+json'), '/ has structured data');
const robotsTxt = await get('/robots.txt');
const robotsBody = robotsTxt.ok ? await robotsTxt.text() : '';
check(/Sitemap: https:\/\/watchmetype\.com\/sitemap\.xml/.test(robotsBody) && !/Disallow:\s*\/\s*$/m.test(robotsBody), '/robots.txt allows crawling and names the sitemap');
const sitemap = await get('/sitemap.xml');
const sitemapBody = sitemap.ok ? await sitemap.text() : '';
check(sitemapBody.includes('<loc>https://watchmetype.com/</loc>') && sitemapBody.includes('<loc>https://watchmetype.com/about</loc>'), '/sitemap.xml lists / and /about');

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
