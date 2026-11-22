import { Recorder } from '/js/recorder.js?r=2';
import { encode, decode } from '/js/codec/index.js?r=2';
import { gifPlan, gifStates } from '/js/gif-model.js?r=2';
import { createRenderer } from '/js/gif-render.js?r=2';

const $ = id => document.getElementById(id);
const recorder = new Recorder();
let clock = 0;
for (const ch of 'A thought, taking shpae.') recorder.input(recorder.text + ch, clock += 140);
for (let i = 0; i < 4; i++) recorder.input([...recorder.text].slice(0, -1).join(''), clock += 120);
for (const ch of 'ape.') recorder.input(recorder.text + ch, clock += 160);
clock += 60000;
for (const ch of '\nSometimes it takes a second draft. 🙂') recorder.input(recorder.text + ch, clock += 140);
const model = await decode(await encode({ id: '0123456789abcdef', createdDay: 325,
  editedAt: Date.UTC(2026, 10, 23, 12, 34), events: recorder.events }));
const frames = gifPlan(model);
let url;

$('generate').onclick = async () => {
  $('generate').disabled = true;
  $('status').textContent = 'making gif…';
  await document.fonts.load('32px Fraunces');
  const dark = $('theme').value === 'dark';
  const renderer = createRenderer($('final'), dark, model.editedAt);
  if (!renderer.chooseSize(gifStates(model))) throw new Error('Sample overflows');
  renderer.draw(frames.at(-1));
  const worker = new Worker($('fallback').checked ? '/tests/browser/gif-fallback-worker.js' : '/js/gif-worker.js?r=2', { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') $('status').textContent = `making gif… ${data.value}%`;
    if (data.type === 'frame') {
      const pixels = renderer.draw(frames[data.index]);
      worker.postMessage({ type: 'pixels', pixels }, [pixels.buffer]);
    }
    if (data.type === 'error') { $('status').textContent = data.message; worker.terminate(); $('generate').disabled = false; }
    if (data.type === 'done') {
      worker.terminate();
      renderer.draw(frames.at(-1));
      if (url) URL.revokeObjectURL(url);
      const blob = new Blob([data.bytes], { type: 'image/gif' });
      url = URL.createObjectURL(blob);
      $('preview').src = url;
      $('preview').hidden = false;
      $('download').href = url;
      $('download').hidden = false;
      $('status').textContent = `ready · ${frames.length} frames · ${(blob.size / 1024).toFixed(0)} KB`;
      $('generate').disabled = false;
    }
  };
  worker.onerror = () => { $('status').textContent = 'worker failed'; $('generate').disabled = false; worker.terminate(); };
  worker.postMessage({ type: 'start', frames, dark, editedAt: model.editedAt, fontSize: renderer.fontSize,
    fontURL: new URL('/fonts/fraunces-sub.woff2', location.href).href });
};
