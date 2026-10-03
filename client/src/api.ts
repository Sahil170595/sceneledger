import type {
  AuthResponse,
  SignupRequest,
  LoginRequest,
  CanvasSummary,
  CanvasDetail,
  CreateCanvasRequest,
  InviteRequest,
  ErrorResponse,
} from "./types.ts";

function getToken(): string | null {
  return localStorage.getItem("token");
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...authHeaders(),
  };
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err: ErrorResponse = await res.json().catch(() => ({ error: "unknown" }));
    throw new ApiError(res.status, err.error);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export async function signup(data: SignupRequest): Promise<AuthResponse> {
  return request<AuthResponse>("POST", "/api/auth/signup", data);
}

export async function login(data: LoginRequest): Promise<AuthResponse> {
  return request<AuthResponse>("POST", "/api/auth/login", data);
}

export async function getCanvases(): Promise<CanvasSummary[]> {
  return request<CanvasSummary[]>("GET", "/api/canvases");
}

export async function createCanvas(data: CreateCanvasRequest): Promise<CanvasSummary> {
  return request<CanvasSummary>("POST", "/api/canvases", data);
}

export async function getCanvasDetail(canvasId: string): Promise<CanvasDetail> {
  return request<CanvasDetail>("GET", `/api/canvases/${canvasId}`);
}

export async function inviteToCanvas(
  canvasId: string,
  data: InviteRequest
): Promise<{ ok: true }> {
  return request<{ ok: true }>("POST", `/api/canvases/${canvasId}/invite`, data);
}

export async function deleteCanvas(canvasId: string): Promise<{ ok: true }> {
  return request<{ ok: true }>("DELETE", `/api/canvases/${canvasId}`);
}
