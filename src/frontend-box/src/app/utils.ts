import type { Media } from './media'

export type ExtraDataMedia = Pick<
  Media,
  'artistcover' | 'shuffle' | 'aPartOfAll' | 'aPartOfAllMin' | 'aPartOfAllMax' | 'sorting' | 'lastPlayedAt'
>

/**
 * Phase-X cover-cache localizer. If {@link url} is a Spotify CDN image URL
 * (https://i.scdn.co/image/<id>), rewrite it to /api/spotify/cover/<id> so
 * the backend serves the bytes from its SD+RAM cache after the first miss.
 * All other URLs (local /cover/* paths, RSS-feed image URLs, the no-cover
 * fallback asset) pass through unchanged. An empty/undefined input returns
 * the no-cover asset.
 */
const NO_COVER_FALLBACK = '../assets/images/nocover_mupi.png'
const SPOTIFY_CDN_RE = /^https:\/\/i\.scdn\.co\/image\/([A-Za-z0-9]+)$/

export function localizeCoverUrl(url: string | undefined | null): string {
  if (!url) return NO_COVER_FALLBACK
  const match = url.match(SPOTIFY_CDN_RE)
  return match ? `/api/spotify/cover/${match[1]}` : url
}

export namespace Utils {
  /**
   * Copies the properties of {@link ExtraDataMedia} from {@link source} to {@link target}.
   *
   * @param source - The source of the properties that will be copied.
   * @param target - The target to which the values of the properties will be copied.
   */
  export const copyExtraMediaData = (source: ExtraDataMedia, target: Media): void => {
    // lastPlayedAt MUST be in this list: media.service.updateMedia replaces
    // every resume entry with a Spotify/RSS-derived Media. If lastPlayedAt
    // doesn't survive the round-trip, fetchActiveResumeData's DESC sort
    // sees only zeros and the resume page falls back to mergeMap-completion
    // order — which makes the most-recently-played item appear at a random
    // position (typically the right end of the swiper).
    const keys: (keyof ExtraDataMedia)[] = [
      'artistcover',
      'shuffle',
      'aPartOfAll',
      'aPartOfAllMin',
      'aPartOfAllMax',
      'sorting',
      'lastPlayedAt',
    ]
    for (const key of keys) {
      if (source[key] != null) {
        // biome-ignore lint/suspicious/noExplicitAny: copying typed-key values between Media subsets — narrow union is verbose without runtime benefit
        ;(target as any)[key] = source[key]
      }
    }
  }
}
