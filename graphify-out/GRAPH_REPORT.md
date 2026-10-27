# Graph Report - libOpenFusionAPI  (2026-10-26)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 2666 nodes · 5963 edges · 135 communities (128 shown, 7 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 113 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `dd4f2da0`
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

## God Nodes (most connected - your core abstractions)
1. `recordAudit()` - 46 edges
2. `replyException()` - 26 edges
3. `scripts` - 25 edges
4. `sequelize` - 25 edges
5. `getAppVarsByIdApp()` - 24 edges
6. `sqlFunction()` - 23 edges
7. `upsertAppVar()` - 22 edges
8. `resolveAppVarPlaceholder()` - 22 edges
9. `restoreAppFromBackup()` - 21 edges
10. `basicAuthHeader()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `create()` --calls--> `upsertAppVar()`  [EXTRACTED]
  dev/test/appvar_end_to_end_test.js → src/lib/db/appvars.js
- `run()` --calls--> `functionsVars()`  [EXTRACTED]
  dev/scratch/test_vm.js → src/lib/server/functionVars.js
- `run()` --calls--> `createFunctionVM()`  [EXTRACTED]
  dev/test/js_return_status_integration.js → src/lib/server/createFunctionVM.js
- `runEndpoint()` --calls--> `functionsVars()`  [EXTRACTED]
  dev/test/sftp_demo_endpoints_test.js → src/lib/server/functionVars.js
- `runTests()` --calls--> `updateIntervalTaskStatus()`  [EXTRACTED]
  dev/test/interval_task_upsert_test.js → src/lib/db/interval_task.js

## Import Cycles
- 3-file cycle: `src/lib/async/AsyncTaskService.js -> src/lib/handler/handler.js -> src/lib/handler/asyncWrapper.js -> src/lib/async/AsyncTaskService.js`
- 4-file cycle: `src/lib/db/log.js -> src/lib/db/models.js -> src/lib/server/utils.js -> src/lib/server/functionVars.js -> src/lib/db/log.js`
- 5-file cycle: `src/lib/db/endpoint.js -> src/lib/db/models.js -> src/lib/server/utils.js -> src/lib/server/functionVars.js -> src/lib/db/log.js -> src/lib/db/endpoint.js`

## Communities (135 total, 7 thin omitted)

### Community 0 - "manager.js"
Cohesion: 0.05
Nodes (81): create(), created, cycleBackupRestore(), failures, getApplicationEndpointByRoute(), parseAppVar(), APPVAR_NAME_MAX_LENGTH, APPVAR_NAME_PREFIX (+73 more)

### Community 1 - "dependencies"
Cohesion: 0.05
Nodes (81): systeminformation, getAllEndpoints(), createLog(), getAppEndpointUsageSummary(), getAvgResponseTimeByMinute(), getCountsByMinute(), getEnvironmentFilter(), getLogs() (+73 more)

### Community 2 - "systemBot.telegram.js"
Cohesion: 0.05
Nodes (36): ENV_VARS, updateBotRuntimeState(), BackgroundTaskManager, buildBotConfigHash(), isRuntimeStateVar(), RUNTIME_STATE_VAR_SUFFIXES, stripRuntimeStateVars(), BACKOFF_TIER (+28 more)

### Community 3 - "log.js"
Cohesion: 0.05
Nodes (59): dataTestDelEditor, envuelto(), run(), AVISO_DATA_TEST_NORMALIZADO, createEndpointBackup(), getEndpointBackupById(), getEndpointBackupByIdEndpoint(), getEndpointBackupByIdEndpointLightweight() (+51 more)

### Community 4 - "handler.js"
Cohesion: 0.06
Nodes (29): buildRuntime(), buildErrorPayload(), getPublicErrorData(), PUBLIC_ERROR_DATA, truncatePublicErrorData(), assertFunction(), assertObject(), validateEndpointContext() (+21 more)

### Community 5 - "codeValidator.js"
Cohesion: 0.06
Nodes (43): __dirname, MCP_HANDLER_SOURCE, PAQUETE, runTests(), versionDeLaEntradaMasReciente(), @modelcontextprotocol/sdk, getApplicationTreeByFilters(), getHandlerDoc() (+35 more)

### Community 6 - "bots/manifest.json"
Cohesion: 0.04
Nodes (57): author, bugs, url, description, devDependencies, @types/ws, homepage, keywords (+49 more)

### Community 7 - "prd/endpoint/index.js"
Cohesion: 0.03
Nodes (58): dependencies, acorn, ajv, @anthropic-ai/sdk, canvas, chrome-launcher, cron-parser, dotenv (+50 more)

### Community 8 - "bots/index.js"
Cohesion: 0.10
Nodes (47): api(), changePassword(), ENV_ORDER, esc(), findVar(), finishLink(), forgotPassword(), getAppsEnvIndex() (+39 more)

### Community 9 - "apiclient/index.js"
Cohesion: 0.07
Nodes (29): fastify, @fastify/cookie, @fastify/cors, @fastify/formbody, @fastify/multipart, @fastify/static, @fastify/websocket, defaultApiClient() (+21 more)

### Community 10 - "alerts/index.js"
Cohesion: 0.08
Nodes (10): run(), run(), runTests(), ServerAPI, createFunctionVM(), DbHookCacheInvalidationService, FunctionRegistryService, safeStringify() (+2 more)

### Community 11 - "handler/utils.js"
Cohesion: 0.10
Nodes (37): PasswordRecovery, cleanupExpiredRecoveryTokens(), consumePasswordRecovery(), createPasswordRecovery(), DEFAULT_USERS, deleteUser(), findActiveUserByUsername(), findVar() (+29 more)

### Community 12 - "TasksInterval"
Cohesion: 0.09
Nodes (29): main(), parse(), acorn, fnValidateEndpointCode(), APPLICABLE_HANDLERS, applyTextFixes(), collectUfetchAliases(), MATCHERS (+21 more)

### Community 13 - "package.json"
Cohesion: 0.14
Nodes (31): CASOS, ERRORES, parseQualifiedName(), describeConnectionOverride(), recordConnectionOverride(), __dirname, __filename, hiveFunction() (+23 more)

### Community 14 - "timeSync.js"
Cohesion: 0.05
Nodes (39): code_language, crud_tools, read, skill, write, docs, main, skill (+31 more)

### Community 15 - "RateLimitService.js"
Cohesion: 0.10
Nodes (34): restoreBots(), createBotBackup(), getBotBackupByIdBot(), getBotBackupByIdBotLightweight(), hashObjectSync(), normalizeBotSnapshot(), sortObjectDeep(), VOLATILE_FIELDS (+26 more)

### Community 16 - "system/prd/index.js"
Cohesion: 0.11
Nodes (30): avisoCasos, cases, dialectCases, dollarCases, dollarIntactCases, escapeCasos, identCasos, prepararCasos (+22 more)

### Community 17 - "telegram/manifest.json"
Cohesion: 0.08
Nodes (8): params, callMcp(), run(), callMcp(), run(), callMcp(), run(), dotenv

### Community 18 - "appgroups/index.js"
Cohesion: 0.06
Nodes (31): docs, examples, main, skill, error_types, BOT_ERROR, CONNECTION_ERROR, INVALID_TOKEN (+23 more)

### Community 19 - "timer/worker.js"
Cohesion: 0.11
Nodes (24): rescheduleIntervalTask(), createIntervalTaskRun(), pruneIntervalTaskRuns(), truncateResponse(), createLogEntriesBulk(), IntervalTaskRun, getResponseOutcome(), abortedByOperator (+16 more)

### Community 20 - "lib/index.js"
Cohesion: 0.15
Nodes (15): AsyncTaskService, buildFingerprint(), sortObject(), asyncWrapperFunction(), RESERVED_ASYNC_KEYS, customFunction(), VALID_DATA_TYPES, validateFnResult() (+7 more)

### Community 21 - "functionVars.js"
Cohesion: 0.11
Nodes (26): ADMIN_BEARER, basic(), check(), countRecoveryRows(), createdEndpoints, db, DB_PATH, deniedOk() (+18 more)

### Community 22 - "EndpointRuntimeService.js"
Cohesion: 0.12
Nodes (20): runTests(), buildTaskEnvironmentFilter(), getIntervalTask(), getIntervalTaskProcess(), getNextIntervalTaskRun(), INTERVAL_TASK_RUNTIME_ATTRIBUTES, LOTE_TAREAS_POR_DEFECTO, parseJSONField() (+12 more)

### Community 23 - "mcp.js"
Cohesion: 0.17
Nodes (27): collectPublishedTools(), collectSchemaIdentifiers(), __dirname, DOMAIN_IDENTIFIERS, findings, getMcpField(), inSchema(), loadSeed() (+19 more)

### Community 24 - "appvars.js"
Cohesion: 0.12
Nodes (8): ajv, ajv, schema_input_hooks, schema_ws_message, validateSchemaMessageWebSocket, getUUID(), WebSocketValidateFormatChannelName(), WebSocketManager

### Community 25 - "mcp_exhaustive_validation.js"
Cohesion: 0.13
Nodes (21): ApiClientfindByIdOrUsername(), deleteApiClient(), loginApiClient(), checkAPIToken(), checkToken(), CreateOpenFusionAPIToken(), getSystemToken(), getUserPasswordTokenFromRequest() (+13 more)

### Community 26 - "models.js"
Cohesion: 0.12
Nodes (26): upsertApiClient(), buildSystemCheckReport(), cierreEscrituras, ENV_CATALOG_ORDER, findEquivalentIntervalTasks(), normalizeTaskParams(), replace_GENTOKEN(), replace_NODEMAILER() (+18 more)

### Community 27 - "mcp_contract_audit.js"
Cohesion: 0.19
Nodes (12): callTool(), __dirname, extractToolResult(), listTools(), loadMcpConfig(), main(), MCP_CONFIG_PATH, mcpRequest() (+4 more)

### Community 28 - "websocket_manager.js"
Cohesion: 0.09
Nodes (20): jsonwebtoken, path-to-regexp, @rdsslab/uFetch, zod, fetchOFAPI(), getInternalURL(), isAbsoluteUrl(), customError() (+12 more)

### Community 29 - "app.js"
Cohesion: 0.21
Nodes (25): ACCESS_LABELS, accessLabel(), bodyExamples(), canonicalUrl(), createAiMetadata(), createAuthSection(), createCorsSection(), createCurlExample() (+17 more)

### Community 30 - "app/index.js"
Cohesion: 0.15
Nodes (22): deepClone(), runTests(), checkSystemApp(), getAllAppsBackup(), getAppBackupById(), getAppFullById(), getApplicationsTreeByFilters(), getAppsCatalog() (+14 more)

### Community 31 - "endpoint.js"
Cohesion: 0.10
Nodes (12): BOT_SOURCE, here, repoRoot, SUPPORTED_TASK_VERBS, OPTS_PG, dbFile, here, repoRoot (+4 more)

### Community 32 - "sequelize.js"
Cohesion: 0.19
Nodes (23): from, cron-parser, camposDeTransicion(), reapStaleRunningTasks(), baseSpacingSeconds(), computeBackoffNextRun(), computeNextRun(), computeSchedulerDelay() (+15 more)

### Community 33 - "mcp_live_validation.js"
Cohesion: 0.08
Nodes (25): scripts, audit:sql-binds, docs:handlers, docs:handlers:index, docs:handlers:validate, docs:js-api, docs:js-api:check, reinstall (+17 more)

### Community 34 - "recordAudit"
Cohesion: 0.19
Nodes (10): captureConsole(), main(), makeTable(), test(), tick(), uuid(), CONNECTION_ERROR_CODES, CONNECTION_ERROR_NAMES (+2 more)

### Community 35 - "._build"
Cohesion: 0.13
Nodes (20): appVars, failures, RFC-7230, schema_input_genericSOAP, ajv, buildSoapClientOptions(), getSoapClient(), getWsdlAuthorizationHeader() (+12 more)

### Community 37 - "validateHandlerDocs.js"
Cohesion: 0.16
Nodes (10): extractAnthropicText(), extractLastUserMessageText(), formatToolResult(), hasSuccessfulToolExecution(), inferLowConfidenceReadOnlyRetryToolCall(), isLikelyToolCatalogDump(), looksLikeLowConfidenceWebText(), MCPToolRuntime (+2 more)

### Community 38 - "user/index.js"
Cohesion: 0.12
Nodes (20): @anthropic-ai/sdk, @google/genai, AI_PROVIDER_PRESETS, askAIWithTools, buildToolCallFingerprint(), buildToolUsageGuidance(), BUILTIN_PROVIDER_PRESETS, createAbortError() (+12 more)

### Community 39 - "doc_generator.js"
Cohesion: 0.16
Nodes (19): main(), OUTPUT_FILE, renderRuntimeHandlers(), __dirname, __filename, getHandlerDocDir(), getHandlerLibraryDoc(), HANDLER_DOC_OPTIONAL_FILES (+11 more)

### Community 40 - "scripts"
Cohesion: 0.22
Nodes (20): runTests(), taskIdentities(), defaultApps(), deleteIntervalTask(), esUUIDTask(), getIntervalTaskById(), resetIntervalTaskAttempts(), getIntervalTaskRuns() (+12 more)

### Community 41 - "sequelize"
Cohesion: 0.17
Nodes (15): failures, GUI_LANGS, APPVAR_BOOLEAN_TRUE_VALUES, APPVAR_TYPE_ALIASES, APPVAR_TYPE_MAX_LENGTH, APPVAR_TYPES, APPVAR_TYPES_ACCEPTED, editDistance() (+7 more)

### Community 42 - "schedule.js"
Cohesion: 0.12
Nodes (15): Bot, ClientBalance, ClientTransactions, default_json_schema, Endpoint, globalNotify(), IGNORED_MODELS_FOR_HOOKS, IS_MSSQL (+7 more)

### Community 43 - "LogBuffer"
Cohesion: 0.10
Nodes (19): configuration, code, custom_data, read_only, write, docs, examples, generated (+11 more)

### Community 44 - "ia.js"
Cohesion: 0.16
Nodes (18): AuthorizedEnpointsClient, createApiClient(), normalizeClientDates(), updateApiClient(), updateAPIClientPassword(), ApiClient, ApiKey, createUser() (+10 more)

### Community 45 - "user.js"
Cohesion: 0.18
Nodes (13): run(), connectionCache, getConnectionKey(), getMongoDBParams(), getOrCreateConnection(), invalidateConnection(), mongodbFunction(), resolveSuccessStatus() (+5 more)

### Community 46 - "Endpoint"
Cohesion: 0.12
Nodes (10): APP_JS, APP_PRD_JS, RAIZ, runTests(), __dirname, ROOT_DIR, apiclientSource, auditSource (+2 more)

### Community 47 - "ref_node_assert"
Cohesion: 0.22
Nodes (18): assertNoStackLeak(), AUTH_HEADER, call(), createProbeEndpoints(), deleteEndpoint(), __dirname, ensureServer(), findLeakedKey() (+10 more)

### Community 48 - "interval_tasks/index.js"
Cohesion: 0.33
Nodes (16): auth(), callEndpoint(), check(), failures, login(), main(), pollUntil(), runtimeUrl() (+8 more)

### Community 49 - "sqlFunction.js"
Cohesion: 0.18
Nodes (13): sequelize, API_CLIENT_COLUMNS, RUNTIME_COLUMNS, backfillLegacySuspensions(), ensureIntervalTaskColumns(), INTERVAL_TASK_COLUMNS, ModelNames, connectionReady (+5 more)

### Community 50 - "ref_node_fs"
Cohesion: 0.19
Nodes (11): uuid, getAllApps(), getAppById(), upsertApp(), upsertEndpoint(), getAllMethods(), login(), fnAppGetById() (+3 more)

### Community 51 - ".run"
Cohesion: 0.11
Nodes (17): configuration, code, custom_data, connection_config, connection_override_allow, database, options, password (+9 more)

### Community 52 - "soapFunction.js"
Cohesion: 0.18
Nodes (10): AuthService, actionFromMethod(), adminCtrl(), emptyCtrl(), fullAccessCtrl(), hasPermission(), METHOD_TO_ACTION, VALID_ACTIONS (+2 more)

### Community 53 - "server/utils.js"
Cohesion: 0.19
Nodes (12): errorSequelize(), errorTedious(), query(), adjuntarReintentoAnteBloqueo(), crearRegistrador(), esErrorDeBloqueo(), esperaDelReintento(), identificadoresDeError() (+4 more)

### Community 54 - "MCP/manifest.json"
Cohesion: 0.24
Nodes (4): runTests(), EndpointLoader, getAppVarsObject(), url_key()

### Community 55 - "MCPToolRuntime"
Cohesion: 0.21
Nodes (16): BOT_DOC_REQUIRED_FILES, BOT_DOCS_ROOT, BOT_PROVIDERS_ROOT, __dirname, __filename, getBotProviderDocDir(), listBotProviders(), listProviderFolders() (+8 more)

### Community 56 - "owasp_top10.js"
Cohesion: 0.20
Nodes (9): CONNECTION_EXHAUSTION_PATTERNS, ConnectionPool, getMaxConnections(), getValidationIdleMs(), isConnectionExhaustionError(), isValidationAlwaysEnabled(), Pool, tediousDialectModule (+1 more)

### Community 57 - "SQL/manifest.json"
Cohesion: 0.28
Nodes (14): auditEndpoints(), callMcp(), ensureMcpResult(), extractArrayFromToolCall(), fetchApps(), fetchSqlEndpoints(), loginToServer(), main() (+6 more)

### Community 58 - "handlerDocs.js"
Cohesion: 0.23
Nodes (13): buildDocs(), checkDocs(), __dirname, __filename, generateIndexMarkdown(), generateLibraryMarkdown(), main(), normalizeEol() (+5 more)

### Community 59 - "auth_service.js"
Cohesion: 0.22
Nodes (14): AnthropicAdapter, createLegacySseRpcClient(), createTransport(), extractAssistantToolParameters(), isPlainObject(), normalizeAnthropicToolChoice(), normalizeGeminiToolConfig(), normalizeHeadersObject() (+6 more)

### Community 60 - "appchanges/index.js"
Cohesion: 0.27
Nodes (13): callMcp(), defaultMcpJsonPath(), ensureMcpResult(), extractArray(), extractArrayFromToolCall(), fetchAllEndpoints(), listDuplicateToolNames(), loginToServer() (+5 more)

### Community 61 - "lock_retry.js"
Cohesion: 0.21
Nodes (10): closeDb(), capturandoErrores(), instrumentarUpsert(), METODOS_ESPERADOS, runTests(), makeReply(), run(), warnings (+2 more)

### Community 62 - "EndpointLoader"
Cohesion: 0.21
Nodes (13): auth, call(), cd(), check(), createEndpoint(), deleteEndpoint(), ENGINES, failures (+5 more)

### Community 63 - "ConnectionPool.js"
Cohesion: 0.19
Nodes (12): borrarEndpoint(), CASOS, crearEndpoint(), DEMO, fallosConocidos, fallosNuevos, H, llamar() (+4 more)

### Community 64 - "sqlHana.js"
Cohesion: 0.24
Nodes (4): object-hash, EndpointCache, MetricsCollector, get_url_params()

### Community 66 - "sql_bind_literal_audit.js"
Cohesion: 0.14
Nodes (10): __dirname, FAVICON_FILE, generateFavicon(), ICONS, OUT_DIR, OUT_FILE, pkg, PKG_PATH (+2 more)

### Community 67 - "generateDocs.js"
Cohesion: 0.29
Nodes (11): deleteApiKey(), getAllApiKeys(), getApiKeyByFilters(), getApiKeyById(), upsertApiKey(), fnDeleteApiKey(), fnGetAllApiKeys(), fnGetApiKeyByFilters() (+3 more)

### Community 68 - "generate-index-html.js"
Cohesion: 0.24
Nodes (12): AUDIT_ACTIONS, AUDIT_ENTITY_TYPES, createAuditLog(), truncateValue(), AuditLog, getActorFromParams(), getRequestMetaFromParams(), recordAudit() (+4 more)

### Community 70 - "check_mcp_name_uniqueness.js"
Cohesion: 0.28
Nodes (12): BASIC_AUTH_HEADER, call(), connectWebSocket(), __dirname, ensureServer(), loginAsAdmin(), ROOT_DIR, runTests() (+4 more)

### Community 71 - "handler_db_matrix.mjs"
Cohesion: 0.19
Nodes (4): EndpointLogger, cleanVar(), getLogLevelForStatus(), replaceAllFast()

### Community 72 - "sql_comments_test.js"
Cohesion: 0.15
Nodes (12): configuration, agentGuidance, code, custom_data, docs, examples, generated, main (+4 more)

### Community 73 - "server/endpoint/index.js"
Cohesion: 0.21
Nodes (11): __dirname, DOCS_ROOT, expandDocIncludes(), __filename, resolveIncludePath(), fnGetIntervalTaskSkill(), __dirname, __filename (+3 more)

### Community 74 - "intervalTaskDocs.js"
Cohesion: 0.29
Nodes (7): AIProviderMCPClient, askIAWithMCP(), askIAWithProviderMCP(), connectMcpServer(), createAIProviderMCPClient(), listMcpTools(), listMcpToolsForProvider()

### Community 75 - "apikey/index.js"
Cohesion: 0.29
Nodes (10): BASIC_AUTH_HEADER, call(), __dirname, ensureServer(), getStatusEntries(), loginAsAdmin(), ROOT_DIR, runTests() (+2 more)

### Community 76 - "botDocs.js"
Cohesion: 0.27
Nodes (11): capturaConsola(), cuerpoDeLaFuncion(), dobleEndpoint(), endpoint(), HERE, mcpDe(), montaLaFuncion(), NOMBRES_ACEPTADOS (+3 more)

### Community 77 - "TimedCache"
Cohesion: 0.32
Nodes (11): chrome-launcher, puppeteer-core, @sparticuz/chromium, createImage(), createPDF(), getBrowser(), loadPage(), releaseWorker() (+3 more)

### Community 78 - "isPlainObject"
Cohesion: 0.17
Nodes (11): configuration, code, custom_data, docs, examples, generated, main, handler (+3 more)

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
Cohesion: 0.26
Nodes (8): findDuplicateTaskGroups(), scheduleSignature(), taskEquivalenceKey(), applyAttributesToOptions(), stableStringify(), toAttributeList(), toStringList(), fnListIntervalTaskDuplicates()

### Community 88 - "MONGODB/manifest.json"
Cohesion: 0.30
Nodes (11): extractMssqlErrorNumber(), isLiveAppVarsRefreshEnabled(), mergeAppVarsByEnvironment(), RESERVED_SQL_REQUEST_KEYS, sqlFunction(), detectSqlParamStyle(), nombreDeDialecto(), reglasDeEscaneo() (+3 more)

### Community 90 - "SQL_BULK_I/manifest.json"
Cohesion: 0.40
Nodes (10): authHeader, call(), callWithRetry(), deleteEndpoint(), getDemoIdapp(), login(), main(), runIntegration504Test() (+2 more)

### Community 91 - "TEXT/manifest.json"
Cohesion: 0.25
Nodes (9): borrarEndpoint(), CASOS, CNX, crearEndpoint(), fallos, H, llamar(), registrar() (+1 more)

### Community 92 - ".run"
Cohesion: 0.18
Nodes (10): crud_tools, read, skill, write, label, namespace, runtime_attributes, schedule_modes (+2 more)

### Community 93 - "cache_validation.js"
Cohesion: 0.18
Nodes (11): runtime, default_exec_time_limit_seconds, default_history_limit, default_interval_seconds, default_max_failed_attempts, max_backoff_seconds, max_stored_response_chars, reaper_grace_seconds (+3 more)

### Community 94 - "fetch_timeout_test.js"
Cohesion: 0.22
Nodes (6): BOT_LOG_EVENTS, BOT_LOG_LEVEL, createBotLog(), createBotLogsBulk(), truncateValue(), BotLog

### Community 95 - "hana_comments_live_test.js"
Cohesion: 0.22
Nodes (6): BaseProviderAdapter, createExecutionSignal(), GoogleGenAIAdapter, normalizeDefaultQueryObject(), normalizeOpenAIBaseUrl(), OpenAICompatibleAdapter

### Community 96 - "interval_tasks/manifest.json"
Cohesion: 0.42
Nodes (6): runTests(), runTests(), parseSseJson(), runTests(), basicAuthHeader(), TEST_BASE_URL

### Community 97 - "runtime"
Cohesion: 0.42
Nodes (9): authenticate(), BASIC_AUTH, call(), createBot(), createdBots, getBot(), main(), test() (+1 more)

### Community 98 - "bot_log.js"
Cohesion: 0.33
Nodes (8): conBigint, dialect, Sonda, assignBigint(), attachBigintNormalization(), esInstanciaDeModelo(), normalizeBigintValues(), parseBigintIfSafe()

### Community 99 - "endpointCorsPolicy.js"
Cohesion: 0.42
Nodes (9): authHeader, call(), callWithRetry(), CASES, deleteEndpoint(), getDemoIdapp(), login(), run() (+1 more)

### Community 100 - "basicAuthHeader"
Cohesion: 0.31
Nodes (7): CASOS, COLAS, finDeCadena(), finDeParentesis(), indiceDePalabra(), limpiarDefinicionAlterColumn(), parcheAlterColumnMssql()

### Community 101 - "bot_resilience_test.js"
Cohesion: 0.22
Nodes (5): __dirname, __filename, HANDLER_SOURCE, __dirname, __filename

### Community 102 - "exception_payload_test.js"
Cohesion: 0.28
Nodes (8): DEFECTO_ANTIGUO, expresionDbPath(), HERE, OBJETIVO, README, REPO_ROOT, resuelveDbPath(), runTests()

### Community 103 - "mssql_query_generator.js"
Cohesion: 0.22
Nodes (7): __dirname, match, problems, SEED, source, tools, UNSUPPORTED_JSON_SCHEMA_KEYS

### Community 104 - "db_path_override_test.js"
Cohesion: 0.22
Nodes (3): grammy, hive-driver, NETWORK_ERROR_CODES

### Community 105 - "mcp_schema_smoke.mjs"
Cohesion: 0.22
Nodes (9): storage, column_migration, db_layer, history_db_layer, history_table, model, parent, primary_key (+1 more)

### Community 106 - "utils_path.js"
Cohesion: 0.47
Nodes (8): getLegacyPasswordKeys(), passwordMatches(), classifyValue(), collectStatus(), fnPasswordMigrationRun(), fnPasswordMigrationStatus(), fnPasswordMigrationValidate(), runMigration()

### Community 107 - "storage"
Cohesion: 0.54
Nodes (7): BASIC_AUTH, call(), getBot(), history(), main(), saveBot(), test()

### Community 108 - "bot_backup_test.js"
Cohesion: 0.25
Nodes (5): botDb, botsHandlers, __dirname, endpointDb, repoRoot

### Community 109 - "listing_projection_test.js"
Cohesion: 0.32
Nodes (7): APP_VARS, main(), mockReply, mockRequest, runEndpoint(), show(), ssh2-sftp-client

### Community 110 - "mcp_docs_consistency_test.mjs"
Cohesion: 0.25
Nodes (8): allowScripts, canvas@3.2.3, @google/genai@1.52.0, oracledb@6.10.0, protobufjs@7.6.5, puppeteer@25.8.0, @sap/hana-client@2.29.25, sqlite3@6.0.1

### Community 111 - "allowScripts"
Cohesion: 0.32
Nodes (6): createAIProviderAdapter(), isAzureOpenAIConfig(), normalizeProviderKey(), registerAIProviderAdapter(), resolveProviderConfig(), resolveResponseTimeoutMs()

### Community 112 - "audit/index.js"
Cohesion: 0.52
Nodes (5): crearCierraDePaso(), LIMITE_POR_DEFECTO, limiteDesdeEntorno(), mapConCierre(), normalizarLimite()

### Community 113 - "resolveProviderConfig"
Cohesion: 0.48
Nodes (6): instrumentar(), runTests(), TAREA(), updateIntervalTaskStatus(), debeDrenarLote(), TASK_STATUS

### Community 114 - "concurrency.js"
Cohesion: 0.29
Nodes (6): category, description, handler, icon, label, name

### Community 115 - "interval_task_transition_test.js"
Cohesion: 0.29
Nodes (7): task_status, 0, 1, 2, 3, 4, 5

### Community 117 - "default/index.js"
Cohesion: 0.60
Nodes (5): callMcp(), main(), normalizeJsonc(), parseToolCallContent(), resolveMcpConfig()

### Community 118 - "JSON_ADAPTER"
Cohesion: 0.33
Nodes (6): overrides, @azure/identity, minimatch, sequelize, tar, uuid

### Community 119 - "errorPayload.js"
Cohesion: 0.33
Nodes (6): cron, interval, schedule_mode, schedule_mode, ui, conditional_fields

### Community 120 - "simulate_loader.js"
Cohesion: 0.33
Nodes (6): column, default, description, hard_maximum, minimum, max_backoff_seconds_per_task

### Community 121 - "createFunctionVM"
Cohesion: 0.70
Nodes (4): callMcp(), main(), normalizeJsonc(), resolveMcpConfig()

### Community 122 - "ref_node_path"
Cohesion: 0.40
Nodes (4): newVersion, packageData, packagePath, parts

### Community 123 - "mcp_schema_conversion.js"
Cohesion: 0.40
Nodes (5): suspension, column, description, reason_column, value

### Community 124 - "overrides"
Cohesion: 0.50
Nodes (5): convertToAnthropicMessages(), convertToGeminiContents(), normalizeMessageContentToString(), splitSystemMessages(), toContentText()

### Community 125 - "conditional_fields"
Cohesion: 0.50
Nodes (3): jsonDeepFilterOptimized(), matches(), recurse()

### Community 126 - "max_backoff_seconds_per_task"
Cohesion: 0.83
Nodes (3): createResponse(), run(), fnEndpointTest()

### Community 127 - "stableStringify"
Cohesion: 0.50
Nodes (3): mssql_demo_bind, mssql_demo_constant, mssql_demo_trans

### Community 129 - "mcp_tool_descriptions.js"
Cohesion: 0.50
Nodes (3): graphify-mcp, graphify_local, openfusion_system_remote_prd

### Community 130 - "@rdsslab/uFetch"
Cohesion: 0.50
Nodes (4): column, default, description, backoff_enabled

### Community 131 - "suspension"
Cohesion: 0.50
Nodes (4): docs, human_guide, main, skill

### Community 132 - "recurse"
Cohesion: 0.50
Nodes (4): observability, channel, event, tool

### Community 133 - "user_register.js"
Cohesion: 0.50
Nodes (4): scheduler_delay_ms, maximum_heartbeat, minimum, strategy

## Knowledge Gaps
- **12 isolated node(s):** `graphify-mcp`, `RFC-7230`, `mariadb`, `mongose`, `mysql2` (+7 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 820 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `sequelize` connect `sqlFunction.js` to `dependencies`, `bot_log.js`, `log.js`, `generate-index-html.js`, `bots/manifest.json`, `apiclient/index.js`, `schedule.js`, `handler/utils.js`, `ia.js`, `package.json`, `utils_path.js`, `RateLimitService.js`, `timer/worker.js`, `EndpointRuntimeService.js`, `owasp_top10.js`, `models.js`, `MONGODB/manifest.json`, `fetch_timeout_test.js`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **What connects `graphify-mcp`, `RFC-7230`, `mariadb` to the rest of the system?**
  _12 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `manager.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05136168179646441 - nodes in this community are weakly interconnected._
- **Why does `dependencies` connect `prd/endpoint/index.js` to `bots/manifest.json`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Should `dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.054647599591419814 - nodes in this community are weakly interconnected._
- **Why does `uuid` connect `ref_node_fs` to `bots/manifest.json`, `scripts`, `schedule.js`, `RateLimitService.js`, `lib/index.js`, `EndpointRuntimeService.js`, `mcp_contract_audit.js`, `websocket_manager.js`, `app/index.js`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Should `systemBot.telegram.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05209274314965372 - nodes in this community are weakly interconnected._