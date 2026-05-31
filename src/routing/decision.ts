import type { Classification } from './classifier.js'
import type { Policy, Backend } from '../config/loader.js'

export interface Decision {
  backend: string
  fallback?: string
  reason: string
  /** Concrete model resolved from the backend family map, if any. */
  model?: string
  /** True when the latency budget forced a switch away from the primary backend. */
  latencyShifted?: boolean
}

/**
 * Returns the observed median latency for a backend in milliseconds, or
 * undefined when there is not enough data yet. Injected so the decision engine
 * stays pure and easy to test.
 */
export type LatencyProbe = (backend: string) => number | undefined

/**
 * Resolve a concrete model name for the classified family from a backend's
 * `families` map. Falls back to the backend's own default so the request is
 * always answerable.
 */
export function resolveModel(c: Classification, backend: Backend | undefined): string | undefined {
  if (!backend) return undefined
  const fam = (backend as any).families as Record<string, string> | undefined
  if (fam && c.family !== 'any' && fam[c.family]) return fam[c.family]
  if (backend.type === 'ollama') return backend.models?.[0]
  if (backend.type === 'sarmalink') return backend.model
  if (backend.type === 'openai') return backend.model
  return undefined
}

/**
 * Decide which backend serves a classified request.
 *
 * Routes are walked top to bottom; the first match wins. A `default` route
 * guarantees a result. When a matched route sets `latencyBudgetMs` and the
 * primary backend's expected latency exceeds the budget, the request is
 * shifted to the route's fallback so a slow local model never blows a tight
 * interactive budget. Expected latency comes from the live probe first, then
 * the backend's declared `p50Ms` hint.
 */
export function decide(c: Classification, policy: Policy, probe?: LatencyProbe): Decision {
  for (const route of policy.routes) {
    if ('default' in route) {
      return applyBudget(c, policy, {
        backend: route.default,
        fallback: route.fallback,
        reason: 'default',
        budget: route.latencyBudgetMs,
        probe,
      })
    }
    if (matches(c, route.match)) {
      return applyBudget(c, policy, {
        backend: route.backend,
        fallback: route.fallback,
        reason: route.reason || `matched: ${JSON.stringify(route.match)}`,
        budget: route.latencyBudgetMs,
        probe,
      })
    }
  }
  throw new Error('No route matched and no default backend in policy')
}

function expectedLatency(
  policy: Policy,
  backend: string,
  probe?: LatencyProbe,
): number | undefined {
  const live = probe?.(backend)
  if (typeof live === 'number') return live
  const cfg = policy.backends[backend] as Backend | undefined
  return cfg?.p50Ms
}

function applyBudget(
  c: Classification,
  policy: Policy,
  opts: {
    backend: string
    fallback?: string
    reason: string
    budget?: number
    probe?: LatencyProbe
  },
): Decision {
  let backend = opts.backend
  let fallback = opts.fallback
  let reason = opts.reason
  let latencyShifted = false

  if (opts.budget && fallback) {
    const expected = expectedLatency(policy, backend, opts.probe)
    if (typeof expected === 'number' && expected > opts.budget) {
      const fbExpected = expectedLatency(policy, fallback, opts.probe)
      // Only shift if the fallback is actually expected to be faster.
      if (typeof fbExpected !== 'number' || fbExpected < expected) {
        backend = fallback
        fallback = undefined
        reason = `latency budget ${opts.budget}ms exceeded (expected ${expected}ms), shifted to ${backend}`
        latencyShifted = true
      }
    }
  }

  return {
    backend,
    fallback,
    reason,
    model: resolveModel(c, policy.backends[backend] as Backend | undefined),
    latencyShifted,
  }
}

function matches(c: Classification, criteria: Record<string, any>): boolean {
  for (const [k, v] of Object.entries(criteria)) {
    if ((c as any)[k] !== v) return false
  }
  return true
}
