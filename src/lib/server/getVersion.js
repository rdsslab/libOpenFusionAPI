/**
 * La versión del proyecto tiene UNA sola fuente: `package.json`.
 *
 * Antes vivía también en `src/lib/server/version.js`, un fichero que solo
 * `set_version.js` reescribía, y cada bump que no pasara por ese script dejaba la
 * plataforma sirviendo una versión que no era la del código instalado. Desde aquí no hay
 * nada que sincronizar: este módulo lee `package.json` en el arranque y exporta la
 * versión, y el resto del árbol la importa como siempre.
 *
 * La ruta se resuelve desde `import.meta.url` y no desde el directorio de trabajo: el
 * servidor puede arrancarse desde cualquier cwd, y la versión tiene que ser la del código
 * que importa este módulo, no la del proceso.
 */
import fs from "node:fs";

const packagePath = new URL("../../../package.json", import.meta.url);

function readVersion() {
  let raw;
  try {
    raw = fs.readFileSync(packagePath, "utf8");
  } catch (error) {
    throw new Error(
      `No se pudo leer ${packagePath.pathname} para conocer la versión: ${error.message}`,
    );
  }

  let version;
  try {
    version = JSON.parse(raw)?.version;
  } catch (error) {
    throw new Error(
      `${packagePath.pathname} no es JSON válido y no se puede conocer la versión: ${error.message}`,
    );
  }

  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `${packagePath.pathname} declara una versión inservible: ${JSON.stringify(version)}. ` +
        `Tiene que ser un 'x.y.z' plano, que es lo que escribe set_version.js y lo que ` +
        `espera quien la consuma.`,
    );
  }

  return version;
}

export const version = readVersion();