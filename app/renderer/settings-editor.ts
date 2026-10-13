import type { AppError, Result, RuntimeSnapshot, SettingsV1 } from '../shared/contracts';
import { validateSettings } from '../main/settings/validation';

type Group = 'timer' | 'reminder' | 'appearance' | 'general';
type Intent = { value: unknown; version: number; auto: boolean; ready: boolean; error?: string };
export type EditorState = { draft: SettingsV1 | null; manualDirty: boolean; pending: boolean; fields: Record<string, string>; failure: AppError | null; failureIsManual: boolean; unsaved: boolean; saved: boolean };
const equal = (left: unknown, right: unknown) => Object.is(left, right) || (Array.isArray(left) && Array.isArray(right) && JSON.stringify(left) === JSON.stringify(right));
function put(settings: SettingsV1, field: string, value: unknown) {
  const [group, key] = field.split('.') as [Group, string];
  (settings[group] as unknown as Record<string, unknown>)[key] = structuredClone(value);
}
const coupled: Record<string, string[]> = {
  INVALID_IDLE_WINDOW: ['timer.activeWindowSeconds', 'timer.longIdleMinutes'],
  NO_REMINDER_CHANNEL: ['reminder.visual', 'reminder.soundEnabled', 'reminder.volumePercent'],
  INVALID_SCREEN_SELECTION: ['reminder.screenScope', 'reminder.screenIds'],
};

/** One queue per renderer: save field intents against the latest effective revision,
 * never an old whole-form draft. Failed and intermediate input stays separate. */
export class SettingsEditor {
  private snapshot: RuntimeSnapshot | null = null;
  private intents = new Map<string, Intent>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private version = 0;
  private saving = false;
  private failure: AppError | null = null;
  private saved = false;
  private manualRequested = false;
  private retryManual = false;
  private listeners = new Set<() => void>();
  constructor(private persist: (revision: number, settings: SettingsV1) => Promise<Result<RuntimeSnapshot>>, private receive: (snapshot: RuntimeSnapshot) => void, private delay = 300) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { for (const listener of this.listeners) listener(); }
  state(): EditorState {
    const draft = this.snapshot ? structuredClone(this.snapshot.settings) : null;
    const fields: Record<string, string> = {};
    for (const [field, intent] of this.intents) { if (draft) put(draft, field, intent.value); if (intent.error) fields[field] = intent.error; }
    return { draft, manualDirty: [...this.intents.values()].some(intent => !intent.auto), pending: this.saving || (!this.failure && [...this.intents.values()].some(intent => intent.auto && !intent.error)), fields, failure: this.failure, failureIsManual: this.retryManual, unsaved: this.intents.size > 0, saved: this.saved };
  }
  accept(snapshot: RuntimeSnapshot) {
    if (this.snapshot && (snapshot.settingsRevision < this.snapshot.settingsRevision || (snapshot.settingsRevision === this.snapshot.settingsRevision && snapshot.sequence < this.snapshot.sequence))) return false;
    this.snapshot = snapshot; this.emit(); return true;
  }
  edit(next: SettingsV1, auto: boolean, immediate = false) {
    const previous = this.state().draft;
    if (!previous || !this.snapshot) return;
    for (const group of ['timer', 'reminder', 'appearance', 'general'] as Group[]) {
      for (const key of Object.keys(next[group])) {
        const field = `${group}.${key}`;
        const value = (next[group] as unknown as Record<string, unknown>)[key];
        if (equal(value, (previous[group] as unknown as Record<string, unknown>)[key])) continue;
        clearTimeout(this.timers.get(field)); this.timers.delete(field);
        // An in-flight old value may still land, so retain an explicit newer intent.
        if (!this.saving && equal(value, (this.snapshot.settings[group] as unknown as Record<string, unknown>)[key])) { this.intents.delete(field); continue; }
        const debounced = auto && !immediate && (typeof value === 'number' || (group === 'reminder' && key === 'message'));
        const intent: Intent = { value, version: ++this.version, auto, ready: !debounced };
        this.intents.set(field, intent);
        if (debounced) this.timers.set(field, setTimeout(() => { intent.ready = true; this.timers.delete(field); this.emit(); void this.pump(); }, this.delay));
      }
    }
    this.saved = false;
    // Persistence/conflict errors need explicit retry. Validation can recover on edits.
    this.emit(); void this.pump();
  }
  flush() { for (const [field, timer] of this.timers) { clearTimeout(timer); const intent = this.intents.get(field); if (intent) intent.ready = true; } this.timers.clear(); this.emit(); void this.pump(); }
  retry() { this.failure = null; this.manualRequested = this.retryManual; this.flush(); }
  saveManual() { this.manualRequested = true; this.failure = null; this.flush(); }
  discard() { for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); this.intents.clear(); this.failure = null; this.manualRequested = false; this.retryManual = false; this.emit(); }
  dispose() { for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); this.listeners.clear(); }
  private async pump() {
    if (this.saving || this.failure || !this.snapshot) return;
    const selected = new Map([...this.intents].filter(([, intent]) => intent.ready && (intent.auto || this.manualRequested)));
    if (!selected.size) return;
    let candidate: SettingsV1;
    while (selected.size) {
      candidate = structuredClone(this.snapshot.settings);
      for (const [field, intent] of selected) { put(candidate, field, intent.value); intent.error = undefined; }
      const validation = validateSettings(candidate, this.snapshot.capabilities, this.snapshot.displays, this.snapshot.settings);
      if (validation.ok) break;
      const fields = validation.error.fields ?? {};
      const related = coupled[validation.error.code] ?? Object.keys(fields);
      let removed = false;
      for (const [field, intent] of selected) if (related.includes(field)) { intent.error = fields[field] ?? Object.values(fields)[0] ?? validation.error.message; selected.delete(field); removed = true; }
      if (!removed) { for (const intent of selected.values()) intent.error = validation.error.message; selected.clear(); }
    }
    if (!selected.size) { this.manualRequested = false; this.emit(); return; }
    candidate = structuredClone(this.snapshot.settings);
    for (const [field, intent] of selected) put(candidate, field, intent.value);
    // Reapplying an unchanged choice must not reset a cycle or increment revision.
    for (const [field, intent] of selected) {
      const [group, key] = field.split('.') as [Group, string];
      if (equal(intent.value, (this.snapshot.settings[group] as unknown as Record<string, unknown>)[key])) { this.intents.delete(field); selected.delete(field); }
    }
    if (!selected.size) { this.manualRequested = false; this.saved = this.intents.size === 0; this.emit(); return; }
    this.saving = true; this.emit();
    try {
      const result = await this.persist(this.snapshot.settingsRevision, candidate);
      if (!result.ok) {
        this.retryManual = [...selected.values()].some(intent => !intent.auto);
        this.failure = result.error;
        for (const [field, message] of Object.entries(result.error.fields ?? {})) { const intent = this.intents.get(field); if (intent) intent.error = message; }
      } else {
        this.retryManual = false;
        if (this.accept(result.value)) this.receive(result.value);
        for (const [field, sent] of selected) if (this.intents.get(field)?.version === sent.version) this.intents.delete(field);
        this.saved = true;
      }
    } catch { this.retryManual = [...selected.values()].some(intent => !intent.auto); this.failure = { code: 'connection', message: '设置未保存，当前有效配置不变。输入已保留，请重试。' }; }
    finally { this.saving = false; this.manualRequested = false; this.emit(); }
    if (!this.failure && [...this.intents.values()].some(intent => intent.auto && intent.ready && !intent.error)) void this.pump();
  }
}
