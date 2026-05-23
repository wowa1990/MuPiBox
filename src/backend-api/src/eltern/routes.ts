// Phase 14c — Eltern-WebApp REST routes.
//
// Mounted at /api/eltern/* and /eltern (Magic-Link landing + WebApp
// static assets) by server.ts. Three logical groups:
//   - auth (magic-link redeem, session info, logout)
//   - oauth (Spotify connect/callback/disconnect)
//   - generation helpers (magic-link issuance for Telegram/Box-Tap)
//
// All handlers below the localNetworkOnly + requireSession layer can
// trust the session; the magic-link endpoints are exposed without
// session (that's how you get one in the first place) but rate-limited
// per-IP.

import { Router } from 'express'
import type { MupiboxConfig } from '../models/mupibox-config.model'
import { CSRF_HEADER, SESSION_COOKIE, destroySession, generateMagicLink, redeemMagicLink } from './auth'
import { ipRateLimit, localNetworkOnly, requireCsrf, requireSession } from './middleware'
import {
  REQUESTED_SCOPES,
  buildAuthorizeUrl,
  buildRedirectUri,
  clearSpotifyTokens,
  consumeOauthState,
  exchangeCodeForTokens,
} from './oauth'

export interface ElternRouterDeps {
  getMupiboxConfig: () => MupiboxConfig | undefined
  updateMupiboxConfig: (mutate: (cfg: Record<string, unknown>) => void) => Promise<void>
}

/** Build a Set-Cookie header value. HttpOnly + SameSite=Strict; no Secure
 *  flag because the box serves over plain HTTP on LAN. */
function buildSessionCookie(sessionId: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`
}

/** Clear-cookie helper for logout. */
function buildClearCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
}

/**
 * Creates the API router for /api/eltern/*. The /eltern landing page
 * (magic-link redemption) is a separate route in server.ts because it
 * needs to redirect to the WebApp, not return JSON.
 */
export function createElternApiRouter(deps: ElternRouterDeps): Router {
  const router = Router()

  // Every API route requires LAN + session; magic-link generation
  // (the bootstrap path) requires LAN + rate-limit but no session.
  router.use(localNetworkOnly)

  /**
   * POST /api/eltern/magic-link/generate
   * Issues a single-use magic-link token. Caller is expected to be the
   * Telegram bot OR the Cloud+Batterie-Tap handler — both intermediate
   * a physical access proof (chatId-whitelist or device-touch sequence).
   * This endpoint itself is just rate-limited; the caller is the
   * security boundary.
   *
   * Body: { source?: 'telegram' | 'cloud-batterie-tap' | 'admin' }.
   */
  router.post('/magic-link/generate', ipRateLimit(10), (req, res) => {
    const body = (req.body ?? {}) as { source?: unknown }
    const source = typeof body.source === 'string' ? body.source : 'unknown'
    const link = generateMagicLink(source)
    res.status(201).json({
      token: link.token,
      expires_in: link.expiresIn,
      url_path: `/eltern?token=${encodeURIComponent(link.token)}`,
    })
  })

  /** GET /api/eltern/session  — does the current request carry a valid
   *  session? Used by the WebApp on load to decide login vs. dashboard. */
  router.get('/session', requireSession, (req, res) => {
    res.json({
      authenticated: true,
      csrf_header: CSRF_HEADER,
      csrf_token: req.elternSessionCsrf,
    })
  })

  /** POST /api/eltern/logout  — destroys the session, clears the cookie. */
  router.post('/logout', requireSession, requireCsrf, (req, res) => {
    destroySession(req.elternSessionId)
    res.setHeader('Set-Cookie', buildClearCookie())
    res.json({ ok: true })
  })

  /**
   * GET /api/eltern/spotify-oauth/init
   * Starts the Authorize-flow. Returns the Spotify URL the WebApp should
   * window.location.href to. Caller's redirect-target after callback is
   * optionally provided as ?return=/eltern/sync (defaults to /eltern).
   */
  router.get('/spotify-oauth/init', requireSession, (req, res) => {
    const host = req.headers.host
    if (typeof host !== 'string') {
      res.status(400).json({ error: 'no host header' })
      return
    }
    const ret = typeof req.query.return === 'string' ? req.query.return : '/eltern'
    const result = buildAuthorizeUrl({
      getMupiboxConfig: deps.getMupiboxConfig,
      sessionId: req.elternSessionId ?? '',
      host,
      protocol: 'http',
      redirectAfter: ret,
    })
    if ('error' in result) {
      res.status(400).json({ error: 'no_client_id', redirect_to: '/eltern/wizard' })
      return
    }
    res.json({
      authorize_url: result.url,
      redirect_uri: result.redirectUri,
      scopes: REQUESTED_SCOPES,
    })
  })

  /**
   * GET /api/eltern/spotify-oauth/callback
   * Spotify redirects here after the user authorises. We swap code for
   * tokens, persist them, then redirect back to the WebApp. Uses the
   * exchange result to reset the box's tokenScopes so Smart-Sync picks
   * up the new permissions immediately.
   *
   * NOTE: This route accepts a session cookie (the user is bouncing back
   * from Spotify within the same browser session); a hostile bouncer
   * without the session cookie can't poison state because we additionally
   * gate on the OAuth state token issued in /init.
   */
  router.get('/spotify-oauth/callback', requireSession, async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    const code = typeof req.query.code === 'string' ? req.query.code : ''
    const error = typeof req.query.error === 'string' ? req.query.error : ''
    if (error) {
      res.redirect(`/eltern?spotify_error=${encodeURIComponent(error)}`)
      return
    }
    if (!state || !code) {
      res.status(400).send('missing code or state')
      return
    }
    const original = consumeOauthState(state)
    if (!original || original.sessionId !== req.elternSessionId) {
      res.status(403).send('invalid or replayed state')
      return
    }
    const host = req.headers.host
    if (typeof host !== 'string') {
      res.status(400).send('no host header')
      return
    }
    const redirectUri = buildRedirectUri('http', host)
    const exchange = await exchangeCodeForTokens({
      code,
      redirectUri,
      getMupiboxConfig: deps.getMupiboxConfig,
      updateMupiboxConfig: deps.updateMupiboxConfig,
    })
    if (!exchange.ok) {
      res.redirect(`/eltern?spotify_error=${encodeURIComponent(exchange.reason)}`)
      return
    }
    res.redirect(`${original.redirectAfter}?spotify_connected=1`)
  })

  /** POST /api/eltern/spotify-oauth/disconnect  — clears stored tokens. */
  router.post('/spotify-oauth/disconnect', requireSession, requireCsrf, async (_req, res) => {
    await clearSpotifyTokens(deps.updateMupiboxConfig)
    res.json({ ok: true })
  })

  /**
   * GET /api/eltern/caps-config
   * Returns playtimeLimit + quietHours configuration (per-weekday limits
   * and schedules) so the WebApp can render the editor. Live status
   * (today's used/remaining minutes) comes from the existing
   * /api/playtime endpoint — this one is just the static configuration
   * side. Phase 15h.
   */
  router.get('/caps-config', requireSession, (_req, res) => {
    const cfg = deps.getMupiboxConfig()
    const playtime = (cfg?.playtimeLimit as Record<string, unknown> | undefined) ?? {}
    const quiet = (cfg?.quietHours as Record<string, unknown> | undefined) ?? {}
    res.json({
      playtimeLimit: {
        enabled: playtime.enabled ?? false,
        maxOverrunMinutes: playtime.maxOverrunMinutes ?? 10,
        resetHour: playtime.resetHour ?? 0,
        limitsMinutes: playtime.limitsMinutes ?? {
          mon: 60, tue: 60, wed: 60, thu: 60, fri: 60, sat: 60, sun: 60,
        },
      },
      quietHours: {
        enabled: quiet.enabled ?? false,
        maxOverrunMinutes: quiet.maxOverrunMinutes ?? 10,
        schedule: quiet.schedule ?? { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
      },
    })
  })

  /**
   * POST /api/eltern/caps-config
   * Update the playtimeLimit and quietHours config blocks. Validates the
   * shape (numeric day-limits 0-1440, schedule windows as {start, end}
   * HH:MM-strings). Existing /api/playtime/limit endpoint sets one day
   * at a time; this one is bulk-write for the WebApp's day-grid editor.
   * Phase 15h.
   */
  router.post('/caps-config', requireSession, requireCsrf, async (req, res) => {
    const body = (req.body ?? {}) as {
      playtimeLimit?: {
        enabled?: unknown
        limitsMinutes?: Record<string, unknown>
        maxOverrunMinutes?: unknown
      }
      quietHours?: {
        enabled?: unknown
        schedule?: Record<string, unknown>
        maxOverrunMinutes?: unknown
      }
    }
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
    // Validate playtimeLimit.limitsMinutes if provided.
    const validatedLimits: Record<string, number> = {}
    if (body.playtimeLimit?.limitsMinutes) {
      for (const day of days) {
        const v = body.playtimeLimit.limitsMinutes[day]
        if (v === undefined) continue
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1440) {
          res.status(400).json({ error: `invalid limitsMinutes.${day}` })
          return
        }
        validatedLimits[day] = Math.floor(v)
      }
    }
    // Validate quietHours.schedule if provided.
    const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
    const validatedSchedule: Record<string, Array<{ start: string; end: string }>> = {}
    if (body.quietHours?.schedule) {
      for (const day of days) {
        const windows = body.quietHours.schedule[day]
        if (windows === undefined) continue
        if (!Array.isArray(windows)) {
          res.status(400).json({ error: `schedule.${day} must be an array` })
          return
        }
        const accepted: Array<{ start: string; end: string }> = []
        for (const w of windows) {
          if (!w || typeof w !== 'object') {
            res.status(400).json({ error: `schedule.${day} entry must be {start,end}` })
            return
          }
          const start = (w as Record<string, unknown>).start
          const end = (w as Record<string, unknown>).end
          if (typeof start !== 'string' || typeof end !== 'string' || !HHMM.test(start) || !HHMM.test(end)) {
            res.status(400).json({ error: `schedule.${day} times must be HH:MM strings` })
            return
          }
          accepted.push({ start, end })
        }
        validatedSchedule[day] = accepted
      }
    }
    await deps.updateMupiboxConfig((cfg) => {
      if (body.playtimeLimit) {
        const block = ((cfg.playtimeLimit as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>
        if (typeof body.playtimeLimit.enabled === 'boolean') block.enabled = body.playtimeLimit.enabled
        if (typeof body.playtimeLimit.maxOverrunMinutes === 'number') block.maxOverrunMinutes = Math.max(0, Math.min(120, Math.floor(body.playtimeLimit.maxOverrunMinutes)))
        if (Object.keys(validatedLimits).length > 0) {
          const lm = ((block.limitsMinutes as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>
          Object.assign(lm, validatedLimits)
          block.limitsMinutes = lm
        }
        cfg.playtimeLimit = block
      }
      if (body.quietHours) {
        const block = ((cfg.quietHours as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>
        if (typeof body.quietHours.enabled === 'boolean') block.enabled = body.quietHours.enabled
        if (typeof body.quietHours.maxOverrunMinutes === 'number') block.maxOverrunMinutes = Math.max(0, Math.min(120, Math.floor(body.quietHours.maxOverrunMinutes)))
        if (Object.keys(validatedSchedule).length > 0) {
          const sched = ((block.schedule as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>
          Object.assign(sched, validatedSchedule)
          block.schedule = sched
        }
        cfg.quietHours = block
      }
    })
    res.json({ ok: true })
  })

  /**
   * GET /api/eltern/power-config
   * Returns idle-shutdown + display-timeout fields from mupiboxconfig.timeout.
   * Plus the active battery profile name so the WebApp can display it
   * alongside live mupihat readings. Phase 15i.
   */
  router.get('/power-config', requireSession, (_req, res) => {
    const cfg = deps.getMupiboxConfig()
    const timeout = (cfg?.timeout as Record<string, unknown> | undefined) ?? {}
    const mupihat = (cfg?.mupihat as Record<string, unknown> | undefined) ?? {}
    const selectedBattery = typeof mupihat.selected_battery === 'string' ? mupihat.selected_battery : ''
    // Find the active profile's config for the read-only display side
    const types = Array.isArray(mupihat.battery_types) ? (mupihat.battery_types as Array<Record<string, unknown>>) : []
    const profile = types.find((p) => p?.name === selectedBattery)
    res.json({
      timeout: {
        // Existing fields are numbers-stored-as-strings in the JSON;
        // normalise to numbers for the UI side, fall back to defaults
        // from config/templates/mupiboxconfig.json.
        idlePiShutdown: Number(timeout.idlePiShutdown ?? 0),
        idleDisplayOff: Number(timeout.idleDisplayOff ?? 10),
        pressDelay: Number(timeout.pressDelay ?? 2),
      },
      battery: {
        selected: selectedBattery,
        profile: (profile?.config as Record<string, unknown> | undefined) ?? null,
      },
    })
  })

  /**
   * POST /api/eltern/power-config
   * Updates idlePiShutdown / idleDisplayOff. Values arrive as numbers,
   * persisted as strings (matches the existing JSON convention from
   * Phase 1's config). Phase 15i.
   */
  router.post('/power-config', requireSession, requireCsrf, async (req, res) => {
    const body = (req.body ?? {}) as { idlePiShutdown?: unknown; idleDisplayOff?: unknown }
    const mutations: Record<string, string> = {}
    if (typeof body.idlePiShutdown === 'number' && Number.isFinite(body.idlePiShutdown)) {
      const v = Math.max(0, Math.min(1440, Math.floor(body.idlePiShutdown)))
      mutations.idlePiShutdown = String(v)
    }
    if (typeof body.idleDisplayOff === 'number' && Number.isFinite(body.idleDisplayOff)) {
      const v = Math.max(0, Math.min(1440, Math.floor(body.idleDisplayOff)))
      mutations.idleDisplayOff = String(v)
    }
    if (Object.keys(mutations).length === 0) {
      res.status(400).json({ error: 'no recognised fields in body' })
      return
    }
    await deps.updateMupiboxConfig((cfg) => {
      const timeout = ((cfg.timeout as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>
      Object.assign(timeout, mutations)
      cfg.timeout = timeout
    })
    res.json({ ok: true, applied: mutations })
  })

  /**
   * POST /api/eltern/spotify-credentials
   * Persists the user-provided clientId (and optional clientSecret) into
   * mupiboxconfig.json.spotify. This is the wizard-step-3 endpoint that
   * was deferred in Phase 14c.
   *
   * Validation: clientId must be base64url-style alphanumeric (Spotify's
   * format), at least 16 characters. clientSecret optional — when blank
   * the box flips to PKCE-style refresh in src/spotify-sync/auth.ts.
   */
  router.post('/spotify-credentials', requireSession, requireCsrf, async (req, res) => {
    const body = (req.body ?? {}) as { clientId?: unknown; clientSecret?: unknown }
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
    const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : ''
    if (clientId.length < 16 || clientId.length > 64 || !/^[A-Za-z0-9]+$/.test(clientId)) {
      res.status(400).json({ error: 'clientId must be 16-64 alphanumeric characters' })
      return
    }
    if (clientSecret && (clientSecret.length < 16 || clientSecret.length > 64 || !/^[A-Za-z0-9]+$/.test(clientSecret))) {
      res.status(400).json({ error: 'clientSecret must be 16-64 alphanumeric characters when provided' })
      return
    }
    await deps.updateMupiboxConfig((cfg) => {
      const spotify = ((cfg.spotify as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>
      spotify.clientId = clientId
      // Empty secret deliberately persisted as '' so the PKCE branch in
      // src/spotify-sync/auth.ts picks it up; don't write `undefined`,
      // because jsonfile collapses that into a missing key and existing
      // code reads via typeof === 'string'.
      spotify.clientSecret = clientSecret
      cfg.spotify = spotify
    })
    res.json({ ok: true, mode: clientSecret ? 'classic' : 'pkce' })
  })

  return router
}

/**
 * Creates the /eltern landing-page route — separate from the API router
 * because it handles the magic-link query param and either issues a
 * session cookie + redirect or serves the WebApp shell.
 *
 * Returns a one-off RequestHandler intended for server.ts to register.
 */
export function buildElternLandingHandler(): import('express').RequestHandler {
  return (req, res, next) => {
    const token = typeof req.query.token === 'string' ? req.query.token : ''
    if (!token) {
      // No token — let the static-file handler serve index.html for the
      // WebApp shell. Browser-side code does its own session check via
      // GET /api/eltern/session.
      next()
      return
    }
    const ip = req.ip ?? req.socket.remoteAddress ?? ''
    const session = redeemMagicLink(token, ip)
    if (!session) {
      res.status(401).send('Magic-Link ungültig oder abgelaufen')
      return
    }
    // Set cookie, strip the token from URL by redirecting to /eltern
    res.setHeader('Set-Cookie', buildSessionCookie(session.sessionId, 24 * 60 * 60))
    res.redirect('/eltern')
  }
}
