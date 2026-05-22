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
