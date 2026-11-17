// Turns successive textarea values into edit events by diffing them.
// It never interprets keys, so every keyboard, IME, undo and cut goes through
// the same path. No DOM access here: the writer feeds it values.
//
// event: { t, pos, del, ins }  t = ms since the previous event;
// pos/del count code points.

export const MAX_CHARS = 500;
export const MAX_EVENTS = 4000;
export const LONG_PAUSE_MS = 3000;

const CONTROLS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// Line endings become \n, other control characters are dropped.
export function normalize(str) {
  const clean = str.replace(/\r\n?/g, '\n').replace(CONTROLS, '');
  return clean.toWellFormed ? clean.toWellFormed() : clean.replace(LONE_SURROGATE, '�');
}

// a, b: arrays of code points. Returns null when they are equal.
export function diff(a, b) {
  const max = Math.min(a.length, b.length);
  let p = 0;
  while (p < max && a[p] === b[p]) p++;
  let s = 0;
  while (s < max - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  if (p === a.length && p === b.length) return null;
  return { pos: p, del: a.length - p - s, ins: b.slice(p, b.length - s).join('') };
}

const isCount = (n) => Number.isInteger(n) && n >= 0;

export class Recorder {
  // events: an earlier log to continue (a restored draft or an own post).
  // gap: ms to charge to the first new event, so time away shows as a long pause.
  // Throws if the log does not replay cleanly.
  constructor(events = [], gap = 0) {
    this.events = [];
    this.chars = [];
    this.last = null;
    this.gap = 0;
    for (const e of events) {
      if (!e || !isCount(e.pos) || !isCount(e.del) || typeof e.ins !== 'string' || !(e.t >= 0)) {
        throw new Error('bad event');
      }
      const ins = [...e.ins];
      if (e.pos + e.del > this.chars.length || (!e.del && !ins.length) || normalize(e.ins) !== e.ins) {
        throw new Error('bad event');
      }
      this.chars.splice(e.pos, e.del, ...ins);
      if (this.chars.length > MAX_CHARS) throw new Error('too long');
      this.events.push({ t: e.t, pos: e.pos, del: e.del, ins: e.ins });
    }
    if (this.events.length > MAX_EVENTS) throw new Error('too many events');
    if (this.events.length) this.gap = Math.max(gap, LONG_PAUSE_MS + 1);
  }

  get text() {
    return this.chars.join('');
  }

  get full() {
    return this.events.length >= MAX_EVENTS;
  }

  // Feed the textarea's current value. Returns true when the recorder now
  // matches it, false when the change was refused (over a cap); the caller
  // should then put `text` back into the textarea.
  input(value, now) {
    const next = [...normalize(value)];
    const d = diff(this.chars, next);
    if (!d) return true;
    if (next.length > MAX_CHARS || this.full) return false;
    let t = 0;
    if (this.gap) t = this.gap;
    else if (this.last !== null) t = Math.max(0, Math.round(now - this.last));
    this.gap = 0;
    this.last = now;
    this.chars = next;
    this.events.push({ t, ...d });
    return true;
  }
}
