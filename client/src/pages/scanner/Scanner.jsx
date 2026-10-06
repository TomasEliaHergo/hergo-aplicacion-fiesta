import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Html5Qrcode, Html5QrcodeScannerState, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { CameraOff, CircleCheck, LayoutDashboard, LogOut, RotateCcw, ScanLine, Volume2, VolumeX } from 'lucide-react';
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

function feedback(estado, sonido) {
  const vib = { OK: [120], YA_INGRESO: [120, 80, 120], INVALIDO: [400], ERROR: [400] }[estado];
  try {
    navigator.vibrate?.(vib);
  } catch {
    /* no soportado */
  }
  if (!sonido) return;
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
// círculo = OK, triángulo = advertencia, cuadrado redondeado = rechazo / error.
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

function configResultado(estado, escaneado_at) {
  switch (estado) {
    case 'OK':
      return { clase: 'res-ok', forma: 'ok', titulo: 'PUEDE PASAR', sub: null };
    case 'YA_INGRESO':
      return {
        clase: 'res-warn',
        forma: 'warn',
        titulo: 'QR YA USADO',
        sub: escaneado_at
          ? `Ingresó a las ${formatHora(escaneado_at)} · No dejar pasar sin consultar`
          : 'No dejar pasar sin consultar',
      };
    case 'ERROR':
      return {
        clase: 'res-error',
        forma: 'error',
        titulo: 'NO REGISTRADO',
        sub: 'Error de conexión · Volvé a escanear',
      };
    case 'INVALIDO':
    default:
      return { clase: 'res-bad', forma: 'bad', titulo: 'NO PASA', sub: 'QR no válido' };
  }
}

function ResultCard({ resultado, onNext, autoResume }) {
  const { estado, empleado, escaneado_at, mensaje } = resultado;
  const btnRef = useRef(null);
  const [sinFoto, setSinFoto] = useState(!empleado?.foto_url);
  useEffect(() => {
    btnRef.current?.focus();
  }, []);

  const config = configResultado(estado, escaneado_at);

  return (
    <div className={`scan-result ${config.clase}`} role="alert" aria-live="assertive">
      <div className="scan-result-head">
        <IconoEstado forma={config.forma} />
        <div className="scan-result-texts">
          <h1 className="scan-result-title">{config.titulo}</h1>
          {config.sub && <p className="scan-result-sub">{config.sub}</p>}
        </div>
      </div>

      {empleado ? (
        <div className="scan-result-body">
          <div className="scan-photo-wrap">
            <Avatar
              nombre={empleado.nombre}
              src={empleado.foto_url}
              size={240}
              className="scan-photo"
              eager
              onFallback={setSinFoto}
            />
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
      ) : (
        <div className="scan-result-body">
          <p className="scan-msg">
            {estado === 'ERROR'
              ? mensaje || 'No se pudo registrar el ingreso. Verificá la conexión y volvé a escanear.'
              : 'Este código no corresponde a ningún invitado. Pedile a la persona que muestre su QR correcto o derivala a RRHH.'}
          </p>
        </div>
      )}

      <div className="scan-next-bar">
        <button ref={btnRef} type="button" className="btn btn-scan-next" onClick={onNext}>
          <ScanLine size={24} aria-hidden="true" />
          Escanear siguiente
        </button>
      </div>
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
  const [contador, setContador] = useState(0); // ingresos OK en esta sesión
  const [escaneos, setEscaneos] = useState(0); // lecturas totales en esta sesión

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
      setProcesando(true);

      let res;
      try {
        res = await api.post('/scan', { token });
      } catch (err) {
        if (err.status === 400) {
          res = { estado: 'INVALIDO', empleado: null, escaneado_at: null };
        } else if (err.status === 401) {
          return; // el AuthContext redirige al login
        } else {
          res = { estado: 'ERROR', empleado: null, mensaje: err.message };
          // Permite reintentar el mismo QR inmediatamente.
          lastRef.current = { token: null, at: 0 };
        }
      } finally {
        setProcesando(false);
      }

      if (res.estado === 'OK') setContador((c) => c + 1);
      setEscaneos((c) => c + 1);
      feedback(res.estado, sonidoRef.current);
      setResultado(res);
      clearTimeout(resumeTimer.current);
      // Solo se reanuda solo cuando puede pasar. Advertencias y rechazos exigen
      // que el personal toque "Escanear siguiente" (no se pierden de vista).
      if (res.estado === 'OK') resumeTimer.current = setTimeout(reanudar, AUTO_RESUME_MS);
    },
    [reanudar],
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
          aria-label={`${contador} ingresos registrados y ${escaneos} lecturas en esta sesión`}
          title="Ingresos registrados en esta sesión"
        >
          <CircleCheck size={16} aria-hidden="true" />
          <span className="tabular">{formatNumero(contador)}</span>
          <span className="scanner-count-label">ingresos</span>
          {escaneos > contador && <span className="scanner-count-total tabular">/ {formatNumero(escaneos)}</span>}
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

        {resultado && <ResultCard resultado={resultado} onNext={reanudar} autoResume={resultado.estado === 'OK'} />}
      </main>
    </div>
  );
}
