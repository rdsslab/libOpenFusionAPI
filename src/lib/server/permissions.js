/**
 * Permission evaluation engine for internal users.
 *
 * ctrl schema (User.ctrl):
 * {
 *   "as_admin": false,          // global superadmin bypass
 *   "env": {
 *     "dev|qa|prd": {
 *       "<resource>": { "read": true, "create": true, "edit": true, "delete": true }
 *     }
 *   }
 * }
 *
 * Resource names must match the values stored in endpoint.ctrl.resource.
 */

const VALID_ACTIONS = ["read", "create", "edit", "delete"];

const METHOD_TO_ACTION = {
  GET: "read",
  HEAD: "read",
  OPTIONS: "read",
  QUERY: "read",
  POST: "create",
  PUT: "edit",
  PATCH: "edit",
  DELETE: "delete",
};

/**
 * Returns the action implied by an HTTP method.
 * POST defaults to "create"; PUT/PATCH to "edit"; DELETE to "delete"; everything else to "read".
 */
export function actionFromMethod(method) {
  return METHOD_TO_ACTION[method] || "read";
}

/**
 * Core permission check.
 *
 * @param {object|null} userCtrl  - User.ctrl value (may be null/undefined)
 * @param {string}      environment - target environment (dev|qa|prd)
 * @param {string}      resource    - resource name (e.g. "users", "endpoints")
 * @param {string}      action      - action to check (read|create|edit|delete)
 * @returns {boolean}
 */
export function hasPermission(userCtrl, environment, resource, action) {
  if (!userCtrl || !environment || !resource || !action) return false;

  // Superadmin bypass
  if (userCtrl.as_admin === true) return true;

  const envPerms = userCtrl.env?.[environment];
  if (!envPerms) return false;

  // Check specific resource
  const resourcePerms = envPerms[resource];
  if (resourcePerms && resourcePerms[action] === true) return true;

  // Wildcard resource "*" grants all actions in that environment
  const wildcardPerms = envPerms["*"];
  if (wildcardPerms && wildcardPerms[action] === true) return true;

  return false;
}

/**
 * Validates that a ctrl object conforms to the expected schema.
 * Returns { valid: true } or { valid: false, errors: string[] }.
 */
export function validateCtrlSchema(ctrl) {
  if (!ctrl || typeof ctrl !== "object") {
    return { valid: false, errors: ["ctrl must be a non-null object"] };
  }

  const errors = [];

  if (ctrl.as_admin !== undefined && typeof ctrl.as_admin !== "boolean") {
    errors.push("ctrl.as_admin must be a boolean");
  }

  if (ctrl.env !== undefined) {
    if (typeof ctrl.env !== "object" || ctrl.env === null) {
      errors.push("ctrl.env must be an object");
    } else {
      const validEnvs = ["dev", "qa", "prd"];
      for (const [envName, envValue] of Object.entries(ctrl.env)) {
        if (!validEnvs.includes(envName)) {
          errors.push(`ctrl.env has unexpected key "${envName}" (valid: ${validEnvs.join(", ")})`);
          continue;
        }
        if (typeof envValue !== "object" || envValue === null) {
          errors.push(`ctrl.env.${envName} must be an object`);
          continue;
        }
        for (const [resName, resValue] of Object.entries(envValue)) {
          if (typeof resValue !== "object" || resValue === null) {
            errors.push(`ctrl.env.${envName}.${resName} must be an object`);
            continue;
          }
          for (const [actName, actValue] of Object.entries(resValue)) {
            if (!VALID_ACTIONS.includes(actName) && actName !== "*") {
              errors.push(`ctrl.env.${envName}.${resName}.${actName} is not a valid action (valid: ${VALID_ACTIONS.join(", ")}, *)`);
            }
            if (typeof actValue !== "boolean") {
              errors.push(`ctrl.env.${envName}.${resName}.${actName} must be a boolean`);
            }
          }
        }
      }
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

/**
 * Builds the default ctrl for a new system user with no access.
 */
export function emptyCtrl() {
  return { as_admin: false, env: {} };
}

/**
 * Builds a full-access ctrl for all environments.
 */
export function fullAccessCtrl() {
  const resourceActions = { read: true, create: true, edit: true, delete: true };
  const envResources = {
    users: { ...resourceActions },
    apiclients: { ...resourceActions },
    endpoints: { ...resourceActions },
    apps: { ...resourceActions },
    appvars: { ...resourceActions },
    bots: { ...resourceActions },
    interval_tasks: { ...resourceActions },
    logs: { read: true },
    settings: { read: true, edit: true },
  };
  return {
    as_admin: false,
    env: {
      dev: { ...envResources },
      qa: { ...envResources },
      prd: { ...envResources },
    },
  };
}
