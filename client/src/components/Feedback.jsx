import { createContext, useCallback, useContext, useRef, useState } from 'react';
import Modal from './Modal.jsx';

// ---------- Toasts ----------

const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);

  const toast = useCallback((mensaje, tipo = 'ok') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, mensaje, tipo }]);
    // Los errores quedan más tiempo en pantalla para que se lleguen a leer.
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tipo === 'error' ? 9000 : 4500);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tipo}`} role={t.tipo === 'error' ? 'alert' : undefined}>
            <span className="toast-icon" aria-hidden="true">
              {t.tipo === 'error' ? '✕' : '✓'}
            </span>
            <span>{t.mensaje}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------- Confirmación ----------

const ConfirmContext = createContext(async () => false);

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);

  const confirm = useCallback(
    (opts) =>
      new Promise((resolve) => {
        setState({ ...opts, resolve });
      }),
    [],
  );

  const close = (result) => {
    state?.resolve(result);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        title={state?.titulo || 'Confirmar'}
        onClose={() => close(false)}
        size="sm"
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => close(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className={`btn ${state?.peligro ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => close(true)}
              autoFocus
            >
              {state?.confirmar || 'Confirmar'}
            </button>
          </>
        }
      >
        <p>{state?.mensaje}</p>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);

// ---------- Alertas inline ----------

export function Alert({ tipo = 'error', children, className = '', id }) {
  if (!children) return null;
  return (
    <div id={id} className={`alert alert-${tipo} ${className}`} role={tipo === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Spinner({ label = 'Cargando…' }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
