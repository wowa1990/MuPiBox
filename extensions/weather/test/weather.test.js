// node --test extensions/weather/test/weather.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const { _test } = require('../api.js')

test('the mean of directions goes around the north', () => {
  assert.equal(_test.circularMean([350, 10]), 0)
  assert.equal(_test.circularMean([90, 90, 90]), 90)
  assert.equal(_test.circularMean([]), null)
  assert.equal(_test.circularMean([0, 180]), null)
})

test('reads an answer of Open-Meteo', () => {
  const hours = Array.from({ length: 25 }, (_, i) => `2026-11-07T${String(i % 24).padStart(2, '0')}:00`)
  // 24 hours back from 01:00 and the hour ahead: here simply 25 hourly entries, the last two of them after "now"
  const body = {
    current: { time: '2026-11-07T01:45', temperature_2m: -11.6, relative_humidity_2m: 56, pressure_msl: 1012.4, wind_speed_10m: 5.6, wind_direction_10m: 11, wind_gusts_10m: 12.2 },
    hourly: {
      time: ['2026-11-06T23:00', '2026-11-07T00:00', '2026-11-07T01:00', '2026-11-07T02:00'],
      temperature_2m: [-10, -11, -11.5, -12],
      relative_humidity_2m: [50, 52, 54, 56],
      pressure_msl: [1010, 1011, 1012, 1013],
      precipitation: [0.5, 0.25, 0, 3],
      wind_direction_10m: [350, 10, 20, 90],
    },
  }
  assert.equal(hours.length, 25)
  const r = _test.parseOpenMeteo(body)
  assert.equal(r.timeText, '01:45')
  assert.equal(r.temperature, -11.6)
  assert.equal(r.humidity, 56)
  assert.equal(r.windSpeed, 5.6)
  assert.equal(r.windGust, 12.2)
  assert.equal(r.pressure, 1012.4)
  // (the hour after 01:xx is not counted in the last 24 hours, it is the first of the next ones)
  assert.equal(r.rainPast24, 0.8)
  assert.equal(r.rainNext24, 3)
  assert.equal(r.tempMin, -11.6)
  assert.equal(r.tempMax, -10)
  assert.equal(r.windDirAvg, 7)
  assert.equal(r.humMin, 50)
  assert.equal(r.humMax, 56)
  assert.equal(r.pressMin, 1010)
  assert.equal(r.pressMax, 1012.4)
  // (three hours ago: only three hours are in the answer before now, so the trend is against the first)
  assert.deepEqual(r.trend, { temp: -1, hum: 1, press: 1 })
})

test('tells a trend from a small change', () => {
  assert.equal(_test.trendOf(1012.4, 1011, 1), 1)
  assert.equal(_test.trendOf(1011.4, 1012, 1), 0)
  assert.equal(_test.trendOf(5, 7, 1), -1)
  assert.equal(_test.trendOf(5, undefined, 1), 0)
})

test('reads an answer of MET Norway (m/s become km/h, the rain is the forecast)', () => {
  const entry = (hour, t, rain) => ({
    time: `2026-11-07T${String(hour).padStart(2, '0')}:00:00Z`,
    data: { instant: { details: { air_temperature: t, relative_humidity: 80, wind_speed: 5, wind_speed_of_gust: 10, wind_from_direction: 270, air_pressure_at_sea_level: 1000 } }, next_1_hours: { details: { precipitation_amount: rain } } },
  })
  const r = _test.parseMetNo({ properties: { timeseries: [entry(0, 4, 0.5), entry(1, 3, 0.25), entry(2, 2, 0)] } }, Date.parse('2026-11-07T00:00:00Z'))
  assert.equal(r.temperature, 4)
  assert.equal(r.windSpeed, 18)
  assert.equal(r.windGust, 36)
  assert.equal(r.windDir, 270)
  assert.equal(r.rainNext24, 0.8)
  assert.equal(r.rainPast24, null)
  assert.equal(_test.parseMetNo({ properties: { timeseries: [entry(0, 4, 0.5)] } }, 0, 7.25).rainPast24, 7.3)
  assert.equal(r.tempMin, 2)
  assert.equal(r.tempMax, 4)
})

test('refuses an answer without values', () => {
  assert.throws(() => _test.parseOpenMeteo({}))
  assert.throws(() => _test.parseMetNo({ properties: { timeseries: [] } }))
})

test('lists a place with its name and position', () => {
  const p = _test.placeOf({ name: 'Wien', admin1: 'Wien', country: 'Österreich', latitude: 48.20849, longitude: 16.37208 })
  assert.deepEqual(p.values, { placeName: 'Wien, Österreich', lat: 48.2085, lon: 16.3721 })
  assert.match(p.label, /Wien, Österreich/)
})

test('MET Norway: the values are counted over to the minute between two hours', () => {
  const entry = (hour, t, dir) => ({
    time: `2026-11-07T${String(hour).padStart(2, '0')}:00:00Z`,
    data: { instant: { details: { air_temperature: t, relative_humidity: 80, wind_speed: 5, wind_speed_of_gust: 10, wind_from_direction: dir, air_pressure_at_sea_level: 1000 } }, next_1_hours: { details: { precipitation_amount: 0 } } },
  })
  const body = { properties: { timeseries: [entry(0, 4, 350), entry(1, 2, 10), entry(2, 0, 10)] } }
  // (half way between 00:00 and 01:00)
  const half = _test.parseMetNo(body, Date.parse('2026-11-07T00:30:00Z'))
  assert.equal(half.temperature, 3)
  assert.equal(half.windDir, 0)
  // (a quarter of the way)
  assert.equal(_test.parseMetNo(body, Date.parse('2026-11-07T00:15:00Z')).temperature, 3.5)
  // (on the hour, and before the first and after the last hour)
  assert.equal(_test.parseMetNo(body, Date.parse('2026-11-07T01:00:00Z')).temperature, 2)
  assert.equal(_test.parseMetNo(body, Date.parse('2026-11-06T22:00:00Z')).temperature, 4)
  assert.equal(_test.parseMetNo(body, Date.parse('2026-11-07T05:00:00Z')).temperature, 0)
})

test('values and directions between two others', () => {
  assert.equal(_test.lerp(0, 10, 0.25), 2.5)
  assert.equal(_test.lerp(NaN, 10, 0.5), 10)
  assert.equal(_test.lerp(4, undefined, 0.5), 4)
  assert.equal(_test.lerpDir(350, 10, 0.5), 0)
  assert.equal(_test.lerpDir(10, 350, 0.5), 0)
  assert.equal(_test.lerpDir(90, 180, 0.5), 135)
})

test('the time of day is shown in the time zone of the place', () => {
  const moment = Date.UTC(2026, 10, 26, 21, 0)
  assert.equal(_test.clock(moment, 'Europe/Stockholm'), '22:00')
  assert.equal(_test.clock(moment, 'UTC'), '21:00')
  assert.equal(_test.clock(moment, 'Asia/Kolkata'), '02:30')
  // (a zone nobody knows does not break the answer)
  assert.match(_test.clock(moment, 'Not/AZone'), /^\d\d:\d\d$/)
})

test('asks the weather server again only when its answer has run out, and answers with the times of it', async (t) => {
  const entry = (hour, temp) => ({
    time: `2026-11-07T${String(hour).padStart(2, '0')}:00:00Z`,
    data: { instant: { details: { air_temperature: temp, relative_humidity: 80, wind_speed: 5, wind_speed_of_gust: 10, wind_from_direction: 270, air_pressure_at_sea_level: 1000 } }, next_1_hours: { details: { precipitation_amount: 0 } } },
  })
  const body = { properties: { timeseries: [entry(10, 4), entry(11, 2), entry(12, 0)] } }
  let clockNow = Date.parse('2026-11-07T10:00:00Z')
  t.mock.method(Date, 'now', () => clockNow)
  let met = 0
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('open-meteo')) return new Response(JSON.stringify({ timezone: 'Europe/Stockholm', current: { time: '2026-11-07T10:00' }, hourly: { time: ['2026-11-07T10:00'], precipitation: [0] } }), { status: 200 })
    met++
    const headers = { 'Last-Modified': new Date(clockNow).toUTCString(), Expires: new Date(clockNow + 30 * 60 * 1000).toUTCString() }
    return new Response(JSON.stringify(body), { status: 200, headers })
  })
  const routes = {}
  require('../api.js').activate({ route: (_method, path, handler) => (routes[path] = handler), settings: async () => ({ provider: 'metno', lat: 58.2, lon: 14.6, placeName: 'X' }), log: { warn() {} } })
  const ask = async (path = '/data') => {
    let out
    await routes[path]({}, { set() { return this }, status() { return this }, json: (v) => (out = v) })
    return out
  }
  let r = await ask()
  assert.equal(met, 1)
  assert.equal(r.temperature, 4)
  // (in Sweden it is an hour later than in UTC)
  assert.equal(r.lastText, '11:00')
  assert.equal(r.nextText, '11:30')
  assert.equal(r.rhythm, 'half')
  // (ten minutes later: no new request, the values are counted over to the minute)
  clockNow += 30 * 60 * 1000 - 1000
  r = await ask()
  assert.equal(met, 1)
  assert.equal(r.temperature, 3)
  // (the answer has run out: a new one)
  clockNow += 2000
  r = await ask()
  assert.equal(met, 2)
  assert.equal(r.lastText, '11:30')
  // (the lines of the settings page)
  const state = await ask('/state')
  assert.deepEqual(state.rows.map((row) => [row.label, row.value]), [['Neue Werte', 'Etwa alle 30 Minuten'], ['Letzte Aktualisierung', '11:30'], ['Nächste Aktualisierung', '12:00']])
  assert.equal(met, 2)
})

test('Open-Meteo: the values come in quarters of an hour', async (t) => {
  const body = {
    timezone: 'Europe/Stockholm',
    utc_offset_seconds: 3600,
    current: { time: '2026-11-07T11:15', interval: 900, temperature_2m: 1, relative_humidity_2m: 50, pressure_msl: 1000, wind_speed_10m: 1, wind_direction_10m: 10, wind_gusts_10m: 2 },
    hourly: { time: ['2026-11-07T10:00', '2026-11-07T11:00'], temperature_2m: [1, 1], relative_humidity_2m: [50, 50], pressure_msl: [1000, 1000], precipitation: [0, 0], wind_direction_10m: [10, 10] },
  }
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status: 200 }))
  const src = await _test.SOURCES.openmeteo(58.2, 14.6)
  assert.equal(new Date(src.last).toISOString(), '2026-11-07T10:15:00.000Z')
  assert.equal(new Date(src.next).toISOString(), '2026-11-07T10:30:00.000Z')
  assert.equal(src.zone, 'Europe/Stockholm')
  assert.equal(src.rhythm, 'quarter')
  assert.equal(_test.clock(src.last, src.zone), '11:15')
})

test('MET Norway has no past: the rain of the last 24 hours and the time zone come from Open-Meteo, and the answer still works without it', async (t) => {
  const entry = (hour, temp) => ({
    time: `2026-11-07T${String(hour).padStart(2, '0')}:00:00Z`,
    data: { instant: { details: { air_temperature: temp, relative_humidity: 80, wind_speed: 5, wind_speed_of_gust: 10, wind_from_direction: 270, air_pressure_at_sea_level: 1000 } }, next_1_hours: { details: { precipitation_amount: 0.5 } } },
  })
  const met = { properties: { timeseries: [entry(10, 4), entry(11, 2)] } }
  const openMeteo = { timezone: 'Europe/Stockholm', current: { time: '2026-11-07T11:00' }, hourly: { time: ['2026-11-07T09:00', '2026-11-07T10:00', '2026-11-07T11:00', '2026-11-07T12:00'], precipitation: [1, 0.5, 0.25, 9] } }
  let openMeteoUp = true
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (!String(url).includes('open-meteo')) return new Response(JSON.stringify(met), { status: 200 })
    if (!openMeteoUp) throw new Error('down')
    return new Response(JSON.stringify(openMeteo), { status: 200 })
  })
  let src = await _test.SOURCES.metno(58.2, 14.6)
  let r = src.build(Date.parse('2026-11-07T10:00:00Z'))
  // (the hour after "now" is not part of the past)
  assert.equal(r.rainPast24, 1.8)
  assert.equal(r.rainNext24, 1)
  assert.equal(src.zone, 'Europe/Stockholm')
  openMeteoUp = false
  src = await _test.SOURCES.metno(58.2, 14.6)
  r = src.build(Date.parse('2026-11-07T10:00:00Z'))
  assert.equal(r.rainPast24, null)
  assert.equal(r.rainNext24, 1)
  // (the zone is kept from the time before)
  assert.equal(src.zone, 'Europe/Stockholm')
})

test('when Open-Meteo did not answer, the zone and the past rain are asked again in two minutes, the weather server is not', async (t) => {
  const entry = (hour, temp) => ({ time: `2026-11-07T${String(hour).padStart(2, '0')}:00:00Z`, data: { instant: { details: { air_temperature: temp } }, next_1_hours: { details: { precipitation_amount: 0 } } } })
  const met = { properties: { timeseries: [entry(10, 4), entry(11, 2)] } }
  let clockNow = Date.parse('2026-11-07T10:00:00Z')
  t.mock.method(Date, 'now', () => clockNow)
  let metCalls = 0
  let openMeteoCalls = 0
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('open-meteo')) {
      openMeteoCalls++
      throw new Error('down')
    }
    metCalls++
    return new Response(JSON.stringify(met), { status: 200, headers: { Expires: new Date(clockNow + 30 * 60 * 1000).toUTCString() } })
  })
  const routes = {}
  require('../api.js').activate({ route: (_m, path, handler) => (routes[path] = handler), settings: async () => ({ provider: 'metno', lat: 1, lon: 2 }), log: { warn() {} } })
  const ask = () => routes['/data']({}, { set() { return this }, status() { return this }, json() {} })
  await ask()
  clockNow += 30 * 1000
  await ask()
  assert.deepEqual([metCalls, openMeteoCalls], [1, 1])
  clockNow += 2 * 60 * 1000
  await ask()
  assert.deepEqual([metCalls, openMeteoCalls], [1, 2])
})
