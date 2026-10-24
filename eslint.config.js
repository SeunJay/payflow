// Typed linting. typescript-eslint cannot load TypeScript 7 yet, so the root
// `typescript` dependency is the TS 6 API (`@typescript/typescript6`); every
// package still typechecks with its own TS 7 `tsc`.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/', '**/migrations/', 'coverage/', '.claude/'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Named exports only (AGENTS.md)
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportDefaultDeclaration', message: 'Use a named export.' },
        { selector: 'ClassDeclaration', message: 'Use plain functions and data; AppError is the one class.' },
      ],
    },
  },
  {
    // Tools that require a default export
    files: ['**/*.config.{ts,js,cjs}', '.dependency-cruiser.cjs'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['packages/shared/src/errors.ts'],
    rules: {
      'no-restricted-syntax': ['error', { selector: 'ExportDefaultDeclaration', message: 'Use a named export.' }],
    },
  },
  {
    files: ['**/*.{js,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'writable', require: 'readonly' } },
  },
  prettier,
);
