import { createRequire } from 'node:module'
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite'

/**
 * SQLite-backed metrics on Node's built-in `node:sqlite`. Using the standard
 * library means there is no native module to compile or ship a prebuilt for,
 * so the router installs and runs the same way on every platform Node 22+
 * supports.
 *
 * The module is loaded through `createRequire` rather than a static import so
 * that test and build bundlers which do not yet recognise `node:sqlite` as a
 * built-in leave it alone and Node resolves it at runtime.
 *
 * The database is opened lazily on first use rather than at import time, so
 * importing this module is a pure, side-effect-free operation. That keeps the
 * routing and translation units testable in isolation and lets the metrics
 * path be exercised independently.
 */

const require = createRequire(import.meta.url)

type DB = DatabaseSyncType

let _DatabaseSync: typeof DatabaseSyncType | null = null
function DatabaseSyncCtor(): typeof DatabaseSyncType {
  if (_DatabaseSync) return _DatabaseSync
  _DatabaseSync = (require('node:sqlite') as typeof import('node:sqlite')).DatabaseSync
  return _DatabaseSync
}

let _db: DB | null = null
let _insert: ReturnType<DB['prepare']> | null = null

function db(): DB {
  if (_db) return _db
  const DatabaseSync = DatabaseSyncCtor()
  const d = new DatabaseSync(process.env.LLR_DB || './metrics.db')
  d.exec(`
    CREATE TABLE IF NOT EXISTS metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER DEFAULT (strftime('%s', 'now') * 1000),
      backend TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      ok INTEGER NOT NULL,
      error TEXT,
      fallback_for TEXT,
      shadow INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_backend ON metrics(backend);
    CREATE INDEX IF NOT EXISTS idx_metrics_ts ON metrics(ts DESC);
  `)
  // Forward-compatible migration: add the shadow column when upgrading from an
  // older schema that predates rolling A/B. SQLite has no IF NOT EXISTS for
  // columns, so probe the table and add it only when absent.
  const cols = d.prepare(`PRAGMA table_info(metrics)`).all() as Array<{ name: string }>
  if (!cols.some((c) => c.name === 'shadow')) {
    d.exec(`ALTER TABLE metrics ADD COLUMN shadow INTEGER NOT NULL DEFAULT 0`)
  }
  _db = d
  return d
}

function insertStmt(): ReturnType<DB['prepare']> {
  if (_insert) return _insert
  _insert = db().prepare(
    'INSERT INTO metrics (backend, latency_ms, ok, error, fallback_for, shadow) VALUES (?, ?, ?, ?, ?, ?)',
  )
  return _insert
}

export interface MetricEvent {
  backend: string
  latency: number
  ok: boolean
  error?: string
  fallbackFor?: string
  /** A shadow call is an A/B candidate served in the background, not returned to the client. */
  shadow?: boolean
}

export function record(event: MetricEvent) {
  insertStmt().run(
    event.backend,
    Math.round(event.latency),
    event.ok ? 1 : 0,
    event.error ?? null,
    event.fallbackFor ?? null,
    event.shadow ? 1 : 0,
  )
}

/**
 * Clamp a caller-supplied window in hours to a sane positive range. Query
 * params arrive as strings and `Number('abc')` is `NaN`, which would otherwise
 * flow into the `ts >= ?` bound and silently return an empty or garbage window.
 * A negative window would query the future and return nothing. We coerce both
 * to the default and cap the window at one year so a single request cannot scan
 * the whole table.
 */
export function sanitiseHours(value: unknown, fallback = 24): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, 24 * 365)
}

export interface BackendSummary {
  backend: string
  calls: number
  avg_latency: number
  successes: number
}

export function summary(hours = 24): BackendSummary[] {
  const since = Date.now() - sanitiseHours(hours) * 3600 * 1000
  return db()
    .prepare(
      `SELECT backend, COUNT(*) AS calls, AVG(latency_ms) AS avg_latency,
              SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS successes
       FROM metrics WHERE ts >= ? GROUP BY backend ORDER BY calls DESC`,
    )
    .all(since) as unknown as BackendSummary[]
}

/**
 * Approximate a latency percentile for a backend over a recent window. SQLite
 * has no percentile function, so we count the successful samples and read the
 * value at the rank an ordered window puts the percentile at. `quantile` is in
 * [0, 1]; 0.5 is the median, 0.95 the tail. Returns undefined when there is not
 * enough data to be meaningful.
 */
export function pLatency(
  backend: string,
  quantile: number,
  hours = 1,
  minSamples = 5,
): number | undefined {
  const since = Date.now() - sanitiseHours(hours, 1) * 3600 * 1000
  const count = (
    db()
      .prepare(`SELECT COUNT(*) AS n FROM metrics WHERE backend = ? AND ts >= ? AND ok = 1`)
      .get(backend, since) as { n: number }
  ).n
  if (count < minSamples) return undefined
  const q = Math.min(Math.max(quantile, 0), 1)
  // Nearest-rank: the smallest sample whose rank covers the quantile. Clamp the
  // offset to the last row so q = 1 reads the maximum rather than running off
  // the end of the window.
  const offset = Math.min(Math.ceil(q * count) - (q > 0 ? 1 : 0), count - 1)
  const row = db()
    .prepare(
      `SELECT latency_ms FROM metrics WHERE backend = ? AND ts >= ? AND ok = 1
       ORDER BY latency_ms ASC LIMIT 1 OFFSET ?`,
    )
    .get(backend, since, Math.max(offset, 0)) as { latency_ms: number } | undefined
  return row?.latency_ms
}

/**
 * Approximate median latency for a backend, used as the live signal for the
 * latency-budget decision.
 */
export function p50Latency(backend: string, hours = 1, minSamples = 5): number | undefined {
  return pLatency(backend, 0.5, hours, minSamples)
}

/**
 * Approximate p95 latency for a backend. Tail latency, not the average, is what
 * blows an interactive budget, so the A/B report uses this to gate promotion.
 */
export function p95Latency(backend: string, hours = 1, minSamples = 5): number | undefined {
  return pLatency(backend, 0.95, hours, minSamples)
}

/** Render the recent summary in Prometheus text exposition format. */
export function prometheus(hours = 24): string {
  const window = sanitiseHours(hours)
  const rows = summary(window)
  const lines: string[] = [
    '# HELP llr_backend_calls_total Total backend calls in the window.',
    '# TYPE llr_backend_calls_total counter',
    '# HELP llr_backend_success_total Successful backend calls in the window.',
    '# TYPE llr_backend_success_total counter',
    '# HELP llr_backend_latency_avg_ms Average backend latency in the window.',
    '# TYPE llr_backend_latency_avg_ms gauge',
    '# HELP llr_backend_latency_p95_ms Approximate p95 backend latency in the window.',
    '# TYPE llr_backend_latency_p95_ms gauge',
  ]
  for (const r of rows) {
    const b = JSON.stringify(r.backend)
    lines.push(`llr_backend_calls_total{backend=${b}} ${r.calls}`)
    lines.push(`llr_backend_success_total{backend=${b}} ${r.successes}`)
    lines.push(`llr_backend_latency_avg_ms{backend=${b}} ${Math.round(r.avg_latency)}`)
    const p95 = p95Latency(r.backend, window, 1)
    if (typeof p95 === 'number') {
      lines.push(`llr_backend_latency_p95_ms{backend=${b}} ${p95}`)
    }
  }
  return lines.join('\n') + '\n'
}
