# ASYNC_WRAPPER

## Quick rules
- The wrapper endpoint's `code` must contain ONLY the UUID (`idendpoint`) of the base endpoint.
- Async configuration goes ONLY in `custom_data.async` of the wrapper endpoint: `ttl_ms`, `max_consumes`, `notify_ws` (default false).
- Base endpoint must be enabled and valid; ASYNC_WRAPPER/MCP/TELEGRAM_BOT are not allowed as base.
- Original request (query/body/headers/method) is passed intact to the base endpoint.
- Binary responses are stored as base64 with `result_is_binary=true`, preserving `content_type` and `response_headers`.
- WebSocket notifications only if `notify_ws=true`.
- Result retrieval consumes one of the allowed consumptions; unknown/expired jobs return 404/410 as appropriate.
