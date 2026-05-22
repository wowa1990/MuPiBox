// Phase 14c — Eltern-WebApp client.
// Vanilla ES2020. No framework dependency keeps the bundle small and
// boots fast on flaky LAN. Three screens: loading, no-session, dashboard
// + wizard. Wizard state is in sessionStorage so a page refresh during
// setup doesn't drop the user back to step 1.

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
}

function showScreen(id) {
  for (const s of $$('.screen')) s.hidden = true
  $(`#screen-${id}`).hidden = false
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

/* ---------- screen: dashboard ---------- */

async function loadDashboard() {
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

  // Konflikte
  const confs = cfg.state?.conflicts ?? []
  $('#conflicts-card').hidden = confs.length === 0
  const list = $('#conflicts-list')
  list.innerHTML = ''
  for (const c of confs) {
    const li = document.createElement('li')
    li.textContent = `${c.manualArtist ?? '?'} – ${c.manualTitle ?? '?'} (auch in: ${c.inPlaylists.join(', ')})`
    list.appendChild(li)
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
      await loadDashboard()
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
    await loadDashboard()
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
    await loadDashboard()
    feedback('#sync-feedback', 'success', 'Spotify-Verbindung getrennt.')
  }
}

async function logout() {
  await api(`${API}/logout`, { method: 'POST' })
  location.reload()
}

/* ---------- wizard ---------- */

function goWizard() {
  showScreen('wizard')
  setWizardStep(1)
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
  if (!clientId || !/^[a-zA-Z0-9]+$/.test(clientId)) {
    alert('Bitte eine gültige Client ID einfügen (nur Buchstaben + Zahlen).')
    return
  }
  // Persist via the existing spotify section of mupiboxconfig.json.
  // We don't have a generic /api/eltern/config endpoint yet — reuse the
  // sync config endpoint which has updateMupiboxConfig wired up. (Phase
  // 14e will add a dedicated /api/eltern/spotify-credentials endpoint.)
  // For now: client_id goes via updateMupiboxConfig indirect path —
  // simplest is to add a tiny helper that POSTS to /api/spotify-sync/config
  // with an unrecognised field, which gets dropped — so we need a real
  // endpoint. Workaround: tell the user to use the Admin-UI for now.
  // TODO 14e: add /api/eltern/spotify-credentials POST endpoint.
  alert(
    'Hinweis: Phase-14c speichert Client-ID derzeit noch nicht direkt aus dem Wizard.\n\n' +
    'Bitte trage die Client-ID einmalig im Admin-Interface unter spotify.php ein, klicke dort den Authorize-Link, dann komm zurück hierher.\n\n' +
    'Phase 14e wird das nahtloser machen.',
  )
  // Auch bei nicht-direktem Save: erlauben weiter zu Schritt 4 — vielleicht hat
  // der User die ID schon im Admin-UI hinterlegt.
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
    showScreen('dashboard')
    await loadDashboard()
  } else {
    alert(`Konfiguration speichern fehlgeschlagen: ${res.status}`)
  }
}

/* ---------- bootstrap ---------- */

async function bootstrap() {
  showScreen('loading')
  const res = await api(`${API}/session`)
  if (res.status === 401) {
    showScreen('no-session')
    return
  }
  if (!res.ok) {
    showScreen('no-session')
    return
  }
  state.csrf = res.body.csrf_token
  $('#logout-btn').hidden = false

  // Sind wir vom OAuth-Callback zurück?
  if (state.spotifyConnected) {
    showScreen('dashboard')
    await loadDashboard()
    feedback('#sync-feedback', 'success', 'Spotify verbunden — bereit für Smart-Sync.')
    history.replaceState({}, '', '/eltern')
    return
  }
  if (state.spotifyError) {
    showScreen('dashboard')
    await loadDashboard()
    feedback('#sync-feedback', 'error', `Spotify-Fehler: ${state.spotifyError}`)
    history.replaceState({}, '', '/eltern')
    return
  }

  showScreen('dashboard')
  await loadDashboard()
}

/* ---------- wiring ---------- */

function wire() {
  $('#logout-btn').addEventListener('click', logout)
  $('#sync-trigger-btn').addEventListener('click', triggerSync)
  $('#sync-config-btn').addEventListener('click', () => goWizard())

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
  bootstrap()
})
