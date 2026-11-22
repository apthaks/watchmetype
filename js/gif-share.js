import { gifPlan, gifReason, gifStates } from './gif-model.js?r=2';
import { createRenderer } from './gif-render.js?r=2';

let dialog, worker, objectURL, timer, generation = 0, file;
let measurer;
const $ = id => document.getElementById(id);

export async function gifUnavailable(model) {
  if (!model.text.trim()) return '';
  const reason = gifReason(model);
  if (reason) return reason;
  const unavailable = 'gif unavailable in this browser · share by link';
  if (typeof Worker === 'undefined' || typeof Intl.Segmenter === 'undefined' || typeof HTMLDialogElement === 'undefined') return unavailable;
  try {
    await document.fonts.load('32px Fraunces');
    measurer ||= createRenderer(document.createElement('canvas'), false);
    return gifReason(model, text => measurer.fits([{ text }]));
  } catch { return unavailable; }
}

function stop() {
  generation++;
  worker?.terminate();
  worker = null;
  clearTimeout(timer);
  if (objectURL) URL.revokeObjectURL(objectURL);
  objectURL = null;
  file = null;
  if (dialog) {
    $('gif-preview').removeAttribute('src');
    $('gif-preview').hidden = true;
    $('download-gif').removeAttribute('href');
    $('gif-file-actions').hidden = true;
  }
}

export function closeGifShare() {
  if (!dialog) return;
  stop();
  if (dialog.open) dialog.close();
}

function fail(message) {
  generation++;
  worker?.terminate();
  worker = null;
  clearTimeout(timer);
  $('gif-status').textContent = message;
  $('make-gif').hidden = false;
  $('make-gif').textContent = 'try gif again';
}

async function generate(frames, renderer, model, dark) {
  stop();
  const mine = generation;
  $('share-title').textContent = 'gif';
  $('share-link').hidden = true;
  $('make-gif').hidden = true;
  $('gif-preview').hidden = true;
  $('gif-file-actions').hidden = true;
  $('gif-status').textContent = 'making gif… 0%';
  const watchdog = () => {
    clearTimeout(timer);
    timer = setTimeout(() => fail('GIF export took too long. Try again, or close to share by link.'), 45000);
  };
  try {
    worker = new Worker(new URL('./gif-worker.js?r=2', import.meta.url), { type: 'module' });
    worker.onerror = () => { if (mine === generation) fail('Couldn’t make this GIF. Try again, or close to share by link.'); };
    worker.onmessage = ({ data }) => {
      if (mine !== generation) return;
      watchdog();
      try {
        if (data.type === 'progress') $('gif-status').textContent = `making gif… ${data.value}%`;
        else if (data.type === 'frame') {
          const pixels = renderer.draw(frames[data.index]);
          worker.postMessage({ type: 'pixels', pixels }, [pixels.buffer]);
        } else if (data.type === 'error') fail(data.message);
        else if (data.type === 'done') {
          clearTimeout(timer);
          worker.terminate();
          worker = null;
          file = new File([data.bytes], 'watchmetype.gif', { type: 'image/gif' });
          objectURL = URL.createObjectURL(file);
          const preview = $('gif-preview');
          preview.src = objectURL;
          preview.hidden = false;
          const download = $('download-gif');
          download.href = objectURL;
          $('gif-status').textContent = `gif ready · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
          $('gif-file-actions').hidden = false;
          let canShare = false;
          try { canShare = Boolean(navigator.share && navigator.canShare?.({ files: [file] })); } catch {}
          $('share-gif').hidden = !canShare;
        }
      } catch {
        fail('Couldn’t make this GIF. Try again, or close to share by link.');
      }
    };
    watchdog();
    worker.postMessage({ type: 'start', frames, dark, editedAt: model.editedAt, fontSize: renderer.fontSize,
      fontURL: new URL('../fonts/fraunces-sub.woff2', import.meta.url).href });
  } catch {
    fail('GIF export is unavailable here. Close to share by link.');
  }
}

// False means the writer should continue with its existing link-sharing flow.
export async function openGifShare(model, shareLink, isCurrent) {
  if (await gifUnavailable(model)) return false;
  const frames = gifPlan(model);
  if (!frames) return false;
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  if (!isCurrent()) return true;
  const renderer = createRenderer(document.createElement('canvas'), dark, model.editedAt);
  if (!renderer.chooseSize(gifStates(model))) return false;
  if (!dialog) {
    dialog = $('share-dialog');
    // A previously queued close event must not stop an already reopened dialog.
    dialog.addEventListener('close', () => { if (!dialog.open) stop(); });
    dialog.addEventListener('cancel', stop);
    $('close-share').addEventListener('click', closeGifShare);
    $('share-gif').addEventListener('click', async () => {
      if (!file) return;
      const shared = file;
      const mine = generation;
      try { await navigator.share({ files: [shared] }); }
      catch (err) {
        if (mine === generation && shared === file && err?.name !== 'AbortError') $('gif-status').textContent = 'Sharing is unavailable. Download the GIF instead.';
      }
    });
  }
  closeGifShare();
  $('gif-preview').hidden = true;
  $('gif-file-actions').hidden = true;
  $('share-title').textContent = 'share';
  $('share-link').hidden = false;
  $('gif-status').textContent = 'Share a link, or make a gif of this replay.';
  $('make-gif').hidden = false;
  $('make-gif').textContent = 'make gif';
  $('make-gif').onclick = () => generate(frames, renderer, model, dark);
  $('share-link').onclick = () => { closeGifShare(); if (isCurrent()) shareLink(); };
  dialog.showModal();
  // Start on the dialog itself; Tab still gives its buttons a visible focus ring.
  dialog.focus({ preventScroll: true });
  return true;
}
