// System pages of the app: news, support infos, restarting parts of the box, logs, the player's debug log, the
// browser (Chromium) options and the language of the box - what the admin interface's start page, admin.php,
// backend.php and MuPi-Conf did.

import { execFile, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { constants as fsConstants, createWriteStream, writeFileSync, promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Router } from 'express'
import type { MupiboxConfig } from '../models/mupibox-config.model'
import { requireCsrf, requireSession } from './middleware'
import { cleanName } from './upload'

export interface SystemDeps {
  getMupiboxConfig: () => MupiboxConfig | undefined
  updateMupiboxConfig: (mutate: (cfg: Record<string, unknown>) => void) => Promise<void>
}

function run(cmd: string, args: string[], timeoutMs = 30000): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve({ ok: !err, stdout: stdout ?? '' }))
  })
}

// In the background and out of this process' tree: a restart of this very process (pm2 restart server) must not be
// cut off by it
function detached(script: string): void {
  const child = spawn('sh', ['-c', `setsid sh -c '${script.replace(/'/g, `'\\''`)}' >/dev/null 2>&1 < /dev/null &`], { detached: true, stdio: 'ignore' })
  child.on('error', () => undefined)
  child.unref()
}

const PM2 = 'PM2=$(command -v pm2 || echo /usr/local/bin/pm2); "$PM2"'
const PLAYER_CONFIG = '/home/dietpi/.mupibox/spotifycontroller-main/config/config.json'

// The logs and services the admin interface's log viewer offers (backend.php)
const LOGS: Record<string, string> = {
  'server-error': '/home/dietpi/.pm2/logs/server-error.log',
  'server-out': '/home/dietpi/.pm2/logs/server-out.log',
  'spotify-control-error': '/home/dietpi/.pm2/logs/spotify-control-error.log',
  'spotify-control-out': '/home/dietpi/.pm2/logs/spotify-control-out.log',
  shutdown_control: '/tmp/shutdown_control.log',
  idle_shutdown: '/tmp/idle_shutdown.log',
}
const SERVICES = [
  'mupi_autoconnect_bt',
  'mupi_autoconnect-wifi',
  'mupi_check_internet',
  'mupi_check_monitor',
  'mupi_fan',
  'mupi_hat_control',
  'mupi_hat',
  'mupi_idle_shutdown',
  'mupi_mqtt',
  'mupi_novnc',
  'mupi_rotary',
  'mupi_powerled',
  'mupi_splash',
  'mupi_startstop',
  'mupi_telegram',
  'mupi_vnc',
  'mupi_wifi',
  'pm2-dietpi',
  'wpa_supplicant',
  'proftpd',
  'smbd',
]

// Keys whose values never leave the box (support infos): tokens, passwords, ids of accounts and chats
const SECRET = /pass|token|secret|clientid|deviceid|username|chatid|account|hash|salt|fingerprint|psk|api_?key|webhook|e-?mail|ssid|cookie|private|credential/i
function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = SECRET.test(k) ? '(entfernt)' : withoutSecrets(v)
    return out
  }
  return value
}

// What may still stand in free text (logs, command output, the library) is cleaned by pattern: MAC addresses, bearer
// tokens, "password=…"-like pairs and the user:password part of an address
function scrub(text: string): string {
  return text
    .replace(/\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi, 'xx:xx:xx:xx:xx:xx')
    .replace(/\b[0-9a-f]{32}\b/gi, '(id entfernt)') // (the machine id, which the journal puts into its paths)
    .replace(/(bearer\s+)[\w.~+/=-]{8,}/gi, '$1(entfernt)')
    .replace(/((?:access|refresh|id)_?token|client_?secret|password|passwd|psk|authorization)(["']?\s*[:=]\s*["']?)[^\s"',;&}]+/gi, '$1$2(entfernt)')
    .replace(/(\w+:\/\/)[^\s/:@]+:[^\s/@]+@/g, '$1(entfernt)@')
}

/** The last `lines` lines of a text file (only its end is read), '' when it is not there. */
async function tailOf(file: string, lines: number): Promise<string> {
  try {
    const handle = await fsp.open(file, 'r')
    try {
      const { size } = await handle.stat()
      const length = Math.min(size, 512 * 1024)
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, size - length)
      return buffer.toString('utf8').split('\n').slice(-lines).join('\n')
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

// The commands whose output goes into system.txt of a problem report: read-only, none of them shows a password (the
// serial number of /proc/cpuinfo and dietpi.txt, which holds passwords, are left out on purpose)
const REPORT_COMMANDS: [title: string, script: string][] = [
  ['uname', 'uname -a'],
  ['Betriebssystem', 'grep -E "^(PRETTY_NAME|VERSION)=" /etc/os-release; cat /boot/dietpi/.version 2>/dev/null'],
  [
    'Hardware',
    'tr -d "\\0" < /sys/firmware/devicetree/base/model 2>/dev/null; echo; grep -E "^(Model|Revision|Hardware)" /proc/cpuinfo; echo "CPUs: $(nproc)"; grep -E "^(MemTotal|SwapTotal)" /proc/meminfo',
  ],
  ['Uptime', 'uptime -p; uptime'],
  ['Netzteil / Unterspannung (0x0 = in Ordnung)', 'vcgencmd get_throttled 2>&1; vcgencmd measure_temp 2>&1'],
  ['Arbeitsspeicher', 'free -h'],
  ['Laufwerke', 'lsblk -o NAME,SIZE,TYPE,MODEL,TRAN,FSTYPE,MOUNTPOINT 2>&1'],
  ['Speicherplatz', 'df -h -x tmpfs -x devtmpfs'],
  ['Display und Eingabegeräte', 'cat /sys/class/graphics/fb0/virtual_size 2>&1; for s in /sys/class/drm/*/status; do echo "$s: $(cat "$s")"; done 2>&1; grep "^N: Name" /proc/bus/input/devices 2>&1'],
  ['USB-Geräte', 'lsusb 2>&1'],
  ['I2C (HATs)', 'command -v i2cdetect >/dev/null && i2cdetect -y 1 2>&1 | head -10 || echo "(i2cdetect ist nicht installiert)"'],
  ['Soundkarten', 'aplay -l 2>&1; cat /proc/asound/cards 2>&1'],
  ['DietPi-Einstellungen (Auszug)', 'grep -E "^(CONFIG_SOUNDCARD|CONFIG_LCDPANEL|CONFIG_CPU_GOVERNOR|AUTO_SETUP_TIMEZONE|AUTO_SETUP_LOCALE)=" /boot/dietpi.txt 2>&1'],
  ['Installation / Update (Kopf des letzten Update-Logs)', 'f=$(ls -t /boot/*update*.log 2>/dev/null | head -1); if [ -n "$f" ]; then echo "$f"; sed -n 1,14p "$f"; else echo "(kein Update-Log)"; fi'],
  ['Fehlgeschlagene Dienste', 'systemctl --failed --no-legend --no-pager'],
  ['Startzeit', 'systemd-analyze 2>&1; systemd-analyze blame 2>&1 | head -15'],
  ['pm2', 'PM2=$(command -v pm2 || echo /usr/local/bin/pm2); "$PM2" ls --no-color 2>&1'],
  ['Player', 'grep "engine:" /home/dietpi/.pm2/logs/spotify-control-out.log 2>&1 | tail -1'],
  ['Versionen', 'node --version; mpv --version 2>&1 | head -1; chromium --version 2>&1 | head -1'],
  ['Netzwerk (Adressen)', 'ip -br addr; ip route'],
  ['Kernel-Meldungen (letzte 200)', 'sudo -n dmesg 2>&1 | tail -200'],
  ['Warnungen und Fehler seit dem Start (journal, letzte 300)', 'sudo -n journalctl -b -p warning --no-pager -n 300 2>&1'],
]

// More logs than the log viewer shows: the display, the sound server, the web server and the update that installed this
const REPORT_LOGS: Record<string, string> = {
  ...LOGS,
  'Xorg.0': '/var/log/Xorg.0.log',
  pulseaudio: '/var/log/pulseaudio.log',
  'php-fpm': '/var/log/php8.2-fpm.log',
  'mupibox-idle_shutdown': '/var/log/mupibox/idle_shutdown.log',
}

const BOX_DIR = '/home/dietpi/.mupibox/Sonos-Kids-Controller-master'

/** The newest update log on the boot partition and what its header says about the install (repo, branch or tag, …). */
async function installInfo(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  try {
    const logs = (await fsp.readdir('/boot')).filter((f) => /update.*\.log$/i.test(f))
    const stamped = await Promise.all(logs.map(async (f) => ({ f, at: (await fsp.stat(`/boot/${f}`)).mtimeMs })))
    const newest = stamped.sort((a, b) => b.at - a.at)[0]
    if (!newest) return out
    out.log = `/boot/${newest.f}`
    const head = (await fsp.readFile(out.log, 'utf8')).split('\n').slice(0, 20)
    for (const line of head) {
      const m = /^=\s*(Parameter|Release|Version|Update-URL):\s*(.*)$/.exec(line)
      if (m) out[m[1] === 'Update-URL' ? 'updateUrl' : m[1].toLowerCase()] = m[2].trim()
    }
    const url = /github\.com\/([^/]+\/[^/]+)\/archive\/refs\/(heads|tags)\/(.+)\.zip/.exec(out.updateUrl ?? '')
    if (url) {
      out.repo = url[1]
      out[url[2] === 'heads' ? 'branch' : 'tag'] = url[3]
    }
  } catch {
    // no boot partition to read (development)
  }
  return out
}

/**
 * Which code runs: files that are put in by hand (a branch test, a hot fix) are not in the update log, so the size,
 * date and a short hash of the main files and the name of the display's bundle say it as well.
 */
async function buildFingerprint(): Promise<Record<string, string | string[]>> {
  const out: Record<string, string | string[]> = {}
  for (const f of ['server.js', 'spotify-control.js', 'mupi-app/app.js']) {
    try {
      const file = `${BOX_DIR}/${f}`
      const [stat, bytes] = await Promise.all([fsp.stat(file), fsp.readFile(file)])
      out[f] = `${stat.size} bytes, ${stat.mtime.toISOString()}, sha256 ${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}`
    } catch {
      // not there
    }
  }
  try {
    out.display = (await fsp.readdir(`${BOX_DIR}/www`)).filter((f) => /^main-.*\.js$/.test(f))
  } catch {
    // not there
  }
  return out
}

/** The newest file of a folder matching a pattern (its last `lines` lines), for the report's logs. */
async function newestLog(dirPath: string, pattern: RegExp, lines: number): Promise<{ name: string; text: string } | undefined> {
  try {
    const files = (await fsp.readdir(dirPath)).filter((f) => pattern.test(f))
    const stamped = await Promise.all(files.map(async (f) => ({ f, at: (await fsp.stat(path.join(dirPath, f))).mtimeMs })))
    const newest = stamped.sort((a, b) => b.at - a.at)[0]
    const text = newest ? await tailOf(path.join(dirPath, newest.f), lines) : ''
    return text ? { name: newest.f, text } : undefined
  } catch {
    return undefined
  }
}

// ---------- Pictures and videos to attach to a report ----------
// The app sends each file in its own request (its bytes as the body, as for the uploads to the SD card) and names the
// ones to take along when it asks for the report. They wait on the SD card, not in /tmp (that is the box's RAM, with
// 1 GB or less in all), and are deleted with the report, after half an hour or when the backend starts.

const ATTACH_ROOT = '/var/tmp/mupibox-report-uploads'
const ATTACH_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.mp4', '.m4v', '.mov', '.webm', '.mkv', '.3gp']
const ATTACH_MAX_FILES = 5
const ATTACH_MAX_FILE = 100 * 1024 * 1024
const ATTACH_MAX_TOTAL = 150 * 1024 * 1024
const ATTACH_KEEP_MS = 30 * 60 * 1000
// kept free on the card: the staged files and the zip (about as large) must fit, and the box needs room of its own
const ATTACH_RESERVE = 600 * 1024 * 1024
// (already compressed: stored as they are, not packed again - that only costs the Pi time)
const ZIP_STORE = '.jpg:.jpeg:.png:.gif:.webp:.heic:.heif:.mp4:.m4v:.mov:.webm:.mkv:.3gp'

interface StagedAttachment {
  id: string
  file: string
  name: string
  size: number
  at: number
}
const staged = new Map<string, StagedAttachment>()

function dropStaged(item: StagedAttachment): void {
  staged.delete(item.id)
  fsp.rm(path.dirname(item.file), { recursive: true, force: true }).catch(() => undefined)
}

function sweepStaged(): void {
  for (const item of staged.values()) if (Date.now() - item.at > ATTACH_KEEP_MS) dropStaged(item)
}

/** The folder for the report's working files and zip: on the card (the report may hold videos), else the temp folder. */
async function reportBase(): Promise<string> {
  try {
    await fsp.access('/var/tmp', fsConstants.W_OK)
    return '/var/tmp'
  } catch {
    return os.tmpdir()
  }
}

let reportRunning = false

/**
 * The zip of a problem report, in a temp file the caller sends and deletes (null when it could not be made): what the
 * user wrote, which box and code it is (version, install source, hardware, OS), system state, the config without
 * secrets, the library, the ends of the logs and the attached pictures and videos. Nothing leaves the box by itself -
 * the user downloads it and sends it on.
 */
async function buildReport(deps: SystemDeps, note: string, attachments: StagedAttachment[], userAgent: string): Promise<string | null> {
  const dir = await fsp.mkdtemp(path.join(await reportBase(), 'mupibox-support-'))
  try {
    const server = `${BOX_DIR}/server/config`
    const config = deps.getMupiboxConfig() as Record<string, unknown> | undefined
    const version = String((config?.mupibox as Record<string, unknown> | undefined)?.version ?? '')
    const model = (await fsp.readFile('/sys/firmware/devicetree/base/model', 'utf8').catch(() => '')).replace(/\0/g, '')
    const cpuinfo = await fsp.readFile('/proc/cpuinfo', 'utf8').catch(() => '')
    const meminfo = await fsp.readFile('/proc/meminfo', 'utf8').catch(() => '')
    const osName = (await fsp.readFile('/etc/os-release', 'utf8').catch(() => '')).match(/^PRETTY_NAME="?([^"\n]*)"?/m)?.[1] ?? ''
    const install = await installInfo()
    const build = await buildFingerprint()
    const engine = (await tailOf('/home/dietpi/.pm2/logs/spotify-control-out.log', 4000)).split('\n').reverse().find((l) => l.includes('engine:')) ?? ''
    const info = {
      createdAt: new Date().toISOString(),
      mupibox: { version, installedFrom: install, build },
      os: { name: osName, kernel: os.release(), arch: os.arch() },
      hardware: {
        model,
        revision: /^Revision\s*:\s*(\S+)/m.exec(cpuinfo)?.[1] ?? '',
        cpus: os.cpus().length,
        memTotalMB: Math.round(Number(/^MemTotal:\s*(\d+)/m.exec(meminfo)?.[1] ?? 0) / 1024),
      },
      node: process.version,
      player: engine.replace(/^.*?\]\s*/, ''),
      userAgent,
    }
    await fsp.writeFile(`${dir}/info.json`, scrub(JSON.stringify(info, null, 2)))
    const source = install.branch ? `branch ${install.branch} of ${install.repo}` : install.tag ? `tag ${install.tag} of ${install.repo}` : (install.updateUrl ?? 'unknown')
    await fsp.writeFile(
      `${dir}/README.txt`,
      scrub(
        [
          `MuPiBox problem report, ${info.createdAt}`,
          '',
          'Beschreibung des Problems / description of the problem:',
          note.trim() || '(keine / none)',
          '',
          `Version:      ${version || '?'}`,
          `Installation: ${source}${install.release ? ` (${install.release})` : ''}`,
          `Hardware:     ${model || info.os.arch}, revision ${info.hardware.revision || '?'}, ${info.hardware.memTotalMB} MB RAM`,
          `System:       ${osName || '?'}, kernel ${info.os.kernel}, ${info.os.arch}`,
          `Player:       ${info.player || '?'}`,
          `Anhänge:      ${attachments.length ? attachments.map((a) => a.name).join(', ') : '(keine / none)'}`,
          '',
          'Enthalten: info.json (Version, Installation, Hardware, System), system.txt (Systemstand), mupiboxconfig.json',
          '(Einstellungen ohne Passwörter, Tokens, Konten, Chat-IDs), data.json (Bibliothek), network.json/monitor.json,',
          'boot/ (config.txt, cmdline.txt), logs/ (Ende der Logs), attachments/ (Bilder und Videos).',
          'Passwörter, Tokens, WLAN-Passwörter und MAC-Adressen werden entfernt; geprüft wird per Schlüssel und Muster, daher bitte',
          'vor dem Weitergeben kurz hineinschauen.',
        ].join('\n'),
      ),
    )
    await fsp.writeFile(`${dir}/mupiboxconfig.json`, scrub(JSON.stringify(withoutSecrets(config ?? {}), null, 2)))
    const library = await fsp.readFile(`${server}/data.json`, 'utf8').catch(() => '')
    if (library) await fsp.writeFile(`${dir}/data.json`, scrub(library))
    for (const f of ['monitor.json', 'network.json']) {
      try {
        const json = JSON.parse(await fsp.readFile(`${server}/${f}`, 'utf8')) as Record<string, unknown>
        for (const key of ['mac', 'wifi', 'bssid']) delete json[key]
        await fsp.writeFile(`${dir}/${f}`, JSON.stringify(json, null, 2))
      } catch {
        // not there
      }
    }

    const sections: string[] = []
    for (const [title, script] of REPORT_COMMANDS) {
      const r = await run('sh', ['-c', script], 20000)
      sections.push(`## ${title}\n${r.stdout.trim() || '(keine Ausgabe)'}\n`)
    }
    sections.push(`## Code auf der Box (Größe, Datum, Hash)\n${Object.entries(build).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n')}\n`)
    const states = await run('systemctl', ['is-active', ...SERVICES.map((s) => `${s}.service`)], 5000)
    const lines = states.stdout.split('\n')
    sections.push(`## Dienste\n${SERVICES.map((s, i) => `${s}: ${(lines[i] ?? '').trim() || '?'}`).join('\n')}\n`)
    // (what a failed service logged, up to five of them)
    const failed = (await run('systemctl', ['--failed', '--no-legend', '--plain', '--no-pager'], 5000)).stdout
      .split('\n')
      .map((l) => l.trim().split(/\s+/)[0])
      .filter((u) => /^[\w@.:-]+\.(service|socket|mount|timer)$/.test(u))
      .slice(0, 5)
    for (const unit of failed) {
      const r = await run('sudo', ['-n', 'journalctl', '-u', unit, '-n', '40', '--no-pager'], 10000)
      sections.push(`## Journal: ${unit}\n${r.stdout.trim() || '(keine Ausgabe)'}\n`)
    }
    await fsp.writeFile(`${dir}/system.txt`, scrub(sections.join('\n')))

    await fsp.mkdir(`${dir}/boot`)
    for (const f of ['/boot/config.txt', '/boot/cmdline.txt', '/etc/asound.conf']) {
      const text = await fsp.readFile(f, 'utf8').catch(() => '')
      if (text) await fsp.writeFile(`${dir}/boot/${path.basename(f)}`, scrub(text))
    }
    await fsp.mkdir(`${dir}/logs`)
    for (const [name, file] of Object.entries(REPORT_LOGS)) {
      const text = await tailOf(file, 400)
      if (text) await fsp.writeFile(`${dir}/logs/${name}.log`, scrub(text))
    }
    const update = await newestLog('/boot', /update.*\.log$/i, 300)
    if (update) await fsp.writeFile(`${dir}/logs/${update.name}`, scrub(update.text))

    if (attachments.length) {
      // (links into the staging folder: the zip follows them, nothing is copied)
      await fsp.mkdir(`${dir}/attachments`)
      for (const [i, a] of attachments.entries()) await fsp.symlink(a.file, `${dir}/attachments/${i + 1}-${a.name}`)
    }

    const zip = `${dir}.zip`
    // (zip when the box has it, else Python's zipfile - both put the folder's content into the root of the zip)
    let made = (await run('sh', ['-c', `cd '${dir}' && zip -q -r -n '${ZIP_STORE}' '${zip}' .`], 300000)).ok
    if (!made) made = (await run('python3', ['-c', 'import shutil,sys;shutil.make_archive(sys.argv[1][:-4],"zip",sys.argv[2])', zip, dir], 300000)).ok
    return made ? zip : null
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

let newsCache: { at: number; text: string } | undefined

// ---------- CPU, RAM and temperature over the last 24 hours (as the admin interface's rrd graphs, which kept 20 min) ----------
// Measured once a minute and kept in memory, and in /tmp (RAM as well, nothing on the SD card) every 5 minutes and
// when the process ends: an update of the backend keeps the history, a restart of the box starts it again.
// cpu: the share of the minute the CPUs were busy (from /proc/stat), ram: used share (MemAvailable), temp: °C.

type SystemSample = [at: number, temp: number | null, cpu: number | null, ram: number | null]
const SAMPLE_MS = 60_000
const KEEP_SAMPLES = 24 * 60
const samples: SystemSample[] = []
let lastCpu: { busy: number; total: number } | undefined
let sampler: ReturnType<typeof setInterval> | undefined
const KEPT_FILE = '/tmp/.mupibox-system-history.json'
const KEEP_EVERY = 5 // (samples: every 5 minutes)
let sinceKept = 0

function keepSamples(): void {
  try {
    writeFileSync(KEPT_FILE, JSON.stringify(samples))
  } catch {
    // no /tmp to write: the history lives on in memory
  }
}

// The history kept before this process started (see keepSamples); only the last 24 hours, only well-formed rows
async function readKeptSamples(): Promise<number> {
  try {
    const kept = JSON.parse(await fsp.readFile(KEPT_FILE, 'utf8'))
    if (!Array.isArray(kept)) return 0
    const from = Date.now() - KEEP_SAMPLES * SAMPLE_MS
    const first = samples[0]?.[0] ?? Number.POSITIVE_INFINITY
    const ok = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v))
    const rows = kept.filter(
      (s): s is SystemSample =>
        Array.isArray(s) && s.length === 4 && typeof s[0] === 'number' && s[0] >= from && s[0] < first && ok(s[1]) && ok(s[2]) && ok(s[3]),
    )
    samples.unshift(...rows)
    return rows.length
  } catch {
    // nothing kept (the first start after a restart of the box)
    return 0
  }
}

async function cpuTimes(): Promise<{ busy: number; total: number } | undefined> {
  try {
    const line = (await fsp.readFile('/proc/stat', 'utf8')).split('\n')[0]
    const v = line.trim().split(/\s+/).slice(1).map(Number)
    if (v.length < 4 || v.some((n) => !Number.isFinite(n))) return undefined
    const idle = v[3] + (v[4] ?? 0) // idle + iowait
    const total = v.reduce((a, b) => a + b, 0)
    return { busy: total - idle, total }
  } catch {
    return undefined
  }
}

async function sampleSystem(): Promise<void> {
  let temp: number | null = null
  try {
    const milli = Number.parseInt((await fsp.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8')).trim(), 10)
    if (Number.isFinite(milli)) temp = Math.round(milli / 100) / 10
  } catch {
    // no thermal node
  }
  let ram: number | null = null
  try {
    const info = await fsp.readFile('/proc/meminfo', 'utf8')
    const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(info)?.[1])
    const total = kb('MemTotal')
    const available = kb('MemAvailable')
    if (total > 0 && Number.isFinite(available)) ram = Math.round(((total - available) / total) * 1000) / 10
  } catch {
    // no /proc (not Linux)
  }
  let cpu: number | null = null
  const now = await cpuTimes()
  if (now && lastCpu && now.total > lastCpu.total) cpu = Math.round(((now.busy - lastCpu.busy) / (now.total - lastCpu.total)) * 1000) / 10
  lastCpu = now
  samples.push([Date.now(), temp, cpu, ram])
  if (samples.length > KEEP_SAMPLES) samples.splice(0, samples.length - KEEP_SAMPLES)
  if (++sinceKept >= KEEP_EVERY) {
    sinceKept = 0
    keepSamples()
  }
}

function startSystemSampler(): void {
  if (sampler) return
  void cpuTimes().then((t) => {
    lastCpu = t
  })
  // (what was kept before; else the last 20 minutes of the box's rrd files)
  void readKeptSamples().then((kept) => (kept ? undefined : seedFromRrd()))
  // (process.exit in server.ts's SIGINT/SIGTERM handler: 'exit' still comes, writing has to be synchronous there)
  process.once('exit', keepSamples)
  // (a first CPU share soon after the start, not only after a minute)
  setTimeout(() => void sampleSystem(), 5000).unref()
  sampler = setInterval(() => void sampleSystem(), SAMPLE_MS)
  sampler.unref()
}

// After a restart of this process (every update of it) the box's own rrd files still hold the last 20 minutes of
// temperature and RAM (save_rrd.sh, cron): taken as the start, a minute apart (the CPU share is not in there)
async function seedFromRrd(): Promise<void> {
  const fetch = async (file: string): Promise<Map<number, number[]>> => {
    const out = new Map<number, number[]>()
    const r = await new Promise<string>((resolve) =>
      execFile('rrdtool', ['fetch', file, 'AVERAGE', '-s', '-20min', '-r', '60'], { timeout: 5000, env: { ...process.env, LC_ALL: 'C' } }, (err, stdout) =>
        resolve(err ? '' : String(stdout)),
      ),
    )
    for (const line of r.split('\n')) {
      const m = /^(\d+):\s+(.+)$/.exec(line.trim())
      if (!m) continue
      const vals = m[2].split(/\s+/).map(Number)
      if (vals.every((v) => Number.isFinite(v))) out.set(Number(m[1]) * 1000, vals)
    }
    return out
  }
  const [temps, rams] = await Promise.all([fetch('/tmp/.rrd/cputemp.rrd'), fetch('/tmp/.rrd/ram.rrd')])
  const seeded: SystemSample[] = []
  for (const [at, [temp]] of temps) {
    const ram = rams.get(at)?.[0]
    // (one a minute, as the samples of this process)
    if (seeded.length && at - seeded[seeded.length - 1][0] < SAMPLE_MS) continue
    seeded.push([at, Math.round(temp * 10) / 10, null, ram !== undefined ? Math.round(ram * 10) / 10 : null])
  }
  // (only what is older than the first own sample)
  const first = samples[0]?.[0] ?? Number.POSITIVE_INFINITY
  samples.unshift(...seeded.filter((s) => s[0] < first))
}

/** The samples of the last `hours`, at most `points` of them (averages of equal slices when there are more), and
 *  how far apart they are meant to be (the app breaks its line only at a gap bigger than that). */
function systemHistory(hours: number, points = 240): { step: number; samples: SystemSample[] } {
  const from = Date.now() - hours * 3600e3
  const inRange = samples.filter((s) => s[0] >= from)
  if (inRange.length <= points) return { step: SAMPLE_MS, samples: inRange }
  const size = Math.ceil(inRange.length / points)
  const out: SystemSample[] = []
  for (let i = 0; i < inRange.length; i += size) {
    const slice = inRange.slice(i, i + size)
    const avg = (k: 1 | 2 | 3) => {
      const vals = slice.map((s) => s[k]).filter((v): v is number => v !== null)
      return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null
    }
    out.push([slice[slice.length - 1][0], avg(1), avg(2), avg(3)])
  }
  return { step: size * SAMPLE_MS, samples: out }
}

const CACHE_SIZES = ['0', '8', '16', '32', '64', '128', '256', '512']

export function registerSystemRoutes(router: Router, deps: SystemDeps): void {
  startSystemSampler()
  // pictures and videos of a report that was never finished (the backend restarted meanwhile)
  fsp.rm(ATTACH_ROOT, { recursive: true, force: true }).catch(() => undefined)

  /** GET /api/app/system-history?hours=1|6|24 - [time, temp °C, cpu %, ram %] a minute apart (fewer for 24 h). */
  router.get('/system-history', requireSession, (req, res) => {
    const hours = [1, 6, 24].includes(Number(req.query.hours)) ? Number(req.query.hours) : 1
    res.json({ hours, now: Date.now(), since: samples[0]?.[0] ?? null, ...systemHistory(hours) })
  })

  /** GET /api/app/version - the installed MuPiBox version (mupibox.version). */
  router.get('/version', requireSession, (_req, res) => {
    res.json({ version: String((deps.getMupiboxConfig()?.mupibox as Record<string, unknown> | undefined)?.version ?? '') })
  })

  /** GET /api/app/news - the MuPiBox news (news.txt on GitHub), as text (the admin interface printed it as HTML). */
  router.get('/news', requireSession, async (_req, res) => {
    if (!newsCache || Date.now() - newsCache.at > 3600_000) {
      try {
        const r = await fetch('https://raw.githubusercontent.com/splitti/MuPiBox/main/news.txt', { signal: AbortSignal.timeout(8000) })
        if (r.ok) newsCache = { at: Date.now(), text: (await r.text()).slice(0, 100000) }
      } catch {
        // no internet: the last text, if any
      }
    }
    res.json({ text: newsCache?.text ?? null })
  })

  /**
   * GET /api/app/support-info - a zip for the support (Discord): the library, the config without secrets, the
   * monitor and network state, versions. As the admin interface's support_data.php, but the secrets are removed by
   * key (its line filter let multi-line values through).
   */
  const sendReport = async (note: string, attachments: StagedAttachment[], userAgent: string, res: import('express').Response): Promise<void> => {
    // (one at a time: it runs a dozen commands and reads the logs)
    if (reportRunning) {
      res.status(409).json({ error: 'a report is being made' })
      return
    }
    reportRunning = true
    try {
      const zip = await buildReport(deps, note, attachments, userAgent)
      if (!zip) {
        res.status(500).json({ error: 'zip failed' })
        return
      }
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
      res.download(zip, `mupibox-report-${stamp}.zip`, () => {
        fsp.rm(zip, { force: true }).catch(() => undefined)
        // (sent or not: the pictures and videos are not needed again)
        for (const a of attachments) dropStaged(a)
      })
    } finally {
      reportRunning = false
    }
  }

  router.get('/support-info', requireSession, (req, res) => sendReport('', [], String(req.headers['user-agent'] ?? ''), res))

  /**
   * POST /api/app/issue-report {description, attachments: [id]} - "Problem melden": the same zip, with the user's
   * description (up to 2000 characters) as the first thing in README.txt and the attached pictures and videos (ids
   * from /issue-report/attachment). The app saves the answer as a file; nothing is sent anywhere.
   */
  router.post('/issue-report', requireSession, requireCsrf, (req, res) => {
    const body = (req.body ?? {}) as { description?: unknown; attachments?: unknown }
    const description = String(body.description ?? '').slice(0, 2000)
    const ids = Array.isArray(body.attachments) ? body.attachments.map(String).slice(0, ATTACH_MAX_FILES) : []
    const items = ids.map((id) => staged.get(id))
    if (items.some((item) => !item)) {
      res.status(400).json({ error: 'unknown attachment' })
      return
    }
    return sendReport(description, items as StagedAttachment[], String(req.headers['user-agent'] ?? ''), res)
  })

  /**
   * PUT /api/app/issue-report/attachment?name= - one picture, GIF or video as the request body (as the uploads to the
   * SD card); {id, name, size}. At most 5 files, 100 MB each and 150 MB together, and the card keeps its reserve.
   */
  router.put('/issue-report/attachment', requireSession, requireCsrf, async (req, res) => {
    sweepStaged()
    const name = cleanName(String(req.query.name ?? ''))
    if (!name || !ATTACH_EXTENSIONS.includes(path.extname(name).toLowerCase())) {
      res.status(415).json({ error: 'file type not supported' })
      return
    }
    const size = Number.parseInt(String(req.headers['content-length'] ?? ''), 10)
    if (!Number.isFinite(size) || size <= 0) {
      res.status(411).json({ error: 'length required' })
      return
    }
    const total = [...staged.values()].reduce((sum, a) => sum + a.size, 0)
    if (size > ATTACH_MAX_FILE || total + size > ATTACH_MAX_TOTAL || staged.size >= ATTACH_MAX_FILES) {
      res.status(413).json({ error: 'too many or too large attachments' })
      return
    }
    await fsp.mkdir(ATTACH_ROOT, { recursive: true }).catch(() => undefined)
    const stat = await fsp.statfs(ATTACH_ROOT).catch(() => undefined)
    if (stat && stat.bavail * stat.bsize - size * 2 < ATTACH_RESERVE) {
      res.status(507).json({ error: 'not enough space' })
      return
    }
    const id = randomBytes(8).toString('hex')
    const folder = path.join(ATTACH_ROOT, id)
    const file = path.join(folder, name)
    try {
      await fsp.mkdir(folder)
      let received = 0
      // (counts the bytes: more than announced, or fewer, is no file to keep)
      const count = new Transform({
        transform(chunk: Buffer, _enc, done) {
          received += chunk.length
          done(received > size ? new Error('more than announced') : null, chunk)
        },
      })
      await pipeline(req, count, createWriteStream(`${file}.part`, { flags: 'wx' }))
      if (received !== size) throw new Error('incomplete')
      await fsp.rename(`${file}.part`, file)
      staged.set(id, { id, file, name, size, at: Date.now() })
      res.json({ id, name, size })
    } catch {
      await fsp.rm(folder, { recursive: true, force: true }).catch(() => undefined)
      if (!res.headersSent) res.status(500).json({ error: 'upload failed' })
    }
  })

  /** DELETE /api/app/issue-report/attachment/:id - one staged file again (the app takes back what it uploaded). */
  router.delete('/issue-report/attachment/:id', requireSession, requireCsrf, (req, res) => {
    const item = staged.get(String(req.params.id))
    if (item) dropStaged(item)
    res.json({ ok: true })
  })

  /**
   * POST /api/app/restart {what} - display (Chromium kiosk), player (spotify-control) or services (player and this
   * backend, what the admin interface's "Restart services" should have done - its button called a script name with a
   * typo). Reboot and shutdown stay /api/reboot and /api/shutdown.
   */
  router.post('/restart', requireSession, requireCsrf, (req, res) => {
    const what = String((req.body as { what?: unknown } | undefined)?.what ?? '')
    const scripts: Record<string, string> = {
      display: 'sudo -i -u dietpi /usr/local/bin/mupibox/restart_kiosk.sh',
      player: `${PM2} restart spotify-control`,
      services: `sleep 1; ${PM2} restart spotify-control; ${PM2} restart server`,
    }
    if (!scripts[what]) {
      res.status(400).json({ error: 'what must be display, player or services' })
      return
    }
    detached(scripts[what])
    res.json({ ok: true })
  })

  /**
   * GET /api/app/logs - the logs and services that can be looked at, with the state of each service (states:
   * {name: active | inactive | failed | activating …}, from one systemctl call; missing when it cannot be read)
   */
  router.get('/logs', requireSession, async (_req, res) => {
    const r = await run('systemctl', ['is-active', ...SERVICES.map((s) => `${s}.service`)], 5000)
    const lines = r.stdout.split('\n')
    const states = Object.fromEntries(SERVICES.map((s, i) => [s, (lines[i] ?? '').trim()]).filter(([, st]) => st))
    res.json({ logs: Object.keys(LOGS), services: SERVICES, states })
  })

  /** GET /api/app/logs/view?kind=log|service&key=&grep=&lines= - the end of a log or the state of a service, as text. */
  router.get('/logs/view', requireSession, async (req, res) => {
    const kind = String(req.query.kind ?? 'log')
    // (only a key of the table - 'constructor' and the like are inherited by every object)
    const rawKey = String(req.query.key ?? '')
    const key = Object.hasOwn(LOGS, rawKey) ? rawKey : ''
    const grep = String(req.query.grep ?? '').slice(0, 100)
    const lines = Math.max(20, Math.min(2000, Number.parseInt(String(req.query.lines ?? '200'), 10) || 200))
    let text = ''
    if (kind === 'log' && LOGS[key] && grep) {
      // a search goes through the whole log, then its last lines (not only the last lines searched)
      const r = await run('grep', ['-i', '-F', '--', grep, LOGS[key]], 10000)
      const hits = r.stdout.split('\n').filter((l) => l !== '')
      res.type('text/plain; charset=utf-8').send(hits.slice(-lines).join('\n'))
      return
    }
    if (kind === 'log' && LOGS[key]) {
      const r = await run('tail', ['-n', String(lines), LOGS[key]], 10000)
      text = r.stdout
    } else if (kind === 'service' && SERVICES.includes(key)) {
      const r = await run('sudo', ['systemctl', 'status', `${key}.service`, '--no-pager', '-n', '40'], 10000)
      text = r.stdout
    } else {
      res.status(400).json({ error: 'unknown log or service' })
      return
    }
    if (grep) {
      const g = grep.toLowerCase()
      text = text
        .split('\n')
        .filter((l) => l.toLowerCase().includes(g))
        .join('\n')
    }
    res.type('text/plain; charset=utf-8').send(text)
  })

  /** GET/POST /api/app/controller-debug {on} - the player's debug log (its config.json logLevel), player restarts. */
  router.get('/controller-debug', requireSession, async (_req, res) => {
    const text = await fsp.readFile(PLAYER_CONFIG, 'utf8').catch(() => '')
    res.json({ on: /"logLevel"\s*:\s*"debug"/.test(text) })
  })
  router.post('/controller-debug', requireSession, requireCsrf, async (req, res) => {
    const on = (req.body as { on?: unknown } | undefined)?.on
    if (typeof on !== 'boolean') {
      res.status(400).json({ error: 'on must be true or false' })
      return
    }
    const from = on ? 'error' : 'debug'
    const to = on ? 'debug' : 'error'
    await run('sudo', ['sed', '-i', `s/"logLevel": "${from}"/"logLevel": "${to}"/g`, PLAYER_CONFIG])
    detached(`${PM2} restart spotify-control`)
    res.json({ ok: true })
  })

  /** GET/POST /api/app/browser - the kiosk's Chromium options (chromium-autostart.sh reads them at its start). */
  router.get('/browser', requireSession, (_req, res) => {
    const c = ((deps.getMupiboxConfig() as Record<string, unknown> | undefined)?.chromium ?? {}) as Record<string, unknown>
    res.json({ gpu: c.gpu === true, smooth: c.sccrollanimation === true, kiosk: c.kiosk !== false, cachesize: String(c.cachesize ?? '128'), debug: String(c.debug ?? '0') === '1' })
  })
  router.post('/browser', requireSession, requireCsrf, async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const values: Record<string, unknown> = {}
    // (chromium-autostart.sh runs the booleans as commands and computes with the cache size: only true/false and
    // a size of the list go in - the admin interface stored the cache size unchecked)
    for (const [key, field] of [
      ['gpu', 'gpu'],
      ['smooth', 'sccrollanimation'],
      ['kiosk', 'kiosk'],
    ] as const) {
      if (b[key] === undefined) continue
      if (typeof b[key] !== 'boolean') return void res.status(400).json({ error: `${key} must be true or false` })
      values[field] = b[key]
    }
    if (b.cachesize !== undefined) {
      if (!CACHE_SIZES.includes(String(b.cachesize))) return void res.status(400).json({ error: 'invalid cachesize' })
      values.cachesize = String(b.cachesize)
    }
    if (b.debug !== undefined) {
      if (typeof b.debug !== 'boolean') return void res.status(400).json({ error: 'debug must be true or false' })
      values.debug = b.debug ? '1' : '0'
    }
    await deps.updateMupiboxConfig((cfg) => {
      cfg.chromium = { ...((cfg.chromium as Record<string, unknown>) ?? {}), ...values }
    })
    if (b.restart === true) detached('sudo /usr/local/bin/mupibox/setting_update.sh; sudo -i -u dietpi /usr/local/bin/mupibox/restart_kiosk.sh')
    res.json({ ok: true, restarted: b.restart === true })
  })

  /**
   * POST /api/app/box-language {code} - the language of the box: the texts on the display (displayLanguage) and
   * the boot and maintenance pictures (mupibox.bootscreenLanguage) together; the pictures are made again.
   */
  router.post('/box-language', requireSession, requireCsrf, async (req, res) => {
    const code = String((req.body as { code?: unknown } | undefined)?.code ?? '')
    let languages: Record<string, unknown> = {}
    try {
      languages =
        (JSON.parse(await fsp.readFile('/home/dietpi/.mupibox/Sonos-Kids-Controller-master/www/assets/i18n/display-texts.json', 'utf8')) as { languages?: Record<string, unknown> }).languages ?? {}
    } catch {
      languages = { en: {}, de: {} }
    }
    if (!/^[a-z]{2}(-[a-z]{2})?$/.test(code) || !(code in languages)) {
      res.status(400).json({ error: 'unknown language' })
      return
    }
    await deps.updateMupiboxConfig((cfg) => {
      cfg.displayLanguage = code
      cfg.mupibox = { ...((cfg.mupibox as Record<string, unknown>) ?? {}), bootscreenLanguage: code }
    })
    const child = spawn('sudo', ['/usr/local/bin/mupibox/bootscreen_update.sh'], { detached: true, stdio: 'ignore' })
    child.on('error', () => undefined)
    child.unref()
    res.json({ ok: true })
  })
}
