import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';

interface UploadControlProps {
  onFile: (file: File) => void;
  fileName: string | null;
  errorMessage: string | null;
}

export function UploadControl({ onFile, fileName, errorMessage }: UploadControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onFile(file);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  return (
    <div>
      <p className="rail-section-label">Upload</p>
      <div
        className={`upload-dropzone${isDragging ? ' is-dragging' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <div className="upload-dropzone-label">
          <strong>Choose a photo</strong>
          <br />
          or drag it here
        </div>
        <input
          ref={inputRef}
          className="upload-input"
          type="file"
          accept="image/*"
          onChange={handleChange}
        />
      </div>
      {fileName && <div className="upload-filename">{fileName}</div>}
      {errorMessage && <div className="upload-error">{errorMessage}</div>}
    </div>
  );
}
