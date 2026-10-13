import { useEffect, useRef, type ReactNode } from 'react';
import { AlertCircle, X, type LucideIcon } from 'lucide-react';
import type { RuntimeSnapshot } from '../shared/contracts';

export function Icon({ icon: Svg, size = 20 }: { icon: LucideIcon; size?: number }) { return <Svg size={size} aria-hidden="true" strokeWidth={2}/>; }
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) { return <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : undefined}><Icon icon={AlertCircle}/><div>{children}</div></div>; }
export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) { return <section className="section"><div className="section-heading"><div><h2>{title}</h2></div>{actions}</div>{children}</section>; }
export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) { return <div className="field"><label className="field-label">{label}{children}</label>{error && <p className="field-error" role="alert">{error}</p>}</div>; }
export function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) { return <label className={`toggle-row ${disabled ? 'disabled' : ''}`}><span><span className="toggle-label">{label}</span>{hint && <span className="hint">{hint}</span>}</span><input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}/></label>; }
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>('button, input, select')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const elements = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])];
      const first = elements[0]; const last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop"><div className="modal-panel" ref={panel} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="关闭对话框" onClick={onClose}><Icon icon={X}/></button></div>{children}</div></div>;
}
export function applyAppearance(snapshot: Pick<RuntimeSnapshot, 'theme' | 'reduceMotion' | 'reduceTransparency'>) {
  const root = document.documentElement;
  const themeChanged = root.dataset.theme !== undefined && root.dataset.theme !== snapshot.theme;
  const suppression = themeChanged ? document.createElement('style') : null;
  if (suppression) { suppression.dataset.themeTransition = 'suppressed'; suppression.textContent = '*,*::before,*::after{transition:none !important}'; document.head.append(suppression); }
  root.dataset.theme = snapshot.theme;
  root.dataset.motion = snapshot.reduceMotion ? 'reduced' : 'full';
  root.dataset.transparency = snapshot.reduceTransparency ? 'reduced' : 'full';
  if (suppression) { void document.body.offsetHeight; requestAnimationFrame(() => requestAnimationFrame(() => suppression.remove())); }
}
