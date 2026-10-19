export const THEME_PREFERENCES = ['system', 'light', 'dark', 'handdrawn'] as const;
export type ThemePreference = typeof THEME_PREFERENCES[number];
/** OS samples remain light/dark; this type describes application presentation. */
export type EffectiveTheme = Exclude<ThemePreference, 'system'>;
export type CapabilityState = 'available' | 'unsupported' | 'permission_required' | 'error' | 'unknown';
export interface Capability { state: CapabilityState; reason: string }
export interface Capabilities { input: Capability; mouse: Capability; lock: Capability; overlay: Capability; notification: Capability; tray: Capability; launchAtLogin: Capability }
export interface DisplayInfo { id: string; label: string; primary: boolean; bounds: { x: number; y: number; width: number; height: number }; scaleFactor: number }
/** Legacy disk schema, accepted solely by explicit V1 migration. Never IPC. */
export interface SettingsV1 {
  schemaVersion: 1;
  timer: { mode: 'active' | 'fixed'; intervalMinutes: number; activitySource: 'combined' | 'mouse'; activeWindowSeconds: number; longIdleMinutes: number };
  reminder: { visual: 'flash' | 'mask' | 'notification' | 'none'; soundEnabled: boolean; soundId: 'gentle' | 'bell'; volumePercent: number; flashOpacityPercent: number; flashColor: string; fadeInMs: number; holdMs: number; fadeOutMs: number; snoozeMinutes: number; screenScope: 'all' | 'primary' | 'selected'; screenIds: string[]; message: string };
  appearance: { theme: 'system' | 'light' | 'dark'; showTrayCountdown: boolean; reduceMotion: 'system' | 'on'; reduceTransparency: 'system' | 'on' };
  general: { launchAtLogin: boolean };
}
/** Only the eight core choices are editable or persisted. */
export interface SettingsV2 {
  schemaVersion: 2;
  timer: { mode: 'active' | 'fixed'; intervalMinutes: number; longIdleMinutes: number };
  reminder: { visual: 'flash' | 'mask' | 'notification' | 'none'; soundEnabled: boolean };
  appearance: { theme: ThemePreference; showTrayCountdown: boolean };
  general: { launchAtLogin: boolean };
}
export const PRODUCT_DEFAULTS = Object.freeze({
  activeWindowSeconds: 60, activitySource: 'combined' as const,
  soundId: 'gentle' as const, volumePercent: 50,
  flashOpacityPercent: 90, flashColor: '#000000',
  fadeInMs: 600, holdMs: 800, fadeOutMs: 600,
  screenScope: 'all' as const, message: '该让眼睛休息一下了',
});
export const defaultSettings = (): SettingsV2 => ({
  schemaVersion: 2,
  timer: { mode: 'active', intervalMinutes: 30, longIdleMinutes: 10 },
  reminder: { visual: 'flash', soundEnabled: false },
  appearance: { theme: 'handdrawn', showTrayCountdown: true },
  general: { launchAtLogin: false },
});
export const defaultSettingsV2 = defaultSettings;
export interface ResolvedSettings extends Omit<SettingsV2, 'timer' | 'reminder' | 'appearance'> {
  timer: SettingsV2['timer'] & { activitySource: 'combined'; activeWindowSeconds: number };
  reminder: SettingsV2['reminder'] & { soundId: 'gentle'; volumePercent: number; flashOpacityPercent: number; flashColor: string; fadeInMs: number; holdMs: number; fadeOutMs: number; screenScope: 'all'; screenIds: string[]; message: string };
  appearance: SettingsV2['appearance'] & { reduceMotion: 'system'; reduceTransparency: 'system' };
}
/** Resolve defaults once when creating an immutable real or preview event. */
export function resolveSettings(settings: SettingsV2): ResolvedSettings {
  return {
    ...structuredClone(settings),
    timer: { ...settings.timer, activitySource: PRODUCT_DEFAULTS.activitySource, activeWindowSeconds: PRODUCT_DEFAULTS.activeWindowSeconds },
    reminder: { ...settings.reminder, soundId: PRODUCT_DEFAULTS.soundId, volumePercent: PRODUCT_DEFAULTS.volumePercent,
      flashOpacityPercent: PRODUCT_DEFAULTS.flashOpacityPercent, flashColor: PRODUCT_DEFAULTS.flashColor,
      fadeInMs: PRODUCT_DEFAULTS.fadeInMs, holdMs: PRODUCT_DEFAULTS.holdMs, fadeOutMs: PRODUCT_DEFAULTS.fadeOutMs,
      screenScope: PRODUCT_DEFAULTS.screenScope, screenIds: [], message: PRODUCT_DEFAULTS.message },
    appearance: { ...settings.appearance, reduceMotion: 'system', reduceTransparency: 'system' },
  };
}
export interface PlatformSample { sequence: number; nowMs: number; clockTrusted: boolean; combinedIdleMs: number | null; selectedSourceIdleMs: number | null; lockState: 'locked' | 'unlocked' | 'unknown'; sleeping: boolean; displays: DisplayInfo[]; capabilities: Capabilities; systemTheme: 'light' | 'dark'; reduceMotion: boolean; reduceTransparency: boolean }
export type RuntimeStatus = 'starting' | 'counting' | 'short_idle' | 'long_idle' | 'locked' | 'sleeping' | 'paused' | 'reminding' | 'capability_error';
export type ReminderAction = 'acknowledge' | 'skip';
export interface ReminderEvent { id: string; generation: number; kind: 'real' | 'preview'; settings: ResolvedSettings; screenIds: string[]; createdAtMs: number }
export interface ChannelResult { channel: 'visual' | 'sound'; success: boolean; message: string }
export interface ReminderResult { id: string; outcome: 'automatic' | 'acknowledge' | 'skip' | 'cancelled' | 'failed'; channels: ChannelResult[] }
export interface PreviewResult { id: string; outcome: ReminderResult['outcome']; channels: ChannelResult[] }
export interface RuntimeSnapshot { settingsRevision: number; settings: SettingsV2; sequence: number; status: RuntimeStatus; statusReason: string; elapsedActiveMs: number; remainingMs: number | null; currentReminderId: string | null; currentPreviewId: string | null; latestPreviewResult: PreviewResult | null; theme: EffectiveTheme; reduceMotion: boolean; reduceTransparency: boolean; capabilities: Capabilities; displays: DisplayInfo[]; latestReminderResult: ReminderResult | null; restConfirmedCount: number; warnings: string[] }
export type EngineEffect = { type: 'present'; reminder: ReminderEvent } | { type: 'cancel'; id: string; generation: number } | { type: 'rest_confirmed'; id: string };
export interface EngineUpdate { snapshot: RuntimeSnapshot; effects: EngineEffect[] }
export interface AppError { code: string; message: string; fields?: Record<string, string>; currentRevision?: number }
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };
export interface OverlayState { event: ReminderEvent; theme: EffectiveTheme; reduceMotion: boolean; reduceTransparency: boolean }
export interface EyeCareBridge {
  getSnapshot(): Promise<RuntimeSnapshot>;
  subscribeSnapshot(listener: (snapshot: RuntimeSnapshot) => void): () => void;
  saveSettings(expectedRevision: number, settings: SettingsV2): Promise<Result<RuntimeSnapshot>>;
  pause(): Promise<Result<RuntimeSnapshot>>;
  resume(): Promise<Result<RuntimeSnapshot>>;
  remindNow(): Promise<Result<RuntimeSnapshot>>;
  resolveReminder(id: string, generation: number, action: ReminderAction): Promise<Result<RuntimeSnapshot>>;
  preview(settings: SettingsV2): Promise<Result<string>>;
  cancelPreview(): Promise<Result<null>>;
  getOverlay(): Promise<OverlayState | null>;
  subscribeOverlay(listener: (state: OverlayState | null) => void): () => void;
  overlayReady(id: string, generation: number): Promise<Result<null>>;
  overlaySoundStarted(id: string, generation: number): Promise<Result<null>>;
  overlayFinished(id: string, generation: number, results: ChannelResult[]): Promise<Result<null>>;
  openSettings(): Promise<Result<null>>;
  subscribeOpenSettings(listener: () => void): () => void;
  quit(): Promise<Result<null>>;
}
export const formatTime = (ms: number | null): string => {
  if (ms === null) return '—';
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
export const statusLabels: Record<RuntimeStatus, string> = { starting: '正在检测系统状态', counting: '正在计时', short_idle: '空闲暂停', long_idle: '等待活动', locked: '屏幕已锁定', sleeping: '系统正在睡眠', paused: '已暂停', reminding: '等待提醒结束', capability_error: '检测能力异常' };
