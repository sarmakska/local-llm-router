# Roadmap

## Shipped

- [x] OpenAI-compatible `/v1/chat/completions` endpoint
- [x] OpenAI Responses API at `/v1/responses`
- [x] Ollama, SarmaLink-AI, OpenAI backends
- [x] YAML policy with task, complexity, sensitivity, modality matching
- [x] Model-family routing: Qwen 2.5 Coder, Gemma 3, Llama 4
- [x] Latency-budget local-vs-cloud decision
- [x] Vision request classification
- [x] Streaming passthrough (Ollama 0.5 and cloud backends)
- [x] Privacy pinning via header
- [x] Per-route fallback
- [x] SQLite metrics on `node:sqlite`
- [x] Rolling A/B with shadow sampling and promotion recommendations
- [x] JSON metrics summary and Prometheus export
- [x] Health endpoint

## Planned

- [ ] `/v1/embeddings` endpoint
- [ ] Hugging Face Inference API backend
- [ ] vLLM backend for self-hosted GPU
- [ ] Eval-based A/B promotion (integrate with ai-eval-runner)
- [ ] OpenTelemetry traces

## Wishlist

- [ ] Multi-tenant policy: per-tenant policy override
- [ ] Per-route rate limits
- [ ] Cost budget enforcement (cap monthly spend per route)

## Won't ship

- Visual policy editor (YAML is fine)
- Built-in inference (use a separate model service)
- Plugin marketplace (use git)

## Contributing

PRs welcome. Pick from "Planned", open an issue, fork, branch, push, PR. Keep
changes small and focused.

I will not merge:

- Framework swaps (Hono stays)
- ORM dependencies (no migrations needed for metrics)
- Provider-specific deep features that cannot be expressed through the
  OpenAI-compatible surface

Releases: see [GitHub Releases](https://github.com/sarmakska/local-llm-router/releases).
