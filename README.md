# watchmetype

Write a post of up to 500 characters and tap Share. You get your text plus a link. Anyone who opens the link watches the post being typed: every pause, typo and fix.

The whole recording lives in the URL fragment (after `#`), so there is no backend, no database and no accounts. The site is plain static files: ES modules, no framework, no dependencies, no build step.

Contributing or working on the code? Read [AGENTS.md](AGENTS.md) first.

## Run it

Needs Node.js 26+ (only for the dev server and tests; older versions accept some truncated links that browsers reject, so one codec test fails). Nothing to install.

```bash
npm run dev      # http://localhost:8788
npm test         # run all tests
npm run preview  # build dist/ and serve it exactly as deployed
```

Type something, click **Share**, then **Watch it** to see the replay. Drafts and shared posts are kept in `localStorage`; clear site data to start fresh.

Opening `index.html` from disk (`file://`) won't work; use the dev server.

## Browser support

Chrome 103+, Safari 16.4+, Firefox 113+ (needs `CompressionStream('deflate-raw')`).

## Removing a reported post

```bash
node tools/blockhash.mjs 'https://watchmetype.com/#1…'
```

Add the printed key to `blocklist.json` and ship it. Readers see "This post has been removed." within about 5 minutes. The key is a hash of the final text, so it answers reports; it isn't a filter.

## Font

[Fraunces](https://github.com/undercasetype/Fraunces), SIL Open Font License (`fonts/OFL.txt`). Subset to weight 400, Latin only. Other scripts fall back to system fonts.
