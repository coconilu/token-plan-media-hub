---
name: token-plan-clone-voice
description: Clone a voice through Token Plan Media Hub only after explicit authorization, then create a local alias and optional test sample. Use when a user asks to clone their own voice or a voice for which they have clear permission. Never use for an unconsented third-party voice.
---

# Token Plan Clone Voice

1. Require the `token-plan-media-hub` MCP server.
2. Ask the user to affirm that they own the voice or have explicit permission. Do not proceed on an implied or ambiguous answer.
3. Call `list_models` for `voice.clone` and require a verified credential route.
4. Convert the authorized audio to a `data:audio/...;base64,...` URL locally, then call `clone_voice` with the local alias, language, and explicit consent flag. Never print the encoded sample.
5. Do not expose the provider voice ID. Return the local alias and consent record ID.
6. Offer a short test synthesis through `synthesize_with_cloned_voice`.
7. Report where the private sample and manifest are stored; never add them to Git.

Stop if the request targets a public figure, an unconsenting person, or deceptive impersonation.
