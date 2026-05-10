/**
 * Unified client — switches between Tauri invoke() and HTTP fetch() based on VITE_API_MODE.
 *
 * VITE_API_MODE = 'tauri' (default) → use Tauri IPC bridge
 * VITE_API_MODE = 'http'            → use HTTP REST API (for client-server deployment)
 */

const API_MODE = (import.meta.env.VITE_API_MODE as string) ?? 'tauri';

import {
  tauriRequest,
  loginApi as tauriLogin,
  logoutApi as tauriLogout,
  restoreSessionUser as tauriRestore,
  ensureTauriAuth,
} from './tauriClient';

import {
  apiRequest,
  loginApi as httpLogin,
  logoutApi as httpLogout,
  restoreSessionUser as httpRestore,
  ensureApiAuth,
} from './apiClient';

export const request = API_MODE === 'http' ? apiRequest : tauriRequest;
export const login = API_MODE === 'http' ? httpLogin : tauriLogin;
export const logout = API_MODE === 'http' ? httpLogout : tauriLogout;
export const restoreSession = API_MODE === 'http' ? httpRestore : tauriRestore;
export const ensureAuth = API_MODE === 'http' ? ensureApiAuth : ensureTauriAuth;

export type { UserRole, AuthUser } from './tauriClient';
export { hasRole, hasAnyRole } from './tauriClient';
