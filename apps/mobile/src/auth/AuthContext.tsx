import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest, ApiError } from '../api/client';
import { clearSessionToken, loadSessionToken, saveSessionToken, TENANT_KEY } from './session-store';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  mfaEnabled: boolean;
}

export interface Membership {
  tenantId: string;
  tenantName: string;
  roleKey: string;
}

interface AuthState {
  user: SessionUser | null;
  memberships: Membership[];
  currentTenantId: string | null;
  loading: boolean;
  error: string | null;
  login: (
    email: string,
    password: string,
  ) => Promise<{ mfaRequired: boolean; mfaChallengeToken?: string }>;
  completeMfa: (mfaChallengeToken: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  setCurrentTenantId: (tenantId: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentTenantId, setCurrentTenantIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadMe = useCallback(async () => {
    const me = await apiRequest<{ user: SessionUser; memberships: Membership[] }>('/auth/me');
    setUser(me.user);
    setMemberships(me.memberships);
    const stored = await AsyncStorage.getItem(TENANT_KEY);
    const valid = me.memberships.find((m) => m.tenantId === stored);
    setCurrentTenantIdState(valid?.tenantId ?? me.memberships[0]?.tenantId ?? null);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const token = await loadSessionToken();
        if (token) await loadMe();
      } catch {
        await clearSessionToken();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      setError(null);
      const result = await apiRequest<{
        mfaRequired?: boolean;
        mfaChallengeToken?: string;
        sessionToken?: string;
        user?: SessionUser;
      }>('/auth/login', { method: 'POST', body: { email, password }, token: null });

      if (result.mfaRequired) {
        return { mfaRequired: true, mfaChallengeToken: result.mfaChallengeToken };
      }
      if (result.sessionToken) {
        await saveSessionToken(result.sessionToken);
        await loadMe();
      }
      return { mfaRequired: false };
    },
    [loadMe],
  );

  const completeMfa = useCallback(
    async (mfaChallengeToken: string, code: string) => {
      const result = await apiRequest<{ sessionToken: string }>('/auth/mfa/verify', {
        method: 'POST',
        body: { mfaChallengeToken, code },
        token: null,
      });
      await saveSessionToken(result.sessionToken);
      await loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } finally {
      await clearSessionToken();
      setUser(null);
      setMemberships([]);
      setCurrentTenantIdState(null);
    }
  }, []);

  const setCurrentTenantId = useCallback(async (tenantId: string) => {
    setCurrentTenantIdState(tenantId);
    await AsyncStorage.setItem(TENANT_KEY, tenantId);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      memberships,
      currentTenantId,
      loading,
      error,
      login,
      completeMfa,
      logout,
      setCurrentTenantId,
    }),
    [
      user,
      memberships,
      currentTenantId,
      loading,
      error,
      login,
      completeMfa,
      logout,
      setCurrentTenantId,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { ApiError };
