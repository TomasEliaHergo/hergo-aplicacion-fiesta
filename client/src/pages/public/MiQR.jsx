import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Camera,
  Lock,
  PartyPopper,
  RotateCcw,
  SearchX,
  Sparkles,
  Sun,
} from 'lucide-react';
import { api } from '../../api.js';
import QrCard from '../../components/QrCard.jsx';
import { Alert, Spinner } from '../../components/Feedback.jsx';
import { useDocumentTitle, useTheme } from '../../hooks/hooks.js';
import { formatDocumento, formatHora, soloDigitos } from '../../utils.js';
import {
  consultarEstado,
  esRutaInexistente,
  guardarInvitado,
  leerInvitado,
  primerNombre,
  useEstadoIngreso,
} from './invitado.js';
import '../../styles/public.css';

// ---------- Confeti (solo CSS) ----------

const COLORES = ['#f2c14e', '#ffffff', '#f78fb3', '#7dd3fc', '#c4b5fd', '#f7d27a'];
const PIEZAS = Array.from({ length: 30 }, (_, i) => {
  const r = (n) => ((i * 9301 + n * 49297) % 233280) / 233280; // pseudoaleatorio estable
  return {
    left: `${Math.round(r(1) * 100)}%`,
    delay: `${(r(2) * 1.2).toFixed(2)}s`,
    dur: `${(2.6 + r(3) * 1.8).toFixed(2)}s`,
    drift: `${Math.round((r(4) - 0.5) * 160)}px`,
    rot: `${Math.round(r(5) * 720 - 360)}deg`,
    color: COLORES[i % COLORES.length],
    shape: i % 3,
  };
});

function Confeti({ repetir = 1 }) {
  return (
    <div className="confetti" aria-hidden="true" style={{ '--confetti-iter': repetir }}>
      {PIEZAS.map((p, i) => (
        <span
          key={i}
          className={`confetti-piece shape-${p.shape}`}
          style={{
            left: p.left,
            animationDelay: p.delay,
            animationDuration: p.dur,
            '--drift': p.drift,
            '--rot': p.rot,
            background: p.color,
          }}
        />
      ))}
    </div>
  );
}

function Destellos() {
  return (
    <span className="sparkles" aria-hidden="true">
      <Sparkles className="sparkle s1" size={22} />
      <Sparkles className="sparkle s2" size={16} />
      <Sparkles className="sparkle s3" size={18} />
      <Sparkles className="sparkle s4" size={14} />
    </span>
  );
}

// ---------- Pasos ----------

function PasoDocumento({ documento, setDocumento, onSubmit, cargando, error, inputRef }) {
  return (
    <>
      <header className="guest-hero">
        <span className="guest-badge">
          <Sparkles size={14} aria-hidden="true" />
          Te esperamos
        </span>
        <h1 className="guest-title">Fiesta de fin de año</h1>
        <p className="guest-lead">Ingresá tu documento y obtené tu código QR de ingreso.</p>
      </header>

      <form className="glass-card guest-form" onSubmit={onSubmit} noValidate>
        <div className="field">
          <label htmlFor="documento">Número de documento</label>
          <input
            ref={inputRef}
            id="documento"
            name="documento"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="go"
            placeholder="Ej: 30.123.456"
            maxLength={20}
            value={documento}
            onChange={(e) => setDocumento(e.target.value.replace(/[^\d.\s-]/g, ''))}
            aria-describedby={error ? 'documento-ayuda documento-error' : 'documento-ayuda'}
            aria-invalid={error ? 'true' : undefined}
            className="input-xl tabular"
          />
          <small id="documento-ayuda" className="field-hint">
            Con o sin puntos, como prefieras.
          </small>
        </div>
        <Alert id="documento-error" tipo={error?.tipo}>
          {error?.mensaje}
        </Alert>
        <button type="submit" className="btn btn-primary btn-block btn-xl" disabled={cargando}>
          {cargando ? (
            <Spinner label="Buscando…" />
          ) : (
            <>
              Ver mi QR
              <ArrowRight size={20} aria-hidden="true" />
            </>
          )}
        </button>
        <p className="guest-note">
          <Lock size={14} aria-hidden="true" />
          Solo lo usamos para buscarte en la lista.
        </p>
      </form>
    </>
  );
}

function PasoNoEncontrado({ documento, onRetry, titleRef }) {
  return (
    <section className="glass-card guest-state" aria-labelledby="nf-title">
      <span className="state-icon" aria-hidden="true">
        <SearchX size={28} />
      </span>
      <h1 id="nf-title" className="state-title" tabIndex={-1} ref={titleRef}>
        No te encontramos en la lista
      </h1>
      <p className="state-text">
        Buscamos el documento <strong className="tabular">{formatDocumento(documento)}</strong> y no figura entre los
        invitados.
      </p>
      <ul className="state-tips">
        <li>Revisá que el número esté bien escrito.</li>
        <li>Si es correcto, consultá con RRHH: pueden agregarte en un minuto.</li>
      </ul>
      <button type="button" className="btn btn-primary btn-block btn-xl" onClick={onRetry}>
        <RotateCcw size={18} aria-hidden="true" />
        Probar de nuevo
      </button>
    </section>
  );
}

function PasoBienvenida({ invitado, onNoSoy, titleRef, enVivo }) {
  const nombre = primerNombre(invitado.nombre);
  return (
    <>
      <Confeti />
      <header className="welcome-head">
        <span className="welcome-mark" aria-hidden="true">
          <Destellos />
          <PartyPopper size={30} />
        </span>
        <p className="guest-eyebrow">Estás en la lista</p>
        <h1 className="welcome-title" tabIndex={-1} ref={titleRef}>
          ¡Te damos la bienvenida, <span className="gold">{nombre}</span>!
        </h1>
        <p className="guest-lead">Este es tu código de ingreso. Mostralo en la puerta.</p>
      </header>

      <QrCard
        value={invitado.qr_token}
        nombre={invitado.nombre}
        empresa={invitado.empresa}
        buttonLabel="Guardar QR"
        buttonClassName="btn btn-primary btn-block btn-xl"
        className="guest-qr"
      />

      {enVivo && (
        <p className="live-status">
          <span className="live-dot" aria-hidden="true" />
          Te avisamos acá cuando escaneen tu QR.
        </p>
      )}

      <ul className="tips" aria-label="Consejos">
        <li>
          <span className="tip-icon" aria-hidden="true">
            <Camera size={18} />
          </span>
          <span>Guardalo o sacale una captura por si no tenés señal en la entrada.</span>
        </li>
        <li>
          <span className="tip-icon" aria-hidden="true">
            <Sun size={18} />
          </span>
          <span>En la puerta, subí el brillo del celular al máximo.</span>
        </li>
        <li>
          <span className="tip-icon" aria-hidden="true">
            <Lock size={18} />
          </span>
          <span>Es personal: sirve para un solo ingreso. No lo compartas.</span>
        </li>
      </ul>

      <button type="button" className="btn btn-link guest-notme" onClick={onNoSoy}>
        No soy {nombre}
      </button>
    </>
  );
}

function Celebracion({ invitado, titleRef }) {
  const nombre = primerNombre(invitado.nombre);
  return (
    <section className="celebration" aria-labelledby="cel-title">
      <Confeti repetir={3} />
      <div className="celebration-inner">
        <span className="celebration-icon" aria-hidden="true">
          <Destellos />
          <PartyPopper size={44} />
        </span>
        <p className="guest-eyebrow">Ya estás adentro</p>
        <h1 id="cel-title" className="celebration-title" tabIndex={-1} ref={titleRef}>
          ¡Bienvenidos a la fiesta, <span className="gold">{nombre}</span>!
        </h1>
        {invitado.escaneado_at && (
          <p className="celebration-time">
            Ingresaste a las <strong className="tabular">{formatHora(invitado.escaneado_at)}</strong>
          </p>
        )}
        <p className="guest-lead">Que la disfrutes.</p>
      </div>
    </section>
  );
}

// ---------- Página ----------

export default function MiQR() {
  useTheme('night');
  useDocumentTitle('Mi QR - Fiesta de fin de año');

  const [invitado, setInvitadoState] = useState(leerInvitado);
  const [restaurado] = useState(() => invitado !== null); // abrió el link otra vez
  const [noEncontrado, setNoEncontrado] = useState(false);
  const [enVivo, setEnVivo] = useState(true);
  const [documento, setDocumento] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null); // { tipo, mensaje }
  const [anuncio, setAnuncio] = useState('');
  const inputRef = useRef(null);
  const titleRef = useRef(null);

  const setInvitado = useCallback((inv) => {
    setInvitadoState(inv);
    guardarInvitado(inv);
  }, []);

  const etapa = !invitado ? (noEncontrado ? 'noencontrado' : 'documento') : invitado.ingreso ? 'fiesta' : 'qr';

  // Foco al título de cada paso (lectores de pantalla y teclado).
  const primera = useRef(true);
  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      if (etapa === 'documento') inputRef.current?.focus({ preventScroll: true });
      return;
    }
    window.scrollTo({ top: 0 });
    if (etapa === 'documento') inputRef.current?.focus();
    else titleRef.current?.focus({ preventScroll: true });
  }, [etapa]);

  const volverAlInicio = useCallback(
    (mensaje) => {
      setInvitado(null);
      setNoEncontrado(false);
      setError(mensaje ? { tipo: 'warning', mensaje } : null);
    },
    [setInvitado],
  );

  const invRef = useRef(invitado);
  invRef.current = invitado;

  const aplicarEstado = useCallback(
    (d) => {
      const prev = invRef.current;
      if (!prev) return;
      const ingreso = !!d?.ingreso;
      const escaneado_at = d?.escaneado_at ?? null;
      if (ingreso === prev.ingreso && escaneado_at === prev.escaneado_at) return;
      const next = { ...prev, ingreso, escaneado_at, nombre: d?.nombre || prev.nombre };
      setInvitado(next);
      if (ingreso && !prev.ingreso) {
        setAnuncio(`¡Bienvenidos a la fiesta! Ingresaste a las ${formatHora(escaneado_at)}.`);
        try {
          navigator.vibrate?.([80, 60, 160]);
        } catch {
          /* no soportado */
        }
      }
    },
    [setInvitado],
  );

  const onNoEncontradoToken = useCallback(
    () => volverAlInicio('Tu código ya no está vigente. Ingresá tu documento de nuevo.'),
    [volverAlInicio],
  );

  // Seguimiento en vivo mientras se muestra el QR y todavía no ingresó.
  useEstadoIngreso(invitado?.qr_token, etapa === 'qr' && !invitado?.ingreso && enVivo, {
    inmediato: restaurado,
    onCambio: aplicarEstado,
    onNoEncontrado: onNoEncontradoToken,
    onNoDisponible: () => setEnVivo(false),
  });

  // Reabrió el link ya habiendo ingresado: una verificación puntual (por si RRHH deshizo el ingreso).
  useEffect(() => {
    if (!restaurado || !invitado?.ingreso) return undefined;
    const ctrl = new AbortController();
    consultarEstado(invitado.qr_token, ctrl.signal)
      .then(aplicarEstado)
      .catch((err) => {
        if (err?.name === 'AbortError' || esRutaInexistente(err)) return;
        if (err?.status === 404) onNoEncontradoToken();
      });
    return () => ctrl.abort();
    // solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const digitos = soloDigitos(documento);
    if (digitos.length < 5 || digitos.length > 12) {
      setError({ tipo: 'error', mensaje: 'Ingresá un número de documento válido (solo números, sin letras).' });
      inputRef.current?.focus();
      return;
    }
    setCargando(true);
    try {
      const data = await api.post('/public/qr', { documento: digitos });
      setEnVivo(true);
      setInvitado({
        qr_token: data.qr_token,
        nombre: data.nombre,
        empresa: data.empresa || '',
        ingreso: !!data.ingreso,
        escaneado_at: data.escaneado_at || null,
      });
      setAnuncio(`Te damos la bienvenida, ${primerNombre(data.nombre)}. Tu código QR está listo.`);
    } catch (err) {
      if (err.status === 404) {
        setNoEncontrado(true);
      } else if (err.status === 429) {
        setError({ tipo: 'error', mensaje: 'Hiciste muchas consultas seguidas. Esperá un minuto y volvé a intentar.' });
      } else if (err.status === 400) {
        setError({ tipo: 'error', mensaje: 'El documento ingresado no es válido. Revisalo e intentá de nuevo.' });
      } else {
        setError({ tipo: 'error', mensaje: err.message });
      }
    } finally {
      setCargando(false);
    }
  };

  const reintentar = () => {
    setNoEncontrado(false);
    setError(null);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  return (
    <div className={`guest-page etapa-${etapa}`}>
      <div className="guest-bg" aria-hidden="true" />
      <main className="guest-main">
        {etapa === 'documento' && (
          <PasoDocumento
            documento={documento}
            setDocumento={setDocumento}
            onSubmit={onSubmit}
            cargando={cargando}
            error={error}
            inputRef={inputRef}
          />
        )}
        {etapa === 'noencontrado' && <PasoNoEncontrado documento={documento} onRetry={reintentar} titleRef={titleRef} />}
        {etapa === 'qr' && (
          <PasoBienvenida
            invitado={invitado}
            titleRef={titleRef}
            enVivo={enVivo}
            onNoSoy={() => {
              setDocumento('');
              volverAlInicio();
            }}
          />
        )}
        {etapa === 'fiesta' && <Celebracion invitado={invitado} titleRef={titleRef} />}
      </main>
      {etapa !== 'fiesta' && (
        <footer className="guest-footer">
          <Link to="/login">Acceso del personal</Link>
        </footer>
      )}
      <p className="sr-only" aria-live="polite">
        {anuncio}
      </p>
    </div>
  );
}
