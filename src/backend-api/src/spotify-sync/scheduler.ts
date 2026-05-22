// Phase 14b — scheduler.
// Sets up the recurring cron-style sync timer and exposes a manual
// trigger entry point with 60s throttling (Q6 manual_throttle_seconds).
// Single ownership: only one timer per process, never overlapping
// scheduled runs (the sync-lock would catch overlaps anyway, but the
// timer is also kept honest).
//
// Lifetimes follow the box's pm2/systemd-managed backend-api process —
// stop() exists for tests but isn't called in production.

import { runSync, type RunSyncDeps, type RunSyncResult } from './state-machine'
import type { SyncTrigger } from './types'
import { loadSpotifySyncConfig } from './config-loader'

const MANUAL_THROTTLE_PATH = '/tmp/.last_sync_trigger'

let timerHandle: ReturnType<typeof setTimeout> | null = null
let inflight: Promise<RunSyncResult> | null = null

/**
 * Schedule the next sync after `delaySeconds`. Re-arms itself after each
 * run finishes (success or failure) — failures get the configured
 * polling interval too, no exponential back-off; rate-limit returns from
 * runSync include the retryAfterSeconds value which we honour.
 */
export function startScheduler(deps: RunSyncDeps): void {
  if (timerHandle) {
    // Already running — defensively clear so we don't end up with two
    // overlapping cycles after a hot-reload.
    clearTimeout(timerHandle)
    timerHandle = null
  }
  const config = loadSpotifySyncConfig(deps.getMupiboxConfig())
  // Boot-after-60s lead-in: the box might be still finishing startup
  // when backend-api comes up; don't ambush the I2C bus / network in
  // the first minute.
  scheduleNext(60, deps)
  console.log(
    `${new Date().toLocaleString()}: [spotify-sync] scheduler started (enabled=${config.enabled}, interval=${config.polling_interval_seconds}s)`,
  )
}

function scheduleNext(delaySeconds: number, deps: RunSyncDeps): void {
  if (timerHandle) clearTimeout(timerHandle)
  timerHandle = setTimeout(async () => {
    timerHandle = null
    const config = loadSpotifySyncConfig(deps.getMupiboxConfig())
    if (!config.enabled) {
      // Re-poll the config periodically even when disabled, so the user
      // can flip the toggle in the WebApp without a backend restart.
      scheduleNext(config.polling_interval_seconds, deps)
      return
    }
    const result = await runOnce('cron', deps)
    // Honour rate-limit retry-after if present, else standard interval.
    const next = result.state === 'RATE_LIMITED' && result.retryAfterSeconds ? result.retryAfterSeconds : config.polling_interval_seconds
    scheduleNext(next, deps)
  }, delaySeconds * 1000)
  // Keep the event loop responsive — sync polling isn't a reason to
  // pin the process awake. (No-op on Node22 if there's other activity.)
  if (typeof timerHandle.unref === 'function') timerHandle.unref()
}

/**
 * Manual trigger. Returns 'queued' if a run started, 'throttled' if the
 * 60s cooldown is active, 'running' if a sync is already in flight, or
 * 'disabled' if spotify_sync is off.
 */
export async function triggerManualSync(
  source: Extract<SyncTrigger, 'webapp' | 'telegram'>,
  deps: RunSyncDeps,
): Promise<
  | { ok: true; status: 'queued'; estimatedSeconds: number }
  | { ok: false; status: 'throttled'; retryAfterSeconds: number }
  | { ok: false; status: 'running' }
  | { ok: false; status: 'disabled' }
> {
  const config = loadSpotifySyncConfig(deps.getMupiboxConfig())
  if (!config.enabled) return { ok: false, status: 'disabled' }
  if (inflight) return { ok: false, status: 'running' }
  // Cooldown check
  const cooldownLeft = getManualThrottleRemaining(config.manual_throttle_seconds)
  if (cooldownLeft > 0) {
    return { ok: false, status: 'throttled', retryAfterSeconds: cooldownLeft }
  }
  markManualTrigger()
  // Fire and forget — caller polls /status. Estimate is a hand-tuned
  // ~3s typical run; not load-bearing for correctness, only for UX.
  void runOnce(source, deps)
  return { ok: true, status: 'queued', estimatedSeconds: 3 }
}

/** Returns the seconds left on the manual-trigger cooldown, or 0 if free. */
function getManualThrottleRemaining(throttleSeconds: number): number {
  try {
    const fs = require('node:fs') as typeof import('node:fs')
    if (!fs.existsSync(MANUAL_THROTTLE_PATH)) return 0
    const stat = fs.statSync(MANUAL_THROTTLE_PATH)
    const ageSeconds = (Date.now() - stat.mtimeMs) / 1000
    if (ageSeconds >= throttleSeconds) return 0
    return Math.ceil(throttleSeconds - ageSeconds)
  } catch {
    return 0
  }
}

/** Touch the trigger marker so subsequent manual triggers see the cooldown. */
function markManualTrigger(): void {
  try {
    const fs = require('node:fs') as typeof import('node:fs')
    fs.writeFileSync(MANUAL_THROTTLE_PATH, String(Date.now()))
  } catch {
    // tmpfs full or similar — non-fatal, just no cooldown enforcement.
  }
}

/** Internal: run sync, tracking inflight state for the running-guard. */
async function runOnce(trigger: SyncTrigger, deps: RunSyncDeps): Promise<RunSyncResult> {
  if (inflight) return inflight
  inflight = runSync(trigger, deps).finally(() => {
    inflight = null
  })
  return inflight
}

/** Stop the scheduler — only used in tests. */
export function stopScheduler(): void {
  if (timerHandle) {
    clearTimeout(timerHandle)
    timerHandle = null
  }
}
