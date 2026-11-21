// Assembles the deployable site in dist/: only the files the site serves,
// plus version.json. Fails if anything the pages reference is missing, if
// the blocklist is malformed, or if anything would make Pages run a Worker.
//
//   node tools/build.mjs [--version 2026.11.17-42] [--commit <sha>] [--run 42] [--strict]
//
// --strict turns the size-budget warnings into failures.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { execSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'dist');

// Everything the site serves. A new file is not deployed until it is listed here.
const SITE = [
  'index.html',
  'about.html',
  '404.html',
  'style.css',
  '_headers',
  'blocklist.json',
  'favicon.svg',
  'icon.png',
  'apple-touch-icon.png',
  'robots.txt',
  'sitemap.xml',
  'fonts/fraunces-sub.woff2',
  'fonts/OFL.txt',
  'js',
];

// Any of these would make Cloudflare Pages run code on requests.
const FORBIDDEN = ['functions', '_worker.js', '_routes.json'];

const BUDGET = { code: 20 * 1024, font: 25 * 1024, total: 50 * 1024 };

const args = process.argv.slice(2);
const arg = (name) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};
const strict = args.includes('--strict');
const inCI = Boolean(process.env.GITHUB_ACTIONS);
const problems = [];
const fail = (msg) => problems.push(msg);
const warn = (msg) => {
  if (strict) fail(msg);
  else console.log(inCI ? `::warning::${msg}` : `warning: ${msg}`);
};

function gitCommit() {
  try {
    return execSync('git rev-parse HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

// 1. Copy the allowlisted files.
for (const name of FORBIDDEN) if (existsSync(join(root, name))) fail(`${name} exists: Pages would run it as a Worker`);
rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const item of SITE) {
  const from = join(root, item);
  if (!existsSync(from)) {
    fail(`missing site file: ${item}`);
    continue;
  }
  cpSync(from, join(out, item), { recursive: true, filter: (src) => !src.split(sep).pop().startsWith('.') });
}

// 2. version.json: what is deployed, for humans, smoke tests and the deploy guard.
const commit = arg('commit') || process.env.GITHUB_SHA || gitCommit();
const version = arg('version') || `local-${commit.slice(0, 7)}`;
const run = Number(arg('run') || process.env.GITHUB_RUN_NUMBER || 0);
const info = { version, run, commit, built: new Date().toISOString() };
writeFileSync(join(out, 'version.json'), JSON.stringify(info, null, 2) + '\n');

// 3. Every local URL the pages reference must exist in dist.
const route = (url) => {
  const path = url.split(/[?#]/)[0];
  if (path === '/') return 'index.html';
  if (!/\.[a-z0-9]+$/i.test(path)) return path.slice(1) + '.html';
  return path.slice(1);
};
for (const page of walk(out).filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(page, 'utf8');
  for (const [, url] of html.matchAll(/(?:href|src)="(\/[^"]*)"/g)) {
    if (!existsSync(join(out, route(url)))) fail(`${relative(out, page)} links to ${url}, which is not in dist`);
  }
}
for (const file of walk(join(out, 'js')).filter((f) => f.endsWith('.js'))) {
  const src = readFileSync(file, 'utf8');
  for (const [, spec] of src.matchAll(/(?:import|export)[^'"]*?from\s*'([^']+)'/g)) {
    const target = spec.startsWith('/') ? join(out, spec) : resolve(dirname(file), spec);
    if (!existsSync(target)) fail(`${relative(out, file)} imports ${spec}, which is not in dist`);
  }
}

// 4. The blocklist must parse, or the replay screen would silently ignore it.
try {
  const list = JSON.parse(readFileSync(join(out, 'blocklist.json'), 'utf8'));
  if (!Array.isArray(list) || !list.every((key) => /^[0-9a-f]{16}$/.test(key))) {
    fail('blocklist.json must be an array of 16-character lowercase hex keys');
  }
} catch (err) {
  fail(`blocklist.json does not parse: ${err.message}`);
}

// 5. Size budget.
const files = walk(out);
const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const code = files.filter((f) => /\.(html|css|js)$/.test(f) && !f.endsWith('404.html') && !f.endsWith('about.html'));
const codeSize = code.reduce((sum, f) => sum + gz(f), 0);
const fontSize = statSync(join(out, 'fonts/fraunces-sub.woff2'), { throwIfNoEntry: false })?.size || 0;
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
if (codeSize > BUDGET.code) warn(`HTML + CSS + JS is ${kb(codeSize)} gzipped, over the ${kb(BUDGET.code)} budget`);
if (fontSize > BUDGET.font) warn(`font is ${kb(fontSize)}, over the ${kb(BUDGET.font)} budget`);
if (codeSize + fontSize > BUDGET.total) warn(`first load is ${kb(codeSize + fontSize)}, over the ${kb(BUDGET.total)} budget`);

if (problems.length) {
  for (const msg of problems) console.error(inCI ? `::error::${msg}` : `error: ${msg}`);
  process.exit(1);
}
console.log(`built dist/ (${files.length} files) version ${version} commit ${commit.slice(0, 12)}`);
console.log(`first load: code ${kb(codeSize)} gzip + font ${kb(fontSize)} = ${kb(codeSize + fontSize)}`);
