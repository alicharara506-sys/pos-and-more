'use client';

import { useCallback } from 'react';
import { apiFetch, type ApiFetchOptions } from './api-client';
import { useSession } from './session-context';

/** Binds every call to the currently selected tenant's X-Tenant-Id header. */
export function useTenantApi() {
  const { currentTenantId } = useSession();

  return useCallback(
    <T>(path: string, options: Omit<ApiFetchOptions, 'tenantId'> = {}) => {
      if (!currentTenantId) {
        return Promise.reject(new Error('No tenant selected'));
      }
      return apiFetch<T>(path, { ...options, tenantId: currentTenantId });
    },
    [currentTenantId],
  );
}
