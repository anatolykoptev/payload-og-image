/** The dev app's REAL Payload REST route (a real Payload over a throwaway SQLite file), checked by the kit's `restHeadParity`.
 * - dev/app/(payload)/api/[...slug]/route.ts:17  drop `HEAD = withHead(GET)` (or export `HEAD = GET`) -> "REST HEAD parity" RED (Payload answers a HEAD to an upload with 404, payload#16754) */

import { installTestRuntime, ogKit } from 'payload-og-image/testing'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, it, vi } from 'vitest'

// The dev config reads DATABASE_URL when it loads: point it at a throwaway file before any import runs.
await vi.hoisted(async () => {
  const [{ mkdtempSync }, { tmpdir }, path] = await Promise.all([import('node:fs'), import('node:os'), import('node:path')])
  process.env.DATABASE_URL = `file:${path.join(mkdtempSync(path.join(tmpdir(), 'og-dev-rest-')), 'db.sqlite')}`
})

import config from '@payload-config'
import { getPayload, type Payload } from 'payload'
import * as restRoute from '../app/(payload)/api/[...slug]/route.js'
import { ogOptions } from '../src/og/options.js'
import { docs } from './fixtures.js'

const rt = installTestRuntime(ogOptions, docs)
const kit = ogKit(rt)
let payload: Payload
let mediaId: number | string
let url: string

beforeAll(async () => {
  payload = await getPayload({ config })
  const data = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } })
    .png()
    .toBuffer()
  const media = await payload.create({
    collection: 'media',
    data: {},
    file: { data, mimetype: 'image/png', name: 'rest-head.png', size: data.length },
    overrideAccess: true,
  })
  mediaId = media.id
  url = `${rt.serverUrl}/api/media/file/${media.filename}`
}, 60_000)
afterAll(async () => {
  await payload?.delete({ collection: 'media', id: mediaId, overrideAccess: true })
})

describe('dev app REST route', () => {
  it('REST HEAD parity', () => kit.restHeadParity({ module: restRoute, url }))
})
