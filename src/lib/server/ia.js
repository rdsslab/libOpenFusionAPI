/**
 * Provider layer: it lives in its own package now: `@rdsslab/agentkit`
 * (https://github.com/rdsslab/libAgentKit).
 *
 * This file is only a re-export, so the platform keeps its internal import path
 * (`./ia.js`) and every named export it used before, including the ones only the
 * tests use (`__internalIAForTests`).
 */

// El paquete 0.4.0 no declara el subpath "./ia" en `exports`, así que se importa
// por su ruta real dentro del paquete. La API de este archivo no cambia.
export * from "@rdsslab/agentkit/src/ia.js";
export { default } from "@rdsslab/agentkit/src/ia.js";
