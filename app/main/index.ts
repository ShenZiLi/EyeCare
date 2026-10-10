import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';
import { randomUUID } from 'node:crypto';
import type { EngineUpdate, PreviewResult, ReminderEvent, Result, RuntimeSnapshot } from '../shared/contracts';
import { TimerEngine } from './engine/timer-engine';
import { SettingsStore } from './settings/settings-store';
import { validateSettings } from './settings/validation';
import { PlatformAdapter, setLaunchAtLogin } from './platform';
import { ReminderCoordinator } from './reminders/coordinator';
import { TrayPresenter } from './tray/presenter';
import { isTrustedSurface, loadSurface, windowOptions } from './windows';
import { CommandError, channelResults, emptyPayload, identity, payload, reminderAction } from './ipc-validation';

let mainWindow: BrowserWindow | null = null;
let engine: TimerEngine;
let adapter: PlatformAdapter;
let store: SettingsStore;
let coordinator: ReminderCoordinator;
let tray: TrayPresenter;
let interval: ReturnType<typeof setInterval> | null = null;
let quitting = false;
let explainedBackground = false;
let startupWarnings: string[] = [];
let commandQueue: Promise<unknown> = Promise.resolve();
let appearanceKey = '';
let settingsRequested = false;
let currentPreviewId: string | null = null;
let latestPreviewResult: PreviewResult | null = null;
let previewSequence = 0;

const presentedSnapshot = (): RuntimeSnapshot => {
  const snapshot = engine.getSnapshot();
  return { ...snapshot, sequence: snapshot.sequence + previewSequence, currentPreviewId, latestPreviewResult: structuredClone(latestPreviewResult), warnings: [...snapshot.warnings, ...startupWarnings], capabilities: { ...snapshot.capabilities, tray: tray?.available ? snapshot.capabilities.tray : { state: 'unsupported', reason: '当前桌面未提供可用托盘，主窗口保持可访问' } } };
};
const hasConfirmedTray = (): boolean => !!tray?.available && engine?.getSnapshot().capabilities.tray.state === 'available';
function publish(update?: EngineUpdate) {
  const snapshot = presentedSnapshot();
  for (const window of [mainWindow, tray?.window]) if (window && !window.isDestroyed()) window.webContents.send('eyecare:snapshot-updated', snapshot);
  tray?.update(snapshot);
  const key = `${snapshot.theme}:${snapshot.reduceMotion}:${snapshot.reduceTransparency}`;
  if (key !== appearanceKey) { appearanceKey = key; coordinator?.syncAppearance(); }
  for (const effect of update?.effects ?? []) {
    if (effect.type === 'cancel') coordinator.cancel(effect.id);
    if (effect.type === 'present') {
      if (coordinator.current?.kind === 'preview') coordinator.cancel();
      void coordinator.present(effect.reminder);
    }
  }
  if (coordinator?.current?.kind === 'preview' && ['locked', 'sleeping', 'capability_error', 'long_idle'].includes(snapshot.status)) coordinator.cancel();
}
function sample() {
  if (!engine || !adapter) return;
  const observation = adapter.sample(engine.getSnapshot().settings.timer.activitySource);
  if (tray && !tray.available) observation.capabilities.tray = { state: 'unsupported', reason: '未检测到可用系统托盘' };
  publish(engine.acceptSample(observation));
}
function checkEligible(preview = false) {
  sample();
  const snapshot = presentedSnapshot();
  if (coordinator.current || snapshot.currentReminderId || (!preview && snapshot.status === 'snoozed')) throw new CommandError({ code: 'REMINDER_BUSY', message: '已有提醒或延期，请先完成当前提醒' });
  const blocked = preview ? ['starting', 'locked', 'sleeping', 'capability_error'] : ['starting', 'locked', 'sleeping', 'capability_error', 'paused', 'long_idle'];
  if (blocked.includes(snapshot.status)) throw new CommandError({ code: 'REMINDER_SUPPRESSED', message: snapshot.statusReason || '当前状态不允许提醒' });
}
function apply(update: EngineUpdate): Result<RuntimeSnapshot> { publish(update); return { ok: true, value: presentedSnapshot() }; }
async function showMain(settings = false) {
  if (settings) settingsRequested = true;
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = new BrowserWindow({ width: 880, height: 620, minWidth: 640, minHeight: 520, show: false, title: 'EyeCare', backgroundColor: nativeTheme.shouldUseDarkColors ? '#111A18' : '#F4F7F6', autoHideMenuBar: true, webPreferences: windowOptions() });
    mainWindow.once('ready-to-show', () => mainWindow?.show());
    mainWindow.on('close', event => {
      if (quitting || !hasConfirmedTray()) return;
      event.preventDefault();
      if (!explainedBackground) {
        explainedBackground = true;
        void dialog.showMessageBox(mainWindow!, { type: 'info', title: 'EyeCare 继续在后台运行', message: '关闭窗口后，护眼提醒会继续运行。', detail: '点击系统托盘图标可再次打开；选择“退出 EyeCare”才会停止提醒。', buttons: ['知道了'] }).then(() => mainWindow?.hide());
      } else mainWindow?.hide();
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    await loadSurface(mainWindow, 'main');
  }
  mainWindow.show(); mainWindow.focus();
  if (settings) mainWindow.webContents.send('eyecare:open-settings');
}
function quit() { quitting = true; coordinator?.cancel(); if (interval) clearInterval(interval); adapter?.dispose(); tray?.dispose(); app.quit(); }

function registerIPC() {
  const handle = (channel: string, roles: ('main' | 'tray' | 'overlay')[], callback: (event: Electron.IpcMainInvokeEvent, value: unknown) => unknown | Promise<unknown>, raw = false) => {
    ipcMain.handle(`eyecare:${channel}`, (event, value) => {
      const run = async () => {
        try {
          if (event.senderFrame !== event.sender.mainFrame) throw new CommandError({ code: 'UNAUTHORIZED', message: '不受信任的窗口' });
          const role = event.sender === mainWindow?.webContents ? 'main' : event.sender === tray.window?.webContents ? 'tray' : coordinator.getOverlay(event.sender.id) ? 'overlay' : null;
          if (!role || !roles.includes(role)) throw new CommandError({ code: 'UNAUTHORIZED', message: '此窗口无权执行操作' });
          const source = event.senderFrame?.url ?? '';
          if (!isTrustedSurface(event.sender.id, source)) throw new CommandError({ code: 'UNAUTHORIZED', message: '不受信任的页面来源' });
          if (['snapshot', 'resume', 'remind-now', 'cancel-preview', 'overlay', 'open-settings', 'settings-requested', 'quit'].includes(channel)) emptyPayload(value);
          return await callback(event, value);
        } catch (error) {
          if (raw) throw error;
          return { ok: false, error: error instanceof CommandError ? error.detail : { code: 'COMMAND_FAILED', message: error instanceof Error ? error.message : '操作失败，请重试' } };
        }
      };
      const operation = commandQueue.then(run, run);
      commandQueue = operation.catch(() => undefined);
      return operation;
    });
  };
  handle('snapshot', ['main', 'tray', 'overlay'], () => presentedSnapshot(), true);
  handle('save', ['main', 'tray'], async (_event, value) => {
    const fields = payload(value, ['expectedRevision', 'settings']);
    if (!Number.isSafeInteger(fields.expectedRevision) || (fields.expectedRevision as number) < 0) throw new CommandError({ code: 'INVALID_COMMAND', message: '配置版本无效' });
    sample();
    const snapshot = presentedSnapshot();
    const validation = validateSettings(fields.settings, snapshot.capabilities, snapshot.displays, snapshot.settings);
    if (!validation.ok) return validation;
    if (fields.expectedRevision !== snapshot.settingsRevision) return { ok: false, error: { code: 'SETTINGS_CONFLICT', message: '设置已在其他窗口更新，请保留输入并重新应用', currentRevision: snapshot.settingsRevision } };
    const oldLogin = snapshot.settings.general.launchAtLogin;
    const newLogin = validation.value.general.launchAtLogin;
    if (oldLogin !== newLogin) await setLaunchAtLogin(newLogin);
    const result = await store.save(fields.expectedRevision as number, validation.value, snapshot.capabilities, snapshot.displays);
    if (!result.ok) { if (oldLogin !== newLogin) await setLaunchAtLogin(oldLogin); return result; }
    return apply(engine.updateSettings(result.value.settings, result.value.revision));
  });
  handle('pause', ['main', 'tray'], (_event, value) => {
    const fields = payload(value, ['durationMinutes']);
    if (![15, 30, 60, null].includes(fields.durationMinutes as never)) throw new CommandError({ code: 'INVALID_COMMAND', message: '暂停时长无效' });
    sample(); coordinator.cancel(); return apply(engine.pause(fields.durationMinutes as 15 | 30 | 60 | null));
  });
  handle('resume', ['main', 'tray'], () => { sample(); return apply(engine.resume()); });
  handle('remind-now', ['main', 'tray'], () => { checkEligible(); return apply(engine.remindNow()); });
  handle('resolve', ['overlay'], (event, value) => {
    const fields = payload(value, ['id', 'generation', 'action']); const key = identity(fields); const action = reminderAction(fields.action);
    const state = coordinator.getOverlay(event.sender.id);
    if (!state || state.event.id !== key.id || state.event.generation !== key.generation || state.event.settings.reminder.visual !== 'mask') throw new CommandError({ code: 'STALE_REMINDER', message: '此提醒已结束' });
    if (state.event.kind === 'preview') { coordinator.resolvePreview(key.id, key.generation, action); return { ok: true, value: presentedSnapshot() }; }
    sample(); return apply(engine.resolveReminder(key.id, key.generation, action));
  });
  handle('preview', ['main'], async (_event, value) => {
    const fields = payload(value, ['settings']); checkEligible(true);
    const snapshot = presentedSnapshot(); const validation = validateSettings(fields.settings, snapshot.capabilities, snapshot.displays, snapshot.settings);
    if (!validation.ok) return validation;
    const settings = validation.value;
    const targets = settings.reminder.screenScope === 'primary' ? snapshot.displays.filter(display => display.primary) : settings.reminder.screenScope === 'selected' ? snapshot.displays.filter(display => settings.reminder.screenIds.includes(display.id)) : snapshot.displays;
    const event: ReminderEvent = { id: `preview-${randomUUID()}`, generation: 0, kind: 'preview', settings, screenIds: targets.map(display => display.id), createdAtMs: 0 };
    return coordinator.present(event);
  });
  handle('cancel-preview', ['main'], () => { if (coordinator.current?.kind === 'preview') coordinator.cancel(); return { ok: true, value: null }; });
  handle('overlay', ['overlay'], event => coordinator.getOverlay(event.sender.id), true);
  handle('overlay-ready', ['overlay'], (event, value) => {
    const key = identity(payload(value, ['id', 'generation'])); sample();
    if (!coordinator.ready(event.sender.id, key.id, key.generation)) throw new CommandError({ code: 'STALE_REMINDER', message: '提醒已取消' });
    if (coordinator.current?.kind === 'real') publish(engine.recordReminderChannels(key.id, key.generation, coordinator.channels));
    return { ok: true, value: null };
  });
  handle('overlay-sound-started', ['overlay'], (event, value) => {
    const key = identity(payload(value, ['id', 'generation'])); sample();
    if (!coordinator.soundStarted(event.sender.id, key.id, key.generation)) throw new CommandError({ code: 'STALE_REMINDER', message: '声音提醒已取消' });
    return { ok: true, value: null };
  });
  handle('overlay-finished', ['overlay'], (event, value) => {
    const fields = payload(value, ['id', 'generation', 'results']); const key = identity(fields); const results = channelResults(fields.results);
    sample();
    const state = coordinator.getOverlay(event.sender.id);
    if (!coordinator.report(event.sender.id, key.id, key.generation, results)) throw new CommandError({ code: 'STALE_REMINDER', message: '提醒已结束' });
    if (state?.event.kind === 'real' && coordinator.matches(key.id, key.generation)) publish(engine.recordReminderChannels(key.id, key.generation, coordinator.channels));
    return { ok: true, value: null };
  });
  handle('open-settings', ['main', 'tray'], async () => { await showMain(true); return { ok: true, value: null }; });
  handle('settings-requested', ['main', 'tray'], () => { const requested = settingsRequested; settingsRequested = false; return requested; }, true);
  handle('quit', ['main', 'tray'], () => { setImmediate(quit); return { ok: true, value: null }; });
}

if (squirrelStartup || !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { void showMain(); });
  app.on('window-all-closed', () => { if (!hasConfirmedTray()) quit(); });
  app.on('before-quit', () => { quitting = true; coordinator?.cancel(); if (interval) clearInterval(interval); adapter?.dispose(); tray?.dispose(); });
  app.whenReady().then(async () => {
    if (!app.isPackaged && process.env.EYECARE_TEST_USER_DATA) app.setPath('userData', process.env.EYECARE_TEST_USER_DATA);
    app.setAppUserModelId('org.eyecare.desktop');
    Menu.setApplicationMenu(null);
    store = new SettingsStore(app.getPath('userData'));
    const loaded = await store.load(); startupWarnings = loaded.warnings;
    engine = new TimerEngine(loaded.settings, loaded.revision);
    adapter = new PlatformAdapter();
    coordinator = new ReminderCoordinator(presentedSnapshot, event => {
      sample(); const snapshot = presentedSnapshot();
      const safe = !['locked', 'sleeping', 'capability_error', 'starting', 'long_idle'].includes(snapshot.status);
      return safe && (event.kind === 'preview' || snapshot.currentReminderId === event.id);
    }, (event, channels) => {
      if (event.kind === 'real') { sample(); publish(engine.settleReminder(event.id, event.generation, channels)); }
    }, () => { void showMain(); }, (id, result) => {
      currentPreviewId = id; latestPreviewResult = result; previewSequence++; publish();
    });
    tray = new TrayPresenter({ showMain: () => { void showMain(); }, settings: () => { void showMain(true); }, pause: minutes => { sample(); coordinator.cancel(); publish(engine.pause(minutes)); }, resume: () => { sample(); publish(engine.resume()); }, remindNow: () => { try { checkEligible(); publish(engine.remindNow()); } catch { publish(); } }, quit });
    tray.create(); sample();
    registerIPC();
    adapter.subscribe(sample);
    screen.on('display-added', () => { sample(); void coordinator.refreshDisplays(); });
    screen.on('display-removed', () => { sample(); void coordinator.refreshDisplays(); });
    screen.on('display-metrics-changed', () => { sample(); void coordinator.refreshDisplays(); });
    nativeTheme.on('updated', sample);
    interval = setInterval(sample, 1000);
    app.on('activate', () => { void showMain(); });
    await showMain();
  }).catch(error => { dialog.showErrorBox('EyeCare 无法启动', error instanceof Error ? error.message : String(error)); quit(); });
}
