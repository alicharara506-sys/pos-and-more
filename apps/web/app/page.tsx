'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/session-context';

export default function RootPage() {
  const { user, memberships, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
    } else if (memberships.length === 0) {
      router.replace('/onboarding');
    } else {
      router.replace('/dashboard');
    }
  }, [loading, user, memberships, router]);

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
      Loading SalesMaster Pro…
    </div>
  );
}
