import { useCallback, useEffect, useState } from 'react';
import { Eye, LayoutDashboard, Timer, Sparkles, Settings2, Pause, Play, Bell, ShieldCheck, ArrowRight, Power, Check, RotateCcw } from 'lucide-react';
import { defaultSettings, formatTime, statusLabels, type AppError, type Result, type RuntimeSnapshot, type SettingsV1 } from '../shared/contracts';
import { applyAppearance, Icon, Modal, Notice, Section } from './components';
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
  const setDraft = (action: React.SetStateAction<SettingsV1 | null>, auto = false) => {
    const previous = editor.state().draft;
    const next = typeof action === 'function' ? action(previous) : action;
    if (next) editor.edit(next, auto);
  };
  const setAutoDraft = (action: React.SetStateAction<SettingsV1 | null>) => setDraft(action, true);
  useEffect(() => editor.subscribe(() => setEditing(editor.state())), [editor]);
  useEffect(() => () => editor.dispose(), [editor]);
  const [page, setPage] = useState<Page>('overview');
  const [pendingPage, setPendingPage] = useState<Page | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [soundOnlyPreview, setSoundOnlyPreview] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const dirty = editing.manualDirty;
  const previewActive = snapshot?.currentPreviewId !== null && snapshot?.currentPreviewId !== undefined;

  useEffect(() => {
    if (tray || !window.eyeCare) return;
    return window.eyeCare.subscribeOpenSettings(() => { if (page === 'general') return; if (dirty) setPendingPage('general'); else setPage('general'); });
  }, [dirty, page, tray]);

  useEffect(() => {
    if (!window.eyeCare) { setConnectionError('无法连接桌面服务。请从已安装的 EyeCare 应用打开此窗口。'); return; }
    let alive = true;
    const receive = (value: RuntimeSnapshot) => { if (alive && editor.accept(value)) { setSnapshot(previous => !previous || value.settingsRevision > previous.settingsRevision || (value.settingsRevision === previous.settingsRevision && value.sequence >= previous.sequence) ? value : previous); applyAppearance(value); } };
    const off = window.eyeCare.subscribeSnapshot(receive);
    void window.eyeCare.getSnapshot().then(receive).catch(() => { if (alive) setConnectionError('桌面服务连接失败。请重新打开应用。'); });
    return () => { alive = false; off(); };
  }, [editor]);
  const navigate = (next: Page) => { if (next === page) return; if (dirty) setPendingPage(next); else { setPage(next); setFeedback(''); setError(null); } };
  const closeNavigation = useCallback(() => setPendingPage(null), []);
  const closePreview = useCallback(() => setPreviewOpen(false), []);
  const closeRestore = useCallback(() => setRestoreOpen(false), []);
  const invoke = async <T,>(operation: () => Promise<Result<T>>, message = '') => {
    setBusy(true); setError(null); setFeedback('');
    try { const result = await operation(); if (!result.ok) { setError(result.error); return false; } setFeedback(message); return true; }
    catch { setError({ code: 'connection', message: '操作未完成，桌面服务没有响应。请重试，输入已保留。' }); return false; }
    finally { setBusy(false); }
  };
  const save = async (reapply = false) => {
    if (reapply) { try { editor.accept(await window.eyeCare.getSnapshot()); } catch { return; } }
    editor.saveManual();
  };
  const retryAuto = async () => { try { editor.accept(await window.eyeCare.getSnapshot()); editor.retry(); } catch { setError({ code: 'connection', message: '桌面服务没有响应，请重试。' }); } };
  const immediate = async (key: 'theme' | 'showTrayCountdown', value: SettingsV1['appearance']['theme'] | boolean) => {
    const next = editor.state().draft;
    if (!next) return;
    if (key === 'theme' && typeof value === 'string') next.appearance.theme = value;
    if (key === 'showTrayCountdown' && typeof value === 'boolean') next.appearance.showTrayCountdown = value;
    editor.edit(next, true, true);
  };
  if (!snapshot || !draft) return <div className="loading"><Icon icon={Eye} size={40}/><h1>EyeCare</h1><p role="status">{connectionError || '正在连接护眼服务…'}</p></div>;
  const command = (action: 'resume' | 'remind' | 'pause', duration: 15 | 30 | 60 | null = null) => invoke(() => action === 'resume' ? window.eyeCare.resume() : action === 'remind' ? window.eyeCare.remindNow() : window.eyeCare.pause(duration));
  const settingError = editing.failure;
  const conflict = error?.currentRevision !== undefined || error?.code.toLowerCase().includes('conflict');
  const resultErrors = snapshot.latestReminderResult?.channels.filter(channel => !channel.success) ?? [];
  if (tray) return <div className="tray-shell"><Brand/><RuntimeDisplay snapshot={snapshot} compact/><RuntimeActions snapshot={snapshot} busy={busy} command={command}/>{error && <Notice error>{error.message}</Notice>}<div className="tray-footer"><button onClick={() => void invoke(() => window.eyeCare.openSettings())}><Icon icon={Settings2}/>打开设置</button><button onClick={() => void invoke(() => window.eyeCare.quit())}><Icon icon={Power}/>退出</button></div></div>;
  return <div className="app-shell"><aside className="sidebar"><Brand/><nav aria-label="主导航">{pages.map(item => <button key={item.id} className={page === item.id ? 'nav-item active' : 'nav-item'} aria-label={item.label} title={item.label} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon icon={item.icon}/><span>{item.label}</span>{page === item.id && <span className="nav-mark"/>}</button>)}</nav><div className="sidebar-note"><Icon icon={ShieldCheck}/><p>只检测空闲状态<br/><span>不记录输入内容</span></p></div></aside>
    <main className="main-content"><header className="page-heading"><div><span className="eyebrow">给专注留一点空隙</span><h1>{pages.find(item => item.id === page)?.label}</h1></div><div className="status-pill"><span className="status-dot"/>{statusLabels[snapshot.status]}</div></header>
      {snapshot.warnings.map((warning, index) => <Notice key={index}>{warning}</Notice>)}
      {error && <Notice error><p>{error.message}</p>{conflict && <><p className="hint">当前生效：{snapshot.settings.timer.mode === 'active' ? '累计活跃' : '固定周期'} {snapshot.settings.timer.intervalMinutes} 分钟；{visualLabel(snapshot.settings)}；主题{themeLabel(snapshot.settings.appearance.theme)}。你的修改仍保留。</p><button disabled={busy} onClick={() => void save(true)}>将我的修改应用到最新版本</button></>}</Notice>}
      {settingError && <Notice error><p>{settingError.message}</p><p className="hint">你的输入已保留，当前仍使用上次生效的设置。</p><button disabled={editing.pending} onClick={() => void retryAuto()}>{settingError.code.includes('CONFLICT') ? '将我的修改应用到最新版本' : editing.failureIsManual ? '重试保存' : '重试自动保存'}</button></Notice>}
      {(page === 'trigger' || page === 'reminder') && <div className="autosave-status" role="status">{editing.pending ? '正在自动保存…' : editing.failure ? '自动保存未完成，输入已保留。' : editing.unsaved ? '标记项尚未生效，请修正输入；其他合法设置已自动保存。' : editing.saved ? '已自动保存并生效' : '修改后自动保存并生效'}</div>}
      {feedback && <div className="feedback" role="status"><Icon icon={Check} size={16}/>{feedback}</div>}
      {previewActive ? <div className="feedback" role="status">预览正在呈现</div> : snapshot.latestPreviewResult && <><div className="feedback" role="status">{snapshot.latestPreviewResult.outcome === 'failed' ? '预览失败' : snapshot.latestPreviewResult.outcome === 'cancelled' ? '预览已取消' : snapshot.latestPreviewResult.outcome === 'automatic' ? '预览已结束' : '预览已关闭，不影响实际计时'}</div>{snapshot.latestPreviewResult.channels.filter(channel => !channel.success).map(channel => <Notice error key={channel.channel}>{channel.channel === 'sound' ? '声音' : '视觉'}预览失败：{channel.message}</Notice>)}</>}
      {page === 'overview' ? <><RuntimeDisplay snapshot={snapshot}/><RuntimeActions snapshot={snapshot} busy={busy} command={command}/><Section title="当前提醒规则"><div className="rule-grid"><div><span className="rule-label">触发节奏</span><strong>{snapshot.settings.timer.mode === 'active' ? '累计活跃' : '固定周期'} {snapshot.settings.timer.intervalMinutes} 分钟</strong><p>{snapshot.settings.timer.mode === 'active' ? `最近 ${snapshot.settings.timer.activeWindowSeconds} 秒内有${snapshot.settings.timer.activitySource === 'mouse' ? '鼠标' : '鼠标或键盘'}输入时累计；短空闲暂停。` : '按经过时间检查未来节拍，短空闲期间仍可提醒。'}</p></div><div><span className="rule-label">提醒方式</span><strong>{visualLabel(snapshot.settings)}</strong><p>长空闲达到 {snapshot.settings.timer.longIdleMinutes} 分钟清零；锁屏、睡眠和检测异常时停止提醒。</p></div></div><button className="text-button" onClick={() => navigate('trigger')}>调整提醒规则<Icon icon={ArrowRight} size={16}/></button></Section>{resultErrors.map(result => <Notice error key={result.channel}>{result.channel === 'sound' ? '声音' : '视觉'}提醒失败：{result.message}</Notice>)}<p className="quiet-note">关闭窗口后继续在托盘运行。点击托盘可随时返回；“退出”才停止服务。</p></> : <div className={page === 'general' ? 'settings-content' : 'settings-content instant-settings'} onBlurCapture={() => editor.flush()}>
        {page === 'trigger' && <TriggerSettings draft={draft} setDraft={setAutoDraft} snapshot={snapshot} errors={{ ...error?.fields, ...editing.fields }}/>}
        {page === 'reminder' && <ReminderSettings draft={draft} setDraft={setAutoDraft} snapshot={snapshot} errors={{ ...error?.fields, ...editing.fields }} onPreview={soundOnly => { setError(null); setSoundOnlyPreview(!!soundOnly); setPreviewOpen(true); }} previewActive={previewActive} cancelPreview={() => { void invoke(() => window.eyeCare.cancelPreview()); }} busy={busy}/>}
        {page === 'general' && <GeneralSettings draft={draft} setDraft={setDraft} snapshot={snapshot} errors={{ ...error?.fields, ...editing.fields }} immediate={immediate} busy={busy || editing.pending} restore={() => setRestoreOpen(true)}/>}
        {page === 'general' && <footer className="save-bar"><span>{dirty ? '有尚未保存的修改' : '设置已与当前配置同步'}</span><div><button disabled={!dirty || busy || editing.pending} onClick={() => { editor.discard(); setError(null); }}>放弃修改</button><button className="primary" disabled={!dirty || busy || editing.pending} onClick={() => void save()}>{busy || editing.pending ? '正在保存…' : '保存设置'}</button></div></footer>}
      </div>}
    </main>
    {pendingPage && <Modal title="保留尚未保存的修改？" onClose={closeNavigation}><p>这些修改还没有生效。你可以保留输入并继续浏览，或放弃修改。</p><div className="modal-actions"><button onClick={closeNavigation}>继续编辑</button><button onClick={() => { editor.discard(); setPage(pendingPage); setPendingPage(null); setError(null); }}>放弃并离开</button><button className="primary" onClick={() => { setPage(pendingPage); setPendingPage(null); }}>保留修改并离开</button></div></Modal>}
    {previewOpen && <Modal title={soundOnlyPreview ? '预听当前音效' : '预览当前提醒效果'} onClose={closePreview}><p>将按当前输入{soundOnlyPreview || draft.reminder.visual === 'none' ? '播放声音' : '显示提醒'}。预览不会改变计时或记为完成休息。</p>{!soundOnlyPreview && (draft.reminder.visual === 'flash' || draft.reminder.visual === 'mask') ? <Notice>所选屏幕会被短暂覆盖。蒙版可按 Escape 关闭。</Notice> : null}{draft.reminder.soundEnabled && <Notice>会播放一次声音，音量 {draft.reminder.volumePercent}%。请先确认输出设备和音量。</Notice>}{error && <Notice error>{error.message}{error.fields && Object.entries(error.fields).map(([field, message]) => <p key={field}>{message}</p>)}</Notice>}<div className="modal-actions"><button onClick={closePreview}>取消</button><button className="primary" disabled={busy} onClick={() => { const settings = { ...snapshot.settings, reminder: soundOnlyPreview ? { ...draft.reminder, visual: 'none' as const, soundEnabled: true } : draft.reminder }; void invoke(() => window.eyeCare.preview(settings)).then(success => { if (success) setPreviewOpen(false); }); }}>开始预览</button></div></Modal>}
    {restoreOpen && <Modal title="恢复默认设置" onClose={closeRestore}><p>恢复累计活跃 30 分钟、柔和闪屏、关闭声音及跟随系统等默认配置。点击“保存设置”后生效。</p><div className="modal-actions"><button onClick={closeRestore}>取消</button><button className="primary" onClick={() => { setDraft(defaultSettings()); setRestoreOpen(false); setFeedback('默认配置已填入，请保存后生效'); }}><Icon icon={RotateCcw}/>填入默认设置</button></div></Modal>}
  </div>;
}

function Brand() { return <div className="brand"><span className="brand-icon"><Icon icon={Eye} size={24}/></span><div><strong>EyeCare</strong><span>让眼睛歇一会儿</span></div></div>; }
function visualLabel(settings: SettingsV1) { const label = { flash: '柔和闪屏', mask: '确认蒙版', notification: '系统通知', none: '仅声音' }[settings.reminder.visual]; return label + (settings.reminder.soundEnabled && settings.reminder.visual !== 'none' ? ' + 声音' : ''); }
function themeLabel(theme: SettingsV1['appearance']['theme']) { return { system: '跟随系统', light: '亮色', dark: '暗色' }[theme]; }
function RuntimeDisplay({ snapshot, compact = false }: { snapshot: RuntimeSnapshot; compact?: boolean }) {
  const remaining = snapshot.status === 'snoozed' ? snapshot.snoozeRemainingMs : snapshot.status === 'paused' ? snapshot.pauseRemainingMs : ['counting', 'short_idle', 'long_idle'].includes(snapshot.status) ? snapshot.remainingMs : null;
  const label = snapshot.status === 'snoozed' ? '距离稍后提醒' : snapshot.status === 'paused' ? snapshot.pauseRemainingMs === null ? '直到手动恢复' : '距离自动恢复' : '距离下一次提醒';
  return <section className={`countdown-card ${compact ? 'compact' : ''}`}><span className="countdown-label">{label}</span><div className="countdown" aria-label={`${label} ${formatTime(remaining)}`}>{remaining === null ? <span className="countdown-state">{statusLabels[snapshot.status]}</span> : formatTime(remaining)}</div><div className="timer-state" role="status"><Icon icon={snapshot.status === 'counting' ? Timer : Pause} size={16}/>{statusLabels[snapshot.status]}</div><p>{snapshot.statusReason || (snapshot.settings.timer.mode === 'active' ? '剩余时间随活跃使用递减，并非固定的钟点。' : '到期按固定节拍提醒；被抑制的周期直接跳过。')}</p>{!compact && <div className="countdown-foot"><span>温和提醒，留在专注里</span><span>{snapshot.settings.timer.mode === 'active' ? '活跃时间' : '固定周期'}</span></div>}</section>;
}
function RuntimeActions({ snapshot, busy, command }: { snapshot: RuntimeSnapshot; busy: boolean; command: (action: 'resume' | 'remind' | 'pause', duration?: 15 | 30 | 60 | null) => Promise<boolean> }) {
  const [duration, setDuration] = useState('15');
  const paused = snapshot.status === 'paused';
  const suppressed = !['counting', 'short_idle'].includes(snapshot.status);
  return <div className="runtime-actions"><div className="pause-group">{paused ? <button className="primary" disabled={busy} onClick={() => void command('resume')}><Icon icon={Play}/>恢复提醒</button> : <><button disabled={busy} onClick={() => void command('pause', duration === 'forever' ? null : Number(duration) as 15 | 30 | 60)}><Icon icon={Pause}/>暂停</button><label className="sr-only" htmlFor="pause-duration">暂停时长</label><select id="pause-duration" aria-label="暂停时长" value={duration} disabled={busy} onChange={event => setDuration(event.target.value)}><option value="15">15 分钟</option><option value="30">30 分钟</option><option value="60">60 分钟</option><option value="forever">直到手动恢复</option></select></>}</div><button disabled={busy || suppressed} onClick={() => void command('remind')}><Icon icon={Bell}/>立即提醒</button>{suppressed && <p className="hint action-reason">{snapshot.statusReason || `${statusLabels[snapshot.status]}时暂不触发新的提醒。`}</p>}</div>;
}
