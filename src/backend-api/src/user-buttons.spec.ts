import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, it } from 'node:test'
import { createUserButtons, gpiodMajor, gpiomonArgs, headerChip, parseEdge } from './user-buttons'

// The buttons of the users (user-buttons.ts): gpiomon watched, a press switches to the user whose button it is

class FakeProc extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  killed: string[] = []
  kill(signal: string) {
    this.killed.push(signal)
    queueMicrotask(() => this.emit('exit', null, signal))
    return true
  }
}

type Pin = { pin: number; id: string; name: string; ask?: boolean }

function setup(pins: Pin[]) {
  const procs: { args: string[]; proc: FakeProc }[] = []
  const switched: string[] = []
  const asked: string[] = []
  const messages: string[] = []
  let clock = 1000
  const state = { pins, fail: false, current: 'main' }
  const buttons = createUserButtons({
    users: {
      gpioPins: () => state.pins.map((p) => ({ ...p, ask: p.ask === true })),
      state: () => ({ current: state.current }) as never,
      askPinAtDisplay: (id: string) => void asked.push(id),
      switchTo: async (id: string) => {
        switched.push(id)
        if (state.fail) throw new Error('busy')
        return {} as never
      },
    },
    log: { info: (m: string) => messages.push(m), warn: (m: string) => messages.push(m) },
    spawnFn: (_cmd, args) => {
      const proc = new FakeProc()
      procs.push({ args, proc })
      return proc as never
    },
    runFn: async (cmd) => (cmd === 'gpiomon' ? { ok: true, out: 'gpiomon (libgpiod) v2.2.1' } : { ok: true, out: 'gpiochip0 [pinctrl-bcm2835] (58 lines)' }),
    now: () => clock,
  })
  const line = (n: number, text: string) => procs[n].proc.stdout.emit('data', Buffer.from(`${text}\n`))
  return { buttons, procs, switched, asked, messages, state, advance: (ms: number) => (clock += ms), line }
}

describe('what gpiomon says', () => {
  it('knows the version, the chip and the arguments of both libgpiod generations', () => {
    assert.equal(gpiodMajor('gpiomon (libgpiod) v2.2.1'), 2)
    assert.equal(gpiodMajor('gpiomon (libgpiod) v1.6.3'), 1)
    assert.equal(gpiodMajor(''), 0)
    assert.equal(headerChip('gpiochip0 [pinctrl-rp1] (54 lines)\ngpiochip4 [gpio-brcmstb@107d508500] (32 lines)'), 'gpiochip0')
    assert.equal(headerChip(''), 'gpiochip0')
    assert.deepEqual(gpiomonArgs(2, 'gpiochip0', [17, 22]).slice(-2), ['17', '22'])
    assert.ok(gpiomonArgs(1, 'gpiochip0', [17]).includes('--bias=pull-up'))
    assert.deepEqual(parseEdge(2, '17 falling'), { pin: 17, pressed: true })
    assert.deepEqual(parseEdge(2, '17 rising'), { pin: 17, pressed: false })
    assert.deepEqual(parseEdge(1, '17 0'), { pin: 17, pressed: true })
    assert.equal(parseEdge(2, 'garbage'), null)
  })
})

describe('the buttons of the users', () => {
  it('start gpiomon on the pins of the users and switch to the one whose button is pressed', async () => {
    const t = setup([
      { pin: 17, id: 'leni', name: 'Leni' },
      { pin: 22, id: 'tom', name: 'Tom' },
    ])
    await t.buttons.sync()
    assert.equal(t.procs.length, 1)
    assert.deepEqual(t.procs[0].args.slice(-2), ['17', '22'])
    t.line(0, '22 falling')
    assert.deepEqual(t.switched, ['tom'])
    // (letting go is nothing; a pin nobody has is nothing)
    t.line(0, '22 rising')
    t.line(0, '5 falling')
    assert.deepEqual(t.switched, ['tom'])
    assert.deepEqual(t.buttons.state().pins, [17, 22])
  })

  it('ask the PIN at the display instead of switching when the user chose that - except for the one who is in place', async () => {
    const t = setup([
      { pin: 17, id: 'leni', name: 'Leni', ask: true },
      { pin: 22, id: 'tom', name: 'Tom' },
    ])
    await t.buttons.sync()
    t.line(0, '17 falling')
    assert.deepEqual(t.asked, ['leni'])
    assert.deepEqual(t.switched, [])
    // (the other button of the box switches at once)
    t.line(0, '22 falling')
    assert.deepEqual(t.switched, ['tom'])
    // (his own button while he is there: nothing to ask, nothing to switch to - the switch itself does nothing)
    t.state.current = 'leni'
    t.advance(1000)
    t.line(0, '17 falling')
    assert.deepEqual(t.asked, ['leni'])
    assert.deepEqual(t.switched, ['tom', 'leni'])
  })

  it('count a bounce or a finger that stays as one press', async () => {
    const t = setup([{ pin: 17, id: 'leni', name: 'Leni' }])
    await t.buttons.sync()
    t.line(0, '17 falling')
    t.advance(100)
    t.line(0, '17 falling')
    assert.deepEqual(t.switched, ['leni'])
    t.advance(1000)
    t.line(0, '17 falling')
    assert.deepEqual(t.switched, ['leni', 'leni'])
  })

  it('look up the user at the press: a button taken away since gpiomon started does nothing', async () => {
    const t = setup([{ pin: 17, id: 'leni', name: 'Leni' }])
    await t.buttons.sync()
    t.state.pins = []
    t.line(0, '17 falling')
    assert.deepEqual(t.switched, [])
  })

  it('go on after a switch that fails, and tell why', async () => {
    const t = setup([{ pin: 17, id: 'leni', name: 'Leni' }])
    t.state.fail = true
    await t.buttons.sync()
    t.line(0, '17 falling')
    await new Promise((r) => setImmediate(r))
    assert.ok(t.messages.some((m) => m.includes('busy')))
  })

  it('watch anew when the pins change, and not at all when there are none', async () => {
    const t = setup([{ pin: 17, id: 'leni', name: 'Leni' }])
    await t.buttons.sync()
    // (nothing changed: the same gpiomon)
    await t.buttons.sync()
    assert.equal(t.procs.length, 1)
    t.state.pins = [{ pin: 5, id: 'leni', name: 'Leni' }]
    await t.buttons.sync()
    assert.equal(t.procs.length, 2)
    assert.deepEqual(t.procs[0].proc.killed, ['SIGTERM'])
    assert.deepEqual(t.procs[1].args.slice(-1), ['5'])
    t.state.pins = []
    await t.buttons.sync()
    assert.equal(t.procs.length, 2)
    assert.deepEqual(t.procs[1].proc.killed, ['SIGTERM'])
    assert.deepEqual(t.buttons.state(), { running: false, error: null, pins: [] })
  })

  it('say so when gpiomon is not installed', async () => {
    const buttons = createUserButtons({
      users: { gpioPins: () => [{ pin: 17, id: 'leni', name: 'Leni', ask: false }], switchTo: async () => ({}) as never, askPinAtDisplay: () => undefined, state: () => ({}) as never },
      log: { info: () => undefined, warn: () => undefined },
      runFn: async () => ({ ok: false, out: '' }),
    })
    await buttons.sync()
    assert.equal(buttons.state().error, 'gpiomon is not installed (package gpiod)')
    assert.equal(buttons.state().running, false)
  })
})
