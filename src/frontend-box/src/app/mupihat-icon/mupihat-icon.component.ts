import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core'
import { toObservable, toSignal } from '@angular/core/rxjs-interop'
import { map, of, switchMap } from 'rxjs'
import { MediaService } from '../media.service'
import type { Mupihat } from '../mupihat'
import { PlayerService } from '../player.service'
import { KmThemeService } from '../theme/km-theme.service'

@Component({
  selector: 'mupihat-icon',
  templateUrl: './mupihat-icon.component.html',
  styleUrls: ['./mupihat-icon.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MupiHatIconComponent {
  protected readonly mupihat: Signal<Mupihat | undefined>
  protected readonly hat_active: Signal<boolean>
  // km themes: a small battery (32 × 17) with the percentage below it (the design's status area)
  protected readonly km = inject(KmThemeService).isKm
  // 0-100: the granular percentage of the backend, or the four buckets of an older one
  protected readonly level = computed(() => {
    const hat = this.mupihat()
    const percent = hat?.Bat_Percent
    if (percent !== undefined && percent !== null) {
      return Math.max(0, Math.min(100, Math.round(percent)))
    }
    switch (hat?.Bat_SOC) {
      case '100%':
        return 100
      case '75%':
        return 75
      case '50%':
        return 50
      case '25%':
        return 25
      default:
        return 0
    }
  })
  protected readonly charging = computed(() => (this.mupihat()?.IBus ?? 0) > 0)

  public constructor(
    private playerService: PlayerService,
    private mediaService: MediaService,
  ) {
    this.hat_active = toSignal(this.playerService.getConfig().pipe(map((config) => config.hat_active)))
    this.mupihat = toSignal(
      toObservable(this.hat_active).pipe(
        switchMap((hat_active) => (hat_active ? this.mediaService.mupihat$ : of(undefined))),
      ),
    )
  }
}
