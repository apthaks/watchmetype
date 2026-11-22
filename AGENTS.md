# AGENTS.md

Read this before changing code. It applies to humans and AI agents alike.

## What this is

**watchmetype** is a static site. Someone writes a post (up to 500 characters) and shares a link. Anyone who opens the link watches the post being typed. The positioning is "witnessed, not proven": a replay shows the text was typed, not who typed it.

The whole post lives in the URL fragment (`https://watchmetype.com/#1<data>`), which browsers never send to a server. So there is no backend, database, accounts or analytics. `index.html` shows the writer when there is no hash and the replay when there is one.

Ignored local planning and deployment notes may be out of date. This file and the code are the source of truth.

## Hard rules

Breaking any of these is a bug, even if tests pass.

1. **Static only.** Cloudflare Pages serves plain files. No `functions/`, `_worker.js` or `_routes.json`.
2. **No dependencies, frameworks or build step for the site.** Plain ES modules, served as written. Node is for tests and `tools/` only.
3. **No third-party requests.** The CSP in `_headers` allows `'self'` only: no inline `<script>`, no `style=""`, no CDN.
4. **Post text reaches the page only via `textContent` or text nodes, never `innerHTML`.** Links are untrusted input.
5. **Keep links compatible.** V1 is pre-release; changes are allowed when explicitly requested. Preserve decoding of original v1 links and all golden fixtures. Once released, freeze `js/codec/v1.js`, including its delay table; later formats use a new file registered in `js/codec/index.js`. Old decoders are never removed.
6. **Golden fixtures are permanent.** In `tests/fixtures/v*/`, only add files; never edit or delete.
7. **Budget (gzipped):** code (HTML + CSS + JS) ≤ 20 KB, font ≤ 25 KB, first load ≤ 50 KB. Replay at 60 fps.
8. **Design:**
   - Two colours: `#FAFAF7` and `#111111`, swapped in dark mode. Secondary text at 45% opacity.
   - Buttons are plain text: no boxes, shadows, icons or emoji.
   - Motion is fades only.
9. **Branding:** the name is always `watchmetype`, one lowercase word. The domain is written `watchmetype.com`.

## Layout

```
index.html            writer + replay shell, home SEO tags and JSON-LD
about.html, 404.html  static pages
style.css             all styles
_headers              CSP, security and cache headers
robots.txt            allows all, points to sitemap.xml
sitemap.xml           every indexable page
blocklist.json        keys of removed posts
favicon.svg, icon.png, apple-touch-icon.png
fonts/                fraunces-sub.woff2 + licence
js/app.js             router: hash → replay, no hash → writer
js/recorder.js        diffs textarea values into events {t, pos, del, ins}
js/input-guard.js     blocks paste, drop and autocorrect; 500-character cap
js/writer.js          writing screen: meter, draft autosave, share
js/player.js          replay: clock, controls, pauses, end state, blocklist
js/viewport.js        document scrolling and mobile keyboard space
js/time.js            shared GMT date/time display for writer and replay
js/store.js           localStorage (wmt:draft, wmt:posts)
js/codec/             link format: index.js (versions), v1.js, bytes.js (helpers)
docs/                 README demo GIF; never deployed with the site
tests/                node --test suites and golden fixtures
tools/                serve, build, smoke, blockhash
.github/workflows/    test, pipeline (release), deploy (reusable), version (rollback)
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Serve the repo at http://localhost:8788 |
| `npm test` | Run all tests |
| `npm run build` | Build `dist/` and print sizes |
| `npm run preview` | Build, then serve `dist/` as deployed |
| `node tools/smoke.mjs <url> [--version v] [--env stg\|prd]` | Smoke-test a running site |
| `node tools/blockhash.mjs '<link>'` | Print the blocklist key for a link |

## Easy to get wrong

- **Count code points, not UTF-16 units.** Use `[...str]` for positions, lengths and the 500 cap.
- **The recorder never looks at keys.** It diffs old and new textarea values, which is why IME, swipe, undo and autocorrect all work. Don't add key handling.
- **Text is normalized before diffing:** line endings become `\n`, control characters are stripped, and lone surrogates become U+FFFD.
- **The decoder is defensive.** Every length, jump and delete is bounds-checked, inflate is capped at 64 KB, and the checksum must match. Failures are always a `LinkError`, never another exception. Add a hostile test for any new field.
- **New served files** go in `SITE` in `tools/build.mjs`, or they won't deploy. New JS modules also go in `tools/smoke.mjs` and the `modulepreload` links.
- **Fonts are cached for a year.** Changing the font means a new file name.
- **JS/CSS and the blocklist revalidate on request.** Keep their `Cache-Control: no-cache` headers; the player caches blocklist data in memory for five minutes. After deployment, smoke checks must confirm the live cache policy. In Cloudflare, Browser Cache TTL should respect existing headers; an override can serve outdated decoders even after a release.
- **Browser asset revision:** JS imports, module preloads and stylesheet links currently use `?r=2` to bypass old cached assets. Keep those references consistent. This is an asset cache key, separate from the recording’s `#1` link format.
- **Don't change `blockKey()`**, or existing blocklist entries stop matching.
- **Autocorrect replacement is blocked.** If it breaks typing on iOS, set `BLOCK_REPLACEMENT = false` in `js/input-guard.js`.
- **Edit timestamps:** v1 flags `0` means an original link; flag `1` adds a varint of Unix minutes before the event count. Other flags are invalid. `editedAt` is optional on decoded models; never substitute the current time for a missing replay timestamp. Use `js/time.js` on both screens. The timestamp comes from the writer’s device clock.
- **Scrolling:** writer and replay use document scrolling. Keep the writer’s meter and actions above the keyboard using the visual viewport’s height and offset. Leave room for them when revealing the caret. After typing, recheck the caret when the browser later scrolls the textarea, document or visual viewport; reset native textarea scrolling before measuring. Touch drags and wheel scrolling stop automatic following until the next input. Respect pinch zoom and let viewers stop following playback to scroll manually.

## Sharing and interface

- The agreed share message is the finished post, one blank line, then `watch it → FULL_URL`. Keep this format unchanged unless requested.
- Keep one **share** action: mobile share sheet where available, otherwise clipboard with a manual-copy fallback. Do not add a separate copy-link button unless requested.
- Writer: `your words, at your pace`. Replay: `a thought, taking shape.`. Use the same last-edited GMT date/time formatter on both screens: right-aligned on desktop, stacked below the tagline and left-aligned on small screens.
- Authors with a locally saved recording see **continue editing**; other viewers see **type your own**. These are mutually exclusive, on the right of the playback controls. Grey replay stats sit below that row.
- `marketing/` stays ignored. Copy any README artwork into `docs/`; documentation assets do not belong in the deploy allowlist.

## SEO

- Only `/` and `/about` are indexable. Posts live in the `#` part of the link, which search engines never see.
- Every indexable page needs:
  - a `<title>`: `watchmetype` on the home page, `<page> · watchmetype` elsewhere
  - a meta description
  - a canonical link
  - Open Graph and Twitter tags
  - an entry in `sitemap.xml`
- `app.js` restores the HTML `<title>` on the writer screen. Don't hard-code `document.title` there.
- Keep compact social previews: `twitter:card=summary` with the caret icon. Do not restore the large promotional `og:image`; receiving apps decide the final preview layout.

## Testing

- Run `npm test` before every commit; everything must pass.
- Codec changes need round-trip fuzz tests and hostile-input tests. Changes that affect links need new golden fixtures.
- For UI changes, check in a browser (`npm run dev`) in light and dark mode and at 375 px width.

## Deployment

- **Release:** merging to `main` tests, builds a GitHub Release `vYYYY.MM.DD-N`, deploys to **stg**, then deploys the same bundle to **prd** after manual approval.
- **Rollback:** use **Actions → version**. `/version.json` shows what's live.
- **Never** deploy by hand with `wrangler`, connect the Pages projects to Git, or rename or delete the production project. Shared links depend on its address.

## Known gaps

- Real-device coverage is incomplete: retest iOS keyboard scrolling after fixes, plus Gboard, Samsung Keyboard, Japanese and Hindi input, and link survival in WhatsApp and X.
