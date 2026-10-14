import { useCallback, useEffect, useState } from 'react';
import { Eye, LayoutDashboard, Timer, Sparkles, Settings2, Pause, Play, Bell, Power, Check, RotateCcw } from 'lucide-react';
import { defaultSettings, formatTime, statusLabels, type AppError, type Result, type RuntimeSnapshot, type SettingsV2 } from '../shared/contracts';
import { applyAppearance, Icon, Modal, Notice } from './components';
import { TriggerSettings, ReminderSettings, GeneralSettings } from './Settings';
import { SettingsEditor } from './settings-editor';

type Page = 'overview' | 'trigger' | 'reminder' | 'general';
const pages = [{ id: 'overview', label: '概览', icon: LayoutDashboard }, { id: 'trigger', label: '触发条件', icon: Timer }, { id: 'reminder', label: '提醒方式', icon: Sparkles }, { id: 'general', label: '通用设置', icon: Settings2 }] as const;

export function App({ tray = false }: { tray?: boolean }) {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [editor] = useState(() => new SettingsEditor((revision, settings) => window.eyeCare.saveSettings(revision, settings), value => { setSnapshot(previous => !previous || value.settingsRevision > previous.settingsRevision || (value.settingsRevision === previous.settingsRevision && value.sequence >= previous.sequence) ? value : previous); applyAppearance(value); }));
  const [editing, setEditing] = useState(() => editor.state());
  const draft = editing.draft;
  const setDraft = (action: React.SetStateAction<SettingsV2 | null>) => {
    const previous = editor.state().draft;
    const next = typeof action === 'function' ? action(previous) : action;
    if (next) editor.edit(next);
  };
  useEffect(() => editor.subscribe(() => setEditing(editor.state())), [editor]);
  useEffect(() => () => editor.dispose(), [editor]);
  const [page, setPage] = useState<Page>('overview');
  const [error, setError] = useState<AppError | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const previewActive = snapshot?.currentPreviewId !== null && snapshot?.currentPreviewId !== undefined;

  useEffect(() => {
    if (tray || !window.eyeCare) return;
    return window.eyeCare.subscribeOpenSettings(() => setPage('general'));
  }, [tray]);

  useEffect(() => {
    if (!window.eyeCare) { setConnectionError('无法连接桌面服务。请从已安装的 EyeCare 应用打开此窗口。'); return; }
    let alive = true;
    const receive = (value: RuntimeSnapshot) => { if (alive && editor.accept(value)) { setSnapshot(previous => !previous || value.settingsRevision > previous.settingsRevision || (value.settingsRevision === previous.settingsRevision && value.sequence >= previous.sequence) ? value : previous); applyAppearance(value); } };
    const off = window.eyeCare.subscribeSnapshot(receive);
    void window.eyeCare.getSnapshot().then(receive).catch(() => { if (alive) setConnectionError('桌面服务连接失败。请重新打开应用。'); });
    return () => { alive = false; off(); };
  }, [editor]);
  const navigate = (next: Page) => { editor.flush(); setPage(next); setFeedback(''); setError(null); };
  const closeRestore = useCallback(() => setRestoreOpen(false), []);
  const invoke = async <T,>(operation: () => Promise<Result<T>>, message = '') => {
    setBusy(true); setError(null); setFeedback('');
    try { const result = await operation(); if (!result.ok) { setError(result.error); return false; } setFeedback(message); return true; }
    catch { setError({ code: 'connection', message: '操作未完成，桌面服务没有响应。请重试，输入已保留。' }); return false; }
    finally { setBusy(false); }
  };
  const retryAuto = async () => { try { editor.accept(await window.eyeCare.getSnapshot()); editor.retry(); } catch { setError({ code: 'connection', message: '桌面服务没有响应，请重试。' }); } };
  if (!snapshot || !draft) return <div className="loading"><Icon icon={Eye} size={40}/><h1>EyeCare</h1><p role="status">{connectionError || '正在连接护眼服务…'}</p></div>;
  const command = (action: 'resume' | 'remind' | 'pause') => invoke(() => action === 'resume' ? window.eyeCare.resume() : action === 'remind' ? window.eyeCare.remindNow() : window.eyeCare.pause());
  const settingError = editing.failure;
  const resultErrors = snapshot.latestReminderResult?.channels.filter(channel => !channel.success) ?? [];
  if (tray) return <div className="tray-shell"><Brand/><RuntimeDisplay snapshot={snapshot} compact/><RuntimeActions snapshot={snapshot} busy={busy} command={command}/>{error && <Notice error>{error.message}</Notice>}<div className="tray-footer"><button onClick={() => void invoke(() => window.eyeCare.openSettings())}><Icon icon={Settings2}/>打开设置</button><button onClick={() => void invoke(() => window.eyeCare.quit())}><Icon icon={Power}/>退出</button></div></div>;
  return <div className="app-shell"><aside className="sidebar"><Brand/><nav aria-label="主导航">{pages.map(item => <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} aria-label={item.label} title={item.label} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon icon={item.icon}/><span>{item.label}</span>{page === item.id && <span className="nav-mark"/>}</button>)}</nav></aside>
    <main className="main-content"><header className="page-heading"><div><h1>{pages.find(item => item.id === page)?.label}</h1>{(page !== 'overview' || editing.pending || editing.failure || editing.unsaved) && <div className="autosave-status" role="status">{editing.pending ? '正在自动保存…' : editing.failure ? '自动保存未完成，输入已保留。' : editing.unsaved ? '标记项尚未生效，请修正输入；其他合法设置已自动保存。' : ''}</div>}</div><div className="status-pill"><span className="status-dot"/>{statusLabels[snapshot.status]}</div></header>
      {snapshot.warnings.filter(warning => warning !== '系统采样延迟超过 5 秒，未知时段未计入活动').map((warning, index) => <Notice key={index}>{warning}</Notice>)}
      {error && <Notice error>{error.message}</Notice>}
      {settingError && <Notice error><p>{settingError.message}</p><button disabled={editing.pending} onClick={() => void retryAuto()}>{settingError.code.includes('CONFLICT') ? '将我的修改应用到最新版本' : '重试自动保存'}</button></Notice>}
      {feedback && <div className="feedback" role="status"><Icon icon={Check} size={16}/>{feedback}</div>}
      {page === 'reminder' && (previewActive ? <div className="feedback" role="status">预览正在呈现</div> : snapshot.latestPreviewResult && <div className="feedback" role="status">{snapshot.latestPreviewResult.outcome === 'failed' ? '预览失败' : '预览已结束'}</div>)}{snapshot.latestPreviewResult && <>{snapshot.latestPreviewResult.channels.filter(channel => !channel.success).map(channel => <Notice error key={channel.channel}>{channel.channel === 'sound' ? '声音' : '视觉'}预览失败：{channel.message}</Notice>)}</>}
      {page === 'overview' ? <><RuntimeDisplay snapshot={snapshot}/><RuntimeActions snapshot={snapshot} busy={busy} command={command}/>{resultErrors.map(result => <Notice error key={result.channel}>{result.channel === 'sound' ? '声音' : '视觉'}提醒失败：{result.message}</Notice>)}</> : <div className="settings-content instant-settings" onBlurCapture={() => editor.flush()}>
        {page === 'trigger' && <TriggerSettings draft={draft} setDraft={setDraft} snapshot={snapshot} errors={{ ...error?.fields, ...editing.fields }}/>}
        {page === 'reminder' && <ReminderSettings draft={draft} setDraft={setDraft} snapshot={snapshot} errors={{ ...error?.fields, ...editing.fields }} onPreview={() => { void invoke(() => window.eyeCare.preview({ ...snapshot.settings, reminder: draft.reminder })); }} previewActive={previewActive} cancelPreview={() => { void invoke(() => window.eyeCare.cancelPreview()); }} busy={busy}/>}
        {page === 'general' && <GeneralSettings draft={draft} setDraft={setDraft} snapshot={snapshot} errors={{ ...error?.fields, ...editing.fields }} busy={busy || editing.pending} restore={() => setRestoreOpen(true)}/>}
      </div>}
    </main>
    {restoreOpen && <Modal title="恢复默认设置" onClose={closeRestore}><p>恢复全部默认设置，立即生效。</p><div className="modal-actions"><button onClick={closeRestore}>取消</button><button className="primary" disabled={editing.pending} onClick={() => { editor.edit(defaultSettings(), true); editor.retry(); setRestoreOpen(false); }}><Icon icon={RotateCcw}/>确认恢复</button></div></Modal>}
  </div>;
}

function Brand() { return <div className="brand"><span className="brand-icon"><Icon icon={Eye} size={24}/></span><div><strong>EyeCare</strong><span>让眼睛歇一会儿</span></div></div>; }
function RuntimeDisplay({ snapshot, compact = false }: { snapshot: RuntimeSnapshot; compact?: boolean }) {
  const remaining = ['counting', 'short_idle', 'long_idle'].includes(snapshot.status) ? snapshot.remainingMs : null;
  const label = snapshot.status === 'paused' ? '护眼提醒' : '距离下一次提醒';
  return <section className={`countdown-card ${compact ? 'compact' : ''}`}><div className="countdown-primary"><span className="countdown-label">{label}</span><div className="countdown" aria-label={`${label} ${remaining === null ? statusLabels[snapshot.status] : formatTime(remaining)}`}>{remaining === null ? <span className="countdown-state">{statusLabels[snapshot.status]}</span> : formatTime(remaining)}</div></div></section>;
}
function RuntimeActions({ snapshot, busy, command }: { snapshot: RuntimeSnapshot; busy: boolean; command: (action: 'resume' | 'remind' | 'pause') => Promise<boolean> }) {
  const paused = snapshot.status === 'paused';
  const suppressed = !['counting', 'short_idle'].includes(snapshot.status);
  return <div className="runtime-actions"><div className="pause-group">{paused ? <button className="primary" disabled={busy} onClick={() => void command('resume')}><Icon icon={Play}/>恢复提醒</button> : <button disabled={busy} onClick={() => void command('pause')}><Icon icon={Pause}/>暂停</button>}</div><button disabled={busy || suppressed} onClick={() => void command('remind')}><Icon icon={Bell}/>立即提醒</button>{suppressed && snapshot.status !== 'paused' && <p className="hint action-reason">{snapshot.statusReason || `${statusLabels[snapshot.status]}时暂不触发新的提醒。`}</p>}</div>;
}
