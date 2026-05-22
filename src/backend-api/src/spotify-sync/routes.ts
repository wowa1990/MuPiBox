// Phase 14b — REST routes.
// Express router for /api/spotify-sync/*. Mounted from server.ts. Kept
// thin: each handler validates input, calls into the scheduler or
// state-file modules, and translates outcomes to HTTP responses. No
// business logic lives here.
//
// Full OAuth init/callback endpoints come in Phase 14c with the
// Eltern-WebApp setup-wizard — for now we only need status + trigger
// + config to verify the sync loop works end-to-end.

import { Router } from 'express'
import { loadSpotifySyncConfig, loadSpotifyTokenStore } from './config-loader'
import { requiresReAuth, tokenStillValid } from './auth'
import { readStateFile } from './state-file'
import { triggerManualSync } from './scheduler'
import type { RunSyncDeps } from './state-machine'
import {
  POLLING_INTERVAL_SECONDS_MAX,
  POLLING_INTERVAL_SECONDS_MIN,
  type SpotifySyncConfig,
} from './types'

export function createSpotifySyncRouter(deps: RunSyncDeps): Router {
  const router = Router()

  /** GET /api/spotify-sync/status
   *  Returns the current sync state, last run info, and auth status. */
  router.get('/status', (_req, res) => {
    const state = readStateFile(deps.stateFilePath)
    const config = loadSpotifySyncConfig(deps.getMupiboxConfig())
    const tokenStore = loadSpotifyTokenStore(deps.getMupiboxConfig())
    res.json({
      enabled: config.enabled,
      polling_interval_seconds: config.polling_interval_seconds,
      playlist_prefix: config.playlist_prefix,
      token: {
        configured: !!tokenStore,
        valid: tokenStore ? tokenStillValid(tokenStore) : false,
        scopes_ok: tokenStore ? !requiresReAuth(tokenStore) : false,
        expires_at: tokenStore?.tokenExpiresAt,
      },
      state,
    })
  })

  /** POST /api/spotify-sync/trigger
   *  Manual sync trigger. Source query param `?source=webapp|telegram`. */
  router.post('/trigger', async (req, res) => {
    const sourceRaw = typeof req.query.source === 'string' ? req.query.source : 'webapp'
    const source: 'webapp' | 'telegram' = sourceRaw === 'telegram' ? 'telegram' : 'webapp'
    const result = await triggerManualSync(source, deps)
    if (!result.ok) {
      const code = result.status === 'throttled' ? 429 : result.status === 'running' ? 409 : 400
      res.status(code).json(result)
      return
    }
    res.status(202).json(result)
  })

  /** GET /api/spotify-sync/config
   *  Returns the merged effective config (defaults + user overrides). */
  router.get('/config', (_req, res) => {
    const config = loadSpotifySyncConfig(deps.getMupiboxConfig())
    res.json(config)
  })

  /** POST /api/spotify-sync/config
   *  Update mutable fields. Body: { enabled?, playlist_prefix?,
   *  polling_interval_seconds?, playlist_explicit_ids?, notify_on_*? }.
   *  Unknown fields are ignored. */
  router.post('/config', async (req, res) => {
    const body = req.body as Partial<SpotifySyncConfig>
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'body must be a JSON object' })
      return
    }
    // Validate fields we actually accept from the user. Anything else
    // gets dropped silently (defence-in-depth — Admin-UI / WebApp can't
    // sneak unknown keys in).
    const mutations: Record<string, unknown> = {}
    if (typeof body.enabled === 'boolean') mutations.enabled = body.enabled
    if (typeof body.playlist_prefix === 'string' && body.playlist_prefix.trim().length >= 2) {
      mutations.playlist_prefix = body.playlist_prefix.trim()
    }
    if (typeof body.polling_interval_seconds === 'number') {
      const clamped = Math.max(
        POLLING_INTERVAL_SECONDS_MIN,
        Math.min(POLLING_INTERVAL_SECONDS_MAX, Math.floor(body.polling_interval_seconds)),
      )
      mutations.polling_interval_seconds = clamped
    }
    if (Array.isArray(body.playlist_explicit_ids)) {
      mutations.playlist_explicit_ids = body.playlist_explicit_ids.filter((id): id is string => typeof id === 'string')
    }
    if (typeof body.notify_on_sync === 'boolean') mutations.notify_on_sync = body.notify_on_sync
    if (typeof body.notify_on_conflict === 'boolean') mutations.notify_on_conflict = body.notify_on_conflict
    if (typeof body.notify_on_failure_after_attempts === 'number') {
      mutations.notify_on_failure_after_attempts = Math.max(1, Math.floor(body.notify_on_failure_after_attempts))
    }
    if (Object.keys(mutations).length === 0) {
      res.status(400).json({ error: 'no recognised fields in body' })
      return
    }
    await deps.updateMupiboxConfig((cfg) => {
      const existing = ((cfg.spotify_sync as Record<string, unknown> | undefined) ?? {}) as Record<string, unknown>
      Object.assign(existing, mutations)
      cfg.spotify_sync = existing
    })
    const merged = loadSpotifySyncConfig(deps.getMupiboxConfig())
    res.json({ ok: true, applied: mutations, current: merged })
  })

  return router
}
