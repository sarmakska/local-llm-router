import { describe, it, expect } from 'vitest'
import { responsesToChat, chatToResponses } from './responses.js'

describe('responses API translation', () => {
  it('turns a string input into a single user message', () => {
    const chat = responsesToChat({ model: 'auto', input: 'hello' })
    expect(chat.messages).toEqual([{ role: 'user', content: 'hello' }])
  })

  it('prepends instructions as a system message', () => {
    const chat = responsesToChat({ model: 'auto', instructions: 'be terse', input: 'hi' })
    expect(chat.messages[0]).toEqual({ role: 'system', content: 'be terse' })
    expect(chat.messages[1]).toEqual({ role: 'user', content: 'hi' })
  })

  it('maps input_text and input_image content parts', () => {
    const chat = responsesToChat({
      model: 'auto',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'what is this' },
            { type: 'input_image', image_url: { url: 'data:image/png;base64,AA' } },
          ],
        },
      ],
    })
    const parts = chat.messages[0].content
    expect(parts[0]).toEqual({ type: 'text', text: 'what is this' })
    expect(parts[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } })
  })

  it('maps max_output_tokens onto max_tokens', () => {
    const chat = responsesToChat({ model: 'auto', input: 'hi', max_output_tokens: 128 })
    expect(chat.max_tokens).toBe(128)
  })

  it('wraps a chat completion into a responses envelope', () => {
    const env = chatToResponses(
      {
        id: 'chatcmpl-1',
        model: 'llama4',
        choices: [{ message: { role: 'assistant', content: 'hi there' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      },
      'llama4',
    )
    expect(env.object).toBe('response')
    expect(env.status).toBe('completed')
    expect(env.output_text).toBe('hi there')
    expect(env.output[0].content[0]).toEqual({
      type: 'output_text',
      text: 'hi there',
      annotations: [],
    })
    expect(env.usage).toEqual({ input_tokens: 3, output_tokens: 2, total_tokens: 5 })
  })
})
