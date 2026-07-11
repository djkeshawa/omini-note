const js = require('@eslint/js');
const globals = require('globals');

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
    files: ['main.js', 'main/**/*.js', 'preload.js', 'lib/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', 'src/**/*.js'],
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
      'no-undef': 'off',
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
      'no-undef': 'off',
      'no-redeclare': 'off',
      'no-useless-assignment': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-regex-spaces': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    files: ['src/platform/**/*.js', 'src/features/**/*.js', 'src/app/actions/**/*.js'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    files: ['main/**/*.js', 'lib/connectors/**/*.js'],
    rules: {
      'no-undef': 'error',
    },
  },
];
