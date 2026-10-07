import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './ui';

interface Props {
  onClose: () => void;
  children: ReactNode;
  /** حداکثر عرض؛ پیش‌فرض max-w-3xl */
  maxWidth?: string;
  /** در موبایل به‌صورت شیت پایین صفحه باز شود */
  sheet?: boolean;
  labelledBy?: string;
}

/**
 * پوستهٔ مشترک مودال‌ها:
 *  • با Esc بسته می‌شود
 *  • اسکرول صفحهٔ پشت را قفل می‌کند
 *  • هنگام باز شدن، فوکوس را داخل مودال می‌گیرد
 */
export function Modal({ onClose, children, maxWidth = 'max-w-3xl', sheet = false, labelledBy }: Props) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    box.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className={`no-print fixed inset-0 z-50 flex animate-fade bg-ink-950/60 backdrop-blur-sm ${
        sheet ? 'items-end justify-center sm:items-center sm:p-6' : 'items-center justify-center p-3 sm:p-6'
      }`}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
        className={`flex w-full animate-pop flex-col overflow-hidden bg-white shadow-2xl outline-none ${maxWidth} ${
          sheet ? 'max-h-[92vh] rounded-t-3xl sm:max-h-[90vh] sm:rounded-3xl' : 'max-h-[92vh] rounded-3xl'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ title, subtitle, onClose, id }: { title: ReactNode; subtitle?: string; onClose: () => void; id?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 sm:px-6">
      <div className="min-w-0">
        <h2 id={id} className="truncate text-base font-bold text-ink-900 sm:text-lg">
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      <button
        onClick={onClose}
        aria-label="بستن"
        className="shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
      >
        <Icon name="x" className="h-5 w-5" />
      </button>
    </div>
  );
}
