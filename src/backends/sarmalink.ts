import type { BackendResult } from './registry.js'

/**
 * SarmaLink-AI hosted backend. OpenAI-compatible, so streaming, tool calls and
 * JSON mode all pass through unchanged. Streams when `stream: true`.
 */
export async function runSarmalink(config: any, body: any, model?: string): Promise<BackendResult> {
  const apiKey = process.env.SARMALINK_API_KEY
  if (!apiKey) throw new Error('SARMALINK_API_KEY not set')
  const chosen = model || config.model || 'smart'
  const res = await fetch(`${config.endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...body, model: chosen }),
  })
  if (!res.ok) throw new Error(`SarmaLink error: ${res.status}: ${await res.text()}`)
  if (body.stream) return { stream: res.body as ReadableStream, model: chosen }
  return { json: await res.json(), model: chosen }
}
