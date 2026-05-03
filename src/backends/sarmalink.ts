export async function runSarmalink(config: any, body: any): Promise<any> {
  const apiKey = process.env.SARMALINK_API_KEY
  if (!apiKey) throw new Error('SARMALINK_API_KEY not set')
  const res = await fetch(`${config.endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ ...body, model: config.model || 'smart' }),
  })
  if (!res.ok) throw new Error(`SarmaLink error: ${res.status}: ${await res.text()}`)
  return res.json()
}
