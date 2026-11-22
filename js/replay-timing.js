// Shared by the interactive replay and GIF export. Codec delays stay frozen.
export const LEAD_MS = 600;
export const PAUSE_MS = 1200;
export const TAIL_MS = 500;

export function replaySteps(events) {
  let at = 0;
  return events.map((e, i) => {
    if (i) at += e.pauseSec != null ? PAUSE_MS : e.t;
    return { at, pos: e.pos, del: e.del, ins: [...e.ins], pause: i ? e.pauseSec : undefined };
  });
}

export function pauseLabel(sec) {
  if (sec < 60) return `paused ${sec} s`;
  if (sec < 3600) return `paused ${Math.round(sec / 60)} min`;
  if (sec < 172800) return `paused ${Math.round(sec / 3600)} h`;
  const days = Math.round(sec / 86400);
  return `paused ${days} ${days === 1 ? 'day' : 'days'}`;
}
