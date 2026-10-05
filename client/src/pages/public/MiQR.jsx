import { useEffect, useRef, useState } from 'react';
import { api } from '../../api.js';
import QrCard from '../../components/QrCard.jsx';
import { Alert, Spinner } from '../../components/Feedback.jsx';
import { soloDigitos } from '../../utils.js';

export default function MiQR() {
  const [documento, setDocumento] = useState('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null); // { tipo, mensaje }
  const [resultado, setResultado] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    document.title = 'Mi QR - Fiesta de fin de año';
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
      setResultado(data);
    } catch (err) {
      if (err.status === 404) {
        setError({
          tipo: 'warning',
          mensaje:
            'No encontramos ese documento en la lista de invitados. Revisá que esté bien escrito; si es correcto, consultá con RRHH.',
        });
      } else if (err.status === 429) {
        setError({
          tipo: 'error',
          mensaje: 'Hiciste demasiadas consultas seguidas. Esperá un minuto y volvé a intentar.',
        });
      } else if (err.status === 400) {
        setError({ tipo: 'error', mensaje: 'El documento ingresado no es válido. Revisalo e intentá de nuevo.' });
      } else {
        setError({ tipo: 'error', mensaje: err.message });
      }
    } finally {
      setCargando(false);
    }
  };

  const volver = () => {
    setResultado(null);
    setDocumento('');
    setError(null);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div className="public-page">
      <div className="confetti" aria-hidden="true" />
      <main className="public-main">
        <header className="public-header">
          <p className="eyebrow">Te esperamos</p>
          <h1>Fiesta de fin de año</h1>
        </header>

        <section className="card public-card" aria-live="polite">
          {resultado ? (
            <div className="public-result">
              <h2 className="greeting">¡Hola {resultado.nombre}!</h2>
              <p className="muted center">Este es tu código de ingreso.</p>
              <QrCard value={resultado.qr_token} nombre={resultado.nombre} empresa={resultado.empresa} />
              <div className="instructions">
                <strong>¿Cómo lo uso?</strong>
                <p>
                  Sacale una captura de pantalla ahora. En la entrada, subí el brillo del celular al máximo y mostrá el
                  código.
                </p>
                <p className="instructions-note">
                  <small>Es personal: no lo compartas, sirve para un solo ingreso.</small>
                </p>
              </div>
              <button type="button" className="btn btn-link" onClick={volver}>
                Consultar otro documento
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} noValidate>
              <h2>Obtené tu QR de ingreso</h2>
              <p className="muted">Ingresá tu número de documento para ver y descargar tu código.</p>
              <div className="field">
                <label htmlFor="documento">Número de documento</label>
                <input
                  ref={inputRef}
                  id="documento"
                  name="documento"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Ej: 30.123.456"
                  maxLength={20}
                  value={documento}
                  onChange={(e) => setDocumento(e.target.value.replace(/[^\d.\s-]/g, ''))}
                  aria-describedby={error ? 'documento-ayuda documento-error' : 'documento-ayuda'}
                  aria-invalid={error ? 'true' : undefined}
                  className="input-lg"
                  autoFocus
                />
                <small id="documento-ayuda" className="muted">
                  Podés escribirlo con o sin puntos.
                </small>
              </div>
              <Alert id="documento-error" tipo={error?.tipo}>
                {error?.mensaje}
              </Alert>
              <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={cargando}>
                {cargando ? <Spinner label="Buscando…" /> : 'Ver mi QR'}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
