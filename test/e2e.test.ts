import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Hono } from 'hono'

/**
 * End-to-end test of the full request flow. We stand up a mock upstream that
 * speaks the OpenAI-compatible surface (both buffered JSON and SSE streaming),
 * point a real policy at it, boot the actual router app, and drive it through
 * chat completions, streaming, the Responses API, fallback, and metrics.
 *
 * The mock records which model each backend was asked for so we can assert the
 * family resolution (Qwen 2.5 Coder for code, Llama 4 for general) end to end.
 */

interface Upstream {
  server: Server
  port: number
  requests: Array<{ model: string; stream: boolean }>
  failNext: boolean
}

function startUpstream(label: string): Promise<Upstream> {
  const state: Upstream = { server: null as any, port: 0, requests: [], failNext: false }
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (d) => (raw += d))
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      state.requests.push({ model: body.model, stream: !!body.stream })

      if (state.failNext) {
        state.failNext = false
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: `${label} forced failure` } }))
        return
      }

      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        const chunk = {
          id: 'chatcmpl-1',
          object: 'chat.completion.chunk',
          model: body.model,
          choices: [{ index: 0, delta: { content: `hi from ${label}` }, finish_reason: null }],
        }
        res.write(`data: ${JSON.stringify(chunk)}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
        return
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 1700000000,
          model: body.model,
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: `hello from ${label}` },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
        }),
      )
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      state.server = server
      state.port = typeof addr === 'object' && addr ? addr.port : 0
      resolve(state)
    })
  })
}

let local: Upstream
let cloud: Upstream
let app: Hono
let dir: string

beforeAll(async () => {
  local = await startUpstream('local')
  cloud = await startUpstream('cloud')

  // Build a policy pointing at the live mock ports.
  const base = readFileSync(join(__dirname, 'fixtures', 'policy.e2e.yaml'), 'utf-8')
  const policyText = base
    .replace('endpoint: http://127.0.0.1:0\n    families', `endpoint: http://127.0.0.1:${local.port}\n    families`)
    .replace('endpoint: http://127.0.0.1:0\n    model: smart', `endpoint: http://127.0.0.1:${cloud.port}\n    model: smart`)

  dir = mkdtempSync(join(tmpdir(), 'llr-e2e-'))
  const policyPath = join(dir, 'policy.yaml')
  writeFileSync(policyPath, policyText)

  process.env.LLR_POLICY = policyPath
  process.env.LLR_DB = join(dir, 'metrics.db')
  process.env.LLR_NO_LISTEN = '1'
  process.env.SARMALINK_API_KEY = 'test'
  process.env.OPENAI_API_KEY = 'test'

  app = (await import('../src/index.js')).app
})

afterAll(() => {
  local?.server.close()
  cloud?.server.close()
})

describe('e2e: chat completions', () => {
  it('reports health with the backends from the policy', async () => {
    const res = await app.request('/health')
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(json.backends).toContain('local')
    expect(json.backends).toContain('sarmalink')
  })

  it('routes a code request to the local backend with the qwen-coder model', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'auto',
        messages: [{ role: 'user', content: 'fix this async function please' }],
      }),
    })
    const json = await res.json()
    expect(json.choices[0].message.content).toBe('hello from local')
    expect(local.requests.at(-1)?.model).toBe('qwen2.5-coder:7b')
  })

  it('routes general traffic to the cloud default backend', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'auto',
        messages: [{ role: 'user', content: 'tell me a joke' }],
      }),
    })
    const json = await res.json()
    expect(json.choices[0].message.content).toBe('hello from cloud')
    expect(cloud.requests.at(-1)?.model).toBe('smart')
  })

  it('pins a sensitive request to the local backend', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-LLR-Sensitivity': 'high' },
      body: JSON.stringify({
        model: 'auto',
        messages: [{ role: 'user', content: 'confidential board notes' }],
      }),
    })
    const json = await res.json()
    expect(json.choices[0].message.content).toBe('hello from local')
  })

  it('falls back to the secondary backend when the primary fails', async () => {
    // Code request routes local-first with sarmalink fallback; force local to fail.
    local.failNext = true
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'auto',
        messages: [{ role: 'user', content: 'debug this function const x = 1' }],
      }),
    })
    const json = await res.json()
    expect(json.choices[0].message.content).toBe('hello from cloud')
  })
})

describe('e2e: streaming', () => {
  it('streams SSE chunks straight through', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'auto',
        stream: true,
        messages: [{ role: 'user', content: 'tell me a joke' }],
      }),
    })
    expect(res.headers.get('Content-Type')).toContain('text/event-stream')
    const text = await res.text()
    expect(text).toContain('hi from cloud')
    expect(text).toContain('[DONE]')
  })
})

describe('e2e: responses API', () => {
  it('accepts a Responses request and returns a Responses envelope', async () => {
    const res = await app.request('/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'auto', input: 'tell me a joke' }),
    })
    const json = await res.json()
    expect(json.object).toBe('response')
    expect(json.status).toBe('completed')
    expect(json.output_text).toBe('hello from cloud')
    expect(json.output[0].content[0].type).toBe('output_text')
    expect(json.usage.input_tokens).toBe(5)
  })

  it('honours instructions and structured input parts', async () => {
    const res = await app.request('/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'auto',
        instructions: 'you are terse',
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'fix this function' }] }],
      }),
    })
    const json = await res.json()
    expect(json.object).toBe('response')
    // Code routes local-first to qwen-coder.
    expect(local.requests.at(-1)?.model).toBe('qwen2.5-coder:7b')
  })
})

describe('e2e: metrics', () => {
  it('exposes a JSON metrics summary', async () => {
    const res = await app.request('/v1/metrics')
    const json = await res.json()
    expect(Array.isArray(json.backends)).toBe(true)
    const total = json.backends.reduce((n: number, b: any) => n + b.calls, 0)
    expect(total).toBeGreaterThan(0)
  })

  it('exposes Prometheus text exposition', async () => {
    const res = await app.request('/metrics')
    const text = await res.text()
    expect(text).toContain('llr_backend_calls_total')
  })
})
