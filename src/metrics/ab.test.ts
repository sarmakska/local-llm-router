import { describe, it, expect } from 'vitest'
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
