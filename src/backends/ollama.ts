import type { BackendResult } from './registry.js'

/**
 * Ollama backend. Talks the OpenAI-compatible surface that Ollama 0.5 exposes
 * at `/v1/chat/completions`, including native server-sent-event streaming when
 * the request sets `stream: true`. The concrete model is whatever the decision
 * engine resolved from the family map (Qwen 2.5 Coder, Gemma 3, Llama 4, ...);
 * when nothing is resolved we fall back to the first declared model.
 */
export async function runOllama(config: any, body: any, model?: string): Promise<BackendResult> {
  const chosen =
    body.model && body.model !== 'auto'
      ? body.model
      : model || config.models?.[0] || 'llama3.2:3b'

  const res = await fetch(`${config.endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, model: chosen }),
  })
  if (!res.ok) throw new Error(`Ollama error: ${res.status}: ${await res.text()}`)

  if (body.stream) return { stream: res.body as ReadableStream, model: chosen }
  return { json: await res.json(), model: chosen }
}
