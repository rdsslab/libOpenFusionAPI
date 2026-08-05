import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DOCS_ROOT = path.resolve(__dirname, "../../docs");

// Marcador de inclusión soportado dentro de los archivos markdown de documentación:
//   <!-- include: skills/JS_CORE.md -->
// La ruta siempre es relativa a src/docs. Se usa para compartir el núcleo común de
// un skill entre varios contextos (handler JS, bots, etc.) sin duplicar el texto,
// porque los lectores de skills devuelven markdown crudo y los agentes de IA no
// pueden seguir enlaces relativos del filesystem.
const INCLUDE_REGEX = /^[ \t]*<!--\s*include:\s*([^\s>]+?)\s*-->[ \t]*$/gm;

const resolveIncludePath = (relativePath) => {
  if (!relativePath.toLowerCase().endsWith(".md")) {
    throw new Error(`Only .md includes are allowed (received '${relativePath}')`);
  }

  if (path.isAbsolute(relativePath)) {
    throw new Error(`Include paths must be relative to src/docs (received '${relativePath}')`);
  }

  const filePath = path.resolve(DOCS_ROOT, relativePath);
  const relative = path.relative(DOCS_ROOT, filePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Access denied (include path outside the docs root: '${relativePath}')`);
  }

  return filePath;
};

/**
 * Expande los marcadores `<!-- include: <ruta> -->` de un markdown de documentación.
 *
 * - Las rutas son relativas a `src/docs` y solo pueden apuntar a archivos `.md`
 *   dentro de esa carpeta.
 * - No es recursivo: un include dentro de un archivo incluido se deja tal cual, de
 *   modo que no hay ciclos posibles.
 * - Si el archivo no existe o la ruta es inválida, deja un comentario visible en el
 *   markdown en lugar de lanzar, para que un skill nunca falle por un include roto.
 *
 * @param {string|undefined} markdown
 * @returns {Promise<string|undefined>}
 */
export const expandDocIncludes = async (markdown) => {
  if (typeof markdown !== "string" || markdown.length === 0) return markdown;

  const matches = [...markdown.matchAll(INCLUDE_REGEX)];
  if (matches.length === 0) return markdown;

  const replacements = new Map();

  for (const match of matches) {
    const relativePath = match[1];
    if (replacements.has(relativePath)) continue;

    try {
      const filePath = resolveIncludePath(relativePath);
      const content = await fs.readFile(filePath, "utf8");
      replacements.set(relativePath, content.trimEnd());
    } catch (error) {
      const reason = error?.code === "ENOENT" ? "file not found" : error?.message || String(error);
      replacements.set(
        relativePath,
        `<!-- include failed: ${relativePath} (${reason}) -->`
      );
    }
  }

  return markdown.replace(INCLUDE_REGEX, (_full, relativePath) => {
    return replacements.get(relativePath) ?? _full;
  });
};
