/**
 * Detecta llamadas a un identificador (función global expuesta en el sandbox)
 * que fue renombrado o reemplazado por otra función (ej. sequentialPromises -> PromiseSequence).
 */
export function matchRenamedIdentifierCall(node, rule) {
  if (node.type !== "CallExpression") return null;

  const callee = node.callee;
  if (!callee || callee.type !== "Identifier") return null;
  if (callee.name !== rule.match.identifier) return null;

  const replacement = rule.autofixable && rule.fix?.replacement ? rule.fix.replacement : null;

  return {
    node: callee,
    start: callee.start,
    end: callee.end,
    replacement,
  };
}
