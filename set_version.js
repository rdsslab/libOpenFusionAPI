// Sube un parche a la versión del proyecto.
//
// La versión vive en un solo sitio, `package.json`. Antes había que escribir además
// `src/lib/server/version.js` a mano, y cada bump que no pasara por este script dejaba la
// plataforma sirviendo una versión que no era la del código instalado. Como el servidor
// lee directamente `package.json` (`getVersion.js`), subir la versión es subir este
// fichero y anotar la entrada del CHANGELOG — que es lo que vigila `version_sync_test.js`.
import fs from "fs";
import path from "path";

const packagePath = path.resolve("package.json");

// Leer package.json
const packageData = JSON.parse(fs.readFileSync(packagePath, "utf8"));

// Obtener y dividir versión
let version = packageData.version || "0.0.0";
let parts = version.split(".").map(Number);

// Incrementar el último número (patch)
parts[2] = parts[2] + 1;
let newVersion = parts.join(".");

// Actualizar package.json
packageData.version = newVersion;
fs.writeFileSync(packagePath, JSON.stringify(packageData, null, 2) + "\n", "utf8");

console.log(`Versión actualizada a ${newVersion}`);