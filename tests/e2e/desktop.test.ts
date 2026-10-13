import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { RuntimeSnapshot, SettingsV2 } from '../../app/shared/contracts';

const rgb = (value: string): number[] => value.match(/[\d.]+/g)!.map(Number);
const over = (front: number[], back: number[]): number[] => front.slice(0, 3).map((value, index) => value * (front[3] ?? 1) + back[index] * (1 - (front[3] ?? 1)));
const luminance = (color: number[]): number => color.slice(0, 3).map(value => { const v = value / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (a: number[], b: number[]): number => { const left = luminance(a); const right = luminance(b); return (Math.max(left, right) + .05) / (Math.min(left, right) + .05); };

let desktop: ElectronApplication;
let page: Page;
let dataDirectory: string;
const screenshot = (name: string) => `docs/screenshots/${process.platform === 'darwin' ? 'macos-' : ''}${name}.png`;
const snapshot = () => page.evaluate(() => window.eyeCare.getSnapshot());
const save = (revision: number, settings: SettingsV2) => page.evaluate(({ revision, settings }) => window.eyeCare.saveSettings(revision, settings), { revision, settings });

test.beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'eyecare-e2e-'));
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE'));
  desktop = await electron.launch({ args: [path.resolve('.')], env: { ...environment, EYECARE_TEST_USER_DATA: dataDirectory } });
  page = await desktop.firstWindow();
  await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible();
  await expect.poll(async () => (await snapshot()).status).not.toBe('starting');
});
test.afterEach(async () => { try { await desktop?.close(); } finally { if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true }); } });

test('native app launches with isolated renderer and documented defaults', async () => {
  const current = await snapshot();
  expect(current.settings.schemaVersion).toBe(2);
  expect(current.settings.timer.intervalMinutes).toBe(30);
  expect(current.settings.timer.mode).toBe('active');
  expect(current.settings.reminder.visual).toBe('flash');
  expect(current.settings.reminder.soundEnabled).toBe(false);
  expect(current.settings.appearance.theme).toBe('system');
  expect(current.settings.appearance.showTrayCountdown).toBe(true);
  expect(await page.evaluate(() => ({ node: typeof (window as unknown as { require?: unknown }).require, process: typeof (window as unknown as { process?: unknown }).process }))).toEqual({ node: 'undefined', process: 'undefined' });
  expect(current.capabilities.lock.state).toBe('available');
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({ path: screenshot('overview-system') });
});

test('theme/countdown preferences save immediately, preserve pause, survive restart', async () => {
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const paused = await snapshot();
  expect(paused.status).toBe('paused');
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await page.getByRole('button', { name: '概览', exact: true }).click();
  await page.evaluate(() => window.eyeCare.openSettings());
  await expect(page.getByRole('heading', { name: '通用设置', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '暗色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(async () => (await snapshot()).settings.appearance.theme).toBe('dark');
  await page.getByRole('switch', { name: /在托盘显示倒计时/ }).click();
  await expect.poll(async () => (await snapshot()).settings.appearance.showTrayCountdown).toBe(false);
  const after = await snapshot();
  expect(after.status).toBe('paused'); expect(after.elapsedActiveMs).toBe(paused.elapsedActiveMs);
  await page.getByRole('switch', { name: /在托盘显示倒计时/ }).focus();
  expect(await page.evaluate(() => { const input = document.querySelector<HTMLInputElement>('input[role="switch"]:focus')!; const field = input.getBoundingClientRect(); return field.bottom <= window.innerHeight && field.top >= 0; })).toBe(true);
  await page.screenshot({ path: screenshot('settings-dark') });
  const persisted = JSON.parse(await readFile(path.join(dataDirectory, 'settings.json'), 'utf8'));
  expect(JSON.stringify(persisted)).toContain('dark');
  await desktop.close();
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE'));
  desktop = await electron.launch({ args: [path.resolve('.')], env: { ...environment, EYECARE_TEST_USER_DATA: dataDirectory } });
  page = await desktop.firstWindow();
  await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect((await snapshot()).settings.appearance.showTrayCountdown).toBe(false);
  expect((await snapshot()).status).not.toBe('paused');
});

test('invalid drafts stay visible; saved configuration remains valid; minimum window fits', async () => {
  await page.getByRole('button', { name: '触发条件', exact: true }).click();
  const input = page.getByRole('spinbutton', { name: /提醒间隔/ });
  await input.fill('0');
  await expect(page.getByRole('button', { name: '保存设置', exact: true })).toHaveCount(0);
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(input).toHaveValue('0');
  expect((await snapshot()).settings.timer.intervalMinutes).toBe(30);
  await page.getByRole('button', { name: '提醒方式', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('radio', { name: /确认蒙版/ }).check();
  await expect.poll(async () => (await snapshot()).settings.reminder.visual).toBe('mask');
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await page.getByRole('button', { name: '暗色', exact: true }).click();
  await expect.poll(async () => (await snapshot()).settings.appearance.theme).toBe('dark');
  await page.getByRole('button', { name: '触发条件', exact: true }).click();
  await expect(input).toHaveValue('0');
  await input.fill('31');
  await expect.poll(async () => (await snapshot()).settings.timer.intervalMinutes).toBe(31);
  await desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(window => window.getTitle().includes('EyeCare'))?.setSize(640, 520); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: screenshot('trigger-compact') });
});

test('preview mask does not confirm rest; real mask confirms once; Escape skips', async () => {
  const current = await snapshot();
  const settings = structuredClone(current.settings); settings.reminder.visual = 'mask'; settings.timer.mode = 'fixed'; settings.timer.longIdleMinutes = 120; settings.appearance.theme = 'light';
  expect((await save(current.settingsRevision, settings)).ok).toBe(true);
  const before = await snapshot();
  const previewWindow = desktop.waitForEvent('window');
  expect((await page.evaluate(settings => window.eyeCare.preview(settings), settings)).ok).toBe(true);
  const preview = await previewWindow;
  await expect(preview.getByRole('button', { name: '知道了', exact: true })).toBeVisible();
  await preview.getByRole('button', { name: '知道了', exact: true }).click();
  await expect.poll(async () => (await snapshot()).restConfirmedCount).toBe(before.restConfirmedCount);
  const realWindow = desktop.waitForEvent('window');
  expect((await page.evaluate(() => window.eyeCare.remindNow())).ok).toBe(true);
  const mask = await realWindow;
  await expect(mask.getByRole('button', { name: '知道了', exact: true })).toBeVisible();
  await expect(mask.getByRole('button', { name: /分钟后提醒/ })).toHaveCount(0);
  const event = await mask.evaluate(() => window.eyeCare.getOverlay());
  await mask.screenshot({ path: screenshot('mask-light') });
  const colors = await mask.evaluate(() => ({ panel: getComputedStyle(document.querySelector('.rest-panel')!).backgroundColor, veil: getComputedStyle(document.querySelector('.rest-backdrop')!).backgroundColor, primary: getComputedStyle(document.querySelector('.rest-panel h1')!).color, secondary: getComputedStyle(document.querySelector('#rest-description')!).color }));
  for (const desktopColor of [[0, 0, 0], [255, 255, 255]]) {
    const surface = over(rgb(colors.panel), over(rgb(colors.veil), desktopColor));
    expect(contrast(rgb(colors.primary), surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(colors.secondary), surface)).toBeGreaterThanOrEqual(4.5);
  }
  await mask.getByRole('button', { name: '知道了', exact: true }).click();
  await expect.poll(async () => (await snapshot()).restConfirmedCount).toBe(before.restConfirmedCount + 1);
  const duplicate = await page.evaluate(({ id, generation }) => window.eyeCare.resolveReminder(id, generation, 'acknowledge'), { id: event!.event.id, generation: event!.event.generation });
  expect(duplicate.ok).toBe(false);
  if (!duplicate.ok) expect(duplicate.error.code).toBe('UNAUTHORIZED');
  expect((await snapshot()).restConfirmedCount).toBe(before.restConfirmedCount + 1);
  expect((await snapshot()).remainingMs).toBeGreaterThan(settings.timer.intervalMinutes * 60000 - 3000);
  const nextWindow = desktop.waitForEvent('window');
  await page.evaluate(() => window.eyeCare.remindNow());
  const nextMask = await nextWindow;
  await expect(nextMask.getByRole('button', { name: '知道了', exact: true })).toBeVisible();
  await nextMask.keyboard.press('Escape').catch(error => { if (!nextMask.isClosed()) throw error; });
  await expect.poll(async () => (await snapshot()).currentReminderId).toBeNull();
  expect((await snapshot()).restConfirmedCount).toBe(before.restConfirmedCount + 1);
});

test('flash automatically ends without focus theft or confirmation; sound-only ends', async () => {
  const current = await snapshot();
  const settings = structuredClone(current.settings); settings.timer.mode = 'fixed'; settings.timer.longIdleMinutes = 120;
  expect((await save(current.settingsRevision, settings)).ok).toBe(true);
  const flashWindow = desktop.waitForEvent('window');
  expect((await page.evaluate(() => window.eyeCare.remindNow())).ok).toBe(true);
  const flash = await flashWindow;
  await expect(flash.locator('.flash-overlay')).toBeAttached();
  const native = await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(window => !window.isFocusable()).map(window => ({ focusable: window.isFocusable(), visible: window.isVisible(), bounds: window.getBounds() })));
  expect(native.length).toBeGreaterThan(0); expect(native.every(window => !window.focusable)).toBe(true);
  await expect.poll(async () => (await snapshot()).currentReminderId).toBeNull();
  expect((await snapshot()).restConfirmedCount).toBe(0);
  const audioSettings = structuredClone((await snapshot()).settings); audioSettings.reminder.visual = 'none'; audioSettings.reminder.soundEnabled = true;
  expect((await save((await snapshot()).settingsRevision, audioSettings)).ok).toBe(true);
  await page.evaluate(() => window.eyeCare.remindNow());
  await expect.poll(async () => (await snapshot()).latestReminderResult?.channels.some(result => result.channel === 'sound' && result.success)).toBe(true);
  expect((await snapshot()).restConfirmedCount).toBe(0);
});

test('snapshot sequence and revision reject stale writes and unknown settings fields', async () => {
  const original = await snapshot();
  const settings = structuredClone(original.settings); settings.appearance.theme = 'light';
  expect((await save(original.settingsRevision, settings)).ok).toBe(true);
  const conflict = await save(original.settingsRevision, original.settings);
  expect(conflict.ok).toBe(false);
  if (!conflict.ok) expect(conflict.error.code).toBe('SETTINGS_CONFLICT');
  const invalid = await page.evaluate(async () => {
    const state: RuntimeSnapshot = await window.eyeCare.getSnapshot();
    return window.eyeCare.saveSettings(state.settingsRevision, { ...state.settings, unexpected: true } as SettingsV2);
  });
  expect(invalid.ok).toBe(false);
});
test('preview UI clears active state after flash and mask close without changing real timer/rest', async () => {
  const initial = await snapshot();
  const fixed = structuredClone(initial.settings); fixed.timer.mode = 'fixed'; fixed.timer.longIdleMinutes = 120;
  expect((await save(initial.settingsRevision, fixed)).ok).toBe(true);
  await expect.poll(async () => (await snapshot()).remainingMs).toBeLessThan(fixed.timer.intervalMinutes * 60000);
  const beforeFlash = await snapshot();
  await page.getByRole('button', { name: '提醒方式', exact: true }).click();
  await page.getByRole('button', { name: '预览效果', exact: true }).click();
  await page.getByRole('button', { name: '开始预览', exact: true }).click();
  await expect(page.getByRole('button', { name: '结束预览', exact: true })).toBeVisible();
  await expect.poll(async () => (await snapshot()).currentPreviewId).toBeNull();
  await expect(page.getByRole('button', { name: '结束预览', exact: true })).toHaveCount(0);
  await expect(page.getByText('预览已结束', { exact: true })).toBeVisible();
  const before = await snapshot();
  expect(before.remainingMs!).toBeLessThan(beforeFlash.remainingMs!);
  await page.getByRole('radio', { name: /确认蒙版/ }).check();
  await page.getByRole('button', { name: '预览效果', exact: true }).click();
  const newWindow = desktop.waitForEvent('window');
  await page.getByRole('button', { name: '开始预览', exact: true }).click();
  const mask = await newWindow;
  await expect(mask.getByRole('button', { name: '知道了', exact: true })).toBeVisible();
  await mask.getByRole('button', { name: '知道了', exact: true }).click();
  await expect.poll(async () => (await snapshot()).currentPreviewId).toBeNull();
  await expect(page.getByRole('button', { name: '结束预览', exact: true })).toHaveCount(0);
  await expect(page.getByText('预览已关闭，不影响实际计时', { exact: true })).toBeVisible();
  const after = await snapshot();
  expect(after.restConfirmedCount).toBe(before.restConfirmedCount);
  expect(after.currentReminderId).toBeNull();
  expect(after.settings.reminder.visual).toBe('mask');
  expect(after.elapsedActiveMs).toBeGreaterThanOrEqual(before.elapsedActiveMs);
  expect(after.remainingMs!).toBeLessThanOrEqual(before.remainingMs!);
});
test('failed preview preparation reports failure and never leaves an active preview control', async () => {
  await desktop.evaluate(({ BrowserWindow }) => {
    const original = BrowserWindow.prototype.loadFile;
    (globalThis as unknown as { previewTestLoadFile?: typeof original }).previewTestLoadFile = original;
    BrowserWindow.prototype.loadFile = function(this: Electron.BrowserWindow, ...args: Parameters<typeof original>) {
      if (args[1]?.query?.surface === 'overlay') return Promise.reject(new Error('test preview page load failure'));
      return original.apply(this, args);
    };
  });
  try {
    await page.getByRole('button', { name: '提醒方式', exact: true }).click();
    await page.getByRole('button', { name: '预览效果', exact: true }).click();
    await page.getByRole('button', { name: '开始预览', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '预览当前提醒效果', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('alert')).toContainText('提醒窗口创建失败');
    const state = await snapshot();
    expect(state.currentPreviewId).toBeNull();
    expect(state.latestPreviewResult?.outcome).toBe('failed');
    expect(state.currentReminderId).toBeNull();
    expect(state.restConfirmedCount).toBe(0);
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click();
    await expect(page.getByRole('button', { name: '结束预览', exact: true })).toHaveCount(0);
    await expect(page.getByText('预览失败', { exact: true })).toBeVisible();
    await expect(page.getByText('预览已启动', { exact: true })).toHaveCount(0);
  } finally {
    await desktop.evaluate(({ BrowserWindow }) => {
      const state = globalThis as unknown as { previewTestLoadFile?: typeof BrowserWindow.prototype.loadFile };
      if (state.previewTestLoadFile) BrowserWindow.prototype.loadFile = state.previewTestLoadFile;
      delete state.previewTestLoadFile;
    });
  }
});


test('all pages contain only eight core choices and no advanced or manual-save UI', async () => {
  await page.getByRole('button', { name: '触发条件', exact: true }).click();
  await expect(page.getByRole('radio')).toHaveCount(2);
  await expect(page.getByRole('spinbutton')).toHaveCount(2);
  await expect(page.locator('select')).toHaveCount(0);
  await expect(page.locator('details')).toHaveCount(0);
  await page.getByRole('button', { name: '提醒方式', exact: true }).click();
  await expect(page.getByRole('radio')).toHaveCount(4);
  await expect(page.getByRole('switch')).toHaveCount(1);
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await expect(page.locator('input[type="text"], input[type="color"], select')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '预览效果', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '预听音效', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await expect(page.getByRole('group', { name: '应用主题' }).getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('switch')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '保存设置', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '放弃修改', exact: true })).toHaveCount(0);
  await expect(page.locator('.capability-tag.available')).toHaveCount(0);
});

test('core edits save immediately, preserve rapid inputs and survive restart', async () => {
  await page.getByRole('button', { name: '触发条件', exact: true }).click();
  await page.getByRole('radio', { name: /固定周期/ }).check();
  await page.getByRole('spinbutton', { name: /提醒间隔/ }).fill('41');
  await page.getByRole('spinbutton', { name: /空闲清零时长/ }).fill('12');
  await page.getByRole('button', { name: '提醒方式', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('radio', { name: /确认蒙版/ }).check();
  await page.getByRole('switch', { name: /启用声音提醒/ }).click();
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await page.getByRole('button', { name: '暗色', exact: true }).click();
  await expect.poll(async () => (await snapshot()).settings).toMatchObject({ schemaVersion: 2, timer: { mode: 'fixed', intervalMinutes: 41, longIdleMinutes: 12 }, reminder: { visual: 'mask', soundEnabled: true }, appearance: { theme: 'dark' } });
  const saved = (await snapshot()).settings;
  const persisted = JSON.parse(await readFile(path.join(dataDirectory, 'settings.json'), 'utf8'));
  expect(persisted.settings).toEqual(saved);
  await desktop.close();
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE'));
  desktop = await electron.launch({ args: [path.resolve('.')], env: { ...environment, EYECARE_TEST_USER_DATA: dataDirectory } });
  page = await desktop.firstWindow();
  await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible();
  expect((await snapshot()).settings).toEqual(saved);
});

test('only-sound pairs channels automatically and disk failure preserves input for retry', async () => {
  await page.getByRole('button', { name: '提醒方式', exact: true }).click();
  await page.getByRole('radio', { name: /仅声音/ }).check();
  await expect.poll(async () => (await snapshot()).settings.reminder).toEqual({ visual: 'none', soundEnabled: true });
  await expect(page.getByRole('switch', { name: /启用声音提醒/ })).toBeChecked();
  await expect(page.getByRole('switch', { name: /启用声音提醒/ })).toBeDisabled();
  await expect(page.getByText('仅声音模式需要保持开启。', { exact: true })).toBeVisible();
  const settingsPath = path.join(dataDirectory, 'settings.json');
  const preservedPath = path.join(dataDirectory, 'preserved-settings.json');
  await rename(settingsPath, preservedPath); await mkdir(settingsPath);
  try {
    await page.getByRole('radio', { name: /确认蒙版/ }).check();
    await expect(page.getByRole('button', { name: '重试自动保存', exact: true })).toBeEnabled();
    await expect(page.getByRole('radio', { name: /确认蒙版/ })).toBeChecked();
    expect((await snapshot()).settings.reminder.visual).toBe('none');
    await rm(settingsPath, { recursive: true }); await rename(preservedPath, settingsPath);
    await page.getByRole('button', { name: '重试自动保存', exact: true }).click();
    await expect.poll(async () => (await snapshot()).settings.reminder.visual).toBe('mask');
    await expect(page.getByRole('button', { name: '重试自动保存', exact: true })).toHaveCount(0);
  } finally {
    if (await readFile(preservedPath).then(() => true, () => false)) {
      await rm(settingsPath, { recursive: true, force: true });
      await rename(preservedPath, settingsPath);
    }
  }
});

test('restore defaults uses one confirmation and saves every core choice immediately', async () => {
  const original = await snapshot();
  const changed = structuredClone(original.settings);
  changed.timer = { mode: 'fixed', intervalMinutes: 41, longIdleMinutes: 12 };
  changed.reminder = { visual: 'mask', soundEnabled: true };
  changed.appearance = { theme: 'dark', showTrayCountdown: false };
  expect((await save(original.settingsRevision, changed)).ok).toBe(true);
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await page.getByRole('button', { name: '恢复默认', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '恢复默认设置', exact: true })).toBeVisible();
  expect((await snapshot()).settings).toEqual(changed);
  await page.getByRole('button', { name: '确认恢复', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(async () => (await snapshot()).settings).toEqual(original.settings);
  await expect(page.getByText('已自动保存并生效', { exact: true })).toBeVisible();
});

test('General persistence failure keeps the effective theme visible and retries automatically saved intent', async () => {
  const state = await snapshot();
  expect((await save(state.settingsRevision, state.settings)).ok).toBe(true);
  const settingsPath = path.join(dataDirectory, 'settings.json');
  const preservedPath = path.join(dataDirectory, 'preserved-settings.json');
  await rename(settingsPath, preservedPath); await mkdir(settingsPath);
  try {
    await page.getByRole('button', { name: '通用设置', exact: true }).click();
    await page.getByRole('button', { name: '暗色', exact: true }).click();
    await expect(page.getByRole('button', { name: '重试自动保存', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: '跟随系统', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect((await snapshot()).settings.appearance.theme).toBe('system');
    await rm(settingsPath, { recursive: true }); await rename(preservedPath, settingsPath);
    await page.getByRole('button', { name: '重试自动保存', exact: true }).click();
    await expect(page.getByRole('button', { name: '暗色', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await snapshot()).settings.appearance.theme).toBe('dark');
  } finally {
    if (await readFile(preservedPath).then(() => true, () => false)) {
      await rm(settingsPath, { recursive: true, force: true }); await rename(preservedPath, settingsPath);
    }
  }
});

test('startup error leaves the old switch visible and retries without changing OS login items', async () => {
  test.skip(process.platform !== 'darwin', 'Synthetic Mac login API test; Windows exact registry rollback is covered by injected transaction tests');
  await desktop.evaluate(({ app }) => {
    const state = globalThis as unknown as { startupOriginalSet?: typeof app.setLoginItemSettings; startupOriginalGet?: typeof app.getLoginItemSettings; startupTestEnabled?: boolean; startupTestFail?: boolean };
    state.startupOriginalSet = app.setLoginItemSettings;
    state.startupOriginalGet = app.getLoginItemSettings;
    state.startupTestEnabled = false; state.startupTestFail = true;
    const before = app.getLoginItemSettings();
    app.setLoginItemSettings = options => {
      if (state.startupTestFail) throw new Error('test login preference refused before OS call');
      state.startupTestEnabled = !!options.openAtLogin;
    };
    app.getLoginItemSettings = () => ({ ...before, openAtLogin: !!state.startupTestEnabled });
  });
  try {
    await page.getByRole('button', { name: '通用设置', exact: true }).click();
    const toggle = page.getByRole('switch', { name: /开机启动/ });
    await toggle.click();
    await expect(page.getByRole('button', { name: '重试自动保存', exact: true })).toBeEnabled();
    await expect(toggle).not.toBeChecked();
    expect((await snapshot()).settings.general.launchAtLogin).toBe(false);
    await desktop.evaluate(() => { (globalThis as unknown as { startupTestFail?: boolean }).startupTestFail = false; });
    await page.getByRole('button', { name: '重试自动保存', exact: true }).click();
    await expect(toggle).toBeChecked();
    expect((await snapshot()).settings.general.launchAtLogin).toBe(true);
  } finally {
    await desktop.evaluate(({ app }) => {
      const state = globalThis as unknown as { startupOriginalSet?: typeof app.setLoginItemSettings; startupOriginalGet?: typeof app.getLoginItemSettings; startupTestEnabled?: boolean; startupTestFail?: boolean };
      if (state.startupOriginalSet) app.setLoginItemSettings = state.startupOriginalSet;
      if (state.startupOriginalGet) app.getLoginItemSettings = state.startupOriginalGet;
      delete state.startupOriginalSet; delete state.startupOriginalGet; delete state.startupTestEnabled; delete state.startupTestFail;
    });
  }
});

test('four compact pages fit both native window sizes and themes with all core actions visible', async () => {
  const initial = await snapshot();
  const settings = structuredClone(initial.settings);
  settings.timer = { mode: 'fixed', intervalMinutes: 240, longIdleMinutes: 120 };
  expect((await save(initial.settingsRevision, settings)).ok).toBe(true);
  const previewWindow = desktop.waitForEvent('window');
  const previewSettings: SettingsV2 = { ...settings, reminder: { visual: 'mask', soundEnabled: false } };
  expect((await page.evaluate(settings => window.eyeCare.preview(settings), previewSettings)).ok).toBe(true);
  const mask = await previewWindow;
  await mask.getByRole('button', { name: '知道了', exact: true }).click();
  await expect.poll(async () => (await snapshot()).currentPreviewId).toBeNull();
  for (const theme of ['light', 'dark'] as const) {
    await page.getByRole('button', { name: '通用设置', exact: true }).click();
    await page.getByRole('button', { name: theme === 'light' ? '亮色' : '暗色', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    for (const [width, height] of [[880, 620], [640, 520]]) {
      await desktop.evaluate(({ BrowserWindow }, { width, height }) => {
        BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('surface=main'))!.setSize(width, height);
      }, { width, height });
      for (const name of ['概览', '触发条件', '提醒方式', '通用设置'] as const) {
        await page.getByRole('button', { name, exact: true }).click();
        await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
        await expect.poll(() => page.evaluate(() => {
          const main = document.querySelector<HTMLElement>('.main-content')!;
          const root = document.documentElement;
          const hidden = [...main.querySelectorAll<HTMLElement>('button,input,select,label,.quiet-note,.hint')].filter(element => {
            if (!element.getClientRects().length) return false;
            const bounds = element.getBoundingClientRect();
            return bounds.top < -1 || bounds.bottom > window.innerHeight + 1 || bounds.left < -1 || bounds.right > window.innerWidth + 1;
          }).map(element => element.textContent?.trim() || element.getAttribute('aria-label') || element.tagName);
          return { documentX: root.scrollWidth <= window.innerWidth + 1, documentY: root.scrollHeight <= window.innerHeight + 1, mainY: main.scrollHeight <= main.clientHeight + 1, hidden };
        }), { message: `${name} ${theme} ${width}x${height} must fit without clipped content` }).toEqual({ documentX: true, documentY: true, mainY: true, hidden: [] });
        if (name === '概览') await expect(page.getByRole('button', { name: '立即提醒', exact: true })).toBeVisible();
        if (name === '触发条件') await expect(page.getByRole('spinbutton', { name: /空闲清零时长/ })).toBeVisible();
        if (name === '提醒方式') await expect(page.getByRole('button', { name: '预览效果', exact: true })).toBeVisible();
        if (name === '通用设置') await expect(page.getByRole('button', { name: '恢复默认', exact: true })).toBeVisible();
        const pageId = { '概览': 'overview', '触发条件': 'trigger', '提醒方式': 'reminder', '通用设置': 'general' }[name];
        if (process.platform === 'darwin') await page.screenshot({ path: screenshot(`compact-${pageId}-${theme}-${width}`), animations: 'disabled' });
      }
    }
  }
  await page.getByRole('button', { name: '触发条件', exact: true }).click();
  const input = page.getByRole('spinbutton', { name: /提醒间隔/ });
  await input.fill('');
  await expect(input).toHaveValue('');
  await expect(page.getByRole('alert').first()).toBeVisible();
  await input.focus();
  expect(await input.evaluate(element => { const bounds = element.getBoundingClientRect(); return bounds.top >= 0 && bounds.bottom <= window.innerHeight; })).toBe(true);
  await input.fill('240');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('compact controls retain focus, exact press feedback and instant theme swaps at slow playback', async () => {
  await page.getByRole('button', { name: '通用设置', exact: true }).click();
  await page.getByRole('button', { name: '亮色', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const session = await page.context().newCDPSession(page);
  await session.send('Animation.enable');
  await session.send('Animation.setPlaybackRate', { playbackRate: .1 });
  try {
    const button = page.getByRole('button', { name: '暗色', exact: true });
    await button.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    expect(await button.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
    await button.hover();
    const bounds = (await button.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.down();
    await expect.poll(() => button.evaluate(element => {
      const style = getComputedStyle(element);
      return style.scale !== 'none' ? Number(style.scale) : new DOMMatrixReadOnly(style.transform).a;
    })).toBeCloseTo(.96, 2);
    await page.mouse.up();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => document.getAnimations().filter(animation => animation instanceof CSSTransition && /color|background|border|shadow/.test(animation.transitionProperty)).length)).toBe(0);
    const still = page.getByRole('button', { name: '亮色', exact: true });
    const stillBounds = (await still.boundingBox())!;
    await page.mouse.move(stillBounds.x + stillBounds.width / 2, stillBounds.y + stillBounds.height / 2);
    await page.mouse.down();
    expect(await still.evaluate(element => {
      // Inspect the static rule atomically, before a native snapshot can restore
      // the host's real motion preference. This never changes OS preferences.
      document.documentElement.dataset.motion = 'reduced';
      const style = getComputedStyle(element);
      return style.scale !== 'none' ? Number(style.scale) : new DOMMatrixReadOnly(style.transform).a;
    })).toBe(1);
    await page.mouse.up();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.mouse.move(stillBounds.x + stillBounds.width / 2, stillBounds.y + stillBounds.height / 2);
    await page.mouse.down();
    expect(await still.evaluate(element => {
      document.documentElement.dataset.motion = 'full';
      const style = getComputedStyle(element);
      return style.scale !== 'none' ? Number(style.scale) : new DOMMatrixReadOnly(style.transform).a;
    })).toBe(1);
    await page.mouse.up();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const navigation = page.getByRole('button', { name: '通用设置', exact: true });
    const navigationBounds = (await navigation.boundingBox())!;
    await page.mouse.move(navigationBounds.x + navigationBounds.width / 2, navigationBounds.y + navigationBounds.height / 2);
    await page.mouse.down();
    expect(await navigation.evaluate(element => {
      const style = getComputedStyle(element);
      return style.scale !== 'none' ? Number(style.scale) : new DOMMatrixReadOnly(style.transform).a;
    })).toBe(1);
    await page.mouse.up();
  } finally {
    await page.mouse.up();
    await page.emulateMedia({ reducedMotion: null });
    await session.send('Animation.setPlaybackRate', { playbackRate: 1 });
    await session.detach();
  }
});

test('overview reminder interval presets and custom minutes autosave while pause requires explicit resume', async () => {
  await expect(page.getByRole('heading', { name: '当前提醒规则', exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: '暂停时长', exact: true })).toHaveCount(0);
  await expect(page.getByText('直到手动恢复', { exact: true })).toHaveCount(0);
  const interval = page.getByRole('combobox', { name: '提醒间隔', exact: true });
  await expect(interval.locator('option')).toHaveText(['20 分钟', '30 分钟', '40 分钟', '自定义分钟']);
  for (const value of [20, 30, 40]) {
    await interval.selectOption(String(value));
    await expect.poll(async () => (await snapshot()).settings.timer.intervalMinutes).toBe(value);
  }
  await interval.selectOption('custom');
  const custom = page.getByRole('spinbutton', { name: '自定义提醒间隔', exact: true });
  await custom.fill('0');
  await expect(custom).toHaveAttribute('aria-invalid', 'true');
  expect((await snapshot()).settings.timer.intervalMinutes).toBe(40);
  await custom.fill('37');
  await custom.press('Tab');
  await expect.poll(async () => (await snapshot()).settings.timer.intervalMinutes).toBe(37);
  const persisted = JSON.parse(await readFile(path.join(dataDirectory, 'settings.json'), 'utf8'));
  expect(persisted.settings.timer.intervalMinutes).toBe(37);
  await page.getByRole('button', { name: '触发条件', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: /提醒间隔/ })).toHaveValue('37');
  await page.getByRole('button', { name: '概览', exact: true }).click();
  await expect(interval).toHaveValue('custom');
  await expect(custom).toHaveValue('37');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  const paused = await snapshot();
  expect(paused.status).toBe('paused');
  expect(paused).not.toHaveProperty('pauseRemainingMs');
  await expect(page.getByRole('button', { name: '恢复提醒', exact: true })).toBeVisible();
  await expect(page.getByText('距离自动恢复', { exact: true })).toHaveCount(0);
  await expect.poll(async () => (await snapshot()).sequence).toBeGreaterThan(paused.sequence);
  expect((await snapshot()).status).toBe('paused');
  await page.getByRole('button', { name: '恢复提醒', exact: true }).click();
  await expect.poll(async () => (await snapshot()).status).not.toBe('paused');
});

test('sampling-gap notice is hidden while other warnings stay visible and overview rules stay absent', async () => {
  const current = await snapshot();
  const sampleWarning = '系统采样延迟超过 5 秒，未知时段未计入活动';
  const otherWarning = '配置备份需要检查（界面验证）';
  await desktop.evaluate(({ BrowserWindow }, fixture) => {
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('surface=main'))!.webContents.send('eyecare:snapshot-updated', fixture);
  }, { ...current, sequence: current.sequence + 20, warnings: [sampleWarning, otherWarning] });
  await expect(page.getByText(otherWarning, { exact: true })).toBeVisible();
  await expect(page.getByText(sampleWarning, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '当前提醒规则', exact: true })).toHaveCount(0);
});
