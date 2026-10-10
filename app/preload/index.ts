import { contextBridge, ipcRenderer } from 'electron';
import type { EyeCareBridge, OverlayState, RuntimeSnapshot } from '../shared/contracts';

const subscribe = <T>(channel: string, listener: (value: T) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
const bridge: EyeCareBridge = {
  getSnapshot: () => ipcRenderer.invoke('eyecare:snapshot'),
  subscribeSnapshot: listener => subscribe<RuntimeSnapshot>('eyecare:snapshot-updated', listener),
  saveSettings: (expectedRevision, settings) => ipcRenderer.invoke('eyecare:save', { expectedRevision, settings }),
  pause: durationMinutes => ipcRenderer.invoke('eyecare:pause', { durationMinutes }),
  resume: () => ipcRenderer.invoke('eyecare:resume'),
  remindNow: () => ipcRenderer.invoke('eyecare:remind-now'),
  resolveReminder: (id, generation, action) => ipcRenderer.invoke('eyecare:resolve', { id, generation, action }),
  preview: settings => ipcRenderer.invoke('eyecare:preview', { settings }),
  cancelPreview: () => ipcRenderer.invoke('eyecare:cancel-preview'),
  getOverlay: () => ipcRenderer.invoke('eyecare:overlay'),
  subscribeOverlay: listener => subscribe<OverlayState | null>('eyecare:overlay-updated', listener),
  overlayReady: (id, generation) => ipcRenderer.invoke('eyecare:overlay-ready', { id, generation }),
  overlaySoundStarted: (id, generation) => ipcRenderer.invoke('eyecare:overlay-sound-started', { id, generation }),
  overlayFinished: (id, generation, results) => ipcRenderer.invoke('eyecare:overlay-finished', { id, generation, results }),
  openSettings: () => ipcRenderer.invoke('eyecare:open-settings'),
  subscribeOpenSettings: listener => {
    let active = true;
    const off = subscribe<null>('eyecare:open-settings', () => { void ipcRenderer.invoke('eyecare:settings-requested'); listener(); });
    void ipcRenderer.invoke('eyecare:settings-requested').then(requested => { if (active && requested) listener(); }).catch(() => undefined);
    return () => { active = false; off(); };
  },
  quit: () => ipcRenderer.invoke('eyecare:quit'),
};
contextBridge.exposeInMainWorld('eyeCare', Object.freeze(bridge));
