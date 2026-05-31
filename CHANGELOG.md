# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Model-family routing. The classifier now picks an open-weight family for each
  request and the decision engine resolves it to a concrete model from the
  backend's `families` map: Qwen 2.5 Coder for code, Gemma 3 for vision, and
  Llama 4 for general work. One policy expresses the whole fleet without the
  client ever naming a model.
- Latency-budget routing. A route may set `latencyBudgetMs`. When the primary
  backend's expected latency (live median from metrics, or the backend's
  declared `p50Ms` hint) exceeds the budget and the fallback is expected to be
  faster, the request is shifted to the fallback so a slow local model never
  blows a tight interactive budget.
- Vision classification. Multimodal content-parts arrays are detected, tagged
  `task: vision` with `modality: image`, and routed to a vision-capable family.
- Streaming. `/v1/chat/completions` and `/v1/responses` stream the backend's
  native server-sent events straight through when `stream: true`, including
  Ollama 0.5 streaming and the cloud backends.
- OpenAI Responses API at `/v1/responses`. Requests in the Responses shape
  (`input`, `instructions`, content parts) are translated to chat messages,
  routed through the same engine, and returned as a Responses envelope with
  `output`, `output_text`, and `usage`.
- Rolling A/B. With `ab.enabled` in policy, a configurable sample of
  non-streaming traffic is mirrored to a candidate backend in the background and
  recorded as shadow metrics. `GET /v1/ab` reports each pair's latency, success,
  and a promote / hold / insufficient-data recommendation.
- Metrics endpoints: `GET /v1/metrics` for a JSON summary and `GET /metrics` for
  Prometheus text exposition.
- End-to-end test suite with a mock OpenAI-compatible upstream covering routing,
  family resolution, fallback, streaming, the Responses API, and metrics.

### Changed

- Metrics now use Node's built-in `node:sqlite` instead of a native module, so
  the router installs and runs with no compilation step on any platform Node 24
  supports.
- The default policy routes general traffic local-first on a 1200ms budget,
  spilling to the hosted backend when the local model cannot keep up.
- Minimum Node version raised to 24. CI runs on Node 24.
- Non-breaking dependency bumps: hono, yaml, tsx.

### Removed

- The `better-sqlite3` and `@types/better-sqlite3` dependencies, replaced by
  `node:sqlite`.

## [1.0.0]

### Added

- OpenAI-compatible `/v1/chat/completions` endpoint built on Hono.
- Deterministic heuristic classifier tagging task, complexity, sensitivity, and
  estimated tokens.
- Decision engine that walks a YAML policy top to bottom with per-route
  fallback and a guaranteed default.
- Ollama, SarmaLink-AI, and OpenAI backends behind a registry.
- Privacy pinning via the `X-LLR-Sensitivity` header.
- SQLite metrics collector and `/health` endpoint.
- Zod-validated policy loader.
