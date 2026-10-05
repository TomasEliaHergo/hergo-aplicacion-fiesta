import { formatNumero } from '../utils.js';

export default function Pagination({ page, pageSize, total, onChange }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const desde = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const hasta = Math.min(total, page * pageSize);

  return (
    <nav className="pagination" aria-label="Paginación">
      <span className="muted">
        {formatNumero(desde)}–{formatNumero(hasta)} de {formatNumero(total)}
      </span>
      <div className="pagination-buttons">
        <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          ‹ Anterior
        </button>
        <span aria-current="page">
          Página {page} de {pages}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          Siguiente ›
        </button>
      </div>
    </nav>
  );
}
