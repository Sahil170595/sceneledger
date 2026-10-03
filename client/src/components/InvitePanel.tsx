import { useState } from "react";
import type { PresenceUser } from "../types.ts";
import { inviteToCanvas, ApiError } from "../api.ts";

interface InvitePanelProps {
  canvasId: string;
  onlineUsers: PresenceUser[];
}

export default function InvitePanel({ canvasId, onlineUsers }: InvitePanelProps) {
  const [identifier, setIdentifier] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");
  const [sending, setSending] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim()) return;
    setSending(true);
    setMessage("");
    try {
      await inviteToCanvas(canvasId, { identifier: identifier.trim() });
      setMessage("Invited!");
      setMessageType("success");
      setIdentifier("");
      setTimeout(() => setMessage(""), 2000);
    } catch (err) {
      if (err instanceof ApiError) {
        const messages: Record<string, string> = {
          user_not_found: "User not found.",
          canvas_not_found: "Canvas not found.",
          not_a_member: "Not a member.",
        };
        setMessage(messages[err.code] || err.code);
      } else {
        setMessage("Failed to invite.");
      }
      setMessageType("error");
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={s.wrapper}>
      {/* User avatars — always visible */}
      <div style={s.avatarRow}>
        {onlineUsers.map((u) => (
          <div
            key={u.userId}
            title={u.username}
            style={{
              ...s.avatar,
              background: u.color,
            }}
          >
            {u.username.charAt(0).toUpperCase()}
          </div>
        ))}
        <button
          style={s.inviteBtn}
          onClick={() => setShowInvite(!showInvite)}
          title="Invite collaborator"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {/* Invite dropdown */}
      {showInvite && (
        <div style={s.dropdown}>
          <div style={s.dropdownHeader}>Invite to canvas</div>
          <form onSubmit={handleInvite} style={s.form}>
            <input
              style={s.input}
              type="text"
              placeholder="Username or email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
              autoFocus
            />
            <button type="submit" style={s.sendBtn} disabled={sending}>
              {sending ? "..." : "Send"}
            </button>
          </form>
          {message && (
            <div style={{
              ...s.msg,
              color: messageType === "error" ? "#e03131" : "#2b8a3e",
              background: messageType === "error" ? "#fff5f5" : "#ebfbee",
            }}>
              {message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrapper: {
    position: "absolute",
    top: 14,
    right: 14,
    zIndex: 200,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "flex-end",
    gap: 6,
    fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
  },
  avatarRow: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 6px",
    background: "rgba(255,255,255,0.9)",
    backdropFilter: "blur(8px)",
    borderRadius: 24,
    boxShadow: "0 1px 6px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.05)",
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    color: "#fff",
    textShadow: "0 1px 2px rgba(0,0,0,0.2)",
  },
  inviteBtn: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    border: "1.5px dashed #c5c6d0",
    background: "transparent",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#8b8fa3",
    transition: "border-color 0.15s, color 0.15s",
  },
  dropdown: {
    width: 240,
    background: "#fff",
    borderRadius: 12,
    padding: 14,
    boxShadow: "0 4px 20px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)",
  },
  dropdownHeader: {
    fontSize: 12,
    fontWeight: 600,
    color: "#8b8fa3",
    textTransform: "uppercase" as const,
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  form: {
    display: "flex",
    gap: 6,
  },
  input: {
    flex: 1,
    padding: "7px 10px",
    borderRadius: 8,
    border: "1.5px solid #e4e5eb",
    fontSize: 13,
    outline: "none",
    fontFamily: "inherit",
  },
  sendBtn: {
    padding: "7px 14px",
    borderRadius: 8,
    border: "none",
    background: "#5b5bff",
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  msg: {
    marginTop: 8,
    padding: "5px 10px",
    borderRadius: 6,
    fontSize: 12,
  },
};
