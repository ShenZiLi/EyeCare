import { useEffect, useRef, type ReactNode } from 'react';
import { AlertCircle, X, type LucideIcon } from 'lucide-react';
import type { RuntimeSnapshot } from '../shared/contracts';

export function Icon({ icon: Svg, size = 20 }: { icon: LucideIcon; size?: number }) { return <Svg size={size} aria-hidden="true" strokeWidth={1.8}/>; }
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) { return <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : undefined}><Icon icon={AlertCircle}/><div>{children}</div></div>; }
export function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) { return <section className="section"><div className="section-heading"><h2>{title}</h2>{description && <p>{description}</p>}</div>{children}</section>; }
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) { return <div className="field"><label className="field-label">{label}{children}</label>{hint && <p className="hint">{hint}</p>}{error && <p className="field-error" role="alert">{error}</p>}</div>; }
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
export function applyAppearance(snapshot: Pick<RuntimeSnapshot, 'theme' | 'reduceMotion' | 'reduceTransparency'>) { document.documentElement.dataset.theme = snapshot.theme; document.documentElement.dataset.motion = snapshot.reduceMotion ? 'reduced' : 'full'; document.documentElement.dataset.transparency = snapshot.reduceTransparency ? 'reduced' : 'full'; }
