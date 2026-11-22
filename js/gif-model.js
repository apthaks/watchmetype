import { replaySteps, LEAD_MS, TAIL_MS, pauseLabel } from './replay-timing.js?r=2';

// Product limits, independent of the link format's 500 characters / 4000 edits.
export const GIF_LIMITS = Object.freeze({ chars: 140, events: 300, duration: 30000, bytes: 8 * 1024 * 1024 });
export const FINAL_HOLD_MS = 3000;
export const GIF_ROOM_MESSAGE = 'This recording needs more room. Share it as a link.';
const FRAME_MS = 20; // Avoid very short delays that GIF viewers commonly clamp.

// Include even edits too fast to become separate GIF frames when choosing size.
export function gifStates(model) {
  const chars = [];
  return model.events.map(event => {
    chars.splice(event.pos, event.del, ...event.ins);
    return { text: chars.join('') };
  });
}

export function gifReason(model, fits = () => true) {
  if (!model.events.length || !model.text.trim()) return '';
  if (model.events.length > GIF_LIMITS.events) return 'too many edits for a gif · share by link';
  const steps = replaySteps(model.events);
  const chars = [];
  for (const step of steps) {
    chars.splice(step.pos, step.del, ...step.ins);
    if (chars.length > GIF_LIMITS.chars) return 'too much text for a readable gif · share by link';
    if (!fits(chars.join(''))) return GIF_ROOM_MESSAGE;
  }
  const duration = LEAD_MS + steps.at(-1).at + TAIL_MS + FINAL_HOLD_MS;
  if (!Number.isFinite(duration) || duration > GIF_LIMITS.duration) return 'replay too long for a gif · share by link';
  return '';
}

export function gifPlan(model, fits = () => true) {
  if (!model.events.length || !model.text.trim() || gifReason(model, fits)) return null;
  const steps = replaySteps(model.events);
  const end = LEAD_MS + steps.at(-1).at + TAIL_MS;
  const frames = [{ at: 0, text: '', cursor: 0, pause: '', caret: true }];
  const chars = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    chars.splice(step.pos, step.del, ...step.ins);
    const text = chars.join('');
    const upcoming = steps[i + 1];
    const next = {
      at: Math.round((LEAD_MS + step.at) / FRAME_MS) * FRAME_MS,
      text, cursor: step.pos + step.ins.length,
      pause: upcoming?.pause != null ? pauseLabel(upcoming.pause) : '', caret: true,
    };
    // Changes at the same display instant coalesce without altering the clock.
    if (frames.at(-1).at === next.at) frames[frames.length - 1] = next;
    else frames.push(next);
  }
  const finalAt = Math.round(end / FRAME_MS) * FRAME_MS;
  frames.push({ at: finalAt, text: chars.join(''), cursor: chars.length, pause: '', caret: false });
  return frames.map((frame, i) => ({ ...frame, delay: frames[i + 1] ? frames[i + 1].at - frame.at : FINAL_HOLD_MS }));
}
