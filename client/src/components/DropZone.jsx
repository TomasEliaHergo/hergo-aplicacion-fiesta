import { useId, useRef, useState } from 'react';
import { CloudUpload } from 'lucide-react';

/** Zona grande de arrastrar y soltar, con input file accesible por teclado. */
export default function DropZone({ accept, multiple = false, onFiles, disabled, title, hint, compact = false }) {
  const inputRef = useRef(null);
  const id = useId();
  const [over, setOver] = useState(false);

  const handle = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length) onFiles(multiple ? files : [files[0]]);
  };

  return (
    <div
      className={`dropzone ${over ? 'is-over' : ''} ${disabled ? 'is-disabled' : ''} ${compact ? 'is-compact' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) handle(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        id={id}
        type="file"
        className="sr-only"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          handle(e.target.files);
          e.target.value = '';
        }}
      />
      <span className="dropzone-icon" aria-hidden="true">
        <CloudUpload size={26} />
      </span>
      <p className="dropzone-title">{title}</p>
      {hint && <p className="dropzone-hint">{hint}</p>}
      <label htmlFor={id} className={`btn btn-secondary ${disabled ? 'is-disabled' : ''}`}>
        {multiple ? 'Elegir archivos' : 'Elegir archivo'}
      </label>
    </div>
  );
}
