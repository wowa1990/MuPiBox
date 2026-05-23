// Phase 14c + 15a — Eltern-WebApp client.
// Vanilla ES2020. No framework dependency keeps the bundle small and
// boots fast on flaky LAN.
//
// Phase 15a turned the single-screen Smart-Sync dashboard into a hub
// with 9 sections (sync, library, caps, power, wlan, bluetooth,
// telegram, system, plus the wizard/settings sub-screens of sync).
// Navigation is hash-based so browser-back works and links from the
// Telegram bot can deep-link straight to a section.

const API = '/api/eltern'
const SYNC_API = '/api/spotify-sync'

/* ---------- helpers ---------- */

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => Array.from(document.querySelectorAll(sel))

const state = {
  csrf: null,
  wizardStep: Number(sessionStorage.getItem('wizard.step') ?? 1),
  spotifyError: new URLSearchParams(location.search).get('spotify_error'),
  spotifyConnected: new URLSearchParams(location.search).get('spotify_connected') === '1',
  currentSection: null, // set by router; not by ad-hoc showScreen calls
}

/* ---------- routing (Phase 15a) ---------- */

// Map of section -> { title, parent (for back), loader }.
// Parent === null means top-level (back button hidden, "←" goes to hub).
// loader is called whenever the section becomes active so live data
// fetches happen only for the visible section.
const SECTIONS = {
  hub:       { title: '🎵 MuPiBox',          parent: null, loader: () => loadHub() },
  sync:      { title: 'Smart-Sync',          parent: 'hub', loader: () => loadSync() },
  settings:  { title: 'Smart-Sync · Optionen', parent: 'sync', loader: () => loadSettings() },
  wizard:    { title: 'Spotify-Setup',       parent: 'sync', loader: () => loadWizard() },
  library:   { title: 'Library',             parent: 'hub', loader: () => {} },
  caps:      { title: 'Spielzeit & Ruhe',    parent: 'hub', loader: () => loadCaps() },
  power:     { title: 'Akku',                parent: 'hub', loader: () => loadPower() },
  wlan:      { title: 'WLAN',                parent: 'hub', loader: () => {} },
  bluetooth: { title: 'Bluetooth',           parent: 'hub', loader: () => {} },
  telegram:  { title: 'Telegram',            parent: 'hub', loader: () => {} },
  system:    { title: 'System',              parent: 'hub', loader: () => {} },
}

/** Switch to a screen — hides all .screen sections, shows the requested
 *  one, updates the header (title + back-button visibility), and calls
 *  the section's loader. Top-level screens (loading, no-session) bypass
 *  the title-rewrite to preserve their dedicated headers. */
function showScreen(id) {
  for (const s of $$('.screen')) s.hidden = true
  const target = $(`#screen-${id}`)
  if (!target) return
  target.hidden = false

  // Loading / no-session don't have a logical section parent — keep the
  // header in brand-only mode.
  if (id === 'loading' || id === 'no-session') {
    $('#header-back-btn').hidden = true
    $('#header-title').textContent = '🎵 MuPiBox'
    return
  }

  const meta = SECTIONS[id]
  if (meta) {
    $('#header-title').textContent = meta.title
    $('#header-back-btn').hidden = meta.parent === null
    state.currentSection = id
  }
  // Window scrolls to top whenever section changes — feels more like
  // a native app than a single-page-scroll.
  window.scrollTo(0, 0)
}

/** Read the current hash, default to 'hub' for empty/no-fragment. Returns
 *  the section id (without leading '#'). */
function routeFromHash() {
  const hash = (location.hash || '#hub').replace(/^#/, '')
  // Defence: unknown hash → hub. Prevents typos / stale bookmarks from
  // blanking the page.
  return SECTIONS[hash] ? hash : 'hub'
}

/** Programmatic navigation: pushes a new hash, lets hashchange + onRoute
 *  do the actual screen-swap. */
function navigate(section) {
  if (location.hash.replace(/^#/, '') === section) {
    // Already on it — still trigger the loader so reload works.
    onRoute()
    return
  }
  location.hash = `#${section}`
}

/** hashchange + initial-route handler. */
function onRoute() {
  // Only route after the session bootstrap finished — otherwise hashchange
  // fires before we know whether to show no-session or the hub.
  if (state.csrf === null) return
  const section = routeFromHash()
  showScreen(section)
  const meta = SECTIONS[section]
  if (meta?.loader) {
    try { meta.loader() } catch (err) { console.error('section loader threw:', err) }
  }
}

async function api(path, opts = {}) {
  const init = {
    method: opts.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(state.csrf && opts.method && opts.method !== 'GET' ? { 'x-mupibox-csrf': state.csrf } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }
  const res = await fetch(path, init)
  let payload = null
  try { payload = await res.json() } catch {}
  return { status: res.status, ok: res.ok, body: payload }
}

function setText(sel, text) {
  const el = $(sel)
  if (el) el.textContent = text
}

function feedback(sel, kind, text) {
  const el = $(sel)
  if (!el) return
  el.hidden = false
  el.className = `feedback ${kind}`
  el.textContent = text
}

function formatRelative(isoString) {
  if (!isoString) return '—'
  const then = Date.parse(isoString)
  if (Number.isNaN(then)) return '—'
  const diffMs = Date.now() - then
  if (diffMs < 0) return 'gleich'
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `vor ${sec} s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `vor ${min} Min`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `vor ${hr} Std`
  return `vor ${Math.floor(hr / 24)} Tagen`
}

function formatRelativeFuture(isoString) {
  if (!isoString) return '—'
  const then = Date.parse(isoString)
  if (Number.isNaN(then)) return '—'
  const diffMs = then - Date.now()
  if (diffMs < 0) return 'jetzt fällig'
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `in ${sec} s`
  const min = Math.floor(sec / 60)
  return `in ${min} Min`
}

/* ---------- screen: caps (Phase 15h — Spielzeit & Ruhe) ---------- */

const DAYS = [
  { key: 'mon', label: 'Mo' },
  { key: 'tue', label: 'Di' },
  { key: 'wed', label: 'Mi' },
  { key: 'thu', label: 'Do' },
  { key: 'fri', label: 'Fr' },
  { key: 'sat', label: 'Sa' },
  { key: 'sun', label: 'So' },
]

// In-memory caps state — built from /api/eltern/caps-config, mutated by
// the form, sent back on Save. Keeps a clean separation between live
// status (re-fetched each render) and config (only re-fetched on entry).
let capsConfig = null

async function loadCaps() {
  await Promise.all([loadCapsStatus(), loadCapsConfig()])
}

async function loadCapsStatus() {
  try {
    const res = await fetch('/api/playtime', { credentials: 'same-origin' })
    if (!res.ok) return
    const body = await res.json().catch(() => ({}))
    const pt = body?.playtime ?? body
    setText('#caps-today-used', pt?.usedMinutes != null ? `${pt.usedMinutes} Min` : '—')
    setText('#caps-today-remaining', pt?.remainingMinutes != null ? `${pt.remainingMinutes} Min` : '—')
    setText('#caps-state', pt?.state ?? '—')
    setText('#caps-playtime-enabled', pt?.enabled ? '✓' : '✗')
    setText('#caps-quiet-state', body?.quietHours?.state ?? body?.quietHours?.active ?? '—')
  } catch { /* swallow */ }
}

async function loadCapsConfig() {
  const res = await api(`${API}/caps-config`)
  if (!res.ok) {
    feedback('#caps-config-feedback', 'error', `Konfig laden fehlgeschlagen: ${res.status}`)
    return
  }
  capsConfig = res.body ?? {}
  renderCapsDayGrid()
  renderQuietSchedule()
  $('#caps-playtime-toggle').checked = !!capsConfig.playtimeLimit?.enabled
  $('#caps-quiet-toggle').checked = !!capsConfig.quietHours?.enabled
  setText('#caps-overrun-info', `${capsConfig.playtimeLimit?.maxOverrunMinutes ?? 10}`)
}

function renderCapsDayGrid() {
  const grid = $('#caps-day-grid')
  grid.innerHTML = ''
  const limits = capsConfig?.playtimeLimit?.limitsMinutes ?? {}
  for (const { key, label } of DAYS) {
    const cell = document.createElement('div')
    cell.className = 'day-cell'
    const lab = document.createElement('label')
    lab.textContent = label
    lab.setAttribute('for', `caps-limit-${key}`)
    const inp = document.createElement('input')
    inp.type = 'number'
    inp.id = `caps-limit-${key}`
    inp.dataset.day = key
    inp.min = '0'
    inp.max = '1440'
    inp.step = '5'
    inp.value = limits[key] ?? 60
    inp.addEventListener('input', () => {
      const v = Math.max(0, Math.min(1440, Math.floor(Number(inp.value) || 0)))
      if (!capsConfig.playtimeLimit.limitsMinutes) capsConfig.playtimeLimit.limitsMinutes = {}
      capsConfig.playtimeLimit.limitsMinutes[key] = v
    })
    cell.append(lab, inp)
    grid.appendChild(cell)
  }
}

function renderQuietSchedule() {
  const root = $('#caps-quiet-schedule')
  root.innerHTML = ''
  const schedule = capsConfig?.quietHours?.schedule ?? {}
  for (const { key, label } of DAYS) {
    const windows = schedule[key] ?? []
    const dayEl = document.createElement('div')
    dayEl.className = 'quiet-day'
    const header = document.createElement('div')
    header.className = 'quiet-day-header'
    const labelSpan = document.createElement('span')
    labelSpan.className = 'quiet-day-label'
    labelSpan.textContent = label
    const addBtn = document.createElement('button')
    addBtn.className = 'quiet-add-btn'
    addBtn.textContent = '+ Fenster'
    addBtn.addEventListener('click', () => {
      if (!capsConfig.quietHours.schedule) capsConfig.quietHours.schedule = {}
      const list = capsConfig.quietHours.schedule[key] ?? []
      list.push({ start: '20:00', end: '07:00' })
      capsConfig.quietHours.schedule[key] = list
      renderQuietSchedule()
    })
    header.append(labelSpan, addBtn)
    dayEl.appendChild(header)
    windows.forEach((w, idx) => {
      const row = document.createElement('div')
      row.className = 'quiet-window'
      const s = document.createElement('input')
      s.type = 'time'
      s.value = w.start ?? '20:00'
      s.addEventListener('change', () => { capsConfig.quietHours.schedule[key][idx].start = s.value })
      const arrow = document.createElement('span')
      arrow.className = 'arrow'
      arrow.textContent = '→'
      const e = document.createElement('input')
      e.type = 'time'
      e.value = w.end ?? '07:00'
      e.addEventListener('change', () => { capsConfig.quietHours.schedule[key][idx].end = e.value })
      const rm = document.createElement('button')
      rm.className = 'remove'
      rm.textContent = '×'
      rm.addEventListener('click', () => {
        capsConfig.quietHours.schedule[key].splice(idx, 1)
        renderQuietSchedule()
      })
      row.append(s, arrow, e, rm)
      dayEl.appendChild(row)
    })
    root.appendChild(dayEl)
  }
}

async function saveCapsConfig() {
  if (!capsConfig) return
  // Pull current toggle values into the in-memory config before send.
  capsConfig.playtimeLimit.enabled = $('#caps-playtime-toggle').checked
  capsConfig.quietHours.enabled = $('#caps-quiet-toggle').checked
  const res = await api(`${API}/caps-config`, {
    method: 'POST',
    body: {
      playtimeLimit: {
        enabled: capsConfig.playtimeLimit.enabled,
        maxOverrunMinutes: capsConfig.playtimeLimit.maxOverrunMinutes,
        limitsMinutes: capsConfig.playtimeLimit.limitsMinutes,
      },
      quietHours: {
        enabled: capsConfig.quietHours.enabled,
        maxOverrunMinutes: capsConfig.quietHours.maxOverrunMinutes,
        schedule: capsConfig.quietHours.schedule,
      },
    },
  })
  if (res.ok) {
    feedback('#caps-config-feedback', 'success', 'Gespeichert. Greift sofort.')
    loadCapsStatus()
  } else {
    feedback('#caps-config-feedback', 'error', res.body?.error ?? `Fehler ${res.status}`)
  }
}

function getCapsOverrideMinutes() {
  const v = Number($('#caps-override-minutes').value)
  if (!Number.isFinite(v) || v < 1 || v > 1440) {
    feedback('#caps-action-feedback', 'error', 'Minuten muss zwischen 1 und 1440 liegen.')
    return null
  }
  return v
}

async function capsExtend() {
  const mins = getCapsOverrideMinutes()
  if (mins === null) return
  const res = await fetch('/api/playtime/extend', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minutes: mins }),
  })
  if (res.ok) {
    feedback('#caps-action-feedback', 'success', `+${mins} Min Bonus hinzugefügt.`)
    loadCapsStatus()
  } else {
    feedback('#caps-action-feedback', 'error', `Fehler ${res.status}`)
  }
}

async function capsRelease() {
  const mins = getCapsOverrideMinutes()
  if (mins === null) return
  const res = await fetch('/api/playtime/release', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minutes: mins }),
  })
  if (res.ok) {
    feedback('#caps-action-feedback', 'success', `Override für ${mins} Min aktiv.`)
    loadCapsStatus()
  } else {
    feedback('#caps-action-feedback', 'error', `Fehler ${res.status}`)
  }
}

async function capsQuietNow() {
  const mins = getCapsOverrideMinutes()
  if (mins === null) return
  const res = await fetch('/api/quiethours/now', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minutes: mins }),
  })
  if (res.ok) {
    feedback('#caps-action-feedback', 'success', `Sofort-Stopp für ${mins} Min aktiviert.`)
    loadCapsStatus()
  } else {
    feedback('#caps-action-feedback', 'error', `Fehler ${res.status}`)
  }
}

/* ---------- screen: power (Phase 15i) ---------- */

/** Pulls /api/mupihat (live readings) + /api/eltern/power-config (profile
 *  + idle timeouts) in parallel, renders the power-section. */
async function loadPower() {
  await Promise.all([loadPowerLive(), loadPowerConfig()])
}

async function loadPowerLive() {
  try {
    const res = await fetch('/api/mupihat', { credentials: 'same-origin' })
    if (!res.ok) return
    const body = await res.json().catch(() => ({}))
    // Bat_Percent (Phase 12) is the granular 5%-step value. Fall back to
    // the legacy Bat_SOC string for older mupihat.py outputs.
    const pct = body?.Bat_Percent ?? Number.parseInt(String(body?.Bat_SOC ?? '').replace('%', ''), 10)
    const charging = (body?.IBus ?? 0) > 0
    const pctEl = $('#power-percent')
    if (pctEl) {
      if (Number.isFinite(pct)) {
        pctEl.textContent = `${charging ? '⚡' : ''}${pct}%`
        pctEl.classList.remove('low', 'critical')
        if (pct <= 15) pctEl.classList.add('critical')
        else if (pct <= 30) pctEl.classList.add('low')
      } else {
        pctEl.textContent = '—'
      }
    }
    setText('#power-state', charging ? 'Wird geladen' : (body?.Bat_Stat ?? body?.Charger_Status ?? '—'))
    setText('#power-vbat', body?.Vbat ? `${body.Vbat} mV` : '—')
    setText('#power-vbus', body?.Vbus ? `${body.Vbus} mV` : '—')
    setText('#power-ibat', typeof body?.Ibat === 'number' ? `${body.Ibat} mA` : '—')
    setText('#power-temp', typeof body?.Temp === 'number' ? `${body.Temp} °C` : '—')
    setText('#power-chargerstatus', body?.Charger_Status ?? '—')
  } catch { /* swallow */ }
}

async function loadPowerConfig() {
  const res = await api(`${API}/power-config`)
  if (!res.ok) return
  const body = res.body ?? {}
  setText('#power-profile-name', body.battery?.selected ?? '—')
  const p = body.battery?.profile ?? {}
  setText('#power-profile-v100', p.v_100 ? `${p.v_100} mV` : '—')
  setText('#power-profile-warn', p.th_warning ? `${p.th_warning} mV` : '—')
  setText('#power-profile-shut', p.th_shutdown ? `${p.th_shutdown} mV` : '—')
  // vreg (Phase 13a) — optional field on the profile. Shows "POR-Default"
  // when missing so parents see that the box is using the chip's factory
  // setting rather than a profile-configured limit.
  setText('#power-profile-vreg', p.vreg ? `${p.vreg} mV` : 'Werks-Default')
  const t = body.timeout ?? {}
  $('#power-idle-shutdown').value = t.idlePiShutdown ?? 0
  $('#power-idle-display').value = t.idleDisplayOff ?? 10
}

async function savePowerConfig() {
  const idleShutdown = Number($('#power-idle-shutdown').value)
  const idleDisplay = Number($('#power-idle-display').value)
  if (!Number.isFinite(idleShutdown) || idleShutdown < 0 || idleShutdown > 1440) {
    feedback('#power-feedback', 'error', 'Idle-Shutdown muss zwischen 0 und 1440 Minuten liegen.')
    return
  }
  if (!Number.isFinite(idleDisplay) || idleDisplay < 0 || idleDisplay > 1440) {
    feedback('#power-feedback', 'error', 'Display-Off muss zwischen 0 und 1440 Minuten liegen.')
    return
  }
  const res = await api(`${API}/power-config`, {
    method: 'POST',
    body: { idlePiShutdown: idleShutdown, idleDisplayOff: idleDisplay },
  })
  if (res.ok) {
    feedback('#power-feedback', 'success', 'Gespeichert. Änderungen greifen sofort.')
  } else {
    feedback('#power-feedback', 'error', res.body?.error ?? `Fehler ${res.status}`)
  }
}

/* ---------- screen: hub overview (Phase 15a) ---------- */

/** Hub-overview card subs — live stats so parents see at a glance what
 *  needs attention. Sync card shows last-sync timing + count; power card
 *  shows battery %. Other cards stay descriptive — they'll be wired
 *  with real data in 15c/d/f/g once their backends exist. */
async function loadHub() {
  // Sync-Card sub: last sync + counts. Fail silently — hub overview
  // shouldn't break if the sync endpoint hiccups.
  try {
    const res = await api(`${SYNC_API}/status`)
    if (res.ok) {
      const cfg = res.body ?? {}
      const last = cfg.state?.last_sync_status
      const when = formatRelative(cfg.state?.last_sync_end)
      if (!cfg.token?.configured) {
        setText('#hub-card-sync-sub', 'Noch nicht eingerichtet')
      } else if (!cfg.token?.scopes_ok) {
        setText('#hub-card-sync-sub', '⚠️ Neu autorisieren')
      } else if (!cfg.enabled) {
        setText('#hub-card-sync-sub', 'Deaktiviert')
      } else if (last === 'COMPLETED') {
        const a = cfg.state.additions_count ?? 0
        const r = cfg.state.removals_count ?? 0
        setText('#hub-card-sync-sub', `Aktiv · ${when} · +${a}/−${r}`)
      } else {
        setText('#hub-card-sync-sub', last ?? '—')
      }
    }
  } catch { /* swallow */ }

  // Power-Card sub: pull /api/mupihat for battery %. Best-effort.
  try {
    const res = await fetch('/api/mupihat', { credentials: 'same-origin' })
    if (res.ok) {
      const body = await res.json().catch(() => ({}))
      const pct = body?.Bat_Percent ?? body?.Bat_SOC
      const charging = body?.IBus > 0
      if (typeof pct === 'number') {
        setText('#hub-card-power-sub', `${charging ? '⚡' : ''}${pct}%`)
      } else if (typeof pct === 'string') {
        setText('#hub-card-power-sub', pct)
      }
    }
  } catch { /* swallow */ }
}

/* ---------- screen: sync (Phase 14, formerly 'dashboard') ---------- */

async function loadSync() {
  const res = await api(`${SYNC_API}/status`)
  if (!res.ok) {
    feedback('#sync-feedback', 'error', `Status laden fehlgeschlagen: ${res.status}`)
    return
  }
  const data = res.body
  const cfg = data || {}
  setText('#sync-prefix', cfg.playlist_prefix ?? '—')
  setText('#sync-last', formatRelative(cfg.state?.last_sync_end))
  setText('#sync-state', cfg.state?.last_sync_status ?? '—')
  setText('#sync-next', formatRelativeFuture(cfg.state?.next_scheduled_sync))

  // Last-run summary.
  const counts = $('#sync-counts')
  if (cfg.state?.last_sync_status === 'COMPLETED') {
    counts.hidden = false
    const a = cfg.state.additions_count ?? 0
    const u = cfg.state.updates_count ?? 0
    const r = cfg.state.removals_count ?? 0
    setText('#sync-summary', `+${a} / ↻${u} / −${r}`)
  } else {
    counts.hidden = true
  }

  // Spotify-Card.
  const sActions = $('#spotify-actions')
  const sStatus = $('#spotify-status')
  sActions.innerHTML = ''
  if (!cfg.token?.configured) {
    sStatus.innerHTML = '<span class="dim">Noch nicht eingerichtet</span>'
    addBtn(sActions, 'primary', 'Spotify einrichten', () => goWizard())
  } else if (!cfg.token?.scopes_ok) {
    sStatus.innerHTML = '<span class="dim">⚠️ Berechtigungen reichen nicht für Smart-Sync</span>'
    addBtn(sActions, 'primary', 'Neu autorisieren', () => connectSpotify())
  } else {
    sStatus.innerHTML = '<span class="value">✓ Verbunden</span>'
    addBtn(sActions, 'ghost', 'Trennen', () => disconnectSpotify())
    if (!cfg.enabled) {
      addBtn(sActions, 'primary', 'Smart-Sync aktivieren', () => toggleSync(true))
    } else {
      addBtn(sActions, 'ghost', 'Smart-Sync deaktivieren', () => toggleSync(false))
    }
  }

  // Playlists-Liste
  const pls = $('#sync-playlists')
  pls.innerHTML = ''
  for (const p of cfg.state?.playlists_seen ?? []) {
    const div = document.createElement('div')
    div.className = 'playlist-item'
    div.innerHTML = `<span>📂 ${escapeHtml(p.name)}</span><span class="dim">${p.items} Items</span>`
    pls.appendChild(div)
  }

  // Konflikte (Phase 14e: jetzt mit Aktions-Button "Vom Sync verwalten lassen")
  const confs = cfg.state?.conflicts ?? []
  $('#conflicts-card').hidden = confs.length === 0
  const list = $('#conflicts-list')
  list.innerHTML = ''
  for (const c of confs) {
    const li = document.createElement('li')
    const meta = document.createElement('div')
    meta.textContent = `${c.manualArtist ?? '?'} – ${c.manualTitle ?? '?'}`
    const pl = document.createElement('div')
    pl.className = 'dim'
    pl.textContent = `auch in: ${(c.inPlaylists || []).join(', ')}`
    const actions = document.createElement('div')
    actions.className = 'actions'
    addBtn(actions, 'ghost', '🔗 Vom Sync verwalten lassen', () => promoteConflict(c))
    li.append(meta, pl, actions)
    list.appendChild(li)
  }
}

/** POST /api/spotify-sync/conflicts/promote with the conflict's identifier
 *  pair. On success: reload dashboard so the conflict is gone (item is now
 *  source='spotify-sync' and will be updated by the next sync). */
async function promoteConflict(conflict) {
  const field = conflict.identifierField
  // The group key is `<prefix>:<id>` (or `compilation:<artistId>:<albumId>`).
  // For matching against library we need the bare id — same extraction as
  // the diff module does.
  let value = ''
  const groupKey = conflict.groupKey ?? ''
  if (groupKey.startsWith('compilation:')) {
    const parts = groupKey.split(':')
    value = parts[parts.length - 1] ?? ''
  } else if (groupKey.includes(':')) {
    value = groupKey.slice(groupKey.indexOf(':') + 1)
  } else {
    value = groupKey
  }
  if (!field || !value) {
    feedback('#sync-feedback', 'error', 'Konflikt-Identifier unvollständig.')
    return
  }
  if (!confirm(`„${conflict.manualArtist ?? '?'} – ${conflict.manualTitle ?? '?'}" vom Sync verwalten lassen?\n\nAb sofort werden Titel/Cover/Artist vom Sync aktualisiert. Deine Overrides bleiben erhalten.`)) {
    return
  }
  const res = await api(`${SYNC_API}/conflicts/promote`, {
    method: 'POST',
    body: { identifierField: field, identifierValue: value },
  })
  if (res.ok) {
    feedback('#sync-feedback', 'success', 'Eintrag wird ab dem nächsten Sync verwaltet.')
    await loadSync()
  } else {
    feedback('#sync-feedback', 'error', res.body?.error ?? `Fehler ${res.status}`)
  }
}

function addBtn(parent, cls, label, onClick) {
  const b = document.createElement('button')
  b.className = cls
  b.textContent = label
  b.addEventListener('click', onClick)
  parent.appendChild(b)
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

/* ---------- actions ---------- */

async function triggerSync() {
  const btn = $('#sync-trigger-btn')
  btn.disabled = true
  feedback('#sync-feedback', 'info', 'Sync gestartet …')
  const res = await api(`${SYNC_API}/trigger?source=webapp`, { method: 'POST' })
  if (res.status === 202) {
    feedback('#sync-feedback', 'info', 'Sync läuft im Hintergrund. Aktualisiere Status in ~5 s …')
    setTimeout(async () => {
      await loadSync()
      feedback('#sync-feedback', 'success', 'Status aktualisiert')
      btn.disabled = false
    }, 5000)
  } else if (res.status === 429) {
    feedback('#sync-feedback', 'info', `Cooldown aktiv – bitte in ${res.body?.retry_after_seconds ?? 60} s erneut.`)
    btn.disabled = false
  } else if (res.status === 409) {
    feedback('#sync-feedback', 'info', 'Es läuft bereits ein Sync.')
    btn.disabled = false
  } else {
    feedback('#sync-feedback', 'error', res.body?.error ?? `Fehler ${res.status}`)
    btn.disabled = false
  }
}

async function toggleSync(enable) {
  const res = await api(`${SYNC_API}/config`, { method: 'POST', body: { enabled: enable } })
  if (res.ok) {
    feedback('#sync-feedback', 'success', enable ? 'Smart-Sync aktiviert.' : 'Smart-Sync deaktiviert.')
    await loadSync()
  } else {
    feedback('#sync-feedback', 'error', res.body?.error ?? `Fehler ${res.status}`)
  }
}

async function connectSpotify() {
  const res = await api(`${API}/spotify-oauth/init?return=${encodeURIComponent('/eltern')}`)
  if (res.ok && res.body?.authorize_url) {
    location.href = res.body.authorize_url
  } else if (res.status === 400 && res.body?.error === 'no_client_id') {
    goWizard()
  } else {
    feedback('#sync-feedback', 'error', `OAuth-Init fehlgeschlagen: ${res.status}`)
  }
}

async function disconnectSpotify() {
  if (!confirm('Spotify-Verbindung trennen? Smart-Sync wird gestoppt.')) return
  const res = await api(`${API}/spotify-oauth/disconnect`, { method: 'POST' })
  if (res.ok) {
    await loadSync()
    feedback('#sync-feedback', 'success', 'Spotify-Verbindung getrennt.')
  }
}

async function logout() {
  await api(`${API}/logout`, { method: 'POST' })
  location.reload()
}

/* ---------- settings (Phase 14e polish) ---------- */

async function goSettings() {
  navigate('settings')
}

async function loadSettings() {
  const res = await api(`${SYNC_API}/config`)
  if (!res.ok) {
    feedback('#settings-feedback', 'error', `Laden fehlgeschlagen: ${res.status}`)
    return
  }
  const cfg = res.body ?? {}
  $('#settings-prefix').value = cfg.playlist_prefix ?? ''
  // Backend stores seconds; UI shows minutes — Q6=B default 900s = 15min.
  $('#settings-interval').value = Math.max(5, Math.min(60, Math.round((cfg.polling_interval_seconds ?? 900) / 60)))
  $('#settings-enabled').checked = !!cfg.enabled
  updateSettingsExamples()
}

function updateSettingsExamples() {
  const name = $('#settings-prefix').value.trim() || 'LeniBox'
  setText('#settings-prefix-example-1', `${name}-Hörspiele`)
  setText('#settings-prefix-example-2', `${name}-Musik`)
}

async function saveSettings() {
  const prefix = $('#settings-prefix').value.trim()
  const intervalMin = Number($('#settings-interval').value)
  const enabled = $('#settings-enabled').checked

  if (prefix.length < 2 || prefix.length > 30) {
    feedback('#settings-feedback', 'error', 'Box-Name muss 2-30 Zeichen lang sein.')
    return
  }
  if (!Number.isFinite(intervalMin) || intervalMin < 5 || intervalMin > 60) {
    feedback('#settings-feedback', 'error', 'Sync-Intervall muss zwischen 5 und 60 Minuten liegen.')
    return
  }

  // Save: only send the three fields the user can change here. Backend
  // ignores anything else and clamps polling_interval_seconds to [300, 3600].
  const res = await api(`${SYNC_API}/config`, {
    method: 'POST',
    body: {
      enabled,
      playlist_prefix: prefix,
      polling_interval_seconds: intervalMin * 60,
    },
  })
  if (res.ok) {
    feedback('#settings-feedback', 'success', 'Gespeichert. Änderungen greifen ab dem nächsten Sync-Tick.')
  } else {
    feedback('#settings-feedback', 'error', res.body?.error ?? `Fehler ${res.status}`)
  }
}

/* ---------- wizard ---------- */

function goWizard() {
  navigate('wizard')
}

/** Router-bound loader for the wizard section. Restores the step the
 *  user was on (sessionStorage-backed) so a hashchange/back-button
 *  trip doesn't reset progress. */
function loadWizard() {
  setWizardStep(state.wizardStep || 1)
}

function setWizardStep(step) {
  state.wizardStep = step
  sessionStorage.setItem('wizard.step', String(step))
  setText('#wizard-step-label', `Schritt ${step} von 5`)
  for (const el of $$('.wizard-step')) el.hidden = true
  const target = $(`#wizard-step-${step}`)
  if (target) target.hidden = false
  if (step === 2) updateWizardRedirectUri()
}

function updateWizardRedirectUri() {
  const el = $('#wizard-redirect-uri')
  if (el) el.textContent = `${location.protocol}//${location.host}/api/eltern/spotify-oauth/callback`
}

function updateWizardExamples() {
  const name = $('#wizard-box-name').value.trim() || 'LeniBox'
  setText('#wizard-example-1', `${name}-Hörspiele`)
  setText('#wizard-example-2', `${name}-Musik`)
  setText('#wizard-example-3', `${name}-Schlafenszeit`)
  $('#wizard-app-name').textContent = name
}

async function wizardSaveClientId() {
  const clientId = $('#wizard-client-id').value.trim()
  if (!clientId || !/^[a-zA-Z0-9]+$/.test(clientId) || clientId.length < 16) {
    alert('Bitte eine gültige Client ID einfügen (mind. 16 Zeichen, nur Buchstaben + Zahlen).')
    return
  }
  // Optional Client-Secret-Feld (Phase 14e — wizard kann auch klassisch
  // statt PKCE, falls Eltern's Spotify-App sowieso ein Secret hat).
  // Wizard-UI zeigt das nicht als Pflichtfeld; leerer Wert => PKCE.
  const clientSecret = ''
  const res = await api(`${API}/spotify-credentials`, {
    method: 'POST',
    body: { clientId, clientSecret },
  })
  if (!res.ok) {
    alert(`Speichern fehlgeschlagen: ${res.body?.error ?? res.status}`)
    return
  }
  setWizardStep(4)
}

async function wizardConnectSpotify() {
  await connectSpotify()
}

async function wizardFinish() {
  const name = $('#wizard-box-name').value.trim()
  if (name.length < 2) {
    alert('Box-Name muss mindestens 2 Zeichen lang sein.')
    return
  }
  const res = await api(`${SYNC_API}/config`, {
    method: 'POST',
    body: { enabled: true, playlist_prefix: name },
  })
  if (res.ok) {
    sessionStorage.removeItem('wizard.step')
    state.wizardStep = 1
    navigate('sync')
  } else {
    alert(`Konfiguration speichern fehlgeschlagen: ${res.status}`)
  }
}

/* ---------- bootstrap ---------- */

async function bootstrap() {
  showScreen('loading')
  const res = await api(`${API}/session`)
  if (res.status === 401 || !res.ok) {
    showScreen('no-session')
    return
  }
  state.csrf = res.body.csrf_token
  $('#logout-btn').hidden = false

  // Returned from Spotify OAuth callback? Land on sync so the user sees
  // the confirmation feedback immediately, and strip the query so a
  // reload doesn't re-trigger it.
  if (state.spotifyConnected) {
    history.replaceState({}, '', '/eltern#sync')
    onRoute()
    // Allow loadSync's render to complete, then push feedback over it.
    setTimeout(() => feedback('#sync-feedback', 'success', 'Spotify verbunden — bereit für Smart-Sync.'), 50)
    return
  }
  if (state.spotifyError) {
    history.replaceState({}, '', '/eltern#sync')
    onRoute()
    setTimeout(() => feedback('#sync-feedback', 'error', `Spotify-Fehler: ${state.spotifyError}`), 50)
    return
  }

  // Standard path: route by hash (defaults to hub).
  onRoute()
}

/* ---------- wiring ---------- */

function wire() {
  $('#logout-btn').addEventListener('click', logout)
  $('#sync-trigger-btn').addEventListener('click', triggerSync)
  // Phase 14e polish: "Einstellungen" -> dedicated short settings screen
  // (Box-Name + interval + enable toggle), NOT the full setup wizard.
  $('#sync-config-btn').addEventListener('click', () => goSettings())

  // Phase 15a — header back-button: navigate to the current section's
  // parent (set in SECTIONS map). Default to hub if parent is missing.
  $('#header-back-btn').addEventListener('click', () => {
    const meta = SECTIONS[state.currentSection ?? 'hub']
    navigate(meta?.parent ?? 'hub')
  })

  // Settings-screen buttons.
  $('#settings-back-btn').addEventListener('click', () => navigate('sync'))
  $('#settings-save-btn').addEventListener('click', saveSettings)
  $('#settings-rerun-wizard-btn').addEventListener('click', () => goWizard())
  $('#settings-prefix').addEventListener('input', updateSettingsExamples)

  // Phase 15i — Power-screen save.
  $('#power-save-btn')?.addEventListener('click', savePowerConfig)

  // Phase 15h — Caps-screen actions.
  $('#caps-back-btn')?.addEventListener('click', () => navigate('hub'))
  $('#caps-save-btn')?.addEventListener('click', saveCapsConfig)
  $('#caps-extend-btn')?.addEventListener('click', capsExtend)
  $('#caps-release-btn')?.addEventListener('click', capsRelease)
  $('#caps-quietnow-btn')?.addEventListener('click', capsQuietNow)

  for (const btn of $$('[data-go-step]')) {
    btn.addEventListener('click', () => setWizardStep(Number(btn.dataset.goStep)))
  }
  $('#wizard-save-client-id').addEventListener('click', wizardSaveClientId)
  $('#wizard-connect-btn').addEventListener('click', wizardConnectSpotify)
  $('#wizard-finish-btn').addEventListener('click', wizardFinish)
  $('#wizard-box-name').addEventListener('input', updateWizardExamples)

  // Copy buttons
  for (const btn of $$('.copy-btn')) {
    btn.addEventListener('click', async () => {
      const text = btn.dataset.copyText ?? $(`#${btn.dataset.copy}`)?.textContent ?? ''
      try {
        await navigator.clipboard.writeText(text)
        const old = btn.textContent
        btn.textContent = '✓'
        setTimeout(() => { btn.textContent = old }, 1200)
      } catch {
        alert('Bitte manuell kopieren: ' + text)
      }
    })
  }
}

document.addEventListener('DOMContentLoaded', () => {
  wire()
  // Phase 15a: hash-based routing. hashchange re-routes (browser back/
  // forward + Telegram-bot deep-links). onRoute is gated by state.csrf
  // being non-null, so the listener firing before bootstrap finishes
  // is a no-op.
  window.addEventListener('hashchange', onRoute)
  bootstrap()
})
