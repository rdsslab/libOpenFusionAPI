/**
 * Detects grammY's silent middleware-chain halt: a handler registered as
 * `$BOT.on("callback_query:data", ...)` that does a bare `return` after a guard
 * on the callback data WITHOUT calling `next()`.
 *
 * In grammY every handler of the same update type forms ONE middleware chain:
 * a handler that returns without calling `next()` halts the chain silently —
 * no error, no log, nothing registered after it ever runs (the button "spins"
 * and then nothing happens). Pattern filters (`$BOT.callbackQuery(...)`) are
 * immune because the composer skips non-matching data by itself.
 */

const SKIP_KEYS = new Set(["loc", "start", "end", "range"]);

// Depth-first walk discarding source-location noise.
function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (typeof node.type === "string") visit(node);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (value && typeof value === "object") walk(value, visit);
  }
}

// Like walk() but does not descend into nested functions: a `return;` inside a
// .map()/.forEach() callback cannot halt the handler's own middleware chain.
function walkExceptNestedFunctions(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkExceptNestedFunctions(item, visit);
    return;
  }
  if (typeof node.type === "string") {
    if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") return;
    visit(node);
  }
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (value && typeof value === "object") walkExceptNestedFunctions(value, visit);
  }
}

const isMemberProperty = (node, name) =>
  node.type === "MemberExpression" &&
  !node.computed &&
  node.property?.type === "Identifier" &&
  node.property.name === name;

// Local variable names the handler binds from ctx.callbackQuery.data, e.g.
// `const data = String(ctx.callbackQuery?.data || "")` or
// `const action = ctx.callbackQuery.data;`.
function collectDataVariableNames(fnNode) {
  const names = new Set();
  walkExceptNestedFunctions(fnNode.body, (node) => {
    if (node.type !== "VariableDeclarator" || node.id?.type !== "Identifier") return;
    let readsCallbackData = false;
    walk(node.init, (n) => {
      if (isMemberProperty(n, "data")) readsCallbackData = true;
    });
    if (readsCallbackData) names.add(node.id.name);
  });
  return names;
}

function testReferencesAnyOf(test, names) {
  if (!test || names.size === 0) return false;
  let found = false;
  walkExceptNestedFunctions(test, (node) => {
    if (node.type === "Identifier" && names.has(node.name)) found = true;
  });
  return found;
}

// Bare `return;` (no argument) that is the direct consequent/alternate of an if
// whose test inspects the callback data: the guard-and-return anti-pattern.
function collectGuardReturns(fnBody, dataNames) {
  const returns = [];
  walkExceptNestedFunctions(fnBody, (node) => {
    if (node.type !== "IfStatement" || !testReferencesAnyOf(node.test, dataNames)) return;
    for (const branch of [node.consequent, node.alternate]) {
      if (!branch) continue;
      const ret =
        branch.type === "ReturnStatement"
          ? branch
          : branch.type === "BlockStatement" &&
            branch.body.length === 1 &&
            branch.body[0].type === "ReturnStatement"
            ? branch.body[0]
            : null;
      if (ret && ret.argument === null) returns.push(ret);
    }
  });
  return returns;
}

/**
 * Static findings for the `grammy-callback-chain-halt` rule.
 *
 * @param {object} ast acorn AST of the code being validated.
 * @returns {Array<object>} findings with the validator's schema.
 */
export function collectCallbackChainHaltFindings(ast) {
  const findings = [];
  const registered = [];

  walk(ast, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = node.callee;
    if (!callee || callee.type !== "MemberExpression" || callee.computed) return;
    if (callee.object?.type !== "Identifier" || callee.object.name !== "$BOT") return;
    if (!isMemberProperty(callee, "on")) return;
    const typeArg = node.arguments[0];
    if (!typeArg || typeArg.type !== "Literal" || typeof typeArg.value !== "string") return;
    if (!String(typeArg.value).startsWith("callback_query")) return;
    const fnNode = node.arguments[1];
    if (!fnNode || (fnNode.type !== "ArrowFunctionExpression" && fnNode.type !== "FunctionExpression")) return;
    registered.push(fnNode);
  });

  for (const fnNode of registered) {
    let usesNext = false;
    walkExceptNestedFunctions(fnNode.body, (n) => {
      if (n.type === "Identifier" && n.name === "next") usesNext = true;
    });
    if (usesNext) continue; // guard-and-return handled: next() propagated.

    const dataNames = collectDataVariableNames(fnNode);
    for (const ret of collectGuardReturns(fnNode.body, dataNames)) {
      findings.push({
        ruleId: "grammy-callback-chain-halt",
        severity: "warning",
        autofixable: false,
        reason:
          "callback_query handler does a bare return after a data guard without calling next(). In grammY all handlers of one update type share a single middleware chain, so this return halts it silently and every handler registered after this one is skipped (the button spins and nothing happens). Use pattern filters ($BOT.callbackQuery(...)) or propagate await next() before returning.",
        location: ret.loc?.start ? { line: ret.loc.start.line, column: ret.loc.start.column } : null,
        source: "static",
      });
    }
  }

  return findings;
}