# Graph Report - libOpenFusionAPI  (2026-10-19)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2608 nodes · 5840 edges · 153 communities (143 shown, 10 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 111 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `04c645f3`
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
- test_restore.js
- repository
- getAppsCatalog
- .mcp.json
- canvas
- .mcp.json
- backoff_enabled
- docs
- observability
- scheduler_delay_ms
- repository
- mcpFunction.js
- src/server.js
- canvas

## God Nodes (most connected - your core abstractions)
1. `recordAudit()` - 46 edges
2. `scripts` - 25 edges
3. `replyException()` - 24 edges
4. `getAppVarsByIdApp()` - 24 edges
5. `sequelize` - 24 edges
6. `sqlFunction()` - 23 edges
7. `resolveAppVarPlaceholder()` - 22 edges
8. `upsertAppVar()` - 22 edges
9. `Endpoint` - 21 edges
10. `restoreAppFromBackup()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `run()` --calls--> `ServerAPI`  [EXTRACTED]
  dev/scratch/test_integration_flow.js → src/lib/index.js
- `buildRuntime()` --indirect_call--> `getBasicUsernameFromRequest()`  [INFERRED]
  dev/test/rate_limit_integration_test.js → src/lib/server/runtime/rateLimitPolicy.js
- `runInvalidTimeout400Test()` --calls--> `fetchFunction()`  [EXTRACTED]
  dev/test/fetch_timeout_test.js → src/lib/handler/fetchFunction.js
- `runTests()` --calls--> `updateIntervalTaskStatus()`  [EXTRACTED]
  dev/test/interval_task_upsert_test.js → src/lib/db/interval_task.js
- `run()` --calls--> `functionsVars()`  [EXTRACTED]
  dev/scratch/test_vm.js → src/lib/server/functionVars.js

## Import Cycles
- 4-file cycle: `src/lib/db/log.js -> src/lib/db/models.js -> src/lib/server/utils.js -> src/lib/server/functionVars.js -> src/lib/db/log.js`
- 5-file cycle: `src/lib/db/endpoint.js -> src/lib/db/models.js -> src/lib/server/utils.js -> src/lib/server/functionVars.js -> src/lib/db/log.js -> src/lib/db/endpoint.js`

## Communities (153 total, 10 thin omitted)

### Community 0 - "manager.js"
Cohesion: 0.06
Nodes (28): buildRuntime(), buildErrorPayload(), getPublicErrorData(), PUBLIC_ERROR_DATA, truncatePublicErrorData(), assertFunction(), assertObject(), validateEndpointContext() (+20 more)

### Community 1 - "dependencies"
Cohesion: 0.04
Nodes (57): dependencies, acorn, ajv, @anthropic-ai/sdk, canvas, chrome-launcher, cron-parser, dotenv (+49 more)

### Community 2 - "systemBot.telegram.js"
Cohesion: 0.05
Nodes (29): BOT_SOURCE, here, repoRoot, SUPPORTED_TASK_VERBS, dbFile, here, repoRoot, dbFile (+21 more)

### Community 3 - "log.js"
Cohesion: 0.10
Nodes (47): api(), changePassword(), ENV_ORDER, esc(), findVar(), finishLink(), forgotPassword(), getAppsEnvIndex() (+39 more)

### Community 4 - "handler.js"
Cohesion: 0.09
Nodes (29): main(), parse(), acorn, fnValidateEndpointCode(), APPLICABLE_HANDLERS, applyTextFixes(), collectUfetchAliases(), MATCHERS (+21 more)

### Community 5 - "codeValidator.js"
Cohesion: 0.05
Nodes (39): code_language, crud_tools, read, skill, write, docs, main, skill (+31 more)

### Community 6 - "bots/manifest.json"
Cohesion: 0.09
Nodes (23): API_CLIENT_COLUMNS, ensureApiClientExpTimeColumn(), ensureBotRuntimeColumns(), RUNTIME_COLUMNS, backfillLegacySuspensions(), ensureIntervalTaskColumns(), INTERVAL_TASK_COLUMNS, IntervalTask (+15 more)

### Community 7 - "prd/endpoint/index.js"
Cohesion: 0.11
Nodes (32): nodemailer, cleanupExpiredRecoveryTokens(), deleteUser(), getAllUsers(), getUserById(), updatePasswordRecoveryChannel(), getActorFromParams(), getRequestMetaFromParams() (+24 more)

### Community 8 - "bots/index.js"
Cohesion: 0.12
Nodes (31): createBotBackup(), getBotBackupByIdBot(), getBotBackupByIdBotLightweight(), hashObjectSync(), normalizeBotSnapshot(), sortObjectDeep(), VOLATILE_FIELDS, BOT_RUNTIME_ATTRIBUTE_SET (+23 more)

### Community 9 - "apiclient/index.js"
Cohesion: 0.11
Nodes (32): avisoCasos, cases, dialectCases, dollarCases, dollarIntactCases, escapeCasos, identCasos, prepararCasos (+24 more)

### Community 10 - "alerts/index.js"
Cohesion: 0.08
Nodes (8): params, callMcp(), run(), callMcp(), run(), callMcp(), run(), dotenv

### Community 11 - "handler/utils.js"
Cohesion: 0.06
Nodes (31): author, bugs, url, description, devDependencies, @types/ws, homepage, keywords (+23 more)

### Community 12 - "TasksInterval"
Cohesion: 0.06
Nodes (31): docs, examples, main, skill, error_types, BOT_ERROR, CONNECTION_ERROR, INVALID_TOKEN (+23 more)

### Community 13 - "package.json"
Cohesion: 0.21
Nodes (25): parseQualifiedName(), customFunction(), VALID_DATA_TYPES, validateFnResult(), fetchFunction(), runHandler(), __dirname, __filename (+17 more)

### Community 14 - "timeSync.js"
Cohesion: 0.11
Nodes (24): rescheduleIntervalTask(), createIntervalTaskRun(), pruneIntervalTaskRuns(), truncateResponse(), createLogEntriesBulk(), IntervalTaskRun, getResponseOutcome(), abortedByOperator (+16 more)

### Community 15 - "RateLimitService.js"
Cohesion: 0.10
Nodes (27): ADMIN_BEARER, basic(), check(), countRecoveryRows(), createdEndpoints, db, DB_PATH, deniedOk() (+19 more)

### Community 16 - "system/prd/index.js"
Cohesion: 0.08
Nodes (24): jsdom, ldapts, mongoose, node-forge, pdfjs-dist, qr-code-styling, @rdsslab/sequential-promises, xlsx (+16 more)

### Community 17 - "telegram/manifest.json"
Cohesion: 0.17
Nodes (27): collectPublishedTools(), collectSchemaIdentifiers(), __dirname, DOMAIN_IDENTIFIERS, findings, getMcpField(), inSchema(), loadSeed() (+19 more)

### Community 18 - "appgroups/index.js"
Cohesion: 0.18
Nodes (13): callTool(), __dirname, extractToolResult(), listTools(), loadMcpConfig(), main(), MCP_CONFIG_PATH, mcpRequest() (+5 more)

### Community 19 - "timer/worker.js"
Cohesion: 0.12
Nodes (8): ajv, ajv, schema_input_hooks, schema_ws_message, validateSchemaMessageWebSocket, getUUID(), WebSocketValidateFormatChannelName(), WebSocketManager

### Community 20 - "lib/index.js"
Cohesion: 0.12
Nodes (26): upsertApiClient(), buildSystemCheckReport(), cierreEscrituras, ENV_CATALOG_ORDER, findEquivalentIntervalTasks(), normalizeTaskParams(), replace_GENTOKEN(), replace_NODEMAILER() (+18 more)

### Community 21 - "functionVars.js"
Cohesion: 0.18
Nodes (27): getBotLogs(), getExposedEnvironmentsList(), ATTACK_TYPES, collectBotIncidents(), collectIntrusions(), collectServerErrors(), countClientErrors(), esc() (+19 more)

### Community 22 - "EndpointRuntimeService.js"
Cohesion: 0.13
Nodes (24): deepClone(), runTests(), checkSystemApp(), getAllAppsBackup(), getAppBackupById(), getAppFullById(), getApplicationsTreeByFilters(), getAppsCatalog() (+16 more)

### Community 23 - "mcp.js"
Cohesion: 0.11
Nodes (26): getAllEndpoints(), createLog(), getTopErrorEndpoints(), getTopErrorEndpointsByTime(), getTraceErrorsOnly(), getTraceSlowestHops(), getTraceSummary(), normalizePositiveInt() (+18 more)

### Community 24 - "appvars.js"
Cohesion: 0.15
Nodes (21): create(), created, cycleBackupRestore(), failures, getApplicationEndpointByRoute(), parseAppVar(), createInvalidAppVarNameError(), createInvalidAppVarTypeError() (+13 more)

### Community 25 - "mcp_exhaustive_validation.js"
Cohesion: 0.12
Nodes (20): ApiClientfindByIdOrUsername(), AuthorizedEnpointsClient, defaultApiClient(), deleteApiClient(), loginApiClient(), normalizeClientDates(), updateApiClient(), updateAPIClientPassword() (+12 more)

### Community 26 - "models.js"
Cohesion: 0.12
Nodes (20): deleteEndpoint(), getEndpointById(), getEndpointByIdApp(), getEndpointCatalogByIdApp(), getEndpointCode(), getEndpointSourceSummaryById(), searchEndpoints(), contextoDeCustomData() (+12 more)

### Community 27 - "mcp_contract_audit.js"
Cohesion: 0.21
Nodes (25): ACCESS_LABELS, accessLabel(), bodyExamples(), canonicalUrl(), createAiMetadata(), createAuthSection(), createCorsSection(), createCurlExample() (+17 more)

### Community 28 - "websocket_manager.js"
Cohesion: 0.11
Nodes (21): borrarEndpoint(), CASOS, CNX, crearEndpoint(), fallos, H, llamar(), registrar() (+13 more)

### Community 29 - "app.js"
Cohesion: 0.18
Nodes (23): runTests(), taskIdentities(), defaultApps(), deleteIntervalTask(), esUUIDTask(), getIntervalTaskById(), INTERVAL_TASK_RUNTIME_ATTRIBUTES, resetIntervalTaskAttempts() (+15 more)

### Community 30 - "app/index.js"
Cohesion: 0.08
Nodes (25): scripts, audit:sql-binds, docs:handlers, docs:handlers:index, docs:handlers:validate, docs:js-api, docs:js-api:check, reinstall (+17 more)

### Community 31 - "endpoint.js"
Cohesion: 0.18
Nodes (23): getAppEndpointUsageSummary(), getAvgResponseTimeByMinute(), getCountsByMinute(), getEnvironmentFilter(), getLogs(), getLogsByEndpoint(), getLogsRecordsPerMinute(), getLogsStatusClassPerMinute() (+15 more)

### Community 32 - "sequelize.js"
Cohesion: 0.10
Nodes (3): EndpointLogger, Endpoint, getLogLevelForStatus()

### Community 33 - "mcp_live_validation.js"
Cohesion: 0.19
Nodes (10): captureConsole(), main(), makeTable(), test(), tick(), uuid(), CONNECTION_ERROR_CODES, CONNECTION_ERROR_NAMES (+2 more)

### Community 34 - "recordAudit"
Cohesion: 0.12
Nodes (21): @anthropic-ai/sdk, @google/genai, openai, AI_PROVIDER_PRESETS, askAIWithTools, buildToolCallFingerprint(), BUILTIN_PROVIDER_PRESETS, convertToAnthropicMessages() (+13 more)

### Community 35 - "._build"
Cohesion: 0.18
Nodes (22): createApiClient(), consumePasswordRecovery(), createPasswordRecovery(), createUser(), DEFAULT_USERS, findActiveUserByUsername(), findVar(), getRecoveryChannelConfig() (+14 more)

### Community 36 - "dotenv"
Cohesion: 0.16
Nodes (3): ServerAPI, DbHookCacheInvalidationService, FunctionRegistryService

### Community 37 - "validateHandlerDocs.js"
Cohesion: 0.16
Nodes (22): BOT_DOC_REQUIRED_FILES, BOT_DOCS_ROOT, BOT_PROVIDERS_ROOT, __dirname, __filename, getBotProviderDocDir(), listBotProviders(), listProviderFolders() (+14 more)

### Community 38 - "user/index.js"
Cohesion: 0.18
Nodes (18): BACKOFF_TIER, BOT_HEALTHY_AFTER_MS, classifyBotFailure(), CODE_ERROR_NAMES, FAILURE_CLASS, isRecoverable(), maxFastBackoffMs(), NETWORK_ERROR_CODES (+10 more)

### Community 39 - "doc_generator.js"
Cohesion: 0.19
Nodes (14): BASIC_AUTH, call(), getBot(), history(), main(), saveBot(), test(), runTests() (+6 more)

### Community 40 - "scripts"
Cohesion: 0.14
Nodes (15): buildToolUsageGuidance(), extractAnthropicText(), extractFirstUrl(), extractLastUserMessageText(), formatToolResult(), getRequiredToolParameters(), getToolSchemaProperties(), hasSuccessfulToolExecution() (+7 more)

### Community 41 - "sequelize"
Cohesion: 0.18
Nodes (14): run(), jsFunction(), connectionCache, getConnectionKey(), getMongoDBParams(), getOrCreateConnection(), invalidateConnection(), mongodbFunction() (+6 more)

### Community 42 - "schedule.js"
Cohesion: 0.17
Nodes (15): failures, GUI_LANGS, APPVAR_BOOLEAN_TRUE_VALUES, APPVAR_TYPE_ALIASES, APPVAR_TYPE_MAX_LENGTH, APPVAR_TYPES, APPVAR_TYPES_ACCEPTED, editDistance() (+7 more)

### Community 43 - "LogBuffer"
Cohesion: 0.18
Nodes (16): CLAVES_DE_DATA_TEST, ensureUniqueEnabledMcpName(), esAuthDeDataTest(), esBodyDeDataTest(), esFilaDeDataTest(), esListaDeFilasDeDataTest(), esObjetoSimple(), esSlotVacioDeDataTest() (+8 more)

### Community 44 - "ia.js"
Cohesion: 0.23
Nodes (18): from, cron-parser, luxon, baseSpacingSeconds(), computeNextRun(), computeSchedulerDelay(), getIntervalSeconds(), isCronTask() (+10 more)

### Community 45 - "user.js"
Cohesion: 0.16
Nodes (6): FakeWorker, runTests(), __dirname, __filename, safeStringify(), TasksInterval

### Community 46 - "Endpoint"
Cohesion: 0.10
Nodes (19): configuration, code, custom_data, read_only, write, docs, examples, generated (+11 more)

### Community 47 - "ref_node_assert"
Cohesion: 0.12
Nodes (15): Bot, BotBackup, ClientBalance, ClientTransactions, default_json_schema, Endpoint, globalNotify(), IGNORED_MODELS_FOR_HOOKS (+7 more)

### Community 48 - "interval_tasks/index.js"
Cohesion: 0.16
Nodes (12): login(), AuthService, fnLogin(), actionFromMethod(), adminCtrl(), emptyCtrl(), fullAccessCtrl(), hasPermission() (+4 more)

### Community 49 - "sqlFunction.js"
Cohesion: 0.18
Nodes (10): AIProviderMCPClient, askIAWithMCP(), askIAWithProviderMCP(), connectMcpServer(), createAIProviderMCPClient(), listMcpTools(), listMcpToolsForProvider(), MCPToolRuntime (+2 more)

### Community 50 - "ref_node_fs"
Cohesion: 0.19
Nodes (15): conBigint, dialect, Sonda, sequelize, assignBigint(), attachBigintNormalization(), esInstanciaDeModelo(), normalizeBigintValues() (+7 more)

### Community 51 - ".run"
Cohesion: 0.20
Nodes (4): runTests(), EndpointLoader, getAppVarsObject(), url_key()

### Community 52 - "soapFunction.js"
Cohesion: 0.22
Nodes (18): assertNoStackLeak(), AUTH_HEADER, call(), createProbeEndpoints(), deleteEndpoint(), __dirname, ensureServer(), findLeakedKey() (+10 more)

### Community 53 - "server/utils.js"
Cohesion: 0.16
Nodes (4): object-hash, EndpointCache, MetricsCollector, get_url_params()

### Community 54 - "MCP/manifest.json"
Cohesion: 0.15
Nodes (9): URLAutoEnvironment, customError(), emitHook(), errors, getFunctionsFiles(), searchFiles(), getPathParts(), setServerListening() (+1 more)

### Community 55 - "MCPToolRuntime"
Cohesion: 0.23
Nodes (13): __dirname, MCP_HANDLER_SOURCE, getApplicationTreeByFilters(), CreateMCPHandler(), buildExposureNotice(), isEnvironmentExposed(), getServer(), normalizeToolKey() (+5 more)

### Community 56 - "owasp_top10.js"
Cohesion: 0.22
Nodes (13): describeConnectionOverride(), recordConnectionOverride(), extractMssqlErrorNumber(), isLiveAppVarsRefreshEnabled(), mergeAppVarsByEnvironment(), RESERVED_SQL_REQUEST_KEYS, sqlFunction(), applyConnectionOverride() (+5 more)

### Community 57 - "SQL/manifest.json"
Cohesion: 0.18
Nodes (16): RFC-7230, soap, schema_input_genericSOAP, ajv, buildSoapClientOptions(), getSoapClient(), getWsdlAuthorizationHeader(), invalidateSoapClient() (+8 more)

### Community 58 - "handlerDocs.js"
Cohesion: 0.11
Nodes (17): configuration, code, custom_data, connection_config, connection_override_allow, database, options, password (+9 more)

### Community 59 - "auth_service.js"
Cohesion: 0.25
Nodes (17): DEFAULT_NOTIFY_ACTIVITY, findGroupsVar(), getGroupLinksForChat(), GROUPS_VAR, normalizeNotifyActivity(), NOTIFY_ACTIVITY_MODES, parseJsonVar(), readAppGroupLinks() (+9 more)

### Community 60 - "appchanges/index.js"
Cohesion: 0.19
Nodes (12): errorSequelize(), errorTedious(), query(), adjuntarReintentoAnteBloqueo(), crearRegistrador(), esErrorDeBloqueo(), esperaDelReintento(), identificadoresDeError() (+4 more)

### Community 61 - "lock_retry.js"
Cohesion: 0.17
Nodes (8): PAQUETE, runTests(), versionDeLaEntradaMasReciente(), @modelcontextprotocol/sdk, fnGetServerVersion(), fnListFnVarsHandlerJS(), packagePath, version

### Community 62 - "EndpointLoader"
Cohesion: 0.17
Nodes (7): systeminformation, BackgroundTaskManager, fnGetSystemInfoDynamic(), SystemInfoTask, ConvertStringToNumber(), getSystemInfoDynamic(), urlSystemPath

### Community 63 - "ConnectionPool.js"
Cohesion: 0.19
Nodes (9): getAllApps(), getAppById(), upsertApp(), upsertEndpoint(), getAllMethods(), fnAppGetById(), fnAppUpsert(), fnGetApps() (+1 more)

### Community 64 - "sqlHana.js"
Cohesion: 0.18
Nodes (10): tedious, CONNECTION_EXHAUSTION_PATTERNS, ConnectionPool, getMaxConnections(), getValidationIdleMs(), isConnectionExhaustionError(), isValidationAlwaysEnabled(), Pool (+2 more)

### Community 65 - "interval_task.js"
Cohesion: 0.18
Nodes (12): appVars, failures, CASOS, ERRORES, connections, construirComandoHana(), executeQuery(), getConnection() (+4 more)

### Community 66 - "sql_bind_literal_audit.js"
Cohesion: 0.15
Nodes (10): newVersion, packageData, packagePath, parts, __dirname, DOCS_ROOT, __filename, __dirname (+2 more)

### Community 67 - "generateDocs.js"
Cohesion: 0.16
Nodes (9): getActiveBots(), BOT_LOG_EVENTS, BOT_LOG_LEVEL, createBotLog(), createBotLogsBulk(), truncateValue(), BotLog, RUNTIME_SUPPORTED_PROVIDERS (+1 more)

### Community 68 - "generate-index-html.js"
Cohesion: 0.21
Nodes (3): BotManager, DB_BOTS, main()

### Community 69 - "appvar_types_test.js"
Cohesion: 0.23
Nodes (14): ACTION_VERB, buildReport(), ENTITY_META, esc(), findAppVar(), fmtName(), fmtTime(), fnAppGroupChanges() (+6 more)

### Community 70 - "check_mcp_name_uniqueness.js"
Cohesion: 0.22
Nodes (14): main(), OUTPUT_FILE, renderRuntimeHandlers(), HANDLER_DOC_REQUIRED_FILES, HANDLER_DOCS_ROOT, readHandlerDocBundle(), readRuntimeHandlerKeys(), assertFile() (+6 more)

### Community 71 - "handler_db_matrix.mjs"
Cohesion: 0.28
Nodes (14): auditEndpoints(), callMcp(), ensureMcpResult(), extractArrayFromToolCall(), fetchApps(), fetchSqlEndpoints(), loginToServer(), main() (+6 more)

### Community 72 - "sql_comments_test.js"
Cohesion: 0.24
Nodes (13): createAuditLog(), getAuditLogById(), getAuditLogs(), getAuditLogStats(), parseJsonSnapshot(), pruneAuditLogsBefore(), truncateValue(), AuditLog (+5 more)

### Community 73 - "server/endpoint/index.js"
Cohesion: 0.20
Nodes (12): getHandlerDoc(), getHandlerLibraryDoc(), Handlers, fnGetHandlerDocs(), fnGetHandlerLibraryDocs(), fnGetHandlerSkill(), __dirname, __filename (+4 more)

### Community 74 - "intervalTaskDocs.js"
Cohesion: 0.23
Nodes (13): buildDocs(), checkDocs(), __dirname, __filename, generateIndexMarkdown(), generateLibraryMarkdown(), main(), normalizeEol() (+5 more)

### Community 75 - "apikey/index.js"
Cohesion: 0.32
Nodes (14): applySchemaDescription(), buildUnionSchema(), buildZodFromJsonSchema(), combineCombinatorsIfNeeded(), hasMeaningfulValidationKeywords(), jsonSchemaToZod(), makeArray(), makeEnum() (+6 more)

### Community 76 - "botDocs.js"
Cohesion: 0.27
Nodes (13): callMcp(), defaultMcpJsonPath(), ensureMcpResult(), extractArray(), extractArrayFromToolCall(), fetchAllEndpoints(), listDuplicateToolNames(), loginToServer() (+5 more)

### Community 77 - "TimedCache"
Cohesion: 0.21
Nodes (10): closeDb(), runTests(), makeReply(), run(), warnings, getIntervalTask(), getIntervalTaskProcess(), LOTE_TAREAS_POR_DEFECTO (+2 more)

### Community 78 - "isPlainObject"
Cohesion: 0.21
Nodes (13): auth, call(), cd(), check(), createEndpoint(), deleteEndpoint(), ENGINES, failures (+5 more)

### Community 80 - "EndpointLogger.js"
Cohesion: 0.29
Nodes (11): deleteApiKey(), getAllApiKeys(), getApiKeyByFilters(), getApiKeyById(), upsertApiKey(), fnDeleteApiKey(), fnGetAllApiKeys(), fnGetApiKeyByFilters() (+3 more)

### Community 81 - "SOAP/manifest.json"
Cohesion: 0.20
Nodes (10): buildTaskEnvironmentFilter(), camposDeTransicion(), getNextIntervalTaskRun(), reapStaleRunningTasks(), SCHEDULE_FIELDS, UUID_TASK_RE, computeBackoffNextRun(), isBackoffDisabled() (+2 more)

### Community 83 - "pdf-generator.js"
Cohesion: 0.30
Nodes (13): buildReport(), collectActivity(), digestGate(), esc(), findAppVar(), fmtTime(), fnAppGroupScan(), getAppName() (+5 more)

### Community 84 - "FETCH/manifest.json"
Cohesion: 0.24
Nodes (13): AnthropicAdapter, createLegacySseRpcClient(), createTransport(), extractAssistantToolParameters(), isPlainObject(), normalizeAnthropicToolChoice(), normalizeHeadersObject(), normalizeToolArguments() (+5 more)

### Community 85 - "FUNCTION/manifest.json"
Cohesion: 0.28
Nodes (12): BASIC_AUTH_HEADER, call(), connectWebSocket(), __dirname, ensureServer(), loginAsAdmin(), ROOT_DIR, runTests() (+4 more)

### Community 86 - "HANA/manifest.json"
Cohesion: 0.22
Nodes (10): createEndpointBackup(), getEndpointBackupById(), getEndpointBackupByIdEndpoint(), getEndpointBackupByIdEndpointLightweight(), hashObjectSync(), sortObjectDeep(), restoreEndpointFromBackup(), EndpointBackup (+2 more)

### Community 87 - "JS/manifest.json"
Cohesion: 0.15
Nodes (9): __dirname, FAVICON_FILE, ICONS, OUT_DIR, OUT_FILE, pkg, PKG_PATH, repoUrl (+1 more)

### Community 88 - "MONGODB/manifest.json"
Cohesion: 0.15
Nodes (12): configuration, agentGuidance, code, custom_data, docs, examples, generated, main (+4 more)

### Community 90 - "SQL_BULK_I/manifest.json"
Cohesion: 0.26
Nodes (10): checkAPIToken(), checkToken(), CreateOpenFusionAPIToken(), getSystemToken(), getUserPasswordTokenFromRequest(), tokenVerify(), fnCreateApiClient(), GenToken() (+2 more)

### Community 91 - "TEXT/manifest.json"
Cohesion: 0.27
Nodes (11): capturaConsola(), cuerpoDeLaFuncion(), dobleEndpoint(), endpoint(), HERE, mcpDe(), montaLaFuncion(), NOMBRES_ACEPTADOS (+3 more)

### Community 92 - ".run"
Cohesion: 0.32
Nodes (11): chrome-launcher, puppeteer-core, @sparticuz/chromium, createImage(), createPDF(), getBrowser(), loadPage(), releaseWorker() (+3 more)

### Community 93 - "cache_validation.js"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 94 - "fetch_timeout_test.js"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 95 - "hana_comments_live_test.js"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 96 - "interval_tasks/manifest.json"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 97 - "runtime"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 98 - "bot_log.js"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 99 - "endpointCorsPolicy.js"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 100 - "basicAuthHeader"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 101 - "bot_resilience_test.js"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

### Community 102 - "exception_payload_test.js"
Cohesion: 0.23
Nodes (4): BaseProviderAdapter, createExecutionSignal(), GoogleGenAIAdapter, normalizeGeminiToolConfig()

### Community 103 - "mssql_query_generator.js"
Cohesion: 0.27
Nodes (7): TimeSyncTask, DEFAULT_TIME_SYNC_URLS, fetchExternalTimeMs(), fetchExternalTimeMsWithFallback(), isTimeSyncEnabled(), syncTime(), TIME_SYNC_URLS

### Community 104 - "db_path_override_test.js"
Cohesion: 0.33
Nodes (10): BASIC_AUTH_HEADER, call(), __dirname, ensureServer(), getStatusEntries(), loginAsAdmin(), ROOT_DIR, runTests() (+2 more)

### Community 105 - "mcp_schema_smoke.mjs"
Cohesion: 0.40
Nodes (10): authHeader, call(), callWithRetry(), deleteEndpoint(), getDemoIdapp(), login(), main(), runIntegration504Test() (+2 more)

### Community 106 - "utils_path.js"
Cohesion: 0.24
Nodes (6): zod, cleanVar(), replaceAllFast(), isUuid(), validateAppName(), webhookSchema

### Community 107 - "storage"
Cohesion: 0.18
Nodes (10): crud_tools, read, skill, write, label, namespace, runtime_attributes, schedule_modes (+2 more)

### Community 108 - "bot_backup_test.js"
Cohesion: 0.18
Nodes (11): runtime, default_exec_time_limit_seconds, default_history_limit, default_interval_seconds, default_max_failed_attempts, max_backoff_seconds, max_stored_response_chars, reaper_grace_seconds (+3 more)

### Community 109 - "listing_projection_test.js"
Cohesion: 0.27
Nodes (7): findDuplicateTaskGroups(), scheduleSignature(), taskEquivalenceKey(), applyAttributesToOptions(), stableStringify(), toAttributeList(), fnListIntervalTaskDuplicates()

### Community 111 - "allowScripts"
Cohesion: 0.35
Nodes (9): CORS_KEYS, HTTP_METHODS, isConfiguredCors(), isOriginAllowed(), isStringArray(), normalizeEndpointCors(), validateEndpointCors(), validateOriginValue() (+1 more)

### Community 112 - "audit/index.js"
Cohesion: 0.42
Nodes (9): authenticate(), BASIC_AUTH, call(), createBot(), createdBots, getBot(), main(), test() (+1 more)

### Community 113 - "resolveProviderConfig"
Cohesion: 0.42
Nodes (9): authHeader, call(), callWithRetry(), CASES, deleteEndpoint(), getDemoIdapp(), login(), run() (+1 more)

### Community 114 - "concurrency.js"
Cohesion: 0.31
Nodes (7): CASOS, COLAS, finDeCadena(), finDeParentesis(), indiceDePalabra(), limpiarDefinicionAlterColumn(), parcheAlterColumnMssql()

### Community 115 - "interval_task_transition_test.js"
Cohesion: 0.33
Nodes (5): ENV_VARS, buildBotConfigHash(), isRuntimeStateVar(), RUNTIME_STATE_VAR_SUFFIXES, stripRuntimeStateVars()

### Community 116 - "task_status"
Cohesion: 0.28
Nodes (8): DEFECTO_ANTIGUO, expresionDbPath(), HERE, OBJETIVO, README, REPO_ROOT, resuelveDbPath(), runTests()

### Community 117 - "default/index.js"
Cohesion: 0.22
Nodes (3): grammy, hive-driver, NETWORK_ERROR_CODES

### Community 118 - "JSON_ADAPTER"
Cohesion: 0.22
Nodes (9): storage, column_migration, db_layer, history_db_layer, history_table, model, parent, primary_key (+1 more)

### Community 119 - "errorPayload.js"
Cohesion: 0.47
Nodes (8): getLegacyPasswordKeys(), passwordMatches(), classifyValue(), collectStatus(), fnPasswordMigrationRun(), fnPasswordMigrationStatus(), fnPasswordMigrationValidate(), runMigration()

### Community 120 - "simulate_loader.js"
Cohesion: 0.25
Nodes (8): allowScripts, canvas@3.2.3, @google/genai@1.52.0, oracledb@6.10.0, protobufjs@7.6.5, puppeteer@25.8.0, @sap/hana-client@2.29.25, sqlite3@6.0.1

### Community 121 - "createFunctionVM"
Cohesion: 0.25
Nodes (6): path-to-regexp, default_port, internal_url_post_hooks, internal_url_ws(), struct_api_path, websocket_hooks_resource

### Community 122 - "ref_node_path"
Cohesion: 0.32
Nodes (6): computeExposedEnvironments(), ENV_KEY_MAP, envVarTruthy(), exposedEnvironmentsCache, isExposureConfigured(), MANAGED_ENVIRONMENTS

### Community 123 - "mcp_schema_conversion.js"
Cohesion: 0.32
Nodes (6): createAIProviderAdapter(), isAzureOpenAIConfig(), normalizeProviderKey(), registerAIProviderAdapter(), resolveProviderConfig(), resolveResponseTimeoutMs()

### Community 124 - "overrides"
Cohesion: 0.52
Nodes (5): crearCierraDePaso(), LIMITE_POR_DEFECTO, limiteDesdeEntorno(), mapConCierre(), normalizarLimite()

### Community 125 - "conditional_fields"
Cohesion: 0.43
Nodes (6): capturandoErrores(), instrumentarUpsert(), METODOS_ESPERADOS, runTests(), defaultMethods(), Method

### Community 126 - "max_backoff_seconds_per_task"
Cohesion: 0.48
Nodes (6): instrumentar(), runTests(), TAREA(), updateIntervalTaskStatus(), debeDrenarLote(), TASK_STATUS

### Community 127 - "stableStringify"
Cohesion: 0.29
Nodes (7): task_status, 0, 1, 2, 3, 4, 5

### Community 129 - "mcp_tool_descriptions.js"
Cohesion: 0.53
Nodes (3): run(), run(), createFunctionVM()

### Community 130 - "@rdsslab/uFetch"
Cohesion: 0.47
Nodes (5): createResponse(), run(), fnEndpointTest(), GetSystemPaths(), internal_url_http()

### Community 131 - "suspension"
Cohesion: 0.60
Nodes (5): callMcp(), main(), normalizeJsonc(), parseToolCallContent(), resolveMcpConfig()

### Community 132 - "recurse"
Cohesion: 0.33
Nodes (6): overrides, @azure/identity, minimatch, sequelize, tar, uuid

### Community 133 - "user_register.js"
Cohesion: 0.33
Nodes (6): cron, interval, schedule_mode, schedule_mode, ui, conditional_fields

### Community 134 - "backoff_enabled"
Cohesion: 0.33
Nodes (6): column, default, description, hard_maximum, minimum, max_backoff_seconds_per_task

### Community 135 - "docs"
Cohesion: 0.40
Nodes (5): APPVAR_NAME_MAX_LENGTH, APPVAR_NAME_PREFIX, APPVAR_NAME_REGEX, suggestAppVarName(), validateAppVarName()

### Community 136 - "observability"
Cohesion: 0.50
Nodes (4): dataTestDelEditor, envuelto(), run(), AVISO_DATA_TEST_NORMALIZADO

### Community 137 - "scheduler_delay_ms"
Cohesion: 0.40
Nodes (4): APP_JS, APP_PRD_JS, RAIZ, runTests()

### Community 138 - "test_restore.js"
Cohesion: 0.70
Nodes (4): callMcp(), main(), normalizeJsonc(), resolveMcpConfig()

### Community 139 - "repository"
Cohesion: 0.60
Nodes (4): @rdsslab/uFetch, fetchOFAPI(), getInternalURL(), isAbsoluteUrl()

### Community 140 - "getAppsCatalog"
Cohesion: 0.40
Nodes (5): suspension, column, description, reason_column, value

### Community 142 - "canvas"
Cohesion: 0.50
Nodes (3): jsonDeepFilterOptimized(), matches(), recurse()

### Community 143 - ".mcp.json"
Cohesion: 0.50
Nodes (3): graphify-mcp, graphify_local, openfusion_system_remote_prd

### Community 144 - "backoff_enabled"
Cohesion: 0.50
Nodes (4): column, default, description, backoff_enabled

### Community 145 - "docs"
Cohesion: 0.50
Nodes (4): docs, human_guide, main, skill

### Community 146 - "observability"
Cohesion: 0.50
Nodes (4): observability, channel, event, tool

### Community 147 - "scheduler_delay_ms"
Cohesion: 0.50
Nodes (4): scheduler_delay_ms, maximum_heartbeat, minimum, strategy

### Community 149 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

## Knowledge Gaps
- **12 isolated node(s):** `mariadb`, `mongose`, `mysql2`, `oracledb`, `pg` (+7 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 801 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `sequelize` connect `ref_node_fs` to `bots/manifest.json`, `bots/index.js`, `handler/utils.js`, `package.json`, `timeSync.js`, `system/prd/index.js`, `lib/index.js`, `mcp_exhaustive_validation.js`, `models.js`, `endpoint.js`, `._build`, `LogBuffer`, `ref_node_assert`, `owasp_top10.js`, `sqlHana.js`, `generateDocs.js`, `sql_comments_test.js`, `SOAP/manifest.json`, `errorPayload.js`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **What connects `mariadb`, `mongose`, `mysql2` to the rest of the system?**
  _12 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `manager.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05714285714285714 - nodes in this community are weakly interconnected._
- **Why does `dependencies` connect `dependencies` to `handler/utils.js`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.03508771929824561 - nodes in this community are weakly interconnected._
- **Why does `dotenv` connect `alerts/index.js` to `bots/manifest.json`, `handler/utils.js`, `TimedCache`, `ref_node_fs`, `EndpointRuntimeService.js`, `app.js`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Should `systemBot.telegram.js` be split into smaller, more focused modules?**
  _Cohesion score 0.04934687953555878 - nodes in this community are weakly interconnected._