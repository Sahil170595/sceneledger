import type { ShapeType } from "../types.ts";

export type Tool = ShapeType | "select";

interface ToolbarProps {
  currentTool: Tool;
  onToolChange: (tool: Tool) => void;
  fillColor: string;
  strokeColor: string;
  onFillChange: (color: string) => void;
  onStrokeChange: (color: string) => void;
  opacity: number;
  onOpacityChange: (opacity: number) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onBack: () => void;
}

const PALETTE = [
  "#1e1e1e", "#e03131", "#e8590c", "#fcc419",
  "#40c057", "#228be6", "#7950f2", "#ffffff",
];

const FONT_SIZES = [12, 16, 20, 24, 32, 48, 64];

function ToolIcon({ tool, active }: { tool: Tool; active: boolean }) {
  const color = active ? "#fff" : "#b0b3c4";
  const size = 22;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round">
      {tool === "select" && (
        <path d="M4 2l12 9.5-5.3 1.8L14.5 22 11 20l-3.8-8.7L4 13V2z" fill={color} stroke={color} strokeWidth="1" />
      )}
      {tool === "rectangle" && (
        <rect x="4" y="5" width="16" height="14" rx="2" fill={active ? color : "none"} stroke={color} strokeWidth="2" />
      )}
      {tool === "ellipse" && (
        <ellipse cx="12" cy="12" rx="8" ry="6" fill={active ? color : "none"} stroke={color} strokeWidth="2" />
      )}
      {tool === "line" && (
        <path d="M4 20L20 4" stroke={color} strokeWidth="2.5" />
      )}
      {tool === "text" && (
        <path d="M5 6h14M12 6v14M9 20h6" stroke={color} strokeWidth="2.5" />
      )}
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10h13a4 4 0 010 8H9" />
      <path d="M7 6l-4 4 4 4" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10H8a4 4 0 000 8h7" />
      <path d="M17 6l4 4-4 4" />
    </svg>
  );
}

const tools: { id: Tool; label: string; shortcut: string }[] = [
  { id: "select", label: "Select", shortcut: "V" },
  { id: "rectangle", label: "Rect", shortcut: "R" },
  { id: "ellipse", label: "Ellipse", shortcut: "O" },
  { id: "line", label: "Line", shortcut: "L" },
  { id: "text", label: "Text", shortcut: "T" },
];

export default function Toolbar({
  currentTool,
  onToolChange,
  fillColor,
  strokeColor,
  onFillChange,
  onStrokeChange,
  opacity,
  onOpacityChange,
  fontSize,
  onFontSizeChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onBack,
}: ToolbarProps) {
  return (
    <>
      {/* Back button */}
      <button onClick={onBack} style={s.backBtn} title="Back to canvases">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#555" strokeWidth="2" strokeLinecap="round">
          <path d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      {/* Floating bottom toolbar — multi-row */}
      <div style={s.bar}>
        {/* Row 1: Tools + Undo/Redo */}
        <div style={s.row}>
          <div style={s.group}>
            {tools.map((t) => (
              <button
                key={t.id}
                onClick={() => onToolChange(t.id)}
                title={`${t.label} (${t.shortcut})`}
                style={{
                  ...s.toolBtn,
                  background: currentTool === t.id ? "#5b5bff" : "transparent",
                }}
              >
                <ToolIcon tool={t.id} active={currentTool === t.id} />
                <span style={{
                  ...s.toolLabel,
                  color: currentTool === t.id ? "#fff" : "#8b8fa3",
                }}>{t.label}</span>
              </button>
            ))}
          </div>

          <div style={s.sep} />

          <div style={s.group}>
            <button onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)"
              style={{ ...s.actionBtn, opacity: canUndo ? 1 : 0.3 }}>
              <UndoIcon />
              <span style={s.actionLabel}>Undo</span>
            </button>
            <button onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)"
              style={{ ...s.actionBtn, opacity: canRedo ? 1 : 0.3 }}>
              <RedoIcon />
              <span style={s.actionLabel}>Redo</span>
            </button>
          </div>
        </div>

        {/* Row 2: Colors + Opacity + Font Size */}
        <div style={s.divider} />
        <div style={s.row}>
          {/* Fill */}
          <div style={s.propGroup}>
            <span style={s.propLabel}>Fill</span>
            <div style={s.swatchRow}>
              {PALETTE.map((c) => (
                <button key={`f-${c}`} onClick={() => onFillChange(c)} title={c}
                  style={{
                    ...s.swatch,
                    background: c,
                    boxShadow: fillColor === c ? "0 0 0 2px #5b5bff" : c === "#ffffff" ? "inset 0 0 0 1px #555" : "none",
                  }} />
              ))}
              <label style={s.customColor}>
                <span style={{ ...s.swatch, background: fillColor, cursor: "pointer" }}>
                  <span style={s.plusIcon}>+</span>
                </span>
                <input type="color" value={fillColor} onChange={(e) => onFillChange(e.target.value)} style={s.hiddenInput} />
              </label>
            </div>
          </div>

          <div style={s.sep} />

          {/* Stroke */}
          <div style={s.propGroup}>
            <span style={s.propLabel}>Stroke</span>
            <div style={s.swatchRow}>
              {PALETTE.map((c) => (
                <button key={`s-${c}`} onClick={() => onStrokeChange(c)} title={c}
                  style={{
                    ...s.swatch,
                    background: c,
                    boxShadow: strokeColor === c ? "0 0 0 2px #5b5bff" : c === "#ffffff" ? "inset 0 0 0 1px #555" : "none",
                  }} />
              ))}
              <label style={s.customColor}>
                <span style={{ ...s.swatch, background: strokeColor, cursor: "pointer" }}>
                  <span style={s.plusIcon}>+</span>
                </span>
                <input type="color" value={strokeColor} onChange={(e) => onStrokeChange(e.target.value)} style={s.hiddenInput} />
              </label>
            </div>
          </div>

          <div style={s.sep} />

          {/* Opacity */}
          <div style={s.propGroup}>
            <span style={s.propLabel}>Opacity</span>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="range" min={0} max={100} value={Math.round(opacity * 100)}
                onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
                style={s.slider} />
              <span style={s.sliderValue}>{Math.round(opacity * 100)}%</span>
            </div>
          </div>

          <div style={s.sep} />

          {/* Font Size (visible when text tool or text shape selected) */}
          <div style={s.propGroup}>
            <span style={s.propLabel}>Font</span>
            <select
              value={fontSize}
              onChange={(e) => onFontSizeChange(Number(e.target.value))}
              style={s.select}
            >
              {FONT_SIZES.map((sz) => (
                <option key={sz} value={sz}>{sz}px</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  backBtn: {
    position: "fixed",
    top: 14,
    left: 14,
    zIndex: 200,
    width: 40,
    height: 40,
    borderRadius: 10,
    border: "none",
    background: "rgba(255,255,255,0.92)",
    backdropFilter: "blur(8px)",
    boxShadow: "0 1px 8px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.04)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  bar: {
    position: "fixed",
    bottom: 16,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 200,
    display: "flex",
    flexDirection: "column" as const,
    padding: "8px 12px",
    background: "#2c2c2c",
    borderRadius: 14,
    boxShadow: "0 4px 28px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)",
    gap: 0,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  divider: {
    height: 1,
    background: "rgba(255,255,255,0.08)",
    margin: "6px 0",
  },
  group: {
    display: "flex",
    alignItems: "center",
    gap: 2,
  },
  sep: {
    width: 1,
    height: 28,
    background: "rgba(255,255,255,0.1)",
    margin: "0 8px",
  },
  toolBtn: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 2,
    padding: "6px 10px",
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
    transition: "background 0.12s",
    minWidth: 48,
  },
  toolLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0.2,
  },
  actionBtn: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 2,
    padding: "6px 10px",
    borderRadius: 10,
    border: "none",
    cursor: "pointer",
    background: "transparent",
    color: "#b0b3c4",
    minWidth: 44,
  },
  actionLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: "#8b8fa3",
  },
  propGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  },
  propLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: "#777",
    textTransform: "uppercase" as const,
    letterSpacing: 0.8,
  },
  swatchRow: {
    display: "flex",
    gap: 3,
    alignItems: "center",
  },
  swatch: {
    width: 20,
    height: 20,
    borderRadius: 5,
    border: "none",
    cursor: "pointer",
    padding: 0,
    transition: "box-shadow 0.12s",
    position: "relative" as const,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  customColor: {
    position: "relative" as const,
    display: "flex",
    cursor: "pointer",
  },
  plusIcon: {
    fontSize: 12,
    fontWeight: 700,
    color: "rgba(255,255,255,0.5)",
    mixBlendMode: "difference" as const,
  },
  hiddenInput: {
    position: "absolute" as const,
    width: 0,
    height: 0,
    opacity: 0,
    overflow: "hidden" as const,
  },
  slider: {
    width: 80,
    height: 4,
    cursor: "pointer",
    accentColor: "#5b5bff",
  },
  sliderValue: {
    fontSize: 11,
    fontWeight: 600,
    color: "#888",
    fontFamily: "monospace",
    minWidth: 32,
    textAlign: "right" as const,
  },
  select: {
    background: "#3a3a3a",
    color: "#ccc",
    border: "1px solid #555",
    borderRadius: 6,
    padding: "4px 8px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    outline: "none",
    fontFamily: "monospace",
  },
};
