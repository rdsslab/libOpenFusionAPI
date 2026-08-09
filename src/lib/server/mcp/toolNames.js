// Normalización de nombres de tool MCP.
//
// Vive en su propio módulo, sin dependencias ni efectos secundarios, para que
// tanto el registro de tools (handlerBuild/mcp.js) como el auditor de contrato
// offline (dev/test/mcp_contract_audit.js) usen exactamente la misma función.
// Si el auditor la reimplementara, podría dar por únicos nombres que el registro
// colapsa —y que acaban descartados en silencio con un console.warn.

export const sanitizeToolName = (name, fallback = "tool") => {
  const raw = (name ?? fallback).toString().trim();
  const cleaned = raw
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_.-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "");
  return cleaned.length > 0 ? cleaned : fallback;
};

export const normalizeToolKey = (name) => {
  return sanitizeToolName(name ?? "", "").toLowerCase();
};
