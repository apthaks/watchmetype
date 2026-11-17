// Writing screen: textarea + recorder, meter, draft auto-save, share.

import { Recorder, MAX_CHARS, MAX_EVENTS } from './recorder.js';
import { guard } from './input-guard.js';
import { encode, decode } from './codec/index.js';
import { canCompress } from './codec/bytes.js';
import * as store from './store.js';

const EPOCH = Date.UTC(2026, 0, 1);
const SAVE_MS = 300;
const METER_MS = 500;
const HINT_MS = 2500;
const NEAR_EVENTS = MAX_EVENTS * 0.9;
const NEAR_CHARS = MAX_CHARS - 20;
const NEAR_BYTES = 2200; // the meter darkens as the link nears 2.5 KB
const LONG_HINT = 'This draft is getting long — share or start fresh.';

const $ = (id) => document.getElementById(id);

let el; // DOM references, filled on first show
let rec; // Recorder for the current draft
let meta; // { id, day, at } of the current draft
let active = false;
let composing = false;
let refreshGuard;
let built = null; // { n, promise, result } link for the first n events
let saveTimer = 0;
let meterTimer = 0;
let hintTimer = 0;
let labelTimer = 0;

let support = null;
function supported() {
  if (support === null) support = canCompress();
  return support;
}

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fresh() {
  rec = new Recorder();
  meta = { id: newId(), day: Math.max(0, Math.floor((Date.now() - EPOCH) / 86400000)), at: Date.now() };
}

function restore() {
  const draft = store.loadDraft();
  if (draft && /^[0-9a-f]{16}$/.test(draft.id) && Number.isInteger(draft.day) && draft.day >= 0) {
    try {
      const at = draft.at > 0 ? draft.at : Date.now();
      rec = new Recorder(draft.events, Date.now() - at);
      meta = { id: draft.id, day: draft.day, at };
      return;
    } catch {}
  }
  fresh();
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (!rec) return;
  if (rec.events.length) store.saveDraft({ ...meta, events: rec.events });
  else store.clearDraft();
}

function hint(message, sticky) {
  clearTimeout(hintTimer);
  el.hint.textContent = message;
  hintTimer = sticky ? 0 : setTimeout(restHint, HINT_MS);
}

// What the hint line says when nothing else is being announced.
function restHint() {
  clearTimeout(hintTimer);
  hintTimer = 0;
  if (!supported()) el.hint.textContent = 'Please update your browser to use this.';
  else el.hint.textContent = rec.events.length >= NEAR_EVENTS ? LONG_HINT : '';
}

function resize() {
  el.text.style.height = 'auto';
  el.text.style.height = el.text.scrollHeight + 'px';
}

// Build the link for the current events and check it decodes back to the
// same text. A link that fails the check is never shown or shared.
function build() {
  const n = rec.events.length;
  if (built && built.n === n) return built.promise;
  const text = rec.text;
  const promise = (async () => {
    const data = await encode({ id: meta.id, createdDay: meta.day, events: rec.events });
    const back = await decode(data);
    if (back.text !== text) throw new Error('link check failed');
    return { url: `${location.origin}/#${data}`, text };
  })();
  const entry = { n, promise, result: null };
  built = entry;
  promise.then(
    (result) => {
      entry.result = result;
    },
    () => {},
  );
  return promise;
}

function showCount() {
  const n = rec.chars.length;
  el.count.textContent = `${n} / ${MAX_CHARS}`;
  el.count.classList.toggle('near', n >= NEAR_CHARS);
  el.share.disabled = !rec.text.trim() || !supported();
  el.fresh.hidden = !rec.events.length;
}

async function showSize() {
  clearTimeout(meterTimer);
  meterTimer = 0;
  if (!rec.events.length || !supported()) {
    el.size.textContent = '';
    return;
  }
  const n = rec.events.length;
  try {
    const { url } = await build();
    if (!active || rec.events.length !== n) return;
    el.size.textContent = `link ${(url.length / 1000).toFixed(1)} KB`;
    el.size.classList.toggle('near', url.length >= NEAR_BYTES);
  } catch {
    if (active && rec.events.length === n) el.size.textContent = '';
  }
}

// Put the recorder's text back when the textarea holds something it refused
// or cleaned (over a cap, stripped control characters).
function reconcile() {
  const want = rec.text;
  const have = el.text.value;
  if (have === want) return;
  let caret = 0;
  while (caret < want.length && want[caret] === have[caret]) caret++;
  if (caret && /[\uD800-\uDBFF]/.test(want[caret - 1])) caret--;
  el.text.value = want;
  el.text.setSelectionRange(caret, caret);
}

function onInput(e) {
  const before = rec.events.length;
  rec.input(el.text.value, performance.now());
  if (!composing && !(e && e.isComposing)) reconcile();
  refreshGuard();
  resize();
  showCount();
  if (rec.events.length === before) return;
  meta.at = Date.now();
  el.fallback.hidden = true;
  el.watch.hidden = true;
  if (!hintTimer) restHint();
  if (!saveTimer) saveTimer = setTimeout(save, SAVE_MS);
  clearTimeout(meterTimer);
  meterTimer = setTimeout(showSize, METER_MS);
}

function setLabel(text) {
  clearTimeout(labelTimer);
  el.share.textContent = text;
  labelTimer = setTimeout(() => {
    el.share.textContent = 'share';
  }, 2000);
}

async function onShare() {
  if (el.share.disabled) return;
  let ready;
  try {
    ready = built && built.n === rec.events.length && built.result ? built.result : await build();
  } catch {
    hint('That link didn’t check out, so nothing was shared. Try again.');
    return;
  }
  const { url, text } = ready;
  store.savePost({ ...meta, events: rec.events });
  save();
  el.watch.href = url;
  el.watch.hidden = false;
  const message = `${text}\n\nwatchmetype → ${url}`;

  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ text: message });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(message);
    setLabel('copied');
    return;
  } catch {}
  el.fallback.value = message;
  el.fallback.hidden = false;
  el.fallback.focus();
  el.fallback.select();
  hint('Copy this to share it.', true);
}

function onNew() {
  if (rec.events.length && !confirm('Start a new post? This clears the one you’re writing.')) return;
  store.clearDraft();
  fresh();
  built = null;
  render();
  el.text.focus();
}

function render() {
  el.text.value = rec.text;
  el.fallback.hidden = true;
  el.watch.hidden = true;
  el.share.textContent = 'share';
  refreshGuard();
  resize();
  showCount();
  showSize();
  restHint();
}

function bind() {
  el = {
    screen: $('write'),
    text: $('text'),
    count: $('count'),
    size: $('size'),
    share: $('share'),
    fresh: $('new'),
    watch: $('watch'),
    hint: $('hint'),
    fallback: $('fallback'),
  };
  refreshGuard = guard(el.text, { max: MAX_CHARS, isFull: () => rec.full, hint });
  el.text.addEventListener('input', onInput);
  el.text.addEventListener('compositionstart', () => {
    composing = true;
  });
  el.text.addEventListener('compositionend', () => {
    composing = false;
    // Some browsers fire the last input before compositionend, some after.
    setTimeout(() => active && onInput(), 0);
  });
  el.share.addEventListener('pointerdown', () => {
    if (!el.share.disabled) build().catch(() => {});
  });
  el.share.addEventListener('click', onShare);
  el.fresh.addEventListener('click', onNew);
  addEventListener('resize', () => active && resize());
  addEventListener('pagehide', () => active && save());
  document.addEventListener('visibilitychange', () => {
    if (active && document.visibilityState === 'hidden') save();
  });
}

export function show() {
  if (!el) bind();
  active = true;
  built = null;
  restore();
  el.screen.hidden = false;
  render();
  el.text.focus({ preventScroll: true });
  el.text.setSelectionRange(el.text.value.length, el.text.value.length);
}

export function hide() {
  if (!active) return;
  active = false;
  save();
  clearTimeout(meterTimer);
  clearTimeout(hintTimer);
  hintTimer = 0;
  el.screen.hidden = true;
}
