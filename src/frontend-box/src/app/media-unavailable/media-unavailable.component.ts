import { ChangeDetectionStrategy, Component } from '@angular/core'

// One picture for a whole list whose content could not be loaded (NAS not reachable, radio stations and
// podcasts without a connection) - instead of a broken tile per station or podcast. It covers the list.
@Component({
  selector: 'mupi-media-unavailable',
  template: '<img src="assets/images/media-unavailable.webp" alt="The media could not be loaded" />',
  styles: [
    `
      :host {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 40; /* below the loading spinner (50) */
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: #0d0d0d;
      }
      img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaUnavailableComponent {}
