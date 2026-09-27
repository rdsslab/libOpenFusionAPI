import os from "os";
import path from "path";
import { Sequelize } from "sequelize";
import { attachBigintNormalization } from "../bigint.js";
import { parcheAlterColumnMssql } from "./mssql_query_generator.js";

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

// En MSSQL, `ALTER COLUMN` solo admite un tipo y la nulabilidad, y Sequelize
// mete ademas `DEFAULT`, `IDENTITY`, `PRIMARY KEY`, `UNIQUE` y `CHECK`. Ademas el
// comentario de columna se escribe con `sp_addextendedproperty`, que no es
// idempotente, asi que el segundo arranque volvia a fallar. Sin este parche,
// `sync({ alter: true })` no se completa y la plataforma no arranca en MSSQL.
//
// Se parchea la query generator de la instancia y no el prototipo de Sequelize,
// para que el cambio no salga de este proceso: si algun dia el driver lo arregla,
// este archivo sobra sin mas que dejar de llamarse. El detalle de por que no se
// quitan los `defaultValue` de los modelos esta en el modulo.
parcheAlterColumnMssql(dbsequelize);

// Todo modelo que se defina a partir de aqui lleva la normalizacion de `bigint`.
// Se envuelve `define` en lugar de enganchar el hook modelo por modelo para que
// un modelo nuevo no pueda olvidarse: los hooks globales de `Sequelize#addHook`
// NO sirven, porque reciben `options.model` como `undefined` y sin el modelo no
// hay forma de saber que columnas son `BIGINT`.
//
// Este fichero se evalua antes que `models.js`, que es quien llama a `define`, asi
// que el envoltorio ya esta puesto cuando empiezan a declararse los modelos.
const definirModelo = dbsequelize.define.bind(dbsequelize);
dbsequelize.define = (nombre, atributos, opcionesModelo) => {
  const model = definirModelo(nombre, atributos, opcionesModelo);
  attachBigintNormalization(model);
  return model;
};

export default dbsequelize;

// La conexion se abre en segundo plano y sin esperar a nadie, para que importar
// este fichero no bloquee. Se expone la promesa porque quien vaya a cerrar el pool
// (las suites de `dev/test/`) tiene que poder esperar a que termine: si se cierra
// mientras el `authenticate()` sigue en vuelo, Sequelize responde "pool is
// draining and cannot accept work" y el error aparece sin que nadie lo pidiera.
//
// Lo que se registra es a donde se conecto la plataforma y con que error, nunca la
// contrasena. Este archivo se ejecuta en cada arranque, asi que lo que escribe aqui
// va al log del proceso entero, y con el `DATABASE_URL` y las `options` a pelo esa
// linea era la contrasena de la base de datos de la plataforma, en claro, en todos
// los reinicios. Un log de arranque es de los primeros que se pega a un ticket y de
// los que se guarda mas tiempo, y un secreto en el cambia de manos con el.
//
// Sequelize muta el objeto `options` que se le pasa y le añade las credenciales ya
// resueltas en `dialectOptions`, asi que el volcado de antes llevaba la contrasena
// dos veces: en la URL y en `dialectOptions.password`. Lo que queda es lo que hace
// falta para diagnosticar un fallo de conexion —destino, pool y opciones de
// dialecto— y nada que autentique.
const connectionSummary = () => {
  const { password, ...dialectOptions } = options.dialectOptions || {};
  return {
    destino: db_conn.replace(/:\/\/([^:@/]*):[^@/]*@/, "://$1:***@"),
    pool: options.pool,
    dialectOptions,
  };
};

export const connectionReady = (async () => {
  try {
    await dbsequelize.authenticate();
    console.log(
      ">>>>>>>>> Connection has been established successfully",
      connectionSummary()
    );
  } catch (error) {
    console.error(
      ">>>>>>>>> Unable to connect to the database",
      connectionSummary(),
      error
    );
  }
})();
