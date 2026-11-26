import express, { type Express, type RequestHandler, type Response } from 'express'
import { isUserGpio, MAX_USERS, USER_COLORS, type Users, UserSwitchError } from '../users'
import { copyPerUser } from './extensions'

/**
 * The users of the box (5.1, users.ts) in the app (the parents' login) and for the display.
 *
 *   GET  /api/app/users              the list: switched on, who is in place, how the display switches, the users (with
 *                                    the count of their library), the trash
 *   POST /api/app/users/add          { name, from? }   from: a user whose library the new one gets a copy of
 *   POST /api/app/users/rename       { id, name }
 *   POST /api/app/users/color        { id, color }
 *   POST /api/app/users/remove       { id }            into the trash (30 days)
 *   POST /api/app/users/restore      { key }           back out of it
 *   POST /api/app/users/switch       { id }
 *   POST /api/app/users/enable       { enabled, keep? }   off: keep = the user the box goes on with
 *   POST /api/app/users/switch-mode  { mode }          free | hold | app
 *   POST /api/app/users/pin          { id, pin }       4 digits, '' takes it away (the display asks it before switching to him)
 *   GET  /api/app/users/gpio         the pins of the header with who holds them (a user's own button pin is free for him)
 *   POST /api/app/users/gpio         { id, pin?, ask? }  a button of his own at the box (BCM 2-27), 0 takes it away: pressing it
 *                                    switches to him whatever the display's way of switching (user-buttons.ts) - at once, or
 *                                    with ask (and a PIN of his own) after his PIN at the display
 *   GET  /api/users/state            the display: switched on, who is in place, the users (no names of the trash), whether a
 *                                    button asks for a PIN (then the display asks the next route every second or two)
 *   GET  /api/users/ask              the display: the user whose button asked for his PIN at the display { id, at, ageMs }, else {}
 *   POST /api/users/switch           the display (only on the box itself): { id, pin? } - not with "only in the app";
 *                                    403 pin { left } wrong PIN, 429 pin_locked { seconds } after 5 wrong
 *   POST /api/users/select           the box's tools (MQTT; only on the box itself): { id } or { name } - no PIN
 */
export function registerUserRoutes(
  app: Express,
  users: Users,
  guard: { session: RequestHandler; csrf: RequestHandler; local: RequestHandler },
  gpio: {
    /** what else holds which pin (pin -> who), the users' own buttons not counted */
    taken: () => Promise<{ pins: Map<number, string[]>; blind: string[] }>
    /** called after every change of the users: the buttons are watched anew */
    changed: () => void
  } = { taken: async () => ({ pins: new Map(), blind: [] }), changed: () => undefined },
): void {
  const router = express.Router()
  const fail = (res: Response, err: unknown) => {
    if (err instanceof UserSwitchError) {
      const status = { busy: 409, disabled: 409, unknown_user: 404, failed: 400, mode: 403, pin: 403, pin_locked: 429, gpio_twice: 409 }[err.code]
      const extra = err.code === 'pin' ? { left: Number(err.message) } : err.code === 'pin_locked' ? { seconds: Number(err.message) } : {}
      res.status(status).json({ error: err.code, reason: err.message, ...extra })
      return
    }
    res.status(500).json({ error: 'failed', reason: (err as Error).message })
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : '')

  const list = () => {
    const f = users.state()
    return {
      enabled: f.enabled,
      current: f.current,
      switchMode: f.switchMode,
      max: MAX_USERS,
      colors: USER_COLORS,
      users: f.users.map((u) => ({ id: u.id, name: u.name, color: u.color, pin: Boolean(u.pin), gpio: u.gpio ?? 0, gpioAsk: u.gpioAsk === true, count: users.files.libraryCount(u.id, f.current) })),
      trash: users.files.trashList().map((t) => ({ key: t.key, name: t.name, color: t.color, deletedAt: t.deletedAt })),
    }
  }

  router.get('/users', guard.session, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json(list())
  })
  const post = (route: string, work: (body: Record<string, unknown>) => Promise<unknown>) =>
    router.post(route, guard.session, guard.csrf, async (req, res) => {
      try {
        await work((req.body as Record<string, unknown> | undefined) ?? {})
        gpio.changed()
        res.json({ ok: true, ...list() })
      } catch (err) {
        fail(res, err)
      }
    })
  // (a copy: the values per user of the extensions come along)
  post('/users/add', async (b) => {
    const from = str(b.from) || null
    const user = await users.add(b.name, from)
    if (from) await copyPerUser(from, user.id).catch(() => undefined)
    return user
  })
  post('/users/rename', (b) => users.rename(str(b.id), b.name))
  post('/users/color', (b) => users.setColor(str(b.id), str(b.color)))
  post('/users/remove', (b) => users.remove(str(b.id)))
  post('/users/restore', (b) => users.restore(str(b.key)))
  post('/users/switch', (b) => users.switchTo(str(b.id)))
  post('/users/enable', (b) => users.setEnabled(b.enabled === true, str(b.keep) || undefined))
  post('/users/switch-mode', (b) => users.setSwitchMode(b.mode))
  post('/users/pin', (b) => users.setPin(str(b.id), b.pin))
  // The pins a user's button may be on: every pin of the header that nothing else holds (his own and the other users' buttons
  // aside: those are told by the users' list)
  router.get('/users/gpio', guard.session, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const taken = await gpio.taken()
    res.json({ pins: Array.from({ length: 26 }, (_, i) => i + 2).map((pin) => ({ pin, holders: taken.pins.get(pin) ?? [] })), blind: taken.blind })
  })
  router.post('/users/gpio', guard.session, guard.csrf, async (req, res) => {
    const b = (req.body as Record<string, unknown> | undefined) ?? {}
    try {
      const pin = b.pin === undefined ? undefined : b.pin === 0 || b.pin === null || b.pin === '' ? 0 : b.pin
      if (pin === undefined && b.ask === undefined) throw new UserSwitchError('failed', 'gpio')
      if (pin !== undefined && pin !== 0) {
        if (!isUserGpio(pin)) throw new UserSwitchError('failed', 'gpio')
        // (what the user has himself is no one else's: a pin he had before that something holds now is not asked again)
        const had = users.state().users.find((u) => u.id === str(b.id))?.gpio
        const holders = (await gpio.taken()).pins.get(pin)
        if (holders?.length && pin !== had) {
          res.status(409).json({ error: 'gpio_taken', pin, by: holders.join(', ') })
          return
        }
      }
      if (pin !== undefined) await users.setGpio(str(b.id), pin)
      if (b.ask !== undefined) await users.setGpioAsk(str(b.id), b.ask)
      gpio.changed()
      res.json({ ok: true, ...list() })
    } catch (err) {
      fail(res, err)
    }
  })
  app.use('/api/app', router)

  const displayState = () => {
    const f = users.state()
    return {
      enabled: f.enabled,
      current: f.current,
      switchMode: f.switchMode,
      users: f.enabled ? f.users.map((u) => ({ id: u.id, name: u.name, color: u.color, pin: Boolean(u.pin) })) : [],
      // (a button that asks the PIN at the display: the display then asks /api/users/ask often, else it does not)
      ask: f.enabled && f.users.some((u) => u.gpio && u.gpioAsk && u.pin),
    }
  }
  app.get('/api/users/ask', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const a = users.pendingAsk()
    res.json(a ? { id: a.id, at: a.at, ageMs: Date.now() - a.at } : {})
  })
  app.get('/api/users/state', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json(displayState())
  })
  app.post('/api/users/switch', guard.local, express.json(), async (req, res) => {
    const b = (req.body as Record<string, unknown> | undefined) ?? {}
    try {
      await users.switchFromDisplay(str(b.id), b.pin)
      res.json({ ok: true, ...displayState() })
    } catch (err) {
      fail(res, err)
    }
  })
  // the box's own tools of the parents (MQTT - mqtt.py): as the app, without the PIN and whatever the display's way of
  // switching; by id or by name (Home Assistant sends the name it shows)
  app.post('/api/users/select', guard.local, express.json(), async (req, res) => {
    const b = (req.body as Record<string, unknown> | undefined) ?? {}
    try {
      await users.switchTo(userIdOf(users, b))
      res.json({ ok: true, ...displayState() })
    } catch (err) {
      fail(res, err)
    }
  })
}

/** The id of the user a tool names: { id } or { name } (case and blanks around it do not count); '' none such */
export function userIdOf(users: Users, b: Record<string, unknown>): string {
  const f = users.state()
  if (typeof b.id === 'string' && f.users.some((u) => u.id === b.id)) return b.id
  const name = typeof b.name === 'string' ? b.name.trim().toLocaleLowerCase() : ''
  return (name && f.users.find((u) => u.name.trim().toLocaleLowerCase() === name)?.id) || ''
}
