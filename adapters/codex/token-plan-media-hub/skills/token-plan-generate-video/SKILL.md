---
name: token-plan-generate-video
description: Submit and track an Alibaba Model Studio video-generation job through the local Token Plan Media Hub. Use for text-to-video requests and, only when reported by the Hub, image-to-video or reference-video requests. Do not use for deterministic editing, timeline composition, or an unsupported model capability.
---

# Token Plan Generate Video

1. Require the `token-plan-media-hub` MCP server.
2. Call `media.list_models` for the requested video capability.
3. Use only parameters declared by that model. Do not reuse duration or resolution limits from another model.
4. Call `media.generate_video` and report the returned job ID immediately.
5. Poll with `media.get_job` at the Hub-provided cadence. A timeout is `unknown/pending`, not success or failure.
6. When complete, return the artifact ID, local MP4 path, model, provider task ID summary, and manifest path.

If the user requests a silent result and the provider cannot disable audio, state that the Hub will remove the downloaded audio track locally.

