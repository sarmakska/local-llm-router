export async function runOllama(config: any, body: any): Promise<any> {
  const model = body.model && body.model !== 'auto' ? body.model : (config.models?.[0] || 'llama3.2:3b')
  const res = await fetch(`${config.endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, model }),
  })
  if (!res.ok) throw new Error(`Ollama error: ${res.status}`)
  return res.json()
}
