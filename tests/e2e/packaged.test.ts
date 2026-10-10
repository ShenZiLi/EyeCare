import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { version } from '../../package.json';

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
  const executable = path.join(process.env.LOCALAPPDATA ?? '', `EyeCare/app-${version}/eyecare.exe`);
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
    const original = structuredClone(state.settings);
    const launcher = path.join(process.env.LOCALAPPDATA ?? '', 'EyeCare/eyecare.exe');
    try {
      const enabled = structuredClone(original);
      enabled.general.launchAtLogin = true;
      const saved = await page.evaluate(async settings => { const current = await window.eyeCare.getSnapshot(); return window.eyeCare.saveSettings(current.settingsRevision, settings); }, enabled);
      expect(saved.ok).toBe(true);
      const login = await desktop.evaluate(({ app }, launcher) => app.getLoginItemSettings({ path: launcher, args: [] }), launcher);
      expect(login.openAtLogin).toBe(true);
      expect(login.executableWillLaunchAtLogin).toBe(true);
      expect(login.launchItems).toContainEqual({ name: 'org.eyecare.desktop', path: launcher, args: [], scope: 'user', enabled: true });
    } finally {
      const restored = await page.evaluate(async settings => { const current = await window.eyeCare.getSnapshot(); return window.eyeCare.saveSettings(current.settingsRevision, settings); }, original);
      expect(restored.ok).toBe(true);
      expect(await desktop.evaluate(({ app }, launcher) => app.getLoginItemSettings({ path: launcher, args: [] }).openAtLogin, launcher)).toBe(original.general.launchAtLogin);
    }
    const samples = [];
    for (let index = 0; index < 3; index++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      samples.push(await desktop.evaluate(({ app }) => app.getAppMetrics().map(process => ({ type: process.type, cpuPercent: process.cpu.percentCPUUsage, workingSetKB: process.memory.workingSetSize, peakWorkingSetKB: process.memory.peakWorkingSetSize }))));
    }
    await writeFile('docs/performance-evidence.json', JSON.stringify({ recordedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, durationSeconds: 6, nativeLongRunVerified: false, samples }, null, 2));
  } finally { await desktop.close(); }
});

for (const enabled of [true, false]) {
  test(`installed upgrade migrates a legacy startup entry while preserving system enabled=${enabled}`, async () => {
    test.skip(process.platform !== 'win32', 'Actual Windows startup migration evidence only');
    const root = path.join(process.env.LOCALAPPDATA ?? '', 'EyeCare');
    const executable = path.join(root, `app-${version}/eyecare.exe`);
    const launcher = path.join(root, 'eyecare.exe');
    test.skip(!existsSync(executable), 'Install the current build first');
    const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE' && entry[0] !== 'EYECARE_TEST_USER_DATA'));
    const launch = () => electron.launch({ executablePath: executable, args: [], env: environment });
    let desktop = await launch();
    let page = await desktop.firstWindow();
    const original = (await page.evaluate(() => window.eyeCare.getSnapshot())).settings;
    const originalLogin = await desktop.evaluate(({ app }, launcher) => app.getLoginItemSettings({ path: launcher, args: [] }), launcher);
    try {
      const settings = structuredClone(original); settings.general.launchAtLogin = true;
      expect((await page.evaluate(async settings => { const state = await window.eyeCare.getSnapshot(); return window.eyeCare.saveSettings(state.settingsRevision, settings); }, settings)).ok).toBe(true);
      const legacy = path.join(root, 'app-0.0.0/eyecare.exe');
      await desktop.evaluate(({ app }, value) => app.setLoginItemSettings({ openAtLogin: true, name: 'org.eyecare.desktop', path: value.legacy, args: [], enabled: value.enabled }), { legacy, enabled });
      // The old folder is intentionally absent: an upgrade may already remove it.
      expect(existsSync(legacy)).toBe(false);
      await desktop.close();
      desktop = await launch(); page = await desktop.firstWindow();
      await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible();
      const login = await desktop.evaluate(({ app }, launcher) => app.getLoginItemSettings({ path: launcher, args: [] }), launcher);
      expect(login.launchItems).toContainEqual({ name: 'org.eyecare.desktop', path: launcher, args: [], scope: 'user', enabled });
      const snapshot = await page.evaluate(() => window.eyeCare.getSnapshot());
      expect(snapshot.settings.general.launchAtLogin).toBe(true);
      expect(snapshot.warnings.some(message => message.includes('启动项升级'))).toBe(false);
    } finally {
      const restored = await page.evaluate(async settings => { const state = await window.eyeCare.getSnapshot(); return window.eyeCare.saveSettings(state.settingsRevision, settings); }, original);
      expect(restored.ok).toBe(true);
      await desktop.evaluate(({ app }, value) => app.setLoginItemSettings({ openAtLogin: value.originalLogin.openAtLogin, name: 'org.eyecare.desktop', path: value.launcher, args: [], enabled: value.originalLogin.launchItems.find(item => item.name === 'org.eyecare.desktop' && item.scope === 'user')?.enabled ?? true }), { originalLogin, launcher });
      await desktop.close();
    }
  });
}
