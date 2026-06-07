import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Unit tests for the metrics collector. The percentile maths and the window
 * sanitiser are pure logic worth pinning down without standing up the full
 * server. We point the collector at a throwaway database so records do not
 * bleed into a developer's live metrics.db.
 */

let sanitiseHours: typeof import('./collector.js').sanitiseHours
let record: typeof import('./collector.js').record
let pLatency: typeof import('./collector.js').pLatency
let p95Latency: typeof import('./collector.js').p95Latency
let summary: typeof import('./collector.js').summary

beforeAll(async () => {
  process.env.LLR_DB = join(mkdtempSync(join(tmpdir(), 'llr-collector-')), 'metrics.db')
  const mod = await import('./collector.js')
  sanitiseHours = mod.sanitiseHours
  record = mod.record
  pLatency = mod.pLatency
  p95Latency = mod.p95Latency
  summary = mod.summary
})

describe('sanitiseHours', () => {
  it('passes a sane positive number through', () => {
    expect(sanitiseHours(12)).toBe(12)
    expect(sanitiseHours('6')).toBe(6)
  })

  it('falls back when the value is not finite', () => {
    expect(sanitiseHours('abc')).toBe(24)
    expect(sanitiseHours(NaN)).toBe(24)
    expect(sanitiseHours(undefined)).toBe(24)
    expect(sanitiseHours(Infinity)).toBe(24)
  })

  it('falls back on a zero or negative window rather than querying the future', () => {
    expect(sanitiseHours(0)).toBe(24)
    expect(sanitiseHours(-5)).toBe(24)
  })

  it('honours a custom fallback', () => {
    expect(sanitiseHours('nope', 1)).toBe(1)
  })

  it('caps the window at one year so a single request cannot scan everything', () => {
    expect(sanitiseHours(1e9)).toBe(24 * 365)
  })
})

describe('percentile latency', () => {
  it('returns undefined below the minimum sample count', () => {
    record({ backend: 'sparse', latency: 10, ok: true })
    record({ backend: 'sparse', latency: 20, ok: true })
    expect(pLatency('sparse', 0.5)).toBeUndefined()
  })

  it('computes a median and a tail from the same window', () => {
    for (const ms of [10, 20, 30, 40, 50, 60, 70, 80, 90, 1000]) {
      record({ backend: 'dense', latency: ms, ok: true })
    }
    const p50 = pLatency('dense', 0.5)
    const p95 = p95Latency('dense')
    expect(p50).toBeDefined()
    expect(p95).toBeDefined()
    // The tail must sit at or above the median, and the outlier should pull p95 up.
    expect(p95!).toBeGreaterThanOrEqual(p50!)
    expect(p95!).toBe(1000)
  })

  it('ignores failed calls when computing percentiles', () => {
    for (let i = 0; i < 10; i++) record({ backend: 'mixed', latency: 5, ok: true })
    for (let i = 0; i < 10; i++) record({ backend: 'mixed', latency: 9999, ok: false })
    expect(p95Latency('mixed')).toBe(5)
  })

  it('records and summarises a backend', () => {
    const rows = summary(24)
    const dense = rows.find((r) => r.backend === 'dense')
    expect(dense?.calls).toBe(10)
    expect(dense?.successes).toBe(10)
  })
})
