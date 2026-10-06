import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * Diálogo modal accesible basado en <dialog> nativo
 * (foco atrapado, Escape para cerrar, fondo inerte).
 */
export default function Modal({ open, title, onClose, children, footer, size = 'md', tone }) {
  const ref = useRef(null);
  const titleId = useId();

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const onCancel = (e) => {
      e.preventDefault();
      onClose?.();
    };
    dlg.addEventListener('cancel', onCancel);
    return () => dlg.removeEventListener('cancel', onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className={`modal modal-${size}${tone ? ` modal-${tone}` : ''}`}
      aria-labelledby={titleId}
      onClick={(e) => {
        // click en el backdrop
        if (e.target === ref.current) onClose?.();
      }}
    >
      {open && (
        <div className="modal-inner">
          <header className="modal-header">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Cerrar">
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="modal-body">{children}</div>
          {footer && <footer className="modal-footer">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}
