/**
 * Application Variable (AppVar) type rules.
 *
 * Same no-imports rule as `appvarName.js`: this module is consumed by `models.js`
 * (column validator) and by `appvars.js` (pre-check before the upsert), and
 * `appvars.js` already imports `models.js` — placing the helper in either one
 * would create a circular dependency.
 *
 * WHY THE SET HAS TO BE CLOSED
 *
 * `name` had a validator from the start. `type` never did: it was a bare
 * `STRING(25)` with a `defaultValue`, so any client — the GUI, MCP, a curl — could
 * store any string in it and nothing would object. That is not hypothetical, it is
 * what happened. Four independent lists grew, and no two of them agreed:
 *
 *   - the AppVars in the seeds (`demo.js`, `system.js`): json, string, number,
 *     boolean
 *   - the `switch` in `parseAppVar` (src/lib/db/app.js): number, json, object, js,
 *     and a `default` that swallowed everything else
 *   - the "Lang" dropdown of the GUI (EditorCode.svelte, `listLangs`): none, html,
 *     js, json, sql, xml, string, number
 *   - the `system` seed, which ships two `boolean` flags that appeared in NEITHER
 *     the switch NOR the dropdown, so they rendered with a blank selection
 *
 * The cost of that drift was concrete rather than cosmetic. A `boolean` AppVar was
 * stored as the JSON *string* `"true"` (`json_typeof(value)` returns `string`), and
 * `parseAppVar` handed the runtime that string. In JavaScript the string `"false"`
 * is truthy, so a flag that was switched off still read as on for every consumer
 * that wrote `if ($_VAR_RESET_...)`. The one consumer that reads these flags
 * defensively (`isFlagEnabled` in src/lib/db/user.js) was fine; nothing protected
 * the ones that were not.
 *
 * So: close the set, and make the `boolean` type mean an actual boolean.
 */

/** Maximum length of the `type` column. Matches `DataTypes.STRING(25)` in models.js. */
export const APPVAR_TYPE_MAX_LENGTH = 25;

/**
 * The canonical types.
 *
 * Built from the union of what the seeds actually use, what the GUI offers and
 * what `parseAppVar` branches on, minus the duplicates:
 *
 *   - `json`, `string`, `number` — used by the seeds and understood by the switch.
 *   - `boolean` — used by the `system` seed; previously understood by nobody.
 *   - `js`, `html`, `sql`, `xml`, `none` — offered by the GUI. They carry a plain
 *     string; `parseAppVar` has no branch for them and none is needed, because the
 *     `default` branch returns the value untouched. Their only effect today is the
 *     syntax highlighting of the editor.
 *
 * `object` is deliberately NOT here: see `APPVAR_TYPE_ALIASES`.
 */
export const APPVAR_TYPES = Object.freeze([
  "boolean",
  "html",
  "js",
  "json",
  "none",
  "number",
  "sql",
  "string",
  "xml",
]);

/**
 * Types that are accepted on write and rewritten to their canonical form.
 *
 * `object` is a byte-for-byte duplicate of the `json` branch in `parseAppVar` —
 * the same three lines, once. Nothing produced it and nothing offered it, but a row
 * carrying it may exist in a deployment out there, so rejecting it outright would
 * buy nothing and would turn someone's existing backup into a partial restore.
 * It is normalized instead: the model validator rewrites the value, so the column
 * stops accumulating it. See the validator in models.js.
 *
 * Aliases are allowed to be *read* silently and *written* normalized, which is the
 * opposite of `name` (where a mismatch is rejected rather than renamed, because
 * renaming a variable silently would leave the endpoints pointing at a name that no
 * longer exists). The asymmetry is deliberate: a wrong `type` is a label, and a
 * correct label is better than a rejected save; a wrong `name` is a dangling
 * reference.
 */
export const APPVAR_TYPE_ALIASES = Object.freeze({
  object: "json",
});

/** Every accepted input, canonical types plus aliases. */
export const APPVAR_TYPES_ACCEPTED = Object.freeze([
  ...APPVAR_TYPES,
  ...Object.keys(APPVAR_TYPE_ALIASES),
]);

/**
 * The strings that mean `true` for a `boolean` AppVar.
 *
 * Deliberately the same four values that `isFlagEnabled` accepted before, so that
 * sharing this constant with src/lib/db/user.js changes no existing behaviour. It is
 * extracted rather than duplicated because the duplication is what let the seed and
 * the runtime drift apart in the first place.
 */
export const APPVAR_BOOLEAN_TRUE_VALUES = Object.freeze(["true", "1", "yes", "on"]);

/**
 * Interpret the stored value of a `boolean` AppVar.
 *
 * Returns a REAL boolean, always. That is the whole point: the alternative is
 * passing the raw value through, and the raw value in a real database is the
 * string `"false"`, which is truthy in JavaScript.
 *
 * Anything outside `APPVAR_BOOLEAN_TRUE_VALUES` is `false`, including the empty
 * string, `null` and `undefined`. This is a coercion of a *value*, not a decision
 * about whether a row exists: callers that want "no row means enabled" (the
 * password-reset flags do) must check for the row first, and `isFlagEnabled` does.
 * Guessing `true` for a value nobody wrote would turn a typo into a feature switch.
 *
 * @param {*} value
 * @returns {boolean}
 */
export const parseAppVarBoolean = (value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return APPVAR_BOOLEAN_TRUE_VALUES.includes(String(value).trim().toLowerCase());
};

/**
 * Levenshtein distance, bounded to a cheap O(len) scan.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
const editDistance = (a, b) => {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }

  return previous[b.length];
};

/**
 * Derive the canonical type for a wrong one, so the error can suggest a fix.
 *
 * Handles the three ways a type goes wrong in practice: wrong case, a typo
 * (`strin`), and an alias that was never canonical (`object`).
 *
 * @param {*} type
 * @returns {string} A suggestion, or "" when nothing plausible can be derived.
 */
export const suggestAppVarType = (type) => {
  if (typeof type !== "string") {
    return "";
  }

  const trimmed = type.trim().toLowerCase();
  if (trimmed === "") {
    return "";
  }

  // An alias is a suggestion in its own right, and an exact one.
  if (Object.prototype.hasOwnProperty.call(APPVAR_TYPE_ALIASES, trimmed)) {
    return APPVAR_TYPE_ALIASES[trimmed];
  }

  if (APPVAR_TYPES.includes(trimmed)) {
    return trimmed;
  }

  // At most two edits: enough for every realistic typo without turning the message
  // into a guess (a three-edit neighbour of "json" is not a helpful suggestion).
  let best = "";
  let bestDistance = Infinity;
  for (const candidate of APPVAR_TYPES) {
    const distance = editDistance(trimmed, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return bestDistance <= 2 ? best : "";
};

/**
 * Validate an AppVar type before it is persisted.
 *
 * On success it also reports the canonical spelling, which differs from the input
 * in exactly two cases: an upper/mixed-case input, and an alias. The caller is
 * expected to store `canonical` instead of the raw value; see the validator in
 * models.js.
 *
 * @param {*} type - The raw value received for the `type` column.
 * @returns {{ valid: boolean, canonical?: string, message?: string, suggestion?: string }}
 */
export const validateAppVarType = (type) => {
  const list = APPVAR_TYPES_ACCEPTED.join(", ");

  if (typeof type !== "string") {
    return {
      valid: false,
      message: `Invalid AppVar type: expected a string, received ${type === null ? "null" : typeof type}. Valid types are ${list}.`,
    };
  }

  const trimmed = type.trim();

  if (trimmed === "") {
    return {
      valid: false,
      message: `Invalid AppVar type: the type is empty. Valid types are ${list}.`,
    };
  }

  if (trimmed.length > APPVAR_TYPE_MAX_LENGTH) {
    return {
      valid: false,
      message: `Invalid AppVar type "${trimmed}": ${trimmed.length} characters exceeds the ${APPVAR_TYPE_MAX_LENGTH}-character limit of the type column.`,
    };
  }

  const lowered = trimmed.toLowerCase();

  const aliasTarget = APPVAR_TYPE_ALIASES[lowered];
  if (aliasTarget) {
    return { valid: true, canonical: aliasTarget };
  }

  if (APPVAR_TYPES.includes(lowered)) {
    return { valid: true, canonical: lowered };
  }

  const suggestion = suggestAppVarType(trimmed);
  const suffix = suggestion ? ` Did you mean "${suggestion}"?` : "";

  // Wrong case only ("JSON", "String"): lower-casing it is the whole fix, so say
  // that instead of burying it in a list of valid types. Any other mismatch is
  // handled by the generic branch below.
  if (trimmed !== lowered && APPVAR_TYPES.includes(lowered)) {
    return {
      valid: false,
      suggestion: lowered,
      message: `Invalid AppVar type "${trimmed}": AppVar types are lower case. Store it as "${lowered}".`,
    };
  }

  return {
    valid: false,
    suggestion,
    message: `Invalid AppVar type "${trimmed}": valid types are ${list}. The type decides how the value is interpreted at runtime and which editor the GUI opens, so it is rejected rather than stored as an unknown label.${suffix}`,
  };
};
