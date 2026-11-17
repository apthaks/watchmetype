# AGENTS.md

Read this before changing code. It applies to humans and AI agents alike.

## What this is

**watchmetype** is a static site. Someone writes a post (up to 500 characters) and shares a link; anyone who opens it watches the post being typed. Positioning: "witnessed, not proven". A replay shows the text was typed, not who typed it.

**The whole post lives in the URL fragment** (`https://watchmetype.com/#1<data>`). Browsers never send the fragment to a server, so there is no backend, database, accounts or analytics. `index.html` shows the writer when there is no hash and the player when there is one.

## Hard rules

Breaking any of these is a bug, even if tests pass.

1. **Static only.** Cloudflare Pages serves plain files. No `functions/`, `_worker.js` or `_routes.json` (`tools/build.mjs` fails on them).
2. **No dependencies, frameworks or build step for the site.** Plain ES modules served as written. Node is for tests and `tools/` only.
3. **No third-party requests.** CSP in `_headers` is `'self'` only: no inline `<script>`, no `style=""`, no CDN.
4. **Post text reaches the page only via `textContent` or text nodes. Never `innerHTML`.** Links are untrusted input.
5. **The link format is versioned and frozen.** `js/codec/v1.js` (including its delay-bucket table) never changes behaviour. A new format is a new file (`v2.js`) registered in `js/codec/index.js`. Old decoders are never removed.
6. **Golden fixtures are permanent.** Never edit or delete files in `tests/fixtures/v*/`; only add.
7. **Budget (gzipped):** HTML + CSS + JS ≤ 15 KB, font ≤ 25 KB, first load ≤ 50 KB. Replay at 60 fps.
8. **Design:** two colours (`#FAFAF7` / `#111111`, swapped in dark mode), secondary text at 45% opacity. Buttons are plain text: no boxes, shadows, icons or emoji. Motion is fades only.
9. **Branding:** the product name is `watchmetype` (one word, lowercase) in titles, `og:title` and the header. The domain is written `watchmetype.com`.

## Layout

```
index.html            app shell for both screens; modulepreloads every module
about.html, 404.html  static pages
style.css             all styles
_headers              CSP, security and cache headers for Cloudflare Pages
blocklist.json        16-hex-char keys of removed posts
fonts/                fraunces-sub.woff2 + OFL.txt
js/app.js             router: hash → player, no hash → writer
js/recorder.js        pure: diffs successive textarea values into events {t, pos, del, ins}
js/input-guard.js     blocks paste/drop/yank/autocorrect replacement; 500-code-point cap
js/writer.js          writing screen: meter, draft autosave, share, pre-share decode check
js/player.js          replay: rAF virtual clock, controls, pause label, end state, blocklist
js/store.js           localStorage (wmt:draft, wmt:posts), every access in try/catch
js/codec/index.js     version registry; decode(link) takes a full URL, '#…' or bare data
js/codec/v1.js        v1 format: header + T/L/N/K/J streams, deflate-raw, base64url
js/codec/bytes.js     varints, base64url, FNV-1a, capped inflate, LinkError, blockKey
tests/                node --test; helpers.mjs has seeded RNG, simulated typist, payload crafter
tools/serve.mjs       local server that behaves like Pages (/about → about.html, _headers, 404)
tools/build.mjs       builds dist/ from an allowlist, writes version.json, checks links and budget
tools/smoke.mjs       checks a running site
tools/blockhash.mjs   prints the blocklist key for a link
.github/workflows/    test, deploy, rollback
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Serve the repo at http://localhost:8788 |
| `npm test` | Run all tests |
| `npm run build` | Build `dist/` and print sizes |
| `npm run preview` | Build, then serve `dist/` as deployed |
| `node tools/smoke.mjs <url> [--version v] [--env dev\|production]` | Smoke-test a running site |
| `node tools/blockhash.mjs '<link>'` | Print the blocklist key for a link |

## Easy to get wrong

- **Count code points, not UTF-16 units.** Positions, lengths and the 500 cap use `[...str]`. Textarea `maxlength` counts UTF-16, so `input-guard.js` keeps resetting it.
- **The recorder never looks at keys.** It diffs old vs new textarea values. That's why IME, swipe, undo, cut and autocorrect all work. Don't add key handling.
- **Text is normalized before diffing:** CRLF/CR → LF, control characters stripped, lone surrogates → U+FFFD. Encoder and decoder reject anything `normalize()` would change.
- **Composition can't be cancelled.** The writer reconciles with the recorder only when no composition is in progress.
- **Pauses over 3 s** are stored as whole seconds and replay as ~1.2 s with a "paused 3 min" label. Shorter delays round to the frozen bucket table.
- **The decoder is defensive.** Every count, length, jump and delete is bounds-checked; inflate is capped at 64 KB; the final-text checksum must match. Failures are a `LinkError` (`broken` or `version`), never another exception. Add a hostile test for any new field.
- **New served files** must be added to `SITE` in `tools/build.mjs`. New JS modules also go in `tools/smoke.mjs` and the `modulepreload` links in `index.html`.
- **`/fonts/*` is cached for a year as immutable.** A font change means a new file name, updated everywhere it's referenced.
- **Don't change `blockKey()` normalization**, or existing blocklist entries stop matching.
- **The player pauses its clock in background tabs** (frame gaps over 1 s count as 16 ms).
- **Reduced motion** shows the final text at once, with a `play` button.

## Decisions

- **Autocorrect replacement is blocked.** If real iOS testing shows it breaks typing, set `BLOCK_REPLACEMENT = false` in `js/input-guard.js`.
- **Multi-character inserts** (swipe, suggestions) get no special marker in the replay.
- **Blocklist key** = SHA-256 of the NFKC-normalized, lowercased, whitespace-collapsed final text, first 16 hex characters.
- **"Typed in"** is real elapsed time, including long pauses.
- **"continue editing"** appears only for posts shared from the same browser (`wmt:posts`, last 50). New edits extend the same post id.

## Known gaps

- Code is ~17.4 KB gzipped against the 15 KB budget; a minify step would close it.
- No real-device testing yet: iOS keyboard and QuickPath, Gboard, Samsung Keyboard, Japanese/Hindi IME, link survival in WhatsApp, X, etc.
- `report@watchmetype.com` on `/about` is a placeholder until email routing is set up.

## Testing

- Run `npm test` before every commit; everything must pass.
- Codec changes need round-trip fuzz and hostile-input tests.
- Changes that affect links need new golden fixtures, generated with the real encoder.
- UI changes: check in a real browser (`npm run dev`) in light and dark mode and at 375 px width.

## Deployment

- Merging to `main` tests, builds a GitHub Release `vYYYY.MM.DD-N` with `site.tgz`, deploys to **dev** (`watchmetype-dev`), then deploys the same bundle to **production** (`watchmetype`) after manual approval.
- Roll back with **Actions → deploy-version**. `/version.json` shows the live version.
- Never deploy by hand with `wrangler`, never connect the Pages projects to Git, and never rename or delete the production project: shared links depend on its address.
