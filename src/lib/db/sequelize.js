import os from "os";
import path from "path";
import { Sequelize } from "sequelize";

//Temporal DDBB
const tmpPath = path.join(os.tmpdir(), "ofapi.sqlite");

const db_conn =
  process.env.DATABASE_URL ||
  process.env.DATABASE_URI_API ||
  `sqlite:${tmpPath}`;

let dialectOptions;
if (process.env.USE_HEROKU_POSTGRESQL) {
  dialectOptions = { ssl: { rejectUnauthorized: false } };
}

const options = {
  logging: false, // Imprime el SQL en consola
  dialectOptions: dialectOptions,
  pool: {
    max: db_conn.includes("sqlite") ? 1 : 20,
    min: 1,
    acquire: 30000,
    idle: 10000,
  },
};

const dbsequelize = new Sequelize(db_conn, options);

export default dbsequelize;

// La conexion se abre en segundo plano y sin esperar a nadie, para que importar
// este fichero no bloquee. Se expone la promesa porque quien vaya a cerrar el pool
// (las suites de `dev/test/`) tiene que poder esperar a que termine: si se cierra
// mientras el `authenticate()` sigue en vuelo, Sequelize responde "pool is
// draining and cannot accept work" y el error aparece sin que nadie lo pidiera.
export const connectionReady = (async () => {
  try {
    await dbsequelize.authenticate();
    console.log(
      ">>>>>>>>> Connection has been established successfully to " + db_conn,
      options
    );
  } catch (error) {
    console.error(
      ">>>>>>>>> Unable to connect to the database: " + db_conn,
      options,
      error
    );
  }
})();
