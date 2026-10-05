import { useId, useRef, useState } from 'react';

/** Zona de arrastrar y soltar archivos, con input file accesible por teclado. */
export default function DropZone({ accept, multiple = false, onFiles, disabled, children }) {
  const inputRef = useRef(null);
  const id = useId();
  const [over, setOver] = useState(false);

  const handle = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length) onFiles(multiple ? files : [files[0]]);
  };

  return (
    <div
      className={`dropzone ${over ? 'is-over' : ''} ${disabled ? 'is-disabled' : ''}`}
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
      <div className="dropzone-content">
        <span className="dropzone-icon" aria-hidden="true">⇪</span>
        <div>{children}</div>
        <label htmlFor={id} className={`btn btn-secondary ${disabled ? 'is-disabled' : ''}`}>
          {multiple ? 'Elegir archivos' : 'Elegir archivo'}
        </label>
      </div>
    </div>
  );
}
