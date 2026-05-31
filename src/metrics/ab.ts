import type { Policy } from '../config/loader.js'
import { runBackend } from '../backends/registry.js'
import { record, summary, type BackendSummary } from './collector.js'

/**
 * Rolling A/B. When enabled in policy, a small sample of non-streaming traffic
 * is mirrored to a candidate backend in the background. The candidate's result
 * is never returned to the client; only its latency and success are recorded
 * (flagged `shadow`) so the operator can see, from real traffic, whether a
 * cheaper backend keeps up before promoting it in the policy file.
 *
 * This is latency-and-cost optimisation with a real signal from production
 * traffic. Quality scoring is deliberately out of scope here: wire response
 * feedback or an eval suite into `report()` if you want quality-gated
 * promotion.
 */

export interface AbConfig {
  enabled: boolean
  sampleRate: number
  candidates: Record<string, string>
}

export function abConfig(policy: Policy): AbConfig {
  const ab = policy.ab
  return {
    enabled: ab?.enabled ?? false,
    sampleRate: ab?.sampleRate ?? 0.05,
    candidates: ab?.candidates ?? {},
  }
}

/** Decide, for a chosen primary backend, whether to fire a shadow candidate. */
export function pickShadow(
  cfg: AbConfig,
  chosenBackend: string,
  rng: () => number = Math.random,
): string | undefined {
  if (!cfg.enabled) return undefined
  const candidate = cfg.candidates[chosenBackend]
  if (!candidate || candidate === chosenBackend) return undefined
  if (rng() > cfg.sampleRate) return undefined
  return candidate
}

/**
 * Fire a shadow call in the background and record its outcome. Never throws and
 * never blocks the caller: failures are swallowed and recorded so a flaky
 * candidate cannot affect live traffic.
 */
export function runShadow(
  policy: Policy,
  candidate: string,
  body: any,
  model?: string,
): void {
  const cfg = policy.backends[candidate]
  if (!cfg) return
  const start = Date.now()
  // Strip streaming so the shadow is always a simple buffered call.
  const shadowBody = { ...body, stream: false }
  void runBackend(candidate, cfg, shadowBody, model)
    .then(() => {
      record({ backend: candidate, latency: Date.now() - start, ok: true, shadow: true })
    })
    .catch((err) => {
      record({
        backend: candidate,
        latency: Date.now() - start,
        ok: false,
        error: String(err),
        shadow: true,
      })
    })
}

export interface AbReportRow {
  primary: string
  candidate: string
  primaryAvgLatency: number | null
  candidateAvgLatency: number | null
  candidateSamples: number
  recommendation: 'promote' | 'hold' | 'insufficient-data'
}

/**
 * Compare each configured primary/candidate pair over a recent window and emit
 * a recommendation. A candidate is a promotion suggestion when it has enough
 * shadow samples, a success rate at least as good as the primary, and lower
 * average latency.
 */
export function report(policy: Policy, hours = 24, minSamples = 20): AbReportRow[] {
  const cfg = abConfig(policy)
  const stats = summary(hours)
  const byBackend = new Map<string, BackendSummary>()
  for (const s of stats) byBackend.set(s.backend, s)

  const rows: AbReportRow[] = []
  for (const [primary, candidate] of Object.entries(cfg.candidates)) {
    const p = byBackend.get(primary)
    const c = byBackend.get(candidate)
    const candidateSamples = c?.calls ?? 0
    let recommendation: AbReportRow['recommendation'] = 'insufficient-data'

    if (candidateSamples >= minSamples && c && p) {
      const pSuccess = p.calls ? p.successes / p.calls : 0
      const cSuccess = c.calls ? c.successes / c.calls : 0
      if (cSuccess >= pSuccess && c.avg_latency < p.avg_latency) recommendation = 'promote'
      else recommendation = 'hold'
    }

    rows.push({
      primary,
      candidate,
      primaryAvgLatency: p ? Math.round(p.avg_latency) : null,
      candidateAvgLatency: c ? Math.round(c.avg_latency) : null,
      candidateSamples,
      recommendation,
    })
  }
  return rows
}
