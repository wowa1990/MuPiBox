// NODE_ENV=test npx tsx --test src/extensions-quiet.spec.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.NODE_ENV = 'test'

describe('a quiet setting (hostApi 19): saving it does not load the display again', () => {
  it('the manifest: from hostApi 19, with a display part, and only true', async () => {
    const ext = await import('./app-api/extensions')
    const files = new Set<string>(['display.js'])
    const base = (settings: Record<string, unknown>, hostApi = 19, withDisplay = true) => ({ id: 'look', name: 'Look', version: '1.0.0', hostApi, resources: {}, ...(withDisplay ? { display: 'display.js' } : {}), settings })
    assert.equal(ext.checkManifest(base({ frame: { type: 'string', default: 'a', options: ['a', 'b'], quiet: true } }), files), null)
    assert.ok(ext.checkManifest(base({ frame: { type: 'string', default: 'a', options: ['a', 'b'], quiet: true } }, 18), files))
    assert.ok(ext.checkManifest(base({ frame: { type: 'string', default: 'a', options: ['a', 'b'], quiet: true } }, 19, false), files))
    assert.ok(ext.checkManifest(base({ frame: { type: 'string', default: 'a', options: ['a', 'b'], quiet: 'yes' } }), files))
    assert.equal(ext.HOST_API >= 19, true)
  })
})
