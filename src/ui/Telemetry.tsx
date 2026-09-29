import type { ModeId } from '../engine/types';
import type { ImageSummary } from './useEngine';

interface TelemetryProps {
  activeMode: ModeId;
  imageSummary: ImageSummary | null;
}

export function Telemetry({ activeMode, imageSummary }: TelemetryProps) {
  return (
    <div className="telemetry">
      <span className="telemetry-item">
        <strong>Mode</strong>
        {activeMode}
      </span>
      {imageSummary ? (
        <>
          <span className="telemetry-item">
            <strong>Dimensions</strong>
            {imageSummary.width} × {imageSummary.height}
          </span>
          <span className="telemetry-item">
            <strong>File</strong>
            {imageSummary.fileName} ({imageSummary.fileSizeKB} KB)
          </span>
        </>
      ) : (
        <span className="telemetry-item">No image loaded</span>
      )}
    </div>
  );
}
