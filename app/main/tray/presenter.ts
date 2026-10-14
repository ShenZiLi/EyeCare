import { Menu, Tray, nativeImage, nativeTheme } from 'electron';
import path from 'node:path';
import { formatTime, statusLabels, type RuntimeSnapshot } from '../../shared/contracts';
import { numericTrayIcon, trayLabel } from './icon';

export class TrayPresenter {
  private tray: Tray | null = null;
  private iconKey = '';
  private menuKey = '';
  private standardIcon(dark: boolean): Electron.NativeImage {
    const size = process.platform === 'darwin' ? 18 : 32;
    const image = nativeImage.createFromPath(path.join(__dirname, `../../resources/tray-rest-${dark && process.platform !== 'darwin' ? 'dark' : 'light'}.png`)).resize({ width: size });
    if (process.platform === 'darwin') image.setTemplateImage(true);
    return image;
  }
  constructor(private readonly callbacks: { showMain: () => void; settings: () => void; pause: () => void; resume: () => void; remindNow: () => void; quit: () => void }) {}
  create(): boolean {
    try {
      const image = this.standardIcon(nativeTheme.shouldUseDarkColors);
      this.tray = new Tray(image.isEmpty() ? numericTrayIcon('-', nativeTheme.shouldUseDarkColors) : image);
      // macOS presents the registered context menu automatically on click.
      if (process.platform !== 'darwin') this.tray.on('click', () => this.tray?.popUpContextMenu());
      return true;
    } catch { return false; }
  }
  get available(): boolean { return this.tray !== null; }
  update(snapshot: RuntimeSnapshot) {
    if (!this.tray) return;
    const remaining = snapshot.remainingMs;
    const showing = snapshot.settings.appearance.showTrayCountdown;
    const state = statusLabels[snapshot.status];
    const counting = ['counting', 'short_idle'].includes(snapshot.status);
    const text = snapshot.status === 'paused' ? 'P' : counting ? trayLabel(remaining) : snapshot.status === 'capability_error' ? '!' : '-';
    const dark = nativeTheme.shouldUseDarkColors;
    const darwin = process.platform === 'darwin';
    // macOS shows the app mark next to the title; Windows/Linux use a number glyph while counting.
    const key = darwin ? (showing ? 'icon:text' : 'icon') : `${showing ? text : 'eye'}:${dark}`;
    if (key !== this.iconKey) {
      const image = darwin ? this.standardIcon(dark) : showing ? numericTrayIcon(text, dark) : this.standardIcon(dark);
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
        snapshot.status === 'paused' ? { label: '恢复计时', click: this.callbacks.resume } : { label: '暂停', click: this.callbacks.pause },
        { label: '立即提醒', enabled: ['counting', 'short_idle'].includes(snapshot.status), click: this.callbacks.remindNow },
        { label: '设置', click: this.callbacks.settings }, { type: 'separator' }, { label: '退出 EyeCare', click: this.callbacks.quit },
      ]));
      this.menuKey = menuKey;
    }
  }
  dispose() { this.tray?.destroy(); this.tray = null; }
}
