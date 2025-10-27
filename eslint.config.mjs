import js from '@eslint/js';
import globals from 'globals';

const isProduction = process.env.NODE_ENV === 'production';

export default [
  {
    ignores: ['node_modules/', 'dist/', 'build/', 'coverage/', '*.min.js', '.env*', 'eslint.config.mjs']
  },

  js.configs.recommended,

  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022
      }
    },
    rules: {
      'no-console': isProduction ? 'warn' : 'off',
      'no-debugger': isProduction ? 'warn' : 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-arrow-callback': 'error',
      'prefer-template': 'error',
      'template-curly-spacing': ['error', 'never'],
      'arrow-spacing': 'error',
      'comma-dangle': ['error', 'never'],
      'semi': ['error', 'always'],
      'quotes': ['error', 'single'],
      'indent': ['error', 2],
      'space-before-function-paren': ['error', 'always'],
      'keyword-spacing': 'error',
      'space-infix-ops': 'error',
      'eol-last': 'error',
      'no-trailing-spaces': 'error',
      'no-multiple-empty-lines': ['error', { max: 2 }],
      'brace-style': ['error', '1tbs', { allowSingleLine: true }],
      'curly': ['error', 'multi-line'],
      'dot-location': ['error', 'property'],
      'key-spacing': ['error', { beforeColon: false, afterColon: true }],
      'new-cap': ['error', { newIsCap: true, capIsNew: false }],
      'no-multi-spaces': 'error',
      'no-whitespace-before-property': 'error',
      'padded-blocks': ['error', 'never'],
      'space-before-blocks': 'error',
      'space-in-parens': ['error', 'never'],
      'spaced-comment': ['error', 'always', { exceptions: ['-', '*'] }]
    }
  }
];
