const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001';
const ACCESS_TOKEN_KEY = 'ecdraw-access-token';
const REFRESH_TOKEN_KEY = 'ecdraw-refresh-token';

type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface ApiRequestOptions {
  method?: ApiMethod;
  body?: unknown;
  allowRefresh?: boolean;
}

export type UserRole = 'ADMIN' | 'COMPONENT_EDITOR' | 'DIAGRAM_EDITOR' | 'REVIEWER' | 'DISTRICT_EDITOR' | 'LINE_EDITOR' | 'GIS_EDITOR' | 'VIEWER';

export interface AuthUser {
  id: string;
  username: string;
  roles: UserRole[];
}

export function hasRole(user: AuthUser, role: UserRole): boolean {
  return user.roles.includes(role);
}

export function hasAnyRole(user: AuthUser, ...roles: UserRole[]): boolean {
  return roles.some((r) => user.roles.includes(r));
}

interface LoginResponse {
  access_token: string;
  refresh_token: string;
  user: AuthUser;
}

function getStoredAccessToken() {
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

function getStoredRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

function saveTokens(tokens: LoginResponse) {
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
}

function clearTokens() {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return atob(padded);
}

function readUserFromAccessToken(): AuthUser | null {
  const token = getStoredAccessToken();
  if (!token) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadText = decodeBase64Url(parts[1]);
    const payload = JSON.parse(payloadText) as { sub?: string; username?: string; roles?: UserRole[]; exp?: number };
    if (!payload.sub || !payload.username || !payload.roles || !payload.exp) return null;
    if (payload.exp * 1000 <= Date.now()) return null;
    return { id: payload.sub, username: payload.username, roles: payload.roles };
  } catch {
    return null;
  }
}

async function tryRefreshToken() {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return false;

  const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) {
    clearTokens();
    return false;
  }
  const payload = (await response.json()) as LoginResponse;
  saveTokens(payload);
  return payload.user;
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', body, allowRefresh = true } = options;
  const headers: Record<string, string> = {};
  const token = getStoredAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 401 && allowRefresh) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      return apiRequest<T>(path, { method, body, allowRefresh: false });
    }
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `API ${method} ${path} 失败: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function loginApi(username: string, password: string) {
  const payload = await apiRequest<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: { username, password },
    allowRefresh: false,
  });
  saveTokens(payload);
  return payload.user;
}

export function logoutApi() {
  clearTokens();
}

export async function restoreSessionUser() {
  const cached = readUserFromAccessToken();
  if (cached) return cached;

  const refreshed = await tryRefreshToken();
  if (refreshed) return refreshed;
  return null;
}

export async function ensureApiAuth() {
  if (getStoredAccessToken()) return true;
  if (await tryRefreshToken()) return true;

  const autoLoginEnabled = import.meta.env.VITE_API_AUTO_LOGIN === 'true';
  if (!autoLoginEnabled) return false;

  const username = import.meta.env.VITE_API_USERNAME ?? 'admin';
  const password = import.meta.env.VITE_API_PASSWORD ?? 'Admin123456';

  try {
    await loginApi(username, password);
    return true;
  } catch {
    return false;
  }
}
