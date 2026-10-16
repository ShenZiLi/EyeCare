import tseslint from 'typescript-eslint';
export default tseslint.config({ ignores: ['node_modules/**', 'out/**', 'src-tauri/target/**', 'dist/**', '.vite/**', '.trellis/**', '.agents/**', '.codex/**', 'test-results/**', 'playwright-report/**'] }, ...tseslint.configs.recommended, { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }] } });
