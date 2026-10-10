# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MuPiBox is a kids' music player: a Raspberry Pi running DietPi with an 800x480 touch display in a Chromium kiosk.
This repository is the 5.0.x development line of MuPiBox, a fork of `splitti/MuPiBox`. Everything in the
repo ends up on the box through the installer (`autosetup/autosetup.sh`) or the updater
(`update/start_mupibox_update.sh`); both install from **zips committed to git**, not from source (see Conventions).

Code comments and commit messages mix German and English. The new app's UI strings are German in source (see i18n).

## Repository map

- `src/` npm workspaces (Node 22, root `package.json` drives them):
  - `src/frontend-box` display UI: Angular 20 standalone components + Ionic 8 + Swiper. Dev server :4200.
  - `src/backend-api` Express 5, TypeScript ESM run with `tsx`, bundled by esbuild to `src/deploy/server.js`.
    Listens on 0.0.0.0:8200 and 127.0.0.1:8201. pm2 process `server` on the box. Also holds:
    - `src/mupi-app/` **the new app at `/app`**: vanilla JS, no build step, served as static files.
    - `src/eltern/` the app's API (`/api/app/*`, formerly `/api/eltern/*`). "Eltern" = parents.
    - `src/manual/` the manual at `/manual`, built by `manual/build.mjs` from markdown + `schema.json`.
    - `src/spotify-sync/` scheduled Spotify playlist sync (state machine, scheduler).
  - `src/backend-player` Express 4 CommonJS player (`spotify-control.js`): mplayer/mpv in slave mode for
    local/NAS/radio/podcasts, Spotify via librespot (Spotify Connect) + Web API. Port 5005, loopback only on the
    box. pm2 process `spotify-control`.
  - `src/tools/third-party-notices.mjs` generates `THIRD_PARTY_NOTICES.md` and `mupi-app/legal/`.
- `AdminInterface/www` the old PHP admin (lighttpd :80/:443), replaced page by page by the app. `zip.sh` builds
  `release/www.zip`.
- `scripts/` shell/python run on the box (installed to `/usr/local/bin/mupibox/`); `config/services` systemd units;
  `config/templates` default JSON configs; `config/lighttpd` the proxy config; `config/udev`.
- `themes/<id>.css` display themes; `tools/theme-preview` renders the theme tiles; `tools/manual-shots` screenshots.
- `news.txt` changelog (HTML snippets per version). Shown in admin and app, fetched from **upstream GitHub main**,
  and parsed by the manual build for the version number. `version.json` holds the release channels.
- `DEPENDENCIES.md` audited inventory of npm/apt/binary deps and what is dead. Read it before adding a dependency.
- `docs/COVERFLOW_PROMPT.md` rebuild prompt for the Cover Flow theme. `docs/app-mapping.md`, `docs/eine-app/` and
  `scripts/dev/app-i18n/` are referenced in comments but do not exist.

## Commands

All from the repo root unless noted. `npm install` once at root (workspaces).

```bash
npm run serve:backend-api        # tsx watch, NODE_ENV=development, config from src/backend-api/config/
npm run serve:frontend-box       # ng serve on http://localhost:4200
npm run serve:backend-player     # needs mplayer/mpv and config/mupiboxconfig.json; realistic only on a box
npm run serve:admin              # php -S 127.0.0.1:8000 in AdminInterface/www (needs PHP 8)
npm run build                    # all three workspaces -> src/deploy/ (also build:backend-api etc.)
npm run lint / npm run lint:fix  # Biome (root biome.json)
npm run test:frontend-box        # karma + jasmine, ChromeHeadless
npm run test --workspace=mupibox-backend-api   # node:test + supertest + nock, NODE_ENV=test
npm run notices / notices:check  # third-party notices, run after the three builds
```

Single tests:

```bash
cd src/backend-api && npx cross-env NODE_ENV=test npx tsx --test src/server.spec.ts
cd src/frontend-box && npx ng test --include src/app/media.service.spec.ts
```

Test and lint state on `main` (as of 2026-10-10): `npm run lint` is **not** clean (app.js, auth.ts and others report
Biome errors), so do not mass-fix unrelated files. One of the three backend tests in `server.spec.ts` fails locally
(stale rssfeed content-type assertion). `test:frontend-api` points at a workspace that does not exist.
`src/backend-player/test/engine.test.js` runs on the box only (needs the engines, see its header).

Release packaging and other tools:

```bash
cd src && ./deploy.sh            # interactive: builds all, flattens www/browser, zips to bin/nodejs/deploy.zip
AdminInterface/zip.sh            # -> AdminInterface/release/www.zip
node src/backend-api/src/manual/build.mjs [outDir]
node tools/theme-preview/render.mjs [--only blue,kuschelmond]   # needs a frontend-box build and Chrome
npm run docker:build && npm run docker:start                    # production-like container from the two release zips (no audio, no hardware)
```

## Local development of the app (`/app`)

Verified on macOS with Node 22:

1. `npm install` at the root.
2. Create the backend's dev config (gitignored):
   `cp config/templates/www.json src/backend-api/config/config.json && cp config/templates/monitor.json config/templates/mupiboxconfig.json src/backend-api/config/`
   and `echo '{"onlinestate":"online","ip":"127.0.0.1"}' > src/backend-api/config/network.json`. The display's
   `isOnline()` ignores a network.json without `ip` and treats the box as offline (no radio, no Spotify player).
   Without `mupiboxconfig.json` the display gets no theme id from `/api/config`, never sets `body.km`, and renders
   the generic layout (collapsed player icons, scroll bar on the name cards). A real box's state: `unzip -o -j` the
   `mupiboxconfig.json` and `data.json` of a box backup into that folder and copy the Spotify client id and secret
   into `config.json`; the app's restore route answers `501 restore_on_box_only` under `NODE_ENV=development`
   (it unpacks to `/` with sudo, which hung waiting for a password under an IDE run).
3. `npm run serve:backend-api`, then open `http://localhost:8200/app/`.

- No build step for the app: `app.js`, `app.css`, `schema.json`, `i18n/*.json` are served straight out of
  `src/backend-api/src/mupi-app/` with `Cache-Control: no-cache`. Edit, reload the browser. Backend TypeScript
  changes restart the server through `tsx watch`.
- Login: without `/etc/mupibox/mupiboxconfig.json` there is no password and `interfacelogin.state` is off, so
  `GET /api/app/session` hands out an open session and the app logs in by itself.
- Under `NODE_ENV=development` the backend reads and writes the box config at `src/backend-api/config/mupiboxconfig.json`
  (on a box `/etc/mupibox/mupiboxconfig.json`, written through sudo and a shared flock; both are switched on
  `productionServe` in server.ts, as is the thumbnail cache dir). What still does not work off-box: everything that
  shells out to `/usr/local/bin/mupibox/*.sh`, `sudo`, `amixer`, pm2, or talks to the player on :5005. The start
  page therefore shows "Keine Verbindung zur Box".
- Loop against a real box: the deploy zip is unpacked to `/home/dietpi/.mupibox/Sonos-Kids-Controller-master/`,
  so copying `src/backend-api/src/mupi-app/*` into `.../Sonos-Kids-Controller-master/mupi-app/` and reloading
  `http://<box>/app/` is enough for app changes (no restart). For backend changes: `npm run build:backend-api`,
  copy `src/deploy/server.js` over `.../Sonos-Kids-Controller-master/server.js`, `pm2 restart server` as dietpi.
- The Angular display UI from ng serve (:4200) talks to the backend on `<hostname>:8200`; CORS allows same-host
  origins on any port, so this works against the local backend. Paths the display takes from its own origin as on a
  box (`/api/spotify/cover/...`, `/rss-covers/`, `/active_theme.css`, `/theme-data/...`) are covered by the
  `development` configuration in `angular.json`: `/api` and `/rss-covers` are proxied to :8200
  (`proxy.conf.json`), the theme comes from `src/dev/active_theme.css` (an `@import` of one of `themes/*.css`,
  served at `/themes/`) and the themes' pictures and fonts from `themes/` at `/theme-data/`. Production builds are
  untouched by this.

## Architecture

### Request routing on the box

- lighttpd (:80/:443) serves the PHP admin and proxies `/app`, `/api`, `/assets`, `/manual`, `/text-preview`,
  `/parents`, `/eltern` to Node on 127.0.0.1:8201 (`config/lighttpd/90-mupibox-app.conf`). `/` redirects to
  `/app/?portal`.
- backend-api listens on :8200 for the kiosk (`http://localhost:8200`), the LAN and the Spotify OAuth redirect, and
  on :8201 for lighttpd. Requests on 8201 are never "the box itself" (`viaProxy`, `isLoopback`, `localOnly` in
  `request-guard.ts`), so routes meant for the kiosk, scripts and the Telegram bot stay closed to the network.
- The player (:5005) is loopback only; remote pages reach it through backend-api's `/api/player` proxy, which
  requires the `X-Requested-With` header the box's own pages send.
- `request-guard.ts` also enforces a Host allowlist (DNS rebinding), Sec-Fetch-Site/Origin checks and same-host CORS.

### Auth model (`eltern/auth.ts`, `eltern/middleware.ts`)

- Session cookie `mupibox_eltern_session` plus CSRF header `x-mupibox-csrf` (double submit) on state-changing
  calls. Route guards: `requireSession`, `requireCsrf`, `localNetworkOnly` (whole router), `ipRateLimit`, `localOnly`.
- Ways in: a magic link (`/app?token=…` from the QR code on the display or Telegram, redeemed by
  `buildElternLandingHandler`), a password (`POST /api/app/login`, checked against the admin password and the
  parents' password in mupiboxconfig), or an open session when `interfacelogin.state` is off or no password exists.
- Sessions live in `/tmp` (gone after reboot); "stay signed in" sessions in `/home/dietpi/.mupibox/.app_sessions.json`.
- A global gate in `server.ts` protects every other route for non-loopback clients when `interfacelogin.state` is on.

### The app (`src/backend-api/src/mupi-app`)

- One page: `index.html` is the shell (sidebar, tabbar, topbar, `#content`, `#sheet`, `#toasts`), `app.js` (about
  11k lines, ES module) draws everything, `tokens.css` + `app.css` style it, no framework or bundler.
- `schema.json` declares the UI: `areas` (the five tabs start, hoeren, spielzeit, bibliothek, einstellungen),
  `settingsGroups`, 62 `pages` (id, `slug`, `parent`, `sections` of `items` with `type` toggle, slider, select,
  text, buttons, days, rules, nav, chart, rows, …), `searchIndex`, `themes`, `bootscreens`. Routing is hash based
  (`#/<slug>`); `state.bySlug` maps slugs to page ids.
- `CONTROLLERS` (near the end of app.js) maps a page id to `{ load, mount(root), change(key, value), act: {…},
  sections(page) }`. `CONNECTED` is derived from its keys; a page without a controller renders from the schema and
  only changes values locally, and says so.
- Generic rendering: `renderPage` → `renderSection` → `renderItem`; `wire()` routes input changes to
  `ctrl.change(key, value)` and `data-act` buttons to `ctrl.act[name]`. Helpers: `api(url, { method, body })` adds
  credentials and the CSRF header, `toast()`, `openSheet()`, `confirmSheet()`, `every(ms, fn)` for page timers
  (stopped on navigation), `esc()` for HTML escaping. Backend calls go to `/api/app/...` (constant `API`), display
  calls to `BOX_ORIGIN` (port 8200).
- Adding a page: add it to `schema.json` (and `searchIndex`), add a controller in `CONTROLLERS`, add routes in a
  module under `src/eltern/` using the `registerXxxRoutes(router, deps)` pattern called from
  `createElternApiRouter` in `eltern/routes.ts`. The manual's reference chapter is generated from `schema.json`.
- i18n: German is the source language in code and schema. `i18n/<lang>.json` maps the German text to the
  translation (gettext style, keyed by the full German string); `i18n.js` translates the DOM with a
  MutationObserver before paint. New UI text: write it in German, add the key to `i18n/_source.json` and at least
  `i18n/en.json` (missing texts fall back to English). Data keys, `data-v` values and button action names stay
  German. Mark user data with `translate="no"`.

### backend-api internals

- `server.ts` is one ~8.5k-line file with the display API (`/api/data`, `/api/add|edit|delete`, `/api/rssfeed`,
  `/api/home-lists`, Spotify lookups, NAS/WebDAV, covers, playtime, network). Newer features live in modules:
  `eltern/`, `spotify-sync/`, `services/` (Spotify SDK wrapper, cover cache), `podcast-*.ts`, `audio-output.ts`,
  `speech.ts`, `online-covers.ts`.
- Config paths: `configBasePath` is `./server/config` in production (that is
  `/home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/`) and `./config` in dev and test. It holds
  `config.json` (from `www.json`: Spotify client credentials, player host/port), `data.json` (the media library, an
  array of entries), `resume.json`, `monitor.json`, `network.json`, `wlan.json`, `home-lists.json`, `rss-cache/`.
  Box-wide settings are always `/etc/mupibox/mupiboxconfig.json`, read with `getMupiboxConfigSync` and written
  atomically with `updateMupiboxConfig` (sudo-backed, with backups via `file-backup.ts`). The player's
  `config/mupiboxconfig.json` is a symlink to it.
- Writes to `data.json` and `resume.json` take lock files in `/tmp` (`file-lock.ts`); stale locks are cleared at start.
- Background pollers and schedulers start at the end of `server.ts` (play log, battery log, Spotify sync, night
  dim, TLS watch, speech, startup volume) and never under `NODE_ENV=test`.
- Express 5: rejected async handlers land in the central error handler (JSON 500). `unhandledRejection` is logged,
  `uncaughtException` exits so pm2 restarts the process.
- `app` is exported from `server.ts` for supertest.

### frontend-box (the display)

- Lazy standalone routes in `app.routes.ts` (home, medialist, player, resume, edit, settings, wifi, bluetooth, add,
  text-preview). Ionic in `md` mode. Services use `environment.backend.apiUrl` (`http://<host>:8200/api`) and
  `playerUrl` (`:5005` on the box, `/api/player` elsewhere); `PlayerRequestInterceptor` adds `X-Requested-With`.
- Theming: `index.html` loads `active_theme.css`, on the box a symlink to `~/MuPiBox/themes/<theme>.css` set by
  `scripts/mupibox/setting_update.sh`. Themes share the "km" base styles in `src/theme/km*.scss`. A new theme needs
  `themes/<id>.css`, a preview PNG from `tools/theme-preview`, an entry in `installedThemes` of
  `config/templates/mupiboxconfig.json` and in the `themes` list of `mupi-app/schema.json`.
- Display overlay texts and their translations: `src/assets/i18n/display-texts.json`.
- Production build output `src/deploy/www/browser` is flattened to `src/deploy/www` by `deploy.sh`.

### On the box (DietPi)

- `/home/dietpi/.mupibox/Sonos-Kids-Controller-master/` holds `server.js`, `www/` (display), `mupi-app/`, `manual/`,
  `server/config/`; `/home/dietpi/.mupibox/spotifycontroller-main/` holds the player. pm2 runs both as user dietpi.
- Scripts in `/usr/local/bin/mupibox/`, media in `/home/dietpi/MuPiBox/media/{audiobook,music,other,cover}`, themes
  in `/home/dietpi/MuPiBox/themes/`, admin in `/var/www`, logs in `/var/log/mupibox/`. The kiosk
  (`scripts/chromium-autostart.sh`, `kiosk_start.sh`) opens `http://localhost:8200`.
- Many backend routes shell out to these scripts with sudo; www-data and dietpi have passwordless sudo.
- Services: `config/services/mupi_*.service` (startstop, splash, idle shutdown, wifi, bluetooth, hat, fan, telegram,
  mqtt, vnc, …), overrides for pm2 and DietPi's wifi monitor. See DEPENDENCIES.md for what each needs.

## Conventions

- Biome: single quotes, no semicolons, 2-space indent, 120 columns, `noExplicitAny` off, organized imports. VS Code
  formats on save with Biome (`.vscode/settings.json`); launch configs exist for both backends and the PHP admin.
- Comments explain the why in prose, often naming the issue number or the user who reported it. Match the style and
  language of the file you touch.
- The installer and updater install from `bin/nodejs/deploy.zip` and `AdminInterface/release/www.zip`, not from
  source, and a branch is tested on a box with the updater's `branch <name> <owner>/MuPiBox` mode, which needs
  those zips on the branch. So a change that must reach a box ends with rebuilt zips as the **last, separate
  commit** ("deploy.zip neu gebaut"): clean tree, `cd src && ./deploy.sh` for Node code, app, manual and
  display, `AdminInterface/zip.sh` for PHP. Never mix the zip rebuild into a source commit (zips do not merge;
  maintainers drop and redo that commit on conflict), and never commit other build output (`src/deploy/`,
  `src/frontend-box/www/`). The updater refuses a `deploy.zip` without `mupi-app/index.html`. Add a line to
  `news.txt` under the current DEV heading; `version.json` is bumped for releases only.
- Removed npm packages are documented in `_unusedDependencies` blocks of the workspace `package.json` files and in
  DEPENDENCIES.md rather than silently deleted.
- `.devcontainer/` is the GitHub Codespaces setup (Node 22, PHP 8.3, Chrome) described in README.md.
- Keep this file and README.md (the "What is where" and "AI coding assistants" sections) up to date whenever a
  core component changes: a part is added, removed or replaced (for example when the PHP admin interface goes
  away, a workspace is renamed, a port or install path moves, or the app gets a build step). Update both in the
  same change, not in a follow-up.
