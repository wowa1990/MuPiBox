// The photo display's albums and pictures (5.1): one list in data/photos/library.json (data/: kept by every update,
// part of the backup), the pictures of an uploaded album in data/photos/upload/<album>/ in their three sizes (see
// process.ts). The list is read once and kept; every change goes through update() - one after the other, written
// next to it and renamed (never half a list on the card).

import { randomBytes } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { CACHE_DIR, DATA_DIR } from '../../paths'

export const PHOTOS_DIR = path.join(DATA_DIR, 'photos')
const LIBRARY_FILE = path.join(PHOTOS_DIR, 'library.json')
export const UPLOAD_DIR = path.join(PHOTOS_DIR, 'upload')
export const INCOMING_DIR = path.join(PHOTOS_DIR, 'incoming')
/** The pictures of NAS folders, in their sizes: fetched again when gone (cache/ - may be emptied any time) */
export const NAS_PHOTO_DIR = path.join(CACHE_DIR, 'photos', 'nas')
/** The pictures of Immich albums kept on the box (Fotos auf der Box speichern), the same way */
export const IMMICH_PHOTO_DIR = path.join(CACHE_DIR, 'photos', 'immich')
/** Immich shown live: the pictures shown last (a small cache with a limit) */
export const IMMICH_LIVE_DIR = path.join(CACHE_DIR, 'photos', 'immich-live')
/** The faces of the people whose albums come from Immich ("<person id>.jpg"), for the display's stacks */
export const IMMICH_FACE_DIR = path.join(CACHE_DIR, 'photos', 'immich-faces')
/** The same for the albums of Synology Photos */
export const SYNOLOGY_PHOTO_DIR = path.join(CACHE_DIR, 'photos', 'synology')
export const SYNOLOGY_LIVE_DIR = path.join(CACHE_DIR, 'photos', 'synology-live')
/** The same for the albums of Nextcloud */
export const NEXTCLOUD_PHOTO_DIR = path.join(CACHE_DIR, 'photos', 'nextcloud')
export const NEXTCLOUD_LIVE_DIR = path.join(CACHE_DIR, 'photos', 'nextcloud-live')
/** The same for the shared albums of iCloud */
export const ICLOUD_PHOTO_DIR = path.join(CACHE_DIR, 'photos', 'icloud')
export const ICLOUD_LIVE_DIR = path.join(CACHE_DIR, 'photos', 'icloud-live')
/** The same for the albums of PhotoPrism */
export const PHOTOPRISM_PHOTO_DIR = path.join(CACHE_DIR, 'photos', 'photoprism')
export const PHOTOPRISM_LIVE_DIR = path.join(CACHE_DIR, 'photos', 'photoprism-live')

export type PhotoSource = 'upload' | 'nas' | 'immich' | 'synology' | 'nextcloud' | 'icloud' | 'photoprism'
/** the sources whose albums come from a photo service (remote.ts): an id there, kept on the box or shown live */
export const SERVICE_SOURCES: readonly PhotoSource[] = ['immich', 'synology', 'nextcloud', 'icloud', 'photoprism']

export interface PhotoAsset {
  id: string
  w: number
  h: number
  /** when it was taken (EXIF), else null */
  taken: string | null
  /** when it came onto the box (ISO) */
  added: string
  kind: 'photo' | 'video'
  /** a clip: false while it waits to be made (video.ts); its length in seconds */
  ready?: boolean
  duration?: number
  /** a fingerprint of the file as it came (sha1): the same picture twice in an album is left out */
  sum?: string
  /** a NAS album's picture: its file on the NAS, and the file's version there (ETag / date / size); an Immich
   * album's: the asset's id there and its checksum */
  ref?: string
  ver?: string
}

export interface PhotoAlbum {
  id: string
  title: string
  source: PhotoSource
  /** shown on the display (the switch "am Display zeigen") */
  display: boolean
  /** the place on the display (and in the app's list), 0 first */
  position: number
  /** the album's own picture (an asset id); else the first */
  cover?: string
  created: string
  assets: PhotoAsset[]
  /** a NAS album: its folder on the NAS; an Immich album: its id there */
  ref?: string
  /** an Immich album shown live: its pictures are not kept on the box, they come from Immich when shown */
  live?: boolean
  /** an album of people (Immich): their ids there, whose faces the display shows on the stack */
  faces?: string[]
}

interface Library {
  version: 1
  albums: PhotoAlbum[]
  /** clips of NAS and Immich the box would not take ("<source>:<ref>|<version>": longer than 3 minutes, no clip) - not
   * fetched again while unchanged, also when their album has gone meanwhile */
  rejected?: string[]
}

let cache: Library | null = null
let chain: Promise<unknown> = Promise.resolve()

const ID = /^[a-f0-9]{10}$/
export const isId = (v: unknown): v is string => typeof v === 'string' && ID.test(v)
export const newId = (): string => randomBytes(5).toString('hex')

async function load(): Promise<Library> {
  if (cache) return cache
  try {
    const raw = JSON.parse(await fsp.readFile(LIBRARY_FILE, 'utf8')) as Partial<Library>
    const albums = Array.isArray(raw.albums) ? raw.albums.filter((a) => a && isId(a.id) && Array.isArray(a.assets)) : []
    const rejected = Array.isArray(raw.rejected) ? raw.rejected.filter((x): x is string => typeof x === 'string').slice(-1000) : []
    cache = { version: 1, albums, rejected }
  } catch (err) {
    // (no list yet: none; a broken one is kept beside it for a look - the pictures stay where they are)
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      await fsp.rename(LIBRARY_FILE, `${LIBRARY_FILE}.broken-${Date.now()}`).catch(() => undefined)
    }
    cache = { version: 1, albums: [] }
  }
  return cache
}

/** The albums as the box knows them (sorted by their place). Do not change what comes back - use update(). */
export async function albums(): Promise<PhotoAlbum[]> {
  const lib = await load()
  return [...lib.albums].sort((a, b) => a.position - b.position)
}

export async function album(id: string): Promise<PhotoAlbum | undefined> {
  return (await load()).albums.find((a) => a.id === id)
}

// a backup being restored: no change of the list any more (a sync or a clip finishing would write the list of before
// over the restored one) - the box restarts after it; a failed restore lets go again
let frozen = false
export async function freezeLibrary(): Promise<void> {
  frozen = true
  await chain.catch(() => undefined)
}
export function thawLibrary(): void {
  frozen = false
  cache = null
}

/** A change of the list, one after the other; `mutate` gets a copy and returns what the caller wants back. */
export function update<T>(mutate: (lib: Library) => T): Promise<T> {
  if (frozen) return Promise.reject(new Error('photo library frozen (a backup is being restored)'))
  const run = chain.then(async () => {
    if (frozen) throw new Error('photo library frozen (a backup is being restored)')
    const current = await load()
    const copy = JSON.parse(JSON.stringify(current)) as Library
    const result = mutate(copy)
    // (the places again 0, 1, 2 … in their order: a deleted album leaves no gap)
    copy.albums.sort((a, b) => a.position - b.position).forEach((a, i) => (a.position = i))
    await fsp.mkdir(PHOTOS_DIR, { recursive: true })
    const tmp = `${LIBRARY_FILE}.${process.pid}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(copy))
    await fsp.rename(tmp, LIBRARY_FILE)
    cache = copy
    return result
  })
  chain = run.catch(() => undefined)
  return run
}

const SOURCE_DIR: Record<PhotoSource, string> = { upload: UPLOAD_DIR, nas: NAS_PHOTO_DIR, immich: IMMICH_PHOTO_DIR, synology: SYNOLOGY_PHOTO_DIR, nextcloud: NEXTCLOUD_PHOTO_DIR, icloud: ICLOUD_PHOTO_DIR, photoprism: PHOTOPRISM_PHOTO_DIR }
export const albumDir = (a: Pick<PhotoAlbum, 'id'> & { source?: PhotoSource }): string => path.join(SOURCE_DIR[a.source ?? 'upload'] ?? UPLOAD_DIR, a.id)
/** The path of an asset's files without their size suffix (see process.ts) */
export const assetBase = (a: Pick<PhotoAlbum, 'id'> & { source?: PhotoSource }, assetId: string): string => path.join(albumDir(a), assetId)

/** The album's picture: its own, else the first one */
export const coverOf = (a: PhotoAlbum): string | undefined =>
  a.cover && a.assets.some((x) => x.id === a.cover) ? a.cover : (a.assets.find((x) => x.ready !== false) ?? a.assets[0])?.id

/** Bytes taken by the pictures (data/photos, or another folder - the NAS pictures' cache), counted on the card */
export async function photoBytes(dir = PHOTOS_DIR): Promise<number> {
  let total = 0
  const walk = async (dir: string): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) total += (await fsp.stat(p).catch(() => ({ size: 0 }))).size
    }
  }
  await walk(dir)
  return total
}

/**
 * What an upload left behind when the box went off in the middle (once at the server's start, before an upload is
 * taken): the originals on their way in (incoming/ - they may still carry the place where a photo was taken) and the
 * half-made sizes of a picture (*.tmp, *.heic.jpg). Pictures that are made are never touched here - a list that could
 * not be read must not cost a single photo.
 */
export async function sweepLeftovers(): Promise<void> {
  await fsp.rm(INCOMING_DIR, { recursive: true, force: true }).catch(() => undefined)
  for (const f of await fsp.readdir(PHOTOS_DIR).catch(() => [] as string[])) {
    if (/^library\.json\.\d+\.tmp$/.test(f)) await fsp.rm(path.join(PHOTOS_DIR, f), { force: true }).catch(() => undefined)
  }
  for (const root of [UPLOAD_DIR, NAS_PHOTO_DIR, IMMICH_PHOTO_DIR]) {
    let dirs: import('node:fs').Dirent[]
    try {
      dirs = await fsp.readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const d of dirs) {
      if (!d.isDirectory() || !isId(d.name)) continue
      const dir = path.join(root, d.name)
      const files = await fsp.readdir(dir).catch(() => [] as string[])
      for (const f of files) {
        if (f.endsWith('.tmp') || f.endsWith('.heic.jpg') || f.endsWith('.part')) await fsp.rm(path.join(dir, f), { force: true }).catch(() => undefined)
      }
    }
  }
}

/** Space on the card: all, free (what a user may still write) */
export async function cardSpace(): Promise<{ total: number; free: number } | null> {
  try {
    const st = await fsp.statfs(DATA_DIR)
    return { total: st.blocks * st.bsize, free: st.bavail * st.bsize }
  } catch {
    return null
  }
}

/** For tests: forget the list read before */
export function forgetCache(): void {
  cache = null
}

/** The clips of NAS and Immich not taken before ("<source>:<ref>|<version>") */
export async function rejectedClips(): Promise<Set<string>> {
  return new Set((await load()).rejected ?? [])
}
