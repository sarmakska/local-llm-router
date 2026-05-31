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

  it('routes short code requests to local qwen-coder with a cloud fallback', () => {
    const c = classify({ messages: [{ role: 'user', content: 'fix this async function' }] }, 'normal')
    expect(c.task).toBe('code')
    expect(c.complexity).toBe('low')
    expect(c.family).toBe('qwen-coder')
    const d = decide(c, policy)
    expect(d.backend).toBe('local')
    expect(d.fallback).toBe('sarmalink')
    expect(d.model).toBe('qwen2.5-coder:7b')
  })

  it('routes web search style requests to the cloud backend', () => {
    const c = classify(
      { messages: [{ role: 'user', content: 'what is the latest news today' }] },
      'normal',
    )
    expect(c.task).toBe('web_search')
    expect(decide(c, policy).backend).toBe('sarmalink')
  })

  it('classifies image prompts as vision and prefers the gemma family', () => {
    const c = classify(
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'what is in this picture' },
              { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
            ],
          },
        ],
      },
      'normal',
    )
    expect(c.modality).toBe('image')
    expect(c.task).toBe('vision')
    expect(c.family).toBe('gemma')
    const d = decide(c, policy)
    expect(d.backend).toBe('local')
    expect(d.model).toBe('gemma3:12b')
  })

  it('resolves the default local route to the llama family when fast enough', () => {
    const c = classify({ messages: [{ role: 'user', content: 'tell me a joke' }] }, 'normal')
    // Force the local backend under the default route budget so it is not shifted.
    const d = decide(c, policy, (b) => (b === 'local' ? 300 : 400))
    expect(d.backend).toBe('local')
    expect(d.fallback).toBe('sarmalink')
    expect(d.model).toBe('llama4:16x17b')
  })

  it('shifts off the local backend when the latency budget is exceeded', () => {
    const c = classify({ messages: [{ role: 'user', content: 'tell me a joke' }] }, 'normal')
    // The default route has a 1200ms budget; local p50 hint is 1800ms.
    const slowLocal = decide(c, policy, (b) => (b === 'local' ? 1800 : 400))
    expect(slowLocal.backend).toBe('sarmalink')
    expect(slowLocal.latencyShifted).toBe(true)
    // When local is fast, it stays local.
    const fastLocal = decide(c, policy, (b) => (b === 'local' ? 300 : 400))
    expect(fastLocal.backend).toBe('local')
    expect(fastLocal.latencyShifted).toBe(false)
  })

  it('does not shift a privacy-pinned route even when slow', () => {
    const c = classify({ messages: [{ role: 'user', content: 'secret' }] }, 'high')
    const d = decide(c, policy, () => 99999)
    expect(d.backend).toBe('local')
  })
})
