export const mcpHelpers_rules = [
  {
    id: "ask-ia-with-mcp-legacy-wrapper",
    library: "OpenFusionAPI JS helpers",
    severity: "info",
    autofixable: false,
    reason:
      "askIAWithMCP es un wrapper legacy sobre askAIWithTools/askIAWithProviderMCP. Tiene dos posibles reemplazos con firmas distintas, requiere revisión manual para elegir el correcto.",
    matcherType: "renamedIdentifierCall",
    match: { identifier: "askIAWithMCP" },
  },
];
