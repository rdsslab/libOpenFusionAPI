# Application Variables (AppVars) — Shared Rules

Application Variables keep credentials and per-environment settings out of the endpoint definition. An endpoint references a variable by writing its name as a string; the runtime replaces that string with the stored value for the endpoint's environment.

## Naming rule (enforced on save)

A variable name **must** match:

```
^\$_VAR_[A-Z0-9_]+$
```

That is: the literal prefix `$_VAR_` followed by uppercase letters, digits and underscores only.

- Create the variable with `appvar_upsert` using the **prefixed name as the `name` field**: `{ "name": "$_VAR_MAIN_DB" }`. The prefix is part of the stored name, not something the runtime adds.
- The stored name and the string written in the endpoint must be **identical, character for character**. A variable created as `MAIN_DB` is never resolved.
- Names are limited to 50 characters, and the prefix uses 6 of them — 44 remain for the rest.
- Saving a name that breaks the rule returns HTTP `400` with `code: "INVALID_APPVAR_NAME"`; the response `details.suggestion` carries the corrected name. This applies to every write path, including application backup restores and `appvar_migrate`.
- Lowercase letters, dashes, dots and spaces are rejected because AppVars are also injected as globals into the JavaScript sandbox: a name that is not a valid JavaScript identifier can only be read through `$_APP_VARS_['...']` and silently fails when referenced directly.

## Which endpoint field carries the reference

**This depends on the handler.** Putting the reference in the wrong field means it is never resolved.

| Handler | Field that resolves the AppVar | What the AppVar value holds |
|---|---|---|
| `SQL` | `custom_data` | Connection config object |
| `HANA` | `custom_data` | Connection config object |
| `SQL_BULK_I` | `custom_data` | Connection config object |
| `MONGODB` | `custom_data` | Connection config object |
| `TEXT` | `custom_data` | Presentation config (`mimeType`, …) |
| `SOAP` | `code` — only when `custom_data.wsdl` is absent | JSON config with `wsdl` and `functionName` |
| `FETCH` | `code` | The destination URL string |
| `JS` | none | Injected as sandbox globals and in `$_APP_VARS_` |

For the handlers driven by `custom_data`, the whole field is the reference — the string replaces the entire object:

```json
{ "custom_data": "$_VAR_MAIN_DB" }
```

Partial substitution inside a larger object or inside SQL text is **not** supported. Either the field is a literal config, or the whole field is one `$_VAR_…` reference.

## Resolution behavior worth knowing

- **Missing variable**: if the value carries the prefix but no variable with that exact name exists for the endpoint's environment, the request fails with `400 AppVar $_VAR_X not found for environment <env>`.
- **Wrong or missing prefix**: the string is left untouched and reaches the handler as a literal. For `custom_data`-driven handlers it is then parsed as JSON and fails with `400 Invalid JSON in method custom_data/AppVar` — a confusing error whose real cause is the missing prefix.
- **Surrounding quotes are stripped** before resolving, so `"\"$_VAR_MAIN_DB\""` also resolves.
- **Values that look like JSON are parsed automatically**: a stored value starting with `{`, `[` or `"` is `JSON.parse`d before being handed to the handler. Store connection configs as JSON objects (`type: "json"`), not as escaped strings.
- **Per environment**: a variable exists independently in `dev`, `qa` and `prd`. Create it in every environment the endpoint runs in, or promote it with `appvar_migrate`.
- **SQL implicit fallback**: if a `SQL` endpoint resolves to an empty configuration, the handler falls back to the `$_VAR_SQLITE` variable of the application when it exists. Do not rely on this in production — set `custom_data` explicitly.
