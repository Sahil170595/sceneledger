import { useState, useEffect } from "react";
import type { CanvasSummary } from "../types.ts";
import { getCanvases, createCanvas, deleteCanvas, ApiError } from "../api.ts";
import { clearAuth, getStoredUser } from "../authStore.ts";

interface CanvasListProps {
  onSelectCanvas: (canvasId: string) => void;
  onLogout: () => void;
}

export default function CanvasList({
  onSelectCanvas,
  onLogout,
}: CanvasListProps) {
  const [canvases, setCanvases] = useState<CanvasSummary[]>([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const user = getStoredUser();

  useEffect(() => {
    let cancelled = false;
    getCanvases()
      .then((data) => {
        if (!cancelled) {
          setCanvases(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 401) {
            handleLogout();
          } else {
            setError("Failed to load canvases.");
            setLoading(false);
          }
        }
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = () => {
    clearAuth();
    onLogout();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const canvas = await createCanvas({ name: newName.trim() });
      setCanvases((prev) => [canvas, ...prev]);
      setNewName("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleLogout();
      } else {
        setError("Failed to create canvas.");
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (canvasId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this canvas?")) return;
    try {
      await deleteCanvas(canvasId);
      setCanvases((prev) => prev.filter((c) => c.id !== canvasId));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        handleLogout();
      } else if (err instanceof ApiError && err.status === 403) {
        setError("Only the canvas owner can delete it.");
      } else {
        setError("Failed to delete canvas.");
      }
    }
  };

  return (
    <div style={s.page}>
      <div style={s.container}>
        {/* Header */}
        <div style={s.header}>
          <div>
            <h1 style={s.title}>Your Canvases</h1>
            <p style={s.subtitle}>
              {user?.username ? `Signed in as ${user.username}` : ""}
            </p>
          </div>
          <button style={s.logoutBtn} onClick={handleLogout}>
            Sign out
          </button>
        </div>

        {/* Create form */}
        <form onSubmit={handleCreate} style={s.createForm}>
          <input
            style={s.input}
            type="text"
            placeholder="New canvas name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            required
          />
          <button type="submit" style={s.createBtn} disabled={creating}>
            {creating ? "..." : "Create"}
          </button>
        </form>

        {error && <div style={s.error}>{error}</div>}

        {/* Canvas grid */}
        {loading ? (
          <p style={s.empty}>Loading...</p>
        ) : canvases.length === 0 ? (
          <div style={s.emptyState}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#c5c6d0" strokeWidth="1.5" strokeLinecap="round">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M8 12h8M12 8v8" />
            </svg>
            <p style={s.emptyText}>No canvases yet. Create one above.</p>
          </div>
        ) : (
          <div style={s.grid}>
            {canvases.map((c) => (
              <button
                key={c.id}
                style={s.card}
                onClick={() => onSelectCanvas(c.id)}
                onMouseEnter={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.borderColor = "#5b5bff";
                  el.style.transform = "translateY(-2px)";
                  const delBtn = el.querySelector("[data-delete-btn]") as HTMLElement | null;
                  if (delBtn) delBtn.style.opacity = "1";
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  el.style.borderColor = "#e4e5eb";
                  el.style.transform = "none";
                  const delBtn = el.querySelector("[data-delete-btn]") as HTMLElement | null;
                  if (delBtn) delBtn.style.opacity = "0";
                }}
              >
                <div style={s.cardPreview}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#b0b3c4" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="4" y="4" width="7" height="7" rx="1" />
                    <circle cx="17" cy="7" r="3" />
                    <path d="M4 17l5 3 5-3 6 3" />
                  </svg>
                  <span
                    data-delete-btn
                    role="button"
                    title="Delete canvas"
                    style={s.deleteBtn}
                    onClick={(e) => handleDelete(c.id, e)}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "#e03131";
                      (e.currentTarget as HTMLElement).style.color = "#fff";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.06)";
                      (e.currentTarget as HTMLElement).style.color = "#8b8fa3";
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </span>
                </div>
                <div style={s.cardBody}>
                  <span style={s.cardName}>{c.name}</span>
                  <span style={s.cardDate}>
                    {new Date(c.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#f8f9fb",
    fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
    padding: "40px 16px",
  },
  container: {
    maxWidth: 640,
    margin: "0 auto",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 28,
  },
  title: {
    margin: 0,
    fontSize: 24,
    fontWeight: 700,
    color: "#1a1a2e",
    letterSpacing: -0.4,
  },
  subtitle: {
    margin: "4px 0 0",
    fontSize: 13,
    color: "#8b8fa3",
  },
  logoutBtn: {
    padding: "7px 16px",
    borderRadius: 8,
    border: "1.5px solid #e4e5eb",
    background: "#fff",
    color: "#555",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "border-color 0.15s",
  },
  createForm: {
    display: "flex",
    gap: 8,
    marginBottom: 20,
  },
  input: {
    flex: 1,
    padding: "10px 14px",
    borderRadius: 10,
    border: "1.5px solid #e4e5eb",
    fontSize: 14,
    color: "#1a1a2e",
    outline: "none",
    fontFamily: "inherit",
    transition: "border-color 0.15s",
  },
  createBtn: {
    padding: "10px 20px",
    borderRadius: 10,
    border: "none",
    background: "#5b5bff",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
    transition: "background 0.15s",
  },
  error: {
    color: "#e03131",
    fontSize: 13,
    padding: "8px 12px",
    background: "#fff5f5",
    borderRadius: 8,
    border: "1px solid #ffc9c9",
    marginBottom: 16,
  },
  empty: {
    color: "#8b8fa3",
    textAlign: "center" as const,
    marginTop: 48,
    fontSize: 14,
  },
  emptyState: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 12,
    marginTop: 64,
  },
  emptyText: {
    color: "#8b8fa3",
    fontSize: 14,
    margin: 0,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: 12,
  },
  card: {
    border: "1.5px solid #e4e5eb",
    borderRadius: 12,
    background: "#fff",
    cursor: "pointer",
    textAlign: "left" as const,
    overflow: "hidden",
    transition: "border-color 0.15s, transform 0.15s, box-shadow 0.15s",
    padding: 0,
    fontFamily: "inherit",
  },
  cardPreview: {
    height: 80,
    background: "#f4f5f9",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative" as const,
  },
  deleteBtn: {
    position: "absolute" as const,
    top: 6,
    right: 6,
    width: 24,
    height: 24,
    borderRadius: 6,
    background: "rgba(0,0,0,0.06)",
    color: "#8b8fa3",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    opacity: 0,
    transition: "opacity 0.15s, background 0.15s, color 0.15s",
    border: "none",
    padding: 0,
    lineHeight: 1,
  },
  cardBody: {
    padding: "12px 14px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardName: {
    fontSize: 14,
    fontWeight: 600,
    color: "#1a1a2e",
  },
  cardDate: {
    fontSize: 11,
    color: "#8b8fa3",
    fontFamily: "'DM Mono', monospace",
  },
};
