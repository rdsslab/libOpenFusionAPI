import { ufetch_rules } from "./ufetch.rules.js";
import { promiseSequence_rules } from "./promiseSequence.rules.js";
import { mcpHelpers_rules } from "./mcpHelpers.rules.js";

export const ALL_RULES = [
  ...ufetch_rules,
  ...promiseSequence_rules,
  ...mcpHelpers_rules,
];
