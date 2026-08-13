/**
 * @file intervalTaskDocs.js
 * @description Lectura de la documentación de interval tasks (src/docs/interval_tasks/).
 *
 * Espejo de `botDocs.js`: la skill que consume el agente vía `get_interval_task_skill` es
 * el markdown en disco, no una cadena embebida en el seed, para que documentación y
 * herramienta no diverjan.
 */

import path from "path";
import { fileURLToPath } from "url";
import { readFileIfExists, readJsonIfExists } from "./handlerDocs.js";
import { expandDocIncludes } from "./docsInclude.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const INTERVAL_TASK_DOCS_ROOT = path.resolve(
  __dirname,
  "../../docs/interval_tasks",
);

export const readIntervalTaskNamespaceManifest = async () => {
  return await readJsonIfExists(
    path.resolve(INTERVAL_TASK_DOCS_ROOT, "manifest.json"),
  );
};

/**
 * Skill de interval tasks. Soft-fail como `readBotSkill`: si falta el markdown devuelve
 * una frase de respaldo en lugar de lanzar, para que un despliegue sin docs no rompa la
 * herramienta.
 */
export const readIntervalTaskSkill = async () => {
  const [markdown, manifest] = await Promise.all([
    readFileIfExists(path.resolve(INTERVAL_TASK_DOCS_ROOT, "AI_SKILL.md")).then(
      expandDocIncludes,
    ),
    readIntervalTaskNamespaceManifest(),
  ]);

  return {
    scope: "interval_tasks",
    markdown:
      markdown || "No AI skill documentation found for interval tasks.",
    manifest,
  };
};
