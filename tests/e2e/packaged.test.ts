import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

test('built distribution launches with packaged native dependencies and isolated renderer', async () => {
  test.skip(process.platform !== 'win32', 'Actual Windows distribution evidence only');
  const executable = path.resolve('out/EyeCare-win32-x64/eyecare.exe');
  expect(existsSync(executable)).toBe(true);
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE' && entry[0] !== 'EYECARE_TEST_USER_DATA'));
  const desktop = await electron.launch({ executablePath: executable, args: [], env: environment });
  try {
    const page = await desktop.firstWindow();
    await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible();
    expect(await desktop.evaluate(({ app }) => app.isPackaged)).toBe(true);
    const snapshot = await page.evaluate(() => window.eyeCare.getSnapshot());
    expect(snapshot.capabilities.lock.state).toBe('available');
    expect(snapshot.capabilities.input.state).toBe('available');
    expect(await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)).toBe('undefined');
    expect(snapshot.settings.schemaVersion).toBe(1);
  } finally { await desktop.close(); }
});

test('installed Windows application starts, reads native state and exits cleanly', async () => {
  test.skip(process.platform !== 'win32', 'Actual Windows installation evidence only');
  const executable = path.join(process.env.LOCALAPPDATA ?? '', 'EyeCare/app-1.0.0/eyecare.exe');
  test.skip(!existsSync(executable), 'Run the generated installer before installed-app acceptance');
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE' && entry[0] !== 'EYECARE_TEST_USER_DATA'));
  const desktop = await electron.launch({ executablePath: executable, args: [], env: environment });
  try {
    const page = await desktop.firstWindow();
    await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible();
    expect(await desktop.evaluate(({ app }) => app.isPackaged)).toBe(true);
    const state = await page.evaluate(() => window.eyeCare.getSnapshot());
    expect(state.capabilities.lock.state).toBe('available');
    expect(state.capabilities.input.state).toBe('available');
    expect(state.settings.appearance.theme).toBe('system');
    expect(state.settings.reminder.soundEnabled).toBe(false);
    const samples = [];
    for (let index = 0; index < 3; index++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      samples.push(await desktop.evaluate(({ app }) => app.getAppMetrics().map(process => ({ type: process.type, cpuPercent: process.cpu.percentCPUUsage, workingSetKB: process.memory.workingSetSize, peakWorkingSetKB: process.memory.peakWorkingSetSize }))));
    }
    await writeFile('docs/performance-evidence.json', JSON.stringify({ recordedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, durationSeconds: 6, nativeLongRunVerified: false, samples }, null, 2));
  } finally { await desktop.close(); }
});
