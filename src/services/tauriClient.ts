import { invoke } from '@tauri-apps/api/core';

const ACCESS_TOKEN_KEY = 'ecdraw-access-token';
const REFRESH_TOKEN_KEY = 'ecdraw-refresh-token';

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
  try {
    const payload = await invoke<LoginResponse>('refresh_token', { refreshToken });
    saveTokens(payload);
    return payload.user;
  } catch {
    clearTokens();
    return false;
  }
}

function isAuthError(err: unknown): boolean {
  const msg = (err && typeof err === 'object' && (err as Record<string, unknown>).message)
    ? String((err as Record<string, unknown>).message)
    : String(err);
  const kind = (err && typeof err === 'object') ? String((err as Record<string, unknown>).kind ?? '') : '';
  return /令牌|无效|过期|AUTH|JWT|ExpiredSignature|token/i.test(msg + ' ' + kind);
}

/** Generic invoke wrapper that auto-attaches token and retries on auth error */
export async function tauriRequest<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const token = getStoredAccessToken();
  if (token) {
    args = { ...args, token };
  }
  try {
    return await invoke<T>(command, args);
  } catch (err) {
    if (isAuthError(err)) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        const newToken = getStoredAccessToken();
        args.token = newToken;
        return invoke<T>(command, args);
      }
      clearTokens();
    }
    throw err;
  }
}

export async function loginApi(username: string, password: string) {
  const payload = await invoke<LoginResponse>('login', { username, password });
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

export async function ensureTauriAuth() {
  if (getStoredAccessToken()) return true;
  if (await tryRefreshToken()) return true;

  // Auto-login for dev convenience
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
