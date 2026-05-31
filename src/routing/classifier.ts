/**
 * Heuristic classifier. Inspects the request and emits a tag set used by the
 * policy engine. Cheap, fast, deterministic, no extra model call. Replace with
 * a tiny model classifier if you outgrow heuristics.
 *
 * The tag set drives two things: which policy route matches, and which model
 * family the chosen backend should prefer. As of May 2026 the families we
 * recognise are the open-weight workhorses people actually run locally:
 * Llama 4 for general multimodal work, Gemma 3 for vision and multilingual
 * tasks, and Qwen 2.5 Coder for code.
 */
export type Task =
  | 'code'
  | 'web_search'
  | 'summarisation'
  | 'classification'
  | 'vision'
  | 'general'

export type Complexity = 'low' | 'medium' | 'high'
export type Sensitivity = 'normal' | 'high'
export type Modality = 'text' | 'image'

/** Open-weight model family the request is best suited to. */
export type Family = 'qwen-coder' | 'gemma' | 'llama' | 'any'

export interface Classification {
  task: Task
  complexity: Complexity
  sensitivity: Sensitivity
  modality: Modality
  family: Family
  tokens: number
}

const CODE_HINTS =
  /\b(function|class|async|await|import|return|const |let |var |def |sql|select|insert|update|delete|grep|sed|awk|regex|debug|stacktrace|typescript|python|rust|golang|compile|refactor)\b/i
const SEARCH_HINTS =
  /\b(today|latest|current|now|recent|news|live|price|stock|exchange rate|weather)\b/i
const SUMMARY_HINTS =
  /\b(summari[sz]e|tl;?dr|in (\d+) (sentences|words)|short version|key points)\b/i

/**
 * Extract the text of the last user message. Handles both the simple string
 * form and the OpenAI multimodal content-parts array, and reports whether any
 * image part was present so the policy can pin vision traffic to a
 * vision-capable family such as Gemma 3 or Llama 4.
 */
function readLastUser(messages: any[]): { text: string; hasImage: boolean } {
  const lastUser = [...messages].reverse().find((m: any) => m.role === 'user')
  const content = lastUser?.content
  if (typeof content === 'string') return { text: content, hasImage: false }
  if (Array.isArray(content)) {
    let text = ''
    let hasImage = false
    for (const part of content) {
      if (part?.type === 'text' && typeof part.text === 'string') text += ' ' + part.text
      if (part?.type === 'image_url' || part?.type === 'input_image') hasImage = true
    }
    return { text: text.trim(), hasImage }
  }
  return { text: content ? JSON.stringify(content) : '', hasImage: false }
}

function pickFamily(task: Task, modality: Modality): Family {
  if (task === 'code') return 'qwen-coder'
  if (modality === 'image' || task === 'vision') return 'gemma'
  if (task === 'general' || task === 'summarisation') return 'llama'
  return 'any'
}

export function classify(body: any, sensitivityHeader: string): Classification {
  const messages = body.messages || []
  const { text, hasImage } = readLastUser(messages)
  const length = text.length
  const tokens = Math.ceil(length / 4)

  const modality: Modality = hasImage ? 'image' : 'text'

  let task: Task = 'general'
  if (hasImage) task = 'vision'
  else if (CODE_HINTS.test(text)) task = 'code'
  else if (SEARCH_HINTS.test(text)) task = 'web_search'
  else if (SUMMARY_HINTS.test(text)) task = 'summarisation'

  let complexity: Complexity = 'medium'
  if (tokens < 100) complexity = 'low'
  else if (tokens > 2000) complexity = 'high'

  const sensitivity: Sensitivity = sensitivityHeader === 'high' ? 'high' : 'normal'

  const family = pickFamily(task, modality)

  return { task, complexity, sensitivity, modality, family, tokens }
}
