// Vitest workspace: run every package's tests from the repo root.
// fixtures/* are source-only and carry no test suites of their own — their
// goldens are exercised by the owning extractor package's fixture tests.
export default ["packages/*"];
