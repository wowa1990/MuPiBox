// The photo display in the app (5.1): Einstellungen › Fotos. Switching on (off by default) installs heif-convert in
// the background (iPhone photos, HEIC), "Videos anzeigen" ffmpeg (mupibox/photos_setup.sh) - a box that never shows
// photos gets nothing of it. Albums, upload, NAS and Immich follow in their own files (see docs/fotoanzeige-5.1.md).

import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import type { Router } from 'express'
import type { MupiboxConfig } from '../../models/mupibox-config.model'
import { requireCsrf, requireSession } from '../middleware'
import { registerPhotoAlbumRoutes } from './albums'
import { type PhotoImmichDeps, registerPhotoImmichRoutes } from './immich'
import { type PhotoNasAccess, registerPhotoNasRoutes } from './nas'
import { registerPhotoIcloudRoutes } from './icloud'
import { registerPhotoNextcloudRoutes } from './nextcloud'
import { registerPhotoPhotoprismRoutes } from './photoprism'
import { registerPhotoSynologyRoutes } from './synology'
import { setPhotoInstallWait } from './process'
import { videoQueue } from './video'
import { applyPhotoSettings, applyPhotoTimeAction, photoSettings } from './settings'

export interface PhotoDeps {
  getMupiboxConfig: () => MupiboxConfig | undefined
  updateMupiboxConfig: (mutate: (cfg: Record<string, unknown>) => void) => Promise<void>
  /** the server's NAS access, for the photos of NAS folders (see nas.ts) */
  nas?: PhotoNasAccess
  /** the box's way to keep a secret (the Immich key - see immich.ts) */
  secret?: PhotoImmichDeps['secret']
}

const SETUP = '/usr/local/bin/mupibox/photos_setup.sh'
type Tool = 'heif' | 'video'
const TOOL_FILE: Record<Tool, string> = { heif: '/usr/bin/heif-convert', video: '/usr/bin/ffmpeg' }

// a program being installed (apt: a minute or more); one at a time, the script itself waits for the apt lock too
const job: { running: Tool | null; failed: Tool[] } = { running: null, failed: [] }
const queue: Tool[] = []

// the pictures wait while a program is being installed (see process.ts): told when the last one is done
let idleWaiters: (() => void)[] = []
setPhotoInstallWait(() => (job.running || queue.length ? new Promise<void>((resolve) => idleWaiters.push(resolve)) : Promise.resolve()))
function wakeIdleWaiters(): void {
  if (job.running || queue.length) return
  const waiting = idleWaiters
  idleWaiters = []
  for (const resolve of waiting) resolve()
}

function installed(tool: Tool): boolean {
  return existsSync(TOOL_FILE[tool])
}

function install(tool: Tool): void {
  if (installed(tool) || job.running === tool || queue.includes(tool)) return
  queue.push(tool)
  next()
}

function next(): void {
  if (job.running) return
  const tool = queue.shift()
  if (!tool) return
  job.running = tool
  job.failed = job.failed.filter((t) => t !== tool)
  const child = spawn('sudo', ['bash', SETUP, tool], { stdio: 'ignore' })
  const done = (ok: boolean) => {
    if (!ok || !installed(tool)) job.failed.push(tool)
    // (ffmpeg there now: the clips that waited for it are made)
    else if (tool === 'video') void videoQueue.kick()
    job.running = null
    next()
    wakeIdleWaiters()
  }
  child.on('error', () => done(false))
  child.on('exit', (code) => done(code === 0))
}

function state(cfg: MupiboxConfig | undefined) {
  return {
    settings: photoSettings(cfg),
    tools: {
      heif: { installed: installed('heif'), installing: job.running === 'heif' || queue.includes('heif'), failed: job.failed.includes('heif') },
      video: { installed: installed('video'), installing: job.running === 'video' || queue.includes('video'), failed: job.failed.includes('video') },
    },
  }
}

/** What the switches need: on, and videos on - the programs for them (again after a failed try or an update). */
function installWhatIsNeeded(cfg: MupiboxConfig | undefined): void {
  const s = photoSettings(cfg)
  if (!s.enabled) return
  install('heif')
  if (s.showVideos) install('video')
}

export function registerPhotoRoutes(router: Router, deps: PhotoDeps): void {
  // (Bibliothek › Fotos: overview, albums, upload - see albums.ts)
  registerPhotoAlbumRoutes(router, { getMupiboxConfig: deps.getMupiboxConfig })
  // (Bibliothek › Fotos › NAS-Ordner - see nas.ts)
  registerPhotoNasRoutes(router, deps)
  // (Bibliothek › Fotos › Immich - see immich.ts)
  registerPhotoImmichRoutes(router, deps)
  // (Bibliothek › Fotos › Synology Photos: the NAS's account at DSM - see synology.ts)
  registerPhotoSynologyRoutes(router, deps)
  // (Bibliothek › Fotos › Nextcloud: the albums of its Photos app - see nextcloud.ts)
  registerPhotoNextcloudRoutes(router, deps)
  // (Bibliothek › Fotos › iCloud: shared albums by their public link - see icloud.ts)
  registerPhotoIcloudRoutes(router, deps)
  // (Bibliothek › Fotos › PhotoPrism: its albums, by an app password - see photoprism.ts)
  registerPhotoPhotoprismRoutes(router, deps)

  /** GET /api/app/photos/settings - the settings (with their defaults) and the programs' state */
  router.get('/photos/settings', requireSession, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json(state(deps.getMupiboxConfig()))
  })

  /**
   * POST /api/app/photos/settings {enabled?, startAsSlideshow?, slideshowSeconds?, order?, showVideos?, screensaver?}
   * Saved at once; switching on (or videos on) starts installing what that needs.
   */
  router.post('/photos/settings', requireSession, requireCsrf, async (req, res) => {
    let error: string | null = null
    try {
      await deps.updateMupiboxConfig((cfg) => {
        const photos = { ...((cfg.photos as Record<string, unknown> | undefined) ?? {}) }
        error = applyPhotoSettings(photos, req.body)
        if (!error) cfg.photos = photos
      })
    } catch {
      return void res.status(500).json({ error: 'config_not_saved' })
    }
    if (error) return void res.status(400).json({ error })
    const cfg = deps.getMupiboxConfig()
    installWhatIsNeeded(cfg)
    res.json(state(cfg))
  })

  /**
   * POST /api/app/photos/time {action: extend|free|reset, minutes?} - today's photo time (Spielzeit › Bildzeit): the
   * player takes it within a second; the answer is the settings again
   */
  router.post('/photos/time', requireSession, requireCsrf, async (req, res) => {
    let error: string | null = null
    try {
      await deps.updateMupiboxConfig((cfg) => {
        error = applyPhotoTimeAction(cfg as Record<string, unknown>, req.body?.action, req.body?.minutes)
      })
    } catch {
      return void res.status(500).json({ error: 'config_not_saved' })
    }
    if (error) return void res.status(400).json({ error })
    res.json({ ok: true })
  })

  /** POST /api/app/photos/install - try again (a program could not be installed: no internet then) */
  router.post('/photos/install', requireSession, requireCsrf, (_req, res) => {
    job.failed = []
    installWhatIsNeeded(deps.getMupiboxConfig())
    res.json(state(deps.getMupiboxConfig()))
  })
}
