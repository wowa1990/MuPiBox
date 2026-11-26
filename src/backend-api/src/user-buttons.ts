import { type ChildProcess, execFile, spawn } from 'node:child_process'
import type { Users } from './users'

/**
 * The buttons of the users (5.1, "Mehrere Benutzer"): every user may have a button of his own at the box - a pin of the header
 * (BCM 2-27) with a button to GND. Pressing it switches to that user, at once: no PIN is asked (whatever the user's PIN at the
 * display), and the display's way of switching ("only in the app" too) does not matter - the button is on the box, as the box's
 * own tools (MQTT) are. A user may choose that his button asks his PIN at the display first (User.gpioAsk, with a PIN of his
 * own): the button then only has the display show the pad for him, and the PIN is checked as for any switch at the display.
 * Only while several users are switched on.
 *
 * The levels of the pins are read with gpiomon (libgpiod, the package gpiod - on every MuPiBox), as the extension "Buttons & GPIO
 * Input" reads its pins. The pins hold their own pull-up; a falling edge is a press.
 *
 * libgpiod changed its tools with version 2 (Debian 13 "Trixie"); Debian 12 "Bookworm" has version 1:
 *   v1: gpiomon --bias=pull-up --line-buffered --format="%o %e" <chip> <pin>...     %e: 0 falling, 1 rising
 *   v2: gpiomon --chip <chip> --bias pull-up --edges both --format "%o %E" <pin>... %E: falling, rising
 */

/** The major version of the gpiomon that is installed (`gpiomon --version`: "gpiomon (libgpiod) v2.2.1"); 0 when it cannot be read */
export function gpiodMajor(versionOutput: unknown): number {
  const m = /\bv(\d+)\.\d+/.exec(String(versionOutput ?? ''))
  return m ? Number(m[1]) : 0
}

/** The chip of the header pins from `gpiodetect` ("gpiochip0 [pinctrl-rp1] (54 lines)"): the RP1 of a Pi 5, else the SoC's own; gpiochip0 when none is found */
export function headerChip(gpiodetectOutput: unknown): string {
  const chips: { name: string; label: string }[] = []
  for (const line of String(gpiodetectOutput ?? '').split('\n')) {
    const m = /^(gpiochip\d+)\s+\[([^\]]*)\]/.exec(line.trim())
    if (m) chips.push({ name: m[1], label: m[2] })
  }
  for (const label of [/^pinctrl-rp1$/, /^pinctrl-bcm2711$/, /^pinctrl-bcm2835$/, /^pinctrl-bcm/]) {
    const hit = chips.find((c) => label.test(c.label))
    if (hit) return hit.name
  }
  return 'gpiochip0'
}

/** The arguments of gpiomon for these pins: both edges, the pull-up on, one line per edge ("<pin> <edge>"), written at once */
export function gpiomonArgs(major: number, chip: string, pins: number[]): string[] {
  const lines = pins.map(String)
  if (major >= 2) return ['--chip', chip, '--bias', 'pull-up', '--edges', 'both', '--format', '%o %E', ...lines]
  return ['--bias=pull-up', '--line-buffered', '--format=%o %e', chip, ...lines]
}

/** One line of gpiomon -> { pin, pressed } (a falling edge is a press: the button pulls the pin to GND); null for anything else */
export function parseEdge(major: number, line: unknown): { pin: number; pressed: boolean } | null {
  const m = /^\s*(\d{1,2})\s+(\S+)\s*$/.exec(String(line ?? ''))
  if (!m) return null
  const pin = Number(m[1])
  const edge = m[2]
  if (major >= 2) {
    if (edge !== 'falling' && edge !== 'rising') return null
    return { pin, pressed: edge === 'falling' }
  }
  if (edge !== '0' && edge !== '1') return null
  return { pin, pressed: edge === '0' }
}

type Run = (cmd: string, args: string[]) => Promise<{ ok: boolean; out: string }>
const runCommand: Run = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (error, stdout, stderr) => resolve({ ok: !error, out: `${stdout ?? ''}${stderr ?? ''}` }))
  })

export interface UserButtonsOptions {
  users: Pick<Users, 'gpioPins' | 'switchTo' | 'askPinAtDisplay' | 'state'>
  log?: Pick<Console, 'info' | 'warn'>
  spawnFn?: (cmd: string, args: string[]) => ChildProcess
  runFn?: Run
  /** a press within this time of the one before on the same pin is the same press (a button's bounce, a finger that stays) */
  quietMs?: number
  now?: () => number
}

export interface UserButtonsState {
  running: boolean
  error: string | null
  pins: number[]
}

/**
 * Watches the pins of the users' buttons. sync() reads who has which pin now and starts, changes or ends the watching to match
 * (call it after every change of the users - and now and then, a restore may have changed them behind its back).
 */
export function createUserButtons(options: UserButtonsOptions) {
  const { users, log = console, quietMs = 400, now = Date.now } = options
  const spawnFn = options.spawnFn ?? ((cmd: string, args: string[]) => spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }))
  const runFn = options.runFn ?? runCommand
  const state: UserButtonsState = { running: false, error: null, pins: [] }
  let child: ChildProcess | null = null
  let watching: number[] = []
  let stopped = false
  let retry: NodeJS.Timeout | null = null
  let delay = 2000
  const lastPress = new Map<number, number>()
  // (one change after the other: the pins of before are free before the new ones are taken)
  let chain: Promise<unknown> = Promise.resolve()

  /** a press: switch to the user whose button it is (looked up now: the users may have changed since gpiomon started) */
  const pressed = (pin: number) => {
    const at = now()
    if (at - (lastPress.get(pin) ?? -Infinity) < quietMs) return
    lastPress.set(pin, at)
    const who = users.gpioPins().find((u) => u.pin === pin)
    if (!who) return
    if (who.ask && users.state().current !== who.id) {
      log.info(`[users] button on GPIO ${pin}: the display asks the PIN of ${who.name}`)
      users.askPinAtDisplay(who.id)
      return
    }
    log.info(`[users] button on GPIO ${pin}: switching to ${who.name}`)
    users.switchTo(who.id).catch((err: Error) => log.warn(`[users] button on GPIO ${pin}: ${err.message}`))
  }

  const end = (): Promise<void> => {
    if (retry) clearTimeout(retry)
    retry = null
    const proc = child
    child = null
    state.running = false
    if (!proc) return Promise.resolve()
    return new Promise((resolve) => {
      // (the pins are free once it is gone; a gpiomon that does not go is killed)
      const force = setTimeout(() => {
        try {
          proc.kill('SIGKILL')
        } catch {
          /* gone meanwhile */
        }
        resolve()
      }, 1500)
      proc.once('exit', () => {
        clearTimeout(force)
        resolve()
      })
      try {
        proc.kill('SIGTERM')
      } catch {
        clearTimeout(force)
        resolve()
      }
    })
  }

  const launch = (major: number, chip: string, pins: number[]) => {
    if (stopped) return
    let buffer = ''
    let lastError = ''
    const started = now()
    const proc = spawnFn('gpiomon', gpiomonArgs(major, chip, pins))
    child = proc
    state.running = true
    proc.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString('utf8')
      let at = buffer.indexOf('\n')
      while (at >= 0) {
        const edge = parseEdge(major, buffer.slice(0, at))
        buffer = buffer.slice(at + 1)
        // (a pin that was not asked for cannot come - but nothing of gpiomon is taken on trust)
        if (edge?.pressed && pins.includes(edge.pin)) {
          state.error = null
          try {
            pressed(edge.pin)
          } catch (err) {
            log.warn(`[users] button handler failed: ${err}`)
          }
        }
        at = buffer.indexOf('\n')
      }
      if (buffer.length > 1000) buffer = ''
    })
    proc.stderr?.on('data', (data: Buffer) => {
      lastError = (data.toString('utf8').trim().split('\n').pop() ?? '').slice(0, 200)
    })
    const ended = (why: string) => {
      if (child !== proc) return
      child = null
      state.running = false
      if (stopped) return
      state.error = lastError || why
      log.warn(`[users] gpiomon ended (${state.error}) - starting it again in ${Math.round(delay / 1000)} s`)
      // (it ran for a while: the next start is soon again; it ends at once every time: more and more slowly, up to a minute)
      if (now() - started > 30000) delay = 2000
      retry = setTimeout(() => launch(major, chip, pins), delay)
      delay = Math.min(60000, delay * 2)
    }
    proc.on('error', (error: NodeJS.ErrnoException) => ended(error.code === 'ENOENT' ? 'gpiomon is not installed (package gpiod)' : String(error.message ?? error)))
    proc.on('exit', (code, signal) => ended(`exit ${code ?? signal}`))
  }

  const apply = async () => {
    const wanted = [...new Set(users.gpioPins().map((u) => u.pin))].sort((a, b) => a - b)
    if (wanted.join() === watching.join() && (wanted.length === 0 || child || retry)) return
    await end()
    watching = wanted
    state.pins = [...wanted]
    state.error = null
    if (wanted.length === 0 || stopped) return
    const version = await runFn('gpiomon', ['--version'])
    const major = gpiodMajor(version.out)
    if (!major) {
      state.error = 'gpiomon is not installed (package gpiod)'
      log.warn(`[users] ${state.error}`)
      return
    }
    const chip = headerChip((await runFn('gpiodetect', [])).out)
    delay = 2000
    launch(major, chip, wanted)
    log.info(`[users] watching the users' buttons on GPIO ${wanted.join(', ')}`)
  }

  return {
    state: (): UserButtonsState => ({ ...state, pins: [...state.pins] }),
    sync(): Promise<void> {
      if (stopped) return Promise.resolve()
      chain = chain.then(apply).catch((err) => log.warn(`[users] buttons not started: ${(err as Error)?.message ?? err}`))
      return chain as Promise<void>
    },
    /** Ends gpiomon at once, without waiting (the server itself ends) */
    kill() {
      stopped = true
      if (retry) clearTimeout(retry)
      try {
        child?.kill('SIGTERM')
      } catch {
        /* gone meanwhile */
      }
    },
    async stop() {
      stopped = true
      await end()
    },
  }
}

export type UserButtons = ReturnType<typeof createUserButtons>
