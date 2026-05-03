import type { Classification } from './classifier.js'
import type { Policy } from '../config/loader.js'

export interface Decision {
  backend: string
  fallback?: string
  reason: string
}

export function decide(c: Classification, policy: Policy): Decision {
  for (const route of policy.routes) {
    if ('default' in route) {
      return { backend: route.default, fallback: route.fallback, reason: 'default' }
    }
    if (matches(c, route.match)) {
      return {
        backend: route.backend,
        fallback: route.fallback,
        reason: route.reason || `matched: ${JSON.stringify(route.match)}`,
      }
    }
  }
  // Should not reach here if policy has a default
  throw new Error('No route matched and no default backend in policy')
}

function matches(c: Classification, criteria: Record<string, any>): boolean {
  for (const [k, v] of Object.entries(criteria)) {
    if ((c as any)[k] !== v) return false
  }
  return true
}
