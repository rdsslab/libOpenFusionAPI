/**
 * Application Variable (AppVar) name rules.
 *
 * This module intentionally has NO imports: it is consumed both by `models.js`
 * (column validator) and by `appvars.js` (pre-check before the upsert), and
 * `appvars.js` already imports `models.js` — placing the helper in either one
 * would create a circular dependency.
 *
 * Why the rule is stricter than the runtime:
 *  - The runtime resolver only requires the value to start with `$_`
 *    (see `resolveAppVar` / `resolveAppVarPlaceholder` in src/lib/handler/utils.js).
 *  - But AppVar names are spread into the JS sandbox as globals
 *    (see `createFunctionVM.js`), so a name that is not a valid JS identifier
 *    can only be reached through `$_APP_VARS_['...']` and silently fails when
 *    referenced directly. Enforcing `$_VAR_` + [A-Z0-9_] guarantees both.
 *
 * The stored name is matched byte for byte against the placeholder written in
 * the endpoint configuration, so it is never normalized silently: an invalid
 * name is rejected with a suggestion instead of being rewritten, because
 * renaming only the variable would leave the endpoint pointing at the old name.
 */

/** Maximum length of the `name` column in the AppVars model. */
export const APPVAR_NAME_MAX_LENGTH = 50;

/** Mandatory prefix. Consumes 6 of the 50 available characters. */
export const APPVAR_NAME_PREFIX = "$_VAR_";

/** The canonical AppVar name format. */
export const APPVAR_NAME_REGEX = /^\$_VAR_[A-Z0-9_]+$/;

/**
 * Derive the canonical name for an invalid one, so the error can suggest a fix.
 * Strips any number of leading `$_VAR_` / `$_` prefixes (real data contains
 * `$_VAR_$_VAR_CNX_OMS`), then uppercases and replaces unsupported characters.
 *
 * @param {string} name
 * @returns {string} A suggestion, or "" when nothing usable can be derived.
 */
export const suggestAppVarName = (name) => {
  if (typeof name !== "string") {
    return "";
  }

  let base = name.trim();

  // Peel repeated prefixes: "$_VAR_$_VAR_X" -> "X", "$_MAIN_DB" -> "MAIN_DB"
  let previous;
  do {
    previous = base;
    if (base.startsWith(APPVAR_NAME_PREFIX)) {
      base = base.slice(APPVAR_NAME_PREFIX.length);
    } else if (base.startsWith("$_")) {
      base = base.slice(2);
    }
  } while (base !== previous);

  base = base
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!base) {
    return "";
  }

  return `${APPVAR_NAME_PREFIX}${base}`.slice(0, APPVAR_NAME_MAX_LENGTH);
};

/**
 * Validate an AppVar name before it is persisted.
 *
 * @param {*} name - The raw value received for the `name` column.
 * @returns {{ valid: boolean, message?: string, suggestion?: string }}
 */
export const validateAppVarName = (name) => {
  if (typeof name !== "string") {
    return {
      valid: false,
      message: `Invalid AppVar name: expected a string, received ${name === null ? "null" : typeof name}. Names must match ${APPVAR_NAME_REGEX} (for example "$_VAR_MAIN_DB").`,
    };
  }

  const trimmed = name.trim();

  if (trimmed === "") {
    return {
      valid: false,
      message: `Invalid AppVar name: the name is empty. Names must match ${APPVAR_NAME_REGEX} (for example "$_VAR_MAIN_DB").`,
    };
  }

  if (APPVAR_NAME_REGEX.test(trimmed)) {
    if (trimmed.length > APPVAR_NAME_MAX_LENGTH) {
      return {
        valid: false,
        message: `Invalid AppVar name "${trimmed}": ${trimmed.length} characters exceeds the ${APPVAR_NAME_MAX_LENGTH}-character limit of the name column (the "${APPVAR_NAME_PREFIX}" prefix uses ${APPVAR_NAME_PREFIX.length}, leaving ${APPVAR_NAME_MAX_LENGTH - APPVAR_NAME_PREFIX.length} for the rest).`,
      };
    }

    return { valid: true };
  }

  const suggestion = suggestAppVarName(trimmed);
  const suffix = suggestion ? ` Did you mean "${suggestion}"?` : "";

  // Case 1: no `$_` prefix at all — the most common mistake, and the one that
  // makes the endpoint fail later with "Invalid JSON in custom_data".
  if (!trimmed.startsWith("$_")) {
    return {
      valid: false,
      suggestion,
      message: `Invalid AppVar name "${trimmed}": it must start with "${APPVAR_NAME_PREFIX}". A name without that prefix is never resolved as a placeholder, so any endpoint referencing it fails at request time.${suffix}`,
    };
  }

  // Case 2: the prefix appears more than once, e.g. "$_VAR_$_VAR_CNX_OMS".
  if (trimmed.slice(APPVAR_NAME_PREFIX.length).includes("$_")) {
    return {
      valid: false,
      suggestion,
      message: `Invalid AppVar name "${trimmed}": the "${APPVAR_NAME_PREFIX}" prefix is applied more than once. Apply it exactly once.${suffix}`,
    };
  }

  // Case 3: `$_` but not `$_VAR_`, e.g. "$_MAIN_DB". It does resolve at runtime,
  // but it is not the supported convention.
  if (!trimmed.startsWith(APPVAR_NAME_PREFIX)) {
    return {
      valid: false,
      suggestion,
      message: `Invalid AppVar name "${trimmed}": names must start with "${APPVAR_NAME_PREFIX}", not just "$_". A "$_"-only name still resolves at runtime, but it is not the supported convention and is rejected on save.${suffix}`,
    };
  }

  if (trimmed.length > APPVAR_NAME_MAX_LENGTH) {
    return {
      valid: false,
      suggestion,
      message: `Invalid AppVar name "${trimmed}": ${trimmed.length} characters exceeds the ${APPVAR_NAME_MAX_LENGTH}-character limit of the name column.${suffix}`,
    };
  }

  // Case 4: right prefix, wrong body (lowercase, dashes, dots, spaces...).
  return {
    valid: false,
    suggestion,
    message: `Invalid AppVar name "${trimmed}": after the "${APPVAR_NAME_PREFIX}" prefix only uppercase letters, digits and underscores are allowed. Other characters break direct access from the JavaScript sandbox, where AppVars are injected as globals.${suffix}`,
  };
};
