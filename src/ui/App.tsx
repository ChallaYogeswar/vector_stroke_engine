import { useRef } from 'react';
import { UploadControl } from './UploadControl';
import { ModeSwitcher } from './ModeSwitcher';
import { ExportControl } from './ExportControl';
import { SettingsPanel } from './SettingsPanel';
import { Telemetry } from './Telemetry';
import { useEngine } from './useEngine';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const {
    activeMode,
    status,
    errorMessage,
    imageSummary,
    currentOutput,
    controls,
    updateControls,
    resetView,
    switchMode,
    loadFile,
  } = useEngine(canvasRef);

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">
          Vector <span className="app-title-accent">Stroke</span> Engine
        </h1>
        <p className="app-subtitle">Photo &rarr; 5 render engines &middot; client-side</p>
      </header>

      <div className="app-body">
        <aside className="control-rail">
          <UploadControl onFile={loadFile} fileName={imageSummary?.fileName ?? null} errorMessage={errorMessage} />
          <ModeSwitcher activeMode={activeMode} onSelect={switchMode} />
          <SettingsPanel
            activeMode={activeMode}
            controls={controls}
            onUpdateControls={updateControls}
            onResetView={resetView}
            currentOutput={currentOutput}
          />
          <ExportControl
            canvasRef={canvasRef}
            activeMode={activeMode}
            output={currentOutput}
            fileName={imageSummary?.fileName ?? null}
          />
        </aside>

        <main className="stage-wrap">
          <div className="stage-readout">
            <span>{imageSummary ? `${imageSummary.width} × ${imageSummary.height}` : 'Awaiting upload'}</span>
            <span className={status === 'ready' ? 'status-ready' : status === 'error' ? 'status-error' : ''}>
              {statusLabel(status)}
            </span>
          </div>

          <div className="stage-frame">
            <canvas ref={canvasRef} />
            <span className="stage-bracket stage-bracket--tl" />
            <span className="stage-bracket stage-bracket--tr" />
            <span className="stage-bracket stage-bracket--bl" />
            <span className="stage-bracket stage-bracket--br" />
            {imageSummary && activeMode === '3d' && (
              <div className="stage-hint">Drag to rotate · Scroll to zoom · Double-click to reset</div>
            )}
            {!imageSummary && (
              <div className="stage-empty">
                Upload a photo to run it through the {activeMode.toUpperCase()} engine
              </div>
            )}
          </div>
        </main>
      </div>

      <Telemetry activeMode={activeMode} imageSummary={imageSummary} />
    </div>
  );
}

function statusLabel(status: 'idle' | 'loading' | 'ready' | 'error'): string {
  switch (status) {
    case 'idle':
      return 'Idle';
    case 'loading':
      return 'Processing\u2026';
    case 'ready':
      return 'Ready';
    case 'error':
      return 'Error';
  }
}
