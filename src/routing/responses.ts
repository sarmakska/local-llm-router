/**
 * Translation between the OpenAI Responses API shape (`/v1/responses`) and the
 * Chat Completions shape that every backend speaks. The router is internally a
 * chat-completions router, so we translate a Responses request into chat
 * messages on the way in and the chat completion back into a Responses
 * envelope on the way out. This keeps a single routing and backend code path
 * while still presenting the newer surface clients increasingly expect.
 */

export interface ResponsesRequest {
  model?: string
  input: string | Array<any>
  instructions?: string
  stream?: boolean
  [k: string]: any
}

/** Convert a Responses request into a Chat Completions request body. */
export function responsesToChat(req: ResponsesRequest): any {
  const messages: any[] = []
  if (req.instructions) messages.push({ role: 'system', content: req.instructions })

  if (typeof req.input === 'string') {
    messages.push({ role: 'user', content: req.input })
  } else if (Array.isArray(req.input)) {
    for (const item of req.input) {
      if (typeof item === 'string') {
        messages.push({ role: 'user', content: item })
        continue
      }
      const role = item.role || 'user'
      const content = item.content
      if (typeof content === 'string') {
        messages.push({ role, content })
      } else if (Array.isArray(content)) {
        // Map Responses content parts to Chat Completions content parts.
        const parts = content.map((p: any) => {
          if (p.type === 'input_text' || p.type === 'text') return { type: 'text', text: p.text }
          if (p.type === 'input_image' || p.type === 'image_url') {
            const url = p.image_url?.url || p.image_url || p.url
            return { type: 'image_url', image_url: { url } }
          }
          return p
        })
        messages.push({ role, content: parts })
      } else {
        messages.push({ role, content })
      }
    }
  }

  const body: any = { model: req.model, messages, stream: req.stream }
  if (req.temperature !== undefined) body.temperature = req.temperature
  if (req.max_output_tokens !== undefined) body.max_tokens = req.max_output_tokens
  if (req.tools !== undefined) body.tools = req.tools
  return body
}

function genId(): string {
  return 'resp_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

/** Convert a Chat Completions response into a Responses envelope. */
export function chatToResponses(chat: any, model: string): any {
  const choice = chat?.choices?.[0]
  const text = choice?.message?.content ?? ''
  const finish = choice?.finish_reason ?? 'stop'
  return {
    id: chat?.id || genId(),
    object: 'response',
    created_at: chat?.created ?? Math.floor(Date.now() / 1000),
    model: chat?.model || model,
    status: 'completed',
    output: [
      {
        type: 'message',
        id: 'msg_' + (chat?.id || genId()),
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text, annotations: [] }],
      },
    ],
    output_text: text,
    usage: chat?.usage
      ? {
          input_tokens: chat.usage.prompt_tokens ?? 0,
          output_tokens: chat.usage.completion_tokens ?? 0,
          total_tokens: chat.usage.total_tokens ?? 0,
        }
      : undefined,
    finish_reason: finish,
  }
}
