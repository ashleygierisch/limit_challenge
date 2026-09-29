import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

import { clearTokens, getAccessToken, refreshTokens } from './auth';

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000/api';

export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  timeout: 15_000,
});

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Marks a request that has already been retried, so a loop cannot form. */
type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

/**
 * One refresh at a time.
 *
 * A page typically fires several requests at once. If the access token has
 * expired they all return 401 together, and refreshing per request would
 * rotate the refresh token concurrently — the first rotation blacklists the
 * token the others are still using, signing the user out mid-session. They all
 * await the same promise instead.
 */
let refreshInFlight: Promise<string> | null = null;

function refreshOnce() {
  refreshInFlight ??= refreshTokens().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Notifies the app that the session ended and a sign-in is needed. */
export const SESSION_EXPIRED_EVENT = 'fleet:session-expired';

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;

    // Only a 401 is worth refreshing: a 403 means the token is fine and the
    // user is not allowed, which retrying cannot fix.
    if (error.response?.status !== 401 || !config || config._retried) {
      return Promise.reject(error);
    }

    config._retried = true;

    try {
      const access = await refreshOnce();
      config.headers.Authorization = `Bearer ${access}`;
      return apiClient(config);
    } catch {
      // The refresh token is gone or revoked: the session is genuinely over.
      clearTokens();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      }
      return Promise.reject(error);
    }
  },
);
