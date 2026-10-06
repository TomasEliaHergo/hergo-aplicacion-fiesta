import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Html5Qrcode, Html5QrcodeScannerState, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import {
  CameraOff,
  Check,
  CircleCheck,
  CircleX,
  LayoutDashboard,
  LogOut,
  RotateCcw,
  ScanLine,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import Avatar from '../../components/Avatar.jsx';
import { useConfirm } from '../../components/Feedback.jsx';
import { useDocumentTitle, useTheme } from '../../hooks/hooks.js';
import { formatDocumento, formatHora, formatNumero } from '../../utils.js';
import '../../styles/scanner.css';

const AUTO_RESUME_MS = 4000;
const DEBOUNCE_MISMO_TOKEN_MS = 5000;

// ---------- Feedback sonoro / háptico ----------

let audioCtx = null;
function getAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function tono(ctx, freq, start, dur, type = 'sine', gain = 0.25) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(gain, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + dur + 0.02);
}

// El sonido de éxito suena SOLO con el ingreso confirmado (OK). PENDIENTE (lectura
// a verificar) solo vibra corto: nadie debe confundirlo con "puede pasar".
function feedback(estado, sonido) {
  const vib = {
    PENDIENTE: [60],
    OK: [120],
    YA_INGRESO: [120, 80, 120],
    INVALIDO: [400],
    RECHAZADO: [400],
    ERROR: [400],
  }[estado];
  try {
    if (vib) navigator.vibrate?.(vib);
  } catch {
    /* no soportado */
  }
  if (!sonido || estado === 'PENDIENTE') return;
  const ctx = getAudio();
  if (!ctx) return;
  if (estado === 'OK') {
    tono(ctx, 880, 0, 0.12);
    tono(ctx, 1320, 0.12, 0.18);
  } else if (estado === 'YA_INGRESO') {
    tono(ctx, 660, 0, 0.15, 'triangle');
    tono(ctx, 660, 0.22, 0.15, 'triangle');
  } else {
    tono(ctx, 180, 0, 0.45, 'square', 0.15);
  }
}

function describirErrorCamara(err) {
  const name = err?.name || '';
  const msg = String(err?.message || err || '');
  if (!window.isSecureContext) {
    return 'La cámara solo funciona en una conexión segura (HTTPS) o en localhost. Abrí la aplicación con https://';
  }
  if (name === 'NotAllowedError' || /permission|denied|notallowed/i.test(msg)) {
    return 'No se otorgó permiso para usar la cámara. Habilitalo en la configuración del navegador y reintentá.';
  }
  if (name === 'NotFoundError' || /not ?found|no camera|requested device/i.test(msg)) {
    return 'No se encontró ninguna cámara en este dispositivo.';
  }
  if (name === 'NotReadableError' || /in use|could not start|notreadable/i.test(msg)) {
    return 'La cámara está siendo usada por otra aplicación. Cerrala y reintentá.';
  }
  return 'No se pudo iniciar la cámara. Reintentá o recargá la página.';
}

// ---------- Tarjeta de resultado ----------

// Íconos con forma distinta por estado (no depender solo del color):
// círculo = OK, triángulo = advertencia, cuadrado redondeado = rechazo / error,
// credencial (rectángulo apaisado con persona) = verificar identidad.
function IconoEstado({ forma }) {
  return (
    <svg className="scan-result-icon" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      {forma === 'ok' && (
        <>
          <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="8" />
          <path d="M29 51 L44 66 L72 36" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {forma === 'warn' && (
        <>
          <path d="M50 8 L94 88 H6 Z" fill="none" stroke="currentColor" strokeWidth="8" strokeLinejoin="round" />
          <path d="M50 36 V60" stroke="currentColor" strokeWidth="10" strokeLinecap="round" />
          <circle cx="50" cy="75" r="6" fill="currentColor" />
        </>
      )}
      {forma === 'verify' && (
        <>
          <rect x="5" y="18" width="90" height="64" rx="10" fill="none" stroke="currentColor" strokeWidth="7" />
          <circle cx="32" cy="42" r="9" fill="currentColor" />
          <path d="M17 68 C19 56 45 56 47 68 Z" fill="currentColor" />
          <path d="M58 38 H82 M58 52 H82 M58 66 H74" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
        </>
      )}
      {(forma === 'bad' || forma === 'error') && (
        <>
          <rect x="7" y="7" width="86" height="86" rx="18" fill="none" stroke="currentColor" strokeWidth="8" />
          {forma === 'bad' ? (
            <path d="M33 33 L67 67 M67 33 L33 67" stroke="currentColor" strokeWidth="10" strokeLinecap="round" />
          ) : (
            <>
              <path d="M50 26 V58" stroke="currentColor" strokeWidth="10" strokeLinecap="round" />
              <circle cx="50" cy="73" r="6" fill="currentColor" />
            </>
          )}
        </>
      )}
    </svg>
  );
}

const SUB_ERROR = {
  verificar: 'Error de conexión · No se pudo verificar el QR',
  confirmar: 'Error de conexión · El ingreso NO se registró',
  rechazar: 'Error de conexión · El rechazo no se guardó · No dejar pasar',
};

function configResultado({ estado, escaneado_at, escaneado_por_nombre, accion, motivo }) {
  switch (estado) {
    case 'PENDIENTE':
      return { clase: 'res-verify', forma: 'verify', titulo: 'VERIFICÁ LA IDENTIDAD', sub: 'Compará la foto con la persona' };
    case 'OK':
      return { clase: 'res-ok', forma: 'ok', titulo: 'PUEDE PASAR', sub: null };
    case 'YA_INGRESO': {
      const quien = escaneado_por_nombre ? ` · por ${escaneado_por_nombre}` : '';
      return {
        clase: 'res-warn',
        forma: 'warn',
        titulo: 'QR YA USADO',
        sub: escaneado_at ? `Ingresó a las ${formatHora(escaneado_at)}${quien}` : null,
        nota: 'No dejar pasar sin consultar',
      };
    }
    case 'RECHAZADO':
      return {
        clase: 'res-bad',
        forma: 'bad',
        titulo: 'INGRESO RECHAZADO',
        sub: motivo ? `Motivo: ${motivo}` : null,
        nota: 'No dejar pasar · Derivar a RRHH',
      };
    case 'ERROR':
      return {
        clase: 'res-error',
        forma: 'error',
        titulo: 'NO REGISTRADO',
        sub: SUB_ERROR[accion] || 'Error de conexión · Volvé a escanear',
      };
    case 'INVALIDO':
    default:
      return { clase: 'res-bad', forma: 'bad', titulo: 'NO PASA', sub: 'QR no válido' };
  }
}

const MOTIVOS_RECHAZO = ['No coincide la foto', 'Sin DNI', 'Otro'];

function Persona({ empleado }) {
  const [sinFoto, setSinFoto] = useState(!empleado?.foto_url);
  return (
    <div className="scan-result-body">
      <div className="scan-photo-wrap">
        <Avatar nombre={empleado.nombre} src={empleado.foto_url} size={240} className="scan-photo" eager onFallback={setSinFoto} />
        {sinFoto && <p className="scan-nofoto">SIN FOTO · Pedí el DNI</p>}
      </div>
      <p className="scan-name">{empleado.nombre}</p>
      <dl className="scan-data">
        <div className="scan-data-full">
          <dt>Documento</dt>
          <dd>{formatDocumento(empleado.documento)}</dd>
        </div>
        {empleado.empresa && (
          <div className={empleado.sector ? '' : 'scan-data-full'}>
            <dt>Empresa</dt>
            <dd>{empleado.empresa}</dd>
          </div>
        )}
        {empleado.sector && (
          <div className={empleado.empresa ? '' : 'scan-data-full'}>
            <dt>Sector</dt>
            <dd>{empleado.sector}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

const SpinnerBtn = () => <span className="spinner scan-btn-spinner" aria-hidden="true" />;

/** Botones de decisión (PENDIENTE): confirmar / no es la persona (+ motivo opcional). */
function Decision({ enviando, onConfirmar, onRechazar }) {
  const [eligiendoMotivo, setEligiendoMotivo] = useState(false);
  const ocupado = Boolean(enviando);

  if (eligiendoMotivo) {
    return (
      <div className="scan-next-bar scan-decision-bar">
        <p className="scan-motivo-titulo" id="scan-motivo-titulo">
          ¿Por qué no pasa? <span>(opcional)</span>
        </p>
        <div className="scan-motivos" role="group" aria-labelledby="scan-motivo-titulo">
          {MOTIVOS_RECHAZO.map((m) => (
            <button key={m} type="button" className="btn scan-motivo" disabled={ocupado} onClick={() => onRechazar(m)}>
              {m}
            </button>
          ))}
        </div>
        <div className="scan-decision">
          <button type="button" className="btn scan-btn-volver" disabled={ocupado} onClick={() => setEligiendoMotivo(false)}>
            <Undo2 size={22} aria-hidden="true" />
            Volver
          </button>
          <button
            type="button"
            className="btn scan-btn-rechazar"
            disabled={ocupado}
            aria-busy={enviando === 'rechazar'}
            onClick={() => onRechazar(null)}
          >
            {enviando === 'rechazar' ? <SpinnerBtn /> : <X size={24} strokeWidth={3} aria-hidden="true" />}
            Rechazar sin motivo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="scan-next-bar scan-decision-bar">
      <div className="scan-decision">
        <button
          type="button"
          className="btn scan-btn-confirmar"
          disabled={ocupado}
          aria-busy={enviando === 'confirmar'}
          onClick={onConfirmar}
        >
          {enviando === 'confirmar' ? <SpinnerBtn /> : <Check size={26} strokeWidth={3} aria-hidden="true" />}
          {enviando === 'confirmar' ? 'Registrando…' : 'Confirmar ingreso'}
        </button>
        <button type="button" className="btn scan-btn-rechazar" disabled={ocupado} onClick={() => setEligiendoMotivo(true)}>
          <X size={26} strokeWidth={3} aria-hidden="true" />
          No es la persona
        </button>
      </div>
    </div>
  );
}

function ResultCard({ resultado, enviando, onNext, onConfirmar, onRechazar, onReintentar, autoResume }) {
  const { estado, empleado, mensaje } = resultado;
  const btnRef = useRef(null);
  const tituloRef = useRef(null);
  useEffect(() => {
    // En PENDIENTE el foco va al título (no a "Confirmar": un Enter accidental no debe registrar).
    if (estado === 'PENDIENTE') tituloRef.current?.focus();
    else btnRef.current?.focus();
  }, [estado]);

  const config = configResultado(resultado);
  const reintentable = estado === 'ERROR' && Boolean(resultado.token && resultado.accion);

  return (
    <div className={`scan-result ${config.clase}`} role="alert" aria-live="assertive">
      <div className="scan-result-head">
        <IconoEstado forma={config.forma} />
        <div className="scan-result-texts">
          <h1 className="scan-result-title" ref={tituloRef} tabIndex={-1}>
            {config.titulo}
          </h1>
          {config.sub && <p className="scan-result-sub">{config.sub}</p>}
          {config.nota && <p className="scan-result-nota">{config.nota}</p>}
        </div>
      </div>

      {empleado ? (
        <Persona empleado={empleado} />
      ) : (
        <div className="scan-result-body">
          <p className="scan-msg">
            {estado === 'ERROR'
              ? mensaje || 'No se pudo conectar con el servidor. Verificá la conexión.'
              : 'Este código no corresponde a ningún invitado. Pedile a la persona que muestre su QR correcto o derivala a RRHH.'}
          </p>
        </div>
      )}

      {estado === 'PENDIENTE' ? (
        <Decision
          enviando={enviando}
          onConfirmar={() => onConfirmar(resultado)}
          onRechazar={(motivo) => onRechazar(resultado, motivo)}
        />
      ) : (
        <div className={`scan-next-bar${reintentable ? ' scan-next-bar-doble' : ''}`}>
          {reintentable && (
            <button
              ref={btnRef}
              type="button"
              className="btn btn-scan-next"
              disabled={Boolean(enviando)}
              aria-busy={Boolean(enviando)}
              onClick={() => onReintentar(resultado)}
            >
              {enviando ? <SpinnerBtn /> : <RotateCcw size={24} aria-hidden="true" />}
              Reintentar
            </button>
          )}
          <button
            ref={reintentable ? undefined : btnRef}
            type="button"
            className={`btn btn-scan-next${reintentable ? ' btn-scan-next-sec' : ''}`}
            disabled={Boolean(enviando)}
            onClick={onNext}
          >
            <ScanLine size={24} aria-hidden="true" />
            Escanear siguiente
          </button>
        </div>
      )}
      {autoResume && (
        <div className="scan-countdown" style={{ animationDuration: `${AUTO_RESUME_MS}ms` }} aria-hidden="true" />
      )}
    </div>
  );
}

// ---------- Página ----------

export default function Scanner() {
  useTheme('scanner');
  useDocumentTitle('Escáner - Fiesta de fin de año');
  const { usuario, logout } = useAuth();
  const confirm = useConfirm();
  const containerRef = useRef(null);
  const qrRef = useRef(null);
  const busyRef = useRef(false);
  const lastRef = useRef({ token: null, at: 0 });
  const resumeTimer = useRef(null);
  const sonidoRef = useRef(true);

  const [camKey, setCamKey] = useState(0);
  const [camEstado, setCamEstado] = useState('iniciando'); // iniciando | activa | error
  const [camError, setCamError] = useState('');
  const [resultado, setResultado] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [sonido, setSonido] = useState(true);
  // Sesión: ingresos confirmados y rechazos ("No es la persona") en este dispositivo.
  const [contador, setContador] = useState({ confirmados: 0, rechazados: 0 });
  const [enviando, setEnviando] = useState(null); // 'confirmar' | 'rechazar' | null
  const enviandoRef = useRef(false); // guarda síncrona contra doble toque

  useEffect(() => {
    sonidoRef.current = sonido;
  }, [sonido]);

  // Desbloquea el audio en iOS/Android con el primer toque.
  useEffect(() => {
    const unlock = () => getAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const reanudar = useCallback(() => {
    clearTimeout(resumeTimer.current);
    // El mismo QR que sigue frente a la cámara no se vuelve a procesar enseguida.
    lastRef.current = { ...lastRef.current, at: Date.now() };
    setResultado(null);
    busyRef.current = false;
    const qr = qrRef.current;
    try {
      if (qr && qr.getState() === Html5QrcodeScannerState.PAUSED) qr.resume();
    } catch {
      /* ignorar */
    }
  }, []);

  /** Muestra un resultado con su feedback. Solo OK se reanuda solo; el resto exige un toque. */
  const mostrar = useCallback(
    (res) => {
      feedback(res.estado, sonidoRef.current);
      setResultado(res);
      clearTimeout(resumeTimer.current);
      if (res.estado === 'OK') resumeTimer.current = setTimeout(reanudar, AUTO_RESUME_MS);
    },
    [reanudar],
  );

  /** Paso 1: solo lectura. Muestra a la persona para comparar la foto. */
  const verificar = useCallback(
    async (token) => {
      setProcesando(true);
      let res;
      try {
        res = { ...(await api.post('/scan/verificar', { token })), token };
      } catch (err) {
        if (err.status === 401) return; // el AuthContext redirige al login
        if (err.status === 400) {
          res = { estado: 'INVALIDO', empleado: null, escaneado_at: null };
        } else {
          res = { estado: 'ERROR', empleado: null, mensaje: err.message, token, accion: 'verificar' };
          // Permite volver a escanear el mismo QR inmediatamente.
          lastRef.current = { token: null, at: 0 };
        }
      } finally {
        setProcesando(false);
      }
      mostrar(res);
    },
    [mostrar],
  );

  /** Ejecuta una acción de la puerta una sola vez a la vez (sin dobles toques). */
  const ejecutar = useCallback(async (accion, fn) => {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(accion);
    try {
      await fn();
    } finally {
      enviandoRef.current = false;
      setEnviando(null);
    }
  }, []);

  /** Paso 2a: confirmar => registra el ingreso (OK, o YA_INGRESO si otro confirmó antes). */
  const confirmar = useCallback(
    ({ token, empleado }) =>
      ejecutar('confirmar', async () => {
        try {
          const r = await api.post('/scan/confirmar', { token });
          if (r.estado === 'OK') setContador((c) => ({ ...c, confirmados: c.confirmados + 1 }));
          // Si el token dejó de existir (empleado borrado) llega INVALIDO sin datos.
          mostrar({ ...r, token });
        } catch (err) {
          if (err.status === 401) return;
          if (err.status === 400) {
            mostrar({ estado: 'INVALIDO', empleado: null, escaneado_at: null });
            return;
          }
          // Se conserva el token: "Reintentar" confirma sin volver a escanear.
          mostrar({ estado: 'ERROR', empleado, token, accion: 'confirmar', mensaje: err.message });
        }
      }),
    [ejecutar, mostrar],
  );

  /** Paso 2b: "No es la persona" => auditoría del rechazo; NO registra el ingreso. */
  const rechazar = useCallback(
    ({ token, empleado }, motivo) =>
      ejecutar('rechazar', async () => {
        try {
          await api.post('/scan/rechazar', motivo ? { token, motivo } : { token });
          setContador((c) => ({ ...c, rechazados: c.rechazados + 1 }));
          mostrar({ estado: 'RECHAZADO', empleado, token, motivo });
        } catch (err) {
          if (err.status === 401) return;
          if (err.status === 404) {
            mostrar({ estado: 'INVALIDO', empleado: null, escaneado_at: null });
            return;
          }
          mostrar({ estado: 'ERROR', empleado, token, motivo, accion: 'rechazar', mensaje: err.message });
        }
      }),
    [ejecutar, mostrar],
  );

  const reintentar = useCallback(
    (res) => {
      if (res.accion === 'confirmar') confirmar(res);
      else if (res.accion === 'rechazar') rechazar(res, res.motivo);
      else if (res.accion === 'verificar') {
        lastRef.current = { token: res.token, at: Date.now() };
        setResultado(null);
        verificar(res.token);
      }
    },
    [confirmar, rechazar, verificar],
  );

  const procesar = useCallback(
    async (texto) => {
      const token = String(texto || '').trim();
      if (!token || busyRef.current) return;
      const now = Date.now();
      if (token === lastRef.current.token && now - lastRef.current.at < DEBOUNCE_MISMO_TOKEN_MS) return;

      busyRef.current = true;
      lastRef.current = { token, at: now };
      try {
        qrRef.current?.pause(true);
      } catch {
        /* ignorar */
      }
      await verificar(token);
    },
    [verificar],
  );

  const procesarRef = useRef(procesar);
  procesarRef.current = procesar;

  // Inicio / parada de la cámara. Cada montaje usa su propio <div> para tolerar
  // el doble montaje de StrictMode y los reintentos.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    if (!window.isSecureContext) {
      setCamEstado('error');
      setCamError(describirErrorCamara(null));
      return undefined;
    }

    let cancelado = false;
    const el = document.createElement('div');
    el.id = `qr-reader-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    el.className = 'qr-reader';
    container.appendChild(el);

    const qr = new Html5Qrcode(el.id, {
      verbose: false,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true },
    });
    qrRef.current = qr;
    setCamEstado('iniciando');

    const config = {
      fps: 12,
      qrbox: (w, h) => {
        const s = Math.max(180, Math.floor(Math.min(w, h) * 0.7));
        return { width: s, height: s };
      },
      disableFlip: false,
    };

    const startPromise = qr
      .start({ facingMode: 'environment' }, config, (text) => procesarRef.current(text), () => {})
      .then(() => {
        if (!cancelado) setCamEstado('activa');
      })
      .catch((err) => {
        if (cancelado) return;
        setCamEstado('error');
        setCamError(describirErrorCamara(err));
      });

    return () => {
      cancelado = true;
      clearTimeout(resumeTimer.current);
      startPromise.finally(async () => {
        try {
          if (qr.isScanning) await qr.stop();
        } catch {
          /* ignorar */
        }
        try {
          qr.clear();
        } catch {
          /* ignorar */
        }
        el.remove();
      });
      if (qrRef.current === qr) qrRef.current = null;
    };
  }, [camKey]);

  const reintentarCamara = () => {
    setCamError('');
    busyRef.current = false;
    setResultado(null);
    setCamKey((k) => k + 1);
  };

  const salir = async () => {
    const ok = await confirm({
      titulo: 'Cerrar sesión del escáner',
      mensaje: 'Vas a tener que volver a ingresar usuario y contraseña para seguir escaneando.',
      confirmar: 'Cerrar sesión',
      peligro: true,
    });
    if (ok) logout();
  };

  return (
    <div className="scanner-page">
      <header className="scanner-bar">
        <div className="scanner-who">
          <span className="scanner-dot" aria-hidden="true" />
          <strong>{usuario?.nombre}</strong>
        </div>
        <p
          className="scanner-count"
          aria-label={`${contador.confirmados} ingresos confirmados y ${contador.rechazados} rechazados en esta sesión`}
          title="Ingresos confirmados y rechazados en esta sesión"
        >
          <CircleCheck size={16} aria-hidden="true" />
          <span className="tabular">{formatNumero(contador.confirmados)}</span>
          <span className="scanner-count-label">ingresos</span>
          {contador.rechazados > 0 && (
            <span className="scanner-count-rech">
              <CircleX size={16} aria-hidden="true" />
              <span className="tabular">{formatNumero(contador.rechazados)}</span>
              <span className="scanner-count-label">rech.</span>
            </span>
          )}
        </p>
        <div className="scanner-actions">
          <button
            type="button"
            className="scanner-btn"
            aria-pressed={sonido}
            aria-label={sonido ? 'Sonido activado' : 'Sonido desactivado'}
            title={sonido ? 'Sonido activado' : 'Sonido desactivado'}
            onClick={() => {
              getAudio();
              setSonido((s) => !s);
            }}
          >
            {sonido ? <Volume2 size={20} aria-hidden="true" /> : <VolumeX size={20} aria-hidden="true" />}
          </button>
          {usuario?.rol === 'rrhh' && (
            <Link to="/admin" className="scanner-btn" aria-label="Ir al panel" title="Ir al panel">
              <LayoutDashboard size={20} aria-hidden="true" />
            </Link>
          )}
          <button type="button" className="scanner-btn" onClick={salir} aria-label="Salir" title="Salir">
            <LogOut size={20} aria-hidden="true" />
          </button>
        </div>
      </header>

      <main className="scanner-main">
        <div className="scanner-video" ref={containerRef} aria-label="Vista de la cámara" />

        {camEstado === 'activa' && !resultado && (
          <div className="scan-frame" aria-hidden="true">
            <span className="scan-corner tl" />
            <span className="scan-corner tr" />
            <span className="scan-corner bl" />
            <span className="scan-corner br" />
            <span className="scan-line" />
          </div>
        )}

        {camEstado === 'iniciando' && (
          <div className="scanner-overlay-msg" role="status">
            <span className="spinner" aria-hidden="true" />
            Iniciando cámara…
          </div>
        )}

        {camEstado === 'activa' && !resultado && !procesando && (
          <p className="scanner-hint" role="status">
            Apuntá la cámara al código QR
          </p>
        )}

        {procesando && !resultado && (
          <div className="scanner-verifying" role="status" aria-live="assertive">
            <span className="scanner-verifying-spinner" aria-hidden="true" />
            <p>Verificando…</p>
          </div>
        )}

        {camEstado === 'error' && (
          <div className="scanner-error" role="alert">
            <span className="scanner-error-icon" aria-hidden="true">
              <CameraOff size={32} />
            </span>
            <p>{camError}</p>
            <button type="button" className="btn btn-primary btn-lg" onClick={reintentarCamara}>
              <RotateCcw size={18} aria-hidden="true" />
              Reintentar
            </button>
          </div>
        )}

        {resultado && (
          <ResultCard
            key={`${resultado.estado}-${resultado.token ?? ''}`}
            resultado={resultado}
            enviando={enviando}
            onNext={reanudar}
            onConfirmar={confirmar}
            onRechazar={rechazar}
            onReintentar={reintentar}
            autoResume={resultado.estado === 'OK'}
          />
        )}
      </main>
    </div>
  );
}
