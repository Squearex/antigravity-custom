# Antigravity Pro / SX Custom Engine

Custom AI Provider & Model Management Engine for Google Antigravity.

## Overview
This repository contains the custom engine integrated into Antigravity:
- **`dist/sxProxy.js`**: High-performance local proxy server (port 15725) handling protocol conversion (Gemini gRPC/JSON <-> OpenAI/Anthropic/Ollama), tool call streaming, context window calculation, token budgeting, and per-conversation model mappings.
- **`dist/sx-inject.js`**: Injected client-side UI script providing custom provider management (19+ presets), model selector, real-time token tracking ring, and performance monitor (TTFT, TPS).
- **`dist/main.js`**: Electron main process entry point hooking `sxProxy` and `sx-inject`.
- **`dist/updater.js`**: Auto-updater neutralized to prevent official Google updates from overwriting custom logic.

## Resilience & Isolation
- User configs (models, providers, keys) are stored in `%APPDATA%\Antigravity-Custom\sx_custom_models.json` (outside the repo).
- Per-conversation model associations are stored in `%APPDATA%\Antigravity-Custom\sx_conv_models.json`.
- The application runs in an isolated directory (`Programs\Antigravity-Custom`) preventing Google's official updater from overriding it.
