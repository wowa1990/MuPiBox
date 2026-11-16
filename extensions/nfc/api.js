// NFC extension - the API part (runs in the server of the box): starts the driver of each reader (pn5180.py and the others, Python: Node
// has no way to speak SPI), keeps what they report, gives a tag its medium and tells the app what it sees. Up to three readers run side
// by side, each with its own driver program; a tag counts the same whichever reader it is laid on.
//
//   settings (which readers, which pins) ->  logic.js
//   the driver programs                  ->  runner.js, pn5180.py, rc522.py, pn532.py, usbreader.py
//   which tag plays what                 ->  tags.js (the idea of TeddyCloud), the file tags.json in the extension's data folder
//   "NFC-Tag hinzufügen" in the library  ->  POST /arm (the medium of the open album, station or podcast), GET /armstate, POST /cancel
//   the list of the tags                 ->  GET /tags, POST /tagimage, /tagremove (with the login of the parents)
//   the status block of the readers      ->  GET /state (all), GET /stateone, /statetwo, /statethree (one reader each)
//   the card Anschlüsse (SPI, I2C, UART) ->  GET /spistate, /iicstate, /uartstate (state, device, button), POST /spion, /spioff, /iicon, ... /uartconsole
//   starting a medium                    ->  GET /pending, which display.js asks for: the display starts it like a tap on a tile
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { readConfigs, driverScript, driverArgs, isUsb, statusRows, statusRowsAll, tagNumberText, spiState, spiRows, i2cState, i2cRows, i2cKeysOn, uartState, uartRows, uartConsoles, portIsOn } = require('./logic.js')
const { createRunner, headerChipNumber, detect } = require('./runner.js')
const tags = require('./tags.js')

const RESUME_WITHIN_MS = 30 * 60 * 1000
const PENDING_MS = 20000
const SAME_TAG_MS = 2000
// an assignment waits while the app asks for it (every second while its sheet is open): a sheet closed without "Abbrechen"
// (the phone locked, the app reloaded) must not give the next tag laid on - within 10 minutes - the medium silently
const ARM_UNASKED_MS = 15000
// a tag still lying on the reader when its driver started again (settings changed, the driver fell over): reported anew,
// it does not start its medium again - unless it was taken off and laid on after that time
const AGAIN_AFTER_RESTART_MS = 90000
// the display starts a medium within a second or two of taking it: the first new start within this time is the tag's (asked
// every second, see watchStart) - Spotify, when the box was silent, takes up to half a minute (a longer time for all made any
// start of the child within it the tag's, after the tag's own was refused)
const NOTE_WITHIN_MS = 10000
const NOTE_SPOTIFY_MS = 35000
// tags.json is written when something of it changes that matters (a new tag, a medium given); when a known tag was laid
// on only, at most this often - it was written to the SD card at every laying on (a USB reader: at every hold)
const SEEN_SAVE_MS = 6 * 60 * 60 * 1000
// the same error of the reader (not connected, a wire loose) is logged once, then again after this time at the earliest:
// the driver is started again every 10 minutes and says it again each time
const ERROR_LOG_MS = 6 * 60 * 60 * 1000

exports.activate = (host) => {
  const log = host.log ?? console
  const dir = host.dir ?? __dirname
  const dataDir = host.dataDir ?? dir
  const tagsFile = path.join(dataDir, 'tags.json')
  // The readers that are switched on, in the order of their slots: { config, view, runner, running, inField, lastError } (the first one is always there)
  let readers = []
  const history = []

  // ---- the store of the tags -------------------------------------------------------------------------------------------------
  const readJson = (file) => {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      return null
    }
  }
  const writeJson = (file, value) => {
    try {
      fs.mkdirSync(dataDir, { recursive: true })
      const temp = `${file}.${process.pid}.tmp`
      fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 })
      fs.renameSync(temp, file)
    } catch (error) {
      log.warn(`[nfc] cannot write ${path.basename(file)}: ${error?.message ?? error}`)
    }
  }
  let data = tags.readData(readJson(tagsFile))
  let savedAt = 0
  const saveTags = () => {
    savedAt = Date.now()
    writeJson(tagsFile, data)
  }

  let armed = null // what waits for the next tag: { id, target, media, image, cover, title, until }
  let armSeq = 0
  const done = new Map() // assignment id -> what came of it: { uid, title, previous, flex }
  const remember = (id, result) => {
    done.set(id, result)
    while (done.size > 20) done.delete(done.keys().next().value)
  }
  let pending = null // a medium the display has to start: { seq, media, at, uid }
  // (not from 1: the display keeps the number of the last start it made - after a restart of the server alone a start with
  // that number again was dropped)
  let seq = Date.now()
  let paused = null // the tag whose medium was paused when it was taken off: { uid, at }
  let lastStart = { uid: '', at: 0 }
  // the start the display made for a tag: { uid, at, rss, generation } - the player's number of that playback, once known
  let handed = null
  // the tag whose medium a laying on tried to go on with ("play"), as long as nothing played since
  let resumeTried = null
  let restarted = null // the tag in the field when the driver started again: { uid, until }

  // What a tag is called in the list (fixed phrases: the app translates the ones it knows)
  const KINDS = { library: 'SD-Karte', nas: 'NAS', spotify: 'Spotify', radio: 'Radio', rss: 'Podcast', tidal: 'TIDAL' }
  const fresh = (config) => ({ config, phase: config.reader === 'none' || config.problem ? 'off' : 'starting', firmware: null, product: null, errorCode: null, inField: false, last: null })
  // (running: the driver and its arguments that run now; lastError: the last error of the reader that was logged)
  const makeReader = (config) => ({ config, view: fresh(config), runner: null, running: '', inField: null, lastError: { code: '', at: 0 } })
  readers = [makeReader(readConfigs({})[0])]

  // ---- the player ------------------------------------------------------------------------------------------------------------
  const player = async (command) => {
    try {
      const response = await fetch(`${host.playerUrl}/${command}${command.includes('?') ? '&' : '?'}src=nfc`, { signal: AbortSignal.timeout(4000) })
      return response.ok
    } catch {
      return false
    }
  }
  const playerMeta = async () => {
    try {
      const response = await fetch(`${host.playerUrl}/local`, { signal: AbortSignal.timeout(3000) })
      return response.ok ? await response.json() : null
    } catch {
      return null
    }
  }
  // (what the player reports for a pause: Spotify says `pause`, mpv `playing`)
  const isPaused = (meta) => (meta?.currentPlayer === 'spotify' ? meta.pause === true : meta?.currentPlayer === 'mplayer' ? meta.playing === false && Boolean(meta.currentType) : false)

  // What the display is to play for a medium: itself, but a podcast is a feed - the player plays an episode of it (see tags.pickEpisode)
  const playable = async (media) => {
    if (media.type !== 'rss') return media
    try {
      const response = await fetch(`${host.apiUrl}/api/rssfeed/cached?url=${encodeURIComponent(media.id)}`, { signal: AbortSignal.timeout(15000) })
      if (!response.ok) return null
      const body = await response.json()
      if (typeof body?.rss?._error === 'string') return null
      return tags.pickEpisode(body, media)
    } catch {
      return null
    }
  }

  // (taking the tag off pauses or stops: a tag laid on only for a moment starts nothing - not for a USB reader, which never
  // says that a card went)
  const removeMatters = (settings, reader) => Boolean(reader) && !isUsb(reader.config.reader) && (settings.onRemove === 'pause' || settings.onRemove === 'stop')
  // (a tag lies on one of the readers)
  const inAnyField = (uid) => readers.some((reader) => reader.inField?.uid === uid)

  // A tag with a medium: what it started goes on (it plays on, or a pause is taken back - one made by taking it off only
  // within RESUME_WITHIN_MS), else the display starts the medium.
  // `force`: the start asked for on the page of tags ("Album abspielen") - the medium starts anew, whatever plays and whatever just started
  const start = async (tag, settings, reader = null, force = false) => {
    const now = Date.now()
    // (first: a tag slipped off and laid on again within the 2 s goes on - the lock below is for the same report twice)
    if (!force && handed && handed.uid === tag.uid) {
      // (laid on again before its start came: taking it off counts no more)
      handed.gone = null
      await noteGeneration()
      const meta = await playerMeta()
      // (only what this tag started: something else chosen meanwhile, or stopped, starts the tag's medium anew)
      if (ownPlayback(meta) && meta?.finished !== true) {
        // (laid on again while it plays - a USB reader at every hold: it plays on, it started from its beginning before)
        if (!isPaused(meta)) {
          paused = null
          resumeTried = null
          lastStart = { uid: tag.uid, at: now }
          return
        }
        const pausedLong = paused && paused.uid === tag.uid && now - paused.at >= RESUME_WITHIN_MS
        // (a "play" tried at the last laying on and it is still paused - Spotify refused it, a block: it starts anew, the tag
        // stayed without effect at every laying on)
        const triedBefore = resumeTried === tag.uid
        if (!pausedLong && !triedBefore && (await player('play'))) {
          paused = null
          resumeTried = tag.uid
          lastStart = { uid: tag.uid, at: now }
          // (it plays a moment later: the try worked - a pause made later on the display is taken back again by the tag)
          setTimeout(() => {
            playerMeta()
              .then((after) => {
                if (resumeTried === tag.uid && after && !isPaused(after)) resumeTried = null
              })
              .catch(() => undefined)
          }, 5000).unref?.()
          return
        }
      }
    }
    if (!force && lastStart.uid === tag.uid && now - lastStart.at < SAME_TAG_MS) return
    lastStart = { uid: tag.uid, at: now }
    paused = null
    resumeTried = null
    const media = await playable(tag.media)
    if (!media) return log.warn(`[nfc] tag ${tag.uid}: no episode found for ${tag.title}`)
    // (taken off while its episode was looked for: nothing starts)
    if (!force && removeMatters(settings, reader) && !inAnyField(tag.uid)) return log.info(`[nfc] tag ${tag.uid}: taken off before its start`)
    pending = { seq: ++seq, media, at: now, uid: tag.uid }
  }

  // The player's number of the playback the display started for the tag (it counts every new start): taken once the start
  // was made - what plays then is the tag's as long as that number stays (a podcast's next episode by a button too)
  // (the player's /local: origin - the start what plays comes from, kept by a podcast's next episode; older players: generation)
  const originOf = (meta) => (typeof meta?.origin === 'number' ? meta.origin : typeof meta?.generation === 'number' ? meta.generation : null)
  const noteGeneration = async () => {
    if (!handed || handed.generation !== null || Date.now() - handed.at > handed.within) return
    const asked = handed
    const meta = await playerMeta()
    const origin = originOf(meta)
    // (a start refused - the tile's limit, the listening time, Spotify blocked - makes no new one: nothing is the tag's)
    if (handed === asked && handed.generation === null && origin !== null && origin !== handed.before) {
      handed.generation = origin
      // (taken off before its start came - a slow Spotify start: what the setting says is done now, it did not play on
      // without the tag)
      const gone = handed.gone
      handed.gone = null
      if (gone && !inAnyField(handed.uid)) {
        if (gone === 'pause') {
          if (await player('pause')) paused = { uid: handed.uid, at: Date.now() }
        } else if (gone === 'stop') await player('stop')
      }
    }
  }
  // (asked every second after the hand-over until the start is there: a slow Spotify start was not seen after 4 s, and
  // taking the tag off did not pause it)
  const watchStart = (which) => {
    const timer = setInterval(() => {
      if (handed !== which || which.generation !== null || Date.now() - which.at > which.within) return clearInterval(timer)
      noteGeneration().catch(() => undefined)
    }, 1000)
    timer.unref?.()
  }
  const ownPlayback = (meta) => handed !== null && handed.generation !== null && originOf(meta) === handed.generation
  const playsThisTag = async (tag) => {
    if (!handed || handed.uid !== tag.uid) return false
    await noteGeneration()
    return ownPlayback(await playerMeta())
  }

  const onTag = async (reader, event) => {
    const settings = (await host.settings()) ?? {}
    const now = Date.now()
    if (armed && (armed.until <= now || now - armed.asked > ARM_UNASKED_MS)) armed = null
    const known = Boolean(data.tags[tags.normalizeUid(event?.uid) ?? ''])
    const result = tags.tagLaidOn(data, armed, event, now)
    if (result.disarm) armed = null
    if (result.kind === 'ignored') return
    if (!known || result.armedId || result.kind === 'assigned' || result.kind === 'flex' || now - savedAt >= SEEN_SAVE_MS) saveTags()
    const again = restarted && restarted.uid === result.tag.uid && now < restarted.until
    restarted = null
    reader.inField = result.tag
    if (result.armedId) remember(result.armedId, { uid: result.tag.uid, title: result.tag.title, previous: result.previous ?? '', flex: result.kind === 'flex' })
    log.info(`[nfc] tag ${result.tag.uid}: ${result.kind}${result.tag.title ? ` (${result.tag.title})` : ''}`)
    // (the tag that lay there while the driver started again: its medium plays already)
    if (again && !result.armedId) return
    if (result.kind !== 'unknown' && settings.playOnTag !== false) await start(result.tag, settings, reader)
  }

  const onGone = async (reader) => {
    const tag = reader.inField
    reader.inField = null
    if (!tag?.media) return
    const settings = (await host.settings()) ?? {}
    if (settings.onRemove !== 'pause' && settings.onRemove !== 'stop') return
    // (laid on only for a moment: its start the display has not taken yet is not made)
    if (pending?.uid === tag.uid) {
      pending = null
      return
    }
    // (only when this tag's medium is what plays: another album started meanwhile on the display stays)
    if (!(await playsThisTag(tag))) {
      // (its start handed over but not there yet: done when it comes, see noteGeneration)
      if (handed && handed.uid === tag.uid && handed.generation === null && Date.now() - handed.at <= handed.within && !inAnyField(tag.uid)) handed.gone = settings.onRemove
      return
    }
    resumeTried = null
    if (settings.onRemove === 'pause') {
      if (await player('pause')) paused = { uid: tag.uid, at: Date.now() }
    } else if (settings.onRemove === 'stop') {
      await player('stop')
    }
  }

  // What a reader reports (each reader of the list has its own view of the status and its own tag in the field)
  const onEvent = (reader, event) => {
    const { config, view } = reader
    const where = readers.length > 1 ? ` [reader ${config.slot}]` : ''
    switch (event.event) {
      case 'starting':
        view.phase = 'starting'
        break
      case 'ready':
        reader.lastError = { code: '', at: 0 }
        Object.assign(view, { phase: 'ready', firmware: event.firmware, product: event.product, errorCode: null })
        log.info(`[nfc] reader ready${where} (${[event.product, event.firmware].filter(Boolean).join(' ')})`)
        break
      case 'tag':
        // (a USB reader says when a card comes near, never when it goes: no tag stays in its field)
        view.inField = !isUsb(config.reader)
        view.last = { tech: event.tech, uid: event.uid, at: Date.now(), slot: config.slot }
        history.push(view.last)
        if (history.length > 20) history.shift()
        log.info(`[nfc] tag ${event.uid} (${event.tech})${where}`)
        onTag(reader, event).catch((error) => log.warn(`[nfc] tag: ${error?.message ?? error}`))
        break
      case 'gone':
        view.inField = false
        if (isUsb(config.reader)) break
        onGone(reader).catch((error) => log.warn(`[nfc] gone: ${error?.message ?? error}`))
        break
      case 'error':
        view.phase = 'error'
        view.errorCode = event.code
        if (event.code !== reader.lastError.code || Date.now() - reader.lastError.at >= ERROR_LOG_MS) {
          reader.lastError = { code: event.code, at: Date.now() }
          log.warn(`[nfc] reader${where}: ${event.code}: ${event.message}`)
        }
        break
      default:
    }
  }

  // (one change after the other: the pins and the SPI devices of the settings before are free before the new ones are taken)
  let chain = Promise.resolve()
  let running = '' // the driver and its arguments that run now
  const apply = (settings) => {
    chain = chain
      .then(async () => {
        const configs = readConfigs(settings)
        const chip = configs.some((config) => config.reader !== 'none' && !config.problem) ? headerChipNumber(await detect()) : 0
        const wantedOf = (config) => (config.reader === 'none' || config.problem ? '' : JSON.stringify([driverScript(config), ...driverArgs(config, chip)]))
        // (only another setting of the app - on taking off, start on laying on: the driver goes on, the medium plays on)
        const kept = new Map()
        for (const config of configs) {
          const was = readers.find((reader) => reader.config.slot === config.slot)
          const wanted = wantedOf(config)
          if (was?.runner && wanted !== '' && wanted === was.running && was.view.phase !== 'error') kept.set(config.slot, { was, config })
        }
        // (the pins and the SPI devices of the settings before are free before the new ones are taken)
        await Promise.all(
          readers
            .filter((reader) => !kept.has(reader.config.slot) || kept.get(reader.config.slot).was !== reader)
            .map(async (reader) => {
              await reader.runner?.stop()
              // (the tag on the reader is reported again by the new driver: no new start of what plays - not for a USB reader,
              // which says only when a card comes, never when it goes: its last card lies there no longer)
              if (reader.runner && reader.inField && !isUsb(reader.config.reader)) restarted = { uid: reader.inField.uid, until: Date.now() + AGAIN_AFTER_RESTART_MS }
            }),
        )
        readers = configs.map((config) => {
          const keep = kept.get(config.slot)
          if (!keep) return makeReader(config)
          keep.was.config = config
          keep.was.view.config = config
          return keep.was
        })
        for (const reader of readers) {
          if (reader.config.problem) log.warn(`[nfc] reader ${reader.config.slot} not started: ${reader.config.problem}`)
        }
        for (const reader of readers) {
          const { config, view } = reader
          if (reader.runner || config.reader === 'none' || config.problem) continue
          reader.running = wantedOf(config)
          reader.runner = createRunner({
            command: 'python3',
            args: [path.join(dir, driverScript(config)), ...driverArgs(config, chip)],
            onEvent: (event) => onEvent(reader, event),
            onEnd: (reason, isNew = true) => {
              // (the driver says what is wrong before it ends; if it did not - it fell over - this is all there is to say)
              if (view.phase !== 'error') Object.assign(view, { phase: 'error', errorCode: 'other' })
              view.inField = false
              if (reader.inField && !isUsb(config.reader)) restarted = { uid: reader.inField.uid, until: Date.now() + AGAIN_AFTER_RESTART_MS }
              reader.inField = null
              if (isNew) log.warn(`[nfc] reader program${readers.length > 1 ? ` of reader ${config.slot}` : ''}: ${reason}`)
            },
            log,
          })
          reader.runner.start()
          log.info(`[nfc] reader ${config.reader} started (${driverArgs(config, chip).join(' ')})`)
        }
      })
      .catch((error) => log.warn(`[nfc] not started: ${error?.message ?? error}`))
    return chain
  }
  // (the server ends: no driver may stay behind and hold the pins and the SPI devices)
  process.once('exit', () => readers.forEach((reader) => reader.runner?.kill()))
  if (typeof host.onSettings === 'function') host.onSettings(apply)
  Promise.resolve(host.settings()).then(apply)

  // ---- what the app shows and asks ---------------------------------------------------------------------------------------------
  // (all with the login of the parents: the tags are what the children play)
  host.route(
    'get',
    '/state',
    (_req, res) => {
      const [first] = readers
      res.json({
        rows: statusRowsAll(readers.map((reader) => reader.view)),
        // (the first reader as before; `readers` has all of them)
        reader: { ...first.view, config: undefined, reader: first.config.reader },
        readers: readers.map((reader) => ({ ...reader.view, config: undefined, slot: reader.config.slot, reader: reader.config.reader })),
        process: first.runner ? first.runner.state() : null,
        history,
      })
    },
    { session: true },
  )

  // The USB readers that are plugged in (usbreader.py --list: the devices that type, in the order of their ports), asked at most every
  // two seconds - the page asks while it is open. { event, label, maker, ids } for each.
  let usbSeen = { at: 0, list: [] }
  const listUsb = () =>
    Date.now() - usbSeen.at < 2000
      ? Promise.resolve(usbSeen.list)
      : new Promise((resolve) => {
          execFile('python3', [path.join(dir, 'usbreader.py'), '--list'], { timeout: 6000 }, (error, stdout) => {
            let list = []
            if (!error) {
              try {
                const parsed = JSON.parse(String(stdout).trim().split(String.fromCharCode(10)).pop())
                if (Array.isArray(parsed)) list = parsed.filter((d) => d && typeof d.label === 'string').slice(0, 8)
              } catch {
                /* not a list: none found */
              }
            }
            usbSeen = { at: Date.now(), list }
            resolve(list)
          })
        })

  // SPI, I2C and the serial port: the cards above the readers say whether the port is on and let the user switch it on. It is a line of
  // the boot configuration (as the core does it for the rotation of the display: DietPi's G_CONFIG_INJECT); the device is there after the
  // next restart.
  const bootConfigFile = () => ['/boot/firmware/config.txt', '/boot/config.txt'].find((file) => fs.existsSync(file))
  const readText = (file) => {
    try {
      return file ? fs.readFileSync(file, 'utf8') : ''
    } catch {
      return '' // nothing to read: the port counts as off
    }
  }
  const deviceNames = () => {
    try {
      return fs.readdirSync('/dev')
    } catch {
      return [] // no devices to list
    }
  }
  const spiNow = () => spiState(readText(bootConfigFile()), deviceNames())
  const i2cNow = () => i2cState(readText(bootConfigFile()), readText('/etc/modules'), deviceNames(), fs.existsSync('/sys/module/i2c_dev'))
  const cmdlineText = () => readText(['/boot/firmware/cmdline.txt', '/boot/cmdline.txt'].find((file) => fs.existsSync(file)))
  // the port /dev/serial0 stands for (ttyAMA0, ttyS0), '' while there is none
  const uartTarget = () => {
    try {
      return path.basename(fs.realpathSync('/dev/serial0'))
    } catch {
      return ''
    }
  }
  const loginRuns = (target) =>
    new Promise((resolve) => {
      if (!/^(?:ttyS|ttyAMA)\d+$/.test(target)) return resolve(false)
      execFile('systemctl', ['is-active', '--quiet', `serial-getty@${target}`], { timeout: 5000 }, (error) => resolve(!error))
    })
  const uartNow = async () => {
    const target = uartTarget()
    return uartState(readText(bootConfigFile()), cmdlineText(), deviceNames(), target, await loginRuns(target))
  }
  // One command as the user dietpi (G_SUDO inside: the same way the core turns the display)
  const asDietpi = (commands, done) =>
    execFile('sudo', ['-n', 'su', '-', 'dietpi', '-c', `. /boot/dietpi/func/dietpi-globals && ${commands.join(' && ')}`], { timeout: 60000 }, done)
  const inject = (key, line, file) => `G_SUDO G_CONFIG_INJECT '${key}' '${line}' ${file}`

  // The card "Anschlüsse" has a block for each port (the lines of /spistate, /iicstate, /uartstate), each with a button that switches the
  // port on or off (POST /<name>on, /<name>off; the serial port has one more: /uartconsole, the console of the system off). The state
  // says which button there is, see portRows() in logic.js. `now` reads what the box has, `done` says nothing is left to do, `commands`
  // are the steps (the file of the boot configuration given), `worked` checks the result.
  const ports = [
    {
      route: 'spi',
      name: 'SPI',
      now: async () => spiNow(),
      rows: spiRows,
      actions: {
        on: {
          done: (now) => portIsOn(now),
          commands: (file) => [inject('dtparam=spi=', 'dtparam=spi=on', file)],
          worked: (now) => now.configured,
          already: 'SPI ist schon eingeschaltet.',
          said: 'SPI ist eingeschaltet. Die Box muss neu starten.',
          failed: 'SPI ließ sich nicht einschalten.',
        },
        off: {
          done: (now) => !portIsOn(now),
          commands: (file) => [inject('dtparam=spi=', 'dtparam=spi=off', file)],
          worked: (now) => !portIsOn({ ...now, devices: [] }),
          already: 'Schon ausgeschaltet.',
          said: 'Ausgeschaltet. Die Box muss neu starten.',
          failed: 'Ausschalten hat nicht geklappt.',
        },
      },
    },
    {
      route: 'iic',
      name: 'I2C',
      now: async () => i2cNow(),
      rows: i2cRows,
      actions: {
        on: {
          done: (now) => portIsOn(now) && now.devices.length > 0,
          commands: (file) => [inject('dtparam=i2c_arm=', 'dtparam=i2c_arm=on', file), inject('i2c-dev', 'i2c-dev', '/etc/modules')],
          worked: (now) => now.configured,
          already: 'I2C ist schon eingeschaltet.',
          said: 'I2C ist eingeschaltet. Die Box muss neu starten.',
          failed: 'I2C ließ sich nicht einschalten.',
        },
        off: {
          done: (now) => !portIsOn(now),
          // (every line that has the bus on is set to off: the bus is on while one of them is)
          commands: (file) => [...new Set(['i2c_arm', ...i2cKeysOn(readText(file))])].map((key) => inject(`dtparam=${key}=`, `dtparam=${key}=off`, file)),
          worked: (now) => !portIsOn({ ...now, devices: [] }),
          already: 'Schon ausgeschaltet.',
          said: 'Ausgeschaltet. Die Box muss neu starten.',
          failed: 'Ausschalten hat nicht geklappt.',
        },
      },
    },
    {
      route: 'uart',
      name: 'Seriell',
      now: uartNow,
      rows: uartRows,
      actions: {
        // (on: the console of the system is switched off on the port too - DietPi: the login and the console in cmdline.txt)
        on: {
          done: (now) => now.configured && now.device && !now.console,
          commands: (file) => [inject('enable_uart=', 'enable_uart=1', file), ...consoleOff()],
          worked: (now) => now.configured && !now.console,
          already: 'Die serielle Schnittstelle ist schon eingeschaltet.',
          said: 'Die serielle Schnittstelle ist eingeschaltet. Die Box muss neu starten.',
          failed: 'Die serielle Schnittstelle ließ sich nicht einschalten.',
        },
        off: {
          done: (now) => !portIsOn(now),
          commands: (file) => [inject('enable_uart=', 'enable_uart=0', file)],
          worked: (now) => !now.configured,
          already: 'Schon ausgeschaltet.',
          said: 'Ausgeschaltet. Die Box muss neu starten.',
          failed: 'Ausschalten hat nicht geklappt.',
        },
        // (the port stays on, the console goes)
        console: {
          done: (now) => !now.console,
          commands: () => consoleOff(),
          worked: (now) => !now.console,
          already: 'Die Konsole ist schon abgeschaltet.',
          said: 'Die Konsole ist abgeschaltet. Die Box muss neu starten.',
          failed: 'Die Konsole ließ sich nicht abschalten.',
        },
      },
    },
  ]
  // the steps that switch off the console of the system on the serial port of the header
  function consoleOff() {
    const target = uartTarget()
    const names = new Set([target, ...uartConsoles(cmdlineText(), target)].filter((n) => /^(?:serial|ttyS|ttyAMA)\d+$/.test(n)))
    return [...names].map((n) => `G_SUDO /boot/dietpi/func/dietpi-set_hardware serialconsole disable ${n}`)
  }
  for (const port of ports) {
    host.route('get', `/${port.route}state`, async (_req, res) => res.json({ rows: port.rows(await port.now()) }), { session: true })
    for (const [action, step] of Object.entries(port.actions)) {
      host.route(
        'post',
        `/${port.route}${action}`,
        async (_req, res) => {
          if (step.done(await port.now())) return res.json({ ok: true, message: step.already })
          const file = bootConfigFile()
          if (!file) return res.status(500).json({ ok: false, error: 'no_config', message: step.failed })
          asDietpi(step.commands(file), async (error) => {
            if (error || !step.worked(await port.now())) {
              log.warn(`[nfc] ${port.name} (${action}) did not work: ${error?.message ?? 'the result is not in the configuration'}`)
              return res.status(500).json({ ok: false, error: 'failed', message: step.failed })
            }
            log.info?.(`[nfc] ${port.name} (${action}) done in the boot configuration (the box has to restart)`)
            res.json({ ok: true, message: step.said })
          })
        },
        { session: true },
      )
    }
  }

  // What the choice of the reader type offers (the page asks for it, `live`): "USB Reader 1" and "USB Reader 2" with the name of the
  // device they stand for; the second one is greyed out while no second device is plugged in.
  host.route(
    'get',
    '/usbstate',
    async (_req, res) => {
      const list = await listUsb()
      const name = (n) => (list[n] ? `USB Reader ${n + 1} · ${String(list[n].label).slice(0, 60)}` : `USB Reader ${n + 1}`)
      res.json({ options: { hid: { label: name(0) }, hid2: { label: name(1), disabled: list.length < 2 } }, devices: list })
    },
    { session: true },
  )

  // The status of one reader for its own card on the page (the routes have letters only: one, two, three). A reader that is not
  // in use says it is off.
  for (const [name, slot] of [['stateone', 1], ['statetwo', 2], ['statethree', 3]]) {
    host.route(
      'get',
      `/${name}`,
      (_req, res) => {
        const reader = readers.find((r) => r.config.slot === slot)
        res.json({ rows: reader ? statusRows(reader.view) : [{ label: 'Leser', value: 'Aus', tone: 'warn' }] })
      },
      { session: true },
    )
  }

  // "NFC-Tag" in the library, "add another tag": the medium of the open album, station or podcast goes to the next tag that is laid on
  // (a tag that had one is given the new one), or - with `flex` - to the flex tag at once. `image` is the picture the user chose,
  // `cover` the one the app showed for the medium. { media, image?, cover?, flex? } -> { ok, id, state }
  host.route(
    'post',
    '/arm',
    (req, res) => {
      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const media = tags.sanitizeMedia(body.media)
      if (!media) return res.status(400).json({ ok: false, error: 'not_startable', message: 'Dieses Medium lässt sich keinem Tag zuordnen' })
      if (readers.every((reader) => reader.view.phase === 'off' || reader.view.phase === 'error')) return res.status(409).json({ ok: false, error: 'no_reader', message: 'Der NFC-Leser ist nicht bereit' })
      const image = tags.sanitizeImage(body.image)
      const cover = tags.sanitizeImage(body.cover)
      const title = tags.mediaLabel(media)
      const id = ++armSeq
      if (body.flex === true && tags.giveToFlex(data, media, Date.now(), image, cover)) {
        saveTags()
        armed = null
        remember(id, { uid: data.flex, title, previous: '', flex: true })
        return res.json({ ok: true, id, state: 'done', message: 'Der Flex-Tag hat das Medium' })
      }
      armed = { id, target: body.flex === true ? 'flex' : 'any', media, image, cover, title, until: Date.now() + tags.ARM_SECONDS * 1000, asked: Date.now() }
      res.json({ ok: true, id, state: 'waiting', seconds: tags.ARM_SECONDS })
    },
    { session: true },
  )

  // What came of an assignment (the app asks every second while its sheet is open): waiting, done (uid, title, what the tag had
  // before), or gone (cancelled, replaced by another, or the time is over)
  host.route(
    'get',
    '/armstate',
    (req, res) => {
      const id = Number(req.query.id)
      const result = done.get(id)
      if (result) return res.json({ state: 'done', ...result })
      if (armed && armed.id === id && armed.until > Date.now() && Date.now() - armed.asked <= ARM_UNASKED_MS) {
        armed.asked = Date.now()
        return res.json({ state: 'waiting', title: armed.title, seconds: Math.ceil((armed.until - Date.now()) / 1000) })
      }
      res.json({ state: 'gone' })
    },
    { session: true },
  )

  host.route(
    'post',
    '/cancel',
    (req, res) => {
      const id = Number(req.body?.id)
      if (!id || armed?.id === id) armed = null
      res.json({ ok: true, message: 'Zuordnung abgebrochen' })
    },
    { session: true },
  )

  // A row of the list of tags: { id, title, text, image, imageOwn, coverPost, actions }
  const tagRow = (tag, page = false) => ({
    id: tag.uid,
    title: tag.title,
    text: [KINDS[tag.media.type], tagNumberText({ reader: tag.tech === 'HID' ? 'hid' : '' }, tag.uid), data.flex === tag.uid ? 'Flex-Tag' : ''].filter(Boolean),
    image: tags.tagImage(tag),
    imageOwn: Boolean(tags.sanitizeImage(tag.image)),
    coverPost: '/api/ext/nfc/tagimage',
    // (the page shows the buttons as symbols; "Tag ändern" is the app's: it goes to the library to choose the new album)
    actions: [
      ...(page
        ? [
            { label: 'Album abspielen', icon: 'play', post: '/api/ext/nfc/tagplay', safe: true },
            { label: 'Tag ändern', icon: 'swap', change: true },
          ]
        : []),
      { label: 'Entfernen', icon: 'trash', post: '/api/ext/nfc/tagremove', confirm: 'Diesen Tag entfernen? Er spielt dann nichts mehr.' },
    ],
  })
  const byRecent = (a, b) => b.assignedAt - a.assignedAt || b.lastSeen - a.lastSeen

  // The tags that have a medium, for the list on the page "Tags": { items: [...] }
  host.route(
    'get',
    '/tags',
    (_req, res) => {
      res.json({ items: Object.values(data.tags).filter((tag) => tag.media).sort(byRecent).map((tag) => tagRow(tag, true)) })
    },
    { session: true },
  )

  // The tags of one medium, for the sheet "NFC-Tag" of an album, station or podcast: { media } -> { items: [...] }
  host.route(
    'post',
    '/tagsfor',
    (req, res) => {
      const media = tags.sanitizeMedia(req.body?.media)
      if (!media) return res.json({ items: [] })
      const key = tags.mediumKey(media)
      res.json({ items: Object.values(data.tags).filter((tag) => tag.media && tags.mediumKey(tag.media) === key).sort(byRecent).map((tag) => tagRow(tag)) })
    },
    { session: true },
  )

  // A picture for a tag ({ id, image }; an empty image = the cover of the medium again)
  host.route(
    'post',
    '/tagimage',
    (req, res) => {
      const uid = tags.normalizeUid(req.body?.id)
      const tag = uid ? data.tags[uid] : null
      if (!tag?.media) return res.status(404).json({ ok: false, error: 'no_tag', message: 'Diesen Tag gibt es nicht mehr' })
      const wanted = String(req.body?.image ?? '')
      const image = tags.sanitizeImage(wanted)
      if (wanted !== '' && image === '') return res.status(400).json({ ok: false, error: 'bad_image', message: 'Das Bild geht nicht' })
      tag.image = image
      saveTags()
      res.json({ ok: true, message: 'Bild geändert' })
    },
    { session: true },
  )

  // A tag is taken out of the store (it is noted as new when it is laid on again)
  host.route(
    'post',
    '/tagremove',
    (req, res) => {
      const uid = tags.normalizeUid(req.body?.id)
      if (!uid || !tags.forgetTag(data, uid)) return res.status(404).json({ ok: false, error: 'no_tag', message: 'Diesen Tag gibt es nicht mehr' })
      saveTags()
      res.json({ ok: true, message: 'Tag entfernt' })
    },
    { session: true },
  )

  // A tag gets another medium without being laid on ({ id, media, cover? }): "change tag" on the page of tags, after the user chose the new
  // album in the library
  host.route(
    'post',
    '/tagchange',
    (req, res) => {
      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const uid = tags.normalizeUid(body.id)
      if (!uid || !data.tags[uid]?.media) return res.status(404).json({ ok: false, error: 'no_tag', message: 'Diesen Tag gibt es nicht mehr' })
      const media = tags.sanitizeMedia(body.media)
      if (!media) return res.status(400).json({ ok: false, error: 'not_startable', message: 'Dieses Medium lässt sich keinem Tag zuordnen' })
      tags.giveToTag(data, uid, media, Date.now(), body.cover)
      saveTags()
      res.json({ ok: true, message: 'Tag geändert' })
    },
    { session: true },
  )

  // The medium of a tag starts as if the tag was laid on ({ id })
  host.route(
    'post',
    '/tagplay',
    async (req, res) => {
      const uid = tags.normalizeUid(req.body?.id)
      const tag = uid ? data.tags[uid] : null
      if (!tag?.media) return res.status(404).json({ ok: false, error: 'no_tag', message: 'Diesen Tag gibt es nicht mehr' })
      await start(tag, (await host.settings()) ?? {}, null, true)
      res.json({ ok: true, message: 'Wird abgespielt' })
    },
    { session: true },
  )

  // What the display asks for every second: the medium to start (once - it is gone when it was handed over, and a start older
  // than a few seconds is not wanted any more: the display was away)
  host.route('get', '/pending', async (_req, res) => {
    // (what plays before the display starts the tag's medium: only a start after it is the tag's)
    const origin = pending ? originOf(await playerMeta()) : null
    const now = Date.now()
    const command = pending && now - pending.at < PENDING_MS ? pending : null
    pending = null
    if (command) {
      handed = { uid: command.uid, at: now, before: origin, generation: null, gone: null, within: command.media?.type === 'spotify' ? NOTE_SPOTIFY_MS : NOTE_WITHIN_MS }
      resumeTried = null
      // (the display starts it within a second or two - Spotify after a silence later: its number is taken then, before
      // another start can come)
      watchStart(handed)
    }
    res.json(command ? { seq: command.seq, media: command.media } : {})
  })

  // (the reports of a driver, handed in directly: for the tests; `slot` is the reader that reports, the first by default)
  return { feed: (event, slot = 1) => onEvent(readers.find((reader) => reader.config.slot === slot) ?? readers[0], event) }
}

exports._test = { RESUME_WITHIN_MS }
