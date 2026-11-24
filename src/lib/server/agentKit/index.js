/**
 * The agent kit lives in its own package now: `@rdsslab/agentkit`
 * (https://github.com/rdsslab/libAgentKit).
 *
 * This file is only a re-export: the platform keeps its internal import path and
 * its public JavaScript API (`askAgent`, `AgentSession`, `webSearch`,
 * `readDocument`, `transcribeAudio`, `synthesizeSpeech`, `extractVideoFrames`,
 * `describeMediaSupport` and the `agentKit` namespace), while the code has a
 * single owner that can evolve on its own release cycle.
 */

export * from "@rdsslab/agentkit";
