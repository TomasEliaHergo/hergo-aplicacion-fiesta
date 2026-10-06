import { useEffect, useRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { Download } from 'lucide-react';
import { downloadBlob } from '../api.js';
import { slug } from '../utils.js';

const QR_PX = 640; // resolución interna del canvas (se muestra escalado por CSS)

function fitFont(ctx, text, maxWidth, startPx, weight = '700') {
  let px = startPx;
  do {
    ctx.font = `${weight} ${px}px "Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    if (ctx.measureText(text).width <= maxWidth) break;
    px -= 2;
  } while (px > 14);
  return px;
}

/** Genera un PNG con título, QR, nombre y empresa. */
function generarPng(qrCanvas, nombre, empresa) {
  const W = 800;
  const pad = 60;
  const qrSize = W - pad * 2;
  const H = 120 + qrSize + (empresa ? 190 : 150);

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  // Franja superior
  ctx.fillStyle = '#0a0f1f';
  ctx.fillRect(0, 0, W, 90);
  ctx.fillStyle = '#f2c14e';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitFont(ctx, 'Fiesta de fin de año', W - 2 * pad, 40);
  ctx.fillText('Fiesta de fin de año', W / 2, 46);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qrCanvas, pad, 120, qrSize, qrSize);

  ctx.fillStyle = '#111827';
  const yNombre = 120 + qrSize + 60;
  fitFont(ctx, nombre, W - 2 * pad, 48);
  ctx.fillText(nombre, W / 2, yNombre);

  if (empresa) {
    ctx.fillStyle = '#4b5563';
    fitFont(ctx, empresa, W - 2 * pad, 32, '500');
    ctx.fillText(empresa, W / 2, yNombre + 52);
  }

  ctx.fillStyle = '#6b7280';
  fitFont(ctx, 'Presentá este código en la entrada', W - 2 * pad, 26, '400');
  ctx.fillText('Presentá este código en la entrada', W / 2, H - 40);

  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

/** Comparte el PNG (hoja de compartir en móviles: "Guardar imagen") o lo descarga. */
async function guardarPng(blob, filename) {
  let file = null;
  try {
    file = new File([blob], filename, { type: 'image/png' });
  } catch {
    /* File no soportado */
  }
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Mi QR - Fiesta de fin de año' });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return; // el usuario canceló
      /* otro error (p. ej. sin gesto del usuario): se descarga */
    }
  }
  downloadBlob(blob, filename);
}

/**
 * QR de ingreso en tarjeta blanca (alto contraste + zona de silencio) y botón para guardarlo.
 * `showMeta`: muestra nombre/empresa debajo (en la página pública ya están en el encabezado).
 */
export default function QrCard({
  value,
  nombre,
  empresa,
  showMeta = true,
  buttonLabel = 'Descargar QR',
  buttonClassName = 'btn btn-primary btn-block',
  className = '',
}) {
  const wrapRef = useRef(null);
  const pngRef = useRef(null); // Promise<Blob> generado por adelantado

  // Se genera el PNG al montar para que navigator.share se llame dentro del gesto
  // del usuario (Safari lo exige y rechaza llamadas tras trabajo asincrónico largo).
  useEffect(() => {
    const canvas = wrapRef.current?.querySelector('canvas');
    pngRef.current = canvas ? generarPng(canvas, nombre, empresa) : null;
  }, [value, nombre, empresa]);

  const onDownload = async () => {
    const canvas = wrapRef.current?.querySelector('canvas');
    if (!pngRef.current && canvas) pngRef.current = generarPng(canvas, nombre, empresa);
    const blob = await pngRef.current;
    if (blob) await guardarPng(blob, `qr-${slug(nombre)}.png`);
  };

  return (
    <div className={`qr-card ${className}`}>
      <div className="qr-frame" ref={wrapRef}>
        <QRCodeCanvas
          value={value}
          size={QR_PX}
          level="M"
          marginSize={2}
          bgColor="#ffffff"
          fgColor="#000000"
          style={{ width: '100%', height: 'auto' }}
          role="img"
          aria-label={`Código QR de ingreso de ${nombre}`}
        />
        {showMeta && (
          <div className="qr-meta">
            <p className="qr-name">{nombre}</p>
            {empresa && <p className="qr-company">{empresa}</p>}
          </div>
        )}
      </div>
      <button type="button" className={buttonClassName} onClick={onDownload}>
        <Download size={18} aria-hidden="true" />
        {buttonLabel}
      </button>
    </div>
  );
}
