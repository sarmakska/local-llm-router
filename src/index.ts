import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { loadPolicy } from './config/loader.js'
import { decide, type LatencyProbe } from './routing/decision.js'
import { classify } from './routing/classifier.js'
import { runBackend, type BackendResult } from './backends/registry.js'
import { record, summary, prometheus, p50Latency, sanitiseHours } from './metrics/collector.js'
import { abConfig, pickShadow, runShadow, report } from './metrics/ab.js'
import {
  responsesToChat,
  chatToResponses,
  type ResponsesRequest,
} from './routing/responses.js'

const VERSION = '1.1.0'

const app = new Hono()
const policy = loadPolicy(process.env.LLR_POLICY || './policy.yaml')
const ab = abConfig(policy)

// Live latency signal for the latency-budget decision.
const probe: LatencyProbe = (backend) => p50Latency(backend)

app.get('/health', (c) =>
  c.json({ ok: true, version: VERSION, backends: Object.keys(policy.backends) }),
)

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

/**
 * Stream a backend's SSE body straight back to the client. The router does not
 * reframe chunks: Ollama 0.5 and the cloud backends already emit OpenAI-shaped
 * `data:` events, so a transparent passthrough keeps token latency minimal.
 */
function streamBack(c: any, result: BackendResult, onDone: (ok: boolean) => void) {
  c.header('Content-Type', 'text/event-stream')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')
  return stream(c, async (s) => {
    try {
      const reader = (result.stream as ReadableStream).getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) await s.write(value)
      }
      onDone(true)
    } catch (err) {
      onDone(false)
      await s.write(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ error: { message: String(err), code: 'stream_failed' } })}\n\n`,
        ),
      )
    }
  })
}

async function route(body: any, sensitivity: string) {
  const classification = classify(body, sensitivity)
  const decision = decide(classification, policy, probe)
  return { classification, decision }
}

app.post('/v1/chat/completions', async (c) => {
  const body = await c.req.json()
  const sensitivity = c.req.header('x-llr-sensitivity') || 'normal'
  const { decision } = await route(body, sensitivity)

  const start = Date.now()
  try {
    const result = await runBackend(
      decision.backend,
      policy.backends[decision.backend],
      body,
      decision.model,
    )

    // Fire a shadow A/B candidate on a sample of non-streaming traffic.
    if (!body.stream) {
      const shadow = pickShadow(ab, decision.backend)
      if (shadow) runShadow(policy, shadow, body, undefined)
    }

    if (result.stream) {
      return streamBack(c, result, (ok) =>
        record({ backend: decision.backend, latency: Date.now() - start, ok }),
      )
    }

    record({ backend: decision.backend, latency: Date.now() - start, ok: true })
    return c.json(result.json)
  } catch (err) {
    record({ backend: decision.backend, latency: Date.now() - start, ok: false, error: String(err) })
    if (decision.fallback) {
      try {
        const fb = await runBackend(
          decision.fallback,
          policy.backends[decision.fallback],
          body,
          undefined,
        )
        if (fb.stream) {
          return streamBack(c, fb, (ok) =>
            record({
              backend: decision.fallback!,
              latency: Date.now() - start,
              ok,
              fallbackFor: decision.backend,
            }),
          )
        }
        record({
          backend: decision.fallback,
          latency: Date.now() - start,
          ok: true,
          fallbackFor: decision.backend,
        })
        return c.json(fb.json)
      } catch (fbErr) {
        record({
          backend: decision.fallback,
          latency: Date.now() - start,
          ok: false,
          error: String(fbErr),
          fallbackFor: decision.backend,
        })
        return c.json({ error: { message: String(fbErr), code: 'fallback_failed' } }, 502)
      }
    }
    return c.json({ error: { message: String(err), code: 'backend_failed' } }, 502)
  }
})

/**
 * OpenAI Responses API. Translates the Responses request into chat messages,
 * routes through the same engine and backends, and translates the chat
 * completion back into a Responses envelope. Streaming is passed through as
 * the backend's native SSE for parity with `/v1/chat/completions`.
 */
app.post('/v1/responses', async (c) => {
  const req = (await c.req.json()) as ResponsesRequest
  const sensitivity = c.req.header('x-llr-sensitivity') || 'normal'
  const chatBody = responsesToChat(req)
  const { decision } = await route(chatBody, sensitivity)

  const start = Date.now()
  try {
    const result = await runBackend(
      decision.backend,
      policy.backends[decision.backend],
      chatBody,
      decision.model,
    )
    if (result.stream) {
      return streamBack(c, result, (ok) =>
        record({ backend: decision.backend, latency: Date.now() - start, ok }),
      )
    }
    record({ backend: decision.backend, latency: Date.now() - start, ok: true })
    return c.json(chatToResponses(result.json, result.model))
  } catch (err) {
    record({ backend: decision.backend, latency: Date.now() - start, ok: false, error: String(err) })
    if (decision.fallback) {
      try {
        const fb = await runBackend(
          decision.fallback,
          policy.backends[decision.fallback],
          chatBody,
          undefined,
        )
        record({
          backend: decision.fallback,
          latency: Date.now() - start,
          ok: true,
          fallbackFor: decision.backend,
        })
        return c.json(chatToResponses(fb.json, fb.model))
      } catch (fbErr) {
        return c.json({ error: { message: String(fbErr), code: 'fallback_failed' } }, 502)
      }
    }
    return c.json({ error: { message: String(err), code: 'backend_failed' } }, 502)
  }
})

// JSON metrics summary over the last N hours (default 24). The window is
// sanitised so a malformed or hostile `hours` param cannot poison the query.
app.get('/v1/metrics', (c) => {
  const hours = sanitiseHours(c.req.query('hours'))
  return c.json({ window_hours: hours, backends: summary(hours) })
})

// Rolling A/B report: which candidate backends are ready to promote.
app.get('/v1/ab', (c) => {
  const hours = sanitiseHours(c.req.query('hours'))
  return c.json({ enabled: ab.enabled, window_hours: hours, pairs: report(policy, hours) })
})

// Prometheus text exposition.
app.get('/metrics', (c) => {
  const hours = sanitiseHours(c.req.query('hours'))
  return c.text(prometheus(hours), 200, { 'Content-Type': 'text/plain; version=0.0.4' })
})

export { app }

if (process.env.LLR_NO_LISTEN !== '1') {
  const port = Number(process.env.LLR_PORT || 3030)
  serve({ fetch: app.fetch, port }, () => {
    console.log(`local-llm-router ${VERSION} listening on http://localhost:${port}`)
    console.log(`Policy: ${process.env.LLR_POLICY || './policy.yaml'}`)
    console.log(`Backends: ${Object.keys(policy.backends).join(', ')}`)
    if (ab.enabled) console.log(`Rolling A/B enabled at ${ab.sampleRate * 100}% sample rate`)
  })
}
