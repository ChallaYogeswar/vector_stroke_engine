import { useState } from 'react';
import type { ModeId, RenderPayload, StrokeData } from '../engine/types';
import { CONTROLS_RANGES, type ControlsState } from './useEngine';

// ---------------------------------------------------------------------------
// docs/controls-spec.md section 3.3 — resolved as a collapsed-by-default drawer
// (keeps the control-rail's existing minimal read; one click to reach the
// controls) with per-mode contextual sections inside it (only the active
// mode's sliders are shown, rather than one panel listing every mode's
// options at once — Cleanup is the one section that's mode-independent, so
// it's always shown regardless of which mode is active).
// ---------------------------------------------------------------------------

interface SettingsPanelProps {
  activeMode: ModeId;
  controls: ControlsState;
  onUpdateControls: (partial: Partial<ControlsState>) => void;
  isOrbitPlaying: boolean;
  onToggleOrbit: () => void;
  /** Only used to read the ASCII mode's *actual* current column count when asciiTargetCols is still null (auto) — see ModeControls' ascii case. */
  currentOutput: StrokeData | RenderPayload | null;
}

export function SettingsPanel({
  activeMode,
  controls,
  onUpdateControls,
  isOrbitPlaying,
  onToggleOrbit,
  currentOutput,
}: SettingsPanelProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="settings-panel">
      <button
        type="button"
        className="settings-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span>Settings</span>
        <span className="settings-toggle-chevron" aria-hidden="true">
          {expanded ? '\u2212' : '+'}
        </span>
      </button>

      {expanded && (
        <div className="settings-body">
          <section className="settings-section">
            <p className="rail-section-label">Cleanup</p>
            <ToggleRow
              label="Denoise"
              checked={controls.denoiseEnabled}
              onChange={(checked) => onUpdateControls({ denoiseEnabled: checked })}
            />
            <ToggleRow
              label="Spot removal"
              checked={controls.spotRemovalEnabled}
              onChange={(checked) => onUpdateControls({ spotRemovalEnabled: checked })}
            />
            <ToggleRow
              label="Sharpen"
              checked={controls.sharpenEnabled}
              onChange={(checked) => onUpdateControls({ sharpenEnabled: checked })}
            />
            <SliderRow
              label="Sharpen amount"
              value={controls.sharpenAmount}
              min={CONTROLS_RANGES.sharpenAmount.min}
              max={CONTROLS_RANGES.sharpenAmount.max}
              step={0.05}
              disabled={!controls.sharpenEnabled}
              format={(v) => v.toFixed(2)}
              onChange={(v) => onUpdateControls({ sharpenAmount: v })}
            />
          </section>

          <section className="settings-section">
            <p className="rail-section-label">{modeLabel(activeMode)}</p>
            <ModeControls
              activeMode={activeMode}
              controls={controls}
              onUpdateControls={onUpdateControls}
              currentOutput={currentOutput}
            />
            {activeMode === '3d' && (
              <button type="button" className="export-button export-button--secondary settings-orbit-button" onClick={onToggleOrbit}>
                {isOrbitPlaying ? 'Pause orbit' : 'Resume orbit'}
              </button>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ModeControls({
  activeMode,
  controls,
  onUpdateControls,
  currentOutput,
}: {
  activeMode: ModeId;
  controls: ControlsState;
  onUpdateControls: (partial: Partial<ControlsState>) => void;
  currentOutput: StrokeData | RenderPayload | null;
}) {
  switch (activeMode) {
    case '2d':
      return (
        <SliderRow
          label="Posterize levels"
          value={controls.posterizeLevels}
          min={CONTROLS_RANGES.posterizeLevels.min}
          max={CONTROLS_RANGES.posterizeLevels.max}
          step={1}
          format={(v) => String(Math.round(v))}
          onChange={(v) => onUpdateControls({ posterizeLevels: Math.round(v) })}
        />
      );
    case 'sketch':
      return (
        <>
          <SliderRow
            label="Edge sensitivity"
            value={controls.edgePercentile}
            min={CONTROLS_RANGES.edgePercentile.min}
            max={CONTROLS_RANGES.edgePercentile.max}
            step={0.01}
            format={(v) => v.toFixed(2)}
            onChange={(v) => onUpdateControls({ edgePercentile: v })}
          />
          <SliderRow
            label="Point budget"
            value={controls.pointBudget}
            min={CONTROLS_RANGES.pointBudget.min}
            max={CONTROLS_RANGES.pointBudget.max}
            step={100}
            format={(v) => String(Math.round(v))}
            onChange={(v) => onUpdateControls({ pointBudget: Math.round(v) })}
          />
          <SliderRow
            label="Stroke thickness"
            value={controls.strokeWidth}
            min={CONTROLS_RANGES.strokeWidth.min}
            max={CONTROLS_RANGES.strokeWidth.max}
            step={0.1}
            format={(v) => v.toFixed(1)}
            onChange={(v) => onUpdateControls({ strokeWidth: v })}
          />
        </>
      );
    case 'ascii': {
      const autoCols =
        currentOutput && 'kind' in currentOutput && currentOutput.kind === 'ascii'
          ? currentOutput.cols
          : CONTROLS_RANGES.asciiTargetCols.max;
      return (
        <SliderRow
          label="Density (columns)"
          value={controls.asciiTargetCols ?? autoCols}
          min={CONTROLS_RANGES.asciiTargetCols.min}
          max={CONTROLS_RANGES.asciiTargetCols.max}
          step={1}
          format={(v) => String(Math.round(v))}
          onChange={(v) => onUpdateControls({ asciiTargetCols: Math.round(v) })}
        />
      );
    }
    case '3d':
      return (
        <SliderRow
          label="Relief height"
          value={controls.reliefMultiplier}
          min={CONTROLS_RANGES.reliefMultiplier.min}
          max={CONTROLS_RANGES.reliefMultiplier.max}
          step={0.05}
          format={(v) => `${v.toFixed(2)}\u00d7`}
          onChange={(v) => onUpdateControls({ reliefMultiplier: v })}
        />
      );
    case 'histogram':
      return <p className="settings-empty-note">Histogram has no adjustable settings — it's a direct readout of the cleaned pixel data.</p>;
  }
}

function modeLabel(id: ModeId): string {
  switch (id) {
    case '2d':
      return '2D';
    case 'sketch':
      return 'Sketch';
    case 'histogram':
      return 'Histogram';
    case 'ascii':
      return 'ASCII';
    case '3d':
      return '3D';
  }
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="settings-toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className={`settings-slider-row${disabled ? ' is-disabled' : ''}`}>
      <span className="settings-slider-header">
        <span>{label}</span>
        <span className="settings-slider-value">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
