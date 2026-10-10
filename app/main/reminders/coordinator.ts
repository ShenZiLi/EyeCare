import { BrowserWindow, Notification, screen } from 'electron';
import type { ChannelResult, OverlayState, PreviewResult, ReminderAction, ReminderEvent, Result, RuntimeSnapshot } from '../../shared/contracts';
import { loadSurface, windowOptions } from '../windows';

interface OverlayWindow { window: BrowserWindow; state: OverlayState; displayId: number | null; ready: boolean; visualResult?: ChannelResult }
interface Session { event: ReminderEvent; windows: Map<number, OverlayWindow>; channels: ChannelResult[]; timers: Set<ReturnType<typeof setTimeout>>; notification?: Notification; notificationSubmitted: boolean; cancelled: boolean; creating: boolean; soundOwner: number | null; result: PreviewResult | null }
export class ReminderCoordinator {
  private session: Session | null = null;
  constructor(private readonly snapshot: () => RuntimeSnapshot, private readonly canPresent: (event: ReminderEvent) => boolean, private readonly finished: (event: ReminderEvent, results: ChannelResult[]) => void, private readonly openHome: () => void, private readonly previewChanged?: (id: string | null, result: PreviewResult | null) => void) {}

  get current(): ReminderEvent | null { return this.session?.event ?? null; }
  get channels(): ChannelResult[] { return structuredClone(this.session?.channels ?? []); }
  getOverlay(senderId: number): OverlayState | null { return this.session?.windows.get(senderId)?.state ?? null; }
  matches(id: string, generation: number): boolean { return this.session?.event.id === id && this.session.event.generation === generation; }
  private later(session: Session, fn: () => void, ms: number) {
    const timer = setTimeout(() => { session.timers.delete(timer); if (this.session === session && !session.cancelled) fn(); }, ms);
    session.timers.add(timer);
  }
  async present(event: ReminderEvent): Promise<Result<string>> {
    if (this.session) return { ok: false, error: { code: 'REMINDER_BUSY', message: '已有提醒或预览正在呈现' } };
    const session: Session = { event: structuredClone(event), windows: new Map(), channels: [], timers: new Set(), notificationSubmitted: false, cancelled: false, creating: true, soundOwner: null, result: null };
    this.session = session;
    if (!this.canPresent(event)) { this.complete(session, [{ channel: 'visual', success: false, message: '当前系统状态禁止提醒' }]); return { ok: false, error: { code: 'REMINDER_SUPPRESSED', message: '当前系统状态禁止提醒' } }; }
    if (this.session !== session || session.cancelled) return { ok: false, error: { code: 'REMINDER_SUPPRESSED', message: '提醒在准备期间已取消' } };
    if (event.kind === 'preview') this.previewChanged?.(event.id, null);
    // Install before the first async load; one ready display cannot remove protection for the rest.
    this.later(session, () => {
      if (session.creating || [...session.windows.values()].some(item => !item.ready)) this.fail(session, '提醒窗口未就绪，已安全关闭');
    }, 12000);
    const snapshot = this.snapshot();
    const visual = event.settings.reminder.visual;
    if ((visual === 'flash' || visual === 'mask') && snapshot.capabilities.overlay.state !== 'available') {
      this.record(session, { channel: 'visual', success: false, message: snapshot.capabilities.overlay.reason || '全屏覆盖不可用' });
    } else if (visual === 'notification') {
      if (!Notification.isSupported()) this.record(session, { channel: 'visual', success: false, message: '系统通知不可用' });
      else {
        try {
          const notice = new Notification({ title: 'EyeCare · 休息提醒', body: event.settings.reminder.message, silent: true });
          session.notification = notice;
          notice.once('show', () => this.record(session, { channel: 'visual', success: true, message: '系统通知已提交' }));
          notice.once('failed', (_event, error) => this.record(session, { channel: 'visual', success: false, message: `通知发送失败：${error}` }));
          notice.on('click', this.openHome);
          if (!event.settings.reminder.soundEnabled) this.submitNotification(session);
        } catch { this.record(session, { channel: 'visual', success: false, message: '系统通知发送失败' }); }
      }
    }
    const needsOverlay = visual === 'flash' || visual === 'mask';
    if (needsOverlay && snapshot.capabilities.overlay.state === 'available') {
      await this.createVisualWindows(session);
    } else if (event.settings.reminder.soundEnabled && !session.cancelled) {
      await this.createWindow(session, null);
    }
    session.creating = false;
    // Reconcile hotplug events that arrived while the initial pages were loading.
    if (this.session === session && needsOverlay && snapshot.capabilities.overlay.state === 'available') await this.refreshDisplays();
    this.aggregateVisual(session);
    this.maybeComplete(session);
    if (session.result?.outcome === 'failed') return { ok: false, error: { code: 'REMINDER_DELIVERY_FAILED', message: session.result.channels.filter(result => !result.success).map(result => result.message).join('；') || '预览未能呈现' } };
    if (session.result?.outcome === 'cancelled') return { ok: false, error: { code: 'REMINDER_SUPPRESSED', message: '提醒在准备期间已取消' } };
    return { ok: true, value: event.id };
  }
  private submitNotification(session: Session) {
    if (session.cancelled || this.session !== session || !session.notification || session.notificationSubmitted) return;
    if (!this.canPresent(session.event)) { this.fail(session, '当前系统状态禁止通知'); return; }
    if (session.cancelled || this.session !== session) return;
    session.notificationSubmitted = true;
    try {
      session.notification.show();
      this.later(session, () => this.record(session, { channel: 'visual', success: false, message: '系统未确认通知提交' }), 8000);
    } catch { this.record(session, { channel: 'visual', success: false, message: '系统通知发送失败' }); }
  }
  private async createVisualWindows(session: Session) {
    const all = screen.getAllDisplays();
    const options = session.event.settings.reminder;
    let targets = all.filter(display => options.screenScope === 'all' || (options.screenScope === 'primary' ? display.id === screen.getPrimaryDisplay().id : session.event.screenIds.includes(String(display.id))));
    if (!targets.length) targets = [screen.getPrimaryDisplay()];
    for (const display of targets) {
      if (session.cancelled || this.session !== session) break;
      await this.createWindow(session, display);
    }
  }
  private async createWindow(session: Session, display: Electron.Display | null) {
    if (session.cancelled || this.session !== session) return;
    if (!this.canPresent(session.event)) { this.fail(session, '当前系统状态禁止提醒'); return; }
    if (session.cancelled || this.session !== session) return;
    const mask = display !== null && session.event.settings.reminder.visual === 'mask';
    const snapshot = this.snapshot();
    const state: OverlayState = { event: structuredClone(session.event), theme: snapshot.theme, reduceMotion: snapshot.reduceMotion, reduceTransparency: snapshot.reduceTransparency };
    let window: BrowserWindow | null = null;
    let windowId: number | null = null;
    try {
      window = new BrowserWindow({ ...(display?.bounds ?? { width: 1, height: 1 }), frame: false, transparent: true, show: false, focusable: mask, skipTaskbar: true, resizable: false, movable: false, hasShadow: false, alwaysOnTop: !!display, webPreferences: { ...windowOptions(), autoplayPolicy: 'no-user-gesture-required' } });
      windowId = window.webContents.id;
      const ownsSound = session.soundOwner === null;
      if (ownsSound) session.soundOwner = window.webContents.id;
      else state.event.settings.reminder.soundEnabled = false;
      // A hidden audio host must never mount a fallback visual or interactive mask.
      if (!display) state.event.settings.reminder.visual = 'none';
      session.windows.set(window.webContents.id, { window, state, displayId: display?.id ?? null, ready: false });
      if (display) {
        window.setBounds(display.bounds);
        window.setAlwaysOnTop(true, 'screen-saver');
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        if (!mask) window.setIgnoreMouseEvents(true, { forward: true });
      }
      window.webContents.once('render-process-gone', () => this.failWindow(session, window));
      window.once('unresponsive', () => this.failWindow(session, window));
      window.once('closed', () => { if (!session.cancelled && windowId !== null && session.windows.has(windowId)) this.failWindow(session, window); });
      await loadSurface(window, 'overlay');
    } catch {
      if (session.cancelled || this.session !== session) return;
      if (windowId !== null) session.windows.delete(windowId);
      if (window && !window.isDestroyed()) window.destroy();
      this.fail(session, '提醒窗口创建失败');
    }
  }
  ready(senderId: number, id: string, generation: number): boolean {
    const session = this.session;
    const item = session?.windows.get(senderId);
    if (!session || !item || !this.matches(id, generation) || item.window.isDestroyed() || !this.canPresent(session.event) || this.session !== session || session.cancelled) return false;
    if (item.ready) return true;
    item.ready = true;
    if (item.displayId !== null && session.event.settings.reminder.visual === 'mask') { item.window.show(); item.visualResult = { channel: 'visual', success: true, message: '确认蒙版已显示' }; }
    else if (item.displayId !== null && session.event.settings.reminder.visual === 'flash') item.window.showInactive();
    const options = session.event.settings.reminder;
    this.later(session, () => {
      if (item.displayId !== null && options.visual === 'flash' && !item.visualResult) { this.fail(session, '提醒播放超时，已关闭'); return; }
      if (session.soundOwner === senderId && options.soundEnabled && !session.channels.some(result => result.channel === 'sound')) {
        this.record(session, { channel: 'sound', success: false, message: '声音播放超时' });
        this.submitNotification(session);
      }
    }, Math.max(10000, options.fadeInMs + options.holdMs + options.fadeOutMs + 5000));
    this.aggregateVisual(session);
    return true;
  }
  soundStarted(senderId: number, id: string, generation: number): boolean {
    const session = this.session;
    const item = session?.windows.get(senderId);
    if (!session || !item?.ready || !this.matches(id, generation) || session.soundOwner !== senderId || !session.event.settings.reminder.soundEnabled) return false;
    this.submitNotification(session);
    return true;
  }
  report(senderId: number, id: string, generation: number, results: ChannelResult[]): boolean {
    const session = this.session;
    const item = session?.windows.get(senderId);
    if (!session || !item?.ready || !this.matches(id, generation)) return false;
    if (results.some(result => result.channel === 'sound' ? session.soundOwner !== senderId || !session.event.settings.reminder.soundEnabled : item.displayId === null || session.event.settings.reminder.visual !== 'flash')) return false;
    for (const result of results) {
      if (result.channel === 'visual') { item.visualResult ??= result; this.aggregateVisual(session); }
      else { this.record(session, result); this.submitNotification(session); }
    }
    return true;
  }
  private aggregateVisual(session: Session) {
    if (session.creating) return;
    const windows = [...session.windows.values()].filter(item => item.displayId !== null);
    if (!windows.length || windows.some(item => !item.visualResult)) return;
    const failure = windows.find(item => !item.visualResult?.success)?.visualResult;
    this.record(session, failure ?? { channel: 'visual', success: true, message: session.event.settings.reminder.visual === 'mask' ? '所有屏幕蒙版已显示' : '所有屏幕闪屏已结束' });
  }
  private record(session: Session, result: ChannelResult) {
    if (session.cancelled || this.session !== session || session.channels.some(value => value.channel === result.channel)) return;
    session.channels.push(result);
    this.maybeComplete(session);
  }
  private maybeComplete(session: Session) {
    if (session.cancelled || session.creating || this.session !== session) return;
    const visual = session.event.settings.reminder.visual;
    const visualResult = session.channels.find(result => result.channel === 'visual');
    const soundResult = session.channels.find(result => result.channel === 'sound');
    if (visual === 'mask' && (!visualResult || visualResult.success)) return;
    if (visual !== 'none' && visualResult?.success) this.complete(session, session.channels);
    else if (visual === 'none' && soundResult) this.complete(session, session.channels);
    else if (visualResult && (!session.event.settings.reminder.soundEnabled || soundResult)) this.complete(session, session.channels);
  }
  private fail(session: Session, message: string) {
    const results = session.channels.filter(result => result.channel !== (session.event.settings.reminder.visual === 'none' ? 'sound' : 'visual'));
    results.push({ channel: session.event.settings.reminder.visual === 'none' ? 'sound' : 'visual', success: false, message });
    if (session.event.settings.reminder.soundEnabled && !results.some(result => result.channel === 'sound')) results.push({ channel: 'sound', success: false, message: '提醒已关闭，音效停止' });
    this.complete(session, results);
  }
  private failWindow(session: Session, window: BrowserWindow | null) {
    if (!session.cancelled && this.session === session && window) this.fail(session, '提醒窗口意外关闭');
  }
  private complete(session: Session, results: ChannelResult[]) {
    if (session.cancelled || this.session !== session) return;
    const event = session.event;
    session.result = { id: event.id, outcome: results.some(result => result.success) ? 'automatic' : 'failed', channels: structuredClone(results) };
    this.teardown(session);
    if (event.kind === 'preview') this.previewChanged?.(null, session.result);
    else this.finished(event, results);
  }
  cancel(id?: string) {
    const session = this.session;
    if (!session || (id && session.event.id !== id)) return;
    session.result = { id: session.event.id, outcome: 'cancelled', channels: structuredClone(session.channels) };
    this.teardown(session);
    if (session.event.kind === 'preview') this.previewChanged?.(null, session.result);
  }
  private teardown(session: Session) {
    session.cancelled = true;
    this.session = null;
    session.timers.forEach(timer => clearTimeout(timer));
    for (const { window } of session.windows.values()) if (!window.isDestroyed()) window.destroy();
    // Submitted notifications may survive settlement; their clicks only open overview.
    if (session.notification && !session.channels.some(result => result.channel === 'visual' && result.success)) session.notification.close();
  }
  resolvePreview(id: string, generation: number, action: ReminderAction): boolean {
    if (!this.matches(id, generation) || this.session?.event.kind !== 'preview') return false;
    const session = this.session;
    session.result = { id, outcome: action, channels: structuredClone(session.channels) };
    this.teardown(session);
    this.previewChanged?.(null, session.result);
    return true;
  }
  syncAppearance() {
    if (!this.session) return;
    const snapshot = this.snapshot();
    for (const item of this.session.windows.values()) {
      item.state.theme = snapshot.theme;
      item.state.reduceMotion = snapshot.reduceMotion;
      item.state.reduceTransparency = snapshot.reduceTransparency;
      if (!item.window.isDestroyed()) item.window.webContents.send('eyecare:overlay-updated', item.state);
    }
  }
  async refreshDisplays() {
    const session = this.session;
    if (!session || session.creating || !['mask', 'flash'].includes(session.event.settings.reminder.visual)) return;
    session.creating = true;
    const options = session.event.settings.reminder;
    const all = screen.getAllDisplays();
    let targets = all.filter(display => options.screenScope === 'all' || (options.screenScope === 'primary' ? display.id === screen.getPrimaryDisplay().id : session.event.screenIds.includes(String(display.id))));
    if (!targets.length) targets = [screen.getPrimaryDisplay()];
    for (const [id, item] of session.windows) {
      const display = targets.find(target => target.id === item.displayId);
      if (display) item.window.setBounds(display.bounds);
      else {
        session.windows.delete(id);
        if (session.soundOwner === id && options.soundEnabled && !session.channels.some(result => result.channel === 'sound')) this.record(session, { channel: 'sound', success: false, message: '声音所在屏幕已移除，播放已停止' });
        if (!item.window.isDestroyed()) item.window.destroy();
      }
    }
    for (const display of targets) {
      if (session.cancelled || this.session !== session) break;
      if ([...session.windows.values()].some(item => item.displayId === display.id)) continue;
      // Preserve the sound owner even after removal, so hotplug cannot replay a one-shot sound.
      session.channels = session.channels.filter(result => result.channel !== 'visual');
      this.later(session, () => {
        if (session.creating || [...session.windows.values()].some(item => !item.ready)) this.fail(session, '新屏幕提醒窗口未就绪，已安全关闭');
      }, 12000);
      await this.createWindow(session, display);
    }
    session.creating = false;
    this.aggregateVisual(session);
    this.maybeComplete(session);
  }
}
