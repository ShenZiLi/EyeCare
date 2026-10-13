import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TimerEngine } from '../../app/main/engine/timer-engine';
import { TrayPresenter } from '../../app/main/tray/presenter';

const native = vi.hoisted(() => {
  const image = { resize: vi.fn(), isEmpty: () => false, setTemplateImage: vi.fn() };
  image.resize.mockReturnValue(image);
  const menu = vi.fn((template: Electron.MenuItemConstructorOptions[]) => template);
  const tray = { on: vi.fn(), setImage: vi.fn(), setTitle: vi.fn(), setToolTip: vi.fn(), setContextMenu: vi.fn(), popUpContextMenu: vi.fn(), destroy: vi.fn() };
  return { image, menu, tray };
});
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: native.menu },
  Tray: class { constructor() { return native.tray; } },
  nativeTheme: { shouldUseDarkColors: false },
  nativeImage: { createFromPath: () => native.image, createFromBuffer: () => native.image },
}));

describe('native tray manual pause actions', () => {
  beforeEach(() => vi.clearAllMocks());
  it('shows one pause action without duration submenu and calls it without a duration', () => {
    const callbacks = { showMain: vi.fn(), settings: vi.fn(), pause: vi.fn(), resume: vi.fn(), remindNow: vi.fn(), quit: vi.fn() };
    const presenter = new TrayPresenter(callbacks);
    expect(presenter.create()).toBe(true);
    presenter.update({ ...new TimerEngine().getSnapshot(), status: 'counting' });
    const menu = native.menu.mock.calls.at(-1)![0];
    const pause = menu.find(item => item.label === '暂停');
    expect(pause).toBeDefined();
    expect(pause).not.toHaveProperty('submenu');
    expect(menu.some(item => item.label === '恢复计时')).toBe(false);
    (pause!.click as () => void)();
    expect(callbacks.pause).toHaveBeenCalledExactlyOnceWith();
    expect(callbacks.resume).not.toHaveBeenCalled();
    presenter.dispose();
  });
  it('replaces pause with one explicit resume action when paused', () => {
    const callbacks = { showMain: vi.fn(), settings: vi.fn(), pause: vi.fn(), resume: vi.fn(), remindNow: vi.fn(), quit: vi.fn() };
    const presenter = new TrayPresenter(callbacks);
    presenter.create();
    const snapshot = new TimerEngine().getSnapshot();
    presenter.update({ ...snapshot, status: 'counting' });
    presenter.update({ ...snapshot, status: 'paused' });
    const menu = native.menu.mock.calls.at(-1)![0];
    expect(menu.some(item => item.label === '暂停')).toBe(false);
    expect(menu.some(item => item.submenu !== undefined)).toBe(false);
    const resume = menu.find(item => item.label === '恢复计时');
    (resume!.click as () => void)();
    expect(callbacks.resume).toHaveBeenCalledExactlyOnceWith();
    expect(callbacks.pause).not.toHaveBeenCalled();
    expect(menu.find(item => item.label === '立即提醒')?.enabled).toBe(false);
    presenter.dispose();
  });
});
