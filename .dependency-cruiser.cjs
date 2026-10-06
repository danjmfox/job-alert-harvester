/** DR-0013: the layering rules. Run by `npm run check:arch`, `pretest` and tests/architecture/layering.test.mjs. */
const CAPABILITY_ADAPTERS = '^src/adapters/(gmail-api-source|sheets-target|sheet-provisioner)\\.mjs$';
const SPAWNING_ADAPTERS = '^src/adapters/(launchctl|git-checkout)\\.mjs$';

module.exports = {
  forbidden: [
    {
      name: 'core-imports-no-node-builtin',
      severity: 'error',
      comment: 'src/core is pure: no node: builtin.',
      from: { path: '^src/core/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'core-imports-no-adapter',
      severity: 'error',
      from: { path: '^src/core/' },
      to: { path: '^src/adapters/' },
    },
    {
      name: 'core-imports-no-cli',
      severity: 'error',
      from: { path: '^src/core/' },
      to: { path: '^src/cli/' },
    },
    {
      name: 'adapter-imports-no-sibling-adapter',
      severity: 'error',
      comment: 'An adapter may import itself and core, never another adapter.',
      from: { path: '^src/adapters/([^/]+)$' },
      to: { path: '^src/adapters/', pathNot: '^src/adapters/$1$' },
    },
    {
      name: 'capability-adapter-imports-no-node-module',
      severity: 'error',
      comment: 'These adapters receive capabilities as arguments; they import no node: module.',
      from: { path: CAPABILITY_ADAPTERS },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'child-process-confined-to-spawning-adapters',
      severity: 'error',
      comment: 'Only the launchctl and git-checkout adapters may spawn processes.',
      from: { path: '^src/', pathNot: SPAWNING_ADAPTERS },
      to: { path: '^(node:)?child_process$', dependencyTypes: ['core'] },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: false,
  },
};
