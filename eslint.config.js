import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/drizzle/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Spec §49: strict TypeScript, avoid `any`.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],

      // The test harness exports `createTestDatabase`, which opens an
      // admin-privileged connection using `DATABASE_URL` verbatim and issues
      // `CREATE DATABASE`. In a deployed artifact that is the production
      // cluster. Importing it from anything other than a test file puts that
      // reachable in shipped code.
      //
      // Stated precisely, because the scarier version is wrong: this is not a
      // path to dropping the production database. The only name ever dropped
      // is a freshly generated `luma_test_<uuid>`, and `dropDatabase` is
      // private to the module. The realistic damage is an admin connection
      // against the live cluster and a stray database created there.
      //
      // What makes it worth a rule is that the failure has no CI symptom at
      // all: it typechecks, lints, builds and deploys clean. Nothing else in
      // the pipeline would catch it.
      //
      // The harness also throws at import time when CI is set without
      // DATABASE_URL, so a non-test consumer would widen that failure beyond
      // the test job. That is the lesser reason: `tsc` typechecks the module
      // without executing it, so only `next build` could trip it, and only
      // with DATABASE_URL absent, which never holds in production.
      //
      // The typescript-eslint version rather than the base rule, because the
      // base rule does not see `import type`.
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Matched against the import specifier as written, not a
              // resolved path, so every shape it can be written in has to be
              // listed: the package entry point, a relative path from another
              // package, and a sibling import from inside `testing/` itself.
              group: [
                '@luma/db/testing',
                '**/testing/harness',
                '**/testing/harness.js',
                './harness',
                './harness.js',
              ],
              message:
                'The test harness opens an admin database connection and issues CREATE DATABASE. Importing it outside a test file makes that reachable from shipped code, and nothing in the pipeline would catch it. Move the helper you need into a non-test module, or import it from a *.test.ts file.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/fixtures/**', '**/scripts/**'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Deliberately narrower than the `no-console` override above, which also
    // covers `fixtures/**` and `scripts/**`. Those are exactly where an
    // unguarded harness import would appear — a seed helper is the likeliest
    // offender — so exempting them would punch a hole in the wall this rule is
    // building. Test files only.
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
    },
  },
  prettier,
);
