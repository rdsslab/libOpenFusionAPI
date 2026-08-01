/**
 * Detecta llamadas tipo `objeto.METODO(...)` donde METODO es una variante legacy
 * en mayúscula de un método que ahora existe en minúscula (ej. uFetch.GET -> uFetch.get).
 */
export function matchMemberCallUppercaseVerb(node, rule, aliases) {
  if (node.type !== "CallExpression") return null;

  const callee = node.callee;
  if (!callee || callee.type !== "MemberExpression" || callee.computed) return null;
  if (callee.object.type !== "Identifier") return null;

  const objectName = aliases?.get(callee.object.name) ?? callee.object.name;
  if (!rule.match.object.includes(objectName)) return null;
  if (callee.property.type !== "Identifier") return null;
  if (!rule.match.properties.includes(callee.property.name)) return null;

  const propertyName = callee.property.name;
  const replacement = rule.fix?.rename ? rule.fix.rename(propertyName) : null;

  return {
    node: callee.property,
    start: callee.property.start,
    end: callee.property.end,
    replacement,
  };
}
