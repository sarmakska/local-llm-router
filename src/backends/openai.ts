import type { BackendResult } from './registry.js'

/**
 * OpenAI frontier backend, also usable against any OpenAI-compatible endpoint
 * (Azure OpenAI, OpenRouter, Together, ...). Streams when `stream: true`.
 */
export async function runOpenAI(config: any, body: any, model?: string): Promise<BackendResult> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')
  const chosen = model || config.model
  const res = await fetch(`${config.endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...body, model: chosen }),
  })
  if (!res.ok) throw new Error(`OpenAI error: ${res.status}: ${await res.text()}`)
  if (body.stream) return { stream: res.body as ReadableStream, model: chosen }
  return { json: await res.json(), model: chosen }
}
