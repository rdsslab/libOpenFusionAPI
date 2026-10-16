/**
 * Extract database, schema and table from a qualified name like:
 * "[DB].[schema].[table]" or "DB.schema.table"
 * @param {string} qualifiedName - 
 * @returns {{ database: string, schema: string, table: string }}
 */
export function parseQualifiedName(qualifiedName) {
  // Trim spaces
  const cleaned = qualifiedName.trim();

  // Remove brackets and split by dot
  const parts = cleaned.replace(/\[/g, "").replace(/\]/g, "").split(".");

  if (parts.length !== 3) {
    throw new Error(`Invalid format: ${qualifiedName}`);
  }

  const [database, schema, table] = parts;

  return {
    database,
    schema,
    table,
  };
}

/**
 * @param {any} json
 */
export function AppToTable(json) {
  //console.log(json);

  /**
   * @type {any[]}
   */
  let result = [];

  const { idapp, app, rowkey, data } = json;
  let baseRow = {
    idapp,
    enabled: data && data.enabled ? true : false,
    app,
    rowkey,
    description: data && data.description ? data.description : "",
  };
  //console.warn("Initial => ", idapp, app, rowkey, data);//
  let ns = data && data.namespaces ? data.namespaces : [];

  // Iterate over the data to build the matrix
  for (const d in ns) {
    // console.warn("->", d, ns[d]);

    for (const iname in ns[d].names) {
      const name = ns[d].names[iname];
      for (const iversion in name.versions) {
        const version = name.versions[iversion];
        let row = {
          url: `/api/${baseRow.app}/${ns[d].namespace}/${name.name}/v${version.version}/[environment]`,
          ...baseRow,
          namespace: ns[d].namespace,
          name: name.name,
          version: version.version,
          dev: version.dev,
          qa: version.qa,
          prd: version.prd,
        };

        result.push(row);
      }
    }
  }

  //console.log("AppToTable = ", result);
  return result;
}

/**
 * @param {any[]} objeto
 */
export function TableToApp(objeto) {
  console.log("TableToApp(objeto): ", objeto);

  let nuevoObjeto = {
    idapp: objeto[0].idapp,
    app: objeto[0].app,
    rowkey: objeto[0].rowkey,
    vars: objeto[0].vars,
    data: {
      description: objeto[0].description,
      enabled: objeto[0].enabled || false,
      namespaces: [],
    },
  };

  for (let i = 0; i < objeto.length; i++) {
    let row = objeto[i];
    //  console.log("row>", row);

    // Find the namespace; create it if it does not exist
    let ns = nuevoObjeto.data.namespaces.find(
      // @ts-ignore
      (element) => element.namespace == row.namespace
    );

    if (ns) {
      //      console.log("exists > ", ns);

      // Check if the name exists or not

      // @ts-ignore
      if (ns.names) {
        // names exists
        // console.log("names >> EXISTE", ns.names);

        // @ts-ignore
        let name = ns.names.find(
          // @ts-ignore
          (element) => element.name == row.name
        );

        if (name) {
          //  console.log("MANE ", name);

          if (!name.versions) {
            name.versions = [];
          }

          let version = name.versions.find(
            // @ts-ignore
            (element) => element.version == row.version
          );

          if (!version) {
            name.versions.push({
              version: row.version,
              dev: row.dev,
              qa: row.qa,
              prd: row.prd,
            });
          }
        } else {
          let version = {
            version: row.version,
            dev: row.dev,
            qa: row.qa,
            prd: row.prd,
          };
          // @ts-ignore
          ns.names.push({ name: row.name, versions: [version] });
        }
      } else {
        // Find the namespace; create it if it does not exist
        let version = {
          version: row.version,
          dev: row.dev,
          qa: row.qa,
          prd: row.prd,
        };
        // @ts-ignore
        ns.names.push({ name: row.name, versions: [version] });
      }
    } else {
      // @ts-ignore
      ns = { namespace: row.namespace, names: [] };
      let version = {
        version: row.version,
        dev: row.dev,
        qa: row.qa,
        prd: row.prd,
      };
      // @ts-ignore
      ns.names.push({ name: row.name, versions: [version] });

      // @ts-ignore
      nuevoObjeto.data.namespaces.push(ns);
    }
  }
  //   console.log(" nuevoObjeto>>> ", nuevoObjeto);

  return nuevoObjeto;
}


/**
 * Normaliza un parametro que puede llegar como array o como texto separado por
 * comas a una lista de cadenas no vacias.
 *
 * El mismo parametro llega con dos formas segun el transporte:
 *   - array, cuando el cliente lo manda en el body de un POST/PUT o cuando un
 *     llamador interno pasa la lista directamente;
 *   - string separado por comas, cuando viaja por query string (cualquier GET,
 *     HEAD o DELETE: `?attributes=idapp,app`). `URLSearchParams` no emite claves
 *     repetidas para un array, y Fastify entrega el valor ya aplanado.
 *
 * Es el denominador comun de dos controles que se perdian en silencio por no
 * reconocer la forma CSV: el filtro `attributes` y la lista de `idtask` de un
 * borrado en lote (`delete_interval_task`).
 *
 * @param {unknown} value - array, string CSV, o cualquier otra cosa.
 * @returns {string[]|null} lista no vacia de elementos, o null si no hay valor.
 */
export const toStringList = (value) => {
  let raw = null;
  if (Array.isArray(value)) {
    raw = value;
  } else if (typeof value === "string") {
    raw = value.split(",");
  }

  if (!raw) return null;

  const list = raw
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);

  return list.length > 0 ? list : null;
};

/**
 * @param {unknown} value - `attributes` como array o string CSV.
 * @returns {string[]|null} lista de columnas, o null si no hay filtro.
 */
export const toAttributeList = (value) => toStringList(value);

/**
 * Serializa un valor a JSON con las claves ordenadas en todos los niveles.
 *
 * `JSON.stringify` respeta el orden de inserción de las claves, así que
 * `{a:1,b:2}` y `{b:2,a:1}` producen strings distintos aunque sean el mismo
 * objeto. Para comparar el `params` de dos tareas —una clave natural que el
 * usuario escribe a mano o que un backup serializa en distinto orden— esa
 * diferencia de orden convertiría el mismo payload en dos distintos y una tarea
 * equivalente parecería nueva. Ordenar las claves elimina la ambigüedad.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }

  return JSON.stringify(value ?? null);
}

/**
 * Aplica el filtro de columnas a un objeto de opciones de Sequelize.
 *
 * Solo deja pasar nombres que existan en el modelo: un nombre inventado llegaria
 * a `options.attributes` y Sequelize lanzaria al construir el SELECT, es decir,
 * un filtro mal escrito convertiria una respuesta valida (todas las columnas) en
 * un 500. Los nombres desconocidos se descartan con un aviso; si no queda
 * ninguno, se devuelve la fila completa, que es el comportamiento historico.
 *
 * @param {Record<string, any>} options - opciones de Sequelize (`{}` o `{ where }`).
 * @param {unknown} value - `attributes` tal como llego (array o string CSV).
 * @param {import("sequelize").ModelStatic<any>} model - modelo destino.
 * @returns {Record<string, any>} las mismas options, con `attributes` si aplica.
 */
export const applyAttributesToOptions = (options, value, model) => {
  const requested = toAttributeList(value);
  if (!requested) return options;

  const known = model?.rawAttributes
    ? new Set(Object.keys(model.rawAttributes))
    : null;

  const allowed = known
    ? requested.filter((name) => known.has(name))
    : requested;
  const dropped = known
    ? requested.filter((name) => !known.has(name))
    : [];

  if (dropped.length > 0) {
    console.warn(
      `[attributes] columnas desconocidas ignoradas: ${dropped.join(", ")}`,
    );
  }

  if (allowed.length > 0) {
    options.attributes = allowed;
  }

  return options;
};

/**
 * Validates security policies for passwords
 */
export const validatePasswordSecurity = (password) => {
  const errors = [];

  if (password.length < 8) {
    errors.push("Minimum 8 characters");
  }

  if (!/(?=.*[a-z])/.test(password)) {
    errors.push("At least one lowercase letter");
  }

  if (!/(?=.*[A-Z])/.test(password)) {
    errors.push("At least one uppercase letter");
  }

  if (!/(?=.*\d)/.test(password)) {
    errors.push("At least one number");
  }

  if (!/(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/.test(password)) {
    errors.push("At least one special character");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};
