# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent skills

### Issue tracker

GitHub Issues on `diab-ma/UCF_BetterKnightsUI` (`origin`). See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical roles map 1:1 (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.

## What this is

BetterKnightsUI is a browser extension that reskins UCF's myUCF class search (a legacy PeopleSoft app) into a Bootstrap/DataTables interface and annotates instructors with RateMyProfessors ratings. It ships for Chrome, Firefox, and Safari.

Tests live in `test/` and run with `npm test` (Node's built-in runner; `jsdom` is the only devDependency, used for DOM-fixture tests). There is **no linter**. Vendored libraries (`jquery.min.js`, `bootstrap.min.js`, `datatables.min.js`, `browser-polyfill.min.js`) are checked in and must not be edited. Source files are loaded by the browser exactly as written — there is no bundler or transpiler; the "build" is a file copy.

Git remote is [DimChig/UCF_BetterKnightsUI](https://github.com/DimChig/UCF_BetterKnightsUI) on branch `main`.

## Layout

Never edit files under `build/` — it is regenerated from scratch on every build and is gitignored.

```
src/            the extension itself; copied verbatim into every build
manifests/      chrome.json (MV3), firefox.json (MV2), safari.json — one is copied in as manifest.json
build.js        the whole build system (~50 lines)
docs/           privacy-policy.html, published for the store listings
appstore-*      store metadata and screenshots
```

`src/` has no `manifest.json` of its own, so `src/` is **not** directly loadable as an unpacked extension. You must build first.

## Commands

```powershell
npm install        # only needed once, for webextension-polyfill
npm run build      # node build.js -> build/chrome, build/firefox, build/safari
```

`build.js` clears `build/`, copies `src/` into each browser's directory, drops the matching manifest in as `manifest.json`, and for Firefox only, strips the `importScripts("browser-polyfill.min.js")` line from `background.js` (MV2 loads the polyfill via `background.scripts` instead).

Development is build → reload:

- **Load**: `chrome://extensions` → Developer mode → "Load unpacked" → select `build/chrome`. Firefox: `about:debugging` → "Load Temporary Add-on" → `build/firefox/manifest.json`.
- **Apply changes**: re-run `npm run build`, click reload on the extension card, then hard-refresh the myUCF page. Content scripts are re-injected on page load; `background.js` changes require the extension reload.
- **Debug**: the content scripts run in the myUCF page's frames — use the page DevTools console (pick the correct frame in the context dropdown, see "all_frames" below). The service worker has its own console via the "service worker" link on the extension card.
- **Release**: bump `version` in **all three** files in [manifests/](manifests/) — they are in lockstep (2.0) and nothing enforces that — then zip the *contents* of `build/<browser>/` so `manifest.json` lands at the zip root. On Windows, PowerShell's `Compress-Archive` writes `\` separators into the archive and the stores choke on it; build the zip with .NET (`[IO.Compression.ZipFile]::Open` + `CreateEntryFromFile` with forward-slash entry names) instead.

Chrome and Firefox take that zip directly (store item `enclfeopdchccjmnlpgcejjibahkkjkj`, AMO slug `betterknightsui`). Safari does not: it ships as a Mac App Store app (`id6761318156`) built from an Xcode wrapper project that is **not** in this repo — `safari-app/` is gitignored. If that project is lost, regenerate it with `xcrun safari-web-extension-converter build/safari` and keep the bundle identifier so it updates the existing listing rather than creating a new one.

Manual-testing pages: class search is myUCF → Student Self Service → Student Records → Enrollment → Add Classes → "Search"; Calendar Export lives on myUCF → Student Self Service → Student Center → Other Academics → Class Schedule (List view).

### Verifying without a UCF login

The real pages are behind a UCF NID, so automated coverage runs in Node: `npm test` (Node's built-in runner). The pure Calendar Export builder and extractor are exercised by `require()` against hand-built Meetings and a saved list-view fixture (`test/fixtures/enrolled_list_view.html`), and `test/content_scripts_load.test.js` loads the manifest's full `js` list **as classic scripts in one shared jsdom scope** — the only way to catch cross-file global collisions (top-level `const` in two content scripts throws in the browser but not under per-file `require()`) — and pins the three manifests to lockstep.

For ad-hoc class-search harnesses, the same recipe works: eval the manifest's `js` list in order against a hand-built PeopleSoft-shaped DOM (a `win0divSSR_CLSRSLT_WRK_GROUPBOX2$N` box wrapping an `ACE_SSR_CLSRSLT_WRK_GROUPBOX2$N` table of `win0divSSR_CLSRSLT_WRK_GROUPBOX3$N` rows), stub `window.chrome.runtime.id` plus `window.browser` (storage/runtime), and call `window.myscan()` directly. Calling it repeatedly is also the cheapest proof that a new DOM mutation is idempotent. Two traps: `navigator.clipboard` and `document.execCommand` both need stubbing, and one unhandled rejection (loading `table_generator.js` without `rateMyProfessorAPI.js`, say) kills the Node process outright, so always load the full script list.

## Architecture

### Load order is dependency order

The `content_scripts` array in each manifest is the only dependency graph — there are no modules or imports. Everything is a bare global or hung off `window`. `browser-polyfill.min.js` must come first, then jQuery before everything else; `datatables.min.js` must load before `table_generator.js` runs (it does, because the latter only executes inside the scan loop). Reordering that array breaks things silently. The three manifests each carry their own copy of the list — `test/content_scripts_load.test.js` asserts they stay identical.

All content scripts share **one global lexical scope**: a top-level `const` in two files is a `SyntaxError` that silently kills the second file (its globals just never appear, and `typeof` guards elsewhere hide the loss). The calendar files are IIFE-wrapped for exactly this reason — wrap any new content script the same way and export via `window.x = x`.

### The 200 ms scan loop

[main_script.js:1097](src/scripts/main_script.js#L1097) runs `window.myscan` every 200 ms forever. PeopleSoft rebuilds large parts of the DOM through partial postbacks with no event Claude can hook, so the extension re-detects and re-decorates on a timer instead.

**Consequence: every DOM-mutating function must be idempotent and cheap.** Each one guards itself and returns early when its work is already present:

| Function | Guard |
|---|---|
| [`handleTable`](src/scripts/main_script.js#L562) | presence of `.betterknightsui-new-container` / `.betterknightsui-old-container` |
| [`generateTableInContainerWithData`](src/scripts/table_generator.js#L73) | `.betterknightsui-table` already in container |
| [`prettifyElementsInsideSearchClassFilterMainContainer`](src/scripts/main_script.js#L734) | `#betterknightsui_card` already present |
| collapse-arrow restyling | `.betterknightsui-arrow` marker class |

New DOM work must follow the same pattern, or it will re-run five times a second.

### Dual-container toggle

The original PeopleSoft table is never destroyed. [`handleTable`](src/scripts/main_script.js#L562) clones it into `.betterknightsui-old-container`, builds the replacement into `.betterknightsui-new-container`, and [`toggleContainers`](src/scripts/main_script.js#L505) flips `display` between them. That is why the popup's on/off switch takes effect without a reload: `myscan` re-reads `extensionEnabled` from `browser.storage.sync` each tick and passes it down.

### Live PeopleSoft elements are moved, not recreated

[`extractDataFromTableRow`](src/scripts/main_script.js#L311) returns both parsed values **and** an `elements` object holding references to the real DOM nodes (class-number link, SELECT button, syllabus link). [table_generator.js](src/scripts/table_generator.js) re-parents those actual nodes into the new table rather than rebuilding them, so PeopleSoft's own `onclick` postback handlers keep working. Replacing them with fresh `<button>`/`<a>` markup will produce buttons that render but do nothing.

### PeopleSoft selectors

Everything hangs off generated PeopleSoft ids, matched by prefix (`[id^='MTG_CLASS_NBR']`, `div[id^="win0divSSR_CLSRSLT_WRK_GROUPBOX3$"]`, …). These are brittle by nature — when myUCF changes, this is what breaks. Note that `$` is a literal character in those ids and must be escaped in direct selectors (`#win0divDERIVED_CLSRCH_SSR_GROUP_BOX_1\\$0`) but not inside `[id^=...]` strings.

Two host patterns are matched (`csprod-ss.net.ucf.edu` and `my.ucf.edu`), with `all_frames: true` because the search UI lives in an iframe — the content scripts run in several frames at once, and the container-detection helpers (`getWindowClassSearchTableContainer`, `getWindowClassSearchFilterContainer`) returning `null` is the normal case in most of them.

Because the page can be served from either host, status icons hard-coded to `my.ucf.edu` 404 on the other; [`replaceBrokenImages`](src/scripts/main_script.js#L514) rewrites those URLs and appends text labels.

### RateMyProfessors pipeline

Ratings resolve asynchronously after the table renders, in four hops:

1. [`collectAndProcessProfNames`](src/scripts/table_generator.js#L637) gathers unique names from placeholder badges tagged `data-rmp-prof-name`.
2. [`initRateMyProfessorFetch`](src/scripts/rateMyProfessorAPI.js#L135) messages the background script. **All network calls live in [background.js](src/scripts/background.js)** — the content script cannot fetch ratemyprofessors.com directly, which is why the host permission and the fetch both sit in the worker. Every listener branch must `return true` to keep `sendResponse` alive.
3. [`fetchProfessorRatings`](src/scripts/background.js#L43) POSTs a GraphQL query with UCF's hard-coded school id `U2Nob29sLTEwODI=` and a static Basic auth header, returning up to 8 candidates. [`getMatchingProfessor`](src/scripts/professorNameMatching.js#L193) is the entry point, a thin wrapper over [`getMatchingProfessorId`](src/scripts/professorNameMatching.js#L141), which picks one: tokenize/strip accents and titles, score surname candidates with Jaro-Winkler weighted 0.7 surname / 0.3 given name, then **accept only a perfect 1.0 score**, tie-breaking on `numRatings`. Deliberately conservative — a wrong professor's rating is worse than none.
4. The GraphQL `avgRating`/`numRatings` are treated as unreliable: [rateMyProfessorAPI.js:120-129](src/scripts/rateMyProfessorAPI.js#L120-L129) fetches the professor's public HTML page through the worker a second time and scrapes the real numbers out of `RatingValue__Numerator` / `RatingValue__NumRatings`. Those class names are hashed CSS-module prefixes and are the most likely thing to rot.

[`updateAllElementsWithProfName`](src/scripts/table_generator.js#L661) then swaps the placeholder badges for real ones by `data-rmp-prof-name` — matching by attribute rather than holding element references, since the scan loop may have rebuilt the table meanwhile.

### DataTables sorting

Sorting does not read cell text. Each `<td>` carries a `data-order` attribute (numeric status/section/mode codes, minutes-from-midnight for times), consumed by the custom `dom-data-order` order type registered at [table_generator.js:594](src/scripts/table_generator.js#L594). Any new sortable column needs both the `data-order` attribute and an entry in the `columnDefs`. When a rating arrives late, `updateAllElementsWithProfName` rewrites the instructor cell's `data-order` to `(5 - rating) * 100` so re-sorts stay correct.

### Copy for AI

[copy_for_llm.js](src/scripts/copy_for_llm.js) — the file kept its original name; the button says "Copy for AI" — puts a button in each course title bar (`div[id^="win0divSSR_CLSRSLT_WRK_GROUPBOX2GP"]`, the band that survives the rebuild because it lives outside the emptied `ACE_SSR_CLSRSLT_WRK_GROUPBOX2$` table) that copies that course's sections as a markdown table. It is injected from `handleTable`, so like everything else on the scan loop it guards itself — on `.betterknightsui-copy-btn`.

It never scrapes the rendered badges. `handleTable` stashes its parsed rows via `$(container).data("betterknightsui-data")` and each `<tr>` carries `data-bkui-index`, so the export reads real values while following the order DataTables is currently displaying; if the stash is gone it re-parses the untouched clone in `.betterknightsui-old-container`. RateMyProfessors results are kept in `window.bkuiRatingCache` (written by [rateMyProfessorAPI.js](src/scripts/rateMyProfessorAPI.js)) purely so the markdown can carry the profile URL — the badges themselves hold no reference to it.

Code→label text (status, section, mode) lives in one place, `window.BKUI_LABELS` in [main_script.js:286](src/scripts/main_script.js#L286), and is read by both the rendered table and the markdown; only icons and badge styling stay in `table_generator.js`. The `<br>` in the long mode labels is a display line break the markdown strips.

### Calendar Export

Post-enrollment feature on **My Class Schedule list view** (`SSR_SSENRL_LIST`), per ADR-0001: one `.ics` download of the registered Enrolled Schedule, nothing on class search, no calendar APIs. Three layers, glossary terms in `CONTEXT.md`:

- [schedule_extract.js](src/scripts/schedule_extract.js) — `isMyClassScheduleListView` (requires a `CLASS_MTG_VW$scroll$` grid **and** a `win0divDERIVED_REGFRM1_DESCR20$` course groupbox, and no class-search markup) and `extractEnrolledMeetings` (Enrolled-status courses only; blank meeting-row cells inherit class number/type/instructors from the row above).
- [calendar_export.js](src/scripts/calendar_export.js) — pure `buildCalendarExport(Meetings) → {ics, exported, skipped, skips}`. One VEVENT per Meeting, weekly RRULE bounded by the meeting date range, `TZID=America/New_York` with an embedded VTIMEZONE, no VALARM. UIDs are durable identity only (class number + meeting type + day pattern) so a re-export after times change *updates* prior events instead of duplicating; times deliberately stay out of the UID.
- [calendar_export_page.js](src/scripts/calendar_export_page.js) — page control (injected from `myscan`, guard `.betterknightsui-calendar-export-btn`, removed when disabled) and the popup endpoint. The popup messages the active tab with `browser.tabs.sendMessage`; **only the schedule frame replies** (other frames return no response), which is how the right iframe is found without frameId bookkeeping — background.js is not involved. The popup performs the actual download from the returned ics text because the schedule frame is a cross-origin iframe where Chrome blocks downloads lacking a user gesture; the page-button path downloads in-frame (the click is the gesture). Skip toasts always show on the page.

Vendor stylesheets (`injectVendorStylesheets`) are injected from the scan loop **only when a decorated page is detected** — the CSPROD match patterns also hit grades/finances-type pages that Bootstrap's reboot CSS must not restyle.

### Storage and popup

[popup.js](src/scripts/popup.js) writes two `browser.storage.sync` keys, both read by content scripts:

- `extensionEnabled` — drives the dual-container toggle above.
- `extensionShareToastCount` — launch counter behind the "share this extension" toast ([main_script.js:471](src/scripts/main_script.js#L471)); the toast shows on the first three launches and every tenth after.

### Assets are vendored, not fetched

Bootstrap CSS, Font Awesome, DataTables CSS, and Google Fonts all live under [src/css/](src/css/) and load through the manifests' `content_scripts.css` array. Font binaries sit in `src/css/fonts/` (Google) and `src/css/webfonts/` (Font Awesome) and are exposed via `web_accessible_resources`; the CSS in `src/css/vendor/` points at them with extension-relative URLs. Nothing is fetched from a CDN at runtime, so the extension works offline and adding a new asset means adding the file *and* a `web_accessible_resources` entry.

## Gotchas

- **The three manifests are hand-maintained duplicates.** Content-script lists, CSS lists, match patterns, icons, and `version` are copy-pasted across [chrome.json](manifests/chrome.json), [firefox.json](manifests/firefox.json), and [safari.json](manifests/safari.json). `build.js` does not generate or validate them. Any change to script order, a new asset, or a version bump must be made in all three.
- **`isProfessorNameTBA` is duplicated verbatim** in [background.js:35](src/scripts/background.js#L35) and [table_generator.js:39](src/scripts/table_generator.js#L39). The background script is a separate JS context and cannot see content-script globals, so the duplication is required — keep both copies in sync (each carries a comment pointing at the other).
- [professorNameMatching.js](src/scripts/professorNameMatching.js) carries debug residue: `getMatchingProfessorId`'s docblock documents an `opts`/`verbose`/`logger` parameter it never takes, its "Main (with logs)" header has no logs, `surnameScores` is built "for transparency" but only `[0]` is ever read, and [`window.levenshtein`](src/scripts/rateMyProfessorAPI.js#L1) is defined and never called. Treat unexplained one-offs in this file as suspect. One was removed on 2026-08-05: a hardcoded rewrite of every RMP candidate with first name `"Bonnie"` to `"Cobry"`, sitting at the top of `getMatchingProfessorId`. RMP reports no UCF professor named Cobry and six named Bonnie, so it could only ever push those six below the `score >= 1` threshold and suppress their ratings.
- **`package.json` has a bogus `repository.url`** — `http://local_proxy@127.0.0.1:32845/git/diab-ma/UCF_BetterKnightsUI`, left over from the porting environment. It should point at the GitHub remote.
- **`build:chrome` and `build:safari` npm scripts are a lie.** They pass a browser name to `build.js`, which never reads `process.argv`; all three targets are always built. Use `npm run build`.
- `project.zip` is a stale pre-restructure build artifact, kept locally and gitignored. `../project-bak v1.4 (With names)/` is a manual snapshot of an older release (it also holds `Chrome Store Listing texts.txt`); `../graphics/` holds store assets. Don't treat either as live code — git history is now the real record.
