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
