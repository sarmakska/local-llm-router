import { readFileSync } from 'fs'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

/**
 * A backend may declare a `families` map so the router can select a concrete
 * model for the family the classifier picked. For an Ollama backend this lets
 * one policy express "send code to Qwen 2.5 Coder, vision to Gemma 3, the rest
 * to Llama 4" without the client ever naming a model.
 *
 * `p50Ms` is an optional observed median latency hint. When a route sets a
 * latency budget the decision engine uses it (falling back to live metrics) to
 * decide whether the local backend can plausibly meet the budget or whether
 * the request should go straight to the faster cloud backend.
 */
const FamilyMap = z
  .object({
    'qwen-coder': z.string().optional(),
    gemma: z.string().optional(),
    llama: z.string().optional(),
  })
  .partial()
  .optional()

const BackendSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ollama'),
    endpoint: z.string(),
    models: z.array(z.string()).optional(),
    families: FamilyMap,
    p50Ms: z.number().optional(),
  }),
  z.object({
    type: z.literal('sarmalink'),
    endpoint: z.string(),
    model: z.string().default('smart'),
    families: FamilyMap,
    p50Ms: z.number().optional(),
  }),
  z.object({
    type: z.literal('openai'),
    endpoint: z.string().default('https://api.openai.com/v1'),
    model: z.string(),
    families: FamilyMap,
    p50Ms: z.number().optional(),
  }),
])

const MatchRoute = z.object({
  match: z.record(z.string(), z.any()),
  backend: z.string(),
  fallback: z.string().optional(),
  reason: z.string().optional(),
  /** If set and the primary backend is unlikely to meet this budget, route to the fallback. */
  latencyBudgetMs: z.number().optional(),
})

const DefaultRoute = z.object({
  default: z.string(),
  fallback: z.string().optional(),
  latencyBudgetMs: z.number().optional(),
})

const RouteSchema = z.union([MatchRoute, DefaultRoute])

const PolicySchema = z.object({
  backends: z.record(z.string(), BackendSchema),
  routes: z.array(RouteSchema),
  /** Optional rolling A/B configuration. Disabled unless `ab.enabled` is true. */
  ab: z
    .object({
      enabled: z.boolean().default(false),
      sampleRate: z.number().min(0).max(1).default(0.05),
      candidates: z.record(z.string(), z.string()).default({}),
    })
    .optional(),
})

export type Policy = z.infer<typeof PolicySchema>
export type Backend = z.infer<typeof BackendSchema>
export type MatchRouteT = z.infer<typeof MatchRoute>
export type DefaultRouteT = z.infer<typeof DefaultRoute>

export function loadPolicy(path: string): Policy {
  const raw = readFileSync(path, 'utf-8')
  const data = parseYaml(raw)
  return PolicySchema.parse(data)
}

export function parsePolicy(raw: string): Policy {
  return PolicySchema.parse(parseYaml(raw))
}
