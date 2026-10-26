# ASYNC_WRAPPER

The ASYNC_WRAPPER handler allows you to execute any existing endpoint asynchronously. When called, it creates a background job, returns `202 Accepted` with a `requestId`, and the base endpoint runs in the background. You can poll status via `GET /api/async/status/:id` and retrieve the result via `GET /api/async/result/:id`.

## Configuration

Configure the async behavior in the wrapper endpoint's `custom_data.async`:

- `ttl_ms` (number, default `3600000`): Time to live for the job in milliseconds.
- `max_consumes` (number, default `5`): Maximum number of times the result can be retrieved.
- `notify_ws` (boolean, default `false`): If `true`, emits WebSocket notifications when the job completes or fails.

The base endpoint is specified in the wrapper's `code` field as a UUID (the `idendpoint` of the base endpoint). Only valid, enabled endpoints (excluding `ASYNC_WRAPPER`, `MCP`, `TELEGRAM_BOT`) can be used as the base.

## Behavior

- **Immediate response**: Returns `202 { requestId, status: 'PENDING', pollUrl, wsUrl, ... }`
- **Idempotency**: Duplicate requests with the same fingerprint (same base endpoint, query/body, environment) while a job is `PENDING` or `RUNNING` return the existing `requestId`
- **Request passthrough**: Original request (query, body, headers, method, etc.) is passed intact to the base endpoint
- **Metadata inheritance**: Reads `json_schema` and `data_test` from the base endpoint
- **Binary responses**: Binary responses are stored as base64 with `result_is_binary: true`, preserving `content_type` and `response_headers`
- **Error handling**: If the base endpoint fails (error thrown or non-2xx), the job is marked `FAILED` with error details

## API Routes

- `GET /api/async/status/:id` - Get job status
- `GET /api/async/result/:id` - Get job result (increments consume count)
