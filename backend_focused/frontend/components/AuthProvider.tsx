'use client';

/**
 * Session state for the app.
 *
 * On start-up a stored token is validated against the API rather than trusted:
 * it may have expired while the tab was closed, or been revoked by a sign-out
 * elsewhere. Until that check settles the app shows nothing, so a signed-in
 * user never sees the login screen flash before their data arrives.
 */

import { Box, CircularProgress } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { SESSION_EXPIRED_EVENT } from '@/lib/api-client';
import {
  clearTokens,
  fetchCurrentUser,
  getAccessToken,
  login as loginRequest,
  logout as logoutRequest,
  refreshTokens,
  type CurrentUser,
} from '@/lib/auth';
import { LoginScreen } from './LoginScreen';

interface AuthContextValue {
  user: CurrentUser;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      let access = getAccessToken();
      if (!access) {
        if (!cancelled) setChecking(false);
        return;
      }

      try {
        // The stored access token may have expired while the tab was closed;
        // one refresh attempt is what separates "come back tomorrow and you
        // are still signed in" from "sign in every morning".
        try {
          const me = await fetchCurrentUser(access);
          if (!cancelled) setUser(me);
        } catch {
          access = await refreshTokens();
          const me = await fetchCurrentUser(access);
          if (!cancelled) setUser(me);
        }
      } catch {
        clearTokens();
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const endSession = useCallback(() => {
    setUser(null);
    // Otherwise the next sign-in briefly renders the previous user's rows.
    queryClient.clear();
  }, [queryClient]);

  // The api client raises this when a refresh fails mid-session.
  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, endSession);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, endSession);
  }, [endSession]);

  const signIn = useCallback(
    async (username: string, password: string) => {
      const { access } = await loginRequest(username, password);
      setUser(await fetchCurrentUser(access));
      queryClient.clear();
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    await logoutRequest();
    endSession();
  }, [endSession]);

  const value = useMemo(() => (user ? { user, signOut } : null), [signOut, user]);

  if (checking) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!value) return <LoginScreen onSignIn={signIn} />;

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
