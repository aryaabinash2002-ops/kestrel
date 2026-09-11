import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  URL: 'readonly',
  performance: 'readonly',
};

export default tseslint.config(
  { ignores: ['node_modules/**', 'out/**', 'dist/**', 'release/**', 'extension/dist/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: nodeGlobals },
  },
  {
    files: ['extension/public/**/*.js'],
    languageOptions: { globals: { AudioWorkletProcessor: 'readonly', registerProcessor: 'readonly' } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'preserve-caught-error': 'off',
    },
  },
);
