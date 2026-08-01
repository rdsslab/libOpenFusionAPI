const UFETCH_IDENTIFIERS = ["uFetch", "uFetchAutoEnv"];

export const ufetch_rules = [
  {
    id: "ufetch-uppercase-http-verb",
    library: "@rdsslab/uFetch",
    severity: "warning",
    autofixable: true,
    reason:
      "uFetch.GET/POST/PUT/PATCH/DELETE están deprecados: delegan a la variante en minúscula y solo emiten console.warn, no lanzan excepción.",
    matcherType: "memberCallUppercaseVerb",
    match: {
      object: UFETCH_IDENTIFIERS,
      properties: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    },
    fix: { rename: (name) => name.toLowerCase() },
  },
  {
    id: "ufetch-uppercase-auth-helper",
    library: "@rdsslab/uFetch",
    severity: "warning",
    autofixable: true,
    reason:
      "SetBasicAuthorization/ClearAuthorizationHeader/SetBasicAuthentication están deprecados en favor de su equivalente camelCase.",
    matcherType: "memberCallUppercaseVerb",
    match: {
      object: UFETCH_IDENTIFIERS,
      properties: [
        "SetBasicAuthorization",
        "ClearAuthorizationHeader",
        "SetBasicAuthentication",
      ],
    },
    fix: {
      rename: (name) => name.charAt(0).toLowerCase() + name.slice(1),
    },
  },
  {
    id: "ufetch-batch-positional",
    library: "@rdsslab/uFetch",
    severity: "warning",
    autofixable: false,
    reason:
      "batch(url, method, items, headers, options, config) con argumentos posicionales es el formato legacy; la firma actual espera un único objeto de configuración batch({...}).",
    matcherType: "positionalToObjectCall",
    match: {
      identifier: "batch",
      maxObjectArgs: 1,
    },
  },
];
