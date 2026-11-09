/**
 * Maps endpoints to permission resources.
 *
 * Two strategies (checked in order):
 *   1. Explicit: endpoint.ctrl.resource  — set per-endpoint in system.js
 *   2. Fallback: path-based prefix matching (this file)
 *
 * The mapper is used by auth_service to determine which resource
 * a request targets so it can be checked against user.ctrl.env.
 *
 * IMPORTANT: a `null` result means "no resource could be resolved". In the
 * `system` app that is a DENY (fail-closed), not "no restriction". Endpoints
 * that must be reachable by any authenticated user without a specific
 * permission use `endpoint.ctrl.authenticated === true` instead of relying on
 * an unmapped path.
 *
 * Prefix matching is done on path-segment boundaries: the prefix `/user`
 * matches `/user`, `/user/create`, `/users/list` (no) and never a path such as
 * `/userx`. The old entry `"/user/"` was dead code because the matcher appended
 * its own slash (`"/user//"`), so every `/user/*` request resolved to `null`
 * and was denied to every non-`as_admin` account.
 */

const PATH_RESOURCE_MAP = [
  // ── Users ──
  { prefix: "/users", resource: "users" },
  { prefix: "/user", resource: "users" },

  // ── API Clients ──
  { prefix: "/api_clients", resource: "apiclients" },
  { prefix: "/apiclient", resource: "apiclients" },

  // ── API Keys ──
  { prefix: "/apikey", resource: "apikeys" },

  // ── Endpoints ──
  { prefix: "/system/endpoints", resource: "endpoints" },
  { prefix: "/system/endpoint", resource: "endpoints" },
  { prefix: "/api/endpoint", resource: "endpoints" },
  { prefix: "/api/validation/endpoint-code", resource: "endpoints" },
  { prefix: "/api/function_names", resource: "endpoints" },
  { prefix: "/endpoints/migrate", resource: "endpoints" },

  // ── Apps ──
  { prefix: "/apps", resource: "apps" },
  { prefix: "/app/backup", resource: "apps" },
  { prefix: "/app/documentation", resource: "apps" },
  { prefix: "/app/tree", resource: "apps" },
  { prefix: "/api/app", resource: "apps" },
  { prefix: "/api/apps", resource: "apps" },

  // ── App Variables ──
  { prefix: "/app/variables", resource: "appvars" },
  { prefix: "/app/var", resource: "appvars" },
  { prefix: "/appvars", resource: "appvars" },

  // ── App Groups ──
  { prefix: "/appgroup", resource: "appgroups" },

  // ── Bots ──
  { prefix: "/bot/all", resource: "bots" },
  { prefix: "/bots", resource: "bots" },

  // ── Interval Tasks ──
  { prefix: "/interval_tasks", resource: "interval_tasks" },

  // ── Logs / Audit ──
  { prefix: "/system/log", resource: "logs" },
  { prefix: "/system/audit", resource: "logs" },
  { prefix: "/system/health", resource: "logs" },
  { prefix: "/audit/log", resource: "logs" },
  { prefix: "/log/app", resource: "logs" },
  { prefix: "/responses/status_code", resource: "logs" },

  // ── Settings / System configuration ──
  { prefix: "/system/settings", resource: "settings" },
  { prefix: "/system/admin", resource: "settings" },
  { prefix: "/system/environment", resource: "settings" },
  { prefix: "/system/method", resource: "settings" },
  { prefix: "/system/handler", resource: "settings" },
  { prefix: "/system/async", resource: "settings" },
  { prefix: "/system/logout", resource: "settings" },
  { prefix: "/cache", resource: "settings" },
  { prefix: "/security", resource: "settings" },
  { prefix: "/mcp", resource: "settings" },
  { prefix: "/email", resource: "settings" },
  { prefix: "/restore", resource: "settings" },

  // ── DB schema introspection ──
  { prefix: "/api/db", resource: "settings" },
];

/**
 * Returns the permission resource for an endpoint.
 *
 * @param {object} endpointCtrl - the endpoint's ctrl field (may contain .resource)
 * @param {string} resourcePath - the endpoint's resource path (e.g. "/users/list")
 * @returns {string|null} resource name or null if unmapped (system app denies)
 */
export function resolveResource(endpointCtrl, resourcePath) {
  // 1. Explicit override on the endpoint
  if (endpointCtrl?.resource) return endpointCtrl.resource;

  // 2. Path-based fallback (segment boundary, never a bare startsWith)
  if (resourcePath) {
    const path = String(resourcePath);
    for (const { prefix, resource } of PATH_RESOURCE_MAP) {
      if (path === prefix || path.startsWith(prefix + "/")) {
        return resource;
      }
    }
  }

  // Unknown resource → null. auth_service treats null as DENY for the system
  // app; endpoints reachable by any authenticated user must opt in with
  // ctrl.authenticated === true.
  return null;
}

/**
 * Returns all known resource names (useful for UIs / MCP tools).
 */
export function listResources() {
  const unique = new Set(PATH_RESOURCE_MAP.map((r) => r.resource));
  return [...unique].sort();
}
