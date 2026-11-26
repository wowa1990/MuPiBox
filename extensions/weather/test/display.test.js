// node --test extensions/weather/test/display.test.js
const test = require('node:test')
const assert = require('node:assert/strict')

const load = () => import('../display.js')

const data = { configured: true, provider: 'openmeteo', temperature: 3.3, humidity: 84, windSpeed: 8.3, windGust: 15.5, windDir: 95, windDirAvg: 69, pressure: 1027.2, rainPast24: 0, rainNext24: 3.2, tempMin: 0.1, tempMax: 9.4, humMin: 60, humMax: 90, pressMin: 1025, pressMax: 1028, trend: { temp: 1, hum: 0, press: -1 } }

test('the scales hold the value, wider in steps of ten when needed', async () => {
  const { temperatureScale, pressureScale, pickMax } = await load()
  assert.deepEqual(temperatureScale(3), { min: -20, max: 40 })
  assert.deepEqual(temperatureScale(-31), { min: -40, max: 40 })
  assert.deepEqual(temperatureScale(44), { min: -20, max: 50 })
  assert.deepEqual(pressureScale(1013), { min: 960, max: 1060 })
  assert.deepEqual(pressureScale(940), { min: 930, max: 1060 })
  assert.equal(pickMax(8, [30, 60]), 30)
  assert.equal(pickMax(31, [30, 60]), 60)
  assert.equal(pickMax(99, [30, 60]), 60)
})

test('the temperature scale is coloured in steps of five degrees from blue to red', async () => {
  const { temperatureSections } = await load()
  const sections = temperatureSections(-20, 40)
  assert.equal(sections.length, 12)
  assert.equal(sections[0].start, -20)
  assert.equal(sections.at(-1).stop, 40)
  assert.notEqual(sections[0].color, sections.at(-1).color)
})

test('makes the six dials: no dew point, no rain rate', async () => {
  const { dialsFor } = await load()
  const dials = dialsFor(data)
  assert.deepEqual(dials.map((d) => d.id), ['temp', 'hum', 'wind', 'dir', 'baro', 'rain'])
  const wind = dials.find((d) => d.id === 'wind')
  assert.equal(wind.max, 30)
  // (the red band lies between the wind and the gust)
  assert.deepEqual([wind.areas[0].start, wind.areas[0].stop], [8.3, 15.5])
  assert.match(wind.caption, /15,5/)
  assert.equal(dials.find((d) => d.id === 'temp').trend, 1)
  assert.equal(dials.find((d) => d.id === 'baro').trend, -1)
  // (only temperature, humidity and pressure have the arrows; a steady value is 0, not none)
  assert.deepEqual(dials.map((d) => Number.isFinite(d.trend)), [true, true, false, false, true, false])
  assert.equal(dials.find((d) => d.id === 'hum').trend, 0)
  assert.equal(dials.find((d) => d.id === 'dir').average, 69)
  assert.equal(dials.find((d) => d.id === 'rain').unit, 'mm')
})

test('the rain dial has two displays: the last and the next 24 hours, the pointer shows the last ones', async () => {
  const { dialsFor } = await load()
  const rain = dialsFor({ ...data, rainPast24: 6.4, rainNext24: 12.3 }).find((d) => d.id === 'rain')
  assert.deepEqual(rain.lcds, [{ title: 'last 24h', text: '6,4' }, { title: 'next 24h', text: '12,3' }])
  assert.equal(rain.caption, 'Regenmenge in mm')
  assert.equal(rain.value, 6.4)
  // (the scale holds the larger of the two)
  assert.equal(rain.max, 25)
  // (the last 24 hours are not known - MET Norway without Open-Meteo: a dash, and the pointer shows the next ones)
  const unknown = dialsFor({ ...data, rainPast24: null, rainNext24: 3.2 }).find((d) => d.id === 'rain')
  assert.deepEqual(unknown.lcds.map((l) => l.text), ['–', '3,2'])
  assert.equal(unknown.value, 3.2)
})

test('copes with missing values', async () => {
  const { dialsFor } = await load()
  const dials = dialsFor({ temperature: 5, humidity: null, windSpeed: null, windGust: null, windDir: null, windDirAvg: null, pressure: null, rain24: null })
  assert.equal(dials.length, 6)
  assert.deepEqual(dials.find((d) => d.id === 'wind').areas, [])
})

test('the open page asks the box every minute', async () => {
  const { REFRESH_MS } = await load()
  assert.equal(REFRESH_MS, 60000)
})

test('the units come from the settings; an unknown one is the default', async () => {
  const { unitsOf } = await load()
  assert.deepEqual(unitsOf({}), { temp: 'c', rain: 'mm', press: 'hpa', wind: 'kmh' })
  assert.deepEqual(unitsOf({ tempUnit: 'f', rainUnit: 'inch', pressUnit: 'inhg', windUnit: 'kn' }), { temp: 'f', rain: 'inch', press: 'inhg', wind: 'kn' })
  assert.deepEqual(unitsOf({ tempUnit: 'k', windUnit: 'constructor' }), { temp: 'c', rain: 'mm', press: 'hpa', wind: 'kmh' })
})

test('counts the values over to the chosen units and fits the scales', async () => {
  const { dialsFor, unitsOf } = await load()
  const dials = dialsFor(data, unitsOf({ tempUnit: 'f', rainUnit: 'inch', pressUnit: 'inhg', windUnit: 'mph' }))
  const by = (id) => dials.find((d) => d.id === id)
  // 3.3 °C = 37.94 °F; the scale -20 - 100 °F
  assert.ok(Math.abs(by('temp').value - 37.94) < 0.01)
  assert.equal(by('temp').unit, '°F')
  assert.deepEqual([by('temp').min, by('temp').max], [-20, 100])
  assert.ok(Math.abs(by('temp').minMeasured - 32.18) < 0.01)
  // 1027.2 hPa = 30.33 inHg, the scale 28 - 31.5; the red ends at 975 and 1045 hPa
  assert.ok(Math.abs(by('baro').value - 30.33) < 0.01)
  assert.deepEqual([by('baro').min, by('baro').max], [28, 31.5])
  assert.ok(Math.abs(by('baro').areas[0].stop - 28.79) < 0.01)
  assert.equal(by('baro').decimals, 2)
  // 8.3 km/h = 5.16 mph, the gust 15.5 km/h = 9.63 mph, the scale 0 - 20
  assert.ok(Math.abs(by('wind').value - 5.16) < 0.01)
  assert.equal(by('wind').max, 20)
  assert.match(by('wind').caption, /9,6 mph/)
  assert.equal(by('rain').unit, 'inch')
  assert.equal(by('rain').max, 0.5)
})

test('pressure in kPa and mb, wind in m/s and knots', async () => {
  const { dialsFor, unitsOf } = await load()
  const kpa = dialsFor(data, unitsOf({ pressUnit: 'kpa' })).find((d) => d.id === 'baro')
  assert.ok(Math.abs(kpa.value - 102.72) < 0.001)
  assert.deepEqual([kpa.min, kpa.max], [96, 106])
  const mb = dialsFor(data, unitsOf({ pressUnit: 'mb' })).find((d) => d.id === 'baro')
  assert.equal(mb.value, 1027.2)
  assert.equal(mb.unit, 'mb')
  const ms = dialsFor(data, unitsOf({ windUnit: 'ms' })).find((d) => d.id === 'wind')
  assert.ok(Math.abs(ms.value - 2.306) < 0.001)
  assert.equal(ms.max, 10)
  const kn = dialsFor(data, unitsOf({ windUnit: 'kn' })).find((d) => d.id === 'wind')
  assert.equal(kn.unit, 'knots')
})

test('the scale of a pressure outside of the usual one grows in the steps of its unit', async () => {
  const { pressureScale, temperatureScale, temperatureSections } = await load()
  assert.deepEqual(pressureScale(940, 'hpa'), { min: 930, max: 1060 })
  assert.deepEqual(pressureScale(27.5, 'inhg'), { min: 27, max: 31.5 })
  assert.deepEqual(pressureScale(101, 'kpa'), { min: 96, max: 106 })
  assert.deepEqual(temperatureScale(110, 'f'), { min: -20, max: 120 })
  assert.deepEqual(temperatureScale(-30, 'f'), { min: -40, max: 100 })
  // (the colours follow the temperature in °C: 50 °F is 10 °C)
  const f = temperatureSections(-20, 100, 'f')
  assert.equal(f.length, 12)
  assert.equal(f[0].start, -20)
  assert.equal(f.at(-1).stop, 100)
})

test('the dials in the order of the settings; a missing or doubled name does not lose a dial', async () => {
  const { orderDials } = await load()
  const dials = ['temp', 'hum', 'wind', 'dir', 'baro', 'rain'].map((id) => ({ id }))
  const ids = (list) => list.map((d) => d.id).join()
  assert.equal(ids(orderDials(dials, 'rain,baro,dir,wind,hum,temp')), 'rain,baro,dir,wind,hum,temp')
  assert.equal(ids(orderDials(dials, undefined)), 'temp,hum,wind,dir,baro,rain')
  assert.equal(ids(orderDials(dials, 'wind,temp,wind,x')), 'wind,temp,hum,dir,baro,rain')
})

test('the row shows two dials on a narrow page and as many as fit on a wide one, the dials as large as the height allows', async () => {
  const { viewFor } = await load()
  // the 5" display (800 × 480, the page 408 high without the header): two dials, as before
  assert.deepEqual(viewFor(800, 408, 6), { n: 2, size: 332 })
  // a narrow page: two dials as large as the width allows
  assert.deepEqual(viewFor(480, 408, 6), { n: 2, size: 212 })
  // a wide display: more dials side by side, none larger than the height allows
  const wide = viewFor(1920, 408, 6)
  assert.equal(wide.n, 5)
  assert.equal(wide.size, 332)
  assert.ok(wide.n * wide.size + (wide.n - 1) * 24 <= 1920 - 32)
  // everything fits: all six, the dials a little smaller if need be
  const huge = viewFor(2560, 408, 6)
  assert.equal(huge.n, 6)
  assert.ok(huge.n * huge.size + (huge.n - 1) * 24 <= 2560 - 32)
  // never more dials than there are
  assert.equal(viewFor(3840, 408, 4).n, 4)
  // a very small page keeps its least size
  assert.equal(viewFor(100, 100, 6).size, 120)
})

test('the look of the dials comes from the settings, and an unknown value gives the old design', async () => {
  const { designsOf } = await load()
  const ss = {
    FrameDesign: { METAL: 'f-metal', SHINY_METAL: 'f-shiny' },
    BackgroundColor: { BEIGE: 'b-beige', CARBON: 'b-carbon' },
    PointerType: { TYPE1: 'p1', TYPE9: 'p9' },
    ColorDef: { RED: 'c-red', JUG_GREEN: 'c-jug' },
    KnobType: { METAL_KNOB: 'k-metal', STANDARD_KNOB: 'k-std' },
    KnobStyle: { SILVER: 's-silver', BRASS: 's-brass' },
  }
  assert.deepEqual(designsOf(ss, {}), { frameDesign: 'f-metal', backgroundColor: 'b-beige', pointerType: 'p1', pointerColor: 'c-red', knobType: 'k-metal', knobStyle: 's-silver' })
  assert.deepEqual(
    designsOf(ss, { frameDesign: 'shiny_metal', backgroundColor: 'carbon', pointerType: 'type9', pointerColor: 'jug_green', knobType: 'standard_knob', knobStyle: 'brass' }),
    { frameDesign: 'f-shiny', backgroundColor: 'b-carbon', pointerType: 'p9', pointerColor: 'c-jug', knobType: 'k-std', knobStyle: 's-brass' },
  )
  // (a name from the prototype chain is not a design)
  assert.equal(designsOf(ss, { frameDesign: 'constructor' }).frameDesign, 'f-metal')
})

test('every look setting of the manifest names designs the library has', () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'))
  const source = fs.readFileSync(path.join(__dirname, '..', 'steelseries.js'), 'utf8')
  const groups = { frameDesign: 'FrameDesign', backgroundColor: 'BackgroundColor', pointerType: 'PointerType', pointerColor: 'ColorDef', knobType: 'KnobType', knobStyle: 'KnobStyle' }
  for (const [key, group] of Object.entries(groups)) {
    const spec = manifest.settings[key]
    assert.ok(spec.options.includes(spec.default), key)
    for (const option of spec.options) assert.ok(source.includes(option.toUpperCase()), `${group}.${option}`)
    const item = manifest.ui.items.find((i) => i.key === key)
    assert.deepEqual(item.choices.map((c) => c.value), spec.options, key)
  }
})
