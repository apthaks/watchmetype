import { GIFEncoder, quantize, applyPalette } from './vendor/gifenc.js?r=2';
import { createRenderer, WIDTH, HEIGHT } from './gif-render.js?r=2';
import { GIF_LIMITS } from './gif-model.js?r=2';

let encoder, frames, index, pending;

function flush() {
  if (!pending) return;
  const palette = quantize(pending.pixels, 256);
  const bitmap = applyPalette(pending.pixels, palette);
  encoder.writeFrame(bitmap, WIDTH, HEIGHT, { palette, delay: pending.delay, repeat: 0, dispose: 1 });
  if (encoder.bytesView().length > GIF_LIMITS.bytes) throw new Error('This GIF is too large. Share it as a link.');
}

function accept(pixels, delay) {
  // Keep at most two RGBA frames in memory, never the whole rendered animation.
  if (pending && pixels.every((value, i) => value === pending.pixels[i])) pending.delay += delay;
  else {
    flush();
    pending = { pixels, delay };
  }
  postMessage({ type: 'progress', value: Math.round((index + 1) / frames.length * 100) });
}

function finish() {
  flush();
  pending = null;
  encoder.finish();
  const bytes = encoder.bytes();
  if (bytes.length > GIF_LIMITS.bytes) throw new Error('This GIF is too large. Share it as a link.');
  postMessage({ type: 'done', bytes }, [bytes.buffer]);
}

async function start(message) {
  frames = message.frames;
  index = 0;
  pending = null;
  encoder = GIFEncoder();
  let renderer;
  try {
    const font = new FontFace('Fraunces', `url(${message.fontURL})`);
    await font.load();
    self.fonts.add(font);
    renderer = createRenderer(new OffscreenCanvas(WIDTH, HEIGHT), message.dark, message.editedAt, message.fontSize);
  } catch {
    // Regular Canvas can render on the page; encoding still stays in this worker.
    postMessage({ type: 'frame', index });
    return;
  }
  if (!renderer.fits(frames)) {
    // Worker font fallback can differ for emoji or non-Latin scripts. Use the
    // page renderer that already passed the layout check, keeping its size.
    postMessage({ type: 'frame', index });
    return;
  }
  for (; index < frames.length; index++) accept(renderer.draw(frames[index]), frames[index].delay);
  finish();
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'start') await start(data);
    else if (data.type === 'pixels') {
      accept(data.pixels, frames[index].delay);
      if (++index === frames.length) finish();
      else postMessage({ type: 'frame', index });
    }
  } catch (err) {
    postMessage({ type: 'error', message: err.message || 'Couldn’t make this GIF. Try sharing the link.' });
  }
};
