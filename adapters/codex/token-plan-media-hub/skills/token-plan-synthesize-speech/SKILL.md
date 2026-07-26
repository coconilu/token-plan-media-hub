---
name: token-plan-synthesize-speech
description: Synthesize text into a local audio artifact through Token Plan Media Hub. Use for narration, voice previews, accessibility audio, and system or previously authorized cloned voices. Do not describe multi-line TTS assembly as speech-to-speech.
---

# Token Plan Synthesize Speech

1. Require the `token-plan-media-hub` MCP server.
2. Call `list_models` for `speech.synthesize`.
3. Resolve a requested voice alias through the Hub. Never print the underlying cloned voice ID.
4. Keep a cloned voice bound to its enrollment model. Reject a conflicting requested model.
5. Call `synthesize_speech` for a system voice or `synthesize_with_cloned_voice` for an authorized local alias.
6. Return the artifact ID, local audio path, model, voice alias, duration, and manifest path.

If Token Plan cannot access the selected speech model, do not silently switch credentials. Report the capability result and let the user choose a configured credential route in the Dashboard.
