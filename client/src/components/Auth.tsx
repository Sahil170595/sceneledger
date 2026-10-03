// Sceneledger release: application branding updated; interaction behavior retained.
import { useState } from "react";
import { signup, login, ApiError } from "../api.ts";
import { storeAuth } from "../authStore.ts";

interface AuthProps {
  initialMode: "login" | "signup";
  onAuth: () => void;
}

export default function Auth({ initialMode, onAuth }: AuthProps) {
  const [mode, setMode] = useState<"login" | "signup">(initialMode);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "signup") {
        const res = await signup({ username, email, password });
        storeAuth(res.token, res.user);
      } else {
        const res = await login({ username, password });
        storeAuth(res.token, res.user);
      }
      onAuth();
    } catch (err) {
      if (err instanceof ApiError) {
        const messages: Record<string, string> = {
          username_taken: "That username is already taken.",
          email_taken: "That email is already in use.",
          invalid_credentials: "Wrong username or password.",
        };
        setError(messages[err.code] || err.code);
      } else {
        setError("Network error. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logoRow}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#5b5bff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M8 16l3-8 3 8" />
            <path d="M16 8v8" />
          </svg>
          <span style={s.logoText}>Sceneledger</span>
        </div>

        <h2 style={s.heading}>
          {mode === "login" ? "Welcome back" : "Create account"}
        </h2>
        <p style={s.subheading}>
          {mode === "login"
            ? "Sign in to your workspace"
            : "Get started with collaborative drawing"}
        </p>

        <form onSubmit={handleSubmit} style={s.form}>
          <div style={s.field}>
            <label style={s.label}>Username</label>
            <input
              style={s.input}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              placeholder="your-username"
            />
          </div>

          {mode === "signup" && (
            <div style={s.field}>
              <label style={s.label}>Email</label>
              <input
                style={s.input}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </div>
          )}

          <div style={s.field}>
            <label style={s.label}>Password</label>
            <input
              style={s.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={4}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder="Min. 4 characters"
            />
          </div>

          {error && <div style={s.error}>{error}</div>}

          <button type="submit" style={s.submit} disabled={loading}>
            {loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div style={s.divider}>
          <span style={s.dividerLine} />
          <span style={s.dividerText}>or</span>
          <span style={s.dividerLine} />
        </div>

        <button
          style={s.switchBtn}
          onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(""); }}
        >
          {mode === "login" ? "Create a new account" : "Sign in to existing account"}
        </button>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f8f9fb",
    fontFamily: "'DM Sans', system-ui, -apple-system, sans-serif",
  },
  card: {
    width: 380,
    maxWidth: "92vw",
    background: "#fff",
    borderRadius: 16,
    padding: "36px 32px 28px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.06)",
    border: "1px solid rgba(0,0,0,0.06)",
  },
  logoRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 28,
  },
  logoText: {
    fontSize: 18,
    fontWeight: 700,
    color: "#1a1a2e",
    letterSpacing: -0.3,
  },
  heading: {
    margin: "0 0 4px",
    fontSize: 22,
    fontWeight: 700,
    color: "#1a1a2e",
    letterSpacing: -0.4,
  },
  subheading: {
    margin: "0 0 24px",
    fontSize: 14,
    color: "#8b8fa3",
    lineHeight: 1.4,
  },
  form: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
  },
  field: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 5,
  },
  label: {
    fontSize: 13,
    fontWeight: 600,
    color: "#3d3d4e",
  },
  input: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1.5px solid #e4e5eb",
    fontSize: 14,
    color: "#1a1a2e",
    outline: "none",
    transition: "border-color 0.15s, box-shadow 0.15s",
    fontFamily: "inherit",
  },
  error: {
    color: "#e03131",
    fontSize: 13,
    padding: "8px 12px",
    background: "#fff5f5",
    borderRadius: 8,
    border: "1px solid #ffc9c9",
  },
  submit: {
    padding: "11px 20px",
    borderRadius: 10,
    border: "none",
    background: "#5b5bff",
    color: "#fff",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background 0.15s, transform 0.1s",
    marginTop: 4,
  },
  divider: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    margin: "20px 0 16px",
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: "#e4e5eb",
  },
  dividerText: {
    fontSize: 12,
    color: "#aaa",
    fontWeight: 500,
  },
  switchBtn: {
    width: "100%",
    padding: "10px 16px",
    borderRadius: 10,
    border: "1.5px solid #e4e5eb",
    background: "transparent",
    color: "#5b5bff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background 0.15s, border-color 0.15s",
  },
};
