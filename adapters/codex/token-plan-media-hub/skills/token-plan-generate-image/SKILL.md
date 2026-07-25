---
name: token-plan-generate-image
description: Generate an image through the local Token Plan Media Hub and persist it as a traceable artifact. Use when a user asks Codex to draw, illustrate, create a concept image, make a visual draft, or test an Alibaba Model Studio image model. Do not use for editing an existing image until the Hub reports an image-edit capability.
---

# Token Plan Generate Image

1. Require the `token-plan-media-hub` MCP server. If its tools are unavailable, stop and say that the Hub service or plugin is not connected.
2. Call `media.list_models` with capability `image.generate`.
3. Respect an explicitly requested model. Otherwise use the user's verified default; never invent or silently substitute a model.
4. If the selected model is not `verified` for the current credential, call `media.probe_capabilities` before generation.
5. Call `media.generate_image` with only parameters declared by the selected model.
6. Return the artifact ID, local path, model, and manifest path. Do not return a temporary provider URL as the only result.

Never ask the user to paste a Key into chat. Key configuration belongs to the local Dashboard.

