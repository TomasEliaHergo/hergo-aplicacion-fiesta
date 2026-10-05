// Cliente HTTP para /api.
// - Agrega "Authorization: Bearer <jwt>" desde localStorage (persiste aunque iOS
//   descarte la pestaña, para que el personal de la puerta no pierda la sesión).
// - Ante 401 con sesión activa: limpia la sesión y avisa al AuthContext (redirige a /login).
// - Parsea el error estándar { error, mensaje, detalles } en un ApiError.

const TOKEN_KEY = 'fiesta.token';
const USER_KEY = 'fiesta.usuario';

const MENSAJES_POR_CODIGO = {
  RED: 'No se pudo conectar con el servidor. Revisá tu conexión e intentá de nuevo.',
  VALIDACION: 'Hay datos inválidos. Revisá el formulario.',
  NO_AUTENTICADO: 'Tu sesión expiró. Volvé a ingresar.',
  CREDENCIALES_INVALIDAS: 'Usuario o contraseña incorrectos.',
  SIN_PERMISO: 'No tenés permiso para realizar esta acción.',
  NO_ENCONTRADO: 'No se encontró el recurso solicitado.',
  DUPLICADO: 'Ya existe un registro con esos datos.',
  ARCHIVO_MUY_GRANDE: 'El archivo es demasiado grande.',
  TIPO_NO_SOPORTADO: 'Tipo de archivo no soportado.',
  DEMASIADAS_SOLICITUDES: 'Demasiados intentos. Esperá un minuto y volvé a probar.',
  ULTIMO_RRHH: 'No se puede desactivar ni cambiar el rol del último usuario de RRHH activo.',
  OPERACION_SOBRE_SI_MISMO: 'No podés desactivarte ni cambiar tu propio rol.',
  COLUMNAS_FALTANTES: 'Al archivo le faltan columnas obligatorias (nombre y documento).',
  ERROR_INTERNO: 'Ocurrió un error en el servidor. Intentá de nuevo en unos segundos.',
};

const CODIGO_POR_STATUS = {
  400: 'VALIDACION',
  401: 'NO_AUTENTICADO',
  403: 'SIN_PERMISO',
  404: 'NO_ENCONTRADO',
  409: 'DUPLICADO',
  413: 'ARCHIVO_MUY_GRANDE',
  415: 'TIPO_NO_SOPORTADO',
  429: 'DEMASIADAS_SOLICITUDES',
};

export class ApiError extends Error {
  constructor(status, codigo, mensaje, detalles) {
    super(mensaje);
    this.name = 'ApiError';
    this.status = status;
    this.codigo = codigo;
    this.detalles = Array.isArray(detalles) ? detalles : [];
  }
}

// ---------- Sesión ----------

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(token, usuario) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(usuario));
}

export function updateStoredUser(usuario) {
  localStorage.setItem(USER_KEY, JSON.stringify(usuario));
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    // Limpieza de sesiones guardadas por versiones anteriores (sessionStorage).
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  } catch {
    /* sin acceso a storage */
  }
}

let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

// ---------- Request ----------

function buildQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.append(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

async function parseError(res) {
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* respuesta sin JSON */
  }
  const codigo = data?.error || CODIGO_POR_STATUS[res.status] || 'ERROR_INTERNO';
  const mensaje = data?.mensaje || MENSAJES_POR_CODIGO[codigo] || 'Ocurrió un error inesperado.';
  return new ApiError(res.status, codigo, mensaje, data?.detalles);
}

async function request(path, { method = 'GET', body, query, signal, raw = false } = {}) {
  const headers = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let payload;
  if (body instanceof FormData) {
    payload = body; // el navegador pone el boundary del multipart
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`/api${path}${buildQuery(query)}`, { method, headers, body: payload, signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, 'RED', MENSAJES_POR_CODIGO.RED);
  }

  if (res.status === 401 && token) {
    clearSession();
    if (unauthorizedHandler) unauthorizedHandler();
  }

  if (!res.ok) throw await parseError(res);
  if (raw) return res;
  if (res.status === 204) return null;

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

function filenameFromDisposition(header) {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* ignorar */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const api = {
  get: (path, query, opts) => request(path, { ...opts, query }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
  upload: (path, formData, opts) => request(path, { ...opts, method: 'POST', body: formData }),
  /** Descarga un archivo autenticado (no se puede usar un <a href> porque requiere el Bearer). */
  async download(path, query, fallbackName = 'archivo') {
    const res = await request(path, { query, raw: true });
    const blob = await res.blob();
    const name = filenameFromDisposition(res.headers.get('content-disposition')) || fallbackName;
    downloadBlob(blob, name);
  },
};

// Nombre del campo multipart para la carga masiva de fotos.
// El contrato dice "multipart `fotos[]`"; se asume multer `upload.array('fotos')`.
export const CAMPO_FOTOS_BULK = 'fotos';
