import { EventEmitter } from "node:events";
import { DataTypes } from "sequelize";
import dbsequelize from "./sequelize.js";
import { v4 as uuidv4 } from "uuid";
import { emitHook } from "../server/utils.js";
import { validateAppName } from "../server/validation.js";

const { TABLE_NAME_PREFIX_API } = process.env;
const IS_MSSQL = ["mssql", "sqlite"].includes(dbsequelize.getDialect());
const uuidRegex =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JSON_TYPE = IS_MSSQL
  ? DataTypes.TEXT
  : DataTypes.JSON;

export const ModelNames = {
  LogEntry: prefixTableName("log"),
  User: prefixTableName("user"),
  Application: prefixTableName("application"),
  Endpoint: prefixTableName("endpoint"),
  EndpointBackup: prefixTableName("endpoint_bkp"),
  IntervalTask: prefixTableName("intervaltask"),
  Method: prefixTableName("method"),
  //Handler: prefixTableName("handler"),
  Demo: prefixTableName("demo"),
  AppVars: prefixTableName("appvars"),
  UserProfile: prefixTableName("user_profile"),
  SystemUserProfile: prefixTableName("system_user_profiles"),
  UserProfileEndpoint: prefixTableName("user_profile_endpoints"),
  ApiClient: prefixTableName("api_client"),
  ApiKey: prefixTableName("api_key"),
  ClientWallet: prefixTableName("client_wallet"),
  WalletMovement: prefixTableName("wallet_movement"),
  ApiUsageLog: prefixTableName("api_usageLog"),
  ClientBalance: prefixTableName("client_balance"),
  ClientTransactions: prefixTableName("client_transactions"),
  Bot: prefixTableName("bot"),
  BotBackup: prefixTableName("bot_bkp"),
};

const default_json_schema = {
  in: {
    enabled: false,
    schema: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
  },
  out: {
    enabled: false,
    schema: {
      type: "object",
      properties: {},
      additionalProperties: true,
    },
  },
};


export default class ModelHooks extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Notifies about a change in a database model.
   * @param {Object} data - Notification data.
   * @param {Object|Object[]} data.instance - The Sequelize instance(s) affected.
   * @param {string} data.table - The name of the table/model.
   * @param {string} data.action - The hook action (e.g., afterUpsert, afterCreate).
   * @param {string} [data.schema] - The database schema.
   */
  notify(data) {
    if (!data || !data.instance) return;

    // Handle both single instance and array of instances (bulk)
    let instance = Array.isArray(data.instance) ? data.instance[0] : data.instance;
    if (!instance) return;

    try {
      const sequelize = instance.sequelize || dbsequelize;
      const config = sequelize?.config || {};

      // Convert instance to plain object to avoid circular references and overhead
      const plainData =
        typeof instance.get === "function"
          ? instance.get({ plain: true })
          : typeof instance.toJSON === "function"
            ? instance.toJSON()
            : instance;

      const dataHook = {
        host: config.host || "localhost",
        database: config.database || "unknown",
        schema: data.schema || "",
        model: data.table || "unknown",
        action: data.action || "unknown",
        data: plainData,
      };

      super.emit("hook", dataHook);
    } catch (error) {
      console.error("Error in ModelHooks.notify:", error);
    }
  }
}

export const modelHooks = new ModelHooks();

// Register a listener for external webhooks to decouple them from DB operations
modelHooks.on("hook", async (data) => {
  try {
    await emitHook(data);
  } catch (error) {
    console.error("Error emitting external webhook:", error);
  }
});

// Global hooks to automate notifications for all models
const IGNORED_MODELS_FOR_HOOKS = [ModelNames.LogEntry, ModelNames.ApiUsageLog];

const globalNotify = (action) => (instance, options) => {
  // Get model name (which is the prefixed table name in this project)
  const modelName = instance?.constructor?.name;

  if (!modelName || IGNORED_MODELS_FOR_HOOKS.includes(modelName)) {
    return;
  }

  modelHooks.notify({
    instance,
    table: modelName,
    action: action,
  });
};

// Register global hooks to the sequelize instance
dbsequelize.addHook("afterCreate", globalNotify("afterCreate"));
dbsequelize.addHook("afterUpdate", globalNotify("afterUpdate"));
dbsequelize.addHook("afterDestroy", globalNotify("afterDestroy"));

// afterUpsert has a slightly different signature in some Sequelize versions
dbsequelize.addHook("afterUpsert", (instance, options) => {
  const target = Array.isArray(instance) ? instance[0] : instance;
  globalNotify("afterUpsert")(target, options);
});

class JSON_ADAPTER {
  constructor() { }

  static getData(instance, fieldName, defaultValue = {}) {
    let data = instance.getDataValue(fieldName) ?? defaultValue;

    if (JSON_ADAPTER._isMsSql() && JSON_ADAPTER._isString(data)) {
      try {
        data = JSON.parse(data);
      } catch (error) {
        // If it's not valid JSON, return as is or return default if empty
        return data || defaultValue;
      }
    }

    return data;
  }

  static setData(instance, fieldName, value, defaultValue = {}) {
    const data = value ?? defaultValue;

    const new_data =
      JSON_ADAPTER._isMsSql() && !JSON_ADAPTER._isString(data)
        ? JSON.stringify(data)
        : data;
    instance.setDataValue(fieldName, new_data);
  }

  static _isMsSql() {
    return IS_MSSQL;
  }

  static _isString(data) {
    return typeof data === "string";
  }
  static _isObject(data) {
    return typeof data === "object";
  }
}

/**
 * Helper to define a JSON field with consistent getter/setter logic
 * @param {string} fieldName 
 * @param {object} options 
 */
function jsonField(fieldName, options = {}) {
  const { comment = "", defaultValue = {} } = options;
  return {
    type: JSON_TYPE,
    comment,
    get() {
      return JSON_ADAPTER.getData(this, fieldName, defaultValue);
    },
    set(value) {
      JSON_ADAPTER.setData(this, fieldName, value, defaultValue);
    },
  };
}

function ensureUUID(instance, field) {
  if (!instance[field]) instance[field] = uuidv4();
}

function randomRowKey(instance) {
  instance.rowkey = Math.floor(Math.random() * 1000);
}

/**
 * @param {string} table_name
 */
export function prefixTableName(table_name) {
  return (TABLE_NAME_PREFIX_API || "ofapi") + "_" + table_name;
}


// Definir el modelo de la tabla 'User'
export const User = dbsequelize.define(
  ModelNames.User,
  {
    iduser: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      unique: true,
    },
    rowkey: {
      type: DataTypes.SMALLINT,
      defaultValue: 0,
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    username: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
    },
    password: {
      type: DataTypes.STRING,
    },
    first_name: {
      type: DataTypes.STRING,
    },
    last_name: {
      type: DataTypes.STRING,
    },
    email: {
      type: DataTypes.STRING,
    },
    change_password: { type: DataTypes.BOOLEAN, defaultValue: true },
    start_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: "2000-01-01",
      comment: "User validity start date.",
    },
    end_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: "9999-12-31",
      comment: "End of validity date of the user.",
    },
    ctrl: jsonField("ctrl", { comment: "Attributes that can be used for access control" }),
    custom_data: jsonField("custom_data", { comment: "User custom data" }),
    exp_time: {
      type: DataTypes.BIGINT,
      defaultValue: 3600,
      comment: "Token expiration time",
    },
    last_login: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    freezeTableName: true,
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["username"],
      },
    ],
    hooks: {
      beforeUpdate: (instance) => {
        randomRowKey(instance);
      },
    },
  },
);

// Definir el modelo de la tabla 'Method'
export const Method = dbsequelize.define(
  ModelNames.Method,
  {
    method: {
      type: DataTypes.STRING(10),
      primaryKey: true,
      allowNull: false,
      unique: true,
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    label: {
      type: DataTypes.STRING(10),
      unique: true,
      allowNull: false,
    },
  },
  {
    freezeTableName: true,
    timestamps: true,
    indexes: [],
    hooks: {},
  },
);

/*
// Definir el modelo de la tabla 'Handler'
export const Handler = dbsequelize.define(
  ModelNames.Handler,
  {
    handler: {
      type: DataTypes.STRING(25),
      primaryKey: true,
      allowNull: false,
      unique: true,
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    label: {
      type: DataTypes.STRING(25),
      unique: true,
      allowNull: false,
    },

    icon_class: {
      type: DataTypes.STRING(25),
      unique: false,
      allowNull: true,
    },

    color_class: {
      type: DataTypes.STRING(25),
      unique: false,
      allowNull: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    freezeTableName: true,
    timestamps: true,
    indexes: [],
    hooks: {
      afterUpsert: async (instance) => {
        modelHooks.notify({
          instance,
          table: ModelNames.Handler,
          action: "afterUpsert",
        });
      },
    },
  },
);
*/

// Definir el modelo de la tabla 'App'

export const Application = dbsequelize.define(
  ModelNames.Application,
  {
    idapp: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      unique: true,
      defaultValue: DataTypes.UUIDV4,
    },
    app: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      // ✅ Garantiza minúsculas SIEMPRE que se asigne app (create/update/upsert)
      set(value) {
        // si viene null/undefined, deja que allowNull:false/validations lo manejen
        if (value === null || value === undefined) {
          this.setDataValue("app", value);
          return;
        }
        this.setDataValue("app", String(value).toLowerCase());
      },
    },
    rowkey: {
      type: DataTypes.SMALLINT,
      defaultValue: 0,
    },
    iduser: { type: DataTypes.BIGINT, comment: "User creator" },
    enabled: { type: DataTypes.BOOLEAN, defaultValue: true, allowNull: false },
    description: {
      type: DataTypes.TEXT,
    },
    jwt_key: {
      type: DataTypes.UUID,
      allowNull: true,
      defaultValue: DataTypes.UUIDV4,
      comment: "Security key to generate JWT for the application",
    },
    vars: jsonField("vars"),
    params: jsonField("params"),
  },
  {
    freezeTableName: true,
    timestamps: true,
    indexes: [],
    hooks: {
      /**
       * In Sequelize v6, beforeUpsert receives raw values as a plain object instead of a Model instance.
       * @param {object} values - Plain object containing fields to insert/update.
       */
      beforeUpsert: (values) => {
        if (values.app && !validateAppName(values.app)) {
          throw new Error("The application name cannot be empty or invalid.");
        }
      },
      beforeValidate: (instance) => {
        randomRowKey(instance);
      },
    },
  },
);

// ============================================
// MODELO AppVars
// ============================================
export const AppVars = dbsequelize.define(
  ModelNames.AppVars,
  {
    idvar: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      unique: true,
      defaultValue: DataTypes.UUIDV4,
    },
    idapp: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: ModelNames.Application,
        key: "idapp",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    name: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING(25),
      allowNull: false,
      defaultValue: "json",
    },
    environment: {
      type: DataTypes.STRING(10),
      allowNull: false,
    },
    value: jsonField("value", { allowNull: true }),
  },
  {
    freezeTableName: true,
    timestamps: true,

    // ✔ Necesario para que Sequelize reconozca correctamente el índice único
    uniqueKeys: {
      unique_av_combo: {
        fields: ["idapp", "name", "environment"],
      },
    },

    indexes: [
      {
        fields: ["idapp", "name", "environment"],
        name: "idx_av_id_n_e",
        //  unique: true,
      },
      {
        fields: ["idapp"],
        name: "idx_av_idapp",
      },
    ],

    hooks: {},
  },
);

export const EndpointBackup = dbsequelize.define(
  ModelNames.EndpointBackup,
  {
    idbackup: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    idendpoint: {
      type: DataTypes.UUID,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
    },
    hash: {
      type: DataTypes.CHAR(128), // O STRING(128)
      allowNull: false,
      comment: "Hash of the backup data for quick comparison",
    },
    data: jsonField("data", { comment: "Endpoint data backup" }),
  },
  {
    freezeTableName: true,
    timestamps: true,
    // ✅ AGREGAR ESTO: Restricción única compuesta
    indexes: [
      {
        unique: true, // ← ¡CRÍTICO!
        fields: ["idendpoint", "hash"],
        name: "unique_endpoint_hash",
      },
      { fields: ["idendpoint"] }, // Índice adicional para búsquedas
    ],
    hooks: {
      beforeValidate: (instance) => {
        //
      },
    },
  },
);

export const Endpoint = dbsequelize.define(
  ModelNames.Endpoint,
  {
    idendpoint: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      unique: true,
      defaultValue: DataTypes.UUIDV4,
      set(value) {

        if (!value || !uuidRegex.test(value)) {
          this.setDataValue("idendpoint", uuidv4());
        } else {
          this.setDataValue("idendpoint", value);
        }
      },
    },
    rowkey: {
      type: DataTypes.SMALLINT,
      defaultValue: 0,
    },
    enabled: { type: DataTypes.BOOLEAN, defaultValue: true, allowNull: false },
    idapp: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Application,
        key: "idapp",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    environment: {
      type: DataTypes.STRING(4),
      allowNull: false,
      defaultValue: "dev",
      comment: "Environment where it will be available. dev, qa, prd.",
      // ✅ Garantiza minúsculas SIEMPRE que se asigne environment (create/update/upsert)
      set(value) {
        // si viene null/undefined, deja que allowNull:false/validations lo manejen
        if (value === null || value === undefined) {
          this.setDataValue("environment", value);
          return;
        }
        this.setDataValue("environment", String(value).toLowerCase());
      },
    },
    timeout: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 30, comment: 'Maximum time the endpoint has to complete its execution' },
    resource: {
      type: DataTypes.STRING(300),
      allowNull: false,
      // ✅ Garantiza minúsculas SIEMPRE que se asigne resource (create/update/upsert)
      set(value) {
        // si viene null/undefined, deja que allowNull:false/validations lo manejen
        if (value === null || value === undefined) {
          this.setDataValue("resource", value);
          return;
        }
        this.setDataValue("resource", String(value).toLowerCase());
      },
      comment: "Endpoint path.",
    },
    method: {
      type: DataTypes.STRING(10),
      allowNull: false,
      // ✅ Garantiza mayusculas SIEMPRE que se asigne method (create/update/upsert)
      set(value) {
        // si viene null/undefined, deja que allowNull:false/validations lo manejen
        if (value === null || value === undefined) {
          this.setDataValue("method", value);
          return;
        }
        this.setDataValue("method", String(value).toUpperCase());
      },
      comment: "HTTP Method",
    },
    handler: {
      type: DataTypes.STRING(15),
      allowNull: false,
    },
    access: {
      type: DataTypes.SMALLINT,
      allowNull: false,
      defaultValue: 2,
      comment:
        "Indicates if access is: 0 - Public, 1 - Basic, 2 - Token, 3 - Basic and Token, 4 - Local (Uso solo desde localhost)",
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
      defaultValue: "",
      comment: "Short description of the endpoint. 200 characters max.",
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "",
    },
    price_by_request: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: "Cost per request (millicents)",
    },
    price_kb_request: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: "Cost per KB request (millicents)",
    },
    price_kb_response: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: "Cost per KB response (millicents)",
    },
    keywords: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "",
    },
    ctrl: jsonField("ctrl", { comment: "Additional controls. Users, Logs, etc." }),
    code: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "",
      comment: "Code and parameters",
    },
    cors: jsonField("cors", { allowNull: true }),
    cache_time: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment:
        "Time in which the data will be kept in cache. Zero to disable the cache.",
    },
    mcp: jsonField("mcp", { allowNull: true }),
    json_schema: {
      type: JSON_TYPE,
      allowNull: true,
      defaultValue: IS_MSSQL ? JSON.stringify(default_json_schema) : default_json_schema,
      get() {
        return JSON_ADAPTER.getData(this, "json_schema", default_json_schema);
      },
      set(value) {
        const data = value ?? default_json_schema;

        if (typeof data === "string") {
          try {
            const parsed = JSON.parse(data);
            JSON_ADAPTER.setData(this, "json_schema", parsed, default_json_schema);
          } catch (error) {
            throw new Error("The field 'json_schema' must contain valid JSON.");
          }
          return;
        }

        JSON_ADAPTER.setData(this, "json_schema", data, default_json_schema);
      },
    },
    custom_data: jsonField("custom_data", { allowNull: true }),
    headers_test: jsonField("headers_test", { allowNull: true }),
    data_test: jsonField("data_test", { allowNull: true }),
  },
  {
    freezeTableName: true,
    timestamps: true,
    // ✔ Necesario para que Sequelize reconozca correctamente el índice único
    uniqueKeys: {
      unique_av_combo: {
        fields: ["idapp", "environment", "resource", "method"],
      },
    },
    indexes: [
      {
        //  unique: true,
        fields: ["idapp", "environment", "resource", "method"],
      },
    ],
    hooks: {
      beforeValidate: (instance) => {
        randomRowKey(instance);
        if (
          instance.handler == "FUNCTION" &&
          (!instance.code || instance.code.length < 1)
        ) {
          throw Error(
            "The handle FUNCTION must be associated with a function; it cannot be empty.",
          );
        }

        if (typeof instance.code == "object") {
          instance.code = JSON.stringify(instance.code);
        }
      },
      beforeBulkCreate: (instance) => {
        randomRowKey(instance);
      },
    },
  },
);

export const LogEntry = dbsequelize.define(
  ModelNames.LogEntry,
  {
    // 1. Añadimos la columna 'id' como clave primaria auto-incremental
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      unique: true,
      defaultValue: DataTypes.UUIDV4,
    },
    trace_id: {
      type: DataTypes.UUID,
      allowNull: true,
      unique: false,
      defaultValue: DataTypes.UUIDV4,
      comment: "Trace ID of the request",
    },
    timestamp: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: "Registration date",
    },
    idapp: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: "idapp uuid",
    },
    idendpoint: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: "idendpoint uuid",
    },
    idclient: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: "idclient uuid",
    },
    iduser: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: "ID System user",
    },
    url: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "url request",
    },
    method: {
      type: DataTypes.STRING(15),
      allowNull: true,
      comment: "Method request",
    },
    status_code: {
      type: DataTypes.SMALLINT,
      allowNull: true,
      defaultValue: 0,
      comment: "Response Status Code",
    },
    // Niveles de log: 1 (Basic), 2 (Normal), 3 (Full)
    log_level: {
      type: DataTypes.SMALLINT,
      allowNull: true,
      defaultValue: 1,
      comment: "Log Level: 1=Basic, 2=Normal, 3=Full",
    },

    price_by_request: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: "Cost per request (millicents)",
    },
    price_kb_request: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: "Cost per KB request (millicents)",
    },
    price_kb_response: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: "Cost per KB response (millicents)",
    },
    cost_total: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      comment: "Total cost (millicents)",
    },
    user_agent: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "",
    },
    client: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Host client",
    },
    req_headers: jsonField("req_headers", { comment: "Request Headers" }),
    res_headers: jsonField("res_headers", { comment: "Response Headers" }),
    query: jsonField("query"),
    body: jsonField("body"),
    params: jsonField("params"),
    response_time: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: -1,
      comment: "",
    },
    response_data: jsonField("response_data", { comment: "data" }),
    message: jsonField("message", { comment: "JSON Message log" }),
  },
  {
    freezeTableName: true,
    timestamps: false, // No necesitamos createdAt ni updatedAt para este caso
    paranoid: false, // Evita el soft delete
    comment: "Tabla de logs de la aplicación",
    hooks: {},
    indexes: [
      // 1. Búsquedas rápidas por Aplicación + Tiempo (para ver logs recientes de una app)
      {
        name: "idx_logs_idapp_timestamp",
        fields: ["idapp", "timestamp"],
      },
      // 2. Búsquedas rápidas por Endpoint + Tiempo (para ver rendimiento de un endpoint)
      {
        name: "idx_logs_idendpoint_timestamp",
        fields: ["idendpoint", "timestamp"],
      },
      // 3. Opcional: Solo por timestamp si haces limpiezas (DELETE antiguos)
      {
        name: "idx_logs_timestamp",
        fields: ["timestamp"],
      },
      // 4. Opcional: Solo por trace_id para seguimiento de peticiones
      {
        name: "idx_logs_trace_id",
        fields: ["trace_id"],
      },
      // 5. Index for status_code (error analysis)
      {
        name: "idx_logs_status_code",
        fields: ["status_code"],
      },
    ],
  },
);

export const ClientBalance = dbsequelize.define(
  ModelNames.ClientBalance,
  {
    idclient: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      comment: "ID del cliente (api) (clave foránea a tabla de clientes)",
    },
    balance: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: "Saldo disponible del cliente",
    },
    last_transaction_at: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "Fecha de la última transacción (para métricas)",
    },
  },
  {
    freezeTableName: true,
    timestamps: false,
    indexes: [
      {
        name: "idx_client_balance_idclient",
        fields: ["idclient"],
        unique: true,
      },
    ],
    comment: "Saldo actual de cada cliente. Una fila por cliente.",
    hooks: {
      beforeUpdate: (instance) => {
        instance.last_transaction_at = new Date();
      },
    },
  },
);

export const ClientTransactions = dbsequelize.define(
  ModelNames.ClientTransactions,
  {
    id: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    },
    idclient: {
      type: DataTypes.UUID,
      allowNull: false,
      comment: "Cliente al que pertenece la transacción (api)",
    },
    type: {
      type: DataTypes.ENUM("credit", "debit"),
      allowNull: false,
      comment: "'credit' = recarga, 'debit' = consumo",
    },
    amount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: "Monto positivo siempre (crédito o débito)",
      validate: {
        min: 1, // Evitar transacciones de 0
      },
    },
    balance_after: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: "Saldo después de esta transacción (para auditoría rápida)",
    },
    idlog: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: "Referencia al log que generó el débito (si aplica)",
    },
    idendpoint: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: "Endpoint consumido (para reportes)",
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: true,
      comment:
        'Ej: "Recarga manual", "Consumo GET /users", "Ajuste administrativo"',
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    freezeTableName: true,
    timestamps: false,
    indexes: [
      { fields: ["idclient"] },
      { fields: ["created_at"] },
      { fields: ["idclient", "created_at"] }, // Ideal para reportes por cliente
      { fields: ["idlog"] },
      { fields: ["type"] },
    ],
    comment: "Historial completo de movimientos de saldo (créditos y débitos)",
  },
);

export const IntervalTask = dbsequelize.define(
  ModelNames.IntervalTask,
  {
    idtask: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
      unique: true,
    },
    iduser: {
      type: DataTypes.BIGINT,
      primaryKey: false,
      autoIncrement: false,
      allowNull: true,
      unique: false,
    },
    idendpoint: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Endpoint,
        key: "idendpoint",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    },
    enabled: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },
    interval: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 300,
      comment: "Seconds interval",
    },
    datestart: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
      comment: "Start date",
    },
    dateend: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "End date",
    },
    last_run: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "Last run",
    },
    next_run: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: "Next run",
    },
    params: jsonField("params"),
    exec_time_limit: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 30,
      comment: "Execution time limit in seconds",
    },
    failed_attempts: {
      type: DataTypes.SMALLINT,
      allowNull: false,
      defaultValue: 0,
      comment: "Consecutive failed attempts. Max 3.",
    },
    status: {
      type: DataTypes.SMALLINT,
      allowNull: false,
      defaultValue: 0,
      comment: "Status of the task",
    },
    last_exec_time: {
      type: DataTypes.BIGINT,
      allowNull: true,
      comment: "Last time executed in miliseconds",
    },
    last_response: jsonField("last_response"),
    note: {
      type: DataTypes.TEXT,
      allowNull: true,
      comment: "Notes",
    },
  },
  {
    freezeTableName: true,
    timestamps: true, //
    paranoid: false, // Evita el soft delete
    comment: "App Intervals",
    hooks: {},
    indexes: [
      {
        fields: ["idendpoint"],
        name: "idx_interval_idendpoint", // Nombre del índice
        unique: false, // Índice no único
      },
    ],
  },
);

// Definir el modelo de la tabla 'demo'
export const tblDemo = dbsequelize.define(
  ModelNames.Demo,
  {
    name: {
      type: DataTypes.STRING(25),
      primaryKey: true,
      allowNull: false,
      unique: true,
    },
    label: {
      type: DataTypes.STRING(25),
      unique: true,
      allowNull: false,
    },
    json_data: jsonField("json_data"),
  },
  {
    freezeTableName: true,
    timestamps: true,
    indexes: [],
    hooks: {
      beforeValidate: (instance) => {
        //
      },
    },
  },
);

///////////
export const UserProfile = dbsequelize.define(
  ModelNames.UserProfile,
  {
    idprofile: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    startAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    endAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  { timestamps: true, freezeTableName: true },
);

export const SystemUserProfile = dbsequelize.define(
  ModelNames.SystemUserProfile,
  {
    idrelation: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    iduser: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    idprofile: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    startAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    endAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    enabled: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  { timestamps: true, freezeTableName: true },
);

////////////////////////////////////////////////////
export const ApiClient = dbsequelize.define(
  ModelNames.ApiClient,
  {
    idclient: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    username: { type: DataTypes.STRING(150), allowNull: false, unique: true },
    password: { type: DataTypes.STRING, allowNull: false }, // << corregido
    status: {
      type: DataTypes.ENUM("initial", "active", "suspended", "inactive"),
      defaultValue: "initial",
    },
    change_password: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    first_name: { type: DataTypes.STRING(200), allowNull: true },
    last_name: { type: DataTypes.STRING(200), allowNull: true },
    email: { type: DataTypes.STRING(150), allowNull: false },
    document_id: { type: DataTypes.STRING(50), allowNull: true },
    document_type: {
      type: DataTypes.ENUM(
        "passport",
        "unknown",
        "id_card",
        "driver_license",
        "tax_id",
        "social_security",
        "other",
      ),
      defaultValue: "unknown",
    },
    phone: { type: DataTypes.STRING(50), allowNull: true },
    startAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    endAt: { type: DataTypes.DATE, allowNull: true },
    custom_data: jsonField("custom_data", { comment: "User custom data" }),
    last_login: {
      type: DataTypes.DATE,
      allowNull: true, // << corregido
    },
  },
  {
    timestamps: true,
    freezeTableName: true,
    hooks: {
      beforeValidate: (instance) => {
        if (!instance.email) {
          throw new Error("The 'email' field is required.");
        }

        // Use email if not exists username
        if (!instance.username) {
          instance.username = instance.email;
        }
      },

      beforeSave: (instance) => {
        if (instance.endAt && instance.endAt < instance.startAt) {
          throw new Error("'endAt' cannot be before 'startAt'.");
        }
      },
    },
  },
);

export const ApiKey = dbsequelize.define(
  ModelNames.ApiKey,
  {
    idkey: {
      type: DataTypes.BIGINT,
      primaryKey: true,
      autoIncrement: true,
    },
    idapp: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: Application, key: "idapp" }
    },
    idclient: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: ApiClient, key: "idclient" }
    },
    enabled: { type: DataTypes.BOOLEAN, defaultValue: true },
    startAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      comment: "Fecha de inicio de la API Key",
    },
    endAt: { type: DataTypes.DATE, comment: "Fecha de expiración de la API Key" },
    token: { type: DataTypes.TEXT, allowNull: false, comment: "Token de la API Key" },
    description: { type: DataTypes.STRING(150) },
  },
  {
    timestamps: true,
    freezeTableName: true,
    hooks: {
      beforeCreate(instance) {
        if (!instance.endAt) {
          const oneYear = new Date();
          oneYear.setFullYear(oneYear.getFullYear() + 1);
          instance.endAt = oneYear;
        }
      },
    },
  },
);





//////////////////////////////////////////////////////
// ✅ Relación: Una Application tiene muchas variables
Application.hasMany(AppVars, {
  foreignKey: "idapp", // FK en AppVars
  sourceKey: "idapp", // ✅ AGREGAR: PK en Application
  as: "vrs", // Alias para incluir en queries
  onDelete: "CASCADE", // ✅ AGREGAR: Al eliminar app, elimina sus vars
  onUpdate: "CASCADE", // ✅ AGREGAR: Al actualizar idapp, actualiza en vars
});

// ✅ Relación inversa: Una Variable pertenece a una Application
AppVars.belongsTo(Application, {
  foreignKey: "idapp", // FK en AppVars
  targetKey: "idapp", // PK en Application
  as: "app", // ✅ AGREGAR: Alias para incluir en queries
});

Application.hasMany(Endpoint, { foreignKey: "idapp", as: "endpoints" });
Endpoint.belongsTo(Application, { foreignKey: "idapp" });

// Relación: Un Application tiene muchos Interval
Endpoint.hasMany(IntervalTask, { foreignKey: "idendpoint", as: "tasks" });

// Relación: Un Interval pertenece a un Endpoint
IntervalTask.belongsTo(Endpoint, {
  foreignKey: "idendpoint", // campo FK en IntervalTask
  targetKey: "idendpoint", // campo PK en Endpoint
});

// ----------------------------
// ClientBalance -> ClientTransactions
// ----------------------------
// ClientBalance tiene PK idclient. ClientTransactions tiene idclient.
// Esto te permite: incluir transacciones al consultar saldo.
ClientBalance.hasMany(ClientTransactions, {
  foreignKey: "idclient",
  sourceKey: "idclient",
  as: "transactions",
  constraints: false, // pon true si tienes tabla Client y quieres FK formal
});

ClientTransactions.belongsTo(ClientBalance, {
  foreignKey: "idclient",
  targetKey: "idclient",
  as: "balance",
  constraints: false,
});

// ----------------------------
// ClientBalance -> LogEntry (opcional pero útil)
// ----------------------------
ClientBalance.hasMany(LogEntry, {
  foreignKey: "idclient",
  sourceKey: "idclient",
  as: "logs",
  constraints: false,
});

LogEntry.belongsTo(ClientBalance, {
  foreignKey: "idclient",
  targetKey: "idclient",
  as: "clientBalance",
  constraints: false,
});

// ----------------------------
// LogEntry <-> ClientTransactions por idlog (opcional, recomendado)
// ----------------------------
// En tu diseño, un log normalmente genera 1 débito (1 transacción).
// Si en el futuro podrías generar varias transacciones por log, cambia hasOne -> hasMany.
LogEntry.hasOne(ClientTransactions, {
  foreignKey: "idlog",
  sourceKey: "id",
  as: "billingTransaction",
  constraints: false,
});

ClientTransactions.belongsTo(LogEntry, {
  foreignKey: "idlog",
  targetKey: "id",
  as: "log",
  constraints: false,
});

// ----------------------------
// ClientTransactions -> Endpoint (opcional para reportes)
// ----------------------------
Endpoint.hasMany(ClientTransactions, {
  foreignKey: "idendpoint",
  sourceKey: "idendpoint",
  as: "transactions",
  constraints: false,
});

ClientTransactions.belongsTo(Endpoint, {
  foreignKey: "idendpoint",
  targetKey: "idendpoint",
  as: "endpoint",
  constraints: false,
});

// ----------------------------
// ApiClient -> ApiKey -> Endpoint
// ----------------------------
ApiClient.hasMany(ApiKey, { foreignKey: "idclient", as: "keys" });
ApiKey.belongsTo(ApiClient, { foreignKey: "idclient", as: "client" });

Application.hasMany(ApiKey, { foreignKey: "idapp", as: "keys" });
ApiKey.belongsTo(Application, { foreignKey: "idapp", as: "app" });
