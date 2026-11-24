# Graph Report - libOpenFusionAPI  (2026-11-24)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2742 nodes · 6070 edges · 136 communities (128 shown, 8 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 103 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `83b82a5d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- manager.js
- dependencies
- systemBot.telegram.js
- log.js
- handler.js
- codeValidator.js
- bots/manifest.json
- prd/endpoint/index.js
- bots/index.js
- apiclient/index.js
- alerts/index.js
- handler/utils.js
- TasksInterval
- package.json
- timeSync.js
- RateLimitService.js
- system/prd/index.js
- telegram/manifest.json
- appgroups/index.js
- timer/worker.js
- lib/index.js
- functionVars.js
- EndpointRuntimeService.js
- mcp.js
- appvars.js
- mcp_exhaustive_validation.js
- models.js
- mcp_contract_audit.js
- websocket_manager.js
- app.js
- app/index.js
- endpoint.js
- sequelize.js
- mcp_live_validation.js
- recordAudit
- ._build
- dotenv
- validateHandlerDocs.js
- user/index.js
- doc_generator.js
- scripts
- sequelize
- schedule.js
- LogBuffer
- ia.js
- user.js
- Endpoint
- ref_node_assert
- interval_tasks/index.js
- sqlFunction.js
- ref_node_fs
- .run
- soapFunction.js
- server/utils.js
- MCP/manifest.json
- MCPToolRuntime
- owasp_top10.js
- SQL/manifest.json
- handlerDocs.js
- auth_service.js
- appchanges/index.js
- lock_retry.js
- EndpointLoader
- ConnectionPool.js
- sqlHana.js
- interval_task.js
- sql_bind_literal_audit.js
- generateDocs.js
- generate-index-html.js
- appvar_types_test.js
- check_mcp_name_uniqueness.js
- handler_db_matrix.mjs
- sql_comments_test.js
- server/endpoint/index.js
- intervalTaskDocs.js
- apikey/index.js
- botDocs.js
- TimedCache
- isPlainObject
- ws_cache_events.js
- EndpointLogger.js
- SOAP/manifest.json
- mcp_conflict_on_restore_test.js
- pdf-generator.js
- FETCH/manifest.json
- FUNCTION/manifest.json
- HANA/manifest.json
- JS/manifest.json
- MONGODB/manifest.json
- NA/manifest.json
- SQL_BULK_I/manifest.json
- TEXT/manifest.json
- .run
- cache_validation.js
- fetch_timeout_test.js
- hana_comments_live_test.js
- runtime
- bot_log.js
- endpointCorsPolicy.js
- basicAuthHeader
- bot_resilience_test.js
- exception_payload_test.js
- mssql_query_generator.js
- db_path_override_test.js
- mcp_schema_smoke.mjs
- utils_path.js
- storage
- bot_backup_test.js
- listing_projection_test.js
- mcp_docs_consistency_test.mjs
- allowScripts
- audit/index.js
- resolveProviderConfig
- concurrency.js
- interval_task_transition_test.js
- task_status
- default/index.js
- JSON_ADAPTER
- errorPayload.js
- simulate_loader.js
- createFunctionVM
- ref_node_path
- mcp_schema_conversion.js
- overrides
- conditional_fields
- max_backoff_seconds_per_task
- stableStringify
- db_unbounded_writes_test.js
- mcp_tool_descriptions.js
- @rdsslab/uFetch
- suspension
- recurse
- backoff_enabled
- max_backoff_seconds_per_task

## God Nodes (most connected - your core abstractions)
1. `recordAudit()` - 46 edges
2. `sequelize` - 30 edges
3. `replyException()` - 26 edges
4. `scripts` - 25 edges
5. `getAppVarsByIdApp()` - 24 edges
6. `restoreAppFromBackup()` - 23 edges
7. `sqlFunction()` - 23 edges
8. `upsertAppVar()` - 22 edges
9. `resolveAppVarPlaceholder()` - 22 edges
10. `basicAuthHeader()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `listFunctionsVars()`  [EXTRACTED]
  dev/test/ffmpeg_functionvars_test.js → src/lib/server/functionVars.js
- `run()` --calls--> `ServerAPI`  [EXTRACTED]
  dev/scratch/test_integration_flow.js → src/lib/index.js
- `main()` --calls--> `listFunctionsVars()`  [EXTRACTED]
  dev/test/agentkit_test.js → src/lib/server/functionVars.js
- `runEndpoint()` --calls--> `functionsVars()`  [EXTRACTED]
  dev/test/sftp_demo_endpoints_test.js → src/lib/server/functionVars.js
- `runTests()` --calls--> `ensureIntervalTaskColumns()`  [EXTRACTED]
  dev/test/interval_task_batch_test.js → src/lib/db/ensureIntervalTaskColumns.js

## Import Cycles
- 3-file cycle: `src/lib/async/AsyncTaskService.js -> src/lib/handler/handler.js -> src/lib/handler/asyncWrapper.js -> src/lib/async/AsyncTaskService.js`
- 4-file cycle: `src/lib/db/log.js -> src/lib/db/models.js -> src/lib/server/utils.js -> src/lib/server/functionVars.js -> src/lib/db/log.js`
- 5-file cycle: `src/lib/db/endpoint.js -> src/lib/db/models.js -> src/lib/server/utils.js -> src/lib/server/functionVars.js -> src/lib/db/log.js -> src/lib/db/endpoint.js`

## Communities (136 total, 8 thin omitted)

### Community 0 - "manager.js"
Cohesion: 0.05
Nodes (63): systeminformation, getAllEndpoints(), createLog(), getAppEndpointUsageSummary(), getAvgResponseTimeByMinute(), getCountsByMinute(), getEnvironmentFilter(), getLogs() (+55 more)

### Community 1 - "dependencies"
Cohesion: 0.05
Nodes (66): newVersion, packageData, packagePath, parts, BOT_DOC_REQUIRED_FILES, BOT_DOCS_ROOT, BOT_PROVIDERS_ROOT, __dirname (+58 more)

### Community 2 - "systemBot.telegram.js"
Cohesion: 0.05
Nodes (61): createResponse(), run(), createEndpointBackup(), getEndpointBackupById(), getEndpointBackupByIdEndpoint(), getEndpointBackupByIdEndpointLightweight(), hashObjectSync(), sortObjectDeep() (+53 more)

### Community 3 - "log.js"
Cohesion: 0.03
Nodes (61): author, bugs, url, description, devDependencies, @types/ws, homepage, keywords (+53 more)

### Community 4 - "handler.js"
Cohesion: 0.05
Nodes (51): conBigint, dialect, Sonda, errorSequelize(), errorTedious(), query(), lockRow(), runTests() (+43 more)

### Community 5 - "codeValidator.js"
Cohesion: 0.07
Nodes (27): buildRuntime(), buildErrorPayload(), getPublicErrorData(), PUBLIC_ERROR_DATA, truncatePublicErrorData(), assertFunction(), assertObject(), validateEndpointContext() (+19 more)

### Community 6 - "bots/manifest.json"
Cohesion: 0.06
Nodes (36): __dirname, MCP_HANDLER_SOURCE, @modelcontextprotocol/sdk, zod, getApplicationTreeByFilters(), buildTaskEnvironmentFilter(), getHandlerDoc(), getHandlerLibraryDoc() (+28 more)

### Community 7 - "prd/endpoint/index.js"
Cohesion: 0.03
Nodes (60): dependencies, acorn, ajv, @anthropic-ai/sdk, archiver, canvas, chrome-launcher, cron-parser (+52 more)

### Community 8 - "bots/index.js"
Cohesion: 0.10
Nodes (47): api(), changePassword(), ENV_ORDER, esc(), findVar(), finishLink(), forgotPassword(), getAppsEnvIndex() (+39 more)

### Community 9 - "apiclient/index.js"
Cohesion: 0.10
Nodes (36): deepClone(), runTests(), deepClone(), runTests(), closeDb(), createTask(), runTests(), uuid (+28 more)

### Community 10 - "alerts/index.js"
Cohesion: 0.05
Nodes (13): buildDocx(), buildPdf(), buildZip(), check(), checks, crc32(), CRC_TABLE, jpegBytes (+5 more)

### Community 11 - "handler/utils.js"
Cohesion: 0.09
Nodes (34): runTests(), runTests(), taskIdentities(), restoreIntervalTasks(), deleteIntervalTask(), findDuplicateTaskGroups(), scheduleSignature(), taskEquivalenceKey() (+26 more)

### Community 12 - "TasksInterval"
Cohesion: 0.07
Nodes (28): fastify, @fastify/cookie, @fastify/cors, @fastify/formbody, @fastify/multipart, @fastify/static, @fastify/websocket, API_CLIENT_COLUMNS (+20 more)

### Community 13 - "package.json"
Cohesion: 0.09
Nodes (29): main(), parse(), acorn, fnValidateEndpointCode(), APPLICABLE_HANDLERS, applyTextFixes(), collectUfetchAliases(), MATCHERS (+21 more)

### Community 14 - "timeSync.js"
Cohesion: 0.05
Nodes (39): code_language, crud_tools, read, skill, write, docs, main, skill (+31 more)

### Community 15 - "RateLimitService.js"
Cohesion: 0.13
Nodes (25): makeReply(), run(), warnings, customFunction(), VALID_DATA_TYPES, validateFnResult(), fetchFunction(), jsFunction() (+17 more)

### Community 16 - "system/prd/index.js"
Cohesion: 0.10
Nodes (31): instrumentar(), runTests(), TAREA(), findExclusiveGroupConflict(), getNextIntervalTaskRun(), rescheduleIntervalTask(), createIntervalTaskRun(), pruneIntervalTaskRuns() (+23 more)

### Community 17 - "telegram/manifest.json"
Cohesion: 0.10
Nodes (31): upsertApiClient(), buildSystemCheckReport(), cierreEscrituras, ENV_CATALOG_ORDER, findEquivalentIntervalTasks(), normalizeTaskParams(), replace_GENTOKEN(), replace_NODEMAILER() (+23 more)

### Community 18 - "appgroups/index.js"
Cohesion: 0.10
Nodes (6): prefixTableName(), ServerAPI, DbHookCacheInvalidationService, FunctionRegistryService, ServerReadyOrchestrator, OFAPIServer

### Community 19 - "timer/worker.js"
Cohesion: 0.11
Nodes (28): create(), created, cycleBackupRestore(), failures, getApplicationEndpointByRoute(), parseAppVar(), APPVAR_NAME_MAX_LENGTH, APPVAR_NAME_PREFIX (+20 more)

### Community 20 - "lib/index.js"
Cohesion: 0.11
Nodes (31): avisoCasos, cases, dialectCases, dollarCases, dollarIntactCases, escapeCasos, identCasos, prepararCasos (+23 more)

### Community 21 - "functionVars.js"
Cohesion: 0.09
Nodes (8): FakeWorker, runTests(), HEADERS, OpenFusionWebsocketClient, __dirname, __filename, safeStringify(), TasksInterval

### Community 22 - "EndpointRuntimeService.js"
Cohesion: 0.10
Nodes (24): failures, GUI_LANGS, check(), dump(), endpoint, extract(), main(), results (+16 more)

### Community 23 - "mcp.js"
Cohesion: 0.11
Nodes (29): nodemailer, cleanupExpiredRecoveryTokens(), deleteUser(), getAllUsers(), getUserById(), linkTelegramChat(), updatePasswordRecoveryChannel(), updateUser() (+21 more)

### Community 24 - "appvars.js"
Cohesion: 0.06
Nodes (31): docs, examples, main, skill, error_types, BOT_ERROR, CONNECTION_ERROR, INVALID_TOKEN (+23 more)

### Community 25 - "mcp_exhaustive_validation.js"
Cohesion: 0.16
Nodes (30): DEFAULT_NOTIFY_ACTIVITY, findGroupsVar(), getGroupLinksForChat(), GROUPS_VAR, normalizeNotifyActivity(), NOTIFY_ACTIVITY_MODES, parseJsonVar(), readAppGroupLinks() (+22 more)

### Community 26 - "models.js"
Cohesion: 0.09
Nodes (23): checkSystemApp(), getAllApps(), getAppById(), getAppFullById(), getApplicationsTreeByFilters(), getAppsCatalog(), getAppWithEndpoints(), sortCatalogEnvironments() (+15 more)

### Community 27 - "mcp_contract_audit.js"
Cohesion: 0.09
Nodes (16): BOT_SOURCE, here, repoRoot, SUPPORTED_TASK_VERBS, APP_JS, APP_PRD_JS, RAIZ, runTests() (+8 more)

### Community 28 - "websocket_manager.js"
Cohesion: 0.10
Nodes (27): ADMIN_BEARER, basic(), check(), countRecoveryRows(), createdEndpoints, db, DB_PATH, deniedOk() (+19 more)

### Community 29 - "app.js"
Cohesion: 0.17
Nodes (27): collectPublishedTools(), collectSchemaIdentifiers(), __dirname, DOMAIN_IDENTIFIERS, findings, getMcpField(), inSchema(), loadSeed() (+19 more)

### Community 30 - "app/index.js"
Cohesion: 0.12
Nodes (8): ajv, ajv, schema_input_hooks, schema_ws_message, validateSchemaMessageWebSocket, getUUID(), WebSocketValidateFormatChannelName(), WebSocketManager

### Community 31 - "endpoint.js"
Cohesion: 0.15
Nodes (21): ApiClientfindByIdOrUsername(), AuthorizedEnpointsClient, createApiClient(), defaultApiClient(), deleteApiClient(), loginApiClient(), normalizeClientDates(), updateApiClient() (+13 more)

### Community 32 - "sequelize.js"
Cohesion: 0.17
Nodes (25): from, cron-parser, luxon, camposDeTransicion(), reapStaleRunningTasks(), baseSpacingSeconds(), computeBackoffNextRun(), computeNextRun() (+17 more)

### Community 33 - "mcp_live_validation.js"
Cohesion: 0.19
Nodes (12): callTool(), __dirname, extractToolResult(), listTools(), loadMcpConfig(), main(), MCP_CONFIG_PATH, mcpRequest() (+4 more)

### Community 34 - "recordAudit"
Cohesion: 0.12
Nodes (23): appVars, failures, RFC-7230, soap, schema_input_genericSOAP, ajv, buildSoapClientOptions(), getSoapClient() (+15 more)

### Community 35 - "._build"
Cohesion: 0.09
Nodes (17): path-to-regexp, @rdsslab/uFetch, fetchOFAPI(), getInternalURL(), isAbsoluteUrl(), errors, getFunctionsFiles(), searchFiles() (+9 more)

### Community 36 - "dotenv"
Cohesion: 0.18
Nodes (26): getBotLogs(), ATTACK_TYPES, collectBotIncidents(), collectIntrusions(), collectServerErrors(), countClientErrors(), esc(), findAppVar() (+18 more)

### Community 37 - "validateHandlerDocs.js"
Cohesion: 0.10
Nodes (7): callMcp(), run(), callMcp(), run(), callMcp(), run(), dotenv

### Community 38 - "user/index.js"
Cohesion: 0.14
Nodes (23): createBotBackup(), getBotBackupByIdBot(), getBotBackupByIdBotLightweight(), hashObjectSync(), normalizeBotSnapshot(), sortObjectDeep(), VOLATILE_FIELDS, BOT_RUNTIME_ATTRIBUTES (+15 more)

### Community 39 - "doc_generator.js"
Cohesion: 0.21
Nodes (25): ACCESS_LABELS, accessLabel(), bodyExamples(), canonicalUrl(), createAiMetadata(), createAuthSection(), createCorsSection(), createCurlExample() (+17 more)

### Community 40 - "scripts"
Cohesion: 0.08
Nodes (25): scripts, audit:sql-binds, docs:handlers, docs:handlers:index, docs:handlers:validate, docs:js-api, docs:js-api:check, reinstall (+17 more)

### Community 41 - "sequelize"
Cohesion: 0.15
Nodes (22): sequelize, AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, createAuditLog(), truncateValue(), AuditLog, getActorFromParams(), getRequestMetaFromParams() (+14 more)

### Community 42 - "schedule.js"
Cohesion: 0.19
Nodes (10): captureConsole(), main(), makeTable(), test(), tick(), uuid(), CONNECTION_ERROR_CODES, CONNECTION_ERROR_NAMES (+2 more)

### Community 43 - "LogBuffer"
Cohesion: 0.18
Nodes (18): BACKOFF_TIER, BOT_HEALTHY_AFTER_MS, classifyBotFailure(), CODE_ERROR_NAMES, FAILURE_CLASS, isRecoverable(), maxFastBackoffMs(), NETWORK_ERROR_CODES (+10 more)

### Community 44 - "ia.js"
Cohesion: 0.19
Nodes (16): parseQualifiedName(), describeConnectionOverride(), recordConnectionOverride(), __dirname, __filename, hiveFunction(), RESERVED_HIVE_REQUEST_KEYS, runHiveWorker() (+8 more)

### Community 45 - "user.js"
Cohesion: 0.10
Nodes (19): configuration, code, custom_data, read_only, write, docs, examples, generated (+11 more)

### Community 46 - "Endpoint"
Cohesion: 0.16
Nodes (10): AuthService, actionFromMethod(), adminCtrl(), emptyCtrl(), fullAccessCtrl(), hasPermission(), METHOD_TO_ACTION, VALID_ACTIONS (+2 more)

### Community 47 - "ref_node_assert"
Cohesion: 0.20
Nodes (4): runTests(), EndpointLoader, getAppVarsObject(), url_key()

### Community 48 - "interval_tasks/index.js"
Cohesion: 0.22
Nodes (18): assertNoStackLeak(), AUTH_HEADER, call(), createProbeEndpoints(), deleteEndpoint(), __dirname, ensureServer(), findLeakedKey() (+10 more)

### Community 49 - "sqlFunction.js"
Cohesion: 0.15
Nodes (3): EndpointLogger, Endpoint, getLogLevelForStatus()

### Community 50 - "ref_node_fs"
Cohesion: 0.11
Nodes (17): configuration, code, custom_data, connection_config, connection_override_allow, database, options, password (+9 more)

### Community 51 - ".run"
Cohesion: 0.20
Nodes (16): getAuditLogs(), ACTION_VERB, buildReport(), collectChanges(), ENTITY_META, esc(), findAppVar(), fmtName() (+8 more)

### Community 52 - "soapFunction.js"
Cohesion: 0.14
Nodes (7): run(), run(), grammy, hive-driver, main(), NETWORK_ERROR_CODES, createFunctionVM()

### Community 53 - "server/utils.js"
Cohesion: 0.37
Nodes (16): auth(), callEndpoint(), check(), failures, login(), main(), pollUntil(), runtimeUrl() (+8 more)

### Community 54 - "MCP/manifest.json"
Cohesion: 0.21
Nodes (7): runTests(), OPTS_PG, runTests(), parseSseJson(), runTests(), basicAuthHeader(), TEST_BASE_URL

### Community 55 - "MCPToolRuntime"
Cohesion: 0.18
Nodes (8): PAQUETE, runTests(), versionDeLaEntradaMasReciente(), fnGetServerVersion(), fnListFnVarsHandlerJS(), listFunctionsVars(), packagePath, version

### Community 56 - "owasp_top10.js"
Cohesion: 0.19
Nodes (12): BASIC_AUTH_HEADER, call(), __dirname, ensureServer(), getStatusEntries(), loginAsAdmin(), ROOT_DIR, runTests() (+4 more)

### Community 57 - "SQL/manifest.json"
Cohesion: 0.18
Nodes (10): tedious, CONNECTION_EXHAUSTION_PATTERNS, ConnectionPool, getMaxConnections(), getValidationIdleMs(), isConnectionExhaustionError(), isValidationAlwaysEnabled(), Pool (+2 more)

### Community 58 - "handlerDocs.js"
Cohesion: 0.18
Nodes (12): login(), checkAPIToken(), checkToken(), CreateOpenFusionAPIToken(), getSystemToken(), getUserPasswordTokenFromRequest(), tokenVerify(), fnCreateApiClient() (+4 more)

### Community 59 - "auth_service.js"
Cohesion: 0.23
Nodes (14): parseAppVarBoolean(), consumePasswordRecovery(), createPasswordRecovery(), DEFAULT_USERS, defaultUser(), findActiveUserByUsername(), findVar(), getRecoveryChannelConfig() (+6 more)

### Community 60 - "appchanges/index.js"
Cohesion: 0.21
Nodes (3): BotManager, DB_BOTS, main()

### Community 61 - "lock_retry.js"
Cohesion: 0.28
Nodes (14): auditEndpoints(), callMcp(), ensureMcpResult(), extractArrayFromToolCall(), fetchApps(), fetchSqlEndpoints(), loginToServer(), main() (+6 more)

### Community 62 - "EndpointLoader"
Cohesion: 0.21
Nodes (7): AsyncTaskService, buildFingerprint(), sortObject(), AsyncJob, asyncWrapperFunction(), RESERVED_ASYNC_KEYS, runHandler()

### Community 63 - "ConnectionPool.js"
Cohesion: 0.26
Nodes (12): deleteApiKey(), getAllApiKeys(), getApiKeyByFilters(), getApiKeyById(), upsertApiKey(), restoreApiKeys(), fnDeleteApiKey(), fnGetAllApiKeys() (+4 more)

### Community 64 - "sqlHana.js"
Cohesion: 0.20
Nodes (11): BOT_RUNTIME_ATTRIBUTE_SET, botListingAttributes(), disableBot(), getActiveBots(), getBotCatalog(), getBotListingById(), updateBotRuntimeState(), RUNTIME_SUPPORTED_PROVIDERS (+3 more)

### Community 65 - "interval_task.js"
Cohesion: 0.32
Nodes (14): applySchemaDescription(), buildUnionSchema(), buildZodFromJsonSchema(), combineCombinatorsIfNeeded(), hasMeaningfulValidationKeywords(), jsonSchemaToZod(), makeArray(), makeEnum() (+6 more)

### Community 66 - "sql_bind_literal_audit.js"
Cohesion: 0.14
Nodes (9): __dirname, FAVICON_FILE, ICONS, OUT_DIR, OUT_FILE, pkg, PKG_PATH, repoUrl (+1 more)

### Community 67 - "generateDocs.js"
Cohesion: 0.16
Nodes (6): appVars, buildSttProviders(), buildTtsProviders(), safeJson(), TTS_BASES, WHISPER_URLS

### Community 68 - "generate-index-html.js"
Cohesion: 0.27
Nodes (13): callMcp(), defaultMcpJsonPath(), ensureMcpResult(), extractArray(), extractArrayFromToolCall(), fetchAllEndpoints(), listDuplicateToolNames(), loginToServer() (+5 more)

### Community 69 - "appvar_types_test.js"
Cohesion: 0.21
Nodes (13): auth, call(), cd(), check(), createEndpoint(), deleteEndpoint(), ENGINES, failures (+5 more)

### Community 71 - "handler_db_matrix.mjs"
Cohesion: 0.21
Nodes (11): borrarEndpoint(), CASOS, crearEndpoint(), DEMO, fallosConocidos, fallosNuevos, H, llamar() (+3 more)

### Community 72 - "sql_comments_test.js"
Cohesion: 0.28
Nodes (12): BASIC_AUTH_HEADER, call(), connectWebSocket(), __dirname, ensureServer(), loginAsAdmin(), ROOT_DIR, runTests() (+4 more)

### Community 73 - "server/endpoint/index.js"
Cohesion: 0.24
Nodes (3): object-hash, MetricsCollector, get_url_params()

### Community 74 - "intervalTaskDocs.js"
Cohesion: 0.15
Nodes (12): configuration, agentGuidance, code, custom_data, docs, examples, generated, main (+4 more)

### Community 75 - "apikey/index.js"
Cohesion: 0.23
Nodes (10): borrarEndpoint(), CASOS, CNX, crearEndpoint(), fallos, H, llamar(), registrar() (+2 more)

### Community 76 - "botDocs.js"
Cohesion: 0.27
Nodes (11): capturaConsola(), cuerpoDeLaFuncion(), dobleEndpoint(), endpoint(), HERE, mcpDe(), montaLaFuncion(), NOMBRES_ACEPTADOS (+3 more)

### Community 77 - "TimedCache"
Cohesion: 0.27
Nodes (10): CASOS, ERRORES, connections, construirComandoHana(), executeQuery(), getConnection(), invalidatePool(), RESERVED_HANA_REQUEST_KEYS (+2 more)

### Community 78 - "isPlainObject"
Cohesion: 0.32
Nodes (11): chrome-launcher, puppeteer-core, @sparticuz/chromium, createImage(), createPDF(), getBrowser(), loadPage(), releaseWorker() (+3 more)

### Community 79 - "ws_cache_events.js"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 80 - "EndpointLogger.js"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 81 - "SOAP/manifest.json"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 82 - "mcp_conflict_on_restore_test.js"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 83 - "pdf-generator.js"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 84 - "FETCH/manifest.json"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 85 - "FUNCTION/manifest.json"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 86 - "HANA/manifest.json"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 87 - "JS/manifest.json"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 90 - "SQL_BULK_I/manifest.json"
Cohesion: 0.22
Nodes (7): appVars, code, grammyModule, patchProto(), registered, require, runSandbox()

### Community 91 - "TEXT/manifest.json"
Cohesion: 0.31
Nodes (8): capturandoErrores(), instrumentarUpsert(), METODOS_ESPERADOS, runTests(), defaultMethods(), getAllMethods(), Method, fnGetMethod()

### Community 92 - ".run"
Cohesion: 0.40
Nodes (10): authHeader, call(), callWithRetry(), deleteEndpoint(), getDemoIdapp(), login(), main(), runIntegration504Test() (+2 more)

### Community 93 - "cache_validation.js"
Cohesion: 0.18
Nodes (10): label, namespace, observability, channel, event, tool, runtime_attributes, schedule_modes (+2 more)

### Community 94 - "fetch_timeout_test.js"
Cohesion: 0.18
Nodes (11): runtime, default_exec_time_limit_seconds, default_history_limit, default_interval_seconds, default_max_failed_attempts, max_backoff_seconds, max_stored_response_chars, reaper_grace_seconds (+3 more)

### Community 95 - "hana_comments_live_test.js"
Cohesion: 0.22
Nodes (6): BOT_LOG_EVENTS, BOT_LOG_LEVEL, createBotLog(), createBotLogsBulk(), truncateValue(), BotLog

### Community 97 - "runtime"
Cohesion: 0.42
Nodes (9): authenticate(), BASIC_AUTH, call(), createBot(), createdBots, getBot(), main(), test() (+1 more)

### Community 98 - "bot_log.js"
Cohesion: 0.42
Nodes (9): authHeader, call(), callWithRetry(), CASES, deleteEndpoint(), getDemoIdapp(), login(), run() (+1 more)

### Community 99 - "endpointCorsPolicy.js"
Cohesion: 0.40
Nodes (9): extractMssqlErrorNumber(), isLiveAppVarsRefreshEnabled(), mergeAppVarsByEnvironment(), RESERVED_SQL_REQUEST_KEYS, sqlFunction(), detectSqlParamStyle(), resolveAppVar(), resolveAppVarPlaceholder() (+1 more)

### Community 100 - "basicAuthHeader"
Cohesion: 0.28
Nodes (8): DEFECTO_ANTIGUO, expresionDbPath(), HERE, OBJETIVO, README, REPO_ROOT, resuelveDbPath(), runTests()

### Community 101 - "bot_resilience_test.js"
Cohesion: 0.22
Nodes (7): __dirname, match, problems, SEED, source, tools, UNSUPPORTED_JSON_SCHEMA_KEYS

### Community 102 - "exception_payload_test.js"
Cohesion: 0.22
Nodes (9): exclusivity, task_group, columns, default_policy, description, error_code, ignored_when, policy_values (+1 more)

### Community 103 - "mssql_query_generator.js"
Cohesion: 0.22
Nodes (9): storage, column_migration, db_layer, history_db_layer, history_table, model, parent, primary_key (+1 more)

### Community 104 - "db_path_override_test.js"
Cohesion: 0.33
Nodes (8): getAuditLogById(), getAuditLogStats(), parseJsonSnapshot(), pruneAuditLogsBefore(), fnAuditLogRetentionPrune(), fnAuditLogSearch(), fnAuditLogStats(), getRetentionDays()

### Community 105 - "mcp_schema_smoke.mjs"
Cohesion: 0.54
Nodes (7): BASIC_AUTH, call(), getBot(), history(), main(), saveBot(), test()

### Community 106 - "utils_path.js"
Cohesion: 0.39
Nodes (5): ENV_VARS, buildBotConfigHash(), isRuntimeStateVar(), RUNTIME_STATE_VAR_SUFFIXES, stripRuntimeStateVars()

### Community 107 - "storage"
Cohesion: 0.25
Nodes (5): botDb, botsHandlers, __dirname, endpointDb, repoRoot

### Community 108 - "bot_backup_test.js"
Cohesion: 0.25
Nodes (4): apiclientSource, auditSource, here, repoRoot

### Community 109 - "listing_projection_test.js"
Cohesion: 0.32
Nodes (7): APP_VARS, main(), mockReply, mockRequest, runEndpoint(), show(), ssh2-sftp-client

### Community 110 - "mcp_docs_consistency_test.mjs"
Cohesion: 0.25
Nodes (8): allowScripts, canvas@3.2.3, @google/genai@1.52.0, oracledb@6.10.0, protobufjs@7.6.5, puppeteer@25.8.0, @sap/hana-client@2.29.25, sqlite3@6.0.1

### Community 111 - "allowScripts"
Cohesion: 0.25
Nodes (8): applies_to, column, db_layer, description, error_code, lease_seconds, lock_table, endpoint

### Community 112 - "audit/index.js"
Cohesion: 0.29
Nodes (7): overrides, @azure/identity, @azure/msal-node, minimatch, sequelize, tar, uuid

### Community 113 - "resolveProviderConfig"
Cohesion: 0.29
Nodes (6): category, description, handler, icon, label, name

### Community 114 - "concurrency.js"
Cohesion: 0.29
Nodes (7): task_status, 0, 1, 2, 3, 4, 5

### Community 117 - "default/index.js"
Cohesion: 0.60
Nodes (5): callMcp(), main(), normalizeJsonc(), parseToolCallContent(), resolveMcpConfig()

### Community 118 - "JSON_ADAPTER"
Cohesion: 0.33
Nodes (6): cron, interval, schedule_mode, schedule_mode, ui, conditional_fields

### Community 119 - "errorPayload.js"
Cohesion: 0.33
Nodes (6): column, default, description, hard_maximum, minimum, max_backoff_seconds_per_task

### Community 120 - "simulate_loader.js"
Cohesion: 0.60
Nodes (3): run(), functionsVars(), createFunction()

### Community 121 - "createFunctionVM"
Cohesion: 0.50
Nodes (4): dataTestDelEditor, envuelto(), run(), AVISO_DATA_TEST_NORMALIZADO

### Community 122 - "ref_node_path"
Cohesion: 0.70
Nodes (4): callMcp(), main(), normalizeJsonc(), resolveMcpConfig()

### Community 123 - "mcp_schema_conversion.js"
Cohesion: 0.40
Nodes (5): suspension, column, description, reason_column, value

### Community 124 - "overrides"
Cohesion: 0.60
Nodes (3): effectiveStatus(), fnGetAsyncJobStatus(), fnListAsyncJobs()

### Community 125 - "conditional_fields"
Cohesion: 0.50
Nodes (3): jsonDeepFilterOptimized(), matches(), recurse()

### Community 126 - "max_backoff_seconds_per_task"
Cohesion: 0.70
Nodes (3): userRegister(), escapeRegExp(), replaceStringTemplate()

### Community 127 - "stableStringify"
Cohesion: 0.50
Nodes (3): mssql_demo_bind, mssql_demo_constant, mssql_demo_trans

### Community 128 - "db_unbounded_writes_test.js"
Cohesion: 0.50
Nodes (3): graphify-mcp, graphify_local, openfusion_system_remote_prd

### Community 129 - "mcp_tool_descriptions.js"
Cohesion: 0.50
Nodes (4): column, default, description, backoff_enabled

### Community 130 - "@rdsslab/uFetch"
Cohesion: 0.50
Nodes (4): crud_tools, read, skill, write

### Community 131 - "suspension"
Cohesion: 0.50
Nodes (4): docs, human_guide, main, skill

### Community 132 - "recurse"
Cohesion: 0.50
Nodes (4): scheduler_delay_ms, maximum_heartbeat, minimum, strategy

### Community 134 - "backoff_enabled"
Cohesion: 0.67
Nodes (3): repository, type, url

## Knowledge Gaps
- **14 isolated node(s):** `graphify-mcp`, `@anthropic-ai/sdk`, `@google/genai`, `mariadb`, `mongose` (+9 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 903 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `sequelize` connect `sequelize` to `sqlHana.js`, `manager.js`, `systemBot.telegram.js`, `log.js`, `handler.js`, `endpointCorsPolicy.js`, `apiclient/index.js`, `handler/utils.js`, `TasksInterval`, `ia.js`, `system/prd/index.js`, `telegram/manifest.json`, `hana_comments_live_test.js`, `SQL/manifest.json`, `auth_service.js`, `EndpointLoader`, `endpoint.js`?**
  _High betweenness centrality (0.049) - this node is a cross-community bridge._
- **What connects `graphify-mcp`, `@anthropic-ai/sdk`, `@google/genai` to the rest of the system?**
  _14 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `manager.js` be split into smaller, more focused modules?**
  _Cohesion score 0.054746835443037975 - nodes in this community are weakly interconnected._
- **Why does `dependencies` connect `prd/endpoint/index.js` to `log.js`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.05063291139240506 - nodes in this community are weakly interconnected._
- **Why does `dotenv` connect `validateHandlerDocs.js` to `log.js`, `handler.js`, `apiclient/index.js`, `TasksInterval`, `task_status`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Should `systemBot.telegram.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05092276144907724 - nodes in this community are weakly interconnected._