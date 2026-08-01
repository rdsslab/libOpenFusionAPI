export const promiseSequence_rules = [
  {
    id: "sequential-promises-renamed",
    library: "@rdsslab/sequential-promises",
    severity: "warning",
    autofixable: true,
    reason: "sequentialPromises está deprecado; el reemplazo actual es PromiseSequence.",
    matcherType: "renamedIdentifierCall",
    match: { identifier: "sequentialPromises" },
    fix: { replacement: "PromiseSequence" },
  },
];
