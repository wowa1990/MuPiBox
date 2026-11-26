// The weather, API part: fetches the values of the chosen place from the chosen weather server and gives the display one plain answer
// (the same fields from either server), and searches places by name. Both servers are free and need no key.
//   GET /api/ext/weather/data           -> { configured, provider, place, timeText, lastText, nextText, rhythm, temperature, humidity, windSpeed, windGust, windDir,
//                                            windDirAvg, pressure, rainPast24, rainNext24 (the rain of the last and of the next 24 hours; null when not known), tempMin, tempMax, humMin, humMax, pressMin,
//                                            pressMax, trend: { temp, hum, press } (-1, 0, 1) }
//   GET /api/ext/weather/places?q=name  -> [{ label, values: { placeName, lat, lon } }]

// (the weather servers give new values in steps of their own - MET Norway says when in its `Expires` header, Open-Meteo has a value
// every 15 minutes - so the box asks again only when a new answer is due, and then at most once a minute while it is not there yet)
const MIN_CACHE_MS = 60 * 1000
const QUARTER_HOUR_MS = 15 * 60 * 1000
const HALF_HOUR_MS = 30 * 60 * 1000
const TIMEOUT_MS = 15000
// (met.no asks every program to name itself: https://api.met.no/doc/TermsOfService)
const USER_AGENT = 'MuPiBox-weather-extension/1.0 github.com/Lippsson/MuPiBox'

const round = (value, digits = 1) => (Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null)

/** A value between two others (`f` from 0 to 1); the one that is there when the other is missing. */
function lerp(a, b, f) {
  if (Number.isFinite(a) && Number.isFinite(b)) return a + (b - a) * f
  return Number.isFinite(a) ? a : b
}

/** The same for a direction in degrees: the short way round (350° and 10° meet at 0°). */
function lerpDir(a, b, f) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.isFinite(a) ? a : b
  const turn = ((((b - a) % 360) + 540) % 360) - 180
  return (a + turn * f + 360) % 360
}

/** The time of day of a moment in the time zone of the place ("HH:MM"); the box's own zone when the place's is not known. */
function clock(ms, timeZone) {
  const options = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
  try {
    return new Intl.DateTimeFormat('de-DE', timeZone ? { ...options, timeZone } : options).format(ms)
  } catch {
    return new Intl.DateTimeFormat('de-DE', options).format(ms)
  }
}

/** The mean of directions in degrees (359° and 1° give 0°, not 180°); null for none. */
function circularMean(degrees) {
  const list = degrees.filter((d) => Number.isFinite(d))
  if (list.length === 0) return null
  const x = list.reduce((sum, d) => sum + Math.cos((d * Math.PI) / 180), 0)
  const y = list.reduce((sum, d) => sum + Math.sin((d * Math.PI) / 180), 0)
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return null
  return (Math.round((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

/** -1, 0 or 1: the value fell, stayed or rose by at least `step` (the dials show it as an arrow); 0 when one of the values is missing. */
function trendOf(now, before, step) {
  if (!Number.isFinite(now) || !Number.isFinite(before)) return 0
  return now - before >= step ? 1 : before - now >= step ? -1 : 0
}

const minOf = (values) => round(Math.min(...values.filter((v) => Number.isFinite(v))))
const maxOf = (values) => round(Math.max(...values.filter((v) => Number.isFinite(v))))

/** Open-Meteo: measured values of now and the hours before (hourly, 24 h back). */
function parseOpenMeteo(body) {
  const c = body?.current
  if (!c || !Number.isFinite(c.temperature_2m)) throw new Error('no current values')
  const h = body.hourly ?? {}
  const times = Array.isArray(h.time) ? h.time : []
  // (the hours up to now; the last hour of the answer may lie ahead)
  const past = times.map((t, i) => i).filter((i) => String(times[i]).slice(0, 13) <= String(c.time).slice(0, 13))
  const series = (key, now) => [...past.map((i) => h[key]?.[i]), now].filter((v) => Number.isFinite(v))
  const temps = series('temperature_2m', c.temperature_2m)
  const hums = series('relative_humidity_2m', c.relative_humidity_2m)
  const press = series('pressure_msl', c.pressure_msl)
  // (the trend: now against three hours ago)
  const ago = (key) => h[key]?.[past[Math.max(0, past.length - 4)]]
  return {
    timeText: String(c.time).slice(11, 16),
    temperature: round(c.temperature_2m),
    humidity: round(c.relative_humidity_2m, 0),
    windSpeed: round(c.wind_speed_10m),
    windGust: round(c.wind_gusts_10m),
    windDir: round(c.wind_direction_10m, 0),
    windDirAvg: circularMean(past.slice(-3).map((i) => h.wind_direction_10m?.[i])) ?? round(c.wind_direction_10m, 0),
    pressure: round(c.pressure_msl),
    rainPast24: round(past.slice(-24).reduce((sum, i) => sum + (Number(h.precipitation?.[i]) || 0), 0)),
    // (the hours after the current one, as far as the answer has them: the forecast of the next 24 hours)
    rainNext24: round(times.map((t, i) => i).filter((i) => !past.includes(i)).slice(0, 24).reduce((sum, i) => sum + (Number(h.precipitation?.[i]) || 0), 0)),
    tempMin: minOf(temps),
    tempMax: maxOf(temps),
    humMin: minOf(hums),
    humMax: maxOf(hums),
    pressMin: minOf(press),
    pressMax: maxOf(press),
    trend: { temp: trendOf(c.temperature_2m, ago('temperature_2m'), 1), hum: trendOf(c.relative_humidity_2m, ago('relative_humidity_2m'), 5), press: trendOf(c.pressure_msl, ago('pressure_msl'), 1) },
  }
}

/**
 * MET Norway: the model's values (one set per hour), counted over to the minute `now` between the hour before and the hour after
 * it; the rain is the forecast of the next 24 hours (there are no values of the hours before).
 */
function parseMetNo(body, now = Date.now(), rainPast24 = null) {
  const series = body?.properties?.timeseries
  if (!Array.isArray(series) || !series[0]?.data?.instant?.details || !Number.isFinite(series[0].data.instant.details.air_temperature)) throw new Error('no current values')
  // (the last hour that has begun, and the fraction of the way to the next one)
  let i = 0
  while (i + 1 < series.length && Date.parse(series[i + 1].time) <= now) i++
  const j = Math.min(i + 1, series.length - 1)
  const span = Date.parse(series[j].time) - Date.parse(series[i].time)
  const f = i === j || !(span > 0) ? 0 : Math.min(1, Math.max(0, (now - Date.parse(series[i].time)) / span))
  const at = (index, key) => series[index]?.data?.instant?.details?.[key]
  const mix = (key) => lerp(at(i, key), at(j, key), f)
  const day = series.slice(i, i + 24)
  const temps = day.map((e) => e?.data?.instant?.details?.air_temperature).filter((v) => Number.isFinite(v))
  const dirs = day.slice(0, 3).map((e) => e?.data?.instant?.details?.wind_from_direction)
  const all = (key) => day.map((e) => e?.data?.instant?.details?.[key])
  const kmh = (ms) => (Number.isFinite(ms) ? ms * 3.6 : NaN)
  const temperature = mix('air_temperature')
  const humidity = mix('relative_humidity')
  const pressure = mix('air_pressure_at_sea_level')
  const windDir = lerpDir(at(i, 'wind_from_direction'), at(j, 'wind_from_direction'), f)
  return {
    timeText: new Date(now).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }),
    temperature: round(temperature),
    humidity: round(humidity, 0),
    windSpeed: round(kmh(mix('wind_speed'))),
    windGust: round(kmh(mix('wind_speed_of_gust'))),
    windDir: round(windDir, 0),
    windDirAvg: circularMean(dirs) ?? round(windDir, 0),
    pressure: round(pressure),
    // (what fell in the last 24 hours is not in this answer: the caller gives it when it has it)
    rainPast24: round(rainPast24),
    rainNext24: round(day.reduce((sum, e) => sum + (Number(e?.data?.next_1_hours?.details?.precipitation_amount) || 0), 0)),
    tempMin: minOf(temps),
    tempMax: maxOf(temps),
    humMin: minOf(all('relative_humidity')),
    humMax: maxOf(all('relative_humidity')),
    pressMin: minOf(all('air_pressure_at_sea_level')),
    pressMax: maxOf(all('air_pressure_at_sea_level')),
    // (the model has no hours before: the trend is where the next three hours go)
    trend: { temp: trendOf(at(i + 3, 'air_temperature'), temperature, 1), hum: trendOf(at(i + 3, 'relative_humidity'), humidity, 5), press: trendOf(at(i + 3, 'air_pressure_at_sea_level'), pressure, 1) },
  }
}

/** A place from the geocoding answer of Open-Meteo, as the app lists it. */
function placeOf(r) {
  const label = [r.name, r.admin1, r.country].filter((p, i, all) => p && all.indexOf(p) === i).join(', ').slice(0, 120)
  return { label: `${label} (${round(r.latitude, 2)}, ${round(r.longitude, 2)})`, values: { placeName: label, lat: round(r.latitude, 4), lon: round(r.longitude, 4) } }
}

/** The answer of a weather server with what it says about itself: `{ body, modified, expires }` (moments in ms, NaN when not said). */
async function getJsonMeta(url, headers = {}) {
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return { body: await response.json(), modified: Date.parse(response.headers.get('last-modified') ?? ''), expires: Date.parse(response.headers.get('expires') ?? '') }
}

async function getJson(url, headers = {}) {
  return (await getJsonMeta(url, headers)).body
}

// What MET Norway does not say, from Open-Meteo: the time zone of the place and the rain of the last 24 hours (MET Norway has only the
// forecast). The zone is kept for as long as the box runs; when Open-Meteo does not answer, the times are shown in the box's own zone and
// the rain of the last 24 hours is not shown.
const zones = new Map()
async function extrasOf(lat, lon) {
  const key = `${lat}:${lon}`
  try {
    const body = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m&hourly=precipitation&past_hours=24&forecast_hours=1&timezone=auto`)
    if (typeof body?.timezone === 'string') zones.set(key, body.timezone)
    const times = Array.isArray(body?.hourly?.time) ? body.hourly.time : []
    const upTo = String(body?.current?.time ?? '').slice(0, 13)
    const sums = times.map((t, i) => (String(t).slice(0, 13) <= upTo ? Number(body.hourly.precipitation?.[i]) : NaN)).filter((v) => Number.isFinite(v))
    return { zone: zones.get(key) ?? null, rainPast24: sums.length > 0 ? sums.slice(-24).reduce((sum, v) => sum + v, 0) : null }
  } catch {
    return { zone: zones.get(key) ?? null, rainPast24: null }
  }
}

// What a source gives: `{ build(now) -> the values of the minute, last, next, zone, rhythm }` - `last` and `next` are the moments of the last
// answer of the server and of the next one that is due (ms); `rhythm` is how often the server gives one: "quarter" or "half".
const SOURCES = {
  openmeteo: async (lat, lon) => {
    const { body } = await getJsonMeta(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=temperature_2m,relative_humidity_2m,pressure_msl,precipitation,wind_direction_10m&past_hours=24&forecast_hours=25&wind_speed_unit=kmh&timezone=auto`,
    )
    const data = parseOpenMeteo(body)
    // (the values are those of a quarter of an hour: `current.time` is local time, `utc_offset_seconds` the offset)
    const step = Number(body.current?.interval) > 0 ? Number(body.current.interval) * 1000 : QUARTER_HOUR_MS
    const last = Date.parse(`${body.current.time}Z`) - (Number(body.utc_offset_seconds) || 0) * 1000
    return { build: () => data, last: Number.isFinite(last) ? last : Date.now(), next: (Number.isFinite(last) ? last : Date.now()) + step, zone: body.timezone, rhythm: 'quarter' }
  },
  metno: async (lat, lon) => {
    const [{ body, modified, expires }, extras] = await Promise.all([
      getJsonMeta(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`),
      extrasOf(lat, lon),
    ])
    parseMetNo(body) // (an answer without values is an error now, not at the first look)
    const now = Date.now()
    const complete = () => Boolean(src.zone) && src.rainPast24 !== null
    const src = {
      build: (at) => parseMetNo(body, at, src.rainPast24),
      last: Number.isFinite(modified) && modified <= now ? modified : now,
      // (the server says when it will have a new answer; the box does not ask before)
      next: Number.isFinite(expires) && expires > now ? expires : now + HALF_HOUR_MS,
      zone: extras.zone,
      rainPast24: extras.rainPast24,
      rhythm: 'half',
      // (Open-Meteo did not answer: the zone and the rain of the last 24 hours are asked again soon - not the weather server)
      retryAt: undefined,
      retry: async () => {
        const again = await extrasOf(lat, lon)
        src.zone = again.zone ?? src.zone
        src.rainPast24 = again.rainPast24 ?? src.rainPast24
        src.retryAt = complete() ? undefined : Date.now() + 2 * MIN_CACHE_MS
      },
    }
    src.retryAt = complete() ? undefined : now + 2 * MIN_CACHE_MS
    return src
  },
}

exports.activate = (host) => {
  const cache = new Map() // provider:lat:lon -> { at (the last try), src, pending }

  async function current(provider, lat, lon) {
    const key = `${provider}:${lat}:${lon}`
    const entry = cache.get(key)
    const now = Date.now()
    // (the last answer holds until the server has a new one; when it is due and not there yet, one try a minute)
    if (entry?.src && (now < entry.src.next || now - entry.at < MIN_CACHE_MS)) {
      // (a part that was missing is asked for again, once, without a new question to the weather server)
      if (entry.src.retry && now >= entry.src.retryAt && !entry.src.retrying) {
        entry.src.retrying = true
        await entry.src.retry().finally(() => (entry.src.retrying = false))
      }
      return entry.src
    }
    // (several displays or a quick second tap: one request)
    if (entry?.pending) return entry.pending
    const pending = SOURCES[provider](lat, lon).then(
      (src) => {
        cache.set(key, { at: Date.now(), src })
        return src
      },
      (error) => {
        // (the server does not answer: the last values are better than none)
        if (entry?.src) {
          cache.set(key, { at: Date.now(), src: entry.src })
          return { ...entry.src, stale: true }
        }
        cache.delete(key)
        throw error
      },
    )
    cache.set(key, { at: entry?.at ?? 0, src: entry?.src, pending })
    return pending
  }

  /** The texts about the times of an answer: when it came, and when the next one is due (not before now). */
  const timesOf = (src, now) => ({ lastText: clock(src.last, src.zone), nextText: clock(Math.max(src.next, now), src.zone), rhythm: src.rhythm })

  host.route('get', '/data', async (_req, res) => {
    const s = await host.settings()
    const provider = s.provider === 'metno' ? 'metno' : 'openmeteo'
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) {
      res.set('Cache-Control', 'no-store').json({ configured: false })
      return
    }
    try {
      const src = await current(provider, s.lat, s.lon)
      const now = Date.now()
      const times = timesOf(src, now)
      res.set('Cache-Control', 'no-store').json({ configured: true, provider, place: s.placeName || '', stale: src.stale, ...src.build(now), timeText: times.lastText, ...times })
    } catch (error) {
      host.log.warn(`[Extension weather] ${provider}: ${error}`)
      res.status(502).set('Cache-Control', 'no-store').json({ configured: true, error: 'no answer from the weather server' })
    }
  })

  // The button "Änderungen übernehmen" of the settings page: the settings of the look are saved without a reload of the display (they are
  // `quiet`), so that several can be changed one after the other; this loads the display's page again - and the display opens the
  // weather page again when it has loaded (it asks /reopen for that).
  let reopenUntil = 0
  host.route('post', '/apply', async (_req, res) => {
    reopenUntil = Date.now() + 2 * 60 * 1000
    try {
      const answer = await fetch('http://127.0.0.1:5005/display/reload-page', { method: 'POST', signal: AbortSignal.timeout(5000) })
      res.json(answer.ok ? { ok: true, message: 'Das Display lädt neu' } : { ok: false, message: 'Das Display ist nicht erreichbar' })
    } catch {
      res.json({ ok: false, message: 'Das Display ist nicht erreichbar' })
    }
  })
  host.route('get', '/reopen', (_req, res) => {
    const open = Date.now() < reopenUntil
    reopenUntil = 0
    res.set('Cache-Control', 'no-store').json({ open })
  })

  // The lines of the settings page: how the server delivers and when (the status block of the page asks for them)
  host.route('get', '/state', async (_req, res) => {
    const s = await host.settings()
    const provider = s.provider === 'metno' ? 'metno' : 'openmeteo'
    res.set('Cache-Control', 'no-store')
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) {
      res.json({ rows: [{ label: 'Ort', value: 'Kein Ort gewählt', tone: 'warn' }] })
      return
    }
    const rows = [{ label: 'Neue Werte', value: provider === 'metno' ? 'Etwa alle 30 Minuten' : 'Alle 15 Minuten' }]
    try {
      const times = timesOf(await current(provider, s.lat, s.lon), Date.now())
      rows.push({ label: 'Letzte Aktualisierung', value: times.lastText, tone: 'ok' }, { label: 'Nächste Aktualisierung', value: times.nextText })
    } catch (error) {
      host.log.warn(`[Extension weather] ${provider}: ${error}`)
      rows.push({ label: 'Wetterserver', value: 'Keine Antwort', tone: 'warn' })
    }
    res.json({ rows })
  })

  host.route('get', '/places', async (req, res) => {
    const q = String(req.query.q ?? '').trim().slice(0, 80)
    if (q.length < 2) {
      res.json([])
      return
    }
    try {
      const body = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=10&language=de&format=json`)
      res.json((Array.isArray(body?.results) ? body.results : []).filter((r) => Number.isFinite(r?.latitude) && Number.isFinite(r?.longitude)).map(placeOf))
    } catch (error) {
      host.log.warn(`[Extension weather] place search: ${error}`)
      res.status(502).json({ error: 'search failed' })
    }
  })
}

exports._test = { parseOpenMeteo, parseMetNo, circularMean, placeOf, trendOf, lerp, lerpDir, clock, SOURCES }
