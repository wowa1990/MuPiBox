import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import { NavigationEnd, Router } from '@angular/router'
import { IonIcon } from '@ionic/angular/standalone'
import { addIcons } from 'ionicons'
import { musicalNotes, stop } from 'ionicons/icons'
import { filter, map } from 'rxjs/operators'
import { BackgroundPlaybackService } from '../background-playback.service'
import { DisplayTextsService } from '../display-texts.service'

const SHOWN_ON = new Set(['/', '/home', '/medialist', '/resume'])

/**
 * The "Läuft gerade" bar of the start page: shown while the player page was left with the playback still running
 * (settings: "Weiterspielen beim Verlassen des Players"). A tap opens the player page again, the stop button stops.
 */
@Component({
  selector: 'mupi-now-playing',
  templateUrl: './now-playing.component.html',
  styleUrls: ['./now-playing.component.scss'],
  imports: [IonIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NowPlayingComponent {
  private readonly background = inject(BackgroundPlaybackService)
  private readonly router = inject(Router)
  protected readonly texts = inject(DisplayTextsService)
  protected readonly stopping = signal(false)

  // On the pages where one gets to after leaving the player (start page, the lists, continue listening) - not on the
  // player page itself, nor on the settings pages
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  )
  protected readonly visible = computed(
    () => this.background.media() !== null && SHOWN_ON.has(this.url().split(/[?#]/)[0].replace(/\/$/, '') || '/'),
  )

  /** The track that plays now, else the album or station the page was started with. */
  protected readonly title = computed(() => {
    const now = this.background.now()
    const media = this.background.media()
    return now?.currentTrackname || now?.album || media?.title || media?.artist || ''
  })
  protected readonly subtitle = computed(() => {
    const media = this.background.media()
    const title = this.title()
    const album = this.background.now()?.album || media?.title || ''
    return album && album !== title ? album : (media?.artist ?? '')
  })

  constructor() {
    addIcons({ musicalNotes, stop })
  }

  /** Back to the player page: it was left running, so it must not start the media again. */
  protected open(): void {
    const media = this.background.media()
    if (!media) return
    void this.router.navigate(['/player'], { state: { media, externalPlayback: true } })
  }

  protected async stopPlayback(event: Event): Promise<void> {
    event.stopPropagation()
    if (this.stopping()) return
    this.stopping.set(true)
    try {
      await this.background.stop()
    } finally {
      this.stopping.set(false)
    }
  }
}
