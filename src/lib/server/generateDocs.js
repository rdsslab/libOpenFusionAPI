import { listFunctionsVars } from "./functionVars.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OLD_OUTPUT_FILE = path.resolve(__dirname, "../../docs/handlers/JS/api.generated.md");
const OUTPUT_DIR = path.resolve(__dirname, "../../docs/handlers/JS/libraries");

/**
 * Normalizes the metadata object to a standard schema.
 * Handles backward compatibility for 'info', 'web', 'value_type', etc.
 */

function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '') // Remove non-word chars (except - and _)
        .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with -
        .replace(/^-+|-+$/g, ''); // Trim -
}

/**
 * Normalizes the metadata object to a standard schema.
 */
function normalizeMetadata(key, raw) {
    const params = (raw.params || []).map((p) => ({
        name: p.name,
        type: p.type || p.value_type || "any",
        required: p.required !== undefined ? p.required : false,
        default: p.default || p.default_value || null,
        description: p.description || p.info || "",
    }));

    // Construct Signature
    let signature = key;
    if (raw.fn && typeof raw.fn === 'function' || (raw.params && raw.params.length > 0)) {
        const paramStr = params.map(p => {
            if (!p.required) return `[${p.name}]`;
            return p.name;
        }).join(", ");
        signature = `${key}(${paramStr})`;
    } else if (raw.type === 'class') {
        signature = `Class: ${key}`;
    }

    return {
        name: key,
        signature: signature,
        description: raw.description || raw.info || "No description available.",
        url: raw.url || raw.web || null,
        deprecated: raw.deprecated || false,
        params: params,
        notes: Array.isArray(raw.notes) ? raw.notes : [],
        agentGuidance: Array.isArray(raw.agentGuidance) ? raw.agentGuidance : [],
        returns: raw.return
            ? typeof raw.return === "object"
                ? raw.return
                : { description: raw.return }
            : null,
        example: raw.example || null,
    };
}

/**
 * Aviso que encabeza cada archivo generado.
 *
 * Existe porque ya se perdieron correcciones por editar estos archivos a mano:
 * el texto correcto de uFetch.batch y las notas de QRCodeStyling se escribieron
 * directamente en el markdown, y como main() vacia el directorio antes de
 * regenerar, la siguiente ejecucion los habria borrado en silencio. Es un
 * comentario HTML para que no se vea al renderizar, pero si al editar.
 */
const GENERATED_BANNER =
    "<!-- AUTO-GENERADO por src/lib/server/generateDocs.js a partir de src/lib/server/functionVars.js. NO EDITAR A MANO: este directorio se vacia y se reescribe en cada regeneracion. Los cambios van en functionVars.js. -->";

function generateLibraryMarkdown(key, fn) {
    const meta = normalizeMetadata(key, fn);
    let md = `${GENERATED_BANNER}\n\n`;
    md += `# \`${meta.signature}\`\n\n`;

    if (meta.deprecated) {
        md += `> **⚠️ DEPRECATED**\n\n`;
    }

    if (meta.url) {
        md += `[External Documentation](${meta.url}) \n\n`;
    }

    md += `${meta.description}\n\n`;

    if (meta.notes.length > 0) {
        md += `**Notes**\n\n`;
        meta.notes.forEach((note) => {
            md += `- ${note}\n`;
        });
        md += `\n`;
    }

    if (meta.agentGuidance.length > 0) {
        md += `**Agent Guidance**\n\n`;
        meta.agentGuidance.forEach((note) => {
            md += `- ${note}\n`;
        });
        md += `\n`;
    }

    if (meta.params.length > 0) {
        md += `**Parameters**\n\n`;
        meta.params.forEach((p) => {
            const typeStr = p.type ? ` <${p.type}>` : "";
            const reqStr = p.required ? "" : " **Optional**.";
            const defStr = p.default !== null ? ` Default: \`${p.default}\`.` : "";
            md += `*   \`${p.name}\`${typeStr}${reqStr}${defStr} ${p.description}\n`;
        });
        md += `\n`;
    }

    if (meta.returns) {
        let returnType = "";
        if (meta.returns.value_type) returnType = ` <${meta.returns.value_type}>`;
        else if (meta.returns.type) returnType = ` <${meta.returns.type}>`;

        md += `*   Returns:${returnType} ${meta.returns.info || meta.returns.description || ""}\n\n`;

        // Handle complex object returns documentation if present
        if (Array.isArray(meta.returns.object)) {
            md += `    **Result Structure:**\n\n`;
            meta.returns.object.forEach(prop => {
                const pType = prop.value_type || prop.type || "any";
                md += `    *   \`${prop.name}\` <${pType}> ${prop.info || prop.description || ""}\n`;
            });
            md += `\n`;
        }
    }

    if (meta.example) {
        md += `#### Example\n\n`;
        md += `\`\`\`javascript\n${meta.example}\n\`\`\`\n\n`;
    }

    return md;
}

function generateIndexMarkdown(functions) {
    let md = `# JS Handler Libraries Index\n\n`;
    md += `Below is the index of available libraries and functions inside the JS handler VM sandbox.\n\n`;
    md += `| Library / Variable | Signature | Description | Recommended Use Case |\n`;
    md += `|---|---|---|---|\n`;

    const sortedKeys = Object.keys(functions).sort();
    sortedKeys.forEach((key) => {
        const fn = functions[key];
        const meta = normalizeMetadata(key, fn);

        // Escape $ for table display
        const displayKey = key.replace(/\$/g, "\\$");
        // Get first sentence of description
        const firstSentence = meta.description.split(/[.!?]/)[0].trim() + ".";

        // Determine recommended use case
        let useCase = "-";
        if (meta.agentGuidance.length > 0) {
            useCase = meta.agentGuidance[0];
        } else if (meta.notes.length > 0) {
            useCase = meta.notes[0];
        }

        md += `| [${displayKey}](./${key}.md) | \`${meta.signature}\` | ${firstSentence} | ${useCase} |\n`;
    });

    md += `\n> Auto-generated from \`src/lib/server/generateDocs.js\`.\n`;
    return md;
}

/**
 * Construye en memoria el contenido completo de la documentacion, sin tocar el
 * disco: devuelve un Map { nombreArchivo -> contenido }.
 *
 * Se extrajo de main() para que la escritura y la comprobacion consuman
 * exactamente la misma salida. Si se duplicara la logica, el comprobador podria
 * dar por bueno algo que el generador escribe distinto, que es justo el fallo
 * que viene a detectar.
 */
function buildDocs() {
    // Pass null/dummy arguments because listFunctionsVars expects them strictly for returning the function object,
    // but for metadata it returns the structure even with undefined.
    const functions = listFunctionsVars(null, null, null);
    const files = new Map();

    files.set("README.md", generateIndexMarkdown(functions));

    const sortedKeys = Object.keys(functions).sort();
    for (const key of sortedKeys) {
        files.set(`${key}.md`, generateLibraryMarkdown(key, functions[key]));
    }

    return files;
}

/**
 * Normaliza los finales de linea antes de comparar.
 *
 * IMPRESCINDIBLE: el generador escribe siempre \n, pero en Windows git puede
 * dejar el archivo en disco con CRLF al hacer checkout (core.autocrlf). Sin esta
 * normalizacion el comprobador fallaria en cada clon de Windows por un motivo
 * que no tiene nada que ver con el contenido, y acabaria desactivandose.
 */
const normalizeEol = (text) => text.replace(/\r\n/g, "\n");

async function readFileIfExists(filePath) {
    try {
        return await fs.readFile(filePath, "utf-8");
    } catch (error) {
        if (error.code === "ENOENT") return undefined;
        throw error;
    }
}

async function writeDocs() {
    console.log("Generating documentation...");
    const files = buildDocs();

    // Delete old output file if it exists
    try {
        await fs.unlink(OLD_OUTPUT_FILE);
        console.log(`Deleted old consolidated documentation file at: ${OLD_OUTPUT_FILE}`);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }

    // Create libraries directory
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    // Clean out existing files in the directory to avoid stale docs
    try {
        const existingFiles = await fs.readdir(OUTPUT_DIR);
        for (const file of existingFiles) {
            await fs.unlink(path.join(OUTPUT_DIR, file));
        }
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }

    for (const [fileName, content] of files) {
        await fs.writeFile(path.join(OUTPUT_DIR, fileName), content, "utf-8");
    }

    console.log(`Libraries index generated at: ${path.join(OUTPUT_DIR, "README.md")}`);
    console.log(`Generated ${files.size - 1} library detail files under: ${OUTPUT_DIR}`);
}

/**
 * Comprueba que lo que hay en disco coincide con lo que produciria el generador,
 * SIN escribir nada. Sale con codigo 1 si no coincide.
 *
 * DONDE SE USA: en CI o en un hook de pre-commit, para detectar que alguien
 * edito un markdown generado en vez de functionVars.js. NO tiene sentido
 * encadenarlo detras de `docs:js-api` dentro de `docs:handlers`, porque ahi la
 * escritura acaba de ocurrir y la comprobacion pasaria siempre.
 */
async function checkDocs() {
    const files = buildDocs();
    const problems = [];

    let existingFiles = [];
    try {
        existingFiles = await fs.readdir(OUTPUT_DIR);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }

    // Archivos que sobran: la regeneracion vacia el directorio, asi que
    // desapareceran sin aviso.
    for (const fileName of existingFiles) {
        if (!files.has(fileName)) {
            problems.push(`${fileName}: esta en disco pero el generador no lo produce (se borraria al regenerar)`);
        }
    }

    for (const [fileName, expected] of files) {
        const current = await readFileIfExists(path.join(OUTPUT_DIR, fileName));
        if (current === undefined) {
            problems.push(`${fileName}: falta en disco`);
        } else if (normalizeEol(current) !== normalizeEol(expected)) {
            problems.push(`${fileName}: difiere de lo que genera functionVars.js`);
        }
    }

    if (problems.length > 0) {
        console.error("La documentacion generada NO coincide con su fuente:\n");
        problems.forEach((problem) => console.error(`  - ${problem}`));
        console.error(
            "\nEstos archivos se generan desde src/lib/server/functionVars.js y el directorio" +
            "\nse vacia en cada regeneracion. Si editaste un .md a mano, lleva el cambio a" +
            "\nfunctionVars.js y ejecuta `npm run docs:js-api`."
        );
        process.exit(1);
    }

    console.log(`Documentacion verificada: ${files.size} archivos coinciden con functionVars.js.`);
}

async function main() {
    const isCheck = process.argv.includes("--check");
    try {
        if (isCheck) {
            await checkDocs();
        } else {
            await writeDocs();
        }
    } catch (error) {
        console.error(isCheck ? "Error checking documentation:" : "Error generating documentation:", error);
        process.exit(1);
    }
}

main();

