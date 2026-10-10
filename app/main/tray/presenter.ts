import { BrowserWindow, Menu, Tray, nativeImage, nativeTheme, screen } from 'electron';
import path from 'node:path';
import { formatTime, statusLabels, type RuntimeSnapshot } from '../../shared/contracts';
import { loadSurface, windowOptions } from '../windows';
import { numericTrayIcon, trayLabel } from './icon';

export class TrayPresenter {
  private tray: Tray | null = null;
  private panel: BrowserWindow | null = null;
  private iconKey = '';
  private menuKey = '';
  private snapshot: RuntimeSnapshot | null = null;
  private standardIcon(dark: boolean): Electron.NativeImage {
    const image = nativeImage.createFromPath(path.join(__dirname, `../../resources/tray-eye-${dark && process.platform !== 'darwin' ? 'dark' : 'light'}.png`)).resize({ width: 32, height: 32 });
    if (process.platform === 'darwin') image.setTemplateImage(true);
    return image;
  }
  constructor(private readonly callbacks: { showMain: () => void; settings: () => void; pause: (minutes: 15 | 30 | 60 | null) => void; resume: () => void; remindNow: () => void; quit: () => void }) {}
  create(): boolean {
    try {
      const image = this.standardIcon(nativeTheme.shouldUseDarkColors);
      this.tray = new Tray(image.isEmpty() ? numericTrayIcon('-', nativeTheme.shouldUseDarkColors) : image);
      this.tray.on('click', () => { void this.togglePanel(); });
      this.tray.on('double-click', this.callbacks.showMain);
      return true;
    } catch { return false; }
  }
  get available(): boolean { return this.tray !== null; }
  get window(): BrowserWindow | null { return this.panel; }
  update(snapshot: RuntimeSnapshot) {
    this.snapshot = snapshot;
    if (!this.tray) return;
    const remaining = snapshot.status === 'snoozed' ? snapshot.snoozeRemainingMs : snapshot.remainingMs;
    const showing = snapshot.settings.appearance.showTrayCountdown;
    const state = statusLabels[snapshot.status];
    const counting = ['counting', 'short_idle', 'snoozed'].includes(snapshot.status);
    const text = snapshot.status === 'paused' ? 'P' : counting ? trayLabel(remaining) : snapshot.status === 'capability_error' ? '!' : '-';
    const dark = nativeTheme.shouldUseDarkColors;
    const key = `${showing ? text : 'eye'}:${dark}`;
    if (key !== this.iconKey) {
      const image = showing ? numericTrayIcon(text, dark) : this.standardIcon(dark);
      if (process.platform === 'darwin') image.setTemplateImage(true);
      this.tray.setImage(image);
      this.iconKey = key;
    }
    if (process.platform === 'darwin') this.tray.setTitle(showing ? counting ? formatTime(remaining) : state : '', { fontType: 'monospacedDigit' });
    this.tray.setToolTip(`EyeCare · ${state}${showing ? ` · ${formatTime(remaining)}` : ''}${snapshot.statusReason ? `\n${snapshot.statusReason}` : ''}`);
    const menuKey = `${snapshot.status}:${showing}:${Math.ceil((remaining ?? 0) / 60000)}`;
    if (menuKey !== this.menuKey) {
      this.tray.setContextMenu(Menu.buildFromTemplate([
        { label: `EyeCare · ${state}`, enabled: false }, { type: 'separator' },
        { label: '打开概览', click: this.callbacks.showMain },
        ...(snapshot.status === 'paused' ? [{ label: '恢复计时', click: this.callbacks.resume }] : [{ label: '暂停', submenu: [{ label: '15 分钟', click: () => this.callbacks.pause(15) }, { label: '30 分钟', click: () => this.callbacks.pause(30) }, { label: '60 分钟', click: () => this.callbacks.pause(60) }, { label: '直到手动恢复', click: () => this.callbacks.pause(null) }] }]),
        { label: '立即提醒', enabled: ['counting', 'short_idle'].includes(snapshot.status), click: this.callbacks.remindNow },
        { label: '设置', click: this.callbacks.settings }, { type: 'separator' }, { label: '退出 EyeCare', click: this.callbacks.quit },
      ]));
      this.menuKey = menuKey;
    }
  }
  async togglePanel() {
    if (!this.tray) return;
    if (this.panel?.isVisible()) { this.panel.hide(); return; }
    if (!this.panel || this.panel.isDestroyed()) {
      this.panel = new BrowserWindow({ width: 340, height: 390, frame: false, resizable: false, show: false, skipTaskbar: true, alwaysOnTop: true, webPreferences: windowOptions() });
      this.panel.on('blur', () => this.panel?.hide());
      this.panel.on('closed', () => { this.panel = null; });
      await loadSurface(this.panel, 'tray');
    }
    const bounds = this.tray.getBounds();
    const work = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y }).workArea;
    const x = Math.max(work.x, Math.min(bounds.x - 170, work.x + work.width - 340));
    const y = bounds.y < work.y + work.height / 2 ? Math.max(work.y, bounds.y + bounds.height + 8) : work.y + work.height - 398;
    this.panel.setPosition(Math.round(x), Math.round(y));
    if (this.snapshot) this.panel.webContents.send('eyecare:snapshot-updated', this.snapshot);
    this.panel.show();
    this.panel.focus();
  }
  dispose() { this.panel?.destroy(); this.tray?.destroy(); this.tray = null; }
}
