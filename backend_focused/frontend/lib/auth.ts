'use client';

/**
 * Token storage and the sign-in / sign-out calls.
 *
 * Tokens live in `localStorage`. That is readable by any script on the origin,
 * so an XSS bug would expose them — the safer arrangement is an httpOnly
 * refresh cookie, which needs cookie and CSRF handling on the API. Given the
 * access token lives 15 minutes and refresh tokens rotate and are blacklisted
 * on use, this is the pragmatic choice here, and the trade-off is noted in the
 * README rather than left implicit.
 *
 * Deliberately free of React and of the axios instance, so `api-client` can use
 * it from an interceptor without importing a component tree.
 */

import axios from 'axios';

const ACCESS_KEY = 'fleet:access';
const REFRESH_KEY = 'fleet:refresh';

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000/api';

export interface Tokens {
  access: string;
  refresh: string;
}

export interface CurrentUser {
  id: number;
  username: string;
  is_staff: boolean;
}

/** Every access is guarded: storage throws in some privacy modes. */
function read(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Nothing to do: the session simply will not survive a reload.
  }
}

export function getAccessToken() {
  return read(ACCESS_KEY);
}

export function getRefreshToken() {
  return read(REFRESH_KEY);
}

export function storeTokens(tokens: Tokens) {
  write(ACCESS_KEY, tokens.access);
  write(REFRESH_KEY, tokens.refresh);
}

export function clearTokens() {
  write(ACCESS_KEY, null);
  write(REFRESH_KEY, null);
}

/**
 * A bare axios call, not the shared client.
 *
 * Using the shared instance here would route this request through the
 * interceptor that calls it, so a failed refresh would try to refresh itself.
 */
const authClient = axios.create({ baseURL: baseUrl, timeout: 15_000 });

export async function login(username: string, password: string): Promise<Tokens> {
  const { data } = await authClient.post<Tokens>('/auth/login/', { username, password });
  storeTokens(data);
  return data;
}

/** Exchange the refresh token for a new pair. Throws if it is no longer valid. */
export async function refreshTokens(): Promise<string> {
  const refresh = getRefreshToken();
  if (!refresh) throw new Error('No refresh token stored.');

  const { data } = await authClient.post<{ access: string; refresh?: string }>('/auth/refresh/', {
    refresh,
  });

  // Refresh tokens rotate, so the response carries a replacement; keeping the
  // old one would fail on the next refresh, as it is blacklisted on use.
  storeTokens({ access: data.access, refresh: data.refresh ?? refresh });
  return data.access;
}

/** Revoke the refresh token server-side, then forget both locally. */
export async function logout() {
  const refresh = getRefreshToken();
  clearTokens();
  if (!refresh) return;
  try {
    await authClient.post('/auth/logout/', { refresh });
  } catch {
    // Already expired or revoked. The local tokens are gone either way.
  }
}

export async function fetchCurrentUser(accessToken: string): Promise<CurrentUser> {
  const { data } = await authClient.get<CurrentUser>('/auth/me/', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data;
}
