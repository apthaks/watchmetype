// Exercise the shipping fallback protocol even in browsers with OffscreenCanvas.
self.OffscreenCanvas = undefined;
const queued = [];
self.onmessage = event => queued.push(event);
await import('/js/gif-worker.js?r=2');
for (const event of queued) await self.onmessage(event);
