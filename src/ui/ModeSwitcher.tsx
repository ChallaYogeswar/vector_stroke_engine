import type { ModeId } from '../engine/types';

interface ModeInfo {
  id: ModeId;
  label: string;
}

// Order matches build-spec 3.2's build order (flagship early, hardest last).
const MODES: ModeInfo[] = [
  { id: '2d', label: '2D' },
  { id: 'sketch', label: 'Sketch' },
  { id: 'histogram', label: 'Histogram' },
  { id: 'ascii', label: 'ASCII' },
  { id: '3d', label: '3D' },
];

interface ModeSwitcherProps {
  activeMode: ModeId;
  onSelect: (id: ModeId) => void;
}

export function ModeSwitcher({ activeMode, onSelect }: ModeSwitcherProps) {
  return (
    <div>
      <p className="rail-section-label">Mode</p>
      <div className="mode-switcher" role="tablist" aria-label="Render mode">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            role="tab"
            aria-selected={activeMode === mode.id}
            className={`mode-button${activeMode === mode.id ? ' is-active' : ''}`}
            onClick={() => onSelect(mode.id)}
          >
            <span>{mode.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
