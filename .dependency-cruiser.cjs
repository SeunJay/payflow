// The import rules from spec 0001 (docs/specs/0001-stack-architecture/index.md,
// "Dependency rules"). Run with `pnpm lint:deps`.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'apps-not-to-other-apps',
      comment: 'Apps never import each other',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    {
      name: 'packages-not-to-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'simulator-not-to-core',
      comment: 'The simulator is an outside company',
      severity: 'error',
      from: { path: '^apps/simulator/' },
      to: { path: '^packages/core/' },
    },
    {
      name: 'worker-not-to-http',
      comment: '@payflow/http is the Express shell for the api and the simulator only',
      severity: 'error',
      from: { path: '^apps/worker/' },
      to: { path: '^packages/http/' },
    },
    {
      name: 'http-only-to-shared',
      comment: '@payflow/http has no domain imports (test-utils-only-from-tests guards its tests)',
      severity: 'error',
      from: { path: '^packages/http/' },
      to: { path: '^packages/', pathNot: '^packages/(http|shared|test-utils)/' },
    },
    {
      name: 'shared-imports-nothing',
      severity: 'error',
      from: { path: '^packages/shared/' },
      to: { path: '^packages/', pathNot: '^packages/(shared|test-utils)/' },
    },
    {
      name: 'core-modules-through-index',
      comment: 'A core module reaches another only through its index.ts (or its schema.ts, to declare a foreign key)',
      severity: 'error',
      from: { path: '^packages/core/src/modules/([^/]+)/' },
      to: {
        path: '^packages/core/src/modules/[^/]+/',
        pathNot: ['^packages/core/src/modules/$1/', '^packages/core/src/modules/[^/]+/(index|schema)\\.ts$'],
      },
    },
    // The api feature layout (docs/specs/0005-api-feature-folder-layout.md, "Enforcement").
    // Test files and test-support.ts are exempt: race tests call core inside held transactions.
    {
      name: 'api-features-isolated',
      comment: 'An api feature never imports another feature; shared code goes in apps/api/src/http/',
      severity: 'error',
      from: { path: '^apps/api/src/features/([^/]+)/', pathNot: ['\\.test\\.ts$'] },
      to: { path: '^apps/api/src/features/', pathNot: '^apps/api/src/features/$1/' },
    },
    {
      name: 'api-features-through-index',
      comment: 'Outside features/, the api reaches a feature only through its index.ts',
      severity: 'error',
      from: { path: '^apps/api/src/', pathNot: ['^apps/api/src/features/', '\\.test\\.ts$', '/test-support\\.ts$'] },
      to: { path: '^apps/api/src/features/[^/]+/', pathNot: '^apps/api/src/features/[^/]+/index\\.ts$' },
    },
    {
      name: 'api-controllers-and-routes-no-core-values',
      comment: 'Controllers and routes import @payflow/core for types only; values come through their service',
      severity: 'error',
      from: { path: '^apps/api/src/features/[^/]+/[^/]+\\.(controller|routes)\\.ts$' },
      to: { path: '^packages/core/', dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'api-services-no-http',
      comment: 'A use case service knows nothing of Express, cookies, or the api http plumbing',
      severity: 'error',
      from: { path: '^apps/api/src/features/[^/]+/[^/]+\\.service\\.ts$' },
      to: { path: ['node_modules/(express|cookie-parser)/', '^apps/api/src/http/'] },
    },
    {
      name: 'test-utils-only-from-tests',
      severity: 'error',
      comment: 'Test files and the test-support.ts helpers beside them only',
      from: { path: '^(apps|packages)/', pathNot: ['\\.test\\.ts$', '/test-support\\.ts$', '^packages/test-utils/'] },
      to: { path: '^packages/test-utils/' },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)migrations/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js', '.json'],
    },
  },
};
