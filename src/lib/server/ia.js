/**
 * Provider layer: it lives in its own package now: `@rdsslab/agentkit`
 * (https://github.com/rdsslab/libAgentKit).
 *
 * This file is only a re-export, so the platform keeps its internal import path
 * (`./ia.js`) and every named export it used before, including the ones only the
 * tests use (`__internalIAForTests`).
 */

export * from "@rdsslab/agentkit/ia";
export { default } from "@rdsslab/agentkit/ia";
