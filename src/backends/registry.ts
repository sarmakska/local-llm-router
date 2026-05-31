import { runOllama } from './ollama.js'
import { runSarmalink } from './sarmalink.js'
import { runOpenAI } from './openai.js'

/**
 * Every backend returns one of two shapes: a parsed JSON body for a normal
 * request, or a raw byte stream for a streaming request. Carrying the resolved
 * model back lets the caller stamp it onto metrics and the Responses API
 * envelope.
 */
export interface BackendResult {
  json?: any
  stream?: ReadableStream
  model: string
}

export async function runBackend(
  name: string,
  config: any,
  body: any,
  model?: string,
): Promise<BackendResult> {
  switch (config.type) {
    case 'ollama':
      return runOllama(config, body, model)
    case 'sarmalink':
      return runSarmalink(config, body, model)
    case 'openai':
      return runOpenAI(config, body, model)
    default:
      throw new Error(`Unknown backend type: ${config.type}`)
  }
}
