// Replay screen: decodes the link, then plays the events back on a virtual
// clock driven by requestAnimationFrame. It only ever reads the decoded
// model, and puts text on the page only through text nodes.

import { decode } from './codec/index.js';
import { canCompress, blockKey } from './codec/bytes.js';
import * as store from './store.js';

const LEAD_MS = 600; // wait before the first character
const PAUSE_MS = 1200; // how long a long pause plays for
const TAIL_MS = 500; // rest after the last edit before the end state
const TYPING_MS = 450; // caret stays solid this long after an edit
const LIST_TTL = 300000;

const BROKEN = 'This link looks incomplete — the app you opened it in may have cut it off.';
const NEWER = 'This link was made by a newer version — refresh the page.';
const OLD_BROWSER = 'Please update your browser to view this.';
const REMOVED = 'This post has been removed.';

const $ = (id) => document.getElementById(id);

let el;
let active = false;
let token = 0; // bumps on every show/hide so stale async work is dropped

// playback state
let post = null;
let steps = []; // [{ at, pos, del, ins: [code points], pause }]
let chars = [];
let cursor = 0;
let next = 0; // index of the next step to apply
let clock = 0;
let speed = 1;
let playing = false;
let ended = false;
let played = false;
let frame = 0;
let lastFrame = 0;
let lastEdit = 0;
let typing = false;
let labelShown = false;

let listCache = null;
let listTime = 0;

function blocklist() {
  if (!listCache || Date.now() - listTime > LIST_TTL) {
    listTime = Date.now();
    listCache = fetch('/blocklist.json')
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => (Array.isArray(list) ? list : []))
      .catch(() => []);
  }
  return listCache;
}

function plural(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function pauseLabel(sec) {
  if (sec < 60) return `paused ${sec} s`;
  if (sec < 3600) return `paused ${Math.round(sec / 60)} min`;
  if (sec < 172800) return `paused ${Math.round(sec / 3600)} h`;
  return `paused ${plural(Math.round(sec / 86400), 'day')}`;
}

function duration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

function draw() {
  el.before.data = chars.slice(0, cursor).join('');
  el.after.data = chars.slice(cursor).join('');
}

function apply(step) {
  chars.splice(step.pos, step.del, ...step.ins);
  cursor = step.pos + step.ins.length;
}

function setTyping(on) {
  if (typing === on) return;
  typing = on;
  el.stage.classList.toggle('typing', on);
}

function setLabel(on, sec) {
  if (on && !labelShown) el.paused.textContent = pauseLabel(sec);
  if (labelShown !== on) el.paused.classList.toggle('on', on);
  labelShown = on;
}

// One control row that never changes height: the first button is
// pause / play while running and replay at the end; skip (the last item)
// gives way to the stats line, right-aligned in the same row.
function controls() {
  if (ended) el.toggle.textContent = played ? 'replay' : 'play';
  else el.toggle.textContent = playing ? 'pause' : 'play';
  el.skip.hidden = ended;
  for (const b of el.speeds) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === speed));
  el.stage.classList.toggle('done', ended);
  el.stats.hidden = !ended;
}

function rewind() {
  cancelAnimationFrame(frame);
  chars = [];
  cursor = 0;
  next = 0;
  clock = -LEAD_MS;
  ended = false;
  playing = false;
  setTyping(false);
  setLabel(false);
  draw();
}

function finish() {
  cancelAnimationFrame(frame);
  while (next < steps.length) apply(steps[next++]);
  playing = false;
  ended = true;
  setTyping(false);
  setLabel(false);
  draw();
  controls();
}

function tick(now) {
  if (!playing) return;
  // A gap this long means the tab was in the background, where frames stop:
  // pick up where it left off instead of jumping ahead.
  const elapsed = now - lastFrame;
  clock += (elapsed > 1000 ? 16 : elapsed) * speed;
  lastFrame = now;

  let edited = false;
  while (next < steps.length && steps[next].at <= clock) {
    apply(steps[next++]);
    edited = true;
  }
  if (edited) {
    draw();
    lastEdit = now;
    setTyping(true);
  } else if (typing && now - lastEdit > TYPING_MS) {
    setTyping(false);
  }

  const upcoming = steps[next];
  setLabel(Boolean(upcoming && upcoming.pause != null && next > 0), upcoming && upcoming.pause);

  if (next >= steps.length && clock >= steps[steps.length - 1].at + TAIL_MS) {
    finish();
    return;
  }
  frame = requestAnimationFrame(tick);
}

function play() {
  if (ended) rewind();
  played = true;
  playing = true;
  lastFrame = performance.now();
  controls();
  frame = requestAnimationFrame(tick);
}

function pause() {
  playing = false;
  cancelAnimationFrame(frame);
  setTyping(false);
  controls();
}

function toggle() {
  if (!post) return;
  if (playing) pause();
  else play();
}

function skip() {
  if (!post || ended) return;
  played = true;
  finish();
}

function setSpeed(value) {
  speed = value;
  if (post) controls();
}

function start(model) {
  post = model;
  let at = 0;
  let total = 0;
  let deletions = 0;
  steps = model.events.map((e, i) => {
    if (i) {
      at += e.pauseSec != null ? PAUSE_MS : e.t;
      total += e.t;
    }
    deletions += e.del;
    return { at, pos: e.pos, del: e.del, ins: [...e.ins], pause: i ? e.pauseSec : undefined };
  });

  el.final.textContent = model.text;
  el.stats.textContent = `typed in ${duration(total)} · ${plural(deletions, 'deletion')}`;
  el.keep.hidden = !store.getPost(model.id);
  el.stage.hidden = false;
  el.controls.hidden = false;
  el.own.hidden = false;
  played = false;
  rewind();

  if (!steps.length || matchMedia('(prefers-reduced-motion: reduce)').matches) finish();
  else play();
}

function clear() {
  cancelAnimationFrame(frame);
  post = null;
  playing = false;
  steps = [];
  for (const node of [el.stage, el.controls, el.stats, el.notice, el.keep, el.own]) node.hidden = true;
  el.final.textContent = '';
  el.paused.classList.remove('on');
  labelShown = false;
}

function fail(message) {
  clear();
  el.notice.textContent = message;
  el.notice.hidden = false;
  el.own.hidden = false;
}

// Reload this post's saved log into the writing screen. New edits are added
// to the end, and sharing again keeps the same post id.
function keepEditing() {
  if (!post) return;
  const saved = store.getPost(post.id);
  if (!saved) return;
  const draft = store.loadDraft();
  if (!draft || draft.id !== saved.id) {
    const shared = draft && store.getPost(draft.id);
    const unshared = draft && draft.events.length && !(shared && shared.events.length === draft.events.length);
    if (unshared && !confirm('Replace the post you’re writing with this one?')) return;
    store.saveDraft(saved);
  }
  history.pushState(null, '', location.pathname);
  dispatchEvent(new PopStateEvent('popstate'));
}

function onKey(e) {
  if (!active || !post || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === ' ') {
    if (e.target.closest && e.target.closest('button, a')) return;
    e.preventDefault();
    toggle();
  } else if (e.key === '1' || e.key === '2' || e.key === '5') {
    setSpeed(Number(e.key));
  } else if (e.key === 'ArrowRight') {
    skip();
  }
}

function bind() {
  el = {
    screen: $('replay'),
    paused: $('paused'),
    stage: $('stage'),
    final: $('final'),
    notice: $('notice'),
    controls: $('controls'),
    toggle: $('toggle'),
    skip: $('skip'),
    stats: $('stats'),
    keep: $('continue'),
    own: $('own'),
    speeds: [...document.querySelectorAll('[data-speed]')],
    before: document.createTextNode(''),
    after: document.createTextNode(''),
  };
  const caret = document.createElement('span');
  caret.className = 'caret';
  el.stage.append(el.before, caret, el.after);

  el.toggle.addEventListener('click', toggle);
  el.skip.addEventListener('click', skip);
  el.keep.addEventListener('click', keepEditing);
  for (const b of el.speeds) b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
  document.addEventListener('keydown', onKey);
}

export async function show(link) {
  if (!el) bind();
  const mine = ++token;
  active = true;
  clear();
  el.screen.hidden = false;
  if (!canCompress()) {
    fail(OLD_BROWSER);
    return;
  }
  const list = blocklist();
  let model;
  try {
    model = await decode(link);
  } catch (err) {
    if (mine === token) fail(err && err.code === 'version' ? NEWER : BROKEN);
    return;
  }
  if (mine !== token) return;
  start(model);

  // The blocklist never holds up the replay; a match takes the post down.
  try {
    const blocked = await list;
    if (blocked.length && blocked.includes(await blockKey(model.text)) && mine === token) fail(REMOVED);
  } catch {}
}

export function hide() {
  if (!active) return;
  active = false;
  token++;
  clear();
  el.screen.hidden = true;
}
