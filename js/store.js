// Storage may be unavailable. Posts use { id, day, at, events }, packed as rows.

const DRAFT = 'wmt:draft';
const POSTS = 'wmt:posts';
const KEEP = 50;

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const pack = (p) => ({ id: p.id, day: p.day, at: p.at, events: p.events.map((e) => [e.t, e.pos, e.del, e.ins]) });

function unpack(p) {
  try {
    if (typeof p.id !== 'string' || !Array.isArray(p.events)) return null;
    return {
      id: p.id,
      day: p.day,
      at: p.at,
      events: p.events.map(([t, pos, del, ins]) => ({ t, pos, del, ins })),
    };
  } catch {
    return null;
  }
}

export const loadDraft = () => unpack(read(DRAFT));

export const saveDraft = (draft) => write(DRAFT, pack(draft));

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT);
  } catch {}
}

function posts() {
  const list = read(POSTS);
  return Array.isArray(list) ? list : [];
}

export function getPost(id) {
  const hit = posts().find((p) => p && p.id === id);
  return hit ? unpack(hit) : null;
}

export function savePost(post) {
  const list = posts().filter((p) => p && p.id !== post.id);
  list.push(pack(post));
  while (list.length > KEEP) list.shift();
  // If storage is full, drop the oldest posts until this one fits.
  while (!write(POSTS, list) && list.length > 1) list.shift();
}
