import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { readFileIfExists, readJsonIfExists } from "./handlerDocs.js";
import { expandDocIncludes } from "./docsInclude.js";
import { RUNTIME_SUPPORTED_PROVIDERS } from "./bot-manager/providers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const BOT_DOCS_ROOT = path.resolve(__dirname, "../../docs/bots");
export const BOT_PROVIDERS_ROOT = path.resolve(BOT_DOCS_ROOT, "providers");
export const BOT_DOC_REQUIRED_FILES = ["README.md", "manifest.json", "AI_SKILL.md"];

const PROVIDER_NAME_REGEX = /^[a-z0-9_-]+$/;

export const normalizeProviderName = (provider) => {
  return String(provider ?? "").trim().toLowerCase();
};

/**
 * Resuelve la carpeta de documentación de un proveedor validando el nombre y
 * verificando que la ruta no escape de BOT_PROVIDERS_ROOT (path traversal).
 */
export const getBotProviderDocDir = (provider) => {
  const providerClean = normalizeProviderName(provider);

  if (!PROVIDER_NAME_REGEX.test(providerClean)) {
    throw new Error("Invalid provider name format.");
  }

  const dir = path.resolve(BOT_PROVIDERS_ROOT, providerClean);
  const relative = path.relative(BOT_PROVIDERS_ROOT, dir);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Access denied (Invalid provider path)");
  }

  return dir;
};

export const readBotNamespaceManifest = async () => {
  return await readJsonIfExists(path.resolve(BOT_DOCS_ROOT, "manifest.json"));
};

const listProviderFolders = async () => {
  try {
    const entries = await fs.readdir(BOT_PROVIDERS_ROOT, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name.toLowerCase())
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
};

/**
 * Catálogo de proveedores de bots, manifest-first.
 *
 * El manifest del namespace es la fuente autoritativa del orden, las etiquetas y el
 * estado (incluidos los proveedores "planned" que todavía no tienen carpeta de docs).
 * Cada fila se enriquece con dos banderas calculadas:
 *  - `documented`: existe la carpeta providers/<provider>/ en disco.
 *  - `runtime_supported`: el runtime puede arrancarlo (RUNTIME_SUPPORTED_PROVIDERS).
 *
 * `undocumented_folders` expone carpetas presentes en disco que el manifest no lista,
 * para que un proveedor agregado a medias no pase inadvertido.
 */
export const listBotProviders = async () => {
  const [manifest, folders] = await Promise.all([
    readBotNamespaceManifest(),
    listProviderFolders(),
  ]);

  const folderSet = new Set(folders);
  const declared = Array.isArray(manifest?.providers) ? manifest.providers : [];
  const declaredNames = new Set();

  const providers = declared.map((entry) => {
    const provider = normalizeProviderName(entry?.provider);
    declaredNames.add(provider);

    return {
      provider,
      label: entry?.label || provider,
      status: entry?.status || "unknown",
      library: entry?.library ?? null,
      docs_dir: entry?.docs_dir ?? null,
      documented: folderSet.has(provider),
      runtime_supported: RUNTIME_SUPPORTED_PROVIDERS.includes(provider),
    };
  });

  return {
    providers,
    runtime_supported: [...RUNTIME_SUPPORTED_PROVIDERS],
    undocumented_folders: folders.filter((folder) => !declaredNames.has(folder)),
  };
};

/**
 * Skill general de bots. Soft-fail como `readHandlerSkill`: si falta el markdown
 * devuelve una frase de respaldo en lugar de lanzar.
 */
export const readBotSkill = async () => {
  const [markdown, manifest, catalog] = await Promise.all([
    readFileIfExists(path.resolve(BOT_DOCS_ROOT, "AI_SKILL.md")).then(expandDocIncludes),
    readBotNamespaceManifest(),
    listBotProviders(),
  ]);

  const defaultProvider = catalog.runtime_supported[0];

  return {
    scope: "bots",
    markdown: markdown || "No general AI skill documentation found for bots.",
    manifest,
    providers: catalog.providers,
    runtime_supported: catalog.runtime_supported,
    undocumented_folders: catalog.undocumented_folders,
    required_next_calls: defaultProvider
      ? [{ tool: "get_bot_provider_skill", arguments: { provider: defaultProvider } }]
      : [],
  };
};

/**
 * Skill específico de un proveedor. Lanza si el proveedor no está documentado, para
 * que la capa de endpoint lo traduzca a 404 (igual que `getHandlerLibraryDoc`).
 */
export const readBotProviderSkill = async (provider) => {
  const providerClean = normalizeProviderName(provider);
  const dir = getBotProviderDocDir(providerClean);

  const [markdown, manifest] = await Promise.all([
    readFileIfExists(path.resolve(dir, "AI_SKILL.md")).then(expandDocIncludes),
    readJsonIfExists(path.resolve(dir, "manifest.json")),
  ]);

  if (!markdown) {
    throw new Error(`Bot provider '${providerClean}' documentation not found`);
  }

  return {
    provider: providerClean,
    markdown,
    manifest,
    status: manifest?.status || "unknown",
    runtime_supported: RUNTIME_SUPPORTED_PROVIDERS.includes(providerClean),
  };
};
