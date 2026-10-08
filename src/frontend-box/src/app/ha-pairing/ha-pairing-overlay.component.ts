import { HttpClient } from '@angular/common/http'
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { catchError, interval, of, startWith, switchMap } from 'rxjs'
import { environment } from 'src/environments/environment'
import { DisplayTextsService } from '../display-texts.service'

/** What the backend tells the display about a pairing with Home Assistant (backend-api ha/ha-api.ts pairingForDisplay) */
interface HaPairing {
  active: boolean
  /** waiting: opened in the app, Home Assistant has not started yet; code: Home Assistant waits for the code */
  stage?: 'waiting' | 'code'
  code?: string
  client_name?: string
  scopes?: string[]
  expires_in?: number
  /** the key's SPKI SHA-256, in groups of four */
  fingerprint?: string
}

/**
 * Pairing with Home Assistant, on the box's own display: the key's fingerprint to compare with the one Home Assistant
 * shows, then the six-digit code and the rights it asks for. The code exists only here (never in an answer to the
 * network, see the backend) - whoever reads it stands at the box. Asked every 2 s; the backend answers on the box
 * itself only.
 */
@Component({
  selector: 'mupi-ha-pairing-overlay',
  templateUrl: './ha-pairing-overlay.component.html',
  styleUrls: ['./ha-pairing-overlay.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HaPairingOverlayComponent {
  private readonly http = inject(HttpClient)
  protected readonly texts = inject(DisplayTextsService)
  protected readonly pairing = signal<HaPairing>({ active: false })
  /** the code in two groups of three: "482 913" */
  protected readonly code = computed(() => (this.pairing().code ?? '').replace(/^(\d{3})(\d{3})$/, '$1 $2'))
  protected readonly scopes = computed(() =>
    (this.pairing().scopes ?? [])
      .map((s) => (s === 'read' ? this.texts.text('haScopeRead') : s === 'control' ? this.texts.text('haScopeControl') : s))
      .join(' · '),
  )

  constructor() {
    interval(2000)
      .pipe(
        startWith(0),
        switchMap(() => this.http.get<HaPairing>(`${environment.backend.apiUrl}/ha-pairing`).pipe(catchError(() => of({ active: false } as HaPairing)))),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((p) => {
        const was = this.pairing().active
        this.pairing.set(p && typeof p === 'object' ? p : { active: false })
        // (texts changed in the app since the box started)
        if (!was && p?.active) this.texts.refresh()
      })
  }

  protected cancel(): void {
    this.pairing.set({ active: false })
    this.http.post(`${environment.backend.apiUrl}/ha-pairing/cancel`, {}).subscribe({ error: () => undefined })
  }
}
