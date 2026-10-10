import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { defaultSettings, type OverlayState, type ReminderEvent, type RuntimeSnapshot } from '../../app/shared/contracts';
const fake = vi.hoisted(() => ({ windows: [] as unknown[], notices: [] as unknown[], nextId: 1, loader: null as null | (() => Promise<void>), displays: [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 720 } }] }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class Window extends EventEmitter {
    private contents = Object.assign(new EventEmitter(), { id: fake.nextId++, send: vi.fn() });
    get webContents() { if (this.destroyed) throw new Error('Object has been destroyed'); return this.contents; }
    destroyed = false;
    show = vi.fn(); showInactive = vi.fn(); setBounds = vi.fn(); setAlwaysOnTop = vi.fn(); setVisibleOnAllWorkspaces = vi.fn(); setIgnoreMouseEvents = vi.fn();
    constructor(readonly options: unknown) { super(); fake.windows.push(this); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  class Notice extends EventEmitter { constructor() { super(); fake.notices.push(this); } static isSupported() { return true; } show() { this.emit('show'); } close() {} }
  return { BrowserWindow: Window, Notification: Notice, screen: { getAllDisplays: () => fake.displays, getPrimaryDisplay: () => fake.displays[0] } };
});
vi.mock('../../app/main/windows', () => ({ windowOptions: () => ({}), loadSurface: () => fake.loader?.() ?? Promise.resolve() }));
import { ReminderCoordinator } from '../../app/main/reminders/coordinator';

function snapshot(): RuntimeSnapshot {
  const available = { state: 'available' as const, reason: '' };
  return { settings: defaultSettings(), settingsRevision: 0, sequence: 1, status: 'reminding', statusReason: '', elapsedActiveMs: 0, remainingMs: 0, pauseRemainingMs: null, snoozeRemainingMs: null, currentReminderId: 'real-1', currentPreviewId: null, latestPreviewResult: null, theme: 'light', reduceMotion: false, reduceTransparency: false, capabilities: { input: available, mouse: available, lock: available, overlay: available, notification: available, tray: available, launchAtLogin: available }, displays: [], latestReminderResult: null, restConfirmedCount: 0, warnings: [] };
}
const reminder = (visual: 'flash' | 'mask' | 'none' | 'notification' = 'flash', kind: 'real' | 'preview' = 'real'): ReminderEvent => { const settings = defaultSettings(); settings.reminder.visual = visual; settings.reminder.soundEnabled = true; return { id: 'real-1', generation: 1, kind, settings, screenIds: ['1', '2'], createdAtMs: 0 }; };
const overlays = (coordinator: ReminderCoordinator): { id: number; state: OverlayState }[] => (fake.windows as { webContents: { id: number } }[]).map(window => ({ id: window.webContents.id, state: coordinator.getOverlay(window.webContents.id)! }));

describe('multi-screen reminder lifecycle', () => {
  beforeEach(() => { fake.windows = []; fake.notices = []; fake.nextId = 1; fake.loader = null; vi.useRealTimers(); });
  afterEach(() => vi.useRealTimers());
  it('one sound owner and click-through inactive flash; all screens settle once and stop remaining audio', async () => {
    const complete = vi.fn(); const coordinator = new ReminderCoordinator(snapshot, () => true, complete, vi.fn());
    await coordinator.present(reminder());
    const items = overlays(coordinator);
    expect(items).toHaveLength(2);
    expect(items.filter(item => item.state.event.settings.reminder.soundEnabled)).toHaveLength(1);
    for (const item of items) coordinator.ready(item.id, 'real-1', 1);
    const windows = fake.windows as { show: ReturnType<typeof vi.fn>; showInactive: ReturnType<typeof vi.fn>; setIgnoreMouseEvents: ReturnType<typeof vi.fn>; isDestroyed(): boolean }[];
    for (const window of windows) { expect(window.show).not.toHaveBeenCalled(); expect(window.showInactive).toHaveBeenCalledOnce(); expect(window.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true }); }
    coordinator.report(items[0].id, 'real-1', 1, [{ channel: 'visual', success: true, message: '结束' }]);
    expect(complete).not.toHaveBeenCalled();
    coordinator.report(items[1].id, 'real-1', 1, [{ channel: 'visual', success: true, message: '结束' }]);
    expect(coordinator.report(items[1].id, 'real-1', 1, [{ channel: 'visual', success: true, message: '结束' }])).toBe(false);
    expect(complete).toHaveBeenCalledOnce(); expect(windows.every(window => window.isDestroyed())).toBe(true);
  });
  it('mask does not finish on attached sound completion', async () => {
    const complete = vi.fn(); const coordinator = new ReminderCoordinator(snapshot, () => true, complete, vi.fn());
    await coordinator.present(reminder('mask'));
    const [first] = overlays(coordinator);
    coordinator.ready(first.id, 'real-1', 1);
    coordinator.report(first.id, 'real-1', 1, [{ channel: 'sound', success: true, message: '播放完成' }]);
    expect(complete).not.toHaveBeenCalled(); expect(coordinator.current?.id).toBe('real-1'); coordinator.cancel();
  });
  it('cancellation during asynchronous load never resurrects a second overlay', async () => {
    let release!: () => void;
    fake.loader = () => new Promise<void>(resolve => { release = resolve; });
    const complete = vi.fn(); const coordinator = new ReminderCoordinator(snapshot, () => true, complete, vi.fn());
    const pending = coordinator.present(reminder());
    coordinator.cancel('real-1'); release(); await pending;
    expect(fake.windows).toHaveLength(1); expect(coordinator.current).toBeNull(); expect(complete).not.toHaveBeenCalled();
  });
  it('renderer failure closes every screen without recording rest', async () => {
    const complete = vi.fn(); const coordinator = new ReminderCoordinator(snapshot, () => true, complete, vi.fn());
    await coordinator.present(reminder('mask'));
    (fake.windows[0] as { webContents: EventEmitter }).webContents.emit('render-process-gone');
    expect(coordinator.current).toBeNull(); expect(complete).toHaveBeenCalledOnce(); expect(complete.mock.calls[0][1].some((result: { success: boolean }) => !result.success)).toBe(true);
  });
  it('preview actions close only preview and never invoke real event settlement', async () => {
    const complete = vi.fn(); const coordinator = new ReminderCoordinator(snapshot, () => true, complete, vi.fn());
    await coordinator.present(reminder('mask', 'preview'));
    expect(coordinator.resolvePreview('real-1', 2, 'acknowledge')).toBe(false);
    expect(coordinator.resolvePreview('real-1', 1, 'acknowledge')).toBe(true);
    expect(complete).not.toHaveBeenCalled(); expect(coordinator.current).toBeNull();
  });
  it('unknown lock cancels before any effect is created', async () => {
    const complete = vi.fn(); const coordinator = new ReminderCoordinator(snapshot, () => false, complete, vi.fn());
    await coordinator.present(reminder());
    expect(fake.windows).toHaveLength(0); expect(complete).toHaveBeenCalledOnce(); expect(coordinator.current).toBeNull();
  });
  it('first ready mask cannot disable the watchdog for an unready second display', async () => {
    vi.useFakeTimers();
    const complete = vi.fn(); const coordinator = new ReminderCoordinator(snapshot, () => true, complete, vi.fn());
    await coordinator.present(reminder('mask'));
    coordinator.ready(overlays(coordinator)[0].id, 'real-1', 1);
    await vi.advanceTimersByTimeAsync(13000);
    expect(complete).toHaveBeenCalledOnce(); expect(coordinator.current).toBeNull();
  });
  it('ready during asynchronous loading does not add a later mask dismissal timer', async () => {
    vi.useFakeTimers();
    const complete = vi.fn(); const coordinator = new ReminderCoordinator(snapshot, () => true, complete, vi.fn());
    fake.loader = async () => { coordinator.ready((fake.windows.at(-1) as { webContents: { id: number } }).webContents.id, 'real-1', 1); };
    await coordinator.present(reminder('mask'));
    await vi.advanceTimersByTimeAsync(30000);
    expect(complete).not.toHaveBeenCalled(); expect(coordinator.current?.id).toBe('real-1'); coordinator.cancel();
  });
  it('watchdog bounds a hanging page load before it resolves', async () => {
    vi.useFakeTimers();
    let release!: () => void; fake.loader = () => new Promise<void>(resolve => { release = resolve; });
    const complete = vi.fn(); const coordinator = new ReminderCoordinator(snapshot, () => true, complete, vi.fn());
    const pending = coordinator.present(reminder('mask'));
    await vi.advanceTimersByTimeAsync(13000);
    expect(complete).toHaveBeenCalledOnce(); expect(coordinator.current).toBeNull();
    release(); await pending;
  });
  it('rejects channel reports from a display that does not own sound', async () => {
    const complete = vi.fn(); const coordinator = new ReminderCoordinator(snapshot, () => true, complete, vi.fn());
    await coordinator.present(reminder('mask'));
    const [first, second] = overlays(coordinator);
    coordinator.ready(first.id, 'real-1', 1); coordinator.ready(second.id, 'real-1', 1);
    expect(coordinator.report(second.id, 'real-1', 1, [{ channel: 'sound', success: true, message: 'forged' }])).toBe(false);
    coordinator.cancel();
  });
  it('refuses reports before readiness and snapshots the supplied event', async () => {
    const coordinator = new ReminderCoordinator(snapshot, () => true, vi.fn(), vi.fn()); const event = reminder('mask');
    await coordinator.present(event); const [first] = overlays(coordinator);
    event.settings.reminder.visual = 'none';
    expect(coordinator.current?.settings.reminder.visual).toBe('mask');
    expect(coordinator.report(first.id, 'real-1', 1, [{ channel: 'sound', success: true, message: 'early' }])).toBe(false);
    coordinator.cancel();
  });
  it('notification waits for confirmed audio start, then submission settles and stops audio', async () => {
    const complete = vi.fn(); const coordinator = new ReminderCoordinator(snapshot, () => true, complete, vi.fn());
    await coordinator.present(reminder('notification'));
    expect(fake.windows).toHaveLength(1); expect(complete).not.toHaveBeenCalled();
    const [first] = overlays(coordinator); coordinator.ready(first.id, 'real-1', 1);
    expect(complete).not.toHaveBeenCalled();
    coordinator.soundStarted(first.id, 'real-1', 1);
    expect(complete).toHaveBeenCalledOnce(); expect(complete.mock.calls[0][1]).toEqual([{ channel: 'visual', success: true, message: '系统通知已提交' }]);
  });
  it('failed visual waits for configured sound fallback before settlement', async () => {
    const complete = vi.fn(); const coordinator = new ReminderCoordinator(snapshot, () => true, complete, vi.fn());
    await coordinator.present(reminder()); const items = overlays(coordinator);
    for (const item of items) coordinator.ready(item.id, 'real-1', 1);
    coordinator.report(items[0].id, 'real-1', 1, [{ channel: 'visual', success: false, message: 'failed' }]);
    coordinator.report(items[1].id, 'real-1', 1, [{ channel: 'visual', success: true, message: 'done' }]);
    expect(complete).not.toHaveBeenCalled();
    coordinator.report(items[0].id, 'real-1', 1, [{ channel: 'sound', success: true, message: 'done' }]);
    expect(complete).toHaveBeenCalledOnce(); expect(complete.mock.calls[0][1]).toHaveLength(2);
  });
  it('display metrics updates preserve windows and do not restart one-shot audio', async () => {
    const coordinator = new ReminderCoordinator(snapshot, () => true, vi.fn(), vi.fn());
    await coordinator.present(reminder('mask')); const items = overlays(coordinator);
    for (const item of items) coordinator.ready(item.id, 'real-1', 1);
    coordinator.report(items[0].id, 'real-1', 1, [{ channel: 'sound', success: true, message: 'done' }]);
    await coordinator.refreshDisplays();
    expect(fake.windows).toHaveLength(2); expect(overlays(coordinator).map(item => item.id)).toEqual(items.map(item => item.id));
    coordinator.cancel();
  });
  it('a display added while the first page loads joins the same event without replaying sound', async () => {
    let release!: () => void; fake.loader = () => new Promise<void>(resolve => { release = resolve; });
    const coordinator = new ReminderCoordinator(snapshot, () => true, vi.fn(), vi.fn());
    const pending = coordinator.present(reminder('mask'));
    const initial = fake.displays;
    fake.displays = [...initial, { id: 3, bounds: { x: -1280, y: 0, width: 1280, height: 720 } }];
    await coordinator.refreshDisplays();
    fake.loader = null; release(); await pending;
    fake.displays = initial;
    expect(fake.windows).toHaveLength(3);
    expect(overlays(coordinator).filter(item => item.state.event.settings.reminder.soundEnabled)).toHaveLength(1);
    coordinator.cancel();
  });
  it('publishes preview start and automatic terminal result without real timer settlement', async () => {
    const changed = vi.fn(); const finished = vi.fn(); const coordinator = new ReminderCoordinator(snapshot, () => true, finished, vi.fn(), changed);
    const event = reminder('flash', 'preview'); event.settings.reminder.soundEnabled = false;
    expect(await coordinator.present(event)).toEqual({ ok: true, value: event.id });
    expect(changed).toHaveBeenCalledWith(event.id, null);
    for (const item of overlays(coordinator)) { coordinator.ready(item.id, event.id, event.generation); coordinator.report(item.id, event.id, event.generation, [{ channel: 'visual', success: true, message: 'done' }]); }
    expect(changed).toHaveBeenLastCalledWith(null, expect.objectContaining({ id: event.id, outcome: 'automatic' }));
    expect(finished).not.toHaveBeenCalled();
  });
  it.each(['acknowledge', 'skip', 'snooze'] as const)('publishes preview %s terminal state without rest or real settlement', async action => {
    const changed = vi.fn(); const finished = vi.fn(); const coordinator = new ReminderCoordinator(snapshot, () => true, finished, vi.fn(), changed);
    const event = reminder('mask', 'preview'); await coordinator.present(event);
    expect(coordinator.resolvePreview(event.id, event.generation, action)).toBe(true);
    expect(changed).toHaveBeenLastCalledWith(null, expect.objectContaining({ id: event.id, outcome: action }));
    expect(finished).not.toHaveBeenCalled(); expect(coordinator.current).toBeNull();
  });
  it('preview cancellation and replacement clear current identity once', async () => {
    const changed = vi.fn(); const coordinator = new ReminderCoordinator(snapshot, () => true, vi.fn(), vi.fn(), changed);
    await coordinator.present(reminder('mask', 'preview')); coordinator.cancel(); coordinator.cancel();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenLastCalledWith(null, expect.objectContaining({ outcome: 'cancelled' }));
    await coordinator.present(reminder('mask')); expect(changed).toHaveBeenCalledTimes(2); coordinator.cancel();
  });
  it('rejects suppressed or immediate failed preview starts with typed errors and terminal diagnostics', async () => {
    const changed = vi.fn(); const finished = vi.fn(); const coordinator = new ReminderCoordinator(snapshot, () => false, finished, vi.fn(), changed);
    expect(await coordinator.present(reminder('flash', 'preview'))).toMatchObject({ ok: false, error: { code: 'REMINDER_SUPPRESSED' } });
    expect(changed).toHaveBeenLastCalledWith(null, expect.objectContaining({ outcome: 'failed' })); expect(finished).not.toHaveBeenCalled();
    const unavailable = () => { const current = snapshot(); current.capabilities.overlay.state = 'unsupported'; return current; };
    const denied = new ReminderCoordinator(unavailable, () => true, finished, vi.fn(), changed);
    const event = reminder('flash', 'preview'); event.settings.reminder.soundEnabled = false;
    expect(await denied.present(event)).toMatchObject({ ok: false, error: { code: 'REMINDER_DELIVERY_FAILED' } });
    expect(changed).toHaveBeenLastCalledWith(null, expect.objectContaining({ outcome: 'failed' })); expect(denied.current).toBeNull();
  });
  it('cancellation during preview preparation publishes one terminal state and cannot resurrect its identity', async () => {
    let release!: () => void; fake.loader = () => new Promise<void>(resolve => { release = resolve; });
    const changed = vi.fn(); const finished = vi.fn(); const coordinator = new ReminderCoordinator(snapshot, () => true, finished, vi.fn(), changed);
    const pending = coordinator.present(reminder('mask', 'preview'));
    coordinator.cancel(); release();
    expect(await pending).toMatchObject({ ok: false, error: { code: 'REMINDER_SUPPRESSED' } });
    expect(changed).toHaveBeenCalledTimes(2); expect(changed).toHaveBeenLastCalledWith(null, expect.objectContaining({ outcome: 'cancelled' }));
    expect(coordinator.current).toBeNull(); expect(finished).not.toHaveBeenCalled();
  });
  it('a real event created by the dispatch check cannot leave a stale active preview', async () => {
    const changed = vi.fn(); const finished = vi.fn();
    const coordinator = new ReminderCoordinator(snapshot, event => {
      if (event.kind === 'preview') { coordinator.cancel(); void coordinator.present(reminder('mask')); }
      return true;
    }, finished, vi.fn(), changed);
    expect(await coordinator.present(reminder('mask', 'preview'))).toMatchObject({ ok: false, error: { code: 'REMINDER_SUPPRESSED' } });
    expect(changed).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenLastCalledWith(null, expect.objectContaining({ outcome: 'cancelled' }));
    expect(coordinator.current?.kind).toBe('real'); expect(finished).not.toHaveBeenCalled(); coordinator.cancel();
  });
});
