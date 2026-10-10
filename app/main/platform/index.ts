import { nativeTheme, Notification, powerMonitor, screen, systemPreferences } from 'electron';
import type { Capabilities, Capability, PlatformSample } from '../../shared/contracts';
import { createLinuxProvider, createMacProvider, createWindowsProvider, type LockState, type NativeProvider } from './native';
import { LinuxLockReader } from './linux-lock';

export { setLaunchAtLogin, migrateWindowsLaunchAtLogin } from './autostart';

const status = (state: Capability['state'], reason: string): Capability => ({ state, reason });
export class PlatformAdapter {
  private native: NativeProvider | null = null;
  private linuxLock: LinuxLockReader | null = null;
  private sequence = 0;
  private sleeping = false;
  private observedLock: LockState = 'unknown';
  private stopped = false;
  private listeners = new Set<() => void>();
  private cleanups: (() => void)[] = [];
  private fallbackAt = performance.now();
  private lastNow = 0;
  private fault = '';
  private reports: Capabilities;
  constructor(provider?: NativeProvider, private readonly host: NodeJS.Platform = process.platform, private readonly wayland = Boolean(process.env.WAYLAND_DISPLAY) || process.env.XDG_SESSION_TYPE === 'wayland') {
    const linux = host === 'linux';
    this.reports = {
      input: status('unknown', '正在检测当前会话输入'), mouse: status('unknown', '正在检测鼠标来源'), lock: status('unknown', '正在确认锁屏状态'),
      overlay: linux && wayland ? status('unsupported', 'Wayland 普通窗口无法保证定位、置顶及覆盖全桌面') : status('available', '原生桌面窗口；多屏和虚拟桌面需实机验收'),
      notification: Notification.isSupported() ? status('available', '系统通知接口可用；送达由权限和打包状态决定') : status('unsupported', '系统通知接口不可用'),
      tray: linux ? status('unknown', 'Linux 托盘取决于桌面扩展及 StatusNotifier 支持') : status('available', '系统托盘接口可用'),
      launchAtLogin: status('available', linux ? 'XDG 用户自动启动目录' : '系统登录启动项'),
    };
    try {
      if (provider) this.native = provider;
      else if (host === 'win32') this.native = createWindowsProvider();
      else if (host === 'darwin') this.native = createMacProvider();
      else if (linux && !wayland) this.native = createLinuxProvider();
      else this.fault = '当前桌面未提供经过验证的全局输入和连续时钟桥接';
    } catch (error) { this.fault = error instanceof Error ? error.message : '原生能力初始化失败'; }
    if (linux) {
      this.linuxLock = new LinuxLockReader(() => this.clock(), () => this.emit());
      void this.linuxLock.refresh();
    }
    const observe = (emitter: { on(event: string, listener: () => void): unknown; removeListener(event: string, listener: () => void): unknown }, event: string, listener: () => void) => {
      emitter.on(event, listener); this.cleanups.push(() => { emitter.removeListener(event, listener); });
    };
    observe(powerMonitor, 'suspend', () => { this.sleeping = true; this.linuxLock?.invalidate(); this.emit(); });
    observe(powerMonitor, 'resume', () => { this.sleeping = false; this.observedLock = 'unknown'; this.linuxLock?.invalidate(); this.emit(); });
    observe(powerMonitor, 'lock-screen', () => { this.observedLock = 'locked'; this.emit(); });
    observe(powerMonitor, 'unlock-screen', () => { this.observedLock = 'unlocked'; this.emit(); });
    observe(powerMonitor, 'user-did-resign-active', () => { this.observedLock = 'locked'; this.emit(); });
    observe(powerMonitor, 'user-did-become-active', () => { this.observedLock = 'unknown'; this.emit(); });
    for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) observe(screen, event, () => this.emit());
    observe(nativeTheme, 'updated', () => this.emit());
  }
  get capabilities(): Capabilities { return structuredClone(this.reports); }
  private emit(): void { if (!this.stopped) for (const listener of this.listeners) listener(); }
  private clock(): number {
    try { if (this.native) { const now = this.native.nowMs(); if (!Number.isFinite(now) || now < this.lastNow) throw new Error('连续时钟倒退'); this.lastNow = now; this.fallbackAt = performance.now(); return now; } }
    catch { this.fault = '连续时钟异常，无法确认离开时长；计时和提醒已暂停'; }
    const at = performance.now(); this.lastNow += Math.max(0, at - this.fallbackAt); this.fallbackAt = at; return this.lastNow;
  }
  sample(activitySource: 'combined' | 'mouse' = 'combined'): PlatformSample {
    const nowMs = this.clock();
    let combinedIdleMs: number | null = null;
    let mouseIdleMs: number | null = null;
    let lockState: LockState = 'unknown';
    if (this.native && !this.fault) {
      try { combinedIdleMs = this.native.combinedIdleMs(); this.reports.input = status('available', '当前交互会话合并输入空闲时间'); }
      catch { this.reports.input = status('error', '当前会话输入检测失败'); }
      try {
        mouseIdleMs = this.native.mouseIdleMs();
        this.reports.mouse = status(this.host === 'linux' ? 'unsupported' : 'available', this.native.mouseReason);
      } catch { this.reports.mouse = status('error', this.native.mouseReason); }
      if (this.linuxLock) {
        lockState = this.linuxLock.read();
        void this.linuxLock.refresh();
      } else {
        try { lockState = this.native.lockState(); } catch { lockState = 'unknown'; }
        // A lock event immediately suppresses effects during transition. Only a
        // real unlock event can supplement an unavailable macOS dictionary key.
        if (this.observedLock === 'locked') lockState = 'locked';
        else if (this.host === 'darwin' && lockState === 'unknown' && this.observedLock === 'unlocked') lockState = 'unlocked';
      }
    } else {
      this.reports.input = status('unsupported', this.fault);
      this.reports.mouse = status('unsupported', this.fault);
    }
    this.reports.lock = status(lockState === 'unknown' ? 'unknown' : 'available', this.fault || this.linuxLock?.reason || (lockState === 'unknown' ? '未能确认真实锁屏状态；提醒已暂停' : '原生当前会话锁屏状态'));
    const primaryId = screen.getPrimaryDisplay().id;
    const displays = screen.getAllDisplays().map(display => ({ id: String(display.id), label: display.label || `显示器 ${display.id}`, primary: display.id === primaryId, bounds: { ...display.bounds }, scaleFactor: display.scaleFactor }));
    let reduceMotion = false;
    try { reduceMotion = systemPreferences.getAnimationSettings().prefersReducedMotion; } catch { /* Linux desktops may not export this preference. */ }
    return { sequence: ++this.sequence, nowMs, clockTrusted: Boolean(this.native && !this.fault), combinedIdleMs, selectedSourceIdleMs: activitySource === 'combined' ? combinedIdleMs : mouseIdleMs, lockState, sleeping: this.sleeping, displays, capabilities: this.capabilities, systemTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light', reduceMotion, reduceTransparency: nativeTheme.prefersReducedTransparency ?? false };
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  dispose(): void { this.stopped = true; this.cleanups.forEach(cleanup => cleanup()); this.cleanups = []; this.listeners.clear(); this.linuxLock?.dispose(); this.native?.dispose(); this.native = null; }
}
