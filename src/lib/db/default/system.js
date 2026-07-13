export const system_app = {
  "vars": {},
  "params": {
    "users": []
  },
  "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
  "app": "system",
  "rowkey": 387,
  "iduser": null,
  "enabled": true,
  "description": "App System",
  "jwt_key": "a6c042e9-5516-484f-a502-051fa8906331",
  "createdAt": "2025-11-21T22:04:52.650Z",
  "updatedAt": "2025-11-22T00:11:41.979Z",
  "vrs": [
    {
      "value": "\"\\\"\\\\\\\"ok\\\\\\\"\\\"\"",
      "idvar": "d384f7ac-2dc1-4fa2-9b11-325e65d671c3",
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "name": "zz_test_probe",
      "type": "string",
      "environment": "prd",
      "createdAt": "2026-03-28T23:51:38.957Z",
      "updatedAt": "2026-03-28T23:51:38.957Z"
    },
    {
      "value": "\"\\\"\\\\\\\"ok\\\\\\\"\\\"\"",
      "idvar": "1862a5f1-c691-4296-9e68-def58fbe2dbb",
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "name": "zz_test_probe_cleanup",
      "type": "string",
      "environment": "qa",
      "createdAt": "2026-03-28T23:51:44.917Z",
      "updatedAt": "2026-03-28T23:51:44.917Z"
    },
    {
      "value": "\"\\\"\\\\\\\"before_create_app\\\\\\\"\\\"\"",
      "idvar": "4ba8bd0a-24b3-4301-93c6-d366fd8e7e14",
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "name": "zz_flow_marker",
      "type": "string",
      "environment": "dev",
      "createdAt": "2026-03-28T23:51:55.035Z",
      "updatedAt": "2026-03-28T23:51:55.035Z"
    }
  ],
  "endpoints": [
    {
      "ctrl": {},
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "system_interval_tasks_delete_prd",
        "title": "Delete System Interval Task (PRD)",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nDeletes an interval task in the system application on prd environment.",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May delete interval task scheduling state.",
        "safe_alternative": "Use read-only tools to inspect current task state before deletion."
      },
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": {}
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "auth": {
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          },
          "selection": 0
        }
      },
      "idendpoint": "e753e2db-ca20-4607-82b7-34b70e435a0c",
      "rowkey": 179,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/interval_tasks/delete",
      "method": "DELETE",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Delete interval task",
      "description": "Delete an interval task in system/prd.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "interval_tasks,delete,system,prd",
      "code": "fndeleteIntervalTask",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.726Z",
      "updatedAt": "2026-07-13T17:28:59.533Z"
    },
    {
      "ctrl": {},
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "2c6d77b7-d8e2-49e2-9c63-a98a873b389c",
      "rowkey": 504,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/users/list",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetUsersList",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.726Z",
      "updatedAt": "2025-11-22T00:11:42.113Z"
    },
    {
      "ctrl": {
        "admin": true
      },
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "a71cd2ed-8456-4e5e-8ab5-b7724a908194",
      "rowkey": 735,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/apiclient",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Create user external",
      "description": "Create user external",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnCreateApiClient",
      "cache_time": 0,
      "createdAt": "2025-12-02T00:16:24.771Z",
      "updatedAt": "2025-12-03T16:27:48.432Z"
    },
    {
      "ctrl": {
        "admin": true
      },
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "00034cf9-4c94-43ba-bc7a-3d762f62d7ff",
      "rowkey": 171,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/app/backup",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "Get App data to backup by idapp",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetAppBackupById",
      "cache_time": 30,
      "createdAt": "2025-11-21T22:04:52.723Z",
      "updatedAt": "2025-11-22T00:11:42.105Z"
    },
    {
      "ctrl": {
        "admin": true
      },
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "a71cd2ed-8456-4e5e-8ab5-b7724a908193",
      "rowkey": 492,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/user/create",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "Create user admin",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnCreateUser",
      "cache_time": 0,
      "createdAt": "2025-12-02T00:16:24.771Z",
      "updatedAt": "2025-12-03T16:27:48.432Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "upsert_js_endpoint_handler",
        "title": "UPSERT JS Endpoint",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nCreates or updates JS endpoints using a simplified payload. Send `js_code` and this wrapper maps it to endpoint_upsert with handler=JS.",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May create, update, delete, restore, migrate, or invalidate application resources.",
        "safe_alternative": "Use a read-only catalog/search/status tool first to verify target ids and scope."
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idendpoint": {
                "type": "string",
                "format": "uuid",
                "description": "Endpoint identifier. Omit for INSERT; provide for UPDATE."
              },
              "enabled": {
                "type": "boolean",
                "description": "Whether the endpoint should be enabled."
              },
              "idapp": {
                "type": "string",
                "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
                "description": "Application identifier. Accepts RFC UUID and legacy IDs already present in existing datasets."
              },
              "environment": {
                "type": "string",
                "enum": [
                  "dev",
                  "qa",
                  "prd"
                ],
                "description": "Target environment."
              },
              "timeout": {
                "type": "integer",
                "minimum": 0,
                "description": "Execution timeout in seconds."
              },
              "resource": {
                "type": "string",
                "minLength": 1,
                "maxLength": 300,
                "description": "HTTP resource path."
              },
              "method": {
                "type": "string",
                "enum": [
                  "GET",
                  "POST",
                  "PUT",
                  "PATCH",
                  "DELETE",
                  "OPTIONS",
                  "HEAD"
                ],
                "description": "HTTP method for the endpoint."
              },
              "access": {
                "type": "integer",
                "enum": [
                  0,
                  1,
                  2,
                  3,
                  4
                ],
                "description": "Access level."
              },
              "title": {
                "type": "string",
                "maxLength": 200,
                "description": "Human-readable endpoint title."
              },
              "description": {
                "type": "string",
                "description": "Endpoint purpose description."
              },
              "price_by_request": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per request in millicents."
              },
              "price_kb_request": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per request KB in millicents."
              },
              "price_kb_response": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per response KB in millicents."
              },
              "keywords": {
                "type": "string",
                "description": "Search keywords."
              },
              "ctrl": {
                "$ref": "#/$defs/jsonValue"
              },
              "js_code": {
                "type": "string",
                "description": "JavaScript source code stored in endpoint_upsert.code. Use $_RETURN_DATA_ for responses instead of return."
              },
              "custom_data": {
                "$ref": "#/$defs/jsonValue",
                "description": "Optional custom_data object forwarded to endpoint_upsert."
              },
              "cors": {
                "$ref": "#/$defs/jsonValue"
              },
              "cache_time": {
                "type": "integer",
                "minimum": 0,
                "description": "Cache time in seconds."
              },
              "mcp": {
                "$ref": "#/$defs/jsonValue"
              },
              "json_schema": {
                "$ref": "#/$defs/jsonValue"
              },
              "headers_test": {
                "$ref": "#/$defs/jsonValue"
              },
              "data_test": {
                "$ref": "#/$defs/jsonValue"
              }
            },
            "additionalProperties": false,
            "required": [
              "idapp",
              "environment",
              "timeout",
              "resource",
              "method",
              "access",
              "title",
              "description",
              "price_by_request",
              "price_kb_request",
              "price_kb_response",
              "keywords",
              "js_code",
              "cache_time"
            ],
            "$defs": {
              "jsonValue": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "array",
                    "items": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "string"
                  },
                  {
                    "type": "number"
                  },
                  {
                    "type": "integer"
                  },
                  {
                    "type": "boolean"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "jswrapperquery01",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idapp": "<idapp-uuid>",
              "environment": "prd",
              "resource": "/scripts/ping",
              "method": "GET",
              "access": 0,
              "title": "Ping JS",
              "description": "Simple JS endpoint",
              "timeout": 30,
              "cache_time": 0,
              "price_by_request": 1,
              "price_kb_request": 1,
              "price_kb_response": 1,
              "keywords": "js,endpoint",
              "js_code": "$_RETURN_DATA_ = { ok: true };"
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "9d1027b2-3e8d-4c94-88b6-8b0d5b1f3e6a",
      "rowkey": 210,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint/js",
      "method": "POST",
      "handler": "JS",
      "access": 3,
      "title": "UPSERT JS Handler Endpoint",
      "description": "Create or modify in OpenFusion API an endpoint that runs JavaScript (JS handler).",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "js,endpoint",
      "code": "const uF = uFetchAutoEnv.auto('/api/system/api/endpoint/auto', true);\nconst body = request.body || {};\nconst auth = request?.headers?.authorization || request?.headers?.Authorization || '';\nconst data = {\n  ...body,\n  handler: 'JS',\n  code: body.js_code ?? body.code ?? '',\n};\n\ndelete data.js_code;\n\nconst req1 = await uF.post({ data, headers: auth ? { authorization: auth } : undefined });\nconst resp = await req1.json();\n$_RETURN_DATA_ = resp;",
      "cache_time": 0,
      "createdAt": "2026-05-19T12:00:00.000Z",
      "updatedAt": "2026-05-19T12:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true
      },
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "3eb8b6c8-e001-43e6-9ace-517a05d33e6b",
      "rowkey": 507,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/websocket/hooks",
      "method": "WS",
      "handler": "NA",
      "access": 0,
      "title": "",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.723Z",
      "updatedAt": "2025-11-22T00:11:42.103Z"
    },
    {
      "ctrl": {
        "admin": true
      },
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "d7737d40-5cd8-45f2-a60a-1014272a2faf",
      "rowkey": 157,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/system/environment/0.01",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetEnvironment",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.722Z",
      "updatedAt": "2025-11-22T00:11:42.102Z"
    },
    {
      "ctrl": {},
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "3ead2170-283d-4c6a-abc1-eddd217b6d01",
      "rowkey": 856,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/cache/clear",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnClearCache",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.723Z",
      "updatedAt": "2025-11-22T00:11:42.105Z"
    },
    {
      "ctrl": {
        "admin": true
      },
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "0144753a-61a6-4ee1-8ae5-1d871dd21d24",
      "rowkey": 774,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/system/method/0.01",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetMethod",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.725Z",
      "updatedAt": "2025-11-22T00:11:42.109Z"
    },
    {
      "ctrl": {},
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "047845ac-5367-48ed-9465-8e36ba6c7bae",
      "rowkey": 733,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/cache/response/size",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetCacheSize",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.723Z",
      "updatedAt": "2025-11-22T00:11:42.104Z"
    },
    {
      "ctrl": {
        "admin": true
      },
      "cors": {},
      "mcp": {},
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "restore": {
                "type": "boolean",
                "description": "Whether to force restore system endpoints from seed backups."
              }
            },
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "12fb738c-7d1f-4eba-afb4-508a9fa9d06a",
      "rowkey": 392,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/restore",
      "method": "PUT",
      "handler": "FUNCTION",
      "access": 0,
      "title": "",
      "description": "Check and restore default endpoints",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "restore",
      "code": "fnCheckSystemApp",
      "cache_time": 0,
      "createdAt": "2025-12-04T19:48:28.390Z",
      "updatedAt": "2025-12-05T04:40:40.564Z"
    },
    {
      "ctrl": {
        "admin": true
      },
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "a71cd2ed-8456-4e5e-8ab5-b7724a908191",
      "rowkey": 842,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/user/changepassword",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "Update user password",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnUpdateUserPassword",
      "cache_time": 0,
      "createdAt": "2025-11-30T04:19:03.270Z",
      "updatedAt": "2025-12-03T16:27:48.432Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {}
      },
      "cors": {},
      "mcp": {},
      "json_schema": {
        "in": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "adbumcb7z",
            "type": 1
          }
        ],
        "body": {
          "selection": 0
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "caa8b54a-eb5e-4134-8ae2-a3946a428ec7",
      "rowkey": 77,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/app/var",
      "method": "DELETE",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "Delete app var",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnDeleteAppVar",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.724Z",
      "updatedAt": "2025-11-22T00:11:42.106Z"
    },
    {
      "ctrl": {
        "admin": true
      },
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "89b6d2c3-5d9e-4c18-9221-5f2673c17bb3",
      "rowkey": 459,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/apiclient/login",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 0,
      "title": "",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnLoginApiClient",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.727Z",
      "updatedAt": "2025-11-22T00:11:42.114Z"
    },
    {
      "ctrl": {
        "admin": true
      },
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "01034cf9-4c94-43ba-bc7a-3d762f62d7ff",
      "rowkey": 322,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/app/backup",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "Restore App data from backup by idapp",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnRestoreAppFromBackup",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.724Z",
      "updatedAt": "2025-11-22T00:11:42.105Z"
    },
    {
      "ctrl": {
        "users": [],
        "log": {}
      },
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "body": {
          "js": {
            "code": "{}"
          },
          "xml": {
            "code": ""
          },
          "text": {},
          "selection": 0
        },
        "auth": {
          "basic": {},
          "bearer": {},
          "selection": 0
        },
        "headers": [
          {
            "enabled": true,
            "key": "",
            "value": "",
            "internal_hash_row": "b9427bedda283d6b3c25ad634983b8bfbfc32d5a3006a5a9d6c541a332f1d983"
          }
        ],
        "query": [
          {
            "enabled": true,
            "key": "",
            "value": "",
            "internal_hash_row": "b9427bedda283d6b3c25ad634983b8bfbfc32d5a3006a5a9d6c541a332f1d983"
          }
        ]
      },
      "idendpoint": "18731c87-9d59-44b6-8871-ecaa493008e5",
      "rowkey": 51,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/system/log",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnInsertLog",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.723Z",
      "updatedAt": "2025-11-22T00:11:42.104Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {}
      },
      "cors": {},
      "mcp": {},
      "json_schema": {
        "in": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "x3dpikcda",
            "type": 1
          }
        ],
        "body": {
          "selection": 0
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "[\n  {\n    \"handler\": \"FETCH\",\n    \"label\": \"Fetch\",\n    \"description\": \"It makes HTTP requests to external services using the Fetch API. It functions as an HTTP proxy.\",\n    \"css_class\": \"primary\",\n    \"css_icon\": \"fa-solid fa-globe\"\n  },\n  {\n    \"handler\": \"FUNCTION\",\n    \"label\": \"Function\",\n    \"description\": \"Call a custom function created on the server.\",\n    \"css_class\": \"fa-solid fa-robot\",\n    \"css_icon\": \"danger\"\n  },\n  {\n    \"handler\": \"HANA\",\n    \"label\": \"HANA\",\n    \"description\": \"Easily execute SQL queries on SAP HANA databases. The endpoint can receive parameters that will be sent to the query and returns the query result.\",\n    \"css_class\": \"\",\n    \"css_icon\": \"fa-solid fa-database\"\n  },\n  {\n    \"handler\": \"JS\",\n    \"label\": \"JavaScript\",\n    \"description\": \"It allows you to write JavaScript code that can be executed on the server. Several predefined modules are available for use.\",\n    \"css_class\": \"success\",\n    \"css_icon\": \"fa-brands fa-js\",\n    \"modules\": {\n      \"O",
          "sizeKBResponse": "52.86"
        }
      },
      "idendpoint": "17c211d6-8c81-4274-b5c4-604126454ab0",
      "rowkey": 440,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/system/handler/0.01",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetHandler",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.727Z",
      "updatedAt": "2025-11-22T00:11:42.114Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": false,
        "name": "",
        "title": "",
        "description": ""
      },
      "json_schema": {
        "in": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "evgcn9zdx",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "15034cf9-4c94-43ba-bc7a-3d762f62d7de",
      "rowkey": 701,
      "enabled": false,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/app/0.01",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetAppById",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.724Z",
      "updatedAt": "2025-11-22T00:11:42.106Z"
    },
    {
      "ctrl": {
        "users": [],
        "log": {}
      },
      "cors": {},
      "mcp": {},
      "json_schema": {
        "in": {
          "enabled": false,
          "schema": {}
        },
        "out": {}
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": {}
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": ""
          }
        ],
        "auth": {
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          },
          "selection": 0
        }
      },
      "idendpoint": "34870b00-beb1-45d3-ada6-c164fc22cd7a",
      "rowkey": 515,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/log/app/summary",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "Get summary by idapp from logs",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetLogSummaryByAppStatusCode",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.726Z",
      "updatedAt": "2025-11-22T00:11:42.112Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "agent_onboarding",
        "title": "Agent Onboarding Guide",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns best practices, recommended workflows, and key tips for MCP agents (AI or human) to use the OpenFusionAPI toolset efficiently and safely. Agents must not modify endpoints unless the user explicitly requests it or explicitly authorizes it, with stricter caution for endpoints in the system application. All content is provided in English.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A",
        "exampleRequest": {}
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": false
          }
        },
        "out": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "summary": {
                "type": "string",
                "description": "Best practices and onboarding summary for agents."
              },
              "links": {
                "type": "object",
                "description": "Key tool references.",
                "properties": {
                  "handler_documentation": {
                    "type": "string"
                  },
                  "endpoint_upsert": {
                    "type": "string"
                  },
                  "get_system_logs": {
                    "type": "string"
                  },
                  "mcp_readme": {
                    "type": "string"
                  },
                  "mcp_skill": {
                    "type": "string"
                  }
                },
                "additionalProperties": false
              },
              "trace_id": {
                "type": "string",
                "description": "Request trace identifier when available in header ofapi-trace-id."
              }
            },
            "required": [
              "summary"
            ],
            "additionalProperties": false
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "summary": "Welcome to OpenFusionAPI. To get handler details, use /api/handler/documentation. To get handler skills and guidelines, use /api/handler/skill.",
              "links": {
                "handler_documentation": "/api/handler/documentation",
                "handler_skill": "/api/handler/skill",
                "endpoint_upsert": "/api/endpoint",
                "get_system_logs": "/api/system/logs"
              }
            }
          }
        }
      },
      "idendpoint": "caab6e15-dc01-4590-bcc5-f5ff66c4177a",
      "rowkey": 526,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 10,
      "resource": "/api/agent_onboarding",
      "method": "GET",
      "handler": "JS",
      "access": 0,
      "title": "Agent Onboarding Guide",
      "description": "Returns best practices, recommended workflows, and key tips for MCP agents (AI or human) to use the OpenFusionAPI toolset efficiently and safely. All content is provided in English.",
      "price_by_request": 0,
      "price_kb_request": 0,
      "price_kb_response": 0,
      "keywords": "onboarding,guide,agent,AI,best practices",
      "code": "const trace_id = request?.headers?.['ofapi-trace-id'] || '';\n$_RETURN_DATA_ = {\n  summary: 'Welcome to OpenFusionAPI. To get handler details, use /api/handler/documentation. To get handler skills and guidelines, use /api/handler/skill.',\n  links: {\n    handler_documentation: '/api/handler/documentation',\n    handler_skill: '/api/handler/skill',\n    endpoint_upsert: '/api/endpoint',\n    get_system_logs: '/api/system/logs'\n  },\n  trace_id\n};",
      "cache_time": 3600,
      "createdAt": "2026-05-19T00:00:00.000Z",
      "updatedAt": "2026-05-19T00:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true
      },
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "131cca3e-f835-4414-89ca-5ddbbec5ab89",
      "rowkey": 814,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/system/logout/0.01",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnLogout",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.724Z",
      "updatedAt": "2025-11-22T00:11:42.107Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "upsert_soap_endpoint_handler",
        "title": "UPSERT SOAP Endpoint",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nCreates or updates SOAP endpoints using a simplified payload. Send `soap_config` and this wrapper maps it to endpoint_upsert with handler=SOAP.",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May create, update, delete, restore, migrate, or invalidate application resources.",
        "safe_alternative": "Use a read-only catalog/search/status tool first to verify target ids and scope."
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idendpoint": {
                "type": "string",
                "format": "uuid",
                "description": "Endpoint identifier. Omit for INSERT; provide for UPDATE."
              },
              "enabled": {
                "type": "boolean",
                "description": "Whether the endpoint should be enabled."
              },
              "idapp": {
                "type": "string",
                "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
                "description": "Application identifier. Accepts RFC UUID and legacy IDs already present in existing datasets."
              },
              "environment": {
                "type": "string",
                "enum": [
                  "dev",
                  "qa",
                  "prd"
                ],
                "description": "Target environment."
              },
              "timeout": {
                "type": "integer",
                "minimum": 0,
                "description": "Execution timeout in seconds."
              },
              "resource": {
                "type": "string",
                "minLength": 1,
                "maxLength": 300,
                "description": "HTTP resource path."
              },
              "method": {
                "type": "string",
                "enum": [
                  "GET",
                  "POST",
                  "PUT",
                  "PATCH",
                  "DELETE",
                  "OPTIONS",
                  "HEAD"
                ],
                "description": "HTTP method for the endpoint."
              },
              "access": {
                "type": "integer",
                "enum": [
                  0,
                  1,
                  2,
                  3,
                  4
                ],
                "description": "Access level."
              },
              "title": {
                "type": "string",
                "maxLength": 200,
                "description": "Human-readable endpoint title."
              },
              "description": {
                "type": "string",
                "description": "Endpoint purpose description."
              },
              "price_by_request": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per request in millicents."
              },
              "price_kb_request": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per request KB in millicents."
              },
              "price_kb_response": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per response KB in millicents."
              },
              "keywords": {
                "type": "string",
                "description": "Search keywords."
              },
              "ctrl": {
                "$ref": "#/$defs/jsonValue"
              },
              "soap_config": {
                "$ref": "#/$defs/jsonValue",
                "description": "SOAP configuration object stored in custom_data (for example wsdl, functionName, security options)."
              },
              "code": {
                "type": "string",
                "description": "Optional fallback code/AppVar reference. When `soap_config` has wsdl this wrapper can keep code empty."
              },
              "custom_data": {
                "$ref": "#/$defs/jsonValue",
                "description": "Optional extra custom_data merged with soap_config."
              },
              "cors": {
                "$ref": "#/$defs/jsonValue"
              },
              "cache_time": {
                "type": "integer",
                "minimum": 0,
                "description": "Cache time in seconds."
              },
              "mcp": {
                "$ref": "#/$defs/jsonValue"
              },
              "json_schema": {
                "$ref": "#/$defs/jsonValue"
              },
              "headers_test": {
                "$ref": "#/$defs/jsonValue"
              },
              "data_test": {
                "$ref": "#/$defs/jsonValue"
              }
            },
            "additionalProperties": false,
            "required": [
              "idapp",
              "environment",
              "timeout",
              "resource",
              "method",
              "access",
              "title",
              "description",
              "price_by_request",
              "price_kb_request",
              "price_kb_response",
              "keywords",
              "soap_config",
              "cache_time"
            ],
            "$defs": {
              "jsonValue": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "array",
                    "items": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "string"
                  },
                  {
                    "type": "number"
                  },
                  {
                    "type": "integer"
                  },
                  {
                    "type": "boolean"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "soapwrapperquery01",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idapp": "<idapp-uuid>",
              "environment": "prd",
              "resource": "/ofapi/soap/number_to_words",
              "method": "GET",
              "access": 0,
              "title": "SOAP Number To Words",
              "description": "SOAP proxy endpoint",
              "timeout": 30,
              "cache_time": 0,
              "price_by_request": 1,
              "price_kb_request": 1,
              "price_kb_response": 1,
              "keywords": "soap,endpoint",
              "soap_config": {
                "wsdl": "https://www.dataaccess.com/webservicesserver/numberconversion.wso?WSDL",
                "functionName": "NumberToWords"
              }
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "b5721f7f-0f21-4d4f-b9b9-2a66bb68dbe0",
      "rowkey": 960,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint/soap",
      "method": "POST",
      "handler": "JS",
      "access": 3,
      "title": "UPSERT SOAP Handler Endpoint",
      "description": "Create or modify in OpenFusion API a SOAP handler endpoint.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "soap,endpoint",
      "code": "const uF = uFetchAutoEnv.auto('/api/system/api/endpoint/auto', true);\nconst body = request.body || {};\nconst auth = request?.headers?.authorization || request?.headers?.Authorization || '';\nconst custom_data = (body.custom_data && typeof body.custom_data === 'object') ? { ...body.custom_data } : {};\n\nif (body.soap_config && typeof body.soap_config === 'object') {\n  Object.assign(custom_data, body.soap_config);\n}\n\nconst data = {\n  ...body,\n  handler: 'SOAP',\n  code: body.code ?? '',\n  custom_data,\n};\n\ndelete data.soap_config;\n\nconst req1 = await uF.post({ data, headers: auth ? { authorization: auth } : undefined });\nconst resp = await req1.json();\n$_RETURN_DATA_ = resp;",
      "cache_time": 0,
      "createdAt": "2026-05-19T12:00:00.000Z",
      "updatedAt": "2026-05-19T12:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true
      },
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "d7737d40-5cd8-45f2-a60a-1014272a2fa0",
      "rowkey": 326,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/system/environment",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetEnvironment",
      "cache_time": 90,
      "createdAt": "2025-11-21T22:04:52.722Z",
      "updatedAt": "2025-11-22T00:11:42.102Z"
    },
    {
      "ctrl": {},
      "cors": {},
      "mcp": {},
      "json_schema": {
        "in": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": {}
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "auth": {
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          },
          "selection": 0
        }
      },
      "idendpoint": "0b48cd44-09fe-40e7-b0a7-59fe01e054cc",
      "rowkey": 138,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/information/static",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetSystemInfoStatic",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.723Z",
      "updatedAt": "2025-11-22T00:11:42.103Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "list_all_bots",
        "title": "List All API Clients (Bots)",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns all registered API clients (also referred to as bots). An API client is an external agent or service that authenticates via API key to call OpenFusionAPI endpoints. Each entry includes the client credentials and the app it is associated with. Use 'list_api_clients' to filter by username or idclient.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "title": "ListAllBotsRequest",
            "type": "object",
            "additionalProperties": false,
            "properties": {}
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "tknoj6ef6",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "3d2fff88-66a6-43b5-9cab-11b5aec1a706",
      "rowkey": 160,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/apikey",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 3,
      "title": "Get API Key",
      "description": "Get API Key",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetApiKeyByFilters",
      "cache_time": 30,
      "createdAt": "2026-02-21T07:45:25.852Z",
      "updatedAt": "2026-02-21T07:45:25.852Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": false,
        "name": "",
        "title": "",
        "description": ""
      },
      "json_schema": {
        "in": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {
              "from": {
                "type": "string",
                "format": "email",
                "description": "Email del remitente (ej: onboarding@resend.dev). Debe ser verificado/authenticado.",
                "examples": [
                  "onboarding@resend.dev"
                ]
              },
              "to": {
                "type": "string",
                "format": "email",
                "description": "Email del destinatario (string simple; extender a array si necesario).",
                "examples": [
                  "delivered@resend.dev"
                ]
              },
              "subject": {
                "type": "string",
                "minLength": 1,
                "maxLength": 998,
                "description": "Asunto del email.",
                "examples": [
                  "Hello World"
                ]
              },
              "html": {
                "type": "string",
                "description": "Cuerpo del email en HTML.",
                "examples": [
                  "<strong>it works!</strong>"
                ]
              }
            },
            "additionalProperties": false,
            "title": "Email Request Schema (Resend-like)",
            "description": "Esquema para enviar un email con from, to, subject y html body.",
            "required": [
              "from",
              "to",
              "subject",
              "html"
            ]
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "from": "onboarding@resend.dev",
              "to": "delivered@resend.dev",
              "subject": "Hello World",
              "html": "<strong>it works!</strong>"
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": {}
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1,
          "MimeType": ""
        }
      },
      "idendpoint": "cff35b3a-7ca0-4ef8-882d-d39815d55616",
      "rowkey": 479,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/email/smtp",
      "method": "POST",
      "handler": "JS",
      "access": 2,
      "title": "",
      "description": "Send emails using SMTP.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "const transporter = nodemailer.createTransport($_VAR_SMTP_TRANSPORT);\n// TODO: Create $_VAR_SMTP_TRANSPORT always\n\n/*\nOn Body\n{\n  from: \"onboarding@resend.dev\",\n  to: \"delivered@resend.dev\",\n  subject: \"Hello World\",\n  html: \"<strong>it works!</strong>\",\n}\n*/\nconst info = await transporter.sendMail(request.body);\n\n$_RETURN_DATA_ = info;",
      "cache_time": 0,
      "createdAt": "2025-12-03T16:55:58.599Z",
      "updatedAt": "2025-12-03T16:55:58.599Z"
    },
    {
      "ctrl": {},
      "cors": {},
      "mcp": {},
      "json_schema": {
        "in": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": {}
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "auth": {
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          },
          "selection": 0
        }
      },
      "idendpoint": "38d64e6e-e3a2-4664-abb9-cc9b1abeaf31",
      "rowkey": 648,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/app/internal/metrics",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "Return internal metrics",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetInternalAppMetrics",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.725Z",
      "updatedAt": "2025-11-22T00:11:42.109Z"
    },
    {
      "ctrl": {
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "handler_library_documentation",
        "title": "JS Handler Library Documentation",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns the detailed documentation for a specific library or helper function available in the JS handler sandbox (e.g., createPDFFromHTML, uFetch, luxon).",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "handler": {
                "type": "string",
                "minLength": 1,
                "maxLength": 25,
                "pattern": "^[A-Z_]+$",
                "description": "Handler identifier in uppercase. Value: JS."
              },
              "library": {
                "type": "string",
                "minLength": 1,
                "maxLength": 100,
                "pattern": "^[a-zA-Z0-9$_-]+$",
                "description": "Optional name of the library or variable to get the detailed markdown documentation. If omitted, returns the list of available libraries."
              }
            },
            "additionalProperties": false,
            "title": "HandlerLibraryDocumentation",
            "required": [
              "handler"
            ]
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": true,
            "key": "handler",
            "value": "JS",
            "_id": "t1h2l3d4"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "{\"handler\":\"JS\",\"libraries\":[]}",
          "sizeKBResponse": "0.1"
        }
      },
      "idendpoint": "24da7819-8823-4835-87c5-04b792bc594e",
      "rowkey": 672,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/handler/js/libraries",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 0,
      "title": "JavaScript Handler Libraries",
      "description": "Permite consultar la lista de librerías disponibles en el sandbox de JS o ver el detalle específico de una de ellas.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "mcp,js,libraries,docs",
      "code": "fnGetHandlerLibraryDocs",
      "cache_time": 0,
      "createdAt": "2026-06-28T04:20:00.000Z",
      "updatedAt": "2026-06-28T04:20:00.000Z"
    },
    {
      "ctrl": {
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "get_handler_skill",
        "title": "Get Handler Skill",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns the AI agent skill instructions, role definition, templates, and constraints for a specific endpoint handler.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "handler": {
                "type": "string",
                "minLength": 1,
                "maxLength": 25,
                "pattern": "^[A-Z_]+$",
                "description": "Handler identifier in uppercase (e.g. JS, SQL, FETCH, TEXT, etc.)."
              }
            },
            "additionalProperties": false,
            "title": "GetHandlerSkill",
            "required": [
              "handler"
            ]
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {}
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": true,
            "key": "handler",
            "value": "JS",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368",
            "_id": "gethandlerskillquery01",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "{}",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "7a3721cf-71d5-45d2-97b7-6cb5b7d9b3d1",
      "rowkey": 861,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/handler/skill",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 0,
      "title": "Get Handler Skill",
      "description": "Returns AI agent skill guidelines for a supported handler.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "skill,mcp,ai,agent",
      "code": "fnGetHandlerSkill",
      "cache_time": 3600,
      "createdAt": "2026-06-27T12:00:00.000Z",
      "updatedAt": "2026-06-27T12:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {},
      "json_schema": {
        "in": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "vbe7fffrs",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "787a8ec2-b0d7-44ae-9214-2254f9d9d086",
      "rowkey": 639,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/mcp/server",
      "method": "POST",
      "handler": "MCP",
      "access": 0,
      "title": "OpenFusionAPI MCP",
      "description": "OpenFusionAPI MCP Server.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "mcp,server,OpenFusionAPI",
      "code": "",
      "cache_time": 10,
      "createdAt": "2026-02-17T14:03:38.449Z",
      "updatedAt": "2026-02-17T14:03:38.449Z"
    },
    {
      "ctrl": {},
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "body": {
          "json": {
            "code": ""
          },
          "xml": {
            "code": ""
          },
          "text": {},
          "selection": 0
        },
        "auth": {
          "basic": {},
          "bearer": {},
          "selection": 0
        },
        "headers": [
          {
            "enabled": true,
            "key": "",
            "value": "",
            "internal_hash_row": "b9427bedda283d6b3c25ad634983b8bfbfc32d5a3006a5a9d6c541a332f1d983"
          }
        ],
        "query": [
          {
            "enabled": true,
            "key": "",
            "value": "",
            "internal_hash_row": "b9427bedda283d6b3c25ad634983b8bfbfc32d5a3006a5a9d6c541a332f1d983"
          }
        ]
      },
      "idendpoint": "4c2516ec-d7c4-4783-8ee5-f7dac5b68a91",
      "rowkey": 648,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/responses/status_code/count",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetResponseCountStatus",
      "cache_time": 2,
      "createdAt": "2025-11-21T22:04:52.727Z",
      "updatedAt": "2025-11-22T00:11:42.114Z"
    },
    {
      "ctrl": {
        "admin": true
      },
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "15034cf9-4c94-43ba-bc7a-3d762f62d7ee",
      "rowkey": 474,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/app/documentation",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "Get documentation to endpoints by app id",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetAppDocById",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.724Z",
      "updatedAt": "2025-11-22T00:11:42.106Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "upsert_fetch_endpoint_handler",
        "title": "UPSERT FETCH Endpoint",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nCreates or updates FETCH endpoints using a simplified payload. Send `target_url` and this wrapper maps it to endpoint_upsert with handler=FETCH.",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May create, update, delete, restore, migrate, or invalidate application resources.",
        "safe_alternative": "Use a read-only catalog/search/status tool first to verify target ids and scope."
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idendpoint": {
                "type": "string",
                "format": "uuid",
                "description": "Endpoint identifier. Omit for INSERT; provide for UPDATE."
              },
              "enabled": {
                "type": "boolean",
                "description": "Whether the endpoint should be enabled."
              },
              "idapp": {
                "type": "string",
                "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
                "description": "Application identifier. Accepts RFC UUID and legacy IDs already present in existing datasets."
              },
              "environment": {
                "type": "string",
                "enum": [
                  "dev",
                  "qa",
                  "prd"
                ],
                "description": "Target environment."
              },
              "timeout": {
                "type": "integer",
                "minimum": 0,
                "description": "Execution timeout in seconds."
              },
              "resource": {
                "type": "string",
                "minLength": 1,
                "maxLength": 300,
                "description": "HTTP resource path."
              },
              "method": {
                "type": "string",
                "enum": [
                  "GET",
                  "POST",
                  "PUT",
                  "PATCH",
                  "DELETE",
                  "OPTIONS",
                  "HEAD"
                ],
                "description": "HTTP method for the endpoint."
              },
              "access": {
                "type": "integer",
                "enum": [
                  0,
                  1,
                  2,
                  3,
                  4
                ],
                "description": "Access level."
              },
              "title": {
                "type": "string",
                "maxLength": 200,
                "description": "Human-readable endpoint title."
              },
              "description": {
                "type": "string",
                "description": "Endpoint purpose description."
              },
              "price_by_request": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per request in millicents."
              },
              "price_kb_request": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per request KB in millicents."
              },
              "price_kb_response": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per response KB in millicents."
              },
              "keywords": {
                "type": "string",
                "description": "Search keywords."
              },
              "ctrl": {
                "$ref": "#/$defs/jsonValue"
              },
              "target_url": {
                "type": "string",
                "minLength": 1,
                "description": "Target URL stored in endpoint_upsert.code for FETCH handler."
              },
              "custom_data": {
                "$ref": "#/$defs/jsonValue",
                "description": "Optional custom_data object forwarded to endpoint_upsert."
              },
              "cors": {
                "$ref": "#/$defs/jsonValue"
              },
              "cache_time": {
                "type": "integer",
                "minimum": 0,
                "description": "Cache time in seconds."
              },
              "mcp": {
                "$ref": "#/$defs/jsonValue"
              },
              "json_schema": {
                "$ref": "#/$defs/jsonValue"
              },
              "headers_test": {
                "$ref": "#/$defs/jsonValue"
              },
              "data_test": {
                "$ref": "#/$defs/jsonValue"
              }
            },
            "additionalProperties": false,
            "required": [
              "idapp",
              "environment",
              "timeout",
              "resource",
              "method",
              "access",
              "title",
              "description",
              "price_by_request",
              "price_kb_request",
              "price_kb_response",
              "keywords",
              "target_url",
              "cache_time"
            ],
            "$defs": {
              "jsonValue": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "array",
                    "items": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "string"
                  },
                  {
                    "type": "number"
                  },
                  {
                    "type": "integer"
                  },
                  {
                    "type": "boolean"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "fetchwrapperquery01",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idapp": "<idapp-uuid>",
              "environment": "prd",
              "resource": "/external/weather",
              "method": "GET",
              "access": 0,
              "title": "Weather proxy",
              "description": "Proxy to external weather API",
              "timeout": 30,
              "cache_time": 0,
              "price_by_request": 1,
              "price_kb_request": 1,
              "price_kb_response": 1,
              "keywords": "fetch,proxy",
              "target_url": "https://api.example.com/weather"
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "a2ea8b7a-9c6d-4d4a-bf6e-0c3fe38f6bf1",
      "rowkey": 494,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint/fetch",
      "method": "POST",
      "handler": "JS",
      "access": 3,
      "title": "UPSERT FETCH Handler Endpoint",
      "description": "Create or modify in OpenFusion API an endpoint that proxies to an external URL (FETCH handler).",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "fetch,endpoint",
      "code": "const uF = uFetchAutoEnv.auto('/api/system/api/endpoint/auto', true);\nconst body = request.body || {};\nconst auth = request?.headers?.authorization || request?.headers?.Authorization || '';\nconst data = {\n  ...body,\n  handler: 'FETCH',\n  code: body.target_url ?? body.url ?? body.code ?? '',\n};\n\ndelete data.target_url;\ndelete data.url;\n\nconst req1 = await uF.post({ data, headers: auth ? { authorization: auth } : undefined });\nconst resp = await req1.json();\n$_RETURN_DATA_ = resp;",
      "cache_time": 0,
      "createdAt": "2026-05-19T12:00:00.000Z",
      "updatedAt": "2026-05-19T12:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "cache_status",
        "title": "Get Endpoint Cache Status",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns a catalog of currently cached endpoints for one app and optional environment. Use it to inspect cache state before/after invalidation.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idapp": {
                "type": "string",
                "description": "Application identifier used to filter cached endpoints."
              },
              "environment": {
                "type": "string",
                "description": "Optional environment filter (`dev`, `qa`, `prd`)."
              }
            },
            "additionalProperties": false
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": true,
            "key": "idapp",
            "value": "00000000-0000-0000-0000-000000000001",
            "type": 1
          },
          {
            "enabled": true,
            "key": "environment",
            "value": "prd",
            "type": 1
          }
        ],
        "body": {
          "selection": 0
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "d37f889f-f649-4935-ab8f-ccdde3faeb84",
      "rowkey": 152,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/cache/status",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Get endpoint cache status",
      "description": "Returns a list of cached endpoints filtered by `idapp` and optional `environment`.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "cache,status,idapp",
      "code": "fnEndpointCacheStatus",
      "cache_time": 0,
      "createdAt": "2026-05-11T00:00:00.000Z",
      "updatedAt": "2026-05-11T00:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": false,
        "name": "",
        "title": "",
        "description": ""
      },
      "json_schema": {
        "in": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "9l4922vfy",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "f57b01dc-a51c-4c23-ab4b-c890ca733e80",
      "rowkey": 779,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/apikey",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "API Key UPSERT",
      "description": "Create or Update API Key Token",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "apikey",
      "code": "fnUpsertApiKey",
      "cache_time": 0,
      "createdAt": "2026-02-21T04:34:49.323Z",
      "updatedAt": "2026-02-21T04:34:49.323Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_client_error": 2,
          "status_info": 1,
          "status_redirect": 1,
          "status_server_error": 3,
          "status_success": 1
        }
      },
      "cors": {},
      "mcp": {
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nConnects to a database using explicit Sequelize connection parameters, lists all tables (optional schema filter), and returns each table column structure.",
        "enabled": true,
        "name": "describe_all_tables",
        "title": "Describe All Database Tables",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "connection": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "database",
                  "username",
                  "password",
                  "dialect",
                  "host"
                ],
                "properties": {
                  "database": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Database name."
                  },
                  "username": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Database username."
                  },
                  "password": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Database password."
                  },
                  "dialect": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Sequelize dialect, for example `mssql`, `postgres`, `mysql` or `sqlite`."
                  },
                  "host": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Database server host or IP address."
                  },
                  "port": {
                    "type": "integer",
                    "description": "Database server port. Optional."
                  },
                  "appName": {
                    "type": "string",
                    "description": "Optional client/application name for the database connection."
                  },
                  "dialectOptions": {
                    "type": "object",
                    "description": "Optional Sequelize dialectOptions object.",
                    "additionalProperties": true
                  },
                  "logging": {
                    "description": "Optional Sequelize logging flag or function.",
                    "oneOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "string"
                      },
                      {
                        "type": "null"
                      },
                      {
                        "type": "object"
                      }
                    ]
                  }
                },
                "description": "Explicit Sequelize connection object. Do not nest `host` or `dialect` under `options`."
              },
              "schema": {
                "type": "string",
                "minLength": 1,
                "description": "Optional schema name to restrict table enumeration."
              }
            },
            "additionalProperties": false,
            "required": [
              "connection"
            ]
          }
        },
        "out": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "dialect": {
                "type": "string"
              },
              "ok": {
                "type": "boolean"
              },
              "schema": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "table_count": {
                "type": "integer"
              },
              "tables": {
                "type": "object",
                "additionalProperties": true,
                "description": "Map of table name to schema and column definitions."
              }
            },
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [],
        "body": {
          "selection": 0,
          "form": [],
          "json": {
            "code": {
              "connection": {
                "database": "<database_name>",
                "username": "<db_user>",
                "password": "<db_password>",
                "dialect": "mssql",
                "host": "<db_host_or_ip>",
                "dialectOptions": {
                  "options": {
                    "requestTimeout": 600000
                  }
                }
              }
            }
          },
          "text": {
            "value": ""
          },
          "urlencoded": [],
          "xml": {
            "code": ""
          }
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "password": "",
            "username": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "{\n  \"ok\": true,\n  \"dialect\": \"mssql\",\n  \"schema\": null,\n  \"table_count\": 22,\n  \"tables\": {\n    \"sysdiagrams\": {\n      \"schema\": \"dbo\",\n      \"columns\": {\n        \"name\": {\n          \"type\": \"NVARCHAR(128)\",\n          \"allowNull\": false,\n          \"defaultValue\": null,\n          \"primaryKey\": false,\n          \"autoIncrement\": false,\n          \"comment\": null\n        },\n        \"principal_id\": {\n          \"type\": \"INT\",\n          \"allowNull\": false,\n          \"defaultValue\": null,\n          \"primaryKey\": false,\n          \"autoIncrement\": false,\n          \"comment\": null\n        },\n        \"diagram_id\": {\n          \"type\": \"INT\",\n          \"allowNull\": false,\n          \"defaultValue\": null,\n          \"primaryKey\": true,\n          \"autoIncrement\": true,\n          \"comment\": null\n        },\n        \"version\": {\n          \"type\": \"INT\",\n          \"allowNull\": true,\n          \"defaultValue\": null,\n          \"primaryKey\": false,\n          \"autoIncrement\": false,\n          \"comment\": null\n     ",
          "sizeKBResponse": "62.56"
        }
      },
      "idendpoint": "18c23475-a6d1-4070-955b-685f3947fb62",
      "rowkey": 133,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 60,
      "resource": "/api/db/schema",
      "method": "POST",
      "handler": "JS",
      "access": 2,
      "title": "Describe All Database Tables",
      "description": "Receives explicit Sequelize connection parameters in the request body and returns the column structure of every table in the database.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "sequelize,schema,tables,structure,metadata,all",
      "code": "const rawPayload = request.body && request.body.json ? request.body.json : (request.body || {});\nconst payload = rawPayload && typeof rawPayload === \"object\" && rawPayload.code && typeof rawPayload.code === \"object\"\n  ? rawPayload.code\n  : rawPayload;\n\nconst connection = payload.connection;\nconst schema = payload.schema;\n\nconst requiredConnectionFields = [\"database\", \"username\", \"password\", \"dialect\", \"host\"];\n\nif (!payload || typeof payload !== \"object\" || Array.isArray(payload)) {\n  $_EXCEPTION_(\"Invalid request body for describe_all_tables.\", {\n    expected_body: {\n      connection: {\n        database: \"string\",\n        username: \"string\",\n        password: \"string\",\n        dialect: \"string\",\n        host: \"string\",\n        port: \"number (optional)\",\n        appName: \"string (optional)\",\n        dialectOptions: \"object (optional)\",\n        logging: \"boolean|function (optional)\"\n      },\n      schema: \"string (optional)\"\n    }\n  }, 400);\n}\n\nif (!connection || typeof connection !== \"object\" || Array.isArray(connection)) {\n  $_EXCEPTION_(\"Missing required 'connection' object in request body.\", {\n    expected_body: {\n      connection: {\n        database: \"string\",\n        username: \"string\",\n        password: \"string\",\n        dialect: \"string\",\n        host: \"string\",\n        port: \"number (optional)\"\n      },\n      schema: \"string (optional)\"\n    }\n  }, 400);\n}\n\nconst missingFields = requiredConnectionFields.filter((field) => {\n  const value = connection[field];\n  return typeof value !== \"string\" || value.trim().length === 0;\n});\n\nif (missingFields.length > 0) {\n  $_EXCEPTION_(\"Missing required connection fields for describe_all_tables.\", {\n    missing: missingFields.map((field) => `connection.${field}`),\n    expected_body: {\n      connection: {\n        database: \"string\",\n        username: \"string\",\n        password: \"string\",\n        dialect: \"string\",\n        host: \"string\",\n        port: \"number (optional)\",\n        appName: \"string (optional)\",\n        dialectOptions: \"object (optional)\",\n        logging: \"boolean|function (optional)\"\n      },\n      schema: \"string (optional)\"\n    }\n  }, 400);\n}\n\nif (schema !== undefined && (typeof schema !== \"string\" || schema.trim().length === 0)) {\n  $_EXCEPTION_(\"Invalid 'schema' value. When provided, it must be a non-empty string.\", {\n    received_type: typeof schema\n  }, 400);\n}\n\nconst sequelizeConfig = {\n  ...connection,\n  database: connection.database.trim(),\n  username: connection.username.trim(),\n  password: connection.password,\n  dialect: connection.dialect.trim(),\n  host: connection.host.trim()\n};\n\nconst db = new sequelize.Sequelize(\n  sequelizeConfig.database,\n  sequelizeConfig.username,\n  sequelizeConfig.password,\n  sequelizeConfig\n);\n\ntry {\n  await db.authenticate();\n  const queryInterface = db.getQueryInterface();\n  const normalizedSchema = typeof schema === \"string\" ? schema.trim() : null;\n\n  let tables;\n  if (typeof queryInterface.listTables === \"function\") {\n    tables = await queryInterface.listTables(normalizedSchema ? { schema: normalizedSchema } : {});\n  } else {\n    tables = await queryInterface.showAllTables();\n  }\n\n  const result = {};\n  for (const tableEntry of tables) {\n    const tableName = typeof tableEntry === \"string\"\n      ? tableEntry\n      : (tableEntry.tableName || tableEntry.table_name || String(tableEntry));\n    const tableSchema = typeof tableEntry === \"object\"\n      ? (tableEntry.schema || tableEntry.table_schema || normalizedSchema || null)\n      : (normalizedSchema || null);\n\n    try {\n      const tableRef = tableSchema ? { tableName, schema: tableSchema } : tableName;\n      const columns = await queryInterface.describeTable(tableRef);\n      result[tableName] = { schema: tableSchema, columns };\n    } catch (tableError) {\n      result[tableName] = {\n        schema: tableSchema,\n        error: tableError && tableError.message ? tableError.message : \"Failed to describe table\"\n      };\n    }\n  }\n\n  $_RETURN_DATA_ = {\n    ok: true,\n    dialect: db.getDialect(),\n    schema: normalizedSchema,\n    table_count: tables.length,\n    tables: result\n  };\n} catch (error) {\n  $_EXCEPTION_(\"Unable to retrieve database schema.\", {\n    message: error && error.message ? error.message : \"Unknown error\"\n  }, 500);\n} finally {\n  await db.close();\n}",
      "cache_time": 30,
      "createdAt": "2026-03-31T04:02:30.671Z",
      "updatedAt": "2026-03-31T04:35:04.846Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "app_endpoints_catalog",
        "title": "List endpoint catalog of an app",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns a lightweight catalog of endpoints for one application. Endpoint source code is excluded by default (set 'include_code: true' to include it). Supports filters: environment, method, handler, enabled. Use this for initial discovery or to list endpoints before calling 'read_endpoint_data' or 'endpoint_get_code'. Prefer this over 'app_endpoints' when you do not need the full endpoint payload.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A",
        "exampleRequest": {
          "idapp": "00000000-0000-0000-0000-000000000001",
          "environment": "prd",
          "include_code": false
        },
        "notes": [
          "Prefer this over `app_endpoints` for discovery workflows because it avoids large `code` payloads unless explicitly requested.",
          "Escalate to `app_endpoints` or `read_endpoint_data` only after you already know which endpoint needs detailed inspection."
        ]
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idapp": {
                "type": "string"
              },
              "environment": {
                "type": "string"
              },
              "method": {
                "type": "string"
              },
              "handler": {
                "type": "string"
              },
              "enabled": {
                "type": "boolean"
              },
              "include_code": {
                "type": "boolean"
              },
              "limit": {
                "type": "integer",
                "minimum": 1
              },
              "offset": {
                "type": "integer",
                "minimum": 0
              }
            },
            "additionalProperties": false,
            "required": [
              "idapp"
            ]
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "kfdmaw1hj",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idapp": "00000000-0000-0000-0000-000000000001",
              "include_code": false
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "c0c4f621-02ea-4ea6-a79a-a9b5d7c4a101",
      "rowkey": 797,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/app/endpoints/catalog",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Get Endpoint Catalog by App",
      "description": "Returns a lightweight catalog of endpoints for one application. Endpoint source code is excluded unless explicitly requested.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "endpoint,catalog,lightweight",
      "code": "fnEndpointCatalogByIdApp",
      "cache_time": 0,
      "createdAt": "2026-04-06T01:10:00.000Z",
      "updatedAt": "2026-04-06T01:10:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {}
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "get_app_list_filters",
        "title": "Get App with Endpoints by Filters",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns a SINGLE application with its nested endpoints and AppVars, filtered by any combination of app name, idapp, enabled status, and endpoint-level filters (environment, method, handler, resource, enabled). Use this when you need app data AND endpoint data in one call with precise filters. For simpler cases prefer: 'apps_catalog' (app names only), 'app_endpoints' (all endpoints for an app), or 'search_endpoints' (keyword search across endpoints).",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A",
        "exampleRequest": {
          "app": "my_app",
          "endpoint": {
            "environment": "prd",
            "enabled": true
          }
        },
        "exampleResponse": [
          {
            "idapp": "00000000-0000-0000-0000-000000000001",
            "app": "my_app",
            "enabled": true,
            "description": "Example application",
            "vrs": [
              {
                "name": "MY_CONFIG",
                "type": "string",
                "environment": "prd",
                "value": "example-value"
              }
            ],
            "endpoints": [
              {
                "idendpoint": "00000000-0000-0000-0000-000000000002",
                "resource": "/api/data",
                "method": "GET",
                "handler": "JS",
                "environment": "prd",
                "enabled": true
              }
            ]
          }
        ],
        "notes": [
          "When multiple filters are sent, backends commonly evaluate them as AND conditions.",
          "The response is usually app-centric: each matched application may include nested variables and matched endpoints.",
          "A practical workflow is: start with `apps_catalog` for broad discovery, then use this tool when you already know the filter dimensions you want to constrain."
        ]
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idapp": {
                "type": "string",
                "description": "Application identifier to match."
              },
              "app": {
                "type": "string",
                "description": "Application name filter. Values are normalized to lowercase."
              },
              "enabled": {
                "type": "boolean",
                "description": "Filter by application enabled state."
              },
              "endpoint": {
                "type": "object",
                "properties": {
                  "idendpoint": {
                    "type": "string",
                    "description": "Endpoint identifier filter."
                  },
                  "method": {
                    "type": "string",
                    "enum": [
                      "GET",
                      "POST",
                      "PUT",
                      "DELETE",
                      "PATCH"
                    ],
                    "description": "Endpoint HTTP method filter. Values are normalized to uppercase."
                  },
                  "handler": {
                    "type": "string",
                    "description": "Endpoint handler filter. Values are normalized to uppercase."
                  },
                  "environment": {
                    "type": "string",
                    "description": "Endpoint environment filter such as `dev`, `qa`, or `prd`."
                  },
                  "resource": {
                    "type": "string",
                    "description": "Endpoint resource path filter."
                  },
                  "enabled": {
                    "type": "boolean",
                    "description": "Filter by endpoint enabled state."
                  }
                },
                "additionalProperties": false
              }
            },
            "additionalProperties": false
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368",
            "_id": "tm8hswwdc",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "app": "my_app",
              "endpoint": {
                "environment": "prd",
                "enabled": true
              }
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "dpjmrz7sb",
            "type": 1
          }
        ],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "[{\"idapp\":\"00000000-0000-0000-0000-000000000001\",\"app\":\"my_app\",\"enabled\":true,\"description\":\"Example application\",\"vrs\":[{\"name\":\"MY_CONFIG\",\"type\":\"string\",\"environment\":\"prd\",\"value\":\"example-value\"}],\"endpoints\":[{\"idendpoint\":\"00000000-0000-0000-0000-000000000002\",\"resource\":\"/api/data\",\"method\":\"GET\",\"handler\":\"JS\",\"environment\":\"prd\",\"enabled\":true}]}]",
          "sizeKBResponse": "0.5"
        }
      },
      "idendpoint": "305b4de6-c6c4-42d5-b148-c5fc6ded51bb",
      "rowkey": 436,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/app/tree/by/filters",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 3,
      "title": "Get Full App Data with Endpoints",
      "description": "Returns applications and nested endpoint data using the provided filters.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetApplicationsTreeByFilters",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.726Z",
      "updatedAt": "2025-11-22T00:11:42.112Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "upsert_sql_bulk_i_endpoint_handler",
        "title": "UPSERT SQL_BULK_I Endpoint",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nCreates or updates SQL_BULK_I endpoints using a simplified payload. Send `table_name` plus optional `bulk_config`, and this wrapper maps them to endpoint_upsert with handler=SQL_BULK_I.",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May create, update, delete, restore, migrate, or invalidate application resources.",
        "safe_alternative": "Use a read-only catalog/search/status tool first to verify target ids and scope."
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idendpoint": {
                "type": "string",
                "format": "uuid",
                "description": "Endpoint identifier. Omit for INSERT; provide for UPDATE."
              },
              "enabled": {
                "type": "boolean",
                "description": "Whether the endpoint should be enabled."
              },
              "idapp": {
                "type": "string",
                "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
                "description": "Application identifier. Accepts RFC UUID and legacy IDs already present in existing datasets."
              },
              "environment": {
                "type": "string",
                "enum": [
                  "dev",
                  "qa",
                  "prd"
                ],
                "description": "Target environment."
              },
              "timeout": {
                "type": "integer",
                "minimum": 0,
                "description": "Execution timeout in seconds."
              },
              "resource": {
                "type": "string",
                "minLength": 1,
                "maxLength": 300,
                "description": "HTTP resource path."
              },
              "method": {
                "type": "string",
                "enum": [
                  "GET",
                  "POST",
                  "PUT",
                  "PATCH",
                  "DELETE",
                  "OPTIONS",
                  "HEAD"
                ],
                "description": "HTTP method for the endpoint."
              },
              "access": {
                "type": "integer",
                "enum": [
                  0,
                  1,
                  2,
                  3,
                  4
                ],
                "description": "Access level."
              },
              "title": {
                "type": "string",
                "maxLength": 200,
                "description": "Human-readable endpoint title."
              },
              "description": {
                "type": "string",
                "description": "Endpoint purpose description."
              },
              "price_by_request": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per request in millicents."
              },
              "price_kb_request": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per request KB in millicents."
              },
              "price_kb_response": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per response KB in millicents."
              },
              "keywords": {
                "type": "string",
                "description": "Search keywords."
              },
              "ctrl": {
                "$ref": "#/$defs/jsonValue"
              },
              "table_name": {
                "type": "string",
                "minLength": 1,
                "description": "Target table name stored in endpoint_upsert.code for SQL_BULK_I."
              },
              "bulk_config": {
                "$ref": "#/$defs/jsonValue",
                "description": "SQL_BULK_I config object (connection and options) merged into custom_data."
              },
              "custom_data": {
                "$ref": "#/$defs/jsonValue",
                "description": "Optional custom_data merged with bulk_config."
              },
              "cors": {
                "$ref": "#/$defs/jsonValue"
              },
              "cache_time": {
                "type": "integer",
                "minimum": 0,
                "description": "Cache time in seconds."
              },
              "mcp": {
                "$ref": "#/$defs/jsonValue"
              },
              "json_schema": {
                "$ref": "#/$defs/jsonValue"
              },
              "headers_test": {
                "$ref": "#/$defs/jsonValue"
              },
              "data_test": {
                "$ref": "#/$defs/jsonValue"
              }
            },
            "additionalProperties": false,
            "required": [
              "idapp",
              "environment",
              "timeout",
              "resource",
              "method",
              "access",
              "title",
              "description",
              "price_by_request",
              "price_kb_request",
              "price_kb_response",
              "keywords",
              "table_name",
              "cache_time"
            ],
            "$defs": {
              "jsonValue": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "array",
                    "items": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "string"
                  },
                  {
                    "type": "number"
                  },
                  {
                    "type": "integer"
                  },
                  {
                    "type": "boolean"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "sqlbulkwrapperquery01",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idapp": "<idapp-uuid>",
              "environment": "prd",
              "resource": "/db/bulk/users",
              "method": "POST",
              "access": 0,
              "title": "Bulk insert users",
              "description": "SQL_BULK_I endpoint example",
              "timeout": 30,
              "cache_time": 0,
              "price_by_request": 1,
              "price_kb_request": 1,
              "price_kb_response": 1,
              "keywords": "sql,bulk,endpoint",
              "table_name": "users"
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "3eaee5de-a17b-4be6-bfd9-f4fcd38fca10",
      "rowkey": 411,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint/sql_bulk_i",
      "method": "POST",
      "handler": "JS",
      "access": 3,
      "title": "UPSERT SQL_BULK_I Handler Endpoint",
      "description": "Create or modify in OpenFusion API a SQL_BULK_I handler endpoint.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "sql,bulk,endpoint",
      "code": "const uF = uFetchAutoEnv.auto('/api/system/api/endpoint/auto', true);\nconst body = request.body || {};\nconst auth = request?.headers?.authorization || request?.headers?.Authorization || '';\nconst custom_data = (body.custom_data && typeof body.custom_data === 'object') ? { ...body.custom_data } : {};\n\nif (body.bulk_config && typeof body.bulk_config === 'object') {\n  Object.assign(custom_data, body.bulk_config);\n}\n\nconst data = {\n  ...body,\n  handler: 'SQL_BULK_I',\n  code: body.table_name ?? body.code ?? '',\n  custom_data,\n};\n\ndelete data.table_name;\ndelete data.bulk_config;\n\nconst req1 = await uF.post({ data, headers: auth ? { authorization: auth } : undefined });\nconst resp = await req1.json();\n$_RETURN_DATA_ = resp;",
      "cache_time": 0,
      "createdAt": "2026-05-19T12:00:00.000Z",
      "updatedAt": "2026-05-19T12:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3,
          "level": 0
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "trace_summary",
        "title": "Trace Summary",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns a compact diagnostic summary for one trace_id: request totals, status distribution, first problematic request, and slowest request. Ideal as the first tool call before deeper analysis.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "trace_id": {
                "type": "string",
                "minLength": 1,
                "description": "Trace identifier to summarize."
              },
              "slow_threshold_ms": {
                "type": "number",
                "minimum": 0,
                "default": 500,
                "description": "Optional threshold used to count slow requests in the summary."
              }
            },
            "required": [
              "trace_id"
            ]
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {
              "trace_id": {
                "type": "string"
              },
              "total_requests": {
                "type": "integer"
              },
              "errors_total": {
                "type": "integer"
              },
              "slow_requests_total": {
                "type": "integer"
              },
              "unique_endpoints": {
                "type": "integer"
              }
            },
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": true,
            "key": "trace_id",
            "value": "trace-id-example",
            "internal_hash_row": "",
            "type": 1,
            "_id": "trce004"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "f6a1a9d1-3d74-4c7e-95f7-5b7f0f4d5103",
      "rowkey": 787,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/system/log/trace/summary",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Trace Summary",
      "description": "Returns a compact trace_id diagnostic summary with counts, first problematic hop and slowest hop.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "trace_id,summary,diagnostics,errors,slow",
      "code": "fnGetTraceSummary",
      "cache_time": 0,
      "createdAt": "2026-07-02T00:00:00.000Z",
      "updatedAt": "2026-07-02T00:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "read_endpoint_data",
        "title": "Read Endpoint Details",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns detailed data for a specific endpoint by `idendpoint`. Use the optional 'attributes' array to request only specific fields (e.g. ['idendpoint', 'json_schema', 'code']) and reduce payload size. If 'attributes' is omitted, all fields are returned.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A",
        "exampleRequest": {
          "idendpoint": "00000000-0000-0000-0000-000000000002"
        },
        "notes": [
          "Send the endpoint identifier in `idendpoint` exactly as defined in the input schema.",
          "Use this response as a read-before-write step prior to endpoint_upsert changes."
        ]
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idendpoint": {
                "type": "string",
                "description": "The unique identifier of the endpoint."
              },
              "attributes": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "description": "Optional: array of fields to return (e.g. ['resource', 'method', 'handler', 'code', 'json_schema'])."
              }
            },
            "additionalProperties": false,
            "required": [
              "idendpoint"
            ]
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368",
            "_id": "fi2s5e1bn",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idendpoint": "00000000-0000-0000-0000-000000000002"
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368",
            "_id": "g8d18g0mz",
            "type": 1
          }
        ],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "410321a2-3930-4545-963d-b47f90fdbf02",
      "rowkey": 168,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "GET Endpoint Data",
      "description": "Returns detailed data for a specific endpoint by `idendpoint`, including configuration and runtime-relevant metadata.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "endpoint",
      "code": "fnEndpointGetById",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.726Z",
      "updatedAt": "2025-11-22T00:11:42.112Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "endpoint_upsert",
        "title": "Endpoint UPSERT",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nCreates or updates an endpoint. For updates, retrieve the current endpoint state using `read_endpoint_data` first. Prefer handler-specific wrappers (such as `upsert_js_endpoint_handler`) over this generic endpoint.",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May create, update, delete, restore, migrate, or invalidate application resources.",
        "safe_alternative": "Use a read-only catalog/search/status tool first to verify target ids and scope.",
        "outputSchema": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idendpoint": {
                "type": "string",
                "format": "uuid",
                "description": "Endpoint identifier. Omit for INSERT; provide a valid UUID for UPDATE."
              },
              "enabled": {
                "type": "boolean",
                "default": true,
                "description": "Whether the endpoint is enabled."
              },
              "idapp": {
                "type": "string",
                "format": "uuid",
                "description": "UUID of the application that owns the endpoint."
              },
              "environment": {
                "type": "string",
                "enum": [
                  "dev",
                  "qa",
                  "prd"
                ],
                "default": "dev",
                "description": "Target environment where the endpoint will be available."
              },
              "timeout": {
                "type": "integer",
                "minimum": 0,
                "default": 30,
                "description": "Maximum execution time in seconds."
              },
              "resource": {
                "type": "string",
                "minLength": 1,
                "maxLength": 300,
                "description": "HTTP resource path, for example `/users/search`."
              },
              "method": {
                "type": "string",
                "enum": [
                  "GET",
                  "POST",
                  "PUT",
                  "PATCH",
                  "DELETE",
                  "OPTIONS",
                  "HEAD"
                ],
                "description": "HTTP method exposed by the endpoint."
              },
              "handler": {
                "type": "string",
                "enum": [
                  "FUNCTION",
                  "JS",
                  "SQL",
                  "SQL_BULK_I",
                  "FETCH",
                  "SOAP",
                  "HANA",
                  "MONGODB",
                  "TEXT",
                  "MCP",
                  "TELEGRAM_BOT",
                  "NA"
                ],
                "minLength": 1,
                "maxLength": 15,
                "description": "Endpoint handler type. The selected handler defines the required shape of `code` and related fields."
              },
              "access": {
                "type": "integer",
                "enum": [
                  0,
                  1,
                  2,
                  3,
                  4
                ],
                "default": 2,
                "description": "Access level: 0=Public (no auth), 1=Basic Auth, 2=Bearer Token (recommended default), 3=Basic+Token, 4=Local only."
              },
              "title": {
                "type": "string",
                "maxLength": 200,
                "default": "",
                "description": "Short human-readable title for the endpoint."
              },
              "description": {
                "type": "string",
                "default": "",
                "description": "Detailed purpose or behavior description."
              },
              "price_by_request": {
                "type": "integer",
                "minimum": 0,
                "default": 1,
                "description": "Cost per request in millicents."
              },
              "price_kb_request": {
                "type": "integer",
                "minimum": 0,
                "default": 1,
                "description": "Cost per request KB in millicents."
              },
              "price_kb_response": {
                "type": "integer",
                "minimum": 0,
                "default": 1,
                "description": "Cost per response KB in millicents."
              },
              "keywords": {
                "type": "string",
                "default": "",
                "description": "Keywords used for search or classification."
              },
              "ctrl": {
                "$ref": "#/$defs/jsonValue",
                "description": "Additional endpoint controls such as user restrictions or logging settings."
              },
              "code": {
                "type": "string",
                "default": "",
                "description": "Handler payload. Convention depends on `handler`: JS => server-side JavaScript source and it must assign `$_RETURN_DATA_` instead of using `return`; FUNCTION => internal function name such as `fnMyFunction`; FETCH => target URL string; TEXT => raw text content while MIME metadata lives in `custom_data.mimeType`. This handler can be used to expose text with a mimetype, but also for other types of files like a PDF converted to base64 or other files up to 1Mega. Optionally, add `custom_data.fileName` if it requires to be downloadable; SQL => SQL query string while connection settings live in `custom_data`; SQL_BULK_I/SOAP/HANA/MONGODB/MCP => handler-specific configuration payload; TELEGRAM_BOT => JavaScript source that configures the injected grammY bot instance available as `$BOT`, while the Telegram token is normally provided in `custom_data.token`. Do not instantiate the bot manually and do not call `$BOT.start()` because the runtime starts it automatically. You can also pass an AppVar placeholder string such as `\"$_MY_VAR\"`; it will be resolved at runtime to the effective application variable value."
              },
              "cors": {
                "$ref": "#/$defs/jsonValue",
                "description": "CORS configuration object."
              },
              "cache_time": {
                "type": "integer",
                "minimum": 0,
                "default": 0,
                "description": "Cache lifetime in seconds. Zero disables caching."
              },
              "mcp": {
                "$ref": "#/$defs/jsonValue",
                "description": "MCP exposure configuration."
              },
              "json_schema": {
                "$ref": "#/$defs/jsonValue",
                "description": "JSON Schema associated with the endpoint request/response."
              },
              "custom_data": {
                "$ref": "#/$defs/jsonValue",
                "description": "Handler-specific auxiliary data. Common examples: SQL connection settings, TEXT `mimeType` and optional `fileName`, or TELEGRAM_BOT `token`. For handlers with runtime-specific payloads, confirm the expected `custom_data` shape with `handler_documentation` before saving. You can pass AppVar placeholder strings such as `\"$_MY_VAR\"` in fields that accept string values; placeholders are resolved at runtime."
              },
              "headers_test": {
                "$ref": "#/$defs/jsonValue",
                "description": "Saved test headers for the endpoint editor."
              },
              "data_test": {
                "$ref": "#/$defs/jsonValue",
                "description": "Saved test payload used by the endpoint editor."
              }
            },
            "additionalProperties": false,
            "title": "Endpoint",
            "required": [
              "idapp",
              "environment",
              "timeout",
              "resource",
              "method",
              "handler",
              "access",
              "title",
              "description",
              "price_by_request",
              "price_kb_request",
              "price_kb_response",
              "keywords",
              "code",
              "cache_time"
            ],
            "allOf": [
              {
                "if": {
                  "properties": {
                    "handler": {
                      "const": "FUNCTION"
                    }
                  },
                  "required": [
                    "handler"
                  ]
                },
                "then": {
                  "properties": {
                    "code": {
                      "type": "string",
                      "minLength": 1
                    }
                  },
                  "required": [
                    "code"
                  ]
                }
              }
            ],
            "$defs": {
              "jsonValue": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "array",
                    "items": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "string"
                  },
                  {
                    "type": "number"
                  },
                  {
                    "type": "integer"
                  },
                  {
                    "type": "boolean"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368",
            "_id": "d8xh0y1o4",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idapp": "<idapp-uuid>",
              "environment": "prd",
              "resource": "/my-endpoint",
              "method": "GET",
              "handler": "JS",
              "access": 0,
              "title": "My Endpoint",
              "description": "What this endpoint does",
              "timeout": 30,
              "cache_time": 0,
              "code": "$_RETURN_DATA_ = { result: 'ok', ts: new Date().toISOString() };"
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368",
            "_id": "x3xaw5ltr",
            "type": 1
          }
        ],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "410321a2-3930-4545-963d-b47f90fdbf01",
      "rowkey": 106,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Endpoint UPSERT",
      "description": "Creates or updates the parameters of an endpoint according to the selected handler.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnEndpointUpsert",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.726Z",
      "updatedAt": "2025-11-22T00:11:42.112Z"
    },
    {
      "ctrl": {
        "users": [],
        "log": {}
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "list_function_names",
        "title": "List Function Names",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns function names available for one application and environment. Required query fields: `environment` and `appName`.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "title": "FunctionNamesRequest",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "environment",
              "appName"
            ],
            "properties": {
              "environment": {
                "type": "string",
                "enum": [
                  "dev",
                  "qa",
                  "prd"
                ],
                "description": "Environment where functions will be resolved."
              },
              "appName": {
                "type": "string",
                "minLength": 1,
                "maxLength": 100,
                "description": "Application name whose registered functions should be listed."
              }
            }
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": true,
            "key": "environment",
            "value": "prd",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          },
          {
            "enabled": true,
            "key": "appName",
            "value": "system",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": {}
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "auth": {
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          },
          "selection": 0
        }
      },
      "idendpoint": "13f94d7d-6612-4c30-8202-286cbbe3da3e",
      "rowkey": 534,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/function_names",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "Returns function names available for one application and environment.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnFunctionNames",
      "cache_time": 999,
      "createdAt": "2025-11-21T22:04:52.725Z",
      "updatedAt": "2025-11-22T00:11:42.108Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "app_vars_catalog",
        "title": "List Application Variable Catalog (Lightweight)",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns a lightweight list of AppVar names, types and environments for one app — variable values are excluded unless 'include_values: true' is set. Use this to discover which variables exist before reading or updating them. For the full variable data including values use 'app_vars'. To resolve the effective runtime value of a specific variable use 'appvars_effective_resolve'.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A",
        "exampleRequest": {
          "idapp": "00000000-0000-0000-0000-000000000001",
          "environment": "prd",
          "include_values": false
        },
        "notes": [
          "Prefer this over `app_vars` for discovery workflows because it avoids returning variable values unless explicitly requested."
        ]
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idapp": {
                "type": "string"
              },
              "environment": {
                "type": "string"
              },
              "include_values": {
                "type": "boolean"
              },
              "limit": {
                "type": "integer",
                "minimum": 1
              },
              "offset": {
                "type": "integer",
                "minimum": 0
              }
            },
            "additionalProperties": false,
            "required": [
              "idapp"
            ]
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "c7z1y4l0n",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idapp": "00000000-0000-0000-0000-000000000001",
              "include_values": false
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "2f8d3d77-d6fa-4de7-8623-4e1cf5e5a103",
      "rowkey": 735,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/app/vars/catalog",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Get Application Variable Catalog",
      "description": "Returns a lightweight catalog of application variables for one app. Values are excluded unless explicitly requested.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "app,var,catalog,lightweight",
      "code": "fnGetAppVarsCatalogByIdApp",
      "cache_time": 0,
      "createdAt": "2026-04-06T01:25:00.000Z",
      "updatedAt": "2026-04-06T01:25:00.000Z"
    },
    {
      "ctrl": {
        "admin": true
      },
      "cors": {},
      "mcp": {},
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "ed1c2a5c-69dd-44bb-bbef-fd90b66d6f5f",
      "rowkey": 341,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/apiclient/changepassword",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "Update API Client password",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnUpdateAPIClientPassword",
      "cache_time": 0,
      "createdAt": "2025-11-30T04:19:03.270Z",
      "updatedAt": "2025-12-03T16:27:48.432Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "endpoint_change_history",
        "title": "Endpoint Change History",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns the ordered change history (backup list) of an endpoint. Use 'lightweight: true' (recommended for agents) to get only idbackup, hash, and createdAt without the heavy full-snapshot 'data' field. Use 'lightweight: false' to retrieve the full snapshot data inline. To rollback to a specific version, copy the 'idbackup' value and call 'endpoint_restore_version'.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A",
        "exampleRequest": {
          "idendpoint": "00000000-0000-0000-0000-000000000002"
        },
        "notes": [
          "Entries are typically ordered by newest-first unless the backend configuration defines otherwise.",
          "History rows are snapshots for inspection; restoring a version still requires an explicit write operation."
        ]
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idendpoint": {
                "type": "string",
                "minLength": 1,
                "description": "Endpoint identifier whose backup history should be returned.",
                "example": "cfdf4ac3-bd98-463e-ae57-d331193ed416"
              },
              "lightweight": {
                "type": "boolean",
                "default": true,
                "description": "If true (recommended), returns only idbackup, hash and createdAt without the heavy full-snapshot data field."
              }
            },
            "required": [
              "idendpoint"
            ],
            "additionalProperties": false
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": true,
            "key": "idendpoint",
            "value": "cfdf4ac3-bd98-463e-ae57-d331193ed416",
            "internal_hash_row": "",
            "type": 1,
            "_id": "revv5ds96"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idendpoint": "00000000-0000-0000-0000-000000000002"
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "",
            "type": 1,
            "_id": "0pq1ds56t"
          }
        ],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "cfdf4ac3-bd98-463e-ae57-d331193ed416",
      "rowkey": 689,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint/backup",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Endpoint Change History",
      "description": "Returns the ordered change history of an endpoint, useful for audits and rollback analysis.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetEndpointBackupByIdEndpoint",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.726Z",
      "updatedAt": "2025-11-22T00:11:42.112Z"
    },
    {
      "ctrl": {},
      "cors": {},
      "mcp": {},
      "json_schema": {
        "in": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": {}
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "auth": {
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          },
          "selection": 0
        }
      },
      "idendpoint": "a0130d77-b779-4dea-a87f-6841520ffade",
      "rowkey": 939,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/websocket/server",
      "method": "WS",
      "handler": "NA",
      "access": 0,
      "title": "",
      "description": "Send events from server",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.726Z",
      "updatedAt": "2025-11-22T00:11:42.111Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "available_functions_modules",
        "title": "List Available JS Functions and Modules",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns the list of built-in functions and helper modules available in scope for endpoints using the JS handler. Call this before creating or editing a JS endpoint to discover what functions (e.g. uFetch, uFetchAutoEnv, askIAWithProviderMCP) are available without importing them.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A",
        "exampleRequest": {},
        "exampleResponse": {
          "$_RETURN_DATA_": {
            "description": "Assign endpoint output payload in JS handlers."
          },
          "$_EXCEPTION_": {
            "description": "Raise controlled errors with status and details from JS handlers."
          }
        },
        "notes": [
          "Useful to validate allowed imports/helpers before publishing JS endpoints.",
          "Expect metadata and examples rather than a rigid contract: helper globals, module names, and short usage notes may all appear in the response.",
          "For deeper JS runtime rules and examples, also consult the JS handler documentation via `handler_documentation` with `handler=JS`."
        ]
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368",
            "_id": "6ufqp2ww4",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "{\n  \"$_CUSTOM_HEADERS_\": {\n    \"fn\": {},\n    \"description\": \"Custom headers to send in the reply.\",\n    \"web\": \"https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map\",\n    \"return\": \"Map object with custom headers\",\n    \"example\": \"\\n$_CUSTOM_HEADERS_.set(\\\"Content-Type\\\", \\\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\\\");\\n$_CUSTOM_HEADERS_.set(\\n  \\\"Content-Disposition\\\",\\n  'attachment; filename=\\\"file.xlsx\\\"',\\n);\\n      \"\n  },\n  \"$_EXCEPTION_\": {\n    \"description\": \"Interrupts the program flow and throws an exception with a specific message and status code.\",\n    \"web\": \"https://github.com/rdsslab/libOpenFusionAPI\",\n    \"params\": [\n      {\n        \"name\": \"message\",\n        \"description\": \"The error message to display.\",\n        \"required\": true,\n        \"type\": \"string\",\n        \"default\": \"\"\n      },\n      {\n        \"name\": \"data\",\n        \"description\": \"Additional context data for the error.\",\n        \"required\": false,\n  ",
          "sizeKBResponse": "16.79"
        }
      },
      "idendpoint": "3d3de358-681d-4b61-98dc-c1663db0c02c",
      "rowkey": 293,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/system/handler/js/functions",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "List JS Functions",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "js,functions,handler",
      "code": "fnListFnVarsHandlerJS",
      "cache_time": 60,
      "createdAt": "2025-11-21T22:04:52.726Z",
      "updatedAt": "2025-11-22T00:11:42.113Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "upsert_sql_endpoint_handler",
        "title": "UPSERT SQL Endpoint",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nCreate or modify in OpenFusion API an endpoint that executes SQL statements (CRUD) on SQL databases supported by Sequelize. Supports HTTP methods GET, POST, PUT, PATCH, DELETE, OPTIONS, and HEAD for the created endpoint. Runtime note: repeated query-string keys follow Fastify semantics and are preserved as arrays.",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May create, update, delete, restore, migrate, or invalidate application resources.",
        "safe_alternative": "Use a read-only catalog/search/status tool first to verify target ids and scope."
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idendpoint": {
                "type": "string",
                "format": "uuid"
              },
              "enabled": {
                "type": "boolean"
              },
              "idapp": {
                "type": "string",
                "format": "uuid"
              },
              "environment": {
                "type": "string",
                "enum": [
                  "dev",
                  "qa",
                  "prd"
                ]
              },
              "timeout": {
                "type": "integer",
                "minimum": 0
              },
              "resource": {
                "type": "string",
                "minLength": 1,
                "maxLength": 300
              },
              "method": {
                "type": "string",
                "enum": [
                  "GET",
                  "POST",
                  "PUT",
                  "PATCH",
                  "DELETE",
                  "OPTIONS",
                  "HEAD"
                ],
                "default": "POST"
              },
              "access": {
                "type": "integer",
                "enum": [
                  0,
                  1,
                  2,
                  3,
                  4
                ]
              },
              "title": {
                "type": "string",
                "maxLength": 200
              },
              "description": {
                "type": "string"
              },
              "price_by_request": {
                "type": "integer",
                "minimum": 0
              },
              "price_kb_request": {
                "type": "integer",
                "minimum": 0
              },
              "price_kb_response": {
                "type": "integer",
                "minimum": 0
              },
              "keywords": {
                "type": "string"
              },
              "ctrl": {
                "$ref": "#/$defs/jsonValue"
              },
              "code": {
                "type": "string"
              },
              "cors": {
                "$ref": "#/$defs/jsonValue"
              },
              "cache_time": {
                "type": "integer",
                "minimum": 0
              },
              "mcp": {
                "$ref": "#/$defs/jsonValue"
              },
              "json_schema": {
                "$ref": "#/$defs/jsonValue"
              },
              "custom_data": {
                "$ref": "#/$defs/jsonValue"
              },
              "headers_test": {
                "$ref": "#/$defs/jsonValue"
              },
              "data_test": {
                "$ref": "#/$defs/jsonValue"
              }
            },
            "additionalProperties": false,
            "required": [
              "idapp",
              "environment",
              "timeout",
              "resource",
              "access",
              "title",
              "description",
              "price_by_request",
              "price_kb_request",
              "price_kb_response",
              "keywords",
              "code",
              "cache_time"
            ],
            "$defs": {
              "jsonValue": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "array",
                    "items": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "string"
                  },
                  {
                    "type": "number"
                  },
                  {
                    "type": "integer"
                  },
                  {
                    "type": "boolean"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "k6wkj9wea",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "8bb911ac-374c-41c9-b93f-21d037abf330",
      "rowkey": 870,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint/sql",
      "method": "POST",
      "handler": "JS",
      "access": 3,
      "title": "UPSERT SQL Handler Endpoint",
      "description": "Create or modify in OpenFusion API an endpoint that executes SQL statements (CRUD) on SQL databases supported by Sequelize. Supports HTTP methods GET, POST, PUT, PATCH, DELETE, OPTIONS, and HEAD for the created endpoint.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "sql,endpoint",
      "code": "const uF = uFetchAutoEnv.auto('/api/system/api/endpoint/auto', true);\nconst auth = request?.headers?.authorization || request?.headers?.Authorization || '';\nconst body = request.body || {};\nconst method = String(body.method || 'POST').toUpperCase();\nconst data = { ...body, handler: 'SQL', method };\n\nconst req1  = await uF.post({ data, headers: auth ? { authorization: auth } : undefined });\nconst resp = await req1.json();\n$_RETURN_DATA_ = resp;",
      "cache_time": 0,
      "createdAt": "2026-03-17T16:03:50.532Z",
      "updatedAt": "2026-03-17T16:03:50.532Z"
    },
    {
      "ctrl": {},
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "system_interval_tasks_upsert_prd",
        "title": "Upsert System Interval Task (PRD)",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nCreates or updates an interval task in the system application on prd environment.",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May create, update, or modify interval task scheduling state.",
        "safe_alternative": "Use read-only tools to inspect current task state before updating."
      },
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": {}
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "auth": {
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          },
          "selection": 0
        }
      },
      "idendpoint": "34987a43-63e4-4926-824b-5254155b5c80",
      "rowkey": 925,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/interval_tasks/upsert",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Upsert interval task",
      "description": "Create or update an interval task in system/prd.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "interval_tasks,upsert,system,prd",
      "code": "fnUpsertIntervalTask",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.724Z",
      "updatedAt": "2026-07-13T17:26:20.224Z"
    },
    {
      "ctrl": {
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {},
      "json_schema": {
        "in": {
          "enabled": false,
          "schema": {}
        },
        "out": {}
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": {}
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "auth": {
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          },
          "selection": 0
        }
      },
      "idendpoint": "b9bc8e9a-54ab-4496-bf65-bbe374d03d84",
      "rowkey": 516,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/server/version",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 0,
      "title": "",
      "description": "Get version API server",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetServerVersion",
      "cache_time": 9999,
      "createdAt": "2025-11-21T22:04:52.726Z",
      "updatedAt": "2025-11-22T00:11:42.112Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": false,
        "name": "",
        "title": "",
        "description": ""
      },
      "json_schema": {
        "in": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": {}
        },
        "headers": {},
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "51316993-907c-4fd0-859f-7d2a0bc90dd3",
      "rowkey": 320,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/bot/all",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 0,
      "title": "Get all Bots",
      "description": "Returns all registered bots for the current environment.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "bot",
      "code": "fnGetAllBots",
      "cache_time": 0,
      "createdAt": "2026-02-01T08:21:49.670Z",
      "updatedAt": "2026-02-01T08:21:49.670Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "app_endpoints",
        "title": "List all endpoints of an app",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns the COMPLETE list of all endpoints for one application identified by 'idapp', across all environments (dev, qa, prd) and regardless of enabled/disabled status. Use this tool when you need the full inventory of endpoints for an app. To search for a specific endpoint by keyword, use 'search_endpoints' instead. To discover the idapp use 'apps_list' or 'apps_catalog'. Use the optional 'attributes' array to request only specific fields and reduce the payload size.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A",
        "exampleRequest": {
          "idapp": "00000000-0000-0000-0000-000000000001"
        },
        "notes": [
          "Use this when you need more than discovery, for example when comparing endpoint settings across one app or reviewing multiple endpoint records together.",
          "Prefer `app_endpoints_catalog` for initial discovery because that catalog is lighter and excludes larger payload fields by default."
        ]
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idapp": {
                "type": "string",
                "description": "The unique identifier of the application."
              },
              "attributes": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "description": "Optional: array of fields to return for each endpoint (e.g. ['idendpoint', 'resource', 'method', 'handler', 'enabled'])."
              }
            },
            "additionalProperties": false,
            "required": [
              "idapp"
            ]
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368",
            "_id": "3w5spzz6r",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idapp": "00000000-0000-0000-0000-000000000001"
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": []
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368",
            "_id": "xxam93qr0",
            "type": 1
          }
        ],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "410321a2-3930-4545-963d-b47f90fdbff1",
      "rowkey": 948,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/app/endpoints",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Get Endpoint by App",
      "description": "Returns all endpoints associated with one application identified by `idapp`.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "endpoint",
      "code": "fnEndpointGetByIdApp",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.726Z",
      "updatedAt": "2025-11-22T00:11:42.112Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "cache_invalidate",
        "title": "Invalidate Endpoint Cache",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nInvalidates endpoint cache entries by `idapp` (optionally `environment`) or by a specific `idendpoint`. Use this when endpoint definitions or app variables changed and you need fresh data on next request.",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May create, update, delete, restore, migrate, or invalidate application resources.",
        "safe_alternative": "Use a read-only catalog/search/status tool first to verify target ids and scope."
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idapp": {
                "type": "string",
                "description": "Application identifier."
              },
              "environment": {
                "type": "string",
                "description": "Optional environment filter (`dev`, `qa`, `prd`)."
              },
              "idendpoint": {
                "type": "string",
                "description": "Optional endpoint identifier to remove one endpoint directly."
              },
              "reason": {
                "type": "string",
                "description": "Optional audit note describing why invalidation was requested."
              }
            },
            "additionalProperties": false
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idapp": "00000000-0000-0000-0000-000000000001",
              "environment": "prd"
            }
          }
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "9e2d2571-6b39-4741-97df-75456903f7fb",
      "rowkey": 995,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/cache/invalidate",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Invalidate endpoint cache",
      "description": "Invalidates endpoint cache entries by `idapp` (optionally `environment`) or by a specific `idendpoint`.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "cache,invalidate,idapp,idendpoint",
      "code": "fnInvalidateEndpointCache",
      "cache_time": 0,
      "createdAt": "2026-05-11T00:00:00.000Z",
      "updatedAt": "2026-05-11T00:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "upsert_hana_endpoint_handler",
        "title": "UPSERT HANA Endpoint",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nCreates or updates HANA endpoints using a simplified payload. Send `hana_code` and optional `hana_config`, and this wrapper maps them to endpoint_upsert with handler=HANA. Runtime note: repeated query-string keys follow Fastify semantics and are preserved as arrays.",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May create, update, delete, restore, migrate, or invalidate application resources.",
        "safe_alternative": "Use a read-only catalog/search/status tool first to verify target ids and scope."
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idendpoint": {
                "type": "string",
                "format": "uuid",
                "description": "Endpoint identifier. Omit for INSERT; provide for UPDATE."
              },
              "enabled": {
                "type": "boolean",
                "description": "Whether the endpoint should be enabled."
              },
              "idapp": {
                "type": "string",
                "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
                "description": "Application identifier. Accepts RFC UUID and legacy IDs already present in existing datasets."
              },
              "environment": {
                "type": "string",
                "enum": [
                  "dev",
                  "qa",
                  "prd"
                ],
                "description": "Target environment."
              },
              "timeout": {
                "type": "integer",
                "minimum": 0,
                "description": "Execution timeout in seconds."
              },
              "resource": {
                "type": "string",
                "minLength": 1,
                "maxLength": 300,
                "description": "HTTP resource path."
              },
              "method": {
                "type": "string",
                "enum": [
                  "GET",
                  "POST",
                  "PUT",
                  "PATCH",
                  "DELETE",
                  "OPTIONS",
                  "HEAD"
                ],
                "description": "HTTP method for the endpoint."
              },
              "access": {
                "type": "integer",
                "enum": [
                  0,
                  1,
                  2,
                  3,
                  4
                ],
                "description": "Access level."
              },
              "title": {
                "type": "string",
                "maxLength": 200,
                "description": "Human-readable endpoint title."
              },
              "description": {
                "type": "string",
                "description": "Endpoint purpose description."
              },
              "price_by_request": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per request in millicents."
              },
              "price_kb_request": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per request KB in millicents."
              },
              "price_kb_response": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per response KB in millicents."
              },
              "keywords": {
                "type": "string",
                "description": "Search keywords."
              },
              "ctrl": {
                "$ref": "#/$defs/jsonValue"
              },
              "hana_code": {
                "type": "string",
                "description": "SQL or handler-specific code stored in endpoint_upsert.code for HANA handler."
              },
              "hana_config": {
                "$ref": "#/$defs/jsonValue",
                "description": "Optional HANA connection/config object merged into custom_data."
              },
              "custom_data": {
                "$ref": "#/$defs/jsonValue",
                "description": "Optional custom_data merged with hana_config."
              },
              "cors": {
                "$ref": "#/$defs/jsonValue"
              },
              "cache_time": {
                "type": "integer",
                "minimum": 0,
                "description": "Cache time in seconds."
              },
              "mcp": {
                "$ref": "#/$defs/jsonValue"
              },
              "json_schema": {
                "$ref": "#/$defs/jsonValue"
              },
              "headers_test": {
                "$ref": "#/$defs/jsonValue"
              },
              "data_test": {
                "$ref": "#/$defs/jsonValue"
              }
            },
            "additionalProperties": false,
            "required": [
              "idapp",
              "environment",
              "timeout",
              "resource",
              "method",
              "access",
              "title",
              "description",
              "price_by_request",
              "price_kb_request",
              "price_kb_response",
              "keywords",
              "hana_code",
              "cache_time"
            ],
            "$defs": {
              "jsonValue": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "array",
                    "items": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "string"
                  },
                  {
                    "type": "number"
                  },
                  {
                    "type": "integer"
                  },
                  {
                    "type": "boolean"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "hanawrapperquery01",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idapp": "<idapp-uuid>",
              "environment": "prd",
              "resource": "/db/hana/query",
              "method": "POST",
              "access": 0,
              "title": "HANA query",
              "description": "HANA endpoint example",
              "timeout": 30,
              "cache_time": 0,
              "price_by_request": 1,
              "price_kb_request": 1,
              "price_kb_response": 1,
              "keywords": "hana,endpoint",
              "hana_code": "SELECT * FROM USERS WHERE USER_ID = :id"
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "f27ef32e-3f6a-4dd4-b37b-5dca59a0b127",
      "rowkey": 915,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint/hana",
      "method": "POST",
      "handler": "JS",
      "access": 3,
      "title": "UPSERT HANA Handler Endpoint",
      "description": "Create or modify in OpenFusion API a HANA handler endpoint.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "hana,endpoint",
      "code": "const uF = uFetchAutoEnv.auto('/api/system/api/endpoint/auto', true);\nconst body = request.body || {};\nconst auth = request?.headers?.authorization || request?.headers?.Authorization || '';\nconst custom_data = (body.custom_data && typeof body.custom_data === 'object') ? { ...body.custom_data } : {};\n\nif (body.hana_config && typeof body.hana_config === 'object') {\n  Object.assign(custom_data, body.hana_config);\n}\n\nconst data = {\n  ...body,\n  handler: 'HANA',\n  code: body.hana_code ?? body.code ?? '',\n  custom_data,\n};\n\ndelete data.hana_code;\ndelete data.hana_config;\n\nconst req1 = await uF.post({ data, headers: auth ? { authorization: auth } : undefined });\nconst resp = await req1.json();\n$_RETURN_DATA_ = resp;",
      "cache_time": 0,
      "createdAt": "2026-05-19T12:00:00.000Z",
      "updatedAt": "2026-05-19T12:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "endpoint_migrate",
        "title": "Migrate Endpoint to Another Environment",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nCopies one or more endpoints from their current environment to a target environment (dev, qa, or prd). The original endpoint is NOT deleted — this is a copy/promote operation, not a move. Each item in the array requires 'idendpoint' (UUID of the source endpoint) and 'target_env' (destination environment). Possible per-item outcomes: 'success' (migrated and new_idendpoint is returned), 'ignored' (source is already in target_env), 'already exists' (an endpoint with same app+resource+method already exists in target_env — treated as success, no duplicate is created), or 'error'. To obtain idendpoint values use 'app_endpoints' (full list) or 'search_endpoints' (by keyword). To verify the migration use 'app_endpoints' filtering by the target environment after calling this tool.",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May create, update, delete, restore, migrate, or invalidate application resources.",
        "safe_alternative": "Use a read-only catalog/search/status tool first to verify target ids and scope."
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "title": "EndpointMigrateRequest",
            "type": "array",
            "minItems": 1,
            "description": "Array of migration items. Each item specifies one endpoint to copy to a target environment.",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "idendpoint",
                "target_env"
              ],
              "properties": {
                "idendpoint": {
                  "type": "string",
                  "format": "uuid",
                  "description": "UUID of the source endpoint to migrate. Obtain from 'app_endpoints' or 'search_endpoints'."
                },
                "target_env": {
                  "type": "string",
                  "enum": [
                    "dev",
                    "qa",
                    "prd"
                  ],
                  "description": "Destination environment. Must be different from the source endpoint's current environment."
                }
              }
            }
          }
        },
        "out": {
          "enabled": true,
          "schema": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "idendpoint": {
                  "type": "string",
                  "description": "UUID of the source endpoint."
                },
                "target_env": {
                  "type": "string",
                  "description": "Target environment requested."
                },
                "status": {
                  "type": "string",
                  "enum": [
                    "success",
                    "ignored",
                    "error"
                  ],
                  "description": "'success': migrated or already existed. 'ignored': source already in target_env. 'error': see message."
                },
                "new_idendpoint": {
                  "type": "string",
                  "description": "UUID of the newly created endpoint in the target environment. Present only when a new endpoint was created."
                },
                "message": {
                  "type": "string",
                  "description": "Human-readable result detail."
                }
              }
            }
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [],
        "body": {
          "selection": 0,
          "json": {
            "code": [
              {
                "idendpoint": "00000000-0000-0000-0000-000000000001",
                "target_env": "qa"
              }
            ]
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "a6edc8f9-867c-4076-a984-fe0c850ae2c0",
      "rowkey": 949,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/endpoints/migrate",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 3,
      "title": "Migrate Endpoint to Another Environment",
      "description": "Copies one or more endpoints from their current environment to a target environment (dev, qa, or prd). The original endpoint is not deleted. If an endpoint with the same app+resource+method already exists in the target environment, the migration is skipped and reported as 'already exists'. Obtain idendpoint values from 'app_endpoints' or 'search_endpoints'.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "migrate,endpoint,environment,promote,copy",
      "code": "fnEndpointMigrate",
      "cache_time": 0,
      "createdAt": "2026-04-25T18:27:29.953Z",
      "updatedAt": "2026-04-25T18:27:29.953Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "appvar_migrate",
        "title": "Migrate AppVar to Another Environment",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nCopies one or more application variables (AppVars) from their current environment to a target environment (dev, qa, or prd). The original AppVar is NOT deleted — this is a copy/promote operation, not a move. Each item in the array requires 'idappvar' (UUID of the source AppVar) and 'target_env' (destination environment). Possible per-item outcomes: 'success' (migrated and new_idappvar is returned), 'ignored' (source is already in target_env), 'already exists' (an AppVar with same app+name already exists in target_env — treated as success, variable replaced), or 'error'. To obtain idappvar values use 'app_vars' (full list) or query AppVars by idapp. To verify the migration use 'app_vars' filtering by the target environment after calling this tool.",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May create, update, delete, restore, migrate, or invalidate application resources.",
        "safe_alternative": "Use a read-only catalog/search/status tool first to verify target ids and scope."
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "title": "AppVarMigrateRequest",
            "type": "array",
            "minItems": 1,
            "description": "Array of migration items. Each item specifies one AppVar to copy to a target environment.",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": [
                "idappvar",
                "target_env"
              ],
              "properties": {
                "idappvar": {
                  "type": "string",
                  "format": "uuid",
                  "description": "UUID of the source AppVar to migrate. Obtain from 'app_vars'."
                },
                "target_env": {
                  "type": "string",
                  "enum": [
                    "dev",
                    "qa",
                    "prd"
                  ],
                  "description": "Destination environment. Must be different from the source AppVar's current environment."
                }
              }
            }
          }
        },
        "out": {
          "enabled": true,
          "schema": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "idappvar": {
                  "type": "string",
                  "description": "UUID of the source AppVar."
                },
                "target_env": {
                  "type": "string",
                  "description": "Target environment requested."
                },
                "status": {
                  "type": "string",
                  "enum": [
                    "success",
                    "ignored",
                    "error"
                  ],
                  "description": "'success': migrated or already existed. 'ignored': source already in target_env. 'error': see message."
                },
                "new_idappvar": {
                  "type": "string",
                  "description": "UUID of the newly created AppVar in the target environment or the existing one if replaced."
                },
                "message": {
                  "type": "string",
                  "description": "Human-readable result detail."
                }
              }
            }
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [],
        "body": {
          "selection": 0,
          "json": {
            "code": [
              {
                "idappvar": "00000000-0000-0000-0000-000000000002",
                "target_env": "qa"
              }
            ]
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "c3d4e5f6-a7b8-9012-cdef-012345678912",
      "rowkey": 905,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/appvars/migrate",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 3,
      "title": "Migrate AppVar to Another Environment",
      "description": "Copies one or more application variables from their current environment to a target environment (dev, qa, or prd). The original AppVar is not deleted. If an AppVar with the same app and name already exists in the target environment, it is replaced. Obtain idappvar values from 'app_vars'.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "migrate,appvar,variable,environment,promote,copy",
      "code": "fnAppVarMigrate",
      "cache_time": 0,
      "createdAt": "2026-06-09T12:00:00.000Z",
      "updatedAt": "2026-06-09T12:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "search_endpoints",
        "title": "Search Endpoints",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nFull-text keyword search across endpoints. Searches title, description, resource, and keywords fields using a LIKE pattern. The 'query' parameter is optional — omitting it (or leaving other filters like idapp, environment, or handler) returns all matching endpoints. Optionally searches inside source code with 'search_code: true'. Returns a lightweight catalog (no source code by default). Max results: 200 (default 50, use 'offset' for pagination). To retrieve ALL endpoints of a specific app use 'app_endpoints' with the idapp.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "title": "EndpointSearchRequest",
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "query": {
                "type": "string",
                "maxLength": 200,
                "description": "Optional. Keyword or phrase to search for. Applied as LIKE pattern over title, description, resource, and keywords. When omitted, all endpoints matching the other filters are returned. To get all endpoints of a specific app use 'app_endpoints' instead."
              },
              "idapp": {
                "type": "string",
                "description": "Optional: restrict search to a specific app UUID. Obtain the idapp from 'apps_list' or 'apps_catalog'."
              },
              "environment": {
                "type": "string",
                "enum": [
                  "dev",
                  "qa",
                  "prd"
                ],
                "description": "Optional: restrict to a specific environment (dev, qa, prd)."
              },
              "handler": {
                "type": "string",
                "description": "Optional: restrict by handler type (JS, FUNCTION, SQL, FETCH, SOAP, etc.)."
              },
              "enabled": {
                "type": "boolean",
                "description": "Optional: filter by enabled status. Omit to include both enabled and disabled endpoints."
              },
              "search_code": {
                "type": "boolean",
                "default": false,
                "description": "If true, also search inside the source code field. Slower. Use only when you need to find endpoints by their implementation logic."
              },
              "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 200,
                "default": 50,
                "description": "Max number of results to return (default 50, max 200). Use 'offset' to paginate if you expect more results."
              },
              "offset": {
                "type": "integer",
                "minimum": 0,
                "default": 0,
                "description": "Pagination offset. Increment by 'limit' to retrieve next page."
              }
            }
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "query": "sql",
              "enabled": true
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "b1c2d3e4-f5a6-7890-abcd-ef1234567891",
      "rowkey": 339,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint/search",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Search Endpoints Globally",
      "description": "Global keyword search across all endpoints in all apps.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "search,find,endpoint,global",
      "code": "fnEndpointSearch",
      "cache_time": 0,
      "createdAt": "2026-04-30T12:00:00.000Z",
      "updatedAt": "2026-04-30T12:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "endpoint_versions_matrix",
        "title": "Get Endpoint Versions Matrix",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns endpoints grouped by resource+method with per-environment metadata (idendpoint, createdAt, updatedAt) plus comparison flags for code and configuration differences. Supports optional filtering by idendpoint (returns the same endpoint family across environments) and idapp. Use it to identify which environments are identical or different and which version is the best candidate to replicate.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "title": "EndpointVersionsMatrixRequest",
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "idendpoint": {
                "type": "string",
                "format": "uuid",
                "description": "Optional endpoint UUID. When provided, returns the same resource+method across its other environments."
              },
              "idapp": {
                "type": "string",
                "description": "Optional app UUID filter. Can be combined with idendpoint."
              },
              "app": {
                "type": "string",
                "description": "Optional app name filter (alternative to idapp)."
              },
              "include_disabled": {
                "type": "boolean",
                "default": false,
                "description": "If true, include disabled endpoints."
              },
              "environments": {
                "type": "array",
                "description": "Optional environment list to include.",
                "items": {
                  "type": "string",
                  "enum": [
                    "dev",
                    "qa",
                    "prd"
                  ]
                },
                "minItems": 1
              }
            }
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idendpoint": "8606a140-42f3-4e8f-aece-3bd9726b092e",
              "environments": [
                "dev",
                "qa",
                "prd"
              ]
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "9b2df9d1-7f0d-4cae-9f59-8cd7c6b6f3a1",
      "rowkey": 611,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint/versions/matrix",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Get Endpoint Versions Matrix",
      "description": "Returns endpoint version metadata by environment plus comparison results for code and configuration so you can identify identical or different environments and replicate the best version when needed.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "endpoint,version,matrix,environment,migrate,compare,diff,configuration",
      "code": "fnEndpointVersionsMatrix",
      "cache_time": 0,
      "createdAt": "2026-05-30T14:00:00.000Z",
      "updatedAt": "2026-05-30T14:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "list_api_clients",
        "title": "List API Clients",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns API clients with optional filters. If no filters are provided, it returns all clients ordered by username.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "title": "ApiClientsListRequest",
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "idclient": {
                "type": "string",
                "format": "uuid",
                "description": "Optional API client UUID filter."
              },
              "username": {
                "type": "string",
                "minLength": 1,
                "maxLength": 150,
                "description": "Optional username filter."
              }
            }
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "068fusy95",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "788e6e35-106d-45db-acb0-839db45c20f6",
      "rowkey": 22,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api_clients",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 0,
      "title": "Get API Clients",
      "description": "Returns API clients. Optional filters: `idclient` and `username`.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "api",
      "code": "fnGetApiClientfindByIdOrUsername",
      "cache_time": 30,
      "createdAt": "2026-02-21T07:10:26.497Z",
      "updatedAt": "2026-02-21T07:15:54.867Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "app_create_update",
        "title": "Create or Update Application",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nCreates or updates the main Application record only. This is the first step in the recommended workflow: create the application, then create shared AppVars with 'appvar_upsert', then attach endpoints with 'endpoint_upsert'. Does NOT create endpoints or AppVars by itself. Operation mode: omit 'idapp' for INSERT; include a valid UUID in 'idapp' for UPDATE. The 'app' name is normalized to lowercase, must be unique, and must match [a-zA-Z0-9_~.-] (max 50 chars).",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May create, update, delete, restore, migrate, or invalidate application resources.",
        "safe_alternative": "Use a read-only catalog/search/status tool first to verify target ids and scope.",
        "exampleRequest": {
          "app": "my_new_app",
          "enabled": true,
          "description": "Example application"
        }
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "title": "AppConfigUpsert",
            "description": "INSERT when 'idapp' is omitted. UPDATE when 'idapp' is a valid UUID. This endpoint persists only the Application root record.",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "app",
              "enabled"
            ],
            "properties": {
              "idapp": {
                "type": "string",
                "format": "uuid",
                "description": "Omit for INSERT (server generates UUID). Provide a valid UUID for UPDATE."
              },
              "app": {
                "type": "string",
                "maxLength": 50,
                "pattern": "^[a-zA-Z0-9_~.\\-]+$",
                "description": "Unique application name. It is normalized to lowercase and must match [a-zA-Z0-9_~.-] (max 50 chars)."
              },
              "iduser": {
                "type": [
                  "integer",
                  "null"
                ],
                "description": "ID of the creator/owner user. Optional."
              },
              "enabled": {
                "type": [
                  "boolean",
                  "integer"
                ],
                "enum": [
                  true,
                  false,
                  0,
                  1
                ],
                "default": true,
                "description": "Whether the application is enabled. Prefer boolean values; legacy 0/1 is still accepted for compatibility."
              },
              "description": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Human-readable description of the application."
              },
              "jwt_key": {
                "type": [
                  "string",
                  "null"
                ],
                "format": "uuid",
                "description": "JWT signing key for the app. If omitted, it can be generated automatically."
              },
              "vars": {
                "type": [
                  "object",
                  "null"
                ],
                "description": "Deprecated compatibility field. Do not use for new apps. Use appvar_upsert for per-environment variables.",
                "deprecated": true,
                "additionalProperties": {
                  "type": [
                    "string",
                    "number",
                    "boolean",
                    "object",
                    "array",
                    "null"
                  ]
                }
              },
              "params": {
                "type": [
                  "object",
                  "null"
                ],
                "description": "Free-form metadata for the application (not AppVars).",
                "additionalProperties": {
                  "type": [
                    "string",
                    "number",
                    "boolean",
                    "object",
                    "array",
                    "null"
                  ]
                }
              }
            },
            "anyOf": [
              {
                "description": "INSERT: do not include 'idapp'",
                "not": {
                  "required": [
                    "idapp"
                  ]
                }
              },
              {
                "description": "UPDATE: include 'idapp' with a valid UUID",
                "required": [
                  "idapp"
                ]
              }
            ]
          }
        },
        "out": {
          "enabled": true,
          "schema": {
            "type": "object",
            "description": "On success returns the persisted Application object. On error returns the exception payload.",
            "properties": {
              "idapp": {
                "type": "string",
                "format": "uuid"
              },
              "app": {
                "type": "string"
              },
              "enabled": {
                "type": "boolean"
              },
              "description": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "jwt_key": {
                "type": [
                  "string",
                  "null"
                ],
                "format": "uuid"
              },
              "params": {
                "type": [
                  "object",
                  "null"
                ]
              },
              "rowkey": {
                "type": "integer"
              },
              "createdAt": {
                "type": "string",
                "format": "date-time"
              },
              "updatedAt": {
                "type": "string",
                "format": "date-time"
              }
            },
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368",
            "_id": "ji619p4iv",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "app": "my_new_app",
              "enabled": true,
              "description": "Example application"
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368",
            "_id": "u8hnnlexu",
            "type": 1
          }
        ],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "410321a2-3930-4545-963d-b47f90fdbff3",
      "rowkey": 892,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/app",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnAppUpsert",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.726Z",
      "updatedAt": "2025-11-22T00:11:42.111Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "appvar_upsert",
        "title": "Create or Update Application Variable",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nCreates or updates a reusable application variable for a target `idapp` and `environment`. Use this after creating the application and before creating endpoints when configuration must be shared across multiple endpoints. Supported environments commonly used by agents are `dev`, `qa`, and `prd`. `value` is stored as a string in this contract. When an endpoint JSON payload needs an AppVar placeholder, embed it as the string `\"$_VAR_NAME\"`.",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May create, update, delete, restore, migrate, or invalidate application resources.",
        "safe_alternative": "Use a read-only catalog/search/status tool first to verify target ids and scope.",
        "exampleRequest": {
          "idapp": "00000000-0000-0000-0000-000000000001",
          "name": "MY_CONFIG_VALUE",
          "type": "string",
          "environment": "prd",
          "value": "example-value"
        },
        "notes": [
          "`value` is sent as string in this contract; serialize JSON when storing structured data.",
          "Recommended workflow: create the application first, store shared configuration with appvar_upsert, and then create endpoints that reuse those variables.",
          "When an endpoint JSON payload needs to reference an AppVar placeholder, embed it as a string such as `\"$_VAR_NAME\"`."
        ]
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idvar": {
                "type": "string",
                "description": "Variable identifier. Omit for INSERT; include it to update an existing variable."
              },
              "idapp": {
                "type": "string",
                "description": "Application identifier that owns the variable."
              },
              "name": {
                "type": "string",
                "maxLength": 50,
                "description": "Variable name."
              },
              "type": {
                "type": "string",
                "maxLength": 25,
                "default": "json",
                "description": "Declared variable type, for example `string`, `number`, or `json`."
              },
              "environment": {
                "type": "string",
                "maxLength": 10,
                "description": "Target environment such as `dev`, `qa`, or `prd`."
              },
              "value": {
                "description": "Serialized value to store. Send JSON as a string when persisting structured data.",
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "idapp",
              "name",
              "type",
              "environment"
            ]
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "35x0p27u4",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idapp": "00000000-0000-0000-0000-000000000001",
              "name": "MY_CONFIG_VALUE",
              "type": "string",
              "environment": "prd",
              "value": "example-value"
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "20354d7a-e4fe-47af-8ff6-187bca92f3f9",
      "rowkey": 0,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/app/var",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "UPSERT App var",
      "description": "Creates or updates a reusable application variable for a target `idapp` and `environment`. Use this after creating the application and before creating endpoints when configuration must be shared across multiple endpoints. Supported environments commonly used by agents are `dev`, `qa`, and `prd`.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "app,var",
      "code": "fnUpsertAppVar",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.724Z",
      "updatedAt": "2025-11-22T00:11:42.106Z"
    },
    {
      "ctrl": {
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": false,
        "name": "",
        "title": "",
        "description": ""
      },
      "json_schema": {
        "in": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        },
        "out": {}
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": {}
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "auth": {
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          },
          "selection": 0
        }
      },
      "idendpoint": "c6d6c431-aa5a-4e76-b89c-fe91e0537de4",
      "rowkey": 622,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/system/log/recordsperminute",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetLogsRecordsPerMinute",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.724Z",
      "updatedAt": "2025-11-22T00:11:42.107Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "endpoint_restore_version",
        "title": "Restore Endpoint Version",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nRestores an endpoint to a previous version using a specific 'idbackup'. This is a powerful one-click rollback tool. To find the correct idbackup, first call 'endpoint_change_history' with 'lightweight: true' to see the list of available backups and their timestamps.",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May create, update, delete, restore, migrate, or invalidate application resources.",
        "safe_alternative": "Use a read-only catalog/search/status tool first to verify target ids and scope."
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "title": "EndpointRestoreBackupRequest",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "idbackup"
            ],
            "properties": {
              "idbackup": {
                "type": "integer",
                "description": "The unique ID of the backup version to restore."
              }
            }
          }
        },
        "out": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "success": {
                "type": "boolean"
              },
              "idendpoint": {
                "type": "string",
                "format": "uuid"
              }
            }
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idbackup": 1
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "b1c2d3e4-f5a6-7890-abcd-ef1234567895",
      "rowkey": 804,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint/restore",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Restore Endpoint Version",
      "description": "Restores an endpoint to a previous version from backup.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "restore,rollback,backup,endpoint",
      "code": "fnEndpointRestoreBackup",
      "cache_time": 0,
      "createdAt": "2026-04-30T12:00:00.000Z",
      "updatedAt": "2026-04-30T12:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": false,
        "name": "",
        "title": "",
        "description": ""
      },
      "json_schema": {
        "in": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "3nbewj7nd",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "{\n  \"libOpenFusionAPI\": {\n    \"version\": \"2.1.0\"\n  }\n}",
          "sizeKBResponse": "0.04"
        }
      },
      "idendpoint": "0686803b-4817-48cd-9e9a-38807bdd7a98",
      "rowkey": 408,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/libopenfusionapi/version/last",
      "method": "GET",
      "handler": "JS",
      "access": 0,
      "title": "Get last version libOpenFusionAPI versión",
      "description": "Returns the latest published libOpenFusionAPI version from the GitHub repository.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "libopenfusionapi,github,version",
      "code": "const url =\n  \"https://raw.githubusercontent.com/rdsslab/libOpenFusionAPI/main/package.json\";\n\nconst uF = new uFetch(url);\nconst response = await uF.get();\nconst json = await response.json();\n\n$_RETURN_DATA_ = { libOpenFusionAPI: { version: json.version } };\n",
      "cache_time": 90,
      "createdAt": "2026-04-12T23:38:14.887Z",
      "updatedAt": "2026-04-12T23:38:14.887Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "handler_documentation",
        "title": "Handler Documentation",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns canonical documentation for one endpoint handler, including usage notes and optional generated references/examples. Call this before building complex handler payloads (for example SQL_BULK_I, SOAP, HANA, MONGODB, MCP, TELEGRAM_BOT) in `endpoint_upsert`.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A",
        "exampleRequest": {
          "handler": "JS"
        }
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "handler": {
                "type": "string",
                "minLength": 1,
                "maxLength": 25,
                "pattern": "^[A-Z_]+$",
                "description": "Handler identifier in uppercase. Recommended values: JS, FETCH, SOAP, SQL, TEXT, SQL_BULK_I, HANA, FUNCTION, MONGODB, MCP, TELEGRAM_BOT, NA."
              }
            },
            "additionalProperties": false,
            "title": "HandlerDocumentation",
            "required": [
              "handler"
            ]
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {
              "label": {
                "type": "string"
              },
              "description": {
                "type": "string"
              },
              "markdown": {
                "type": "string"
              },
              "manifest": {
                "type": "object",
                "additionalProperties": true
              },
              "generated": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": true
                }
              },
              "examples": {
                "type": "array",
                "items": {
                  "type": "object",
                  "additionalProperties": true
                }
              },
              "files": {
                "type": "object",
                "additionalProperties": true
              }
            },
            "required": [
              "label",
              "description"
            ],
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": true,
            "key": "handler",
            "value": "SQL",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368",
            "_id": "i9o6urvbp",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368",
            "_id": "nlt0z6p4k",
            "type": 1
          }
        ],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "{\"label\":\"JS\",\"description\":\"Executes JavaScript in a Node.js VM sandbox.\",\"markdown\":\"Full handler documentation is returned in this field when the tool is invoked.\"}",
          "sizeKBResponse": "0.1"
        }
      },
      "idendpoint": "25ca7819-8823-4835-87c5-04b792bc594d",
      "rowkey": 23,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/handler/documentation",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 0,
      "title": "Handler Documentation",
      "description": "Returns documentation for a supported endpoint handler.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetHandlerDocs",
      "cache_time": 3600,
      "createdAt": "2025-11-21T22:04:52.722Z",
      "updatedAt": "2025-11-22T00:11:42.101Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "appvars_effective_resolve",
        "title": "Resolve Effective AppVar Value",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nResolves the effective value of one AppVar for `idapp` + `environment`, indicating whether it came from cache snapshot or live DB lookup.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A",
        "exampleRequest": {
          "idapp": "00000000-0000-0000-0000-000000000001",
          "environment": "prd",
          "name": "MY_CONFIG_VALUE"
        },
        "notes": [
          "Use this after `appvar_upsert` when you need to confirm the runtime value that endpoints will actually see.",
          "If the result indicates cached data and you expected a fresh value, inspect cache state or invalidate cache before retesting dependent endpoints."
        ]
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idapp": {
                "type": "string",
                "description": "Application identifier."
              },
              "name": {
                "type": "string",
                "description": "Stored AppVar name (for example `MY_CONFIG_VALUE`). To reference a variable inside endpoint JSON payloads, use placeholder strings like `$_MY_CONFIG_VALUE`."
              },
              "environment": {
                "type": "string",
                "description": "Target environment (`dev`, `qa`, `prd`)."
              },
              "source": {
                "type": "string",
                "enum": [
                  "auto",
                  "cache",
                  "live"
                ],
                "description": "Resolution mode: `cache`, `live`, or `auto` (cache first, then live fallback)."
              }
            },
            "additionalProperties": false,
            "required": [
              "idapp",
              "name"
            ]
          }
        },
        "out": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idapp": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "environment": {
                "type": "string"
              },
              "source": {
                "type": "string"
              },
              "value": {}
            },
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": true,
            "key": "idapp",
            "value": "00000000-0000-0000-0000-000000000001",
            "type": 1
          },
          {
            "enabled": true,
            "key": "name",
            "value": "MY_CONFIG_VALUE",
            "type": 1
          },
          {
            "enabled": true,
            "key": "environment",
            "value": "prd",
            "type": 1
          },
          {
            "enabled": true,
            "key": "source",
            "value": "auto",
            "type": 1
          }
        ],
        "body": {
          "selection": 0
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "4fd224a5-9059-4929-a635-2c61f1af2f87",
      "rowkey": 20,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/app/var/effective",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Resolve effective AppVar value",
      "description": "Resolves one AppVar value for an app/environment and reports whether it came from cache snapshot or live DB.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "app,var,effective,resolve",
      "code": "fnAppVarsEffectiveResolve",
      "cache_time": 0,
      "createdAt": "2026-05-11T00:00:00.000Z",
      "updatedAt": "2026-05-11T00:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "endpoint_source_summary",
        "title": "Get Endpoint Source Summary",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns a compact source summary for one endpoint: code length, line count, and a configurable code preview — without downloading the full endpoint payload. Use this to quickly inspect endpoint logic before deciding whether to call 'endpoint_get_code' for the full source or 'read_endpoint_data' for the full configuration. Lighter than both alternatives.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A",
        "exampleRequest": {
          "idendpoint": "00000000-0000-0000-0000-000000000002",
          "preview_lines": 40
        },
        "notes": [
          "Prefer this over `read_endpoint_data` when the agent only needs a quick code preview or wants to estimate source size before requesting the full endpoint configuration."
        ]
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "title": "EndpointSourceSummaryRequest",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "idendpoint"
            ],
            "properties": {
              "idendpoint": {
                "type": "string",
                "format": "uuid",
                "description": "UUID of the endpoint to summarize. Obtain from 'app_endpoints' or 'search_endpoints'."
              },
              "preview_lines": {
                "type": "integer",
                "description": "Number of source code lines to include in the preview (default: 40, max: 500).",
                "minimum": 1,
                "maximum": 500
              }
            }
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "sy3qevh9r",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idendpoint": "00000000-0000-0000-0000-000000000002",
              "preview_lines": 20
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "cuv7rmczz",
            "type": 1
          }
        ],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "0f9b28e3-5412-45dd-82f6-c5bf1778d104",
      "rowkey": 913,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint/source/summary",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Get Endpoint Source Summary",
      "description": "Returns a compact source summary for one endpoint, including code length, line count, and a preview without the full endpoint payload.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "endpoint,source,summary,preview",
      "code": "fnEndpointSourceSummaryById",
      "cache_time": 0,
      "createdAt": "2026-04-06T01:40:00.000Z",
      "updatedAt": "2026-04-06T01:40:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "upsert_mongodb_endpoint_handler",
        "title": "UPSERT MONGODB Endpoint",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nCreates or updates MONGODB endpoints using a simplified payload. Send `mongo_code` and `mongo_config`, and this wrapper maps them to endpoint_upsert with handler=MONGODB.",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May create, update, delete, restore, migrate, or invalidate application resources.",
        "safe_alternative": "Use a read-only catalog/search/status tool first to verify target ids and scope."
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idendpoint": {
                "type": "string",
                "format": "uuid",
                "description": "Endpoint identifier. Omit for INSERT; provide for UPDATE."
              },
              "enabled": {
                "type": "boolean",
                "description": "Whether the endpoint should be enabled."
              },
              "idapp": {
                "type": "string",
                "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
                "description": "Application identifier. Accepts RFC UUID and legacy IDs already present in existing datasets."
              },
              "environment": {
                "type": "string",
                "enum": [
                  "dev",
                  "qa",
                  "prd"
                ],
                "description": "Target environment."
              },
              "timeout": {
                "type": "integer",
                "minimum": 0,
                "description": "Execution timeout in seconds."
              },
              "resource": {
                "type": "string",
                "minLength": 1,
                "maxLength": 300,
                "description": "HTTP resource path."
              },
              "method": {
                "type": "string",
                "enum": [
                  "GET",
                  "POST",
                  "PUT",
                  "PATCH",
                  "DELETE",
                  "OPTIONS",
                  "HEAD"
                ],
                "description": "HTTP method for the endpoint."
              },
              "access": {
                "type": "integer",
                "enum": [
                  0,
                  1,
                  2,
                  3,
                  4
                ],
                "description": "Access level."
              },
              "title": {
                "type": "string",
                "maxLength": 200,
                "description": "Human-readable endpoint title."
              },
              "description": {
                "type": "string",
                "description": "Endpoint purpose description."
              },
              "price_by_request": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per request in millicents."
              },
              "price_kb_request": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per request KB in millicents."
              },
              "price_kb_response": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per response KB in millicents."
              },
              "keywords": {
                "type": "string",
                "description": "Search keywords."
              },
              "ctrl": {
                "$ref": "#/$defs/jsonValue"
              },
              "mongo_code": {
                "type": "string",
                "description": "JavaScript logic stored in endpoint_upsert.code for MONGODB handler."
              },
              "mongo_config": {
                "anyOf": [
                  {
                    "type": "object",
                    "properties": {
                      "uri": {
                        "type": "string",
                        "description": "MongoDB connection URI (e.g. mongodb+srv://user:pass@cluster.mongodb.net/database). If provided, host and port are ignored."
                      },
                      "host": {
                        "type": "string",
                        "description": "MongoDB server host (legacy, e.g. localhost)."
                      },
                      "port": {
                        "type": [
                          "integer",
                          "string"
                        ],
                        "description": "MongoDB server port (legacy, e.g. 27017)."
                      },
                      "dbName": {
                        "type": "string",
                        "description": "Target database name."
                      },
                      "user": {
                        "type": "string",
                        "description": "Database username."
                      },
                      "pass": {
                        "type": "string",
                        "description": "Database password."
                      },
                      "options": {
                        "type": "object",
                        "description": "Additional Mongoose connection options (e.g. ssl)."
                      }
                    },
                    "additionalProperties": true
                  },
                  {
                    "type": "string",
                    "description": "MongoDB connection URI string directly."
                  }
                ],
                "description": "MongoDB connection configuration object or URI string."
              },
              "custom_data": {
                "$ref": "#/$defs/jsonValue",
                "description": "Optional custom_data merged with mongo_config."
              },
              "cors": {
                "$ref": "#/$defs/jsonValue"
              },
              "cache_time": {
                "type": "integer",
                "minimum": 0,
                "description": "Cache time in seconds."
              },
              "mcp": {
                "$ref": "#/$defs/jsonValue"
              },
              "json_schema": {
                "$ref": "#/$defs/jsonValue"
              },
              "headers_test": {
                "$ref": "#/$defs/jsonValue"
              },
              "data_test": {
                "$ref": "#/$defs/jsonValue"
              }
            },
            "additionalProperties": false,
            "required": [
              "idapp",
              "environment",
              "timeout",
              "resource",
              "method",
              "access",
              "title",
              "description",
              "price_by_request",
              "price_kb_request",
              "price_kb_response",
              "keywords",
              "mongo_code",
              "mongo_config",
              "cache_time"
            ],
            "$defs": {
              "jsonValue": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "array",
                    "items": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "string"
                  },
                  {
                    "type": "number"
                  },
                  {
                    "type": "integer"
                  },
                  {
                    "type": "boolean"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "mongowrapperquery01",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idapp": "<idapp-uuid>",
              "environment": "prd",
              "resource": "/mongo/users/find",
              "method": "POST",
              "access": 0,
              "title": "Mongo users find",
              "description": "MONGODB endpoint example",
              "timeout": 30,
              "cache_time": 0,
              "price_by_request": 1,
              "price_kb_request": 1,
              "price_kb_response": 1,
              "keywords": "mongodb,endpoint",
              "mongo_code": "const docs = await mongooseInstance.collection('users').find({}).toArray();\n$_RETURN_DATA_ = docs;",
              "mongo_config": {
                "uri": "mongodb://localhost:27017/my_database",
                "options": {}
              }
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "2f7a36f0-f45c-4a5f-95d5-0bc2bdb1e25a",
      "rowkey": 505,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint/mongodb",
      "method": "POST",
      "handler": "JS",
      "access": 3,
      "title": "UPSERT MONGODB Handler Endpoint",
      "description": "Create or modify in OpenFusion API a MONGODB handler endpoint.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "mongodb,endpoint",
      "code": "const uF = uFetchAutoEnv.auto('/api/system/api/endpoint/auto', true);\nconst body = request.body || {};\nconst auth = request?.headers?.authorization || request?.headers?.Authorization || '';\nconst custom_data = (body.custom_data && typeof body.custom_data === 'object') ? { ...body.custom_data } : {};\n\nif (body.mongo_config && typeof body.mongo_config === 'object') {\n  Object.assign(custom_data, body.mongo_config);\n}\n\nconst data = {\n  ...body,\n  handler: 'MONGODB',\n  code: body.mongo_code ?? body.code ?? '',\n  custom_data,\n};\n\ndelete data.mongo_code;\ndelete data.mongo_config;\n\nconst req1 = await uF.post({ data, headers: auth ? { authorization: auth } : undefined });\nconst resp = await req1.json();\n$_RETURN_DATA_ = resp;",
      "cache_time": 0,
      "createdAt": "2026-05-19T12:00:00.000Z",
      "updatedAt": "2026-05-19T12:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": false,
        "name": "user_login",
        "title": "User Login",
        "description": "Login for user access.."
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "username": {
                "type": "string",
                "description": "Nombre de usuario"
              },
              "password": {
                "type": "string",
                "description": "Contraseña del usuario"
              }
            },
            "additionalProperties": true,
            "title": "Login",
            "description": "Schema para validar credenciales de login",
            "required": [
              "username",
              "password"
            ]
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "hl2so8w0j",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "871cd2ed-8456-4e5e-8ab5-b7724a908191",
      "rowkey": 736,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/system/login",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 0,
      "title": "System Login",
      "description": "User Login.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "login",
      "code": "fnLogin",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.723Z",
      "updatedAt": "2025-11-22T00:11:42.104Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "apps_catalog",
        "title": "List Application Catalog (Lightweight)",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns a lightweight list of applications: names, idapp, enabled status and description — without nested endpoints or AppVars. Use this to discover idapp values or check which apps exist. For a full payload including endpoints and variables use 'apps_list'. To get endpoints of a specific app use 'app_endpoints'.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A",
        "exampleRequest": {
          "enabled": true,
          "limit": 50,
          "offset": 0
        },
        "notes": [
          "Prefer this over `apps_list` for initial discovery because the payload is smaller and excludes nested endpoint trees.",
          "Move to `apps_list` or `get_app_list_filters` only when you need nested endpoints, variables, or filter-driven inspection."
        ]
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "app": {
                "type": "string"
              },
              "enabled": {
                "type": "boolean"
              },
              "limit": {
                "type": "integer",
                "minimum": 1
              },
              "offset": {
                "type": "integer",
                "minimum": 0
              }
            },
            "additionalProperties": false
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "p58z5v6tq",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "enabled": true,
              "limit": 50,
              "offset": 0
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "5a0dd410-6f0e-4839-b630-bebba38f9102",
      "rowkey": 557,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/apps/catalog",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Get Apps Catalog",
      "description": "Returns a lightweight catalog of applications without nested endpoints or application variables.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "app,catalog,lightweight",
      "code": "fnGetAppsCatalog",
      "cache_time": 0,
      "createdAt": "2026-04-06T01:10:00.000Z",
      "updatedAt": "2026-04-06T01:10:00.000Z"
    },
    {
      "ctrl": {},
      "cors": {},
      "mcp": {},
      "json_schema": {
        "in": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": {}
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "auth": {
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          },
          "selection": 0
        }
      },
      "idendpoint": "bcf0e362-a454-4e47-85a0-772c4ddd3538",
      "rowkey": 227,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/information/dynamic",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "",
      "description": "",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetSystemInfoDynamic",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.722Z",
      "updatedAt": "2025-11-22T00:11:42.102Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "describe_table_structure",
        "title": "Describe Table Structure",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns table column metadata using explicit Sequelize connection settings provided in the request body.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "connection": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "database",
                  "username",
                  "password",
                  "dialect",
                  "host"
                ],
                "properties": {
                  "database": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Database name."
                  },
                  "username": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Database username."
                  },
                  "password": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Database password."
                  },
                  "dialect": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Sequelize dialect, for example `mssql`, `postgres`, `mysql` or `sqlite`."
                  },
                  "host": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Database server host or IP address."
                  },
                  "port": {
                    "type": "integer",
                    "description": "Database server port. Optional."
                  },
                  "appName": {
                    "type": "string",
                    "description": "Optional client/application name for the database connection."
                  },
                  "dialectOptions": {
                    "type": "object",
                    "description": "Optional Sequelize dialectOptions object.",
                    "additionalProperties": true
                  },
                  "logging": {
                    "description": "Optional Sequelize logging flag or function.",
                    "oneOf": [
                      {
                        "type": "boolean"
                      },
                      {
                        "type": "string"
                      },
                      {
                        "type": "null"
                      },
                      {
                        "type": "object"
                      }
                    ]
                  }
                },
                "description": "Explicit Sequelize connection object. Do not nest `host` or `dialect` under `options`."
              },
              "table": {
                "type": "string",
                "minLength": 1,
                "description": "Target table name."
              },
              "schema": {
                "type": "string",
                "minLength": 1,
                "description": "Optional schema name for dialects that support schemas."
              }
            },
            "additionalProperties": false,
            "required": [
              "connection",
              "table"
            ]
          }
        },
        "out": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "ok": {
                "type": "boolean"
              },
              "dialect": {
                "type": "string"
              },
              "table": {
                "type": "string"
              },
              "schema": {
                "type": [
                  "string",
                  "null"
                ]
              },
              "columns": {
                "type": "object",
                "additionalProperties": true
              }
            },
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "connection": {
                "database": "<database_name>",
                "username": "<db_user>",
                "password": "<db_password>",
                "dialect": "mssql",
                "host": "<db_host_or_ip>",
                "dialectOptions": {
                  "options": {
                    "requestTimeout": 600000
                  }
                }
              },
              "table": "<table_name>"
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "{\n  \"ok\": true,\n  \"dialect\": \"mssql\",\n  \"table\": \"tbl_ClientesDatosExtra\",\n  \"schema\": null,\n  \"columns\": {\n    \"cde_tipo_idcliente\": {\n      \"type\": \"VARCHAR(2)\",\n      \"allowNull\": false,\n      \"defaultValue\": \"S\",\n      \"primaryKey\": false,\n      \"autoIncrement\": false,\n      \"comment\": null\n    },\n    \"cde_numero_idcliente\": {\n      \"type\": \"VARCHAR(20)\",\n      \"allowNull\": false,\n      \"defaultValue\": null,\n      \"primaryKey\": false,\n      \"autoIncrement\": false,\n      \"comment\": null\n    },\n    \"cde_cupo_maximo_relacionados\": {\n      \"type\": \"DECIMAL\",\n      \"allowNull\": false,\n      \"defaultValue\": null,\n      \"primaryKey\": false,\n      \"autoIncrement\": false,\n      \"comment\": null\n    },\n    \"cde_caducidad_cedula\": {\n      \"type\": \"DATETIME\",\n      \"allowNull\": false,\n      \"defaultValue\": null,\n      \"primaryKey\": false,\n      \"autoIncrement\": false,\n      \"comment\": null\n    },\n    \"cde_validez_representante_legal\": {\n      \"type\": \"DATETIME\",\n      \"allowNull\": false,\n      ",
          "sizeKBResponse": "1.34"
        }
      },
      "idendpoint": "9a4e24c9-f563-42b2-b7db-b4bc4b03c5c1",
      "rowkey": 209,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/db/table/structure",
      "method": "POST",
      "handler": "JS",
      "access": 2,
      "title": "Describe Database Table Structure",
      "description": "Receives explicit Sequelize connection parameters in the request body and returns the structure of a target table.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "sequelize,table,structure,metadata",
      "code": "const rawPayload = request.body && request.body.json ? request.body.json : (request.body || {});\nconst payload = rawPayload && typeof rawPayload === \"object\" && rawPayload.code && typeof rawPayload.code === \"object\"\n  ? rawPayload.code\n  : rawPayload;\n\nconst connection = payload.connection;\nconst table = payload.table;\nconst schema = payload.schema;\n\nconst requiredConnectionFields = [\"database\", \"username\", \"password\", \"dialect\", \"host\"];\n\nif (!payload || typeof payload !== \"object\" || Array.isArray(payload)) {\n  $_EXCEPTION_(\"Invalid request body for describe_table_structure.\", {\n    expected_body: {\n      connection: {\n        database: \"string\",\n        username: \"string\",\n        password: \"string\",\n        dialect: \"string\",\n        host: \"string\",\n        port: \"number (optional)\",\n        appName: \"string (optional)\",\n        dialectOptions: \"object (optional)\",\n        logging: \"boolean|function (optional)\"\n      },\n      table: \"string\",\n      schema: \"string (optional)\"\n    }\n  }, 400);\n}\n\nif (!connection || typeof connection !== \"object\" || Array.isArray(connection)) {\n  $_EXCEPTION_(\"Missing required 'connection' object in request body.\", {\n    expected_body: {\n      connection: {\n        database: \"string\",\n        username: \"string\",\n        password: \"string\",\n        dialect: \"string\",\n        host: \"string\",\n        port: \"number (optional)\"\n      },\n      table: \"string\",\n      schema: \"string (optional)\"\n    }\n  }, 400);\n}\n\nconst missingFields = requiredConnectionFields.filter((field) => {\n  const value = connection[field];\n  return typeof value !== \"string\" || value.trim().length === 0;\n});\n\nif (missingFields.length > 0) {\n  $_EXCEPTION_(\"Missing required connection fields for describe_table_structure.\", {\n    missing: missingFields.map((field) => `connection.${field}`),\n    expected_body: {\n      connection: {\n        database: \"string\",\n        username: \"string\",\n        password: \"string\",\n        dialect: \"string\",\n        host: \"string\",\n        port: \"number (optional)\",\n        appName: \"string (optional)\",\n        dialectOptions: \"object (optional)\",\n        logging: \"boolean|function (optional)\"\n      },\n      table: \"string\",\n      schema: \"string (optional)\"\n    }\n  }, 400);\n}\n\nif (typeof table !== \"string\" || table.trim().length === 0) {\n  $_EXCEPTION_(\"Missing required 'table' value in request body.\", {\n    expected_body: {\n      connection: {\n        database: \"string\",\n        username: \"string\",\n        password: \"string\",\n        dialect: \"string\",\n        host: \"string\"\n      },\n      table: \"string\",\n      schema: \"string (optional)\"\n    }\n  }, 400);\n}\n\nif (schema !== undefined && (typeof schema !== \"string\" || schema.trim().length === 0)) {\n  $_EXCEPTION_(\"Invalid 'schema' value. When provided, it must be a non-empty string.\", {\n    received_type: typeof schema\n  }, 400);\n}\n\nconst sequelizeConfig = {\n  ...connection,\n  database: connection.database.trim(),\n  username: connection.username.trim(),\n  password: connection.password,\n  dialect: connection.dialect.trim(),\n  host: connection.host.trim()\n};\n\nconst db = new sequelize.Sequelize(\n  sequelizeConfig.database,\n  sequelizeConfig.username,\n  sequelizeConfig.password,\n  sequelizeConfig\n);\n\ntry {\n  await db.authenticate();\n  const queryInterface = db.getQueryInterface();\n  const normalizedSchema = typeof schema === \"string\" ? schema.trim() : null;\n  const normalizedTable = table.trim();\n  const tableRef = normalizedSchema ? { tableName: normalizedTable, schema: normalizedSchema } : normalizedTable;\n  const columns = await queryInterface.describeTable(tableRef);\n\n  $_RETURN_DATA_ = {\n    ok: true,\n    dialect: db.getDialect(),\n    table: normalizedTable,\n    schema: normalizedSchema,\n    columns\n  };\n} catch (error) {\n  $_EXCEPTION_(\"Unable to describe table structure.\", {\n    message: error && error.message ? error.message : \"Unknown error\"\n  }, 500);\n} finally {\n  await db.close();\n}",
      "cache_time": 30,
      "createdAt": "2026-03-31T03:05:09.916Z",
      "updatedAt": "2026-03-31T04:35:26.051Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {}
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "get_app_list",
        "title": "Get Application List",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nIt returns the list of registered applications, but does not return the endpoints associated with each app.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "uppcvcn8w",
            "type": 1
          }
        ],
        "body": {
          "selection": 0
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "[\n  {\n    \"vars\": {},\n    \"params\": {\n      \"users\": []\n    },\n    \"idapp\": \"cfcd2084-95d5-65ef-66e7-dff9f98764da\",\n    \"app\": \"system\",\n    \"rowkey\": 493,\n    \"iduser\": null,\n    \"enabled\": true,\n    \"description\": \"App System\",\n    \"jwt_key\": \"a6c042e9-5516-484f-a502-051fa8906331\",\n    \"createdAt\": \"2025-11-21T22:04:52.650Z\",\n    \"updatedAt\": \"2025-11-22T00:11:41.979Z\"\n  },\n  {\n    \"vars\": {},\n    \"params\": {},\n    \"idapp\": \"c4ca4238-a0b9-2382-0dcc-509a6f75849b\",\n    \"app\": \"demo\",\n    \"rowkey\": 194,\n    \"iduser\": null,\n    \"enabled\": true,\n    \"description\": \"App DEMO\",\n    \"jwt_key\": \"f30ce432-7b32-4267-8af3-3dfd7c0f7ed6\",\n    \"createdAt\": \"2024-01-30T03:33:10.835Z\",\n    \"updatedAt\": \"2025-11-22T05:07:07.329Z\"\n  },\n  {\n    \"vars\": {},\n    \"params\": {\n      \"users\": []\n    },\n    \"idapp\": \"e86e84f1-336f-4f2a-ab37-ffed7876e71f\",\n    \"app\": \"app_agent_mcp_20260328_a\",\n    \"rowkey\": 312,\n    \"iduser\": null,\n    \"enabled\": true,\n    \"description\": \"Prueba contrato MCP app_create_update\"",
          "sizeKBResponse": "1.89"
        }
      },
      "idendpoint": "55bdde78-051e-4844-a4b2-089f122f616e",
      "rowkey": 240,
      "enabled": false,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/app/list",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Get Apps",
      "description": "It returns the list of registered applications, but does not return the endpoints associated with each app.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "app",
      "code": "fnGetApps",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.725Z",
      "updatedAt": "2025-11-22T00:11:42.110Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "app_data",
        "title": "Get Application data",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns the main Application record for the provided `idapp`.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A",
        "exampleRequest": {
          "idapp": "00000000-0000-0000-0000-000000000001"
        }
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "title": "IdAppRequest",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "idapp"
            ],
            "properties": {
              "idapp": {
                "type": "string",
                "minLength": 1,
                "maxLength": 100,
                "description": "Application identifier"
              }
            }
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368",
            "_id": "4vopa0uge",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idapp": "00000000-0000-0000-0000-000000000001"
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368",
            "_id": "cakdvivmt",
            "type": 1
          }
        ],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "410321a2-3930-4545-963d-b47f90fdbff4",
      "rowkey": 50,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/app",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "It obtains data from the Application",
      "description": "Returns the main Application record for the provided `idapp`.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnAppGetById",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.726Z",
      "updatedAt": "2025-11-22T00:11:42.112Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3,
          "level": 0
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "get_system_logs",
        "title": "Get System Logs",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nSearches logs with optional filters. Prefer trace_id to follow a single execution trace across requests and errors.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A",
        "exampleRequest": {
          "trace_id": "trace-id-example",
          "limit": 50,
          "orderDirection": "DESC"
        },
        "notes": [
          "Prefer `trace_id` as the first filter when investigating one failing execution path.",
          "When using date windows, send `start_date` and `end_date` together to keep the range explicit.",
          "Use `last_hours` for quick recent searches and reserve broad unfiltered scans for exceptional cases because log volume can be high."
        ]
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "idapp": {
                "type": "string",
                "description": "Application UUID. If provided, filters logs by app."
              },
              "last_hours": {
                "type": "integer",
                "minimum": 1,
                "description": "Last N hours from now."
              },
              "start_date": {
                "type": "string",
                "description": "Start datetime (inclusive). Use together with end_date."
              },
              "end_date": {
                "type": "string",
                "description": "End datetime (inclusive). Use together with start_date."
              },
              "idendpoint": {
                "type": "string",
                "description": "Endpoint UUID. Ignored when idapp is provided."
              },
              "log_level": {
                "type": "integer",
                "enum": [
                  0,
                  1,
                  2,
                  3
                ],
                "description": "Log verbosity level: 0=Disabled (no logs), 1=Basic (minimal events), 2=Normal (includes params/query/body), 3=Full (includes headers and response payload)."
              },
              "method": {
                "type": "string",
                "description": "HTTP method (GET, POST, PUT, PATCH, DELETE)."
              },
              "status_code": {
                "type": "integer",
                "minimum": 100,
                "maximum": 599,
                "description": "HTTP status code filter."
              },
              "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 999999,
                "default": 1000,
                "description": "Maximum records to return."
              },
              "offset": {
                "type": "integer",
                "minimum": 0,
                "default": 0,
                "description": "Pagination offset."
              },
              "order": {
                "type": "string",
                "default": "timestamp",
                "description": "Field used for sorting."
              },
              "orderDirection": {
                "type": "string",
                "enum": [
                  "ASC",
                  "DESC"
                ],
                "default": "DESC",
                "description": "Sort direction."
              },
              "trace_id": {
                "type": "string",
                "minLength": 1,
                "description": "Primary correlation key for diagnostics. Use this to trace a full error chain and execution path for one request across endpoint interactions."
              },
              "raw": {
                "type": "boolean",
                "default": true,
                "description": "Return plain objects instead of Sequelize instances."
              }
            }
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": {}
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1,
          "MimeType": ""
        }
      },
      "idendpoint": "c10b1812-8b25-4b16-adb9-bf7ac8134f76",
      "rowkey": 755,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/system/log",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Get System Logs",
      "description": "Returns logs with optional filters. Use trace_id for end-to-end troubleshooting and error-chain analysis.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "logs,trace_id,diagnostics,errors,monitoring,system",
      "code": "fnGetLogs",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.722Z",
      "updatedAt": "2025-11-22T00:11:42.101Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "endpoint_get_code",
        "title": "Get Endpoint Source Code",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns ONLY the source code and basic metadata of a specific endpoint by 'idendpoint'. Much lighter than 'read_endpoint_data' — use this when you need to read or modify the logic of an existing endpoint without downloading the full configuration (json_schema, data_test, ctrl, etc.). Call 'read_endpoint_data' first to discover the idendpoint if you do not already have it.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "title": "EndpointGetCodeRequest",
            "type": "object",
            "additionalProperties": false,
            "required": [
              "idendpoint"
            ],
            "properties": {
              "idendpoint": {
                "type": "string",
                "format": "uuid",
                "description": "UUID of the endpoint whose source code you want to retrieve."
              }
            }
          }
        },
        "out": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idendpoint": {
                "type": "string"
              },
              "idapp": {
                "type": "string"
              },
              "resource": {
                "type": "string"
              },
              "method": {
                "type": "string"
              },
              "handler": {
                "type": "string"
              },
              "environment": {
                "type": "string"
              },
              "enabled": {
                "type": "boolean"
              },
              "code": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Raw source code of the endpoint."
              }
            }
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idendpoint": "00000000-0000-0000-0000-000000000001"
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "b1c2d3e4-f5a6-7890-abcd-ef1234567892",
      "rowkey": 567,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint/code",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Get Endpoint Source Code",
      "description": "Returns only the source code field of a specific endpoint by idendpoint.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "code,source,endpoint",
      "code": "fnEndpointGetCode",
      "cache_time": 0,
      "createdAt": "2026-04-30T12:00:00.000Z",
      "updatedAt": "2026-04-30T12:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "execute_endpoint_test",
        "title": "Execute Endpoint Test",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nExecutes an endpoint via an internal HTTP call and returns the result (status_code, response_time_ms, response body). Ideal for agents to verify that an endpoint they just created or modified works correctly. Simplest usage: provide only 'idendpoint' — the tool auto-resolves app name, resource and method from the DB. Optionally override 'environment' (default: prd), provide 'payload' for request bodies, 'query_params' for GET, 'headers' for custom request headers, and 'bearer_token' for authenticated endpoints. Saved test metadata (`data_test` / `headers_test`) is used only when `use_data_test_fallback=true`. When testing by explicit 'app' + 'resource', always send 'method' if you also send 'payload'. The result also includes the resolved query params, payload, headers, payload source, warnings, and serialized request body actually sent, so agents can debug request forwarding without writing local scripts. Endpoints that require auth and have no public access will need a valid bearer_token.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "title": "ExecuteEndpointTestRequest",
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "idendpoint": {
                "type": "string",
                "format": "uuid",
                "description": "UUID of the endpoint to test. Auto-resolves app, resource and method. Recommended over explicit fields."
              },
              "app": {
                "type": "string",
                "description": "App name (required only when idendpoint is not provided)."
              },
              "resource": {
                "type": "string",
                "description": "Endpoint resource path (required only when idendpoint is not provided)."
              },
              "method": {
                "type": "string",
                "enum": [
                  "GET",
                  "POST",
                  "PUT",
                  "PATCH",
                  "DELETE"
                ],
                "default": "GET",
                "description": "HTTP method (auto-resolved from idendpoint if omitted). When using explicit 'app' + 'resource' together with 'payload', send this field explicitly."
              },
              "environment": {
                "type": "string",
                "enum": [
                  "dev",
                  "qa",
                  "prd"
                ],
                "default": "prd",
                "description": "Target environment. Defaults to 'prd'."
              },
              "payload": {
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "number"
                  },
                  {
                    "type": "boolean"
                  },
                  {
                    "type": "object",
                    "additionalProperties": true
                  },
                  {
                    "type": "array"
                  },
                  {
                    "type": "null"
                  }
                ],
                "description": "Request body to send for POST / PUT / PATCH / DELETE requests. If you send 'payload': null explicitly, the tool will not inherit the saved data_test body for that execution."
              },
              "headers": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                },
                "description": "Optional request headers to send explicitly. Use this instead of relying on saved headers_test metadata."
              },
              "query_params": {
                "type": "object",
                "additionalProperties": {
                  "type": "string"
                },
                "description": "Query string parameters (key-value pairs)."
              },
              "use_data_test_fallback": {
                "type": "boolean",
                "default": false,
                "description": "When true, missing payload/query_params/headers can be inherited from the endpoint's saved data_test and headers_test metadata. Recommended only for legacy/editor-style flows."
              },
              "bearer_token": {
                "type": [
                  "string",
                  "null"
                ],
                "description": "Bearer token for authenticated endpoints. Omit for public endpoints."
              },
              "timeout_ms": {
                "type": "integer",
                "minimum": 500,
                "maximum": 30000,
                "default": 10000,
                "description": "Request timeout in milliseconds."
              }
            }
          }
        },
        "out": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "tested_url": {
                "type": "string",
                "description": "The internal URL that was called."
              },
              "method": {
                "type": "string"
              },
              "status_code": {
                "type": "integer"
              },
              "response_time_ms": {
                "type": "integer"
              },
              "success": {
                "type": "boolean"
              },
              "resolved_inputs": {
                "type": "object",
                "description": "Resolved request inputs used by the tool, including query params, payload, headers, and serialized body.",
                "properties": {
                  "from_data_test": {
                    "type": "object",
                    "properties": {
                      "query_params": {
                        "type": "boolean"
                      },
                      "payload": {
                        "type": "boolean"
                      },
                      "headers": {
                        "type": "boolean"
                      }
                    }
                  },
                  "query_params": {
                    "type": "object",
                    "additionalProperties": true
                  },
                  "payload": {
                    "description": "Payload object or array resolved for the request body."
                  },
                  "payload_source": {
                    "type": "string",
                    "description": "Indicates whether the final payload came from the explicit input, saved data_test metadata, or no payload was used."
                  },
                  "headers": {
                    "type": "object",
                    "additionalProperties": {
                      "type": "string"
                    }
                  },
                  "serialized_body": {
                    "type": [
                      "string",
                      "null"
                    ],
                    "description": "Exact body string sent over HTTP after serialization."
                  },
                  "warnings": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    },
                    "description": "Non-fatal diagnostics explaining fallback decisions or ignored payload cases."
                  }
                }
              },
              "response": {
                "description": "The actual response from the endpoint (JSON or text)."
              }
            }
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idendpoint": "00000000-0000-0000-0000-000000000001",
              "environment": "prd"
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "b1c2d3e4-f5a6-7890-abcd-ef1234567894",
      "rowkey": 193,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint/test",
      "method": "POST",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Execute Endpoint Test",
      "description": "Executes an endpoint via internal HTTP and returns status, response time, and response body.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "test,execute,verify,endpoint",
      "code": "fnEndpointTest",
      "cache_time": 0,
      "createdAt": "2026-04-30T12:00:00.000Z",
      "updatedAt": "2026-04-30T12:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "endpoint_delete",
        "title": "Delete Endpoint",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nPermanently deletes an endpoint from the database and registry.",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May create, update, delete, restore, migrate, or invalidate application resources.",
        "safe_alternative": "Use a read-only catalog/search/status tool first to verify target ids and scope."
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idendpoint": {
                "type": "string",
                "format": "uuid",
                "description": "UUID of the endpoint to delete."
              }
            },
            "required": [
              "idendpoint"
            ]
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {},
      "idendpoint": "b1c2d3e4-f5a6-7890-abcd-ef1234567896",
      "rowkey": 84,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint",
      "method": "DELETE",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Delete Endpoint",
      "description": "Permanently deletes an endpoint.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "endpoint,delete,system",
      "code": "fnEndpointDelete",
      "cache_time": 0,
      "createdAt": "2026-05-11T12:20:29.578Z",
      "updatedAt": "2026-05-21T09:10:14.858Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 0,
          "status_success": 0,
          "status_redirect": 0,
          "status_client_error": 0,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "get_libopenfusionapi_latest_version",
        "title": "Get Latest libOpenFusionAPI Version",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns the latest published libOpenFusionAPI version from the GitHub repository.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "title": "LatestVersionRequest",
            "type": "object",
            "additionalProperties": false,
            "properties": {}
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368",
            "_id": "8bs5sn23b",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368",
            "_id": "cu8ua5yll",
            "type": 1
          }
        ],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "2cf4eecc-1bbe-433a-b8eb-347a7de52d4d",
      "rowkey": 397,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/database/hooks",
      "method": "POST",
      "handler": "JS",
      "access": 0,
      "title": "",
      "description": "Receiver of hooks issued from the database, these events will be forwarded via websocket to be consumed by clients.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "ofapi.server.checkwebHookDB(request);\n",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.725Z",
      "updatedAt": "2025-11-22T00:11:42.108Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3,
          "level": 0
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "trace_errors_only",
        "title": "Trace Errors Only",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns only problematic HTTP requests for one trace_id. By default it includes 3xx, 4xx and 5xx records so agents can ignore successful noise and focus on failures or suspicious redirects.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "trace_id": {
                "type": "string",
                "minLength": 1,
                "description": "Trace identifier to inspect. This is required and should come from header ofapi-trace-id."
              },
              "include_redirects": {
                "type": "boolean",
                "default": true,
                "description": "When true, include 3xx records."
              },
              "include_client_errors": {
                "type": "boolean",
                "default": true,
                "description": "When true, include 4xx records."
              },
              "include_server_errors": {
                "type": "boolean",
                "default": true,
                "description": "When true, include 5xx records."
              },
              "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 10000,
                "default": 200,
                "description": "Maximum number of problematic records to return."
              },
              "offset": {
                "type": "integer",
                "minimum": 0,
                "default": 0,
                "description": "Pagination offset."
              }
            },
            "required": [
              "trace_id"
            ]
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": true,
            "key": "trace_id",
            "value": "trace-id-example",
            "internal_hash_row": "",
            "type": 1,
            "_id": "trce001"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "f6a1a9d1-3d74-4c7e-95f7-5b7f0f4d5101",
      "rowkey": 864,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/system/log/trace/errors",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Trace Errors Only",
      "description": "Returns only problematic requests (3xx/4xx/5xx) for one trace_id.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "trace_id,errors,3xx,4xx,5xx,diagnostics",
      "code": "fnGetTraceErrorsOnly",
      "cache_time": 0,
      "createdAt": "2026-07-02T00:00:00.000Z",
      "updatedAt": "2026-07-02T00:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3,
          "level": 0
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "trace_slowest_hops",
        "title": "Trace Slowest Hops",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns the slowest endpoints involved in one trace_id. Results are grouped by endpoint and sorted by maximum response time so agents can quickly identify latency bottlenecks.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "trace_id": {
                "type": "string",
                "minLength": 1,
                "description": "Trace identifier to analyze."
              },
              "threshold_ms": {
                "type": "number",
                "minimum": 0,
                "default": 500,
                "description": "Optional latency threshold. Only requests with response_time >= threshold_ms are analyzed."
              },
              "top_n": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "default": 10,
                "description": "Maximum number of grouped endpoints to return."
              }
            },
            "required": [
              "trace_id"
            ]
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": true,
            "key": "trace_id",
            "value": "trace-id-example",
            "internal_hash_row": "",
            "type": 1,
            "_id": "trce002"
          },
          {
            "enabled": true,
            "key": "threshold_ms",
            "value": "500",
            "internal_hash_row": "",
            "type": 1,
            "_id": "trce003"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "f6a1a9d1-3d74-4c7e-95f7-5b7f0f4d5102",
      "rowkey": 772,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/system/log/trace/slow",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Trace Slowest Hops",
      "description": "Returns grouped slowest endpoints for a trace_id using an optional threshold.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "trace_id,latency,slow,response_time,diagnostics",
      "code": "fnGetTraceSlowestHops",
      "cache_time": 0,
      "createdAt": "2026-07-02T00:00:00.000Z",
      "updatedAt": "2026-07-02T00:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "apps_list",
        "title": "List Apps",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns all applications with their application variables and related endpoints. This is a very heavy endpoint — use the optional 'attributes' array to request only specific fields or use 'apps_catalog' for a lightweight list.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A",
        "exampleRequest": {},
        "notes": [
          "This can be a large payload because it expands nested app variables and endpoints for every application.",
          "Prefer `apps_catalog` for initial discovery and use this full list only when you explicitly need nested data for many applications at once."
        ]
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "attributes": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "description": "Optional: array of fields to return for each application (e.g. ['idapp', 'app', 'enabled', 'description'])."
              }
            },
            "additionalProperties": false
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "iqg87g0if",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "55bdde78-051e-4844-a4b2-089f122f6160",
      "rowkey": 72,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/apps",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "App List",
      "description": "Returns all applications with their application variables and related endpoints.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetApps",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.725Z",
      "updatedAt": "2025-11-22T00:11:42.110Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "app_vars",
        "title": "Get Application Variables",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns all application variables (AppVars) for the given `idapp`, including their values across all environments. Use this when you need the full variable data to read or inspect values. For a lightweight list without values use 'app_vars_catalog'. To resolve the effective runtime value of a single variable use 'appvars_effective_resolve'.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A",
        "exampleRequest": {
          "idapp": "00000000-0000-0000-0000-000000000001"
        },
        "notes": [
          "The request field is `idapp`; send the application identifier there.",
          "Values may be stored as strings even when they represent JSON or other structured content; inspect each variable `type` before reusing it."
        ]
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idapp": {
                "type": "string"
              }
            },
            "additionalProperties": false,
            "required": [
              "idapp"
            ]
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "ej7qaujbd",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idapp": "00000000-0000-0000-0000-000000000001"
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "15034cf9-4c94-43ba-bc7a-3d762f62d7ff",
      "rowkey": 246,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/app/variables/idapp",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "App vars",
      "description": "Get application variables by idapp",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "",
      "code": "fnGetAppVarsByIdApp",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.724Z",
      "updatedAt": "2025-11-22T00:11:42.106Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "system_health_stats",
        "title": "System Health Stats",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns a compact health snapshot of the OpenFusionAPI system: total apps, total endpoints (enabled and MCP-enabled), and recent error metrics grouped by HTTP status code. Very small payload — ideal as a first call to orient an agent before deeper exploration. The 'last_hours' parameter controls the time window for log metrics (default: 1 hour).",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A",
        "exampleRequest": {
          "last_hours": 1
        },
        "notes": [
          "Use this as a quick health snapshot before running heavier inspection tools.",
          "The response is summary-oriented: it helps detect recent failures and MCP exposure counts, but it does not replace detailed log inspection."
        ]
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "title": "SystemHealthStatsRequest",
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "last_hours": {
                "type": "integer",
                "minimum": 1,
                "maximum": 72,
                "default": 1,
                "description": "Time window in hours for log metrics. Default is 1."
              }
            }
          }
        },
        "out": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "timestamp": {
                "type": "string",
                "format": "date-time"
              },
              "window_hours": {
                "type": "integer"
              },
              "apps": {
                "type": "object",
                "properties": {
                  "total": {
                    "type": "integer"
                  }
                }
              },
              "endpoints": {
                "type": "object",
                "properties": {
                  "total": {
                    "type": "integer"
                  },
                  "enabled": {
                    "type": "integer"
                  },
                  "mcp_enabled": {
                    "type": "integer"
                  }
                }
              },
              "logs": {
                "type": "object",
                "properties": {
                  "total_in_window": {
                    "type": "integer"
                  },
                  "errors_in_window": {
                    "type": "integer"
                  },
                  "by_status_code": {
                    "type": "object",
                    "additionalProperties": {
                      "type": "integer"
                    }
                  }
                }
              }
            }
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": true,
            "key": "last_hours",
            "value": "1",
            "_id": "health01",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "b1c2d3e4-f5a6-7890-abcd-ef1234567893",
      "rowkey": 889,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/system/health/stats",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "System Health Stats",
      "description": "Compact health snapshot: apps, endpoints, and recent error metrics.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "health,stats,system,monitoring",
      "code": "fnGetSystemHealthStats",
      "cache_time": 0,
      "createdAt": "2026-04-30T12:00:00.000Z",
      "updatedAt": "2026-04-30T12:00:00.000Z"
    },
    {
      "ctrl": {
        "admin": true,
        "users": [],
        "log": {
          "status_info": 1,
          "status_success": 1,
          "status_redirect": 1,
          "status_client_error": 2,
          "status_server_error": 3
        }
      },
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "upsert_text_endpoint_handler",
        "title": "UPSERT TEXT Endpoint",
        "description": "WRITE OPERATION: This tool modifies persistent data or runtime system state. Use only with explicit user authorization.\nPrecondition: Confirm user intent before execution and provide exact target identifiers.\nCreates or updates TEXT endpoints using a simplified payload for plain text plus MIME metadata. Internally maps the input into endpoint_upsert with handler=TEXT.",
        "operation_mode": "write",
        "requires_explicit_confirmation": true,
        "side_effects": "May create, update, delete, restore, migrate, or invalidate application resources.",
        "safe_alternative": "Use a read-only catalog/search/status tool first to verify target ids and scope."
      },
      "json_schema": {
        "in": {
          "enabled": true,
          "schema": {
            "type": "object",
            "properties": {
              "idendpoint": {
                "type": "string",
                "format": "uuid",
                "description": "Endpoint identifier. Omit for INSERT; provide for UPDATE."
              },
              "enabled": {
                "type": "boolean",
                "description": "Whether the endpoint should be enabled."
              },
              "idapp": {
                "type": "string",
                "format": "uuid",
                "description": "UUID of the target application."
              },
              "environment": {
                "type": "string",
                "enum": [
                  "dev",
                  "qa",
                  "prd"
                ],
                "description": "Target environment."
              },
              "timeout": {
                "type": "integer",
                "minimum": 0,
                "description": "Execution timeout in seconds."
              },
              "resource": {
                "type": "string",
                "minLength": 1,
                "maxLength": 300,
                "description": "HTTP resource path, for example /download/readme."
              },
              "method": {
                "type": "string",
                "enum": [
                  "GET",
                  "POST",
                  "PUT",
                  "PATCH",
                  "DELETE",
                  "OPTIONS",
                  "HEAD"
                ],
                "description": "HTTP method for the endpoint."
              },
              "access": {
                "type": "integer",
                "enum": [
                  0,
                  1,
                  2,
                  3,
                  4
                ],
                "description": "Access level."
              },
              "title": {
                "type": "string",
                "maxLength": 200,
                "description": "Human-readable endpoint title."
              },
              "description": {
                "type": "string",
                "description": "Endpoint purpose description."
              },
              "price_by_request": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per request in millicents."
              },
              "price_kb_request": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per request KB in millicents."
              },
              "price_kb_response": {
                "type": "integer",
                "minimum": 0,
                "description": "Cost per response KB in millicents."
              },
              "keywords": {
                "type": "string",
                "description": "Search keywords."
              },
              "ctrl": {
                "$ref": "#/$defs/jsonValue"
              },
              "text": {
                "type": "string",
                "description": "Plain text content to store in endpoint_upsert.code."
              },
              "mimeType": {
                "type": "string",
                "description": "MIME type stored in custom_data.mimeType, for example text/plain or application/json."
              },
              "fileName": {
                "type": "string",
                "description": "Optional downloadable file name stored in custom_data.fileName."
              },
              "custom_data": {
                "$ref": "#/$defs/jsonValue",
                "description": "Optional extra custom_data merged with mimeType/fileName."
              },
              "cors": {
                "$ref": "#/$defs/jsonValue"
              },
              "cache_time": {
                "type": "integer",
                "minimum": 0,
                "description": "Cache time in seconds."
              },
              "mcp": {
                "$ref": "#/$defs/jsonValue"
              },
              "json_schema": {
                "$ref": "#/$defs/jsonValue"
              },
              "headers_test": {
                "$ref": "#/$defs/jsonValue"
              },
              "data_test": {
                "$ref": "#/$defs/jsonValue"
              }
            },
            "additionalProperties": false,
            "required": [
              "idapp",
              "environment",
              "timeout",
              "resource",
              "method",
              "access",
              "title",
              "description",
              "price_by_request",
              "price_kb_request",
              "price_kb_response",
              "keywords",
              "text",
              "cache_time"
            ],
            "$defs": {
              "jsonValue": {
                "oneOf": [
                  {
                    "type": "object",
                    "additionalProperties": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "array",
                    "items": {
                      "$ref": "#/$defs/jsonValue"
                    }
                  },
                  {
                    "type": "string"
                  },
                  {
                    "type": "number"
                  },
                  {
                    "type": "integer"
                  },
                  {
                    "type": "boolean"
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "out": {
          "enabled": false,
          "schema": {
            "type": "object",
            "properties": {},
            "additionalProperties": true
          }
        }
      },
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "_id": "txtwrapperquery01",
            "type": 1
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {
              "idapp": "<idapp-uuid>",
              "environment": "prd",
              "resource": "/docs/readme",
              "method": "GET",
              "access": 0,
              "title": "README text",
              "description": "Exposes a text payload",
              "timeout": 30,
              "cache_time": 0,
              "price_by_request": 1,
              "price_kb_request": 1,
              "price_kb_response": 1,
              "keywords": "text,content",
              "text": "hello world",
              "mimeType": "text/plain"
            }
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": [],
          "urlencoded": []
        },
        "headers": [],
        "auth": {
          "selection": 0,
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          }
        },
        "last_response": {
          "data": "",
          "sizeKBResponse": -1
        }
      },
      "idendpoint": "3a91a3d2-7485-4f66-a85c-1c0e4972b7e1",
      "rowkey": 889,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/api/endpoint/text",
      "method": "POST",
      "handler": "JS",
      "access": 3,
      "title": "UPSERT TEXT Handler Endpoint",
      "description": "Create or modify in OpenFusion API an endpoint that stores plain text content (TEXT handler).",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "text,endpoint",
      "code": "const uF = uFetchAutoEnv.auto('/api/system/api/endpoint/auto', true);\nconst body = request.body || {};\nconst auth = request?.headers?.authorization || request?.headers?.Authorization || '';\nconst custom_data = (body.custom_data && typeof body.custom_data === 'object') ? { ...body.custom_data } : {};\n\nif (typeof body.mimeType === 'string' && body.mimeType.trim().length > 0) {\n  custom_data.mimeType = body.mimeType;\n} else if (!custom_data.mimeType) {\n  custom_data.mimeType = 'text/plain';\n}\n\nif (typeof body.fileName === 'string' && body.fileName.trim().length > 0) {\n  custom_data.fileName = body.fileName;\n}\n\nconst data = {\n  ...body,\n  handler: 'TEXT',\n  code: body.text ?? body.code ?? '',\n  custom_data,\n};\n\ndelete data.text;\ndelete data.mimeType;\ndelete data.fileName;\n\nconst req1 = await uF.post({ data, headers: auth ? { authorization: auth } : undefined });\nconst resp = await req1.json();\n$_RETURN_DATA_ = resp;",
      "cache_time": 0,
      "createdAt": "2026-05-19T12:00:00.000Z",
      "updatedAt": "2026-05-19T12:00:00.000Z"
    },
    {
      "ctrl": {},
      "cors": {},
      "mcp": {
        "enabled": true,
        "name": "system_interval_tasks_byidapp_prd",
        "title": "Get System Interval Tasks By IdApp (PRD)",
        "description": "READ ONLY: This tool does not modify persistent data.\nUsage: Safe for diagnostics, discovery, and analysis workflows.\nReturns interval tasks for a specific application (idapp) in the system application on prd environment.",
        "operation_mode": "read",
        "requires_explicit_confirmation": false,
        "side_effects": "No persistent write side effects expected.",
        "safe_alternative": "N/A"
      },
      "json_schema": {},
      "custom_data": {},
      "headers_test": {},
      "data_test": {
        "query": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "body": {
          "selection": 0,
          "json": {
            "code": {}
          },
          "xml": {
            "code": ""
          },
          "text": {
            "value": ""
          },
          "form": {}
        },
        "headers": [
          {
            "enabled": false,
            "key": "",
            "value": "",
            "internal_hash_row": "c5c647b00670bea65a11ab75bf3c77407cc89d1e12a5a013b5fa8146d30f9368"
          }
        ],
        "auth": {
          "basic": {
            "username": "",
            "password": ""
          },
          "bearer": {
            "token": ""
          },
          "selection": 0
        }
      },
      "idendpoint": "71cfbad5-cf5f-4d64-a952-1a52af0bf26b",
      "rowkey": 54,
      "enabled": true,
      "idapp": "cfcd2084-95d5-65ef-66e7-dff9f98764da",
      "environment": "prd",
      "timeout": 30,
      "resource": "/interval_tasks/byidapp",
      "method": "GET",
      "handler": "FUNCTION",
      "access": 2,
      "title": "Get interval tasks by app",
      "description": "Get interval tasks by idapp in system/prd.",
      "price_by_request": 1,
      "price_kb_request": 1,
      "price_kb_response": 1,
      "keywords": "interval_tasks,byidapp,system,prd",
      "code": "fnGetIntervalTasksByIdApp",
      "cache_time": 0,
      "createdAt": "2025-11-21T22:04:52.726Z",
      "updatedAt": "2026-07-13T17:27:59.812Z"
    }
  ]
}