/**
 * Maps endpoints to permission resources.
 *
 * Two strategies (checked in order):
 *   1. Explicit: endpoint.ctrl.resource  — set per-endpoint in system.js
 *   2. Fallback: path-based prefix matching (this file)
 *
 * The mapper is used by auth_service to determine which resource
 * a request targets so it can be checked against user.ctrl.env.
 */

const PATH_RESOURCE_MAP = [
  // ── Users ──
  { prefix: "/users",         resource: "users" },
  { prefix: "/user/",         resource: "users" },

  // ── API Clients ──
  { prefix: "/api_clients",   resource: "apiclients" },
  { prefix: "/apiclient",     resource: "apiclients" },

  // ── Endpoints ──
  { prefix: "/system/endpoints", resource: "endpoints" },
  { prefix: "/system/endpoint",  resource: "endpoints" },
  { prefix: "/api/endpoint",     resource: "endpoints" },

  // ── Apps ──
  { prefix: "/apps",          resource: "apps" },
  { prefix: "/api/app",       resource: "apps" },
  { prefix: "/app/tree",      resource: "apps" },

  // ── App Variables ──
  { prefix: "/app/variables", resource: "appvars" },
  { prefix: "/app/var",       resource: "appvars" },
  { prefix: "/appvars",       resource: "appvars" },

  // ── Bots ──
  { prefix: "/bots",          resource: "bots" },

  // ── Interval Tasks ──
  { prefix: "/interval_tasks", resource: "interval_tasks" },

  // ── Logs / System ──
  { prefix: "/system/log",    resource: "logs" },
  { prefix: "/system/health", resource: "logs" },
  { prefix: "/system/settings", resource: "settings" },

  // ── Function Names (auxiliary, read-only) ──
  { prefix: "/api/function_names", resource: "endpoints" },

  // ── DB schema introspection ──
  { prefix: "/api/db",        resource: "settings" },
];

/**
 * Returns the permission resource for an endpoint.
 *
 * @param {object} endpointCtrl - the endpoint's ctrl field (may contain .resource)
 * @param {string} resourcePath - the endpoint's resource path (e.g. "/users/list")
 * @returns {string|null} resource name or null if unmapped (allows access)
 */
export function resolveResource(endpointCtrl, resourcePath) {
  // 1. Explicit override on the endpoint
  if (endpointCtrl?.resource) return endpointCtrl.resource;

  // 2. Path-based fallback
  if (resourcePath) {
    for (const { prefix, resource } of PATH_RESOURCE_MAP) {
      if (resourcePath === prefix || resourcePath.startsWith(prefix + "/")) {
        return resource;
      }
    }
  }

  // Unknown resource → null means "no restriction" (backward-compatible)
  return null;
}

/**
 * Returns all known resource names (useful for UIs / MCP tools).
 */
export function listResources() {
  const unique = new Set(PATH_RESOURCE_MAP.map((r) => r.resource));
  return [...unique].sort();
}
