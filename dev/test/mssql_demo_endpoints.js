// Endpoints demo MSSQL para validar tedious@20 / ConnectionPool
// Se agregan al seed demo.js según el plan de implementacion (security/tedious-update)
// Uso: handler JS + sequelize + tedious@20.3.8 + MSSQL localhost:1433 (mssql_test)
// Credenciales: sa / Of@piMs!2026#Db / master

// 1) SELECT constante con verbose
export const mssql_demo_constant = `
const DataTypes = (await import("sequelize")).DataTypes;
const s = new (await import("sequelize")).Sequelize({
  database: $_APP_VARS_["$_VAR_MSSQL_TEST"]?.database || "master",
  username: $_APP_VARS_["$_VAR_MSSQL_TEST"]?.username || "sa",
  password: $_APP_VARS_["$_VAR_MSSQL_TEST"]?.password || "Of@piMs!2026#Db",
  host: $_APP_VARS_["$_VAR_MSSQL_TEST"]?.host || "localhost",
  port: Number($_APP_VARS_["$_VAR_MSSQL_TEST"]?.port || 1433),
  dialect: "mssql",
  logging: false,
  pool: { max: 1, min: 0 },
});
try {
  const [res] = await s.query("SELECT 1 AS prueba");
  $_RETURN_DATA_ = { endpoint: "mssql_constant", result: res[0]?.prueba || res };
} finally { await s.close(); }
`;

// 2) Creacion de tabla temporal + insercion (transaccion)
export const mssql_demo_trans = `
const { Sequelize } = await import("sequelize");
const s = new Sequelize({
  database: $_APP_VARS_["$_VAR_MSSQL_TEST"]?.database || "master",
  username: $_APP_VARS_["$_VAR_MSSQL_TEST"]?.username || "sa",
  password: $_APP_VARS_["$_VAR_MSSQL_TEST"]?.password || "Of@piMs!2026#Db",
  host: $_APP_VARS_["$_VAR_MSSQL_TEST"]?.host || "localhost",
  port: Number($_APP_VARS_["$_VAR_MSSQL_TEST"]?.port || 1433),
  dialect: "mssql",
  logging: false,
  pool: { max: 2, min: 0 },
});
try {
  await s.query("CREATE TABLE #tmp_demo (id INT); INSERT INTO #tmp_demo VALUES (1),(2),(3);");
  const [res] = await s.query("SELECT COUNT(*) AS cnt FROM #tmp_demo");
  $_RETURN_DATA_ = { endpoint: "mssql_trans", count: res[0]?.cnt ? Number(res[0].cnt) : 0 };
} finally { await s.close(); }
`;

// 3) Consulta simple con bind
export const mssql_demo_bind = `
const { Sequelize } = await import("sequelize");
const s = new Sequelize({
  database: $_APP_VARS_["$_VAR_MSSQL_TEST"]?.database || "master",
  username: $_APP_VARS_["$_VAR_MSSQL_TEST"]?.username || "sa",
  password: $_APP_VARS_["$_VAR_MSSQL_TEST"]?.password || "Of@piMs!2026#Db",
  host: $_APP_VARS_["$_VAR_MSSQL_TEST"]?.host || "localhost",
  port: Number($_APP_VARS_["$_VAR_MSSQL_TEST"]?.port || 1433),
  dialect: "mssql",
  logging: false,
  pool: { max: 1, min: 0 },
});
try {
  const [res] = await s.query("SELECT :val AS val", { replacements: { val: request.query?.val || 42 }, type: Sequelize.QueryTypes.SELECT });
  $_RETURN_DATA_ = { endpoint: "mssql_bind", value: res[0]?.val || null };
} finally { await s.close(); }
`;
