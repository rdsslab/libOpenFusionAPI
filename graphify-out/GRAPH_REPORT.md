# Graph Report - libOpenFusionAPI  (2026-10-18)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2584 nodes · 5798 edges · 143 communities (135 shown, 8 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 110 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `73a889b2`
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
- interval_tasks/manifest.json
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
- user_register.js
- backoff_enabled
- docs
- observability
- scheduler_delay_ms
- repository
- getAppsCatalog
- .mcp.json
- canvas

## God Nodes (most connected - your core abstractions)
1. `recordAudit()` - 46 edges
2. `scripts` - 25 edges
3. `getAppVarsByIdApp()` - 24 edges
4. `sequelize` - 24 edges
5. `sqlFunction()` - 23 edges
6. `upsertAppVar()` - 22 edges
7. `replyException()` - 22 edges
8. `Endpoint` - 21 edges
9. `basicAuthHeader()` - 21 edges
10. `restoreAppFromBackup()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `run()` --calls--> `ServerAPI`  [EXTRACTED]
  dev/scratch/test_integration_flow.js → src/lib/index.js
- `buildRuntime()` --calls--> `EndpointRuntimeService`  [EXTRACTED]
  dev/test/rate_limit_integration_test.js → src/lib/server/runtime/EndpointRuntimeService.js
- `auditEndpoints()` --calls--> `prepararSqlParaBinds()`  [EXTRACTED]
  dev/test/sql_bind_literal_audit.js → src/lib/handler/utils.js
- `runTests()` --calls--> `updateIntervalTaskStatus()`  [EXTRACTED]
  dev/test/interval_task_upsert_test.js → src/lib/db/interval_task.js
- `run()` --calls--> `functionsVars()`  [EXTRACTED]
  dev/scratch/test_vm.js → src/lib/server/functionVars.js

## Import Cycles
- 4-file cycle: `src/lib/db/log.js -> src/lib/db/models.js -> src/lib/server/utils.js -> src/lib/server/functionVars.js -> src/lib/db/log.js`
- 5-file cycle: `src/lib/db/endpoint.js -> src/lib/db/models.js -> src/lib/server/utils.js -> src/lib/server/functionVars.js -> src/lib/db/log.js -> src/lib/db/endpoint.js`

## Communities (143 total, 8 thin omitted)

### Community 0 - "manager.js"
Cohesion: 0.06
Nodes (33): ENV_VARS, grammy, getActiveBots(), updateBotRuntimeState(), buildBotConfigHash(), isRuntimeStateVar(), RUNTIME_STATE_VAR_SUFFIXES, stripRuntimeStateVars() (+25 more)

### Community 1 - "dependencies"
Cohesion: 0.04
Nodes (56): dependencies, acorn, ajv, @anthropic-ai/sdk, canvas, chrome-launcher, cron-parser, dotenv (+48 more)

### Community 2 - "systemBot.telegram.js"
Cohesion: 0.10
Nodes (47): api(), changePassword(), ENV_ORDER, esc(), findVar(), finishLink(), forgotPassword(), getAppsEnvIndex() (+39 more)

### Community 3 - "log.js"
Cohesion: 0.11
Nodes (40): getAllEndpoints(), createLog(), getAppEndpointUsageSummary(), getAvgResponseTimeByMinute(), getCountsByMinute(), getEnvironmentFilter(), getLogsRecordsPerMinute(), getLogsStatusClassPerMinute() (+32 more)

### Community 4 - "handler.js"
Cohesion: 0.13
Nodes (26): run(), customFunction(), VALID_DATA_TYPES, validateFnResult(), fetchFunction(), jsFunction(), mcpFunction(), connectionCache (+18 more)

### Community 5 - "codeValidator.js"
Cohesion: 0.09
Nodes (29): main(), parse(), acorn, fnValidateEndpointCode(), APPLICABLE_HANDLERS, applyTextFixes(), collectUfetchAliases(), MATCHERS (+21 more)

### Community 6 - "bots/manifest.json"
Cohesion: 0.05
Nodes (39): code_language, crud_tools, read, skill, write, docs, main, skill (+31 more)

### Community 7 - "prd/endpoint/index.js"
Cohesion: 0.08
Nodes (32): createEndpointBackup(), getEndpointBackupById(), getEndpointBackupByIdEndpoint(), getEndpointBackupByIdEndpointLightweight(), hashObjectSync(), sortObjectDeep(), deleteEndpoint(), getEndpointById() (+24 more)

### Community 8 - "bots/index.js"
Cohesion: 0.10
Nodes (32): restoreBots(), createBotBackup(), getBotBackupByIdBot(), getBotBackupByIdBotLightweight(), hashObjectSync(), normalizeBotSnapshot(), sortObjectDeep(), VOLATILE_FIELDS (+24 more)

### Community 9 - "apiclient/index.js"
Cohesion: 0.13
Nodes (28): ApiClientfindByIdOrUsername(), AuthorizedEnpointsClient, createApiClient(), defaultApiClient(), deleteApiClient(), loginApiClient(), normalizeClientDates(), updateApiClient() (+20 more)

### Community 10 - "alerts/index.js"
Cohesion: 0.14
Nodes (34): getLogs(), getLogsByEndpoint(), getMessageEventColumn(), getMessageEventFilter(), serializeValue(), throwValidationError(), getExposedEnvironmentsList(), ATTACK_TYPES (+26 more)

### Community 11 - "handler/utils.js"
Cohesion: 0.11
Nodes (31): avisoCasos, cases, dialectCases, dollarCases, dollarIntactCases, escapeCasos, identCasos, prepararCasos (+23 more)

### Community 12 - "TasksInterval"
Cohesion: 0.09
Nodes (8): FakeWorker, runTests(), HEADERS, OpenFusionWebsocketClient, __dirname, __filename, safeStringify(), TasksInterval

### Community 13 - "package.json"
Cohesion: 0.06
Nodes (33): author, bugs, url, description, devDependencies, @types/ws, homepage, keywords (+25 more)

### Community 14 - "timeSync.js"
Cohesion: 0.09
Nodes (15): systeminformation, BackgroundTaskManager, fnGetSystemInfoDynamic(), ServerReadyOrchestrator, SystemInfoTask, TimeSyncTask, ConvertStringToNumber(), getSystemInfoDynamic() (+7 more)

### Community 15 - "RateLimitService.js"
Cohesion: 0.12
Nodes (14): buildRuntime(), AUTH_LOCKOUT_BASE_MS_DEFAULT, AUTH_LOCKOUT_MAX_MS_DEFAULT, AUTH_MAX_FAILURES_DEFAULT, AUTH_PRUNING_AGE_MS_DEFAULT, AUTH_WINDOW_MS_DEFAULT, getBasicUsernameFromRequest(), isEntryExpired() (+6 more)

### Community 16 - "system/prd/index.js"
Cohesion: 0.12
Nodes (22): PAQUETE, runTests(), versionDeLaEntradaMasReciente(), @modelcontextprotocol/sdk, fnGetServerVersion(), fnListFnVarsHandlerJS(), packagePath, version (+14 more)

### Community 17 - "telegram/manifest.json"
Cohesion: 0.06
Nodes (31): docs, examples, main, skill, error_types, BOT_ERROR, CONNECTION_ERROR, INVALID_TOKEN (+23 more)

### Community 18 - "appgroups/index.js"
Cohesion: 0.16
Nodes (30): DEFAULT_NOTIFY_ACTIVITY, findGroupsVar(), getGroupLinksForChat(), GROUPS_VAR, normalizeNotifyActivity(), NOTIFY_ACTIVITY_MODES, parseJsonVar(), readAppGroupLinks() (+22 more)

### Community 19 - "timer/worker.js"
Cohesion: 0.10
Nodes (24): rescheduleIntervalTask(), createIntervalTaskRun(), pruneIntervalTaskRuns(), truncateResponse(), createLogEntriesBulk(), IntervalTaskRun, getResponseOutcome(), abortedByOperator (+16 more)

### Community 20 - "lib/index.js"
Cohesion: 0.09
Nodes (21): getApplicationEndpointByRoute(), ensureApiClientExpTimeColumn(), ensureBotRuntimeColumns(), backfillLegacySuspensions(), ensureIntervalTaskColumns(), PasswordRecovery, prefixTableName(), tblDemo (+13 more)

### Community 21 - "functionVars.js"
Cohesion: 0.08
Nodes (25): jsdom, ldapts, luxon, mongoose, node-forge, pdfjs-dist, qr-code-styling, @rdsslab/sequential-promises (+17 more)

### Community 22 - "EndpointRuntimeService.js"
Cohesion: 0.12
Nodes (9): assertFunction(), assertObject(), validateEndpointContext(), validateEndpointRuntimeDependencies(), validateFunctionRegistryDependencies(), EndpointPreValidationService, EndpointRequestFlowService, hasCredentials() (+1 more)

### Community 23 - "mcp.js"
Cohesion: 0.13
Nodes (22): __dirname, MCP_HANDLER_SOURCE, zod, getApplicationTreeByFilters(), CreateMCPHandler(), buildExposureNotice(), computeExposedEnvironments(), ENV_KEY_MAP (+14 more)

### Community 24 - "appvars.js"
Cohesion: 0.13
Nodes (23): create(), created, cycleBackupRestore(), failures, parseAppVar(), APPVAR_NAME_MAX_LENGTH, APPVAR_NAME_PREFIX, APPVAR_NAME_REGEX (+15 more)

### Community 25 - "mcp_exhaustive_validation.js"
Cohesion: 0.11
Nodes (26): ADMIN_BEARER, basic(), check(), countRecoveryRows(), createdEndpoints, db, DB_PATH, deniedOk() (+18 more)

### Community 26 - "models.js"
Cohesion: 0.12
Nodes (20): uuid, BOT_RUNTIME_ATTRIBUTE_SET, BOT_RUNTIME_ATTRIBUTES, ApiClient, ApiKey, Application, AppVars, Bot (+12 more)

### Community 27 - "mcp_contract_audit.js"
Cohesion: 0.17
Nodes (27): collectPublishedTools(), collectSchemaIdentifiers(), __dirname, DOMAIN_IDENTIFIERS, findings, getMcpField(), inSchema(), loadSeed() (+19 more)

### Community 28 - "websocket_manager.js"
Cohesion: 0.12
Nodes (8): ajv, ajv, schema_input_hooks, schema_ws_message, validateSchemaMessageWebSocket, getUUID(), WebSocketValidateFormatChannelName(), WebSocketManager

### Community 29 - "app.js"
Cohesion: 0.12
Nodes (26): upsertApiClient(), buildSystemCheckReport(), cierreEscrituras, ENV_CATALOG_ORDER, findEquivalentIntervalTasks(), normalizeTaskParams(), replace_GENTOKEN(), replace_NODEMAILER() (+18 more)

### Community 30 - "app/index.js"
Cohesion: 0.13
Nodes (25): deepClone(), runTests(), checkSystemApp(), getAllApps(), getAllAppsBackup(), getAppBackupById(), getAppById(), getAppFullById() (+17 more)

### Community 31 - "endpoint.js"
Cohesion: 0.14
Nodes (21): dataTestDelEditor, envuelto(), run(), AVISO_DATA_TEST_NORMALIZADO, CLAVES_DE_DATA_TEST, ensureUniqueEnabledMcpName(), esAuthDeDataTest(), esBodyDeDataTest() (+13 more)

### Community 32 - "sequelize.js"
Cohesion: 0.14
Nodes (20): conBigint, dialect, Sonda, sequelize, assignBigint(), attachBigintNormalization(), esInstanciaDeModelo(), normalizeBigintValues() (+12 more)

### Community 33 - "mcp_live_validation.js"
Cohesion: 0.19
Nodes (12): callTool(), __dirname, extractToolResult(), listTools(), loadMcpConfig(), main(), MCP_CONFIG_PATH, mcpRequest() (+4 more)

### Community 34 - "recordAudit"
Cohesion: 0.13
Nodes (24): AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, createAuditLog(), getAuditLogById(), parseJsonSnapshot(), truncateValue(), AuditLog, getActorFromParams() (+16 more)

### Community 35 - "._build"
Cohesion: 0.13
Nodes (4): ServerAPI, DbHookCacheInvalidationService, FunctionRegistryService, OFAPIServer

### Community 36 - "dotenv"
Cohesion: 0.10
Nodes (7): callMcp(), run(), callMcp(), run(), callMcp(), run(), dotenv

### Community 37 - "validateHandlerDocs.js"
Cohesion: 0.12
Nodes (20): newVersion, packageData, packagePath, parts, main(), OUTPUT_FILE, renderRuntimeHandlers(), HANDLER_DOC_REQUIRED_FILES (+12 more)

### Community 38 - "user/index.js"
Cohesion: 0.14
Nodes (23): nodemailer, cleanupExpiredRecoveryTokens(), deleteUser(), getAllUsers(), getUserById(), linkTelegramChat(), updatePasswordRecoveryChannel(), updateUser() (+15 more)

### Community 39 - "doc_generator.js"
Cohesion: 0.21
Nodes (25): ACCESS_LABELS, accessLabel(), bodyExamples(), canonicalUrl(), createAiMetadata(), createAuthSection(), createCorsSection(), createCurlExample() (+17 more)

### Community 40 - "scripts"
Cohesion: 0.08
Nodes (25): scripts, audit:sql-binds, docs:handlers, docs:handlers:index, docs:handlers:validate, docs:js-api, docs:js-api:check, reinstall (+17 more)

### Community 41 - "sequelize"
Cohesion: 0.11
Nodes (5): getAllMethods(), login(), fnGetMethod(), fnLogin(), customError()

### Community 42 - "schedule.js"
Cohesion: 0.21
Nodes (22): from, camposDeTransicion(), reapStaleRunningTasks(), baseSpacingSeconds(), computeBackoffNextRun(), computeNextRun(), computeSchedulerDelay(), getIntervalSeconds() (+14 more)

### Community 43 - "LogBuffer"
Cohesion: 0.19
Nodes (10): captureConsole(), main(), makeTable(), test(), tick(), uuid(), CONNECTION_ERROR_CODES, CONNECTION_ERROR_NAMES (+2 more)

### Community 44 - "ia.js"
Cohesion: 0.12
Nodes (21): @anthropic-ai/sdk, @google/genai, openai, AI_PROVIDER_PRESETS, askAIWithTools, buildToolCallFingerprint(), BUILTIN_PROVIDER_PRESETS, convertToAnthropicMessages() (+13 more)

### Community 45 - "user.js"
Cohesion: 0.14
Nodes (19): consumePasswordRecovery(), createPasswordRecovery(), createUser(), DEFAULT_USERS, defaultUser(), findActiveUserByUsername(), findVar(), getRecoveryChannelConfig() (+11 more)

### Community 47 - "ref_node_assert"
Cohesion: 0.14
Nodes (14): closeDb(), capturandoErrores(), instrumentarUpsert(), METODOS_ESPERADOS, runTests(), OPTS_PG, createResponse(), run() (+6 more)

### Community 48 - "interval_tasks/index.js"
Cohesion: 0.21
Nodes (21): runTests(), taskIdentities(), defaultApps(), deleteIntervalTask(), esUUIDTask(), getIntervalTaskById(), resetIntervalTaskAttempts(), getIntervalTaskRuns() (+13 more)

### Community 49 - "sqlFunction.js"
Cohesion: 0.20
Nodes (17): parseQualifiedName(), describeConnectionOverride(), recordConnectionOverride(), extractMssqlErrorNumber(), isLiveAppVarsRefreshEnabled(), mergeAppVarsByEnvironment(), RESERVED_SQL_REQUEST_KEYS, sqlFunction() (+9 more)

### Community 50 - "ref_node_fs"
Cohesion: 0.11
Nodes (11): BOT_SOURCE, here, repoRoot, SUPPORTED_TASK_VERBS, dbFile, here, repoRoot, dbFile (+3 more)

### Community 51 - ".run"
Cohesion: 0.14
Nodes (15): buildToolUsageGuidance(), extractAnthropicText(), extractFirstUrl(), extractLastUserMessageText(), formatToolResult(), getRequiredToolParameters(), getToolSchemaProperties(), hasSuccessfulToolExecution() (+7 more)

### Community 52 - "soapFunction.js"
Cohesion: 0.19
Nodes (18): RFC-7230, schema_input_genericSOAP, ajv, buildSoapClientOptions(), getSoapClient(), getWsdlAuthorizationHeader(), invalidateSoapClient(), normalizeSoapError() (+10 more)

### Community 53 - "server/utils.js"
Cohesion: 0.14
Nodes (10): jsonwebtoken, URLAutoEnvironment, emitHook(), errors, getFunctionsFiles(), searchFiles(), getPathParts(), internal_url_post_hooks (+2 more)

### Community 54 - "MCP/manifest.json"
Cohesion: 0.10
Nodes (19): configuration, code, custom_data, read_only, write, docs, examples, generated (+11 more)

### Community 55 - "MCPToolRuntime"
Cohesion: 0.18
Nodes (10): AIProviderMCPClient, askIAWithMCP(), askIAWithProviderMCP(), connectMcpServer(), createAIProviderMCPClient(), listMcpTools(), listMcpToolsForProvider(), MCPToolRuntime (+2 more)

### Community 56 - "owasp_top10.js"
Cohesion: 0.22
Nodes (18): assertNoStackLeak(), AUTH_HEADER, call(), createProbeEndpoints(), deleteEndpoint(), __dirname, ensureServer(), findLeakedKey() (+10 more)

### Community 57 - "SQL/manifest.json"
Cohesion: 0.11
Nodes (17): configuration, code, custom_data, connection_config, connection_override_allow, database, options, password (+9 more)

### Community 58 - "handlerDocs.js"
Cohesion: 0.20
Nodes (15): getHandlerDoc(), getHandlerLibraryDoc(), Handlers, fnGetHandlerDocs(), fnGetHandlerLibraryDocs(), fnGetHandlerSkill(), __dirname, __filename (+7 more)

### Community 59 - "auth_service.js"
Cohesion: 0.18
Nodes (10): AuthService, actionFromMethod(), adminCtrl(), emptyCtrl(), fullAccessCtrl(), hasPermission(), METHOD_TO_ACTION, VALID_ACTIONS (+2 more)

### Community 60 - "appchanges/index.js"
Cohesion: 0.21
Nodes (16): ACTION_VERB, buildReport(), collectChanges(), ENTITY_META, esc(), findAppVar(), fmtName(), fmtTime() (+8 more)

### Community 61 - "lock_retry.js"
Cohesion: 0.19
Nodes (12): errorSequelize(), errorTedious(), query(), adjuntarReintentoAnteBloqueo(), crearRegistrador(), esErrorDeBloqueo(), esperaDelReintento(), identificadoresDeError() (+4 more)

### Community 62 - "EndpointLoader"
Cohesion: 0.24
Nodes (4): runTests(), EndpointLoader, getAppVarsObject(), url_key()

### Community 63 - "ConnectionPool.js"
Cohesion: 0.18
Nodes (10): tedious, CONNECTION_EXHAUSTION_PATTERNS, ConnectionPool, getMaxConnections(), getValidationIdleMs(), isConnectionExhaustionError(), isValidationAlwaysEnabled(), Pool (+2 more)

### Community 64 - "sqlHana.js"
Cohesion: 0.18
Nodes (12): appVars, failures, CASOS, ERRORES, connections, construirComandoHana(), executeQuery(), getConnection() (+4 more)

### Community 65 - "interval_task.js"
Cohesion: 0.18
Nodes (11): runTests(), buildTaskEnvironmentFilter(), getIntervalTask(), getIntervalTaskProcess(), getNextIntervalTaskRun(), INTERVAL_TASK_RUNTIME_ATTRIBUTES, LOTE_TAREAS_POR_DEFECTO, parseJSONField() (+3 more)

### Community 66 - "sql_bind_literal_audit.js"
Cohesion: 0.28
Nodes (14): auditEndpoints(), callMcp(), ensureMcpResult(), extractArrayFromToolCall(), fetchApps(), fetchSqlEndpoints(), loginToServer(), main() (+6 more)

### Community 67 - "generateDocs.js"
Cohesion: 0.23
Nodes (13): buildDocs(), checkDocs(), __dirname, __filename, generateIndexMarkdown(), generateLibraryMarkdown(), main(), normalizeEol() (+5 more)

### Community 68 - "generate-index-html.js"
Cohesion: 0.14
Nodes (9): __dirname, FAVICON_FILE, ICONS, OUT_DIR, OUT_FILE, pkg, PKG_PATH, repoUrl (+1 more)

### Community 69 - "appvar_types_test.js"
Cohesion: 0.25
Nodes (11): failures, GUI_LANGS, APPVAR_BOOLEAN_TRUE_VALUES, APPVAR_TYPE_ALIASES, APPVAR_TYPE_MAX_LENGTH, APPVAR_TYPES, APPVAR_TYPES_ACCEPTED, editDistance() (+3 more)

### Community 70 - "check_mcp_name_uniqueness.js"
Cohesion: 0.27
Nodes (13): callMcp(), defaultMcpJsonPath(), ensureMcpResult(), extractArray(), extractArrayFromToolCall(), fetchAllEndpoints(), listDuplicateToolNames(), loginToServer() (+5 more)

### Community 71 - "handler_db_matrix.mjs"
Cohesion: 0.21
Nodes (13): auth, call(), cd(), check(), createEndpoint(), deleteEndpoint(), ENGINES, failures (+5 more)

### Community 72 - "sql_comments_test.js"
Cohesion: 0.19
Nodes (12): borrarEndpoint(), CASOS, crearEndpoint(), DEMO, fallosConocidos, fallosNuevos, H, llamar() (+4 more)

### Community 73 - "server/endpoint/index.js"
Cohesion: 0.24
Nodes (4): object-hash, EndpointCache, MetricsCollector, get_url_params()

### Community 74 - "intervalTaskDocs.js"
Cohesion: 0.20
Nodes (11): __dirname, DOCS_ROOT, expandDocIncludes(), __filename, resolveIncludePath(), fnGetIntervalTaskSkill(), __dirname, __filename (+3 more)

### Community 75 - "apikey/index.js"
Cohesion: 0.29
Nodes (11): deleteApiKey(), getAllApiKeys(), getApiKeyByFilters(), getApiKeyById(), upsertApiKey(), fnDeleteApiKey(), fnGetAllApiKeys(), fnGetApiKeyByFilters() (+3 more)

### Community 76 - "botDocs.js"
Cohesion: 0.23
Nodes (13): BOT_DOC_REQUIRED_FILES, BOT_DOCS_ROOT, BOT_PROVIDERS_ROOT, __dirname, __filename, getBotProviderDocDir(), listBotProviders(), listProviderFolders() (+5 more)

### Community 78 - "isPlainObject"
Cohesion: 0.24
Nodes (13): AnthropicAdapter, createLegacySseRpcClient(), createTransport(), extractAssistantToolParameters(), isPlainObject(), normalizeAnthropicToolChoice(), normalizeHeadersObject(), normalizeToolArguments() (+5 more)

### Community 79 - "ws_cache_events.js"
Cohesion: 0.28
Nodes (12): BASIC_AUTH_HEADER, call(), connectWebSocket(), __dirname, ensureServer(), loginAsAdmin(), ROOT_DIR, runTests() (+4 more)

### Community 80 - "EndpointLogger.js"
Cohesion: 0.19
Nodes (4): EndpointLogger, cleanVar(), getLogLevelForStatus(), replaceAllFast()

### Community 81 - "SOAP/manifest.json"
Cohesion: 0.15
Nodes (12): configuration, agentGuidance, code, custom_data, docs, examples, generated, main (+4 more)

### Community 82 - "mcp_conflict_on_restore_test.js"
Cohesion: 0.27
Nodes (11): capturaConsola(), cuerpoDeLaFuncion(), dobleEndpoint(), endpoint(), HERE, mcpDe(), montaLaFuncion(), NOMBRES_ACEPTADOS (+3 more)

### Community 83 - "pdf-generator.js"
Cohesion: 0.32
Nodes (11): chrome-launcher, puppeteer-core, @sparticuz/chromium, createImage(), createPDF(), getBrowser(), loadPage(), releaseWorker() (+3 more)

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

### Community 88 - "MONGODB/manifest.json"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 89 - "NA/manifest.json"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 90 - "SQL_BULK_I/manifest.json"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 91 - "TEXT/manifest.json"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 92 - ".run"
Cohesion: 0.23
Nodes (4): BaseProviderAdapter, createExecutionSignal(), GoogleGenAIAdapter, normalizeGeminiToolConfig()

### Community 93 - "cache_validation.js"
Cohesion: 0.33
Nodes (10): BASIC_AUTH_HEADER, call(), __dirname, ensureServer(), getStatusEntries(), loginAsAdmin(), ROOT_DIR, runTests() (+2 more)

### Community 94 - "fetch_timeout_test.js"
Cohesion: 0.40
Nodes (10): authHeader, call(), callWithRetry(), deleteEndpoint(), getDemoIdapp(), login(), main(), runIntegration504Test() (+2 more)

### Community 95 - "hana_comments_live_test.js"
Cohesion: 0.25
Nodes (9): borrarEndpoint(), CASOS, CNX, crearEndpoint(), fallos, H, llamar(), registrar() (+1 more)

### Community 96 - "interval_tasks/manifest.json"
Cohesion: 0.18
Nodes (10): crud_tools, read, skill, write, label, namespace, runtime_attributes, schedule_modes (+2 more)

### Community 97 - "runtime"
Cohesion: 0.18
Nodes (11): runtime, default_exec_time_limit_seconds, default_history_limit, default_interval_seconds, default_max_failed_attempts, max_backoff_seconds, max_stored_response_chars, reaper_grace_seconds (+3 more)

### Community 98 - "bot_log.js"
Cohesion: 0.22
Nodes (6): BOT_LOG_EVENTS, BOT_LOG_LEVEL, createBotLog(), createBotLogsBulk(), truncateValue(), BotLog

### Community 99 - "endpointCorsPolicy.js"
Cohesion: 0.35
Nodes (9): CORS_KEYS, HTTP_METHODS, isConfiguredCors(), isOriginAllowed(), isStringArray(), normalizeEndpointCors(), validateEndpointCors(), validateOriginValue() (+1 more)

### Community 100 - "basicAuthHeader"
Cohesion: 0.42
Nodes (6): runTests(), runTests(), parseSseJson(), runTests(), basicAuthHeader(), TEST_BASE_URL

### Community 101 - "bot_resilience_test.js"
Cohesion: 0.42
Nodes (9): authenticate(), BASIC_AUTH, call(), createBot(), createdBots, getBot(), main(), test() (+1 more)

### Community 102 - "exception_payload_test.js"
Cohesion: 0.42
Nodes (9): authHeader, call(), callWithRetry(), CASES, deleteEndpoint(), getDemoIdapp(), login(), run() (+1 more)

### Community 103 - "mssql_query_generator.js"
Cohesion: 0.31
Nodes (7): CASOS, COLAS, finDeCadena(), finDeParentesis(), indiceDePalabra(), limpiarDefinicionAlterColumn(), parcheAlterColumnMssql()

### Community 104 - "db_path_override_test.js"
Cohesion: 0.28
Nodes (8): DEFECTO_ANTIGUO, expresionDbPath(), HERE, OBJETIVO, README, REPO_ROOT, resuelveDbPath(), runTests()

### Community 105 - "mcp_schema_smoke.mjs"
Cohesion: 0.22
Nodes (7): __dirname, match, problems, SEED, source, tools, UNSUPPORTED_JSON_SCHEMA_KEYS

### Community 106 - "utils_path.js"
Cohesion: 0.25
Nodes (7): path-to-regexp, default_port, GetSystemPaths(), internal_url_http(), internal_url_ws(), struct_api_path, websocket_hooks_resource

### Community 107 - "storage"
Cohesion: 0.22
Nodes (9): storage, column_migration, db_layer, history_db_layer, history_table, model, parent, primary_key (+1 more)

### Community 108 - "bot_backup_test.js"
Cohesion: 0.54
Nodes (7): BASIC_AUTH, call(), getBot(), history(), main(), saveBot(), test()

### Community 109 - "listing_projection_test.js"
Cohesion: 0.25
Nodes (5): botDb, botsHandlers, __dirname, endpointDb, repoRoot

### Community 110 - "mcp_docs_consistency_test.mjs"
Cohesion: 0.25
Nodes (4): apiclientSource, auditSource, here, repoRoot

### Community 111 - "allowScripts"
Cohesion: 0.25
Nodes (8): allowScripts, canvas@3.2.3, @google/genai@1.52.0, oracledb@6.10.0, protobufjs@7.6.5, puppeteer@25.8.0, @sap/hana-client@2.29.25, sqlite3@6.0.1

### Community 112 - "audit/index.js"
Cohesion: 0.39
Nodes (7): getAuditLogs(), getAuditLogStats(), pruneAuditLogsBefore(), fnAuditLogRetentionPrune(), fnAuditLogSearch(), fnAuditLogStats(), getRetentionDays()

### Community 113 - "resolveProviderConfig"
Cohesion: 0.32
Nodes (6): createAIProviderAdapter(), isAzureOpenAIConfig(), normalizeProviderKey(), registerAIProviderAdapter(), resolveProviderConfig(), resolveResponseTimeoutMs()

### Community 114 - "concurrency.js"
Cohesion: 0.52
Nodes (5): crearCierraDePaso(), LIMITE_POR_DEFECTO, limiteDesdeEntorno(), mapConCierre(), normalizarLimite()

### Community 115 - "interval_task_transition_test.js"
Cohesion: 0.48
Nodes (6): instrumentar(), runTests(), TAREA(), updateIntervalTaskStatus(), debeDrenarLote(), TASK_STATUS

### Community 116 - "task_status"
Cohesion: 0.29
Nodes (7): task_status, 0, 1, 2, 3, 4, 5

### Community 117 - "default/index.js"
Cohesion: 0.38
Nodes (4): demo_app, default_apps, system_app, systemBotSource

### Community 119 - "errorPayload.js"
Cohesion: 0.48
Nodes (5): buildErrorPayload(), getPublicErrorData(), PUBLIC_ERROR_DATA, truncatePublicErrorData(), mapOperationalError()

### Community 121 - "createFunctionVM"
Cohesion: 0.53
Nodes (3): run(), run(), createFunctionVM()

### Community 123 - "mcp_schema_conversion.js"
Cohesion: 0.60
Nodes (5): callMcp(), main(), normalizeJsonc(), parseToolCallContent(), resolveMcpConfig()

### Community 124 - "overrides"
Cohesion: 0.33
Nodes (6): overrides, @azure/identity, minimatch, sequelize, tar, uuid

### Community 125 - "conditional_fields"
Cohesion: 0.33
Nodes (6): cron, interval, schedule_mode, schedule_mode, ui, conditional_fields

### Community 126 - "max_backoff_seconds_per_task"
Cohesion: 0.33
Nodes (6): column, default, description, hard_maximum, minimum, max_backoff_seconds_per_task

### Community 127 - "stableStringify"
Cohesion: 0.53
Nodes (5): findDuplicateTaskGroups(), scheduleSignature(), taskEquivalenceKey(), stableStringify(), fnListIntervalTaskDuplicates()

### Community 128 - "db_unbounded_writes_test.js"
Cohesion: 0.40
Nodes (4): APP_JS, APP_PRD_JS, RAIZ, runTests()

### Community 129 - "mcp_tool_descriptions.js"
Cohesion: 0.70
Nodes (4): callMcp(), main(), normalizeJsonc(), resolveMcpConfig()

### Community 130 - "@rdsslab/uFetch"
Cohesion: 0.60
Nodes (4): @rdsslab/uFetch, fetchOFAPI(), getInternalURL(), isAbsoluteUrl()

### Community 131 - "suspension"
Cohesion: 0.40
Nodes (5): suspension, column, description, reason_column, value

### Community 132 - "recurse"
Cohesion: 0.50
Nodes (3): jsonDeepFilterOptimized(), matches(), recurse()

### Community 133 - "user_register.js"
Cohesion: 0.70
Nodes (3): userRegister(), escapeRegExp(), replaceStringTemplate()

### Community 134 - "backoff_enabled"
Cohesion: 0.50
Nodes (4): column, default, description, backoff_enabled

### Community 135 - "docs"
Cohesion: 0.50
Nodes (4): docs, human_guide, main, skill

### Community 136 - "observability"
Cohesion: 0.50
Nodes (4): observability, channel, event, tool

### Community 137 - "scheduler_delay_ms"
Cohesion: 0.50
Nodes (4): scheduler_delay_ms, maximum_heartbeat, minimum, strategy

### Community 139 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 140 - "getAppsCatalog"
Cohesion: 0.67
Nodes (3): getAppsCatalog(), sortCatalogEnvironments(), fnGetAppsCatalog()

## Knowledge Gaps
- **11 isolated node(s):** `mariadb`, `mongose`, `mysql2`, `oracledb`, `pg` (+6 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 788 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `sequelize` connect `sequelize.js` to `interval_task.js`, `recordAudit`, `bot_log.js`, `log.js`, `prd/endpoint/index.js`, `apiclient/index.js`, `package.json`, `user.js`, `sqlFunction.js`, `ConnectionPool.js`, `timer/worker.js`, `functionVars.js`, `models.js`, `app.js`, `endpoint.js`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **What connects `mariadb`, `mongose`, `mysql2` to the rest of the system?**
  _11 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `manager.js` be split into smaller, more focused modules?**
  _Cohesion score 0.0594679186228482 - nodes in this community are weakly interconnected._
- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.03571428571428571 - nodes in this community are weakly interconnected._
- **Why does `LogBuffer` connect `LogBuffer` to `timer/worker.js`?**
  _High betweenness centrality (0.025) - this node is a cross-community bridge._
- **Should `systemBot.telegram.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1033182503770739 - nodes in this community are weakly interconnected._