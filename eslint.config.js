const js = require('@eslint/js');
const globals = require('globals');
const reactHooks = require('eslint-plugin-react-hooks');

module.exports = [
  {
    ignores: [
      'build/**',
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'VispNote/**',
      'OminiNote/**',
      'MyNote/**',
    ],
  },
  {
    files: ['main.js', 'main/**/*.js', 'preload.js', 'lib/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', 'src/**/*.js', 'src/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.node,
        ...globals.browser,
        React: 'readonly',
        ReactDOM: 'readonly',
        NodeFilter: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-undef': 'error',
      'no-redeclare': 'off',
      'no-useless-assignment': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-regex-spaces': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['src/**/*.jsx'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        React: 'readonly',
        ReactDOM: 'readonly',
        NodeFilter: 'readonly',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-undef': 'error',
      'no-redeclare': 'off',
      'no-useless-assignment': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-regex-spaces': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['src/**/*.{js,jsx,mjs}'],
    languageOptions: {
      sourceType: 'module',
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'no-undef': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['main/**/*.js', 'lib/connectors/**/*.js'],
    rules: {
      'no-undef': 'error',
    },
  },
];
