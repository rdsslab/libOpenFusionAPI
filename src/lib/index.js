import "dotenv/config";
import { EventEmitter } from "node:events";
import dns from "dns";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";

import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";

import { fileURLToPath } from "url";
import { dirname } from "path";
import Endpoint from "./server/endpoint/index.js";

import { getAllBots } from "./db/bot.js";
import { TasksInterval } from "./timer/tasks.js";
import { defaultApiClient } from "./db/apiclient.js";

import dbAPIs from "./db/sequelize.js";
import {
  defaultApps,
  getApplicationTreeByFilters,
  getApplicationEndpointByRoute,
} from "./db/app.js";
import { createLog } from "./db/log.js";
import { createFunctionVM } from "./server/createFunctionVM.js";
import { CreateMCPHandler } from "./server/endpoint/handlerBuild/mcp.js";
import { setServerListening } from "./server/utils.js";
import { defaultUser, login } from "./db/user.js";
import { defaultMethods } from "./db/method.js";
//import { defaultHandlers } from "./db/handler.js";
import {
  prefixTableName,
  User,
  Method,
  Application,
  AppVars,
  Endpoint as EndpointBBDD,
  LogEntry,
  IntervalTask,
  tblDemo,
  modelHooks
} from "./db/models.js";
import { runHandler } from "./handler/handler.js";
import { fnPublic, fnSystem } from "./server/functions/index.js";
import { OpenFusionWebsocketClient } from "./server/websocket_client.js";
import { WebSocketManager } from "./server/websocket_manager.js";

import {
  getIPFromRequest,
  getFunctionsFiles,
  getUUID,
  getAppVarsObject,
} from "./server/utils.js";
import { CreateOpenFusionAPIToken } from "./server/auth.js";
import { AuthService } from "./server/auth_service.js";

import { validateSchemaMessageWebSocket } from "./server/schemas/index.js";

import {
  //key_endpoint_method,
  struct_api_path,
  get_url_params,
  urlSystemPath,
  default_port,
  internal_url_ws,
  WebSocketValidateFormatChannelName, url_key
} from "./server/utils_path.js";

import fs from "fs";
import path from "path";
import { getSystemInfoDynamic } from "./server/systeminformation.js";
import { registerCorePlugins } from "./server/runtime/registerCorePlugins.js";
import { registerRequestLifecycle } from "./server/runtime/registerRequestLifecycle.js";
import { EndpointRuntimeService } from "./server/runtime/EndpointRuntimeService.js";
import { FunctionRegistryService } from "./server/runtime/FunctionRegistryService.js";
import { DbHookCacheInvalidationService } from "./server/runtime/DbHookCacheInvalidationService.js";
import { ServerReadyOrchestrator } from "./server/runtime/ServerReadyOrchestrator.js";
import { defaultAuthPolicy, defaultCorsPolicy } from "./server/runtime/policies.js";
import { BackgroundTaskManager } from "./server/background_tasks.js";

const DEFAULT_MAX_FILE_SIZE_UPLOAD = 100 * 1024 * 1024; // Default 100 MB
const {
  PATH_APP_FUNCTIONS,
  JWT_KEY,
  HOST,
  MAX_FILE_SIZE_UPLOAD, // Default 100 MB
} = process.env;

if (!JWT_KEY) {
  console.warn(
    "WARNING: JWT_KEY is not defined. Cookies and Tokens may not be secure.",
  );
}

const PORT = process.env.PORT || default_port;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

//import { url } from 'node:inspector';
dns.setDefaultResultOrder("ipv4first");

// Este bloque permite convertir un error a String con JSON.stringify
var config = {
  configurable: true,
  value: function () {
    var alt = {};
    var storeKey = function (/** @type {string | number} */ key) {
      // @ts-ignore
      alt[key] = this[key];
    };
    Object.getOwnPropertyNames(this).forEach(storeKey, this);
    return alt;
  },
};
Object.defineProperty(Error.prototype, "toJSON", config);
const dir_fn = path.join(process.cwd(), PATH_APP_FUNCTIONS || "fn");

////////////////////////////////////////////////////////
////////////////////////////////////////////////////////
// TODO: Poner en el header un ID request para crear una traza desde el origen de los request ya que hay endpoints que son llamados desde el localhost y se hace dificil saber quien originó la primera solicitud.
export default class ServerAPI extends EventEmitter {
  constructor({ buildDB = false } = {}) {
    super();
    this.endpoints = new Endpoint({
      dbFetcher: getApplicationTreeByFilters,
      endpointFetcher: getApplicationEndpointByRoute,
      vmFactory: createFunctionVM,
      mcpBuilder: CreateMCPHandler,
      createLog: createLog
    });
    this.functionRegistry = new FunctionRegistryService({
      endpoints: this.endpoints,
      dirFn: dir_fn,
      fs,
      getFunctionsFiles,
    });
    this.endpoints.on("log", (data) => {
      this.TasksInterval.pushLog(data);
      //      this.websocketClientEndpoint.send({ payload: data });
    });

    this.endpoints.cache.on("added", (data) => {
      this._emitEndpointEvent("cache_set", data);
    });

    this.endpoints.cache.on("expired", (data) => {
      this._emitEndpointEvent("cache_released", data);
    });

    this.SERVER_DATE_START;

    this.websocketClientEndpoint = new OpenFusionWebsocketClient(
      internal_url_ws(urlSystemPath.Websocket.EventServer),
      {},
      { autoConnect: false }, // connect only after fastify.listen() resolves
    );

    this.TasksInterval = new TasksInterval();

    this.dbHookCacheInvalidation = new DbHookCacheInvalidationService({
      endpoints: this.endpoints,
      deleteEndpointsByAppName: (appName) => this._deleteEndpointsByAppName(appName),
      applicationModel: prefixTableName("application"),
      appvarsModel: prefixTableName("appvars"),
      endpointModel: prefixTableName("endpoint"),
      appInvalidateDelayMs: 5000,
    });

    modelHooks.on("hook", async (data) => {
      this.dbHookCacheInvalidation.handleHookData(data);
      this._emitEndpointEvent("database_hook", data);
    });

    this.maxBodyBytes =
      (parseInt(MAX_FILE_SIZE_UPLOAD, 10) * 1024 * 1024) ||
      DEFAULT_MAX_FILE_SIZE_UPLOAD;

    this.fastify = Fastify({
      logger: false,
      bodyLimit: this.maxBodyBytes,
    });

    this.fastify.addHttpMethod("QUERY", { hasBody: true });

    this._build();
  }

  async checkwebHookDB(request) {
    this.dbHookCacheInvalidation.handleHookData(request?.body);
    this._emitEndpointEvent("database_hook", request?.body);
  }

  async _build() {
    const www_dir = "www";
    const rutaDirectorio = path.join(process.cwd(), www_dir);

    await registerCorePlugins({
      fastify: this.fastify,
      maxBodyBytes: this.maxBodyBytes,
      jwtKey: JWT_KEY,
      wwwDirPath: rutaDirectorio,
      plugins: {
        formbody,
        multipart,
        cookie,
        cors,
        websocket,
        fastifyStatic,
        fs,
      },
      corsConfig: {
        // Reflect the caller origin by default so credentialed requests stay CORS-compliant.
        // Deployments that need a narrower policy can still override this with corsPolicy.
        origin: (origin, cb) => {
          if (!origin) {
            cb(null, false);
            return;
          }

          cb(null, origin);
        },
        credentials: true,
        allowedHeaders: ["Content-Type", "Authorization"],
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "QUERY"],
      },
      corsPolicy: defaultCorsPolicy,
    });

    this.webSocketManager = new WebSocketManager(this.fastify);

    await this.buildDB();
    this.loadFunctionFiles();
    this._addFunctions();

    const endpointRuntimeService = new EndpointRuntimeService({
      serverApi: this,
      endpoints: this.endpoints,
      getUUID,
      getURLParams: get_url_params,
      authService: AuthService,
      runHandler,
      getIPFromRequest,
      emitEndpointEvent: (event_name, data) => {
        this._emitEndpointEvent(event_name, data);
      },
      authPolicy: defaultAuthPolicy,
    });

    registerRequestLifecycle({
      fastify: this.fastify,
      structApiPath: struct_api_path,
      endpointRuntimeService,
    });

    this.webSocketManager.registerRoutes();

    this.SERVER_DATE_START = Date.now();

    const host = HOST || "localhost";

    console.log(
      `Listen on PORT ${PORT} and HOST ${host}`,
      __dirname,
      PORT,
      PATH_APP_FUNCTIONS,
      JWT_KEY,
      HOST,
    );

    await this.fastify.listen({ port: PORT, host: host });
    setServerListening(true);

    this._runOnReady();
  }

  _emitEndpointEvent(event_name, data) {
    this.websocketClientEndpoint.send({
      channel: "/server/events",
      payload: {
        event_name: event_name,
        timestamp: new Date(),
        data: data,
      },
    });
  }

  async _runOnReady() {
    const readyOrchestrator = new ServerReadyOrchestrator({
      websocketClientEndpoint: this.websocketClientEndpoint,
      tasksInterval: this.TasksInterval,
      backgroundTaskFactory: () => new BackgroundTaskManager(this),
    });

    readyOrchestrator.start();
  }


  _addFunctions() {
    this.functionRegistry.addBuiltInFunctions(fnSystem, fnPublic);
  }

  _deleteEndpointsByAppName(app_name) {
    this.endpoints.deleteApp(app_name);
  }

  loadFunctionFiles() {
    this.functionRegistry.loadFunctionFiles();
  }

  /**
   * @param {string} filePath
   * @param {string} _app_name
   * @param {string} environment
   */
  async _appendFunctionsFiles(file_app, _app_name, environment) {
    return this.functionRegistry.appendFunctionsFile(
      file_app,
      _app_name,
      environment,
    );
  }

  _appendAppFunction(appname, environment, functionName, fn) {
    this.functionRegistry.appendAppFunction(appname, environment, functionName, fn);
  }

  /**
   * @param {string} appName
   * @param {string} [environment]
   */
  _getFunctions(appName, environment) {
    return this.functionRegistry.getFunctions(appName, environment);
  }

  /**
   * @param {boolean} buildDB
   */
  async buildDB() {
    const logPath = path.join(process.cwd(), "temporales", "database_init.log");
    const log = (msg, err = null) => {
      const timestamp = new Date().toISOString();
      const errStr = err ? `\nError: ${err.message || err}\nStack: ${err.stack || ""}` : "";
      const line = `[${timestamp}] ${msg}${errStr}\n`;
      console.log(msg, err || "");
      try {
        fs.appendFileSync(logPath, line, "utf8");
      } catch (e) {
        // ignore
      }
    };

    let buildDBEnv = process.env.BUILD_DB;
    log(`DEBUG: buildDBEnv value is: ${buildDBEnv}`);
    let buildDB =
      buildDBEnv && buildDBEnv.toString().toUpperCase() == "TRUE"
        ? true
        : false;

    if (buildDB) {
      log("Crea la base de datos");

      try {
        if (dbAPIs.getDialect() === "sqlite") {
          const appTable = prefixTableName("application");
          const backupTable = `${appTable}_backup`;

          log("PRAGMA foreign_keys = OFF");
          await dbAPIs.query("PRAGMA foreign_keys = OFF;");

          log(`DROP TABLE IF EXISTS \`${backupTable}\``);
          await dbAPIs.query(`DROP TABLE IF EXISTS \`${backupTable}\`;`);

          try {
            log("Ensuring app uniqueness by removing duplicate app entries");
            await dbAPIs.query(
              `DELETE FROM \`${appTable}\`
                  WHERE rowid NOT IN (
                    SELECT MIN(rowid)
                    FROM \`${appTable}\`
                    GROUP BY LOWER(app)
                  );`,
            );
          } catch (error) {
            log("First boot may not have the application table yet (skipped uniqueness query).");
          }
        }

        try {
          log("Running dbAPIs.sync({ alter: true })...");
          await dbAPIs.sync({ alter: true });
          log("Database created or updated successfully with alter: true.");
        } catch (alterError) {
          log("WARNING: sync({ alter: true }) failed, attempting fallback sync().", alterError);
          // Fallback to normal sync to ensure missing tables are created
          await dbAPIs.sync();
          log("Database tables created successfully using fallback sync().");
        }
      } catch (error) {
        log("Error creating database tables:", error);
      } finally {
        if (dbAPIs.getDialect() === "sqlite") {
          try {
            log("PRAGMA foreign_keys = ON");
            await dbAPIs.query("PRAGMA foreign_keys = ON;");
          } catch (err) {
            log("Failed to restore foreign keys:", err);
          }
        }
      }
    }

    /*
    try {
      await defaultHandlers();
    } catch (error) {
      console.log(error);
    }
    */

    try {
      await defaultMethods();
    } catch (error) {
      console.log(error);
    }

    try {
      await defaultUser();
    } catch (error) {
      console.log(error);
    }

    try {
      await defaultApiClient();
    } catch (error) {
      console.log(error);
    }

    try {
      await defaultApps();
    } catch (error) {
      console.log(error);
    }

    // Crea un token para tener acceso a los endpoints protegidos
    CreateOpenFusionAPIToken();

    return true;
  }
}
