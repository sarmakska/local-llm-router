import { describe, it, expect } from 'vitest'
import { loadPolicy } from '../config/loader.js'
import { classify } from './classifier.js'
import { decide } from './decision.js'

const policy = loadPolicy('./policy.example.yaml')

describe('router smoke test', () => {
  it('loads and validates the example policy', () => {
    expect(Object.keys(policy.backends)).toEqual(['local', 'sarmalink', 'frontier'])
    expect(policy.routes.length).toBeGreaterThan(0)
  })

  it('pins sensitive requests to the local backend', () => {
    const c = classify({ messages: [{ role: 'user', content: 'patient record summary' }] }, 'high')
    expect(c.sensitivity).toBe('high')
    expect(decide(c, policy).backend).toBe('local')
  })

  it('routes short code requests locally with a cloud fallback', () => {
    const c = classify({ messages: [{ role: 'user', content: 'fix this async function' }] }, 'normal')
    expect(c.task).toBe('code')
    expect(c.complexity).toBe('low')
    const d = decide(c, policy)
    expect(d.backend).toBe('local')
    expect(d.fallback).toBe('sarmalink')
  })

  it('routes web search style requests to the cloud backend', () => {
    const c = classify({ messages: [{ role: 'user', content: 'what is the latest news today' }] }, 'normal')
    expect(c.task).toBe('web_search')
    expect(decide(c, policy).backend).toBe('sarmalink')
  })

  it('falls back to the default route for general traffic', () => {
    const c = classify({ messages: [{ role: 'user', content: 'tell me a joke' }] }, 'normal')
    const d = decide(c, policy)
    expect(d.backend).toBe('sarmalink')
    expect(d.fallback).toBe('frontier')
  })
})
