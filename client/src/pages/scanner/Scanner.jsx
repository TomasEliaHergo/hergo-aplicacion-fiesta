import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Html5Qrcode, Html5QrcodeScannerState, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import {
  CameraOff,
  Check,
  CircleCheck,
  CircleX,
  IdCard,
  LayoutDashboard,
  LogOut,
  RotateCcw,
  ScanLine,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import Avatar from '../../components/Avatar.jsx';
import Modal from '../../components/Modal.jsx';
import { useConfirm } from '../../components/Feedback.jsx';
import { useDocumentTitle, useTheme } from '../../hooks/hooks.js';
import { formatDocumento, formatHora, formatNumero, soloDigitos } from '../../utils.js';
import '../../styles/scanner.css';

const AUTO_RESUME_MS = 4000;
const DEBOUNCE_MISMO_TOKEN_MS = 5000;
const DOC_MIN = 5;
const DOC_MAX = 12;

/** Formatea mientras se escribe: hasta 8 dígitos con puntos (30.123.456); más largos (CUIT) sin puntos. */
function formatearDniEnCurso(valor) {
  const d = soloDigitos(valor).slice(0, DOC_MAX);
  return d.length <= 8 ? d.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : d;
}

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
    NO_ENCONTRADO: [400],
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

// Banda de estado: el ícono va en una "insignia" con forma distinta por estado
// (no depender solo del color): cuadrado redondeado = verificar, círculo = OK,
// cuadrado de esquinas chicas + rayas = rechazo, triángulo = ya ingresó.
function IconoEstado({ forma }) {
  if (forma === 'ok') return <Check size={26} strokeWidth={2.6} aria-hidden="true" />;
  if (forma === 'verify') return <IdCard size={26} aria-hidden="true" />;
  if (forma === 'bad') return <X size={26} strokeWidth={2.6} aria-hidden="true" />;
  // warn / error: signo de exclamación
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true" focusable="false">
      <path d="M12 5v9M12 19v.5" />
    </svg>
  );
}

const SUB_ERROR = {
  verificar: 'Error de conexión · No se pudo verificar el QR',
  documento: 'Error de conexión · No se pudo buscar el DNI',
  confirmar: 'Error de conexión · El ingreso NO se registró',
  rechazar: 'Error de conexión · El rechazo no se guardó · No dejar pasar',
};

function configResultado({ estado, escaneado_at, escaneado_por_nombre, accion, origen, documento }) {
  const porDni = origen === 'dni';
  switch (estado) {
    case 'PENDIENTE':
      return { clase: 'res-verify', forma: 'verify', titulo: 'VERIFICÁ LA IDENTIDAD', sub: 'Compará la foto con la persona' };
    case 'OK':
      return {
        clase: 'res-ok',
        forma: 'ok',
        titulo: 'PUEDE PASAR',
        sub: `Ingreso registrado a las ${formatHora(escaneado_at || new Date().toISOString())}`,
      };
    case 'YA_INGRESO': {
      const partes = [escaneado_at && formatHora(escaneado_at), escaneado_por_nombre && `confirmado por ${escaneado_por_nombre}`];
      return {
        clase: 'res-warn',
        forma: 'warn',
        titulo: porDni ? 'YA INGRESÓ' : 'QR YA USADO',
        sub: partes.filter(Boolean).join(' · ') || null,
      };
    }
    case 'RECHAZADO':
      return { clase: 'res-bad', forma: 'bad', titulo: 'INGRESO RECHAZADO', sub: 'No dejar pasar · Derivar a RRHH' };
    case 'NO_ENCONTRADO':
      return {
        clase: 'res-bad',
        forma: 'bad',
        titulo: 'NO ESTÁ EN LA LISTA',
        sub: `Documento ${formatDocumento(documento)} no figura entre los invitados`,
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
      return { clase: 'res-bad', forma: 'bad', titulo: 'NO PASA', sub: porDni ? 'No se pudo validar el documento' : 'QR no válido' };
  }
}

/** Foto (cuadrado redondeado) + nombre + una lista de datos. */
function Persona({ empleado, chica = false, conSector = true, porDni = false }) {
  const [sinFoto, setSinFoto] = useState(!empleado?.foto_url);
  return (
    <>
      <div className="scan-photo-wrap">
        <Avatar
          nombre={empleado.nombre}
          src={empleado.foto_url}
          size={chica ? 132 : 200}
          className={`scan-photo${chica ? ' scan-photo-sm' : ''}`}
          eager
          onFallback={setSinFoto}
        />
        {sinFoto && <p className="scan-nofoto">SIN FOTO · Pedí el DNI</p>}
      </div>
      {porDni && (
        <p className="scan-tag-dni">
          <IdCard size={14} aria-hidden="true" />
          Ingresado por DNI · Pedí el documento
        </p>
      )}
      <p className="scan-name">{empleado.nombre}</p>
      <dl className="scan-data">
        <div>
          <dt>Documento</dt>
          <dd>{formatDocumento(empleado.documento)}</dd>
        </div>
        {empleado.empresa && (
          <div>
            <dt>Empresa</dt>
            <dd>{empleado.empresa}</dd>
          </div>
        )}
        {conSector && empleado.sector && (
          <div>
            <dt>Sector</dt>
            <dd>{empleado.sector}</dd>
          </div>
        )}
      </dl>
    </>
  );
}

const SpinnerBtn = () => <span className="spinner scan-btn-spinner" aria-hidden="true" />;

const OPCIONES_RECHAZO = [
  { id: 'foto', label: 'No coincide la foto' },
  { id: 'dni', label: 'No tiene DNI' },
  { id: 'otro', label: 'Otro motivo' },
];
const MOTIVO_MAX = 200;

/**
 * Hoja inferior (<dialog> nativo: foco atrapado, fondo inerte, Esc = Cancelar)
 * para elegir el motivo del rechazo. Mientras se envía no se puede cerrar.
 */
function MotivoSheet({ open, enviando, onCancelar, onRechazar }) {
  const ref = useRef(null);
  const titleId = useId();
  const subId = useId();
  const textoId = useId();
  const [opcion, setOpcion] = useState(null);
  const [texto, setTexto] = useState('');
  const ocupado = enviando === 'rechazar';

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      setOpcion(null);
      setTexto('');
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return undefined;
    const onCancel = (e) => {
      e.preventDefault();
      if (!ocupado) onCancelar();
    };
    dlg.addEventListener('cancel', onCancel);
    return () => dlg.removeEventListener('cancel', onCancel);
  }, [ocupado, onCancelar]);

  const enviar = (e) => {
    e.preventDefault();
    if (!opcion || ocupado) return;
    const motivo =
      opcion === 'otro' ? texto.trim().slice(0, MOTIVO_MAX) || 'Otro' : OPCIONES_RECHAZO.find((o) => o.id === opcion).label;
    onRechazar(motivo);
  };

  return (
    <dialog
      ref={ref}
      className="scan-sheet"
      aria-labelledby={titleId}
      aria-describedby={subId}
      onClick={(e) => {
        // toque en el fondo oscurecido = Cancelar
        if (e.target === ref.current && !ocupado) onCancelar();
      }}
    >
      {open && (
        <form className="scan-sheet-inner" onSubmit={enviar}>
          <span className="scan-sheet-grab" aria-hidden="true" />
          <h2 id={titleId} className="scan-sheet-title">
            ¿Por qué no pasa?
          </h2>
          <p id={subId} className="scan-sheet-sub">
            Elegí un motivo. Queda registrado para RRHH.
          </p>
          <fieldset className="scan-opts" aria-labelledby={titleId} disabled={ocupado}>
            {OPCIONES_RECHAZO.map((o) => (
              <label key={o.id} className="scan-opt">
                <input
                  type="radio"
                  name="scan-motivo"
                  value={o.id}
                  checked={opcion === o.id}
                  onChange={() => setOpcion(o.id)}
                />
                {o.label}
              </label>
            ))}
          </fieldset>
          {opcion === 'otro' && (
            <div className="scan-sheet-field">
              <label htmlFor={textoId}>Contá el motivo</label>
              <input
                id={textoId}
                type="text"
                maxLength={MOTIVO_MAX}
                autoComplete="off"
                enterKeyHint="send"
                value={texto}
                disabled={ocupado}
                onChange={(e) => setTexto(e.target.value)}
              />
            </div>
          )}
          <div className="scan-actions">
            <button type="button" className="btn scan-btn scan-btn-ghost" disabled={ocupado} onClick={onCancelar}>
              Cancelar
            </button>
            <button type="submit" className="btn scan-btn scan-btn-danger" disabled={!opcion || ocupado} aria-busy={ocupado}>
              {ocupado && <SpinnerBtn />}
              Rechazar ingreso
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

function ResultCard({ resultado, enviando, onNext, onConfirmar, onRechazar, onReintentar, onOtroDni, autoResume }) {
  const { estado, empleado, mensaje, origen, motivo } = resultado;
  const btnRef = useRef(null);
  const tituloRef = useRef(null);
  const noEsRef = useRef(null);
  const [motivoAbierto, setMotivoAbierto] = useState(false);
  useEffect(() => {
    // En PENDIENTE el foco va al título (no a "Confirmar": un Enter accidental no debe registrar).
    if (estado === 'PENDIENTE') tituloRef.current?.focus();
    else btnRef.current?.focus();
  }, [estado]);

  const cerrarMotivo = useCallback(() => {
    setMotivoAbierto(false);
    setTimeout(() => noEsRef.current?.focus(), 0);
  }, []);

  const config = configResultado(resultado);
  const reintentable =
    estado === 'ERROR' &&
    (resultado.accion === 'documento' ? Boolean(resultado.documento) : Boolean(resultado.token && resultado.accion));
  const noEncontrado = estado === 'NO_ENCONTRADO';
  const rechazado = estado === 'RECHAZADO';
  const doble = reintentable || noEncontrado;
  const ocupado = Boolean(enviando);

  return (
    <div className={`scan-result ${config.clase}`}>
      <div className="scan-band" role="alert" aria-live="assertive">
        <span className="scan-band-badge">
          <IconoEstado forma={config.forma} />
        </span>
        <div className="scan-band-texts">
          <h1 className="scan-result-title" ref={tituloRef} tabIndex={-1}>
            {config.titulo}
          </h1>
          {config.sub && <p className="scan-result-sub">{config.sub}</p>}
        </div>
      </div>

      <div className="scan-result-body">
        <div className="scan-result-inner">
          {rechazado && (
            <p className="scan-reason">
              <b>Motivo</b>
              {motivo || 'Sin motivo indicado'}
            </p>
          )}
          {empleado ? (
            <Persona
              empleado={empleado}
              chica={rechazado}
              conSector={!rechazado && estado !== 'YA_INGRESO'}
              porDni={origen === 'dni' && estado === 'PENDIENTE'}
            />
          ) : (
            <p className="scan-msg">
              {estado === 'ERROR'
                ? mensaje || 'No se pudo conectar con el servidor. Verificá la conexión.'
                : noEncontrado
                  ? 'Revisá que el número esté bien escrito. Si es correcto, derivá a la persona a RRHH.'
                  : origen === 'dni'
                    ? 'No se pudo validar este documento. Derivá a la persona a RRHH.'
                    : 'Este código no corresponde a ningún invitado. Pedile a la persona que muestre su QR correcto o derivala a RRHH.'}
            </p>
          )}
          {estado === 'YA_INGRESO' && <p className="scan-hint">No dejar pasar sin consultar con RRHH.</p>}
        </div>
      </div>

      {autoResume && (
        <div className="scan-countdown" aria-hidden="true">
          <i style={{ animationDuration: `${AUTO_RESUME_MS}ms` }} />
        </div>
      )}

      {estado === 'PENDIENTE' ? (
        <div className="scan-actions scan-actions-bar">
          <button
            type="button"
            className="btn scan-btn scan-btn-ok"
            disabled={ocupado}
            aria-busy={enviando === 'confirmar'}
            onClick={() => onConfirmar(resultado)}
          >
            {enviando === 'confirmar' ? <SpinnerBtn /> : <Check size={20} strokeWidth={2.6} aria-hidden="true" />}
            {enviando === 'confirmar' ? 'Registrando…' : 'Confirmar'}
          </button>
          <button
            ref={noEsRef}
            type="button"
            className="btn scan-btn scan-btn-no"
            disabled={ocupado}
            aria-haspopup="dialog"
            onClick={() => setMotivoAbierto(true)}
          >
            <X size={20} strokeWidth={2.6} aria-hidden="true" />
            No es la persona
          </button>
        </div>
      ) : (
        <div className={`scan-actions scan-actions-bar scan-actions-one${doble ? ' scan-actions-doble' : ''}`}>
          {noEncontrado && (
            <button ref={btnRef} type="button" className="btn scan-btn scan-btn-light" onClick={() => onOtroDni(resultado.documento)}>
              <IdCard size={20} aria-hidden="true" />
              Probar otro DNI
            </button>
          )}
          {reintentable && (
            <button
              ref={btnRef}
              type="button"
              className="btn scan-btn scan-btn-light"
              disabled={ocupado}
              aria-busy={ocupado}
              onClick={() => onReintentar(resultado)}
            >
              {ocupado ? <SpinnerBtn /> : <RotateCcw size={20} aria-hidden="true" />}
              Reintentar
            </button>
          )}
          <button
            ref={doble ? undefined : btnRef}
            type="button"
            className={`btn scan-btn ${doble ? 'scan-btn-ghost' : 'scan-btn-light'}`}
            disabled={ocupado}
            onClick={onNext}
          >
            <ScanLine size={20} aria-hidden="true" />
            {noEncontrado ? 'Volver a escanear' : 'Escanear siguiente'}
          </button>
        </div>
      )}

      {estado === 'PENDIENTE' && (
        <MotivoSheet
          open={motivoAbierto}
          enviando={enviando}
          onCancelar={cerrarMotivo}
          onRechazar={(m) => onRechazar(resultado, m)}
        />
      )}
    </div>
  );
}

// ---------- Ingreso manual por DNI ----------

/** Hoja inferior (Modal nativo) con un input numérico grande. Valida 5-12 dígitos antes de buscar. */
function DniSheet({ open, inicial, error: errorExterno, onBuscar, onCerrar }) {
  const [valor, setValor] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setValor(formatearDniEnCurso(inicial || ''));
    setError(errorExterno || '');
    // El <dialog> se abre en el efecto del Modal (después de este): enfocar en el próximo tick.
    const t = setTimeout(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    }, 0);
    return () => clearTimeout(t);
  }, [open, inicial, errorExterno]);

  const submit = (e) => {
    e.preventDefault();
    const doc = soloDigitos(valor);
    if (doc.length < DOC_MIN || doc.length > DOC_MAX) {
      setError(`Ingresá entre ${DOC_MIN} y ${DOC_MAX} dígitos.`);
      inputRef.current?.focus();
      return;
    }
    onBuscar(doc);
  };

  return (
    <Modal
      open={open}
      title="Ingresar DNI"
      size="sm"
      onClose={onCerrar}
      footer={
        <>
          <button type="button" className="btn btn-secondary btn-lg" onClick={onCerrar}>
            Cancelar
          </button>
          <button type="submit" form="scan-dni-form" className="btn btn-primary btn-lg">
            Buscar
          </button>
        </>
      }
    >
      <form id="scan-dni-form" className="field scan-dni-form" onSubmit={submit} noValidate>
        <label htmlFor="scan-dni-input">Número de documento</label>
        <input
          ref={inputRef}
          id="scan-dni-input"
          className="scan-dni-input"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          placeholder="30.123.456"
          maxLength={16}
          value={valor}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'scan-dni-error' : 'scan-dni-hint'}
          onChange={(e) => {
            setValor(formatearDniEnCurso(e.target.value));
            if (error) setError('');
          }}
        />
        {error ? (
          <p id="scan-dni-error" className="field-error scan-dni-msg" role="alert">
            {error}
          </p>
        ) : (
          <p id="scan-dni-hint" className="field-hint scan-dni-msg">
            Solo números; los puntos son opcionales. Usalo si la persona no tiene el QR.
          </p>
        )}
      </form>
    </Modal>
  );
}

// ---------- Página ----------

export default function Scanner() {
  useTheme('scanner');
  useDocumentTitle('Escáner - Evento de fin de año');
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
  // Ingreso manual por DNI: hoja abierta, valor precargado (corrección) y error del servidor.
  const [dni, setDni] = useState({ abierto: false, inicial: '', error: '' });
  const dniBtnRef = useRef(null);

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
    ({ token, empleado, origen }) =>
      ejecutar('confirmar', async () => {
        try {
          const r = await api.post('/scan/confirmar', { token });
          if (r.estado === 'OK') setContador((c) => ({ ...c, confirmados: c.confirmados + 1 }));
          // Si el token dejó de existir (empleado borrado) llega INVALIDO sin datos.
          mostrar({ ...r, token, origen });
        } catch (err) {
          if (err.status === 401) return;
          if (err.status === 400) {
            mostrar({ estado: 'INVALIDO', empleado: null, escaneado_at: null, origen });
            return;
          }
          // Se conserva el token: "Reintentar" confirma sin volver a escanear.
          mostrar({ estado: 'ERROR', empleado, token, origen, accion: 'confirmar', mensaje: err.message });
        }
      }),
    [ejecutar, mostrar],
  );

  /** Paso 2b: "No es la persona" => auditoría del rechazo; NO registra el ingreso. */
  const rechazar = useCallback(
    ({ token, empleado, origen }, motivo) =>
      ejecutar('rechazar', async () => {
        try {
          await api.post('/scan/rechazar', motivo ? { token, motivo } : { token });
          setContador((c) => ({ ...c, rechazados: c.rechazados + 1 }));
          mostrar({ estado: 'RECHAZADO', empleado, token, motivo, origen });
        } catch (err) {
          if (err.status === 401) return;
          if (err.status === 404) {
            mostrar({ estado: 'INVALIDO', empleado: null, escaneado_at: null, origen });
            return;
          }
          mostrar({ estado: 'ERROR', empleado, token, motivo, origen, accion: 'rechazar', mensaje: err.message });
        }
      }),
    [ejecutar, mostrar],
  );

  /** Pausa la cámara (un QR a la vista no debe dispararse) y abre la hoja del DNI. */
  const abrirDni = useCallback((inicial = '', error = '') => {
    clearTimeout(resumeTimer.current);
    busyRef.current = true;
    try {
      const qr = qrRef.current;
      if (qr && qr.getState() === Html5QrcodeScannerState.SCANNING) qr.pause(true);
    } catch {
      /* ignorar */
    }
    setResultado(null);
    setDni({ abierto: true, inicial, error });
  }, []);

  /** Cancelar / Esc: vuelve a escanear y devuelve el foco al botón "Ingresar DNI". */
  const cerrarDni = useCallback(() => {
    setDni((d) => ({ ...d, abierto: false }));
    reanudar();
    setTimeout(() => dniBtnRef.current?.focus(), 0);
  }, [reanudar]);

  /** Busca por DNI y reusa el mismo flujo de resultado que un QR (PENDIENTE -> confirmar/rechazar). */
  const buscarDni = useCallback(
    async (documento) => {
      setDni((d) => ({ ...d, abierto: false }));
      busyRef.current = true;
      setProcesando(true);
      let res;
      try {
        const r = await api.post('/scan/documento', { documento });
        res =
          r.estado === 'NO_ENCONTRADO'
            ? { estado: 'NO_ENCONTRADO', empleado: null, documento, origen: 'dni' }
            : { ...r, token: r.token ?? null, documento, origen: 'dni' };
      } catch (err) {
        if (err.status === 401) return; // el AuthContext redirige al login
        if (err.status === 400) {
          // Formato rechazado por el servidor: volver a la hoja para corregir.
          setDni({ abierto: true, inicial: documento, error: err.message || 'Documento inválido' });
          return;
        }
        res = { estado: 'ERROR', empleado: null, documento, origen: 'dni', accion: 'documento', mensaje: err.message };
      } finally {
        setProcesando(false);
      }
      mostrar(res);
    },
    [mostrar],
  );

  const reintentar = useCallback(
    (res) => {
      if (res.accion === 'documento') {
        setResultado(null);
        buscarDni(res.documento);
        return;
      }
      if (res.accion === 'confirmar') confirmar(res);
      else if (res.accion === 'rechazar') rechazar(res, res.motivo);
      else if (res.accion === 'verificar') {
        lastRef.current = { token: res.token, at: Date.now() };
        setResultado(null);
        verificar(res.token);
      }
    },
    [confirmar, rechazar, verificar, buscarDni],
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

        {camEstado !== 'error' && !resultado && !procesando && (
          <div className="scanner-bottom">
            {camEstado === 'activa' && (
              <p className="scanner-hint" role="status">
                Apuntá la cámara al código QR
              </p>
            )}
            <button
              ref={dniBtnRef}
              type="button"
              className="btn scanner-dni-btn"
              aria-haspopup="dialog"
              onClick={() => abrirDni()}
            >
              <IdCard size={22} aria-hidden="true" />
              Ingresar DNI
            </button>
          </div>
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
            <p className="scanner-error-alt">Podés seguir validando invitados con el número de documento.</p>
            <div className="scanner-error-actions">
              <button
                ref={dniBtnRef}
                type="button"
                className="btn btn-primary btn-lg scanner-error-dni"
                aria-haspopup="dialog"
                onClick={() => abrirDni()}
              >
                <IdCard size={22} aria-hidden="true" />
                Ingresar DNI
              </button>
              <button type="button" className="btn btn-secondary btn-lg" onClick={reintentarCamara}>
                <RotateCcw size={18} aria-hidden="true" />
                Reintentar cámara
              </button>
            </div>
          </div>
        )}

        {resultado && (
          <ResultCard
            key={`${resultado.estado}-${resultado.token ?? resultado.documento ?? ''}`}
            resultado={resultado}
            enviando={enviando}
            onNext={reanudar}
            onConfirmar={confirmar}
            onRechazar={rechazar}
            onReintentar={reintentar}
            onOtroDni={(doc) => abrirDni(doc)}
            autoResume={resultado.estado === 'OK'}
          />
        )}
      </main>

      <DniSheet open={dni.abierto} inicial={dni.inicial} error={dni.error} onBuscar={buscarDni} onCerrar={cerrarDni} />
    </div>
  );
}
