import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { RuntimeSnapshot, SettingsV1 } from '../../app/shared/contracts';

const rgb = (value: string): number[] => value.match(/[\d.]+/g)!.map(Number);
const over = (front: number[], back: number[]): number[] => front.slice(0, 3).map((value, index) => value * (front[3] ?? 1) + back[index] * (1 - (front[3] ?? 1)));
const luminance = (color: number[]): number => color.slice(0, 3).map(value => { const v = value / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (a: number[], b: number[]): number => { const left = luminance(a); const right = luminance(b); return (Math.max(left, right) + .05) / (Math.min(left, right) + .05); };

let desktop: ElectronApplication;
let page: Page;
let dataDirectory: string;
const snapshot = () => page.evaluate(() => window.eyeCare.getSnapshot());
const save = (revision: number, settings: SettingsV1) => page.evaluate(({ revision, settings }) => window.eyeCare.saveSettings(revision, settings), { revision, settings });

test.beforeEach(async () => {
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'eyecare-e2e-'));
  const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'ELECTRON_RUN_AS_NODE'));
  desktop = await electron.launch({ args: [path.resolve('.')], env: { ...environment, EYECARE_TEST_USER_DATA: dataDirectory } });
  page = await desktop.firstWindow();
  await expect(page.getByRole('heading', { name: '概览', exact: true })).toBeVisible();
  await expect.poll(async () => (await snapshot()).status).not.toBe('starting');
});
test.afterEach(async () => { await desktop?.close(); });

test('native app launches with isolated renderer and documented defaults', async () => {
  const current = await snapshot();
  expect(current.settings.timer.intervalMinutes).toBe(30);
  expect(current.settings.timer.mode).toBe('active');
  expect(current.settings.reminder.visual).toBe('flash');
  expect(current.settings.reminder.soundEnabled).toBe(false);
  expect(current.settings.appearance.theme).toBe('system');
  expect(current.settings.appearance.showTrayCountdown).toBe(true);
  expect(await page.evaluate(() => ({ node: typeof (window as unknown as { require?: unknown }).require, process: typeof (window as unknown as { process?: unknown }).process }))).toEqual({ node: 'undefined', process: 'undefined' });
  expect(current.capabilities.lock.state).toBe('available');
  await mkdir('docs/screenshots', { recursive: true });
  await page.screenshot({ path: 'docs/screenshots/overview-system.png' });
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
  expect(await page.evaluate(() => { const input = document.querySelector<HTMLInputElement>('input[role="switch"]:focus')!; const field = input.getBoundingClientRect(); const save = document.querySelector('.save-bar')!.getBoundingClientRect(); return field.bottom <= save.top && field.top >= 0; })).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/settings-dark.png' });
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
  const input = page.getByRole('spinbutton', { name: /累计活跃阈值/ });
  await input.fill('0');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('alert').first()).toBeVisible();
  await expect(input).toHaveValue('0');
  expect((await snapshot()).settings.timer.intervalMinutes).toBe(30);
  await page.getByRole('button', { name: '提醒方式', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '保留尚未保存的修改？' })).toBeVisible();
  await page.getByRole('button', { name: '保留修改并离开', exact: true }).click();
  await page.getByRole('button', { name: '触发条件', exact: true }).click();
  await page.getByRole('button', { name: '保留修改并离开', exact: true }).click();
  await expect(input).toHaveValue('0');
  await input.fill('31');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect.poll(async () => (await snapshot()).settings.timer.intervalMinutes).toBe(31);
  await desktop.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(window => window.getTitle().includes('EyeCare'))?.setSize(640, 520); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/screenshots/trigger-compact.png' });
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
  await mask.screenshot({ path: 'docs/screenshots/mask-light.png' });
  const colors = await mask.evaluate(() => ({ panel: getComputedStyle(document.querySelector('.rest-panel')!).backgroundColor, veil: getComputedStyle(document.querySelector('.rest-backdrop')!).backgroundColor, primary: getComputedStyle(document.querySelector('.rest-panel h1')!).color, secondary: getComputedStyle(document.querySelector('#rest-description')!).color }));
  for (const desktopColor of [[0, 0, 0], [255, 255, 255]]) {
    const surface = over(rgb(colors.panel), over(rgb(colors.veil), desktopColor));
    expect(contrast(rgb(colors.primary), surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(rgb(colors.secondary), surface)).toBeGreaterThanOrEqual(4.5);
  }
  await mask.getByRole('button', { name: '知道了', exact: true }).click();
  await expect.poll(async () => (await snapshot()).restConfirmedCount).toBe(before.restConfirmedCount + 1);
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
    return window.eyeCare.saveSettings(state.settingsRevision, { ...state.settings, unexpected: true } as SettingsV1);
  });
  expect(invalid.ok).toBe(false);
});
