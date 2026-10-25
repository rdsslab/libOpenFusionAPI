import { DataTypes } from "sequelize";
import dbsequelize from "./sequelize.js";
import { prefixTableName } from "./models.js";

const JSON_TYPE = ["mssql", "sqlite"].includes(dbsequelize.getDialect())
  ? DataTypes.TEXT
  : DataTypes.JSON;

export const AsyncJob = dbsequelize.define(
  prefixTableName("async_jobs"),
  {
    id: {
      type: DataTypes.UUID,
      primaryKey: true,
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
    },
    idendpoint_base: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    idendpoint_async: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    idapp: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    environment: {
      type: DataTypes.STRING(20),
      allowNull: false,
    },
    params: {
      type: JSON_TYPE,
      allowNull: true,
    },
    fingerprint: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("PENDING", "RUNNING", "COMPLETED", "FAILED", "EXPIRED"),
      defaultValue: "PENDING",
      allowNull: false,
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    response_headers: {
      type: JSON_TYPE,
      allowNull: true,
    },
    result: {
      type: DataTypes.TEXT("long"),
      allowNull: true,
    },
    result_is_binary: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    content_type: {
      type: DataTypes.STRING(100),
      defaultValue: "application/json",
    },
    consume_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    max_consumes: {
      type: DataTypes.INTEGER,
      defaultValue: 5,
    },
    ttl_ms: {
      type: DataTypes.BIGINT,
      defaultValue: 3600000,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    freezeTableName: true,
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { fields: ["idendpoint_base", "status"] },
      { fields: ["idendpoint_async"] },
      { fields: ["expires_at"] },
      { fields: ["status", "created_at"] },
      { fields: ["fingerprint"] },
    ],
  }
);

export default AsyncJob;
