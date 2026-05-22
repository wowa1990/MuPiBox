// Phase 14c — Eltern-WebApp auth.
// Magic-Link + Session-Cookie model. Two backing files in tmpfs so
// they don't survive reboots (deliberate — sessions die with the box):
//   /tmp/.eltern_magic_links.json  — pending single-use tokens, 15-min TTL
//   /tmp/.eltern_sessions.json     — active session cookies, 24-h TTL
//
// Tokens and session IDs are 32-byte cryptographically random hex
// strings. Single-use enforcement on magic links blocks replay attacks;
// session lifetime is enforced on every check via timestamp comparison.

import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs'

const MAGIC_LINKS_PATH = '/tmp/.eltern_magic_links.json'
const SESSIONS_PATH = '/tmp/.eltern_sessions.json'

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000
const SESSION_TTL_MS = 24 * 60 * 60 * 1000
const TOKEN_BYTES = 32 // 64 hex chars

interface MagicLink {
  /** ISO timestamp of issuance. */
  issued: string
  /** Whether the token has already been redeemed. */
  used: boolean
  /** Optional label for audit logging (e.g. 'telegram', 'cloud-batterie-tap'). */
  source: string
}

interface Session {
  /** ISO timestamp of cookie issuance. */
  issued: string
  /** ISO timestamp of last seen — used to auto-extend on every request. */
  lastSeen: string
  /** Remote IP at issuance (audit). */
  ip: string
  /** CSRF token paired to this session (double-submit pattern). */
  csrf: string
}

type MagicLinkMap = Record<string, MagicLink>
type SessionMap = Record<string, Session>

// In-memory copy so we don't hit tmpfs on every middleware call. Loaded
// lazily on first access; the file is the source of truth on cold start.
let magicLinksCache: MagicLinkMap | null = null
let sessionsCache: SessionMap | null = null

function readMap<T>(path: string): T {
  try {
    if (!fs.existsSync(path)) return {} as T
    const raw = fs.readFileSync(path, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return {} as T
  }
}

function writeMap<T>(path: string, map: T): void {
  const tmp = `${path}.tmp.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(map), 'utf8')
  fs.renameSync(tmp, path)
}

function loadMagicLinks(): MagicLinkMap {
  if (magicLinksCache === null) magicLinksCache = readMap<MagicLinkMap>(MAGIC_LINKS_PATH)
  return magicLinksCache
}

function loadSessions(): SessionMap {
  if (sessionsCache === null) sessionsCache = readMap<SessionMap>(SESSIONS_PATH)
  return sessionsCache
}

function saveMagicLinks(): void {
  if (magicLinksCache) writeMap(MAGIC_LINKS_PATH, magicLinksCache)
}

function saveSessions(): void {
  if (sessionsCache) writeMap(SESSIONS_PATH, sessionsCache)
}

/** Strip entries past their TTL. Idempotent, called from generate + validate. */
function purgeExpiredMagicLinks(now: number = Date.now()): void {
  const links = loadMagicLinks()
  let touched = false
  for (const [token, entry] of Object.entries(links)) {
    if (now - Date.parse(entry.issued) > MAGIC_LINK_TTL_MS) {
      delete links[token]
      touched = true
    }
  }
  if (touched) saveMagicLinks()
}

function purgeExpiredSessions(now: number = Date.now()): void {
  const sessions = loadSessions()
  let touched = false
  for (const [id, entry] of Object.entries(sessions)) {
    if (now - Date.parse(entry.issued) > SESSION_TTL_MS) {
      delete sessions[id]
      touched = true
    }
  }
  if (touched) saveSessions()
}

/**
 * Issue a new magic link. Caller persists/communicates the token
 * (telegram bot sends URL, box-frontend shows QR + code, etc.).
 * Returns the raw token; the WebApp consumes it via GET /eltern?token=...
 */
export function generateMagicLink(source: string): { token: string; expiresIn: number } {
  purgeExpiredMagicLinks()
  const token = randomBytes(TOKEN_BYTES).toString('hex')
  const links = loadMagicLinks()
  links[token] = {
    issued: new Date().toISOString(),
    used: false,
    source,
  }
  magicLinksCache = links
  saveMagicLinks()
  return { token, expiresIn: Math.floor(MAGIC_LINK_TTL_MS / 1000) }
}

/**
 * Redeem a magic-link token. On success: marks it as used (single-use),
 * issues a session, returns the session id + csrf token. On failure:
 * returns null. Defensive against missing entries, expired entries,
 * and already-used entries.
 */
export function redeemMagicLink(token: string, ip: string): { sessionId: string; csrf: string } | null {
  purgeExpiredMagicLinks()
  const links = loadMagicLinks()
  const entry = links[token]
  if (!entry || entry.used) return null
  entry.used = true
  saveMagicLinks()

  const sessions = loadSessions()
  const sessionId = randomBytes(TOKEN_BYTES).toString('hex')
  const csrf = randomBytes(TOKEN_BYTES).toString('hex')
  const nowIso = new Date().toISOString()
  sessions[sessionId] = {
    issued: nowIso,
    lastSeen: nowIso,
    ip,
    csrf,
  }
  sessionsCache = sessions
  saveSessions()
  return { sessionId, csrf }
}

/** Validate a session cookie, touch lastSeen. Returns the session or null. */
export function validateSession(sessionId: string | undefined): Session | null {
  if (!sessionId) return null
  purgeExpiredSessions()
  const sessions = loadSessions()
  const entry = sessions[sessionId]
  if (!entry) return null
  // Touch lastSeen to extend the active window (within absolute TTL).
  entry.lastSeen = new Date().toISOString()
  sessionsCache = sessions
  // Don't write on every request — it would bottleneck tmpfs. Background
  // saves would be ideal; for now we rely on the next state-changing
  // request to flush. Read-only lastSeen drift is acceptable.
  return entry
}

/** Drop a session — for explicit logout. */
export function destroySession(sessionId: string | undefined): void {
  if (!sessionId) return
  const sessions = loadSessions()
  if (sessions[sessionId]) {
    delete sessions[sessionId]
    sessionsCache = sessions
    saveSessions()
  }
}

/** Constant for the cookie name; centralised so middleware + router agree. */
export const SESSION_COOKIE = 'mupibox_eltern_session'
export const CSRF_HEADER = 'x-mupibox-csrf'

/** Constant for the magic-link URL path; centralised for the bot/frontend
 *  callers that need to construct the link. */
export const MAGIC_LINK_PATH = '/eltern'
