import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NativeProvider } from '../../app/main/platform/native';

const runtime = vi.hoisted(() => {
  const emitter = () => {
    const map = new Map<string, Set<() => void>>();
    return {
      on(name: string, fn: () => void) { if (!map.has(name)) map.set(name, new Set()); map.get(name)!.add(fn); },
      removeListener(name: string, fn: () => void) { map.get(name)?.delete(fn); },
      emit(name: string) { map.get(name)?.forEach(fn => fn()); },
    };
  };
  return {
    powerMonitor: emitter(),
    nativeTheme: { ...emitter(), shouldUseDarkColors: false, prefersReducedTransparency: true },
    screen: { ...emitter(), getPrimaryDisplay: () => ({ id: 7 }), getAllDisplays: () => [{ id: 7, label: 'A', bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1.25 }] },
    Notification: { isSupported: () => true },
    systemPreferences: { getAnimationSettings: () => ({ prefersReducedMotion: true }) },
    app: {},
  };
});
vi.mock('electron', () => runtime);
import { PlatformAdapter } from '../../app/main/platform';
import { LinuxLockReader, type CommandRunner } from '../../app/main/platform/linux-lock';

const created: PlatformAdapter[] = [];
function adapter(overrides: Partial<NativeProvider> = {}, host: NodeJS.Platform = 'win32') {
  const provider: NativeProvider = { nowMs: () => 1000, combinedIdleMs: () => 20, mouseIdleMs: () => 900, lockState: () => 'unlocked', mouseReason: 'native mouse', dispose: vi.fn(), ...overrides };
  const value = new PlatformAdapter(provider, host, false); created.push(value); return { value, provider };
}
afterEach(() => { created.splice(0).forEach(value => value.dispose()); });

describe('platform safety boundary', () => {
  it('keeps combined idle separate from mouse idle and shares increasing observations', () => {
    const { value } = adapter();
    const first = value.sample('combined');
    const second = value.sample('mouse');
    expect(first.selectedSourceIdleMs).toBe(20);
    expect(second.selectedSourceIdleMs).toBe(900);
    expect(second.combinedIdleMs).toBe(20);
    expect(second.sequence).toBe(first.sequence + 1);
  });
  it('never treats unavailable lock measurements as unlocked', () => {
    const { value } = adapter({ lockState: () => 'unknown' });
    expect(value.sample().lockState).toBe('unknown');
    expect(value.capabilities.lock.state).toBe('unknown');
  });
  it('does not substitute zero idle after an input failure', () => {
    const { value } = adapter({ combinedIdleMs: () => { throw new Error('no input'); } });
    const sample = value.sample();
    expect(sample.combinedIdleMs).toBeNull();
    expect(sample.selectedSourceIdleMs).toBeNull();
    expect(sample.capabilities.input.state).toBe('error');
  });
  it('blocks critical state after continuous clock failure', () => {
    const { value } = adapter({ nowMs: () => { throw new Error('clock'); } });
    expect(value.sample().clockTrusted).toBe(false);
    expect(value.sample().lockState).toBe('unknown');
    expect(value.sample().combinedIdleMs).toBeNull();
  });
  it('detects backwards continuous time rather than crediting it', () => {
    let now = 2000;
    const { value } = adapter({ nowMs: () => now });
    value.sample(); now = 100;
    const next = value.sample();
    expect(next.nowMs).toBeGreaterThanOrEqual(2000);
    expect(next.lockState).toBe('unknown');
  });
  it('reports suspend immediately and queries real state again on resume', () => {
    const { value } = adapter();
    const samples: boolean[] = [];
    value.subscribe(() => samples.push(value.sample().sleeping));
    runtime.powerMonitor.emit('suspend');
    runtime.powerMonitor.emit('resume');
    expect(samples).toEqual([true, false]);
  });
  it('a lock event immediately overrides an otherwise unlocked native sample', () => {
    const { value } = adapter();
    runtime.powerMonitor.emit('lock-screen');
    expect(value.sample().lockState).toBe('locked');
    runtime.powerMonitor.emit('unlock-screen');
    expect(value.sample().lockState).toBe('unlocked');
  });
  it('a missing macOS lock key requires a real unlock event', () => {
    const { value } = adapter({ lockState: () => 'unknown' }, 'darwin');
    expect(value.sample().lockState).toBe('unknown');
    runtime.powerMonitor.emit('unlock-screen');
    expect(value.sample().lockState).toBe('unlocked');
    runtime.powerMonitor.emit('resume');
    expect(value.sample().lockState).toBe('unknown');
  });
  it('reports the actual system accessibility preferences and display scale', () => {
    const { value } = adapter();
    const sample = value.sample();
    expect(sample.reduceMotion).toBe(true);
    expect(sample.reduceTransparency).toBe(true);
    expect(sample.displays[0]).toMatchObject({ id: '7', primary: true, scaleFactor: 1.25 });
  });
  it('disposal releases native resources and unsubscribes all runtime listeners', () => {
    const { value, provider } = adapter();
    const listener = vi.fn(); value.subscribe(listener); value.dispose();
    runtime.powerMonitor.emit('lock-screen'); runtime.nativeTheme.emit('updated');
    expect(listener).not.toHaveBeenCalled();
    expect(provider.dispose).toHaveBeenCalledOnce();
  });
});

const linuxRunner = (active: string, hint: string, desktop: string): CommandRunner => async (_file, args) => {
  if (args.includes('GetSessionByPID')) return 'o "/org/freedesktop/login1/session/_32"';
  if (args.at(-1) === 'Active') return active;
  if (args.at(-1) === 'LockedHint') return hint;
  return desktop;
};
describe('Linux session lock confirmation', () => {
  it('requires both logind and the real desktop to confirm unlock', async () => {
    const reader = new LinuxLockReader(() => 0, () => {}, linuxRunner('b true', 'b false', '(false,)'));
    expect(reader.read()).toBe('unknown'); await reader.refresh(); expect(reader.read()).toBe('unlocked');
  });
  it('refuses a lock hint when the desktop disagrees', async () => {
    const reader = new LinuxLockReader(() => 0, () => {}, linuxRunner('b true', 'b true', '(false,)'));
    await reader.refresh(); expect(reader.read()).toBe('unknown');
  });
  it('expires cached unlock rather than carrying it through a service stall', async () => {
    let now = 0;
    const reader = new LinuxLockReader(() => now, () => {}, linuxRunner('b true', 'b false', '(false,)'));
    await reader.refresh(); now = 1501; expect(reader.read()).toBe('unknown');
  });
  it('cannot replace a post-resume unknown with a pre-resume in-flight result', async () => {
    let unblock: (value: string) => void = () => {};
    const run: CommandRunner = async (_file, args) => args.includes('GetSessionByPID') ? await new Promise(resolve => { unblock = resolve; }) : linuxRunner('b true', 'b false', '(false,)')(_file, args);
    const reader = new LinuxLockReader(() => 0, () => {}, run);
    const pending = reader.refresh(); reader.invalidate(); unblock('o "/org/freedesktop/login1/session/_32"'); await pending;
    expect(reader.read()).toBe('unknown');
  });
  it('keeps inaccessible desktop and disconnected sessions suppressed', async () => {
    const inaccessible = new LinuxLockReader(() => 0, () => {}, async () => { throw new Error('missing dbus'); });
    await inaccessible.refresh(); expect(inaccessible.read()).toBe('unknown');
    const disconnected = new LinuxLockReader(() => 0, () => {}, linuxRunner('b false', 'b false', '(false,)'));
    await disconnected.refresh(); expect(disconnected.read()).toBe('locked');
  });
});
