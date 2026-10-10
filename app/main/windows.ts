import { BrowserWindow } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { trustedSource } from './ipc-validation';
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;
export type Surface = 'main' | 'tray' | 'overlay';
const surfaceURLs = new Map<number, string>();
export const isTrustedSurface = (senderId: number, source: string): boolean => trustedSource(source, surfaceURLs.get(senderId));
export const windowOptions = (): Electron.WebPreferences => ({ preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true });
export async function loadSurface(window: BrowserWindow, surface: Surface): Promise<void> {
  const senderId = window.webContents.id;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const url = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    url.searchParams.set('surface', surface);
    surfaceURLs.set(window.webContents.id, url.toString());
    window.once('closed', () => surfaceURLs.delete(senderId));
    await window.loadURL(url.toString());
  } else {
    const file = path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
    const url = pathToFileURL(file);
    url.searchParams.set('surface', surface);
    surfaceURLs.set(window.webContents.id, url.toString());
    window.once('closed', () => surfaceURLs.delete(senderId));
    await window.loadFile(file, { query: { surface } });
  }
}
