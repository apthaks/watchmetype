# watchmetype

let them watch your words arrive.

Write up to 500 characters and share a typing replay by link, or turn a short post into a GIF. The replay shows every pause, typo and edit.

[Try watchmetype](https://watchmetype.com/) · [How it works](https://watchmetype.com/about)

[![An example watchmetype replay showing words being typed, edited and shared.](docs/example-replay.gif)](https://watchmetype.com/)

## How it works

Pasting is off. Deleted words stay in the replay. Viewers can pause, change the speed or skip to the end; long pauses are shortened during playback.

Sharing by link opens the device’s share sheet where available on mobile, or copies this message:

```text
Your post

watch it → full replay link
```

The recording lives after the `#` in the URL, which browsers don’t send to the server. There are no accounts, no post database and no analytics. Anyone with the full link, including an app you share it through, can access the recording.

Short recordings also offer **make gif** from **share**. Preview the animation, then share or download the GIF alone. It includes watchmetype branding and the recorded GMT edit time. Export happens on your device, with no upload or backend. Longer recordings keep the normal link flow.

When a GIF is unavailable, a muted note below the writer’s share row explains why: too much text, too many edits, a replay that is too long, or text that needs more room. Link sharing stays available. The same note explains when the browser cannot export GIFs.

Your draft and up to 50 recent shared posts are saved in this browser. Open your own link here to **continue editing**. Sharing again creates a new link; earlier links stay unchanged. Clearing site data removes the local drafts and history.

The writer and replay show the same last-edited date and time in GMT, to the minute. This comes from the writer’s device clock and travels in the link. Older links without a timestamp still play.

A replay is a witness, not a proof: it doesn’t establish who wrote the words, whether they’re original, or whether AI was involved.

Contributing or working on the code? Read [AGENTS.md](AGENTS.md) first.

## Run it

Needs Node.js 26+ for local tools and tests. Nothing to install. The site itself is plain HTML, CSS and ES modules, with no compilation. GIF export uses a locally vendored copy of [gifenc 1.0.3](https://github.com/mattdesl/gifenc) (MIT; `js/vendor/gifenc.LICENSE.txt`), loaded only when making a GIF.

```bash
npm run dev      # http://localhost:8788
npm test         # run all tests
npm run preview  # build dist/ and serve it exactly as deployed
node tools/build.mjs --strict  # check assets and enforce size budgets
```

Type something, click **share**, then **watch it** to see the replay. Opening `index.html` from disk (`file://`) won’t work; use the dev server.

## Browser support

Recording and replay require `CompressionStream` and `DecompressionStream` with `deflate-raw` support. The site shows an update message when these are unavailable.

The layout supports light and dark mode, mobile viewport resizing and reduced motion. Real-device keyboard and social-app testing is still needed; see [AGENTS.md](AGENTS.md#known-gaps).

GIF export requires Canvas, Web Workers, `Intl.Segmenter` and font loading. OffscreenCanvas draws in the worker where available; otherwise Canvas draws on the page while encoding stays in the worker. Native file sharing is capability-checked, with a download fallback.

Initial GIF limits: 140 code points throughout the recording, 300 edit events, 30 seconds including the loop holds, four readable lines, and 8 MiB output. Text automatically uses the largest of three sizes (48, 40 or 32 logical pixels) that fits every stage of the recording within the text area, including explicit newlines and wrapping. That size stays fixed throughout playback. Animation uses the same decoded 1× delays and compressed long pauses as replay, rounded to 20 ms display instants. It holds the finished post for three seconds and loops. Settings live in `js/gif-model.js` and `js/gif-render.js`; the local-only `/tests/browser/gif.html` preview compares themes and the Canvas fallback without touching your draft.

GIFs use a wide 600 × 360 layout, drawn at 1200 × 720 for phone displays, with up to 256 colours for smooth text edges. The recorded edit time sits bottom-left and `watchmetype.com` bottom-right; the image has no header or tagline. After choosing **make gif**, the dialog shows GIF generation and file actions; the link option returns when sharing is reopened.

## Deployment and assets

Cloudflare Pages serves only the files listed in `tools/build.mjs`. Merging to `main` tests, packages a versioned release and deploys it to staging. Production receives the same bundle after manual approval. Use the **version** workflow for rollbacks.

Scripts and styles revalidate on page loads; revisioned asset URLs bypass older cached files. Fonts remain cached for a year. If deployment smoke checks report stale cache policies, set Cloudflare’s Browser Cache TTL to **Respect Existing Headers**.

Budgets: 40 KB gzipped total code, 25 KB font and 50 KB first load (excluding the export-only worker and encoder). The README GIF in `docs/` is documentation only and isn’t deployed. Local marketing artwork stays in the ignored `marketing/` folder.

Social metadata requests a compact X card with the caret icon. There is no large promotional preview image; each receiving app controls how it displays a link.

## Removing a reported post

```bash
node tools/blockhash.mjs 'https://watchmetype.com/#1…'
```

Add the printed key to `blocklist.json` and release the change. The player checks the list when a replay opens and caches it for five minutes; it doesn’t poll while playing. Blocking playback on this site can’t erase copies of a recording.

Report a post by sending its full link to [report@watchmetype.com](mailto:report@watchmetype.com).

## Font

[Fraunces](https://github.com/undercasetype/Fraunces), SIL Open Font License (`fonts/OFL.txt`). Subset to weight 400, Latin only. Other scripts fall back to system fonts.
