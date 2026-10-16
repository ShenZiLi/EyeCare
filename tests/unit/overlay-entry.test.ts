import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { expect, it } from 'vitest';

it('builds a distinct parser-transparent overlay document at the native URL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eyecare-overlay-'));
  try {
    await build({ configFile: resolve('vite.renderer.config.ts'), logLevel: 'silent', build: { outDir: directory } });
    const overlay = await readFile(join(directory, 'overlay.html'), 'utf8');
    const main = await readFile(join(directory, 'index.html'), 'utf8');
    const native = await readFile('src-tauri/src/reminders.rs', 'utf8');
    expect(native).toContain('WebviewUrl::App("overlay.html?surface=overlay".into())');
    expect(overlay).toMatch(/<html[^>]*data-surface="overlay"/);
    expect(overlay).toMatch(/<body[^>]*data-surface="overlay"/);
    expect(overlay).toMatch(/html\[data-surface="overlay"\][^{]*body[^{}]*#root\s*\{[^}]*background:\s*transparent\s*!important;[^}]*color-scheme:\s*normal\s*!important;/);
    expect(overlay.indexOf('<style>')).toBeLessThan(overlay.indexOf('<script'));
    expect(main).not.toContain('data-surface="overlay"');
    expect(main).not.toContain('background: transparent !important');
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 20000);
