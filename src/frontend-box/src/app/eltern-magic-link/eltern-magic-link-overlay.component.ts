import { ChangeDetectionStrategy, Component, inject } from '@angular/core'
import { ElternMagicLinkService } from '../eltern-magic-link.service'

// Phase 15b — full-screen overlay shown after the Cloud+Batterie-Tap
// sequence triggers a magic-link request. Renders a backend-generated
// QR-SVG plus the URL as a text fallback. Auto-closes after 60s.
@Component({
  selector: 'mupi-eltern-magic-link-overlay',
  templateUrl: './eltern-magic-link-overlay.component.html',
  styleUrls: ['./eltern-magic-link-overlay.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
})
export class ElternMagicLinkOverlayComponent {
  protected readonly svc = inject(ElternMagicLinkService)
}
