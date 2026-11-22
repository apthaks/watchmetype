import { editedLabel } from './time.js?r=2';
import { GIF_ROOM_MESSAGE } from './gif-model.js?r=2';

// A 600 × 360 layout rendered at 2× for sharper text on phone displays.
const CARD_WIDTH = 600;
const CARD_HEIGHT = 360;
const SCALE = 2;
export const WIDTH = CARD_WIDTH * SCALE;
export const HEIGHT = CARD_HEIGHT * SCALE;
const PAD = 36;
const TEXT_TOP = 28;
const TEXT_BOTTOM = 260;
const MAX_LINES = 4;
const FONT_SIZES = [48, 40, 32];
const SERIF = 'Fraunces, Georgia, serif';
const SANS = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

// Preserve newlines/spaces; prefer word boundaries and never split a grapheme.
export function wrapText(ctx, text, width = CARD_WIDTH - PAD * 2) {
  if (!segmenter) return null;
  const lines = [];
  let offset = 0;
  for (const paragraph of text.split('\n')) {
    let rest = paragraph;
    do {
      const parts = [...segmenter.segment(rest)].map(s => s.segment);
      let line = '', count = 0, space = 0;
      while (count < parts.length && ctx.measureText(line + parts[count]).width <= width) {
        line += parts[count++];
        if (/\s/u.test(parts[count - 1])) space = count;
      }
      if (parts.length && !count) return null;
      if (count < parts.length && space) count = space;
      line = parts.slice(0, count).join('');
      lines.push({ text: line, start: offset });
      offset += [...line].length;
      rest = parts.slice(count).join('');
    } while (rest);
    offset++; // Explicit newline, not a soft wrap.
  }
  return lines;
}

export function createRenderer(canvas, dark, editedAt, size = 32) {
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  const bg = dark ? '#111111' : '#FAFAF7';
  const fg = dark ? '#FAFAF7' : '#111111';
  let fontSize = FONT_SIZES.includes(size) ? size : 32;
  const lineHeight = () => fontSize * 1.4375;
  const postFont = () => { ctx.font = `${fontSize}px ${SERIF}`; ctx.letterSpacing = `${-fontSize * .015}px`; };
  const smallFont = () => { ctx.font = `14px ${SANS}`; ctx.letterSpacing = '0px'; };
  const fitsText = text => {
    const lines = wrapText(ctx, text);
    return lines && lines.length <= MAX_LINES && TEXT_TOP + lines.length * lineHeight() <= TEXT_BOTTOM;
  };
  return {
    get fontSize() { return fontSize; },
    chooseSize(states) {
      for (const candidate of FONT_SIZES) {
        fontSize = candidate;
        postFont();
        if (states.every(state => fitsText(state.text))) return true;
      }
      return false;
    },
    fits(frames) {
      postFont();
      return frames.every(frame => fitsText(frame.text));
    },
    draw(frame) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
      ctx.fillStyle = fg;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      postFont();
      const lines = wrapText(ctx, frame.text);
      if (!fitsText(frame.text)) throw new Error(GIF_ROOM_MESSAGE);
      for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i].text, PAD, TEXT_TOP + fontSize + i * lineHeight());
      if (frame.caret) {
        let row = 0;
        for (let i = 1; i < lines.length; i++) if (frame.cursor >= lines[i].start) row = i;
        const line = lines[row];
        const before = [...line.text].slice(0, Math.max(0, frame.cursor - line.start)).join('');
        const x = PAD + ctx.measureText(before).width;
        ctx.fillRect(x, TEXT_TOP + row * lineHeight() + fontSize * .125, 1.5, fontSize * 1.125);
      }
      smallFont();
      ctx.globalAlpha = .45;
      if (frame.pause) ctx.fillText(frame.pause, PAD, 286);
      const stamp = editedLabel(editedAt);
      if (stamp) ctx.fillText(stamp, PAD, CARD_HEIGHT - 32);
      ctx.textAlign = 'right';
      ctx.fillText('watchmetype.com', CARD_WIDTH - PAD, CARD_HEIGHT - 32);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
      return ctx.getImageData(0, 0, WIDTH, HEIGHT).data;
    },
  };
}
