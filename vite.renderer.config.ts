import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig(({ command }) => ({ root: 'app/renderer', base: './', plugins: [react(), { name: 'eyecare-dev-csp', transformIndexHtml: html => command === 'serve' ? html.replace("script-src 'self'", "script-src 'self' 'nonce-eyecare-development'") : html }], html: { cspNonce: command === 'serve' ? 'eyecare-development' : undefined }, server: { host: '127.0.0.1' }, build: { outDir: '../../dist', emptyOutDir: true, rollupOptions: { input: { main: resolve('app/renderer/index.html'), overlay: resolve('app/renderer/overlay.html') } } } }));
