import { runOllama } from './ollama.js'
import { runSarmalink } from './sarmalink.js'
import { runOpenAI } from './openai.js'

export async function runBackend(name: string, config: any, body: any): Promise<any> {
  switch (config.type) {
    case 'ollama':
      return runOllama(config, body)
    case 'sarmalink':
      return runSarmalink(config, body)
    case 'openai':
      return runOpenAI(config, body)
    default:
      throw new Error(`Unknown backend type: ${config.type}`)
  }
}
