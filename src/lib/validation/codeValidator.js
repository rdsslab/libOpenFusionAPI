import * as acorn from "acorn";
import { ALL_RULES } from "./rules/index.js";
import { matchMemberCallUppercaseVerb } from "./matchers/matchMemberCallUppercaseVerb.js";
import { matchRenamedIdentifierCall } from "./matchers/matchRenamedIdentifierCall.js";
import { matchPositionalToObjectCall } from "./matchers/matchPositionalToObjectCall.js";
import { createFunctionVM } from "../server/createFunctionVM.js";

const MATCHERS = {
  memberCallUppercaseVerb: matchMemberCallUppercaseVerb,
  renamedIdentifierCall: matchRenamedIdentifierCall,
  positionalToObjectCall: matchPositionalToObjectCall,
};

// Handlers cuyo `code` es JavaScript embebido ejecutado por el usuario y por lo
// tanto puede contener llamadas a librerías con APIs desactualizadas.
const APPLICABLE_HANDLERS = ["JS", "MONGODB", "TELEGRAM_BOT"];

// Ejecutar el código real durante un dry-run puede disparar efectos secundarios
// (conexiones a Telegram vía grammy, etc.). Se excluye de la ejecución dinámica.
const DRY_RUN_EXCLUDED_HANDLERS = ["TELEGRAM_BOT"];

function walkAst(node, visit) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walkAst(item, visit);
    return;
  }
  if (typeof node.type === "string") {
    visit(node);
  }
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
    const value = node[key];
    if (value && typeof value === "object") walkAst(value, visit);
  }
}

function toLocation(node) {
  if (!node?.loc?.start) return null;
  return { line: node.loc.start.line, column: node.loc.start.column };
}

function applyTextFixes(code, fixes) {
  // Se aplican de mayor a menor offset para no invalidar los índices ya calculados.
  const sorted = [...fixes].sort((a, b) => b.start - a.start);
  let result = code;
  for (const fix of sorted) {
    result = result.slice(0, fix.start) + fix.replacement + result.slice(fix.end);
  }
  return result;
}

async function runDryRun(code, app_vars) {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
  };

  let dryRunError = null;
  try {
    const fn = await createFunctionVM(code, app_vars || {});
    await fn({});
  } catch (error) {
    dryRunError = { message: error?.message || String(error) };
  } finally {
    console.warn = originalWarn;
  }

  return { executed: true, warnings, error: dryRunError };
}

/**
 * Analiza el código JS embebido de un handler (JS, MONGODB, TELEGRAM_BOT) en
 * busca de llamadas a APIs de librerías desactualizadas/renombradas, aplica
 * los autofixes seguros y opcionalmente lo ejecuta en el sandbox real para
 * capturar warnings de deprecación en tiempo de ejecución.
 */
export async function validateEndpointCode({
  handler,
  code,
  custom_data,
  dryRun = false,
  app_vars = {},
}) {
  if (!APPLICABLE_HANDLERS.includes(handler)) {
    return { applicable: false, handler, findings: [] };
  }

  if (typeof code !== "string" || code.length === 0) {
    return { applicable: true, handler, findings: [], autofixed: false, dry_run: { executed: false } };
  }

  let ast;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowReturnOutsideFunction: true,
      locations: true,
    });
  } catch (error) {
    return {
      applicable: true,
      handler,
      findings: [
        {
          ruleId: "code-parse-error",
          severity: "error",
          autofixable: false,
          reason: `No se pudo analizar el código como JavaScript válido: ${error.message}`,
          location: null,
          source: "static",
        },
      ],
      autofixed: false,
      requires_manual_review: ["code-parse-error"],
      dry_run: { executed: false },
    };
  }

  const findings = [];
  const textFixes = [];

  walkAst(ast, (node) => {
    if (node.type !== "CallExpression") return;

    for (const rule of ALL_RULES) {
      const matcher = MATCHERS[rule.matcherType];
      if (!matcher) continue;

      const match = matcher(node, rule);
      if (!match) continue;

      findings.push({
        ruleId: rule.id,
        library: rule.library,
        severity: rule.severity,
        autofixable: rule.autofixable && match.replacement != null,
        reason: rule.reason,
        location: toLocation(match.node),
        source: "static",
      });

      if (rule.autofixable && match.replacement != null) {
        textFixes.push({ start: match.start, end: match.end, replacement: match.replacement });
      }
    }
  });

  const autofixed = textFixes.length > 0;
  const fixed_code = autofixed ? applyTextFixes(code, textFixes) : code;

  let dry_run = { executed: false };
  if (dryRun && !DRY_RUN_EXCLUDED_HANDLERS.includes(handler)) {
    dry_run = await runDryRun(fixed_code, app_vars);
    for (const warning of dry_run.warnings) {
      findings.push({
        ruleId: "runtime-deprecation-warning",
        severity: "warning",
        autofixable: false,
        reason: warning,
        location: null,
        source: "runtime",
      });
    }
  }

  return {
    applicable: true,
    handler,
    findings,
    autofixed,
    fixed_code: autofixed ? fixed_code : undefined,
    requires_manual_review: findings.filter((f) => !f.autofixable).map((f) => f.ruleId),
    dry_run,
  };
}
