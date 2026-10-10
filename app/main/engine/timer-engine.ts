import { randomUUID } from 'node:crypto';
import { defaultSettings, type Capabilities, type ChannelResult, type EngineEffect, type EngineUpdate, type PlatformSample, type ReminderAction, type ReminderEvent, type RuntimeSnapshot, type RuntimeStatus, type SettingsV1 } from '../../shared/contracts';

const unknownCapabilities = (): Capabilities => Object.fromEntries(['input', 'mouse', 'lock', 'overlay', 'notification', 'tray', 'launchAtLogin'].map(key => [key, { state: 'unknown', reason: '等待系统检测' }])) as unknown as Capabilities;
const validIdle = (idle: number | null): idle is number => idle !== null && Number.isFinite(idle) && idle >= 0;

/** Pure state owner. nowMs must be a platform monotonic clock, including suspend duration. */
export class TimerEngine {
  private settings: SettingsV1;
  private cycleSettings: SettingsV1;
  private revision: number;
  private sample: PlatformSample | null = null;
  private now: number;
  private sequence = 0;
  private elapsed = 0;
  private deadline: number;
  private pauseUntil: number | null | undefined;
  private snoozeUntil: number | null = null;
  private reminder: ReminderEvent | null = null;
  private reminderChannels: ChannelResult[] = [];
  private generation = 0;
  private lastResult: RuntimeSnapshot['latestReminderResult'] = null;
  private restCount = 0;
  private warnings: string[] = [];
  private absenceSince: number | null = null;
  private restartOnRecovery = false;
  private pendingTimerReset = false;
  private activitySourceChanged = false;

  constructor(settings: SettingsV1 = defaultSettings(), revision = 0, nowMs = 0) {
    this.settings = structuredClone(settings);
    this.cycleSettings = structuredClone(settings);
    this.revision = revision;
    this.now = nowMs;
    this.deadline = nowMs + this.interval();
  }
  private interval(): number { return this.cycleSettings.timer.intervalMinutes * 60_000; }
  private longIdle(sample = this.sample): boolean { return !!sample && validIdle(sample.combinedIdleMs) && sample.combinedIdleMs >= this.cycleSettings.timer.longIdleMinutes * 60_000; }
  private fault(sample = this.sample): string | null {
    if (!sample) return '等待系统状态';
    if (!sample.clockTrusted) return '连续时钟不可用，无法确认离开时长；计时和提醒已暂停';
    if (sample.lockState === 'unknown' || sample.capabilities.lock.state !== 'available') return sample.capabilities.lock.reason || '锁屏状态未知';
    if (sample.capabilities.input.state !== 'available' || !validIdle(sample.combinedIdleMs)) return sample.capabilities.input.reason || '输入活动检测不可用';
    if (this.cycleSettings.timer.mode === 'active' && (!validIdle(sample.selectedSourceIdleMs) || (this.cycleSettings.timer.activitySource === 'mouse' && sample.capabilities.mouse.state !== 'available'))) return '所选活动来源不可用';
    return null;
  }
  private suppressed(sample = this.sample): boolean {
    return !sample || sample.sleeping || sample.lockState !== 'unlocked' || !!this.fault(sample) || this.pauseUntil !== undefined || this.longIdle(sample);
  }
  private status(): [RuntimeStatus, string] {
    const s = this.sample;
    if (!s) return ['starting', '等待系统状态'];
    if (s.sleeping) return ['sleeping', '系统正在睡眠'];
    if (s.lockState === 'locked') return ['locked', '屏幕已锁定'];
    const fault = this.fault();
    if (fault) return ['capability_error', fault];
    if (this.pauseUntil !== undefined) return ['paused', '已暂停提醒'];
    if (this.longIdle()) return ['long_idle', '长时间没有输入，累计已清零'];
    if (this.reminder) return ['reminding', this.pendingTimerReset ? '当前提醒保持原配置，新计时参数将在下一周期生效' : '等待提醒结束'];
    if (this.snoozeUntil !== null) return ['snoozed', '稍后提醒'];
    if (this.cycleSettings.timer.mode === 'active' && (s.selectedSourceIdleMs ?? Infinity) > this.cycleSettings.timer.activeWindowSeconds * 1000) return ['short_idle', '空闲暂停累计'];
    return ['counting', '正在计时'];
  }
  getSnapshot(): RuntimeSnapshot {
    const [status, statusReason] = this.status();
    const s = this.sample;
    return structuredClone({
      settingsRevision: this.revision, settings: this.settings, sequence: this.sequence, status, statusReason,
      elapsedActiveMs: this.elapsed,
      remainingMs: this.cycleSettings.timer.mode === 'active' ? Math.max(0, this.interval() - this.elapsed) : Math.max(0, this.deadline - this.now),
      pauseRemainingMs: typeof this.pauseUntil === 'number' ? Math.max(0, this.pauseUntil - this.now) : null,
      snoozeRemainingMs: this.snoozeUntil === null ? null : Math.max(0, this.snoozeUntil - this.now),
      currentReminderId: this.reminder?.id ?? null,
      currentPreviewId: null, latestPreviewResult: null,
      theme: this.settings.appearance.theme === 'system' ? s?.systemTheme ?? 'light' : this.settings.appearance.theme,
      reduceMotion: this.settings.appearance.reduceMotion === 'on' || !!s?.reduceMotion,
      reduceTransparency: this.settings.appearance.reduceTransparency === 'on' || !!s?.reduceTransparency,
      capabilities: s?.capabilities ?? unknownCapabilities(), displays: s?.displays ?? [],
      latestReminderResult: this.lastResult, restConfirmedCount: this.restCount, warnings: this.warnings,
    });
  }
  private update(effects: EngineEffect[] = []): EngineUpdate { return { snapshot: this.getSnapshot(), effects }; }
  private time(nowMs?: number): void { if (nowMs !== undefined && Number.isFinite(nowMs)) this.now = Math.max(this.now, nowMs); }
  private reset(): void {
    if (this.cycleSettings.timer.activitySource !== this.settings.timer.activitySource) this.activitySourceChanged = true;
    this.cycleSettings = structuredClone(this.settings);
    this.pendingTimerReset = false;
    this.elapsed = 0;
    this.deadline = this.now + this.interval();
  }
  private cancel(effects: EngineEffect[], restartOnRecovery = true): void {
    if (!this.reminder && this.snoozeUntil === null) return;
    if (this.reminder) {
      effects.push({ type: 'cancel', id: this.reminder.id, generation: this.reminder.generation });
      this.lastResult = { id: this.reminder.id, outcome: 'cancelled', channels: structuredClone(this.reminderChannels) };
    }
    this.reminder = null;
    this.snoozeUntil = null;
    this.reset();
    this.restartOnRecovery = restartOnRecovery;
  }
  private present(effects: EngineEffect[]): void {
    if (this.suppressed() || this.reminder) return;
    const displays = this.sample?.displays ?? [];
    const scope = this.settings.reminder.screenScope;
    let ids = displays.filter(d => scope === 'all' || (scope === 'primary' ? d.primary : this.settings.reminder.screenIds.includes(d.id))).map(d => d.id);
    if (!ids.length && displays.length) { ids = [(displays.find(d => d.primary) ?? displays[0]).id]; this.warn('所选屏幕不可用，暂时使用主屏幕'); }
    this.reminder = { id: randomUUID(), generation: ++this.generation, kind: 'real', settings: structuredClone(this.settings), screenIds: ids, createdAtMs: this.now };
    this.reminderChannels = [];
    this.snoozeUntil = null;
    effects.push({ type: 'present', reminder: structuredClone(this.reminder) });
  }
  private warn(message: string): boolean {
    if (this.warnings.includes(message)) return false;
    this.warnings = [...this.warnings.slice(-7), message];
    return true;
  }
  private reportFailures(channels: ChannelResult[]): void {
    for (const channel of channels) if (!channel.success) this.warn(`${channel.channel === 'visual' ? '视觉' : '声音'}提醒失败：${channel.message || '通道不可用'}`);
  }
  acceptSample(input: PlatformSample): EngineUpdate {
    if (!Number.isSafeInteger(input.sequence) || (this.sample && input.sequence <= this.sample.sequence) || !Number.isFinite(input.nowMs)) return this.update();
    // Reject wall-clock reversal rather than moving deadlines or replaying an interval.
    if (input.nowMs < this.now) { if (this.warn('检测到时钟回退，已忽略异常采样')) this.sequence++; return this.update(); }
    const previous = this.sample;
    const from = this.now;
    const delta = input.nowMs - from;
    const previouslySuppressed = this.suppressed();
    const previousPause = this.pauseUntil;
    const wasOccupied = this.reminder !== null || this.snoozeUntil !== null;
    this.now = input.nowMs;
    this.sample = structuredClone(input);
    this.sequence++;
    const effects: EngineEffect[] = [];
    if (!previous) this.deadline = this.now + this.interval();
    if (!input.clockTrusted) {
      this.elapsed = 0;
      this.warn('连续时钟异常，无法确认离开时长；累计已保守清零');
    }
    if (typeof this.pauseUntil === 'number' && this.now >= this.pauseUntil) {
      this.pauseUntil = undefined;
      if (this.cycleSettings.timer.mode === 'fixed') this.deadline = this.now + this.interval();
    }
    const absent = input.sleeping || input.lockState !== 'unlocked' || !!this.fault();
    if (absent && this.absenceSince === null) this.absenceSince = this.now;
    if (this.absenceSince !== null && this.now - this.absenceSince >= this.cycleSettings.timer.longIdleMinutes * 60_000) this.elapsed = 0;
    if (!absent) this.absenceSince = null;
    if (this.longIdle()) this.elapsed = 0;
    const blocked = this.suppressed();
    if (blocked) this.cancel(effects);
    if (!blocked && this.restartOnRecovery) { this.reset(); this.restartOnRecovery = false; }
    if (delta > 5000 && previous) this.warn('系统采样延迟超过 5 秒，未知时段未计入活动');
    const pauseExpired = typeof previousPause === 'number' && previousPause <= this.now;
    const canIntegrate = previous && !this.activitySourceChanged && !blocked && !wasOccupied && !this.reminder && this.snoozeUntil === null && delta <= 5000 && (!previouslySuppressed || (pauseExpired && !previous.sleeping && previous.lockState === 'unlocked' && !this.fault(previous) && !this.longIdle(previous)));
    this.activitySourceChanged = false;
    if (canIntegrate && this.cycleSettings.timer.mode === 'active' && validIdle(previous.selectedSourceIdleMs) && validIdle(input.selectedSourceIdleMs)) {
      const start = pauseExpired ? Math.max(from, previousPause as number) : from;
      const window = this.cycleSettings.timer.activeWindowSeconds * 1000;
      // Integrate the union of both observed activity windows against this sampling interval.
      const oldInput = from - previous.selectedSourceIdleMs;
      const newInput = this.now - input.selectedSourceIdleMs;
      const oldEnd = Math.min(this.now, oldInput + window);
      const oldCredit = Math.max(0, oldEnd - start);
      const newStart = Math.max(start, newInput, oldEnd);
      const newCredit = Math.max(0, Math.min(this.now, newInput + window) - newStart);
      this.elapsed = Math.min(this.interval(), this.elapsed + oldCredit + newCredit);
    }
    if (!blocked && !this.reminder && this.snoozeUntil !== null && this.now >= this.snoozeUntil) this.present(effects);
    if (this.cycleSettings.timer.mode === 'fixed' && this.now >= this.deadline) {
      // A delayed observation skips every missed beat and establishes the next future beat.
      const due = this.deadline;
      this.deadline += (Math.floor((this.now - this.deadline) / this.interval()) + 1) * this.interval();
      if (!blocked && !previouslySuppressed && !this.reminder && this.snoozeUntil === null && delta <= 5000 && this.now - due < this.interval()) this.present(effects);
    } else if (this.cycleSettings.timer.mode === 'active' && this.elapsed >= this.interval() && !blocked && !this.reminder && this.snoozeUntil === null) this.present(effects);
    return this.update(effects);
  }
  pause(minutes: 15 | 30 | 60 | null, nowMs?: number): EngineUpdate {
    this.time(nowMs);
    const effects: EngineEffect[] = [];
    this.pauseUntil = minutes === null ? null : this.now + minutes * 60_000;
    this.cancel(effects);
    this.sequence++;
    return this.update(effects);
  }
  resume(nowMs?: number): EngineUpdate {
    this.time(nowMs);
    if (this.pauseUntil === undefined) return this.update();
    this.pauseUntil = undefined;
    if (this.cycleSettings.timer.mode === 'fixed') this.deadline = this.now + this.interval();
    this.sequence++;
    return this.update();
  }
  remindNow(nowMs?: number): EngineUpdate {
    this.time(nowMs);
    if (this.suppressed() || this.reminder || this.snoozeUntil !== null) return this.update();
    const effects: EngineEffect[] = [];
    this.present(effects);
    this.sequence++;
    return this.update(effects);
  }
  resolveReminder(id: string, generation: number, action: ReminderAction, nowMs?: number): EngineUpdate {
    if (!this.reminder || this.reminder.id !== id || this.reminder.generation !== generation || this.reminder.settings.reminder.visual !== 'mask') return this.update();
    this.time(nowMs);
    const event = this.reminder;
    this.reminder = null;
    const effects: EngineEffect[] = [{ type: 'cancel', id, generation }];
    if (action === 'snooze') {
      this.snoozeUntil = this.now + event.settings.reminder.snoozeMinutes * 60_000;
      if (this.pendingTimerReset) { this.reset(); }
    } else {
      this.lastResult = { id, outcome: action, channels: structuredClone(this.reminderChannels) };
      this.reset();
      if (action === 'acknowledge') { this.restCount++; effects.push({ type: 'rest_confirmed', id }); }
    }
    this.sequence++;
    return this.update(effects);
  }
  /** Retain mask delivery diagnostics without ending its interactive lifecycle. */
  recordReminderChannels(id: string, generation: number, channels: ChannelResult[]): EngineUpdate {
    if (!this.reminder || this.reminder.id !== id || this.reminder.generation !== generation) return this.update();
    let changed = false;
    for (const channel of channels) {
      if (!this.reminderChannels.some(existing => existing.channel === channel.channel)) {
        this.reminderChannels.push(structuredClone(channel));
        this.reportFailures([channel]);
        changed = true;
      }
    }
    if (changed) this.sequence++;
    return this.update();
  }
  settleReminder(id: string, generation: number, channels: ChannelResult[], nowMs?: number): EngineUpdate {
    if (!this.reminder || this.reminder.id !== id || this.reminder.generation !== generation) return this.update();
    this.time(nowMs);
    const failed = !channels.some(c => c.success);
    this.lastResult = { id, outcome: failed ? 'failed' : 'automatic', channels: structuredClone(channels) };
    this.reportFailures(channels);
    if (failed) this.warn('所有提醒通道均失败，本轮已结束，请检查提醒方式');
    this.reminder = null;
    this.reset();
    this.sequence++;
    return this.update([{ type: 'cancel', id, generation }]);
  }
  updateSettings(settings: SettingsV1, revision: number, nowMs?: number): EngineUpdate {
    this.time(nowMs);
    const timerChanged = (Object.keys(settings.timer) as (keyof SettingsV1['timer'])[]).some(key => settings.timer[key] !== this.settings.timer[key]);
    this.settings = structuredClone(settings);
    this.revision = revision;
    const effects: EngineEffect[] = [];
    if (timerChanged && this.reminder) this.pendingTimerReset = true;
    else if (timerChanged) { this.cancel(effects, false); this.reset(); }
    else if (!this.reminder) this.cycleSettings = structuredClone(this.settings);
    if (this.longIdle()) this.elapsed = 0;
    this.sequence++;
    return this.update(effects);
  }
}
