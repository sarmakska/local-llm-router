/**
 * Heuristic classifier. Inspects the request and emits a tag set used by the
 * policy engine. Cheap, fast, deterministic. Replace with a tiny model
 * classifier if you outgrow heuristics.
 */
export interface Classification {
  task: 'code' | 'web_search' | 'summarisation' | 'classification' | 'general'
  complexity: 'low' | 'medium' | 'high'
  sensitivity: 'normal' | 'high'
  tokens: number
}

const CODE_HINTS = /\b(function|class|async|await|import|return|const |let |var |def |sql|select|insert|update|delete|grep|sed|awk|regex|debug|stacktrace)\b/i
const SEARCH_HINTS = /\b(today|latest|current|now|recent|news|live|price|stock|exchange rate|weather)\b/i
const SUMMARY_HINTS = /\b(summari[sz]e|tl;?dr|in (\d+) (sentences|words)|short version|key points)\b/i

export function classify(body: any, sensitivityHeader: string): Classification {
  const messages = body.messages || []
  const lastUser = [...messages].reverse().find((m: any) => m.role === 'user')
  const text = lastUser?.content || ''
  const length = (typeof text === 'string' ? text : JSON.stringify(text)).length
  const tokens = Math.ceil(length / 4)

  let task: Classification['task'] = 'general'
  if (CODE_HINTS.test(text)) task = 'code'
  else if (SEARCH_HINTS.test(text)) task = 'web_search'
  else if (SUMMARY_HINTS.test(text)) task = 'summarisation'

  let complexity: Classification['complexity'] = 'medium'
  if (tokens < 100) complexity = 'low'
  else if (tokens > 2000) complexity = 'high'

  const sensitivity: Classification['sensitivity'] =
    sensitivityHeader === 'high' ? 'high' : 'normal'

  return { task, complexity, sensitivity, tokens }
}
