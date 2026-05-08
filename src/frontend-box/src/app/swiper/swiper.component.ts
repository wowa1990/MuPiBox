import { AsyncPipe } from '@angular/common'
import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  computed,
  ElementRef,
  effect,
  input,
  output,
  Signal,
  signal,
  viewChild,
  WritableSignal,
} from '@angular/core'
import { IonCard, IonCardHeader, IonCardTitle, IonCol, IonGrid, IonRow } from '@ionic/angular/standalone'
import { Observable } from 'rxjs'
import Swiper from 'swiper'
import { PlayerService } from '../player.service'

export interface SwiperData<T> {
  name: string
  imgSrc: Observable<string>
  data: T
}

@Component({
  selector: 'mupi-swiper',
  templateUrl: './swiper.component.html',
  styleUrls: ['./swiper.component.scss'],
  imports: [AsyncPipe, IonCard, IonCardHeader, IonCardTitle, IonCol, IonGrid, IonRow],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SwiperComponent<T> {
  public data = input.required<SwiperData<T>[]>()
  public roundImages = input<boolean>(false)
  public elementClicked = output<SwiperData<T>>()

  protected swiperContainer = viewChild<ElementRef>('swiper')
  protected swiper: Signal<Swiper> = computed(() => this.swiperContainer()?.nativeElement.swiper)
  protected pageIsShown: WritableSignal<boolean> = signal(false)
  // Progressive-render cap. Starts small enough to paint immediately even
  // on the RPi-Chromium kiosk (~15 slides cover the visible viewport plus
  // a swipe-buffer), then expands in two phases: a fixed timeout to fill
  // a comfortable swipe range, then idle-callback-driven chunks so the
  // remainder doesn't fight with user touch input. Reset on every page-
  // entry so subsequent visits also get the fast first paint.
  private renderableLimit: WritableSignal<number> = signal(15)
  private static readonly RENDER_STAGE_2 = 60
  private static readonly RENDER_STAGE_2_DELAY_MS = 120
  private static readonly RENDER_IDLE_CHUNK = 30

  // This is a hacky workaround for the problem that the swiper doesn't allow to scroll
  // after an ionic navigation event if the data is not updated. Thus, we copy the given
  // data here internally to fake updated data.
  // This might be removed when we have a generic API cache so we can just get new results
  // on every ionic navigation.
  protected shownData: Signal<SwiperData<T>[]>

  // Since we reset the swiper container when the page is entered / left, we need to
  // manually cache / restore the swiper position.
  private cachedSwiperPosition = 0

  public constructor(private playerService: PlayerService) {
    this.shownData = computed(() => {
      if (!this.pageIsShown()) return []
      // Progressive render for very long lists (276 albums for a prolific
      // artist like Benjamin Blümchen). Rendering all slides at once meant
      // ~1400 DOM nodes (276 × ion-card/grid/row/col/img) plus 276
      // simultaneous Spotify-CDN image fetches — Chromium needed several
      // seconds before the first paint. Cap the initial render at a
      // viewport-sized slice; the effect below incrementally grows it
      // until the full list is in the DOM. structuredClone is 5-10×
      // faster than lodash.cloneDeep on plain-object arrays; Observables
      // on SwiperData.imgSrc aren't cloneable so keep them by reference.
      const src = this.data()
      const limit = Math.min(this.renderableLimit(), src.length)
      const cloned = src
        .slice(0, limit)
        .map((d) => ({ name: d.name, imgSrc: d.imgSrc, data: structuredClone(d.data) }))
      return cloned
    })

    effect(() => {
      if (this.pageIsShown()) {
        // LOW-8: cachedSwiperPosition is captured on ionViewWillLeave, but
        // when the user comes back the data set may be smaller (e.g. they
        // edited the audiobook list and removed entries while the page was
        // hidden). slideTo(cached) on an out-of-range index either no-ops
        // silently or produces a blank tile area. Clamp to the visible
        // length so we land on the last valid slide instead.
        const len = this.shownData().length
        if (len > 0) {
          this.swiper()?.slideTo(Math.min(this.cachedSwiperPosition, len - 1), 0)
        }
      }
    })
  }

  public ionViewDidEnter(): void {
    this.pageIsShown.set(true)
    // Stage 1 (synchronous): immediately paint a viewport-sized slice.
    this.renderableLimit.set(15)
    // Stage 2 (timed): comfortable swipe range without user friction.
    setTimeout(() => this.renderableLimit.set(SwiperComponent.RENDER_STAGE_2), SwiperComponent.RENDER_STAGE_2_DELAY_MS)
    // Stage 3 (idle-driven): expand the rest in 30-slide chunks, but
    // only when the browser tells us the main thread is free. If the
    // user is touching/scrolling, idle callbacks deferr — touch input
    // wins the priority race. Previous version did Stage 3 on a fixed
    // 350ms timer and 200+ DOM nodes landed exactly when the user
    // started swiping, freezing the UI for 2-3s.
    this.scheduleIdleExpansion()
  }

  private scheduleIdleExpansion(): void {
    const grow = () => {
      const cur = this.renderableLimit()
      const target = this.data()?.length ?? 0
      if (cur >= target) return
      this.renderableLimit.set(Math.min(cur + SwiperComponent.RENDER_IDLE_CHUNK, target))
      this.scheduleIdleExpansion()
    }
    // Fallback for older Chromium if requestIdleCallback isn't available.
    if (typeof (globalThis as any).requestIdleCallback === 'function') {
      ;(globalThis as any).requestIdleCallback(grow, { timeout: 2000 })
    } else {
      setTimeout(grow, 200)
    }
  }

  public ionViewWillLeave(): void {
    this.cachedSwiperPosition = this.swiper()?.activeIndex ?? 0
    this.pageIsShown.set(false)
  }

  public resetSwiperPosition(): void {
    this.swiper()?.slideTo(0, 0)
    this.cachedSwiperPosition = 0
  }

  protected readText(text: string): void {
    this.playerService.sayText(text)
  }
}
