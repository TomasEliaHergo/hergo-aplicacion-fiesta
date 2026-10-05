import { useEffect, useState } from 'react';
import { api } from '../../api.js';
import Modal from '../../components/Modal.jsx';
import { Alert, Spinner } from '../../components/Feedback.jsx';
import { erroresPorCampo, soloDigitos } from '../../utils.js';

const VACIO = { documento: '', nombre: '', empresa: '', sector: '' };

/** Alta / edición de empleado. `empleado` null => alta. */
export default function EmpleadoForm({ open, empleado, filtros, onClose, onSaved }) {
  const [form, setForm] = useState(VACIO);
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      empleado
        ? {
            documento: empleado.documento || '',
            nombre: empleado.nombre || '',
            empresa: empleado.empresa || '',
            sector: empleado.sector || '',
          }
        : VACIO,
    );
    setErrores({});
    setErrorGeneral('');
  }, [open, empleado]);

  const set = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));

  const onSubmit = async (e) => {
    e.preventDefault();
    const doc = soloDigitos(form.documento);
    const errs = {};
    if (doc.length < 5 || doc.length > 12) errs.documento = 'Debe tener entre 5 y 12 dígitos.';
    if (!form.nombre.trim()) errs.nombre = 'El nombre es obligatorio.';
    setErrores(errs);
    setErrorGeneral('');
    if (Object.keys(errs).length) return;

    const body = { documento: doc, nombre: form.nombre.trim().replace(/\s+/g, ' ') };
    // Alta: los opcionales vacíos se omiten. Edición: vacío => null para poder borrarlos.
    for (const k of ['empresa', 'sector']) {
      const v = form[k].trim().replace(/\s+/g, ' ');
      if (v) body[k] = v;
      else if (empleado) body[k] = null;
    }

    setGuardando(true);
    try {
      const saved = empleado ? await api.put(`/empleados/${empleado.id}`, body) : await api.post('/empleados', body);
      onSaved(saved, !empleado);
    } catch (err) {
      if (err.status === 409) {
        setErrores({ documento: 'Ya existe un empleado con ese documento.' });
      } else if (err.status === 400 && err.detalles.length) {
        setErrores(erroresPorCampo(err));
        setErrorGeneral(err.message);
      } else {
        setErrorGeneral(err.message);
      }
    } finally {
      setGuardando(false);
    }
  };

  const campo = (id, label, props = {}) => (
    <div className="field">
      <label htmlFor={`emp-${id}`}>{label}</label>
      <input
        id={`emp-${id}`}
        value={form[id]}
        onChange={set(id)}
        aria-invalid={errores[id] ? 'true' : undefined}
        aria-describedby={errores[id] ? `emp-${id}-err` : undefined}
        {...props}
      />
      {errores[id] && (
        <small id={`emp-${id}-err`} className="field-error">
          {errores[id]}
        </small>
      )}
    </div>
  );

  return (
    <Modal open={open} title={empleado ? 'Editar empleado' : 'Nuevo empleado'} onClose={onClose}>
      <form onSubmit={onSubmit} noValidate id="empleado-form">
        {campo('documento', 'Documento *', { inputMode: 'numeric', autoComplete: 'off', autoFocus: true })}
        {campo('nombre', 'Nombre y apellido *', { autoComplete: 'off' })}
        {campo('empresa', 'Empresa', { list: 'emp-empresas', autoComplete: 'off' })}
        {campo('sector', 'Sector', { list: 'emp-sectores', autoComplete: 'off' })}
        <datalist id="emp-empresas">
          {filtros.empresas.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
        <datalist id="emp-sectores">
          {filtros.sectores.map((x) => (
            <option key={x} value={x} />
          ))}
        </datalist>
        {empleado && (
          <p className="muted small">Cambiar los datos no cambia el QR: el código ya entregado sigue sirviendo.</p>
        )}
        <Alert>{errorGeneral}</Alert>
        <div className="modal-footer inline">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={guardando}>
            {guardando ? <Spinner label="Guardando…" /> : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
