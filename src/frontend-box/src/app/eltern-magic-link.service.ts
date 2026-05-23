// Phase 15b — Magic-Link trigger via Cloud+Batterie-Tap sequence on
// the box display. The architecture paper §4.2 of phase15_eltern_hub.md
// defines the gesture: 5 taps on the Cloud-icon followed by 5 taps on
// the Battery-icon, both within a short window, fetches a magic-link
// from the backend and shows a QR-overlay for 60s so parents can scan
// it with their phone.
//
// State is intentionally tiny and lives entirely in this single-instance
// service — no template-state coupling beyond the four exposed signals
// the overlay component reads.

import { Injectable, signal } from '@angular/core'

const REQUIRED_TAPS = 5
const RESET_AFTER_MS = 2000
const OVERLAY_TIMEOUT_S = 60

@Injectable({ providedIn: 'root' })
export class ElternMagicLinkService {
  private cloudTaps = 0
  private batteryTaps = 0
  private lastTapTime = 0
  private countdownTimer: ReturnType<typeof setTimeout> | null = null

  /** Whether the overlay is currently shown. Read by the overlay component. */
  readonly visible = signal(false)
  /** Plain magic-link URL (also rendered as text fallback for parents whose
   *  smartphone camera fails to scan the QR). */
  readonly magicLinkUrl = signal<string | null>(null)
  /** Backend-rendered QR-Code SVG URL (loaded as <img src>). */
  readonly qrUrl = signal<string | null>(null)
  /** Remaining seconds before auto-close. UI shows this as a countdown. */
  readonly countdownSeconds = signal(OVERLAY_TIMEOUT_S)

  /** Called from the home-page Cloud-icon tap target. Counts up — second
   *  half of the sequence (Battery-taps) is gated on this reaching 5
   *  within the reset window. */
  registerCloudTap(): void {
    this.maybeReset()
    this.cloudTaps++
    this.lastTapTime = Date.now()
  }

  /** Called from the home-page Battery-icon tap target. Discards itself
   *  silently if the cloud-counter hasn't reached the threshold yet —
   *  prevents random Battery-tapping from accidentally triggering. */
  registerBatteryTap(): void {
    this.maybeReset()
    if (this.cloudTaps < REQUIRED_TAPS) {
      // Out-of-sequence — clear and exit.
      this.cloudTaps = 0
      this.batteryTaps = 0
      return
    }
    this.batteryTaps++
    this.lastTapTime = Date.now()
    if (this.batteryTaps >= REQUIRED_TAPS) {
      this.cloudTaps = 0
      this.batteryTaps = 0
      void this.fetchMagicLinkAndShow()
    }
  }

  /** Manually close the overlay (X button or backdrop click). Idempotent. */
  close(): void {
    this.visible.set(false)
    this.magicLinkUrl.set(null)
    this.qrUrl.set(null)
    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer)
      this.countdownTimer = null
    }
  }

  private maybeReset(): void {
    if (Date.now() - this.lastTapTime > RESET_AFTER_MS) {
      this.cloudTaps = 0
      this.batteryTaps = 0
    }
  }

  private async fetchMagicLinkAndShow(): Promise<void> {
    try {
      const res = await fetch('/api/eltern/magic-link/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'cloud-battery-tap' }),
      })
      if (!res.ok) {
        console.warn('[eltern-magic-link] generate failed:', res.status)
        return
      }
      const body = (await res.json()) as { token: string }
      const fullUrl = `${location.protocol}//${location.host}/eltern?token=${encodeURIComponent(body.token)}`
      this.magicLinkUrl.set(fullUrl)
      this.qrUrl.set(`/api/eltern/magic-link/qr?token=${encodeURIComponent(body.token)}`)
      this.visible.set(true)
      this.startCountdown()
    } catch (err) {
      console.error('[eltern-magic-link] generate threw:', err)
    }
  }

  private startCountdown(): void {
    this.countdownSeconds.set(OVERLAY_TIMEOUT_S)
    const tick = (): void => {
      const left = this.countdownSeconds() - 1
      if (left <= 0) {
        this.close()
        return
      }
      this.countdownSeconds.set(left)
      this.countdownTimer = setTimeout(tick, 1000)
    }
    this.countdownTimer = setTimeout(tick, 1000)
  }
}
