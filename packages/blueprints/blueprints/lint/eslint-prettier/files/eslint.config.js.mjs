import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['coverage/**', 'node_modules/**'] },
  eslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  prettier,
];
