# AGENTS.md

Project briefing for AI coding agents. Read this before making changes.

## What this project is

**AniBT Publish (ABP)**: a desktop publishing client for the AniBT site (anibt.net),
focused on anime releases. Electron + Vue 3 + TypeScript, targeting three platforms
(Windows / macOS / Linux). Only the Anime category is supported — no manga, music, etc.

## Stack and layout

- Build: electron-vite (three targets: main / preload / renderer)
- Renderer: Vue 3 + vue-router + pinia + vue-i18n (zh-CN / zh-TW / en)
- UI: Tailwind CSS v4 (`@tailwindcss/vite`) + shadcn conventions (**no CLI** — components
  are hand-written in `src/renderer/src/components/ui/`, using reka-ui + cva + `cn()`)
- Markdown editor: md-editor-v3, always via the `UiMarkdownEditor.vue` wrapper
  (never import `MdEditor` directly — see rule 9). The `@codemirror/language-data`
  alias stub in `electron.vite.config.ts` strips ~113 syntax chunks — do not revert.
- Packaging: electron-builder (`electron-builder.yml`)

```
src/
  main/       # Electron main process: window, config store, IPC, AniBT API (net.fetch), proxy,
              # secrets.json (encrypted API keys)
  preload/    # contextBridge; types inferred from IpcChannels
  shared/     # Pure logic (template engine, subtitle detection, bencode, filename parsing,
              # store-doc sanitizing, secrets crypto)
              # NOTE: erasable TS syntax only (no enum/namespace) — node runs these files
              # directly for unit tests
  renderer/   # Vue app
scripts/      # run-checks.mjs (pure-logic unit tests), ui-probe.cjs (live-window UI probe),
              # smoke-test.mjs (artifact smoke test)
```

## Hard rules

0. **README edit scope**: `README.md` is user-maintained documentation. Without the user's explicit permission, do not modify, delete, or reorder any part of it. The only exception is the content under `## 验证与打包` and before the next heading of the same level. Ask for explicit permission before changing any other part of `README.md`.

1. **Contract-driven IPC**: channel signatures live in `IpcChannels` in `src/shared/types.ts`.
   Adding a channel takes three steps: (1) write the signature in types.ts,
   (2) add the handler in `main/ipc.ts`, (3) expose one more method in `preload/index.ts`.
2. **Config directory**: Windows = `Documents/AniBT Publish/` (same for the portable
   single-exe build); macOS = `~/Library/Application Support/AniBT Publish/`;
   Linux = `$XDG_CONFIG_HOME/anibt-publish`. These remain the defaults. Settings → Other
   can move application data to an empty directory; `data-location.json` at the original
   default path records the choice. `main/data-directory.ts` copies/verifies config,
   encrypted secrets and pending torrents before switching, retaining the old files.
   Never overwrite a nonempty destination or nest it under/over the current data directory.
3. **Artifact purity**: keep `dependencies` in package.json empty — everything goes in
   devDependencies and gets bundled into `out/`; the asar must contain no node_modules.
   After touching packaging config, verify with
   `npx asar list release/win-unpacked/resources/app.asar`.
4. **No prop mutation**: child components use `emit('update:entry', {...})` and the
   parent/store replaces the whole object. Or fetch the object from the store by id and
   mutate it there (the store is the single source of truth).
   `vue/no-mutating-props` is an error.
   Corollary: after a patch-and-replace, the old `props.x` reference is an **orphan** —
   pass the id and re-look-up (see `publishStore.applyTemplate(id)`), don't keep using it.
5. **No direct `window` access in templates**: wrap it in a script function and bind that.
6. **Frameless window**: the title bar is custom-drawn (`TitleBar.vue`) and must **not**
   show the project name.
7. **Theming**: light background `#fafafa`, dark background `#191a1b`; **light is the
   default** (`store-doc.ts`, `index.html` must carry no `class="dark"`, and
   `createMainWindow(mode)` picks the first-paint `backgroundColor`). The accent color is
   written to the `--primary` CSS variable at runtime; presets `#fb7299` (default) /
   `#00b3f2` / `#fb923c` plus a user-defined custom color.
8. **API keys never touch config.json.** They live in `secrets.json` next to it,
   AES-256-GCM, key derived in `shared/secrets-crypto.ts` from an in-app passphrase so the
   file is **portable** (the single-exe build can move machines). This is
   **obfuscation-grade**: it stops plaintext leaks (screenshots, cloud sync, accidental
   commits), not someone who reverse-engineers the exe. Never log key material.
   `ConfigStore` splits on save and merges back on load, so the renderer still sees one
   `AppData` with `groups[].apiKey` populated.

## reka-ui / md-editor-v3 / Tailwind traps (each of these shipped a silent UI regression)

9. **`TooltipProvider` must wrap the whole app** (it lives in `App.vue`). reka-ui's
   `TooltipRoot` *throws* `Injection Symbol(TooltipProviderContext) not found` without it,
   and Vue then renders **nothing** for that subtree — so anything inside a `UiTooltip`
   silently vanishes while lint/typecheck/tests stay green. This is what ate the template
   variable buttons, the 繁化姬 convert button and the Preview switch. Same shape applies
   to any reka-ui `*Provider`.
10. **md-editor-v3 fetches from unpkg.com unless you say no.** Its highlight / katex /
    mermaid / echarts / prettier / cropper extensions inject a `<script>` from the CDN
    when no `instance` is supplied — `instance: null` does **not** disable it, it *is* the
    trigger. The only reliable off switch is the `no-highlight` / `no-katex` / `no-mermaid`
    / `no-echarts` / `no-prettier` / `no-upload-img` props, plus keeping `fullscreen`
    (screenfull) out of the toolbar. All of that is centralized in
    `components/ui/UiMarkdownEditor.vue` — **use the wrapper, never `MdEditor` directly**,
    or the CSP (`script-src 'self'`) will start rejecting requests again.
11. **Controlled inputs must not reject keystrokes.** `<UiInput :model-value="x" @update…>`
    is fully controlled: if the handler refuses a value (failed `Number()` parse,
    out-of-range, `.trim()`, `.toUpperCase()`), Vue snaps the DOM back and the field feels
    "deletable but not typeable". For numeric/normalized fields keep a raw-text `ref` and
    write through only what parses (see `bgmIdText`, `portText`); do normalization on
    `@blur`.
12. **`CollapsibleRoot` ignores `defaultOpen` once `open` is bound.** Passing both puts it
    in controlled mode. `UiCollapsible` therefore owns its own state seeded from
    `defaultOpen`.
13. **`body { user-select: none }` needs an escape hatch** for `input`/`textarea`/
    `[contenteditable]`/`.cm-editor` (see `main.css`), otherwise text inside inputs can't
    be selected or copied.
14. **Never call `window.confirm` / `alert` / `prompt`.** They open a *native* modal; on
    Windows the keyboard focus frequently does not come back to the webContents after it
    closes, and every input in the app then feels "deletable but not typeable" — the exact
    symptom of rule 11, but triggered by a dialog instead of a rejected keystroke. Use
    `confirm()` from `renderer/src/lib/confirm.ts` (reka-ui `AlertDialog`, rendered by
    `UiConfirmDialog` in `App.vue`). The probe asserts no `window.confirm(` survives in the
    built bundle.
15. **Tailwind v4 has no `animate-in` / `fade-in-0` / `zoom-in-95`.** Those came from the
    v3-era `tailwindcss-animate` plugin; in v4 they compile to **nothing**, so animation
    classes look right in the source and do nothing at runtime (this is why the whole app
    had no motion). Animations are hand-written in `main.css`: `@keyframes` + matching
    `--animate-*` vars in `@theme inline`, which is what makes Tailwind emit the utility.
    Adding a new animation means adding **both** halves. A `prefers-reduced-motion` guard
    turns them all off.
16. **Selects must be `UiSelect` + `UiSelectItem`, never a native `<select>`/`<option>`.**
    A native select pops the *operating system's* list: square corners, system colors, no
    theming, no animation. `UiSelect` wraps reka-ui so the listbox is in-app DOM. Note
    reka-ui reserves the empty string for "clear selection", so a placeholder is the
    `placeholder` prop, not an `<option value="">`.
    The searchable font picker uses reka-ui Combobox + ComboboxVirtualizer in
    `FontSelect.vue`: search stays inside the popup, with only visible rows mounted.
17. **md-editor-v3 previews on a 500 ms debounce** (`renderDelay` in its config), which
    reads as "the preview lags half a second behind my typing". `lib/markdown.ts` sets it
    to `0`.
18. **Tailwind v4 emits `translate` as its own property, not inside `transform`.**
    `-translate-x-1/2` compiles to `translate: calc(-1/2 * 100%) ...`, so a keyframe that
    also writes `transform: translate(-50%,-50%)` *stacks* with it — the element animates
    from -100% and visibly flies in from the top-left before snapping to center. Keyframes
    used on centered elements must animate `scale`/`opacity` only and leave positioning to
    the `translate` property.
19. **Don't wrap the confirm/cancel buttons in `AlertDialogAction`/`AlertDialogCancel`
    when the result drives a Promise.** Those components carry their own close handler
    that races the button's `@click`; when reka's runs first it fires
    `onOpenChange(false)`, settles the Promise as `false`, and the caller sees a *cancel*
    even though the user clicked confirm — "I click delete and nothing gets deleted".
    `UiConfirmDialog` uses plain buttons that call `settleConfirm()` explicitly, and
    `settleConfirm` is idempotent so the trailing `onOpenChange` is a no-op.
    Test both branches: a probe that only exercises cancel passes while confirm is broken.
20. **reka-ui components are picky about synthetic events — drive them with real input.**
    `SelectTrigger` listens on **`pointerdown`**, so `el.click()` never opens the listbox
    (the probe then asserts against an empty option list and "proves" a bug that isn't
    there). Worse, a dispatched `pointerdown` on a `SelectItem` *highlights* it but does
    not commit the selection. In the probe: open with dispatched pointer events
    (`openSelectByText`), but **click options via `sendInputEvent` at real coordinates**
    (`clickElementAt`). When a probe assertion fails, first reproduce the interaction with
    real mouse events before concluding the product is broken.
21. **`TooltipTrigger` keeps `data-state="closed"` even when the tooltip is disabled**, so
    that attribute cannot tell you whether a tooltip is actually wired up. Assert on
    behavior instead: move the mouse over the trigger with `sendInputEvent` and count
    `[role=tooltip]` nodes. The sidebar needs **both** directions checked — expanded must
    not pop a bubble (the label is already on the button), collapsed must still pop one
    (the icon is all there is).
22. **Never hand a Vue reactive object to `window.api.*`.** `reactive`/`ref` return
    **Proxies**, and the contextBridge/IPC boundary uses structured clone, which rejects
    them with `DataCloneError: An object could not be cloned.` The failure is far from
    the cause: a publish payload can be fifteen plain strings plus **one** array taken
    straight off the store (`entry.languages`) and the whole call dies, with nothing in
    the message naming the field. Wrap every outbound object in `toPlain()` from
    `shared/plain.ts` (do *not* use it on binary — `Uint8Array` would JSON-ify into
    `{"0":…}`; the torrent-bytes path passes a freshly built array and must stay raw).
    `window.api` is frozen by contextBridge, so you cannot stub it from the page — the
    mechanism is unit-tested with real Vue reactivity in `run-checks.mjs`, and the probe
    only asserts the `toPlain` call survives in the bundle.
23. **Cross-page UI state belongs in the store, not in the component.** Route changes
    unmount the component and reset every local `ref`. The Preview switch in
    `PublishBatchBar` was a local `ref`: turn it on, visit another page, come back, and
    it had silently switched itself off — while the queue it applies to (in the store)
    was still there. If a control describes the queue, it lives next to the queue.

## Domain conventions (shared layer)

These are product decisions, not implementation details — changing them changes what
users see in published titles.

- **Language order is always `CHS / CHT / JP / EN`.** The word list matches longest-first,
  which has nothing to do with semantics, so `[JPN][CHS]` would otherwise render as
  `JP&CHS`. `sortLanguages()` in `constants.ts` is the single choke point; both
  `languageCodeTag` and `subtitleLangZhTag` run everything through it. Unknown codes
  (KR, FR…) keep their relative order and sort after the four known ones.
- **`CHI` / `ZH` mean "Chinese, unspecified" → `CHS + CHT`.** Only `CHS`/`CHT` (and
  `SC`/`TC`, `GB`/`BIG5`) are a definite single variant. So `CHI_JPN` is
  `CHS+CHT+JP`, not `CHS+JP`.
- **No single-CJK-character words in the detection list.** 「日」「英」「繁」appear in
  ordinary anime titles (夏日重现, 我的英雄学院…) and a one-character rule mislabels
  every one of them. Two-character combinations (简日, 繁日, 简繁) and boundary-checked
  latin codes (`JP`, `ENG`) are safe; single characters are not.
- **Three Chinese-title variables, deliberately.** `{{titleZhHans}}` and
  `{{titleZhHant}}` are explicit (Hant falls back to Hans when the traditional name is
  blank — an empty title is worse than an unconverted one). `{{titleZh}}` is the legacy
  one and **follows the title variant**: under the `trad` variant the publish store
  passes the traditional name for it. Keep them separate — deriving Hans from `titleZh`
  makes `{{titleZhHans}}` render traditional text in the trad variant.
- Template variable names are matched **case-insensitively** (`{{titlezhhans}}` works).
  Unknown names are still left verbatim so typos are visible in the preview.
  `{{version}}` and `{{versionSuffix}}` both omit the default v1; v2+ render as v2 / [v2].
  Variable pickers list `titleZh` before `titleZhHans` and `titleZhHant`.
- Anime templates can be created from a Chinese name without IDs; required ID validation
  still runs at publishing time. The editor's Bangumi search only fills bgmId, preserving
  manually entered names. Template `customTags` use the same reorderable UiTagInput as
  publishing; copy the ordered array when matching/selecting a template, never share it.
- Settings → Other contains Data and Font. Font families are enumerated on demand using
  Chromium Local Font Access; do not load fonts at startup or bundle font files. Store the
  selected family in `appearance.fontFamily`, apply it through `--app-font-family`, and
  synchronize it to the separate dashboard menu renderer. Empty means system default.
  Never mount all font options or apply every installed font to its own option: this
  freezes opening large lists. Keep fixed-height virtual rows in the current app font;
  the preview follows the selected family. Test with the offline 10,000-font fixture.
- **Anime templates start blank.** New ones get empty title templates and an empty
  description rather than a copy of the first global template, and `sanitizeAppData`
  must not backfill them either — otherwise a field the user cleared grows back on the
  next load. The only exception is a title/description template the user explicitly
  marked as default: new anime templates copy that content at creation time. Users can
  still attach another global template via the picker in `AnimeTemplateEditor`, which
  reports "自定义" once the text no longer matches any global template.
  The star button and context menu toggle the default off when it is already selected;
  clearing the default never changes content already copied to anime templates.

## Local direct publishing

- The title bar has two modes: `anibt` is the primary/default path and uses AniBT's
  publish API; `local` is the fallback that uploads from the Electron main process.
  Records are mode-scoped and the records page must not mix the two.
  New groups start with every local site disabled, including AniBT. AniBT mode forces
  its site on only in the effective UI/publishing behavior; never overwrite the local
  enabled preference. Preserve explicit saved switches and legacy group migration.
- Local mode supports exactly eight sites: AniBT, Mikan, Nyaa, DMHY, AcgnX Asia
  (末日动漫), AcgnX Global, Bangumi.moe (萌番组), and ACG.RIP. Authentication is:
  AniBT API Key; Mikan MikanHash API Token; Nyaa username/password through its
  undocumented `/api/upload` Basic Auth API (no web-login/Cookie fallback);
  DMHY/Bangumi.moe username/password login plus isolated manual browser login and
  encrypted Cookies; both offer a per-site Cookie clear action. DMHY credential login
  fetches `common/generate-captcha` into the account editor and submits `POST /user/login`
  with the user-entered image code; only the explicit manual-login button opens a browser
  window. Bangumi.moe uses `POST /api/user/signin` and verifies `/api/team/myteam`. Both AcgnX sites use UID +
  API Token. ACG.RIP uses API URL + `X-API-TOKEN`: accept either the bare token or the
  `tpx://acg.rip/<token>` form, but always strip the scheme before sending the header.
  Do not add VCB-Studio as a publishing site.
- DMHY identity lookup and upload must share the authenticated host: try `www.dmhy.org`
  (the credential-login host) first, with `share.dmhy.org` for older manual sessions.
  Parse only the `team_id` select, accepting option labels/text and HTML entities; keep
  personal identity `0`. Never substitute a different identity for a configured name.
  Account checks use the same lookup and Cookie scope rules and distinguish login/challenge
  failures from a name mismatch. Do not forward host-only Cookies between mirrors.
- Cookie login windows use a persistent partition derived from the account group id and
  inherit the configured proxy. CAPTCHA and Cloudflare challenges are completed by the
  user in that real page. Cookies, usernames/passwords, API keys/tokens and User-Agent
  are secret fields: they are encrypted in `secrets.json`, never plaintext in
  `config.json` or logs.
- AniBT web accounts are separate from publishing groups: the AniBT-only sidebar has
  `AniBT账号` above `字幕组仪表盘`. Credentials live in `AppData.anibtWebAccount`
  and are encrypted with cookies in secrets.json; legacy per-group web credentials migrate once.
  `main/anibt-web.ts` owns the shared `persist:abp-anibt-web` partition. Login first checks
  the real session and returns immediately if authenticated (the sign-in redirect can fail
  with ERR_FAILED). A sandboxed WebContentsView in the account page displays only AniBT's
  real CAP widget and site error toasts. Keep the area compact (324 x 88 CSS pixels
  initially); error toasts flow below the widget and expand the view only while present
  so they cannot obscure its click target. Keep the original origin, React form and CAPTCHA
  ticket exchange intact; never recreate/solve the challenge or expose a preload to it.
  Fill React inputs using the native value setter and input events, wait for the user's
  real CAPTCHA solve, then submit the form. Cancel/route leave destroys this temporary view;
  successful login refreshes the cached dashboard. Only `/api/auth/get-session` with a user and
  session confirms login; CAPTCHA cookies alone do not. Never use `redirect:manual` to
  probe `/groups` (Electron throws `Redirect was cancelled`). Logout uses Better Auth's
  `/api/auth/sign-out`; clear-cookie also clears this partition's storage/cache.
- The dashboard is a sandboxed WebContentsView inside the main content area, without
  Node or preload. Its AniBT top-level page may request `clipboard-sanitized-write`
  in both session permission handlers; all other origins, frames and permissions stay
  denied. Copy regression checks use real clicks and verify OS clipboard contents.
  Sidebar children queue their destination in the transient app store, switch to the
  dashboard route, then navigate after the native view is ready. Consume/cancel the
  request so ordinary cache restoration never replays an old child navigation.
  The title bar owns back, forward and refresh icon buttons followed by `AniBT账号`; the page itself
  has no duplicate dashboard heading. Resize it with the route host, hide it when leaving
  the route, and keep the loaded view cached for 15 minutes before destroying it (switching
  to local mode, logout, or app close destroys it immediately). Dashboard sidebar popovers
  and tooltips use a separate local WebContentsView above the live page, owned by
  `main/dashboard-menu.ts`. Raise and position it before the first visible frame. Never
  hide/capture the webpage for a menu: that freezes it and cannot support live changes.
  The menu has a dedicated sandboxed preload with only layout/settings actions, receives
  no secrets, and reuses `SidebarMenuContent.vue`; the main store remains the source of truth.
  Dispose the menu renderer on route leave while retaining the remote-page cache. Do not
  reparent an already topmost menu on settings changes. On close, detach it before hiding:
  hiding an attached menu can leave the sibling webpage hidden and discard its mouse input.
  Menu entry starts only after the native view is positioned and visible; exit waits for
  animationend before detaching. Reduced motion acknowledges immediately. Guard callbacks
  by request id so a stale exit cannot close a newly opened menu; disposal stays immediate.
  Keep the dashboard unthrottled only while visible and restore throttling when cached. Do not
  wait for animation frames in an invisible view (it may not paint). CSS z-index cannot
  outrank native views. Remote pages follow app light/dark via
  AniBT's `theme` localStorage key, root class/colorScheme and palette; never reload for themes.
  The offline probe intercepts all sessions and covers login/cancellation, shared cookies,
  embedded bounds/lifecycle, first-frame native stacking, visible theme pixels and language
  changes with the menu kept open, all collapsed sidebar tooltips and secret redaction without real network.
  Client locale changes sync to AniBT's host-only `PARAGLIDE_LOCALE` cookie
  (zh-CN→zh, zh-TW→zh-Hant, en→en) and reload a loaded dashboard/login page once.
  Re-selecting the same language must not reload. Preserve authentication cookies.
- The editor source of truth is Markdown. AniBT/Nyaa receive Markdown; DMHY, both AcgnX
  sites and Bangumi.moe receive HTML from `markdown-it`; Mikan receives BBCode;
  ACG.RIP receives Markdown wrapped in `[markdown]` / `[/markdown]`.
- Mikan `bangumiId` is Mikan's own id, not the bgm.tv `bgmId`. Mikan only receives
  `bangumiId` together with `subtitleGroupId`; `publishGroupId` remains independent.
  **ABP deliberately never sends Mikan's optional `trackers` field.** Keep this rule
  in `shared/mikan.ts` and its unit test even though the upstream document lists it.
  Successful local records link to `/Home/Episode/<SHA-1 info hash>` computed from the
  uploaded raw info dictionary (also on retries); an empty 200 response must never send
  the user to a publish-group page instead of the episode.
- Mikan anime search uses `/api/bangumi/search/<keyword>`. Automatic filling after a
  Bangumi search must match the returned `BangumiUrl` subject id (or an exact normalized
  title for older responses); never take the first fuzzy result blindly.
- ACG.RIP's alliance checkbox is `post[post_as_team]=1`; omit the field when disabled.
- Nyaa follows Nyaapi exclusively: POST `/api/upload` with Basic Auth, multipart
  fields `torrent` and JSON `torrent_data`. Do not add the legacy web-form Cookie
  upload back.
- Credential checks must never treat mere HTTP reachability as verified authentication.
  ACG.RIP and the two AcgnX endpoints have no side-effect-free credential-check API:
  after local completeness validation, show them as unverified and defer authentication
  to the real publish. Never probe an upload endpoint with an empty POST; ACG.RIP returns
  `param is missing or the value is empty: post`, and AcgnX only reports auth code `105`
  as part of a complete upload response.
- Proxy tests launch all eight requests concurrently and update each row as its request
  settles. A single-site test locks only that site's button; unrelated rows remain usable.
- Failed local records keep a retry-only torrent copy in the config directory under
  `pending-torrents` so individual or multi-selected failed sites can be retried.
  Remove it only after all site results for that record have succeeded.

## AniBT API essentials (wiki.anibt.net/docs)

- Base URL `https://anibt.net`; auth `Authorization: Bearer <KEY>`;
  scopes: `releases:publish` / `releases:delete`
- Publish: `POST /api/releases/publish` (multipart must include `torrent`;
  `animeIdType=bgm` + `animeId`); `preview=true` for a test publish (expires in 10 minutes);
  409 = same version already exists, bump `version`
- **Send only non-empty fields.** An empty string is not "use the default" — the server
  validates it as a supplied value and answers `422 VALIDATION_ERROR / Invalid request
  body`, naming no field. `title`, `episodeKey`, `resolution`, `format`, `subtitle`,
  `version` and `notes` are all optional in multipart (title falls back to the torrent's
  internal name), so omit them rather than sending `""`. Don't send `publishedAt` at all:
  it is typed `number` and defaults to server-now.
- **The enums are closed** (source: `wiki.anibt.net/docs/open-api/reference`, mirrored in
  `shared/constants.ts` as `API_*`):
  `resolution` = 4K / 2160p / 1080p / 720p / 480p / 360p ·
  `format` = MKV / MP4 / AVI / WEBM ·
  `subtitle` = EXTERNAL / INTERNAL / EMBEDDED / NONE ·
  `language` = CHS / CHT / JP / EN / KO / ES / PT / FR / DE / IT / RU / AR / HI / ID /
  MS / TH / VI / TL / TR / PL / UK · `notes` ≤ 50000 chars.
  The resolution/format dropdowns offer a "custom" entry, so a user can type `1440p` or
  `MOV` and earn a 422. `shared/publish-validate.ts` catches these before the request.
- Nyaa proxy: `nyaa=true` + `nyaaCategory` (`1_3` is standard for Chinese-subbed anime);
  the torrent must contain `http://nyaa.tracker.wf:7777/announce`; whitelist-based and
  handled server-side — the client never talks to Nyaa directly
- AniBT rejects a publish (including preview) when the trackers extracted from the
  uploaded torrent exceed 50. The Wiki exposes `trackers: string[]` but does not document
  this server-side maximum. `normalizeTorrentTrackers()` trims only the in-memory upload
  copy, prioritizes AniBT/Nyaa trackers, and preserves the raw `info` dictionary so the
  info hash cannot change. Do not merely truncate `TorrentMeta.trackers`: the server
  extracts trackers again from the uploaded bytes.
- Delete: `DELETE /api/releases/{releaseId}` (200 = done / 202 = accepted, then poll
  `GET .../deletion`)
- Bangumi search: `GET /api/bgm/search?q=` (public)
- The main-process wrapper is `main/anibt.ts`, built on Electron `net.fetch`
  (inherits the session proxy)
- **Never swallow the error body.** A 422's `message` is just "Invalid request body"; the
  useful part is `details` / `issues` / `fields` underneath it. `readError` reads the body
  as text once, then tries JSON, so non-JSON gateway errors still surface. Surface the
  result *in the row*, not only in a `title` tooltip — a bare red ✗ tells the user
  nothing.
- **The docs are reachable from the dev box even when the agent sandbox can't fetch
  them.** `https://wiki.anibt.net/llms.txt` indexes every page, and each page has a
  `.md` twin (e.g. `/en/docs/open-api/reference.md`). Read the contract instead of
  guessing at it.

## Verification flow (must run after changes)

```bash
npm run lint        # 0 problems
npm run typecheck   # node + web tsconfigs
npm test            # pure-logic unit tests (shared layer)
npm run build       # real build
npm run probe       # live-window UI probe (needs npm run build first)
npm run pack:win    # real packaging (Windows)
node scripts/smoke-test.mjs   # launch the packed artifact
```

`npm run probe` boots the built main process, drives the real window with
`sendInputEvent` / `executeJavaScript`, and asserts the UI invariants that lint and
typecheck cannot see (rules 9–23 above), plus that `config.json` holds no key material.
It redirects the config dir to a temp folder, so it never touches the user's real
`Documents/AniBT Publish`. **Add a check here whenever you fix a "the UI silently
disappeared / the field won't accept input" class of bug.**

Some invariants can only be asserted against a live window, not the source — e.g. the
probe creates a throwaway element and reads `getComputedStyle().animationName` to prove
the `animate-*` utilities actually compiled, because a Tailwind class that generates no
CSS is indistinguishable from a correct one by reading the template. Likewise it reads the
dialog's `getBoundingClientRect()` on the first frame to catch the translate-stacking bug.

Probe ordering matters: the confirm-delete check removes the template it was working on,
so every assertion that needs a selected template must come before it.

**The probe must not hit the network.** It runs unattended and on CI; a "just let it 401"
publish still ships a torrent and an API key to anibt.net. When a bug lives on the far
side of an IPC call, assert the part that fails locally (the payload, the guard in the
bundle) and cover the mechanism itself in `run-checks.mjs`.

**Wait on conditions, not on the clock.** Fixed `sleep`s were this probe's main source of
flakiness: too short and a busy machine fails intermittently, too long and every run pays
for it. Worse, the failure *cascades* — a dialog that closes one tick late leaves its
overlay up, the next few clicks land on the overlay, and the reported failure is three
assertions downstream with a name that has nothing to do with the cause. Use `waitFor`.
For the same reason `clickElementAt` re-reads the element's rect immediately before
dispatching: anything that re-renders in between (typing, a store patch, a list reorder)
invalidates coordinates captured earlier.

**Animation probes must control reduced motion explicitly.** Windows CI may report
`prefers-reduced-motion: reduce`. In the dashboard menu's own WebContents, use CDP media
emulation to test `no-preference`, then `reduce`, then explicitly `no-preference` for
Tooltip animations. Clear the override only after all animation checks; an empty
feature list restores the host preference, not necessarily animations. Keep real
animation-event assertions and reduced-motion checks. CI runs
`npm run probe -- --force-prefers-reduced-motion` to cover this host setting without
changing shipped accessibility behavior. Focus the parent window as well as the target
WebContents before sending native-view pointer events.

On this Windows dev box `ELECTRON_RUN_AS_NODE=1` is set in the environment, which makes
`electron.exe` run any script as plain node (`require('electron')` then returns a path
string and `app` is undefined). Clear it first:

```powershell
$env:ELECTRON_RUN_AS_NODE=$null; $env:NODE_OPTIONS=""
```

Any change to bencode / parsers / secrets crypto must come with malformed-input tests
(over-declared lengths, truncated input, garbage bytes, tampered GCM tags).
