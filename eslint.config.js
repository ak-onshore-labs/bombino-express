// @ts-check
/**
 * Warnings first, on purpose.
 *
 * The codebase has never had a linter, so a wall of errors would only teach
 * everyone to pass `--no-verify`. Every rule here starts as a warning: the
 * signal is visible, `npm run lint` still exits 0, and nothing blocks a branch
 * mid-feature. Promote a rule to "error" once its count is at zero, and add
 * `--max-warnings` to CI once the total is small enough to hold.
 *
 * Formatting is Prettier's job — `eslint-config-prettier` last switches off
 * every stylistic rule so the two never argue.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'client/src/components/ui/**', // vendored shadcn primitives
      'attached_assets/**',
      'migrations/**',
      '**/*.mjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      // The codebase is deliberately strict about `any`; keep it that way, but
      // as a warning until the last few bridges are typed.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // A floating promise in a route handler is how a request hangs; see
      // server/routeGuards.ts. Needs type information, so it lives in the
      // typed block below.
      'no-console': 'off', // the server logs deliberately, with [module] prefixes
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart'],
    },
  },

  {
    files: ['client/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      // A test fakes an Express response or a session; typing those fully adds
      // nothing to what the test proves.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  prettier,
);
