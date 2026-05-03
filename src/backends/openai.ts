export async function runOpenAI(config: any, body: any): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')
  const res = await fetch(`${config.endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...body, model: config.model }),
  })
  if (!res.ok) throw new Error(`OpenAI error: ${res.status}: ${await res.text()}`)
  return res.json()
}
