import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { loadPolicy } from './config/loader.js'
import { decide } from './routing/decision.js'
import { classify } from './routing/classifier.js'
import { runBackend } from './backends/registry.js'
import { record } from './metrics/collector.js'

const app = new Hono()
const policy = loadPolicy(process.env.LLR_POLICY || './policy.yaml')

app.get('/health', (c) => c.json({ ok: true, version: '1.0.0', backends: Object.keys(policy.backends) }))

app.get('/v1/models', (c) =>
  c.json({
    object: 'list',
    data: Object.keys(policy.backends).map((id) => ({
      id,
      object: 'model',
      owned_by: policy.backends[id].type,
    })),
  }),
)

app.post('/v1/chat/completions', async (c) => {
  const body = await c.req.json()
  const sensitivity = c.req.header('x-llr-sensitivity') || 'normal'

  const classification = classify(body, sensitivity)
  const decision = decide(classification, policy)

  const start = Date.now()
  try {
    const result = await runBackend(decision.backend, policy.backends[decision.backend], body)
    record({ backend: decision.backend, latency: Date.now() - start, ok: true })
    return c.json(result)
  } catch (err) {
    record({ backend: decision.backend, latency: Date.now() - start, ok: false, error: String(err) })
    if (decision.fallback) {
      const fb = await runBackend(decision.fallback, policy.backends[decision.fallback], body)
      record({ backend: decision.fallback, latency: Date.now() - start, ok: true, fallbackFor: decision.backend })
      return c.json(fb)
    }
    return c.json({ error: { message: String(err), code: 'backend_failed' } }, 502)
  }
})

const port = Number(process.env.LLR_PORT || 3030)
serve({ fetch: app.fetch, port }, () => {
  console.log(`local-llm-router listening on http://localhost:${port}`)
  console.log(`Policy: ${process.env.LLR_POLICY || './policy.yaml'}`)
  console.log(`Backends: ${Object.keys(policy.backends).join(', ')}`)
})
