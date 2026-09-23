/*
 * Browser-facing protection for the box's HTTP API.
 *
 * The API has no login of its own: the kiosk, the remote control (the box UI opened from the LAN or
 * embedded in the admin interface), the Telegram bot and the player all call it. That stays so.
 * What must not work is a *foreign web page* driving the box through a visitor's browser - with
 * `cors()` wide open, any site could read /api/config and post to any endpoint, and DNS rebinding
 * could make a foreign domain look same-origin. So:
 *
 *  1. Host header allowlist (anti DNS rebinding): localhost, IP literals, and the box's hostname.
 *  2. Cross-site requests are refused (Sec-Fetch-Site, and Origin for unsafe methods as a fallback
 *     for browsers without Fetch Metadata). Top-level navigations to pages stay possible, e.g. a
 *     link opened from a chat app.
 *  3. CORS only answers for the box itself.
 *
 * Requests without these headers (curl, python requests, the player) are not affected: they are
 * not a browser acting on someone else's behalf.
 */
import os from 'node:os'
import type { Request, RequestHandler } from 'express'

const LOCAL_SUFFIXES = ['local', 'lan', 'home', 'fritz.box', 'localdomain', 'home.arpa', 'box', 'speedport.ip', 'internal']

function hostnameOf(hostHeader: string | undefined): string {
  if (!hostHeader) return ''
  const h = hostHeader.trim().toLowerCase()
  if (h.startsWith('[')) {
    return h.slice(0, h.indexOf(']') + 1)
  }
  return h.split(':')[0]
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || (host.startsWith('[') && host.endsWith(']'))
}

export function isAllowedHost(hostHeader: string | undefined): boolean {
  const host = hostnameOf(hostHeader)
  if (host === '') return true // HTTP/1.0 clients without Host: not a browser
  if (host === 'localhost' || isIpLiteral(host)) return true
  const boxName = os.hostname().toLowerCase()
  if (host === boxName) return true
  return LOCAL_SUFFIXES.some((suffix) => host === `${boxName}.${suffix}`)
}

/** Origin header belongs to this box (same hostname as the request, any port). */
function isSameHostOrigin(req: Request): boolean {
  const origin = req.headers.origin
  if (!origin || origin === 'null') return false
  try {
    const url = new URL(origin)
    // URL.hostname keeps the brackets of an IPv6 literal, like hostnameOf() does
    return url.hostname.toLowerCase() === hostnameOf(req.headers.host) && isAllowedHost(url.host)
  } catch {
    return false
  }
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Paths a foreign site may send the browser to as a top-level navigation. */
const NAVIGATION_ALLOWED_API: string[] = []

function reject(req: Request, res: Parameters<RequestHandler>[1], reason: string) {
  console.warn(
    `${new Date().toLocaleString()}: [MuPiBox-Server] Refused ${req.method} ${req.path} (${reason}; host=${req.headers.host ?? ''} origin=${req.headers.origin ?? ''})`,
  )
  res.status(403).send('forbidden')
}

export const browserGuard: RequestHandler = (req, res, next) => {
  if (!isAllowedHost(req.headers.host)) {
    reject(req, res, 'host not allowed')
    return
  }

  const site = req.headers['sec-fetch-site']
  if (site === 'cross-site') {
    const isNavigation = req.headers['sec-fetch-mode'] === 'navigate' && (req.method === 'GET' || req.method === 'HEAD')
    const pageOrAllowed = !req.path.startsWith('/api/') || NAVIGATION_ALLOWED_API.includes(req.path)
    if (!(isNavigation && pageOrAllowed)) {
      reject(req, res, 'cross-site request')
      return
    }
  }

  if (UNSAFE_METHODS.has(req.method) && req.headers.origin !== undefined && !isSameHostOrigin(req)) {
    reject(req, res, 'foreign origin')
    return
  }

  next()
}

/** cors() options delegate: allow only the box's own origins. */
export function corsOptionsFor(req: Request, callback: (err: Error | null, options?: { origin: boolean }) => void) {
  callback(null, { origin: isSameHostOrigin(req) })
}

export function isLoopback(req: Request): boolean {
  const addr = req.socket.remoteAddress ?? ''
  // the whole 127.0.0.0/8: a box's own hostname often resolves to 127.0.1.1 (Debian /etc/hosts)
  return addr === '::1' || /^(::ffff:)?127\./.test(addr)
}

/** Only processes on the box itself (kiosk, Telegram bot, player). */
export const localOnly: RequestHandler = (req, res, next) => {
  if (isLoopback(req)) {
    next()
    return
  }
  res.status(403).json({ error: 'local only' })
}

