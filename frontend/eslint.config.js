// Flat config (ESLint 9). Type-aware rules are deliberately off: `tsc` already
// runs in CI and covers what they would catch, without the extra minute.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'test-results',
      'playwright-report',
      'src/api/schema.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    settings: { react: { version: 'detect' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // The new JSX transform means React need not be in scope.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Non-null assertions are used deliberately where a canvas context or a
      // matching par row is guaranteed by construction.
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Build-time Node scripts (e.g. the Netlify redirects generator).
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
)
