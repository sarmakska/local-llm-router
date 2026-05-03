import { readFileSync } from 'fs'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

const BackendSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ollama'), endpoint: z.string(), models: z.array(z.string()).optional() }),
  z.object({ type: z.literal('sarmalink'), endpoint: z.string(), model: z.string().default('smart') }),
  z.object({ type: z.literal('openai'), endpoint: z.string().default('https://api.openai.com/v1'), model: z.string() }),
])

const RouteSchema = z.union([
  z.object({
    match: z.record(z.string(), z.any()),
    backend: z.string(),
    fallback: z.string().optional(),
    reason: z.string().optional(),
  }),
  z.object({
    default: z.string(),
    fallback: z.string().optional(),
  }),
])

const PolicySchema = z.object({
  backends: z.record(z.string(), BackendSchema),
  routes: z.array(RouteSchema),
})

export type Policy = z.infer<typeof PolicySchema>

export function loadPolicy(path: string): Policy {
  const raw = readFileSync(path, 'utf-8')
  const data = parseYaml(raw)
  return PolicySchema.parse(data)
}
