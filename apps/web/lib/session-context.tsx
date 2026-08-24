'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch } from './api-client';

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

interface SessionState {
  user: SessionUser | null;
  memberships: Membership[];
  currentTenantId: string | null;
  loading: boolean;
  setCurrentTenantId: (tenantId: string) => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState | undefined>(undefined);

const TENANT_STORAGE_KEY = 'sm_current_tenant';

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentTenantId, setCurrentTenantIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ user: SessionUser; memberships: Membership[] }>('/auth/me');
      setUser(data.user);
      setMemberships(data.memberships);
      const stored =
        typeof window !== 'undefined' ? window.localStorage.getItem(TENANT_STORAGE_KEY) : null;
      const validStored = data.memberships.find((m) => m.tenantId === stored);
      setCurrentTenantIdState(validStored?.tenantId ?? data.memberships[0]?.tenantId ?? null);
    } catch {
      setUser(null);
      setMemberships([]);
      setCurrentTenantIdState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setCurrentTenantId = useCallback((tenantId: string) => {
    setCurrentTenantIdState(tenantId);
    if (typeof window !== 'undefined') window.localStorage.setItem(TENANT_STORAGE_KEY, tenantId);
  }, []);

  const logout = useCallback(async () => {
    await apiFetch('/auth/logout', { method: 'POST' });
    setUser(null);
    setMemberships([]);
    setCurrentTenantIdState(null);
  }, []);

  const value = useMemo(
    () => ({ user, memberships, currentTenantId, loading, setCurrentTenantId, refresh, logout }),
    [user, memberships, currentTenantId, loading, setCurrentTenantId, refresh, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}
