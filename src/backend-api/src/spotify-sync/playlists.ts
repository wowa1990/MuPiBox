// Phase 14b — playlist discovery + track resolution.
//
// Two responsibilities:
//   1. discoverPlaylists() — pull /me/playlists, filter to the configured
//      LeniBox-prefix (Q5 decision), parse description for override tags
//      (Q1=C episode-only, §6.3.1 category override).
//   2. resolveSyncItems() — fetch tracks for each discovered playlist,
//      group by album/show identifier per spec §6.2, with album-promotion
//      default (Q1=C base) and episode-only opt-out, plus compilation
//      handling (Various-Artists albums grouped by track artist instead
//      of album artist).
//
// Both functions take an access token + a thin HTTP client; they don't
// touch the token store or the file system. State machine wires the
// auth refresh in around them.

import {
  parseDescriptionOverrides,
  playlistMatchesPrefix,
  resolveItemCategoryFromAlbumType,
  resolvePlaylistCategory,
} from './categorizer'
import type { CategoryType } from './category-types'
import type { DiscoveredPlaylist, SpotifySyncConfig, SyncItem } from './types'

const API_BASE = 'https://api.spotify.com/v1'
const HTTP_TIMEOUT_MS = 10_000
const TRACKS_PAGE_LIMIT = 100
const PLAYLISTS_PAGE_LIMIT = 50

/** What a 401 / 429 / 5xx / network failure should look like to callers. */
export type SpotifyApiError =
  | { kind: 'auth'; reason: string }
  | { kind: 'rate-limit'; reason: string; retryAfterSeconds: number }
  | { kind: 'network'; reason: string }
  | { kind: 'internal'; reason: string }

export class SpotifyApiException extends Error {
  constructor(public readonly detail: SpotifyApiError) {
    super(detail.reason)
  }
}

/** GET helper with 401/429/timeout handling. Throws SpotifyApiException. */
async function spotifyGet<T>(path: string, accessToken: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
  } catch (err) {
    const e = err as Error
    throw new SpotifyApiException({ kind: 'network', reason: `${path}: ${e?.message ?? String(err)}` })
  }
  if (response.status === 401) {
    throw new SpotifyApiException({ kind: 'auth', reason: `401 from ${path}` })
  }
  if (response.status === 429) {
    const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '60', 10)
    throw new SpotifyApiException({
      kind: 'rate-limit',
      reason: `429 from ${path}`,
      retryAfterSeconds: retryAfter,
    })
  }
  if (!response.ok) {
    throw new SpotifyApiException({
      kind: 'internal',
      reason: `${response.status} ${response.statusText} from ${path}`,
    })
  }
  try {
    return (await response.json()) as T
  } catch (err) {
    throw new SpotifyApiException({
      kind: 'internal',
      reason: `JSON parse failure from ${path}: ${(err as Error).message}`,
    })
  }
}

/** Discover all sync-managed playlists for the active user. */
export async function discoverPlaylists(accessToken: string, config: SpotifySyncConfig): Promise<DiscoveredPlaylist[]> {
  if (config.playlist_explicit_ids.length > 0) {
    // Mode A: explicit IDs. Skip /me/playlists scan.
    const out: DiscoveredPlaylist[] = []
    for (const id of config.playlist_explicit_ids) {
      try {
        const p = await spotifyGet<{ id: string; name: string; description?: string; tracks?: { total?: number } }>(
          `/playlists/${id}?fields=id,name,description,tracks(total)`,
          accessToken,
        )
        out.push(buildDiscoveredPlaylist(p))
      } catch (err) {
        if (err instanceof SpotifyApiException && err.detail.kind === 'auth') throw err
        // Skip individually-failing playlists; sync over what we got.
        console.warn(`${new Date().toLocaleString()}: [spotify-sync] discover: explicit playlist ${id} failed: ${(err as Error).message}`)
      }
    }
    return out
  }
  // Mode B: prefix match.
  const matched: DiscoveredPlaylist[] = []
  let offset = 0
  let next = true
  const prefix = config.playlist_prefix.trim()
  if (prefix.length < 2) {
    console.warn(`${new Date().toLocaleString()}: [spotify-sync] discover: playlist_prefix too short ("${prefix}"), skipping`)
    return []
  }
  while (next) {
    const page = await spotifyGet<{
      items: Array<{ id: string; name: string; description?: string; tracks?: { total?: number } }>
      next: string | null
    }>(`/me/playlists?limit=${PLAYLISTS_PAGE_LIMIT}&offset=${offset}`, accessToken)
    for (const item of page.items ?? []) {
      if (playlistMatchesPrefix(item.name, prefix)) {
        matched.push(buildDiscoveredPlaylist(item))
      }
    }
    next = page.next !== null && (page.items?.length ?? 0) === PLAYLISTS_PAGE_LIMIT
    offset += PLAYLISTS_PAGE_LIMIT
    // Safety net against runaway pagination — Spotify caps at ~50 user
    // playlists per offset and ~~thousand total; 50 pages = 2500 items.
    if (offset > 50 * PLAYLISTS_PAGE_LIMIT) break
  }
  return matched
}

function buildDiscoveredPlaylist(p: {
  id: string
  name: string
  description?: string
  tracks?: { total?: number }
}): DiscoveredPlaylist {
  const overrides = parseDescriptionOverrides(p.description)
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    categoryOverride: overrides.categoryOverride,
    episodeOnly: overrides.episodeOnly,
    trackCount: p.tracks?.total ?? 0,
  }
}

/** Spotify-API track shape that we actually look at. Other fields ignored. */
interface SpotifyTrackResponse {
  id?: string | null
  uri?: string
  type?: 'track' | 'episode'
  name?: string
  artists?: Array<{ id?: string; name?: string }>
  album?: {
    id?: string
    name?: string
    album_type?: 'album' | 'single' | 'compilation' | 'audiobook' | string
    images?: Array<{ url?: string }>
    artists?: Array<{ id?: string; name?: string }>
  }
  show?: {
    id?: string
    name?: string
    publisher?: string
    images?: Array<{ url?: string }>
  }
}

/** All tracks for one playlist, paginated. */
async function fetchPlaylistTracks(playlistId: string, accessToken: string): Promise<SpotifyTrackResponse[]> {
  const out: SpotifyTrackResponse[] = []
  // The fields= projection keeps the response small — Spotify enforces a
  // depth limit, but the shape below is well within it. `null` track
  // entries occur for removed/unavailable items; skip them in the caller.
  const fields =
    'items(track(id,uri,type,name,artists(id,name),album(id,name,album_type,images,artists(id,name)),show(id,name,publisher,images))),next'
  let offset = 0
  while (true) {
    const page = await spotifyGet<{ items: Array<{ track: SpotifyTrackResponse | null }>; next: string | null }>(
      `/playlists/${playlistId}/tracks?fields=${encodeURIComponent(fields)}&limit=${TRACKS_PAGE_LIMIT}&offset=${offset}`,
      accessToken,
    )
    for (const i of page.items ?? []) {
      if (i.track) out.push(i.track)
    }
    if (!page.next || (page.items?.length ?? 0) < TRACKS_PAGE_LIMIT) break
    offset += TRACKS_PAGE_LIMIT
    if (offset > 50 * TRACKS_PAGE_LIMIT) break
  }
  return out
}

/**
 * Walk over discovered playlists, fetch tracks for each, build SyncItems
 * with album-promotion / episode-only / compilation handling. Result is
 * de-duplicated by group_key so the same album referenced from two
 * playlists ends up as one item with both playlist IDs in its references.
 *
 * Statistics for the state file (per-playlist track counts) come back
 * alongside.
 */
export async function resolveSyncItems(
  playlists: DiscoveredPlaylist[],
  accessToken: string,
  config: SpotifySyncConfig,
): Promise<{ items: Map<string, SyncItem>; perPlaylistCounts: Map<string, number> }> {
  const items = new Map<string, SyncItem>()
  const perPlaylistCounts = new Map<string, number>()

  for (const playlist of playlists) {
    const tracks = await fetchPlaylistTracks(playlist.id, accessToken)
    perPlaylistCounts.set(playlist.id, tracks.length)
    for (const track of tracks) {
      const resolved = resolveSingleTrack(track, playlist, config)
      if (!resolved) continue
      const existing = items.get(resolved.groupKey)
      if (existing) {
        if (!existing.playlistIds.includes(playlist.id)) existing.playlistIds.push(playlist.id)
      } else {
        items.set(resolved.groupKey, resolved)
      }
    }
  }

  return { items, perPlaylistCounts }
}

/**
 * Per-track resolution to a SyncItem. Returns undefined when the track
 * is unusable (no IDs, episode without show, etc.) — caller skips silently.
 *
 * Group-key strategy:
 *   - track.type === 'episode' OR album.album_type === 'audiobook':
 *       audiobook-mode. Group by show.id (when episode) or album.id
 *       (when audiobook). With episode-only override on the playlist,
 *       the per-episode track.id wins.
 *   - album.album_type === 'compilation' AND first album artist is
 *       'Various Artists': compilation-mode. Group key = `${trackArtistId}:${albumId}`.
 *       Forces each contributing artist to a separate library entry.
 *   - default: album-promotion. Group by album.id, regardless of which
 *       tracks of the album are in the playlist.
 */
function resolveSingleTrack(
  track: SpotifyTrackResponse,
  playlist: DiscoveredPlaylist,
  config: SpotifySyncConfig,
): SyncItem | undefined {
  const trackId = track.id ?? undefined
  const isEpisode = track.type === 'episode'
  const albumType = track.album?.album_type
  const isAudiobook = albumType === 'audiobook'
  const isCompilation = albumType === 'compilation' && /^various artists$/i.test(track.album?.artists?.[0]?.name ?? '')

  // Resolve category — playlist-description override wins over playlist-name
  // suffix wins over album-type heuristic wins over default.
  const categoryFromPlaylist = playlist.categoryOverride
    ? playlist.categoryOverride
    : resolvePlaylistCategory(playlist.name, config.playlist_prefix, config.category_mapping)
  const categoryFromAlbum = resolveItemCategoryFromAlbumType(albumType, track.type)
  const category: CategoryType = playlist.categoryOverride
    ? playlist.categoryOverride
    : (categoryFromAlbum ?? categoryFromPlaylist)

  // Episode-only mode: each track in the playlist becomes its own
  // library entry, keyed by track.id, with type 'audiobook' category.
  if (playlist.episodeOnly) {
    if (!trackId) return undefined
    return {
      groupKey: `episode:${trackId}`,
      mode: 'episode-only',
      identifierField: 'id',
      type: 'spotify',
      category: 'audiobook',
      title: track.name ?? track.show?.name ?? '',
      artist: track.show?.name ?? track.artists?.[0]?.name ?? '',
      artistId: undefined,
      cover: pickImage(track.show?.images ?? track.album?.images),
      artistCover: undefined,
      playlistIds: [playlist.id],
    }
  }

  if (isEpisode && track.show?.id) {
    // Whole-show grouping (Q1=C default).
    return {
      groupKey: `show:${track.show.id}`,
      mode: 'album',
      identifierField: 'showid',
      type: 'spotify',
      category: 'audiobook',
      title: track.show.name ?? '',
      artist: track.show.publisher ?? '',
      artistId: undefined,
      cover: pickImage(track.show.images),
      artistCover: undefined,
      playlistIds: [playlist.id],
    }
  }

  if (isAudiobook && track.album?.id) {
    return {
      groupKey: `audiobook:${track.album.id}`,
      mode: 'album',
      identifierField: 'audiobookid',
      type: 'spotify',
      category: 'audiobook',
      title: track.album.name ?? '',
      artist: track.album.artists?.[0]?.name ?? '',
      artistId: track.album.artists?.[0]?.id,
      cover: pickImage(track.album.images),
      artistCover: undefined,
      playlistIds: [playlist.id],
    }
  }

  if (isCompilation && track.album?.id) {
    const trackArtist = track.artists?.[0]
    if (!trackArtist?.id) return undefined
    return {
      groupKey: `compilation:${trackArtist.id}:${track.album.id}`,
      mode: 'album',
      identifierField: 'id',
      type: 'spotify',
      category,
      title: track.album.name ?? '',
      artist: trackArtist.name ?? '',
      artistId: trackArtist.id,
      cover: pickImage(track.album.images),
      artistCover: undefined,
      playlistIds: [playlist.id],
    }
  }

  // Default: album promotion — entire album becomes one library entry.
  if (track.album?.id) {
    return {
      groupKey: `album:${track.album.id}`,
      mode: 'album',
      identifierField: 'id',
      type: 'spotify',
      category,
      title: track.album.name ?? '',
      artist: track.album.artists?.[0]?.name ?? track.artists?.[0]?.name ?? '',
      artistId: track.album.artists?.[0]?.id ?? track.artists?.[0]?.id,
      cover: pickImage(track.album.images),
      artistCover: undefined,
      playlistIds: [playlist.id],
    }
  }

  return undefined
}

/** Pick a cover image URL — Spotify orders images by size desc; we want
 *  the second-largest (640×640 typical) for a balance of quality and
 *  bandwidth. Falls back to the first available. */
function pickImage(images: Array<{ url?: string }> | undefined): string | undefined {
  if (!images || images.length === 0) return undefined
  // Spotify-API contract: images sorted largest-first. images[1] is the
  // medium size; if there's only one, use it.
  return images[1]?.url ?? images[0]?.url
}
