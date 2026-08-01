/**
 * Detecta llamadas legacy con firma posicional que en la versión actual de la
 * librería esperan un único objeto de configuración (ej. batch(url, method, ...) -> batch({...})).
 * No genera autofix: reordenar argumentos posicionales a un objeto requiere
 * decisión humana sobre el mapeo de cada posición.
 */
export function matchPositionalToObjectCall(node, rule) {
  if (node.type !== "CallExpression") return null;

  const callee = node.callee;
  let calleeName = null;
  if (callee.type === "Identifier") {
    calleeName = callee.name;
  } else if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
    calleeName = callee.property.name;
  }

  if (calleeName !== rule.match.identifier) return null;

  const firstArg = node.arguments[0];
  const looksPositional =
    node.arguments.length > (rule.match.maxObjectArgs ?? 1) &&
    (!firstArg || firstArg.type !== "ObjectExpression");

  if (!looksPositional) return null;

  return {
    node,
    start: node.start,
    end: node.end,
    replacement: null,
  };
}
