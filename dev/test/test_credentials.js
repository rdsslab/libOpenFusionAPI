// Credenciales compartidas por las suites de dev/test.
//
// Origen de la verdad: DEFAULT_USERS en src/lib/db/user.js, que es lo que crea
// el servidor al arrancar con BUILD_DB=true. Hasta v13.2.1 la clave del admin era
// "admin@admin"; el commit 7b3cc5a ("endurecer usuarios, credenciales default y
// auditoria") la cambio a "Adm1n@0penFusion!" y no actualizo las 10 suites que
// la tenian hardcodeada, asi que todas ellas moria con 401 en el STEP 1 y el
// validation packet entero era inecutable.
//
// Se exporta desde aqui para que el valor este en un solo sitio: cambiar la
// clave del seed no vuelve a requerir tocar diez archivos, y basta con
// redefinir OFAPI_TEST_USER/OFAPI_TEST_PASS para apuntar a otro entorno.

export const TEST_BASE_URL = process.env.OFAPI_BASE_URL || "http://localhost:3000";
export const TEST_USER = process.env.OFAPI_TEST_USER || "admin";
export const TEST_PASSWORD = process.env.OFAPI_TEST_PASS || "Adm1n@0penFusion!";

/** Header `Authorization: Basic ...` para las credenciales por defecto. */
export const basicAuthHeader = (user = TEST_USER, password = TEST_PASSWORD) =>
  `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
