import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ChannelResult, EyeCareBridge, OverlayState, ReminderAction, Result, RuntimeSnapshot, SettingsV2 } from '../shared/contracts';

/**
 * Tauri 侧的 `EyeCareBridge` 实现。
 *
 * 与 Electron 的 `app/preload/index.ts` 保持同形状：命令走 `invoke`，
 * 推送走 `listen`，因此 `app/renderer/*` 无需任何改动。
 */

/** 事件订阅需要先完成的异步注册，用一次性标记保证卸载时不漏掉。 */
const subscribe = <T>(channel: string, listener: (value: T) => void): (() => void) => {
  let unlisten: (() => void) | null = null;
  let disposed = false;
  void listen<T>(channel, event => listener(event.payload))
    .then(off => { if (disposed) off(); else unlisten = off; })
    .catch(() => undefined);
  return () => { disposed = true; unlisten?.(); unlisten = null; };
};

const bridge: EyeCareBridge = {
  getSnapshot: () => invoke<RuntimeSnapshot>('get_snapshot'),
  subscribeSnapshot: listener => subscribe<RuntimeSnapshot>('eyecare:snapshot-updated', listener),
  saveSettings: (expectedRevision, settings) => invoke<Result<RuntimeSnapshot>>('save_settings', { expectedRevision, settings }),
  pause: () => invoke<Result<RuntimeSnapshot>>('pause'),
  resume: () => invoke<Result<RuntimeSnapshot>>('resume'),
  remindNow: () => invoke<Result<RuntimeSnapshot>>('remind_now'),
  resolveReminder: (id, generation, action) => invoke<Result<RuntimeSnapshot>>('resolve_reminder', { id, generation, action }),
  preview: (settings: SettingsV2) => invoke<Result<string>>('preview', { settings }),
  cancelPreview: () => invoke<Result<null>>('cancel_preview'),
  getOverlay: () => invoke<OverlayState | null>('get_overlay'),
  subscribeOverlay: listener => subscribe<OverlayState | null>('eyecare:overlay-updated', listener),
  overlayReady: (id, generation) => invoke<Result<null>>('overlay_ready', { id, generation }),
  overlaySoundStarted: (id, generation) => invoke<Result<null>>('overlay_sound_started', { id, generation }),
  overlayFinished: (id, generation, results: ChannelResult[]) => invoke<Result<null>>('overlay_finished', { id, generation, results }),
  openSettings: () => invoke<Result<null>>('open_settings'),
  subscribeOpenSettings: listener => {
    let active = true;
    const off = subscribe<null>('eyecare:open-settings', () => { void invoke<boolean>('settings_requested'); listener(); });
    void invoke<boolean>('settings_requested').then(requested => { if (active && requested) listener(); }).catch(() => undefined);
    return () => { active = false; off(); };
  },
  quit: () => invoke<Result<null>>('quit'),
};

window.eyeCare = bridge;
