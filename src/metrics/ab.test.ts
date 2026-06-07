import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { abConfig, pickShadow, type AbConfig } from './ab.js'
import type { Policy } from '../config/loader.js'

const policy: Policy = {
  backends: {
    local: { type: 'ollama', endpoint: 'http://localhost:11434' } as any,
    sarmalink: { type: 'sarmalink', endpoint: 'http://x', model: 'smart' } as any,
  },
  routes: [{ default: 'local' } as any],
  ab: { enabled: true, sampleRate: 0.5, candidates: { local: 'sarmalink' } },
}

let record: typeof import('./collector.js').record
let report: typeof import('./ab.js').report

beforeAll(async () => {
  process.env.LLR_DB = join(mkdtempSync(join(tmpdir(), 'llr-ab-')), 'metrics.db')
  record = (await import('./collector.js')).record
  report = (await import('./ab.js')).report
})

describe('rolling A/B', () => {
  it('reads config with defaults when ab is absent', () => {
    const cfg = abConfig({ backends: {}, routes: [] } as any)
    expect(cfg.enabled).toBe(false)
    expect(cfg.sampleRate).toBe(0.05)
  })

  it('never samples when disabled', () => {
    const cfg: AbConfig = { enabled: false, sampleRate: 1, candidates: { local: 'sarmalink' } }
    expect(pickShadow(cfg, 'local', () => 0)).toBeUndefined()
  })

  it('samples the candidate when the dice fall under the rate', () => {
    const cfg = abConfig(policy)
    expect(pickShadow(cfg, 'local', () => 0.1)).toBe('sarmalink')
    expect(pickShadow(cfg, 'local', () => 0.9)).toBeUndefined()
  })

  it('returns nothing for a backend with no candidate', () => {
    const cfg = abConfig(policy)
    expect(pickShadow(cfg, 'sarmalink', () => 0)).toBeUndefined()
  })
})

describe('tail-aware A/B report', () => {
  it('reports insufficient-data until the candidate has enough samples', () => {
    // 'fresh' primary against an untouched candidate.
    for (let i = 0; i < 30; i++) record({ backend: 'p_fresh', latency: 100, ok: true })
    const p: Policy = {
      ...policy,
      ab: { enabled: true, sampleRate: 0.5, candidates: { p_fresh: 'c_fresh' } },
    }
    const row = report(p)[0]
    expect(row.recommendation).toBe('insufficient-data')
    expect(row.candidateSamples).toBe(0)
  })

  it('holds a candidate that wins on average but loses on the tail', () => {
    // Primary: tight, consistent latency. Median and tail both ~100ms.
    for (let i = 0; i < 30; i++) record({ backend: 'p_tail', latency: 100, ok: true })
    // Candidate: mostly faster (lower average) but a heavy tail above the
    // primary. avg = (28*40 + 2*300)/30 = 57.3ms < 100ms, while p95 lands on
    // the 300ms outlier, above the primary's flat 100ms tail.
    for (let i = 0; i < 28; i++) record({ backend: 'c_tail', latency: 40, ok: true })
    for (let i = 0; i < 2; i++) record({ backend: 'c_tail', latency: 300, ok: true })
    const p: Policy = {
      ...policy,
      ab: { enabled: true, sampleRate: 0.5, candidates: { p_tail: 'c_tail' } },
    }
    const row = report(p)[0]
    expect(row.candidateAvgLatency!).toBeLessThan(row.primaryAvgLatency!)
    expect(row.candidateP95Latency!).toBeGreaterThan(row.primaryP95Latency!)
    expect(row.recommendation).toBe('hold')
  })

  it('promotes a candidate that wins on average and on the tail', () => {
    for (let i = 0; i < 30; i++) record({ backend: 'p_win', latency: 200, ok: true })
    for (let i = 0; i < 30; i++) record({ backend: 'c_win', latency: 80, ok: true })
    const p: Policy = {
      ...policy,
      ab: { enabled: true, sampleRate: 0.5, candidates: { p_win: 'c_win' } },
    }
    const row = report(p)[0]
    expect(row.candidateAvgLatency!).toBeLessThan(row.primaryAvgLatency!)
    expect(row.candidateP95Latency!).toBeLessThanOrEqual(row.primaryP95Latency!)
    expect(row.recommendation).toBe('promote')
  })
})
