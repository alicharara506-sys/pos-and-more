'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession } from '@/lib/session-context';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '🏠' },
  { href: '/pos', label: 'Sales', icon: '🧾' },
  { href: '/products', label: 'Products', icon: '📦' },
  { href: '/customers', label: 'Customers', icon: '👥' },
  { href: '/invoices', label: 'Invoices', icon: '📄' },
  { href: '/expenses', label: 'Expenses', icon: '💳' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, memberships, currentTenantId, setCurrentTenantId, loading, logout } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
    else if (memberships.length === 0) router.replace('/onboarding');
  }, [loading, user, memberships, router]);

  if (loading || !user || memberships.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-gray-500">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Desktop side nav */}
      <div className="hidden border-r border-gray-200 dark:border-gray-700 md:fixed md:inset-y-0 md:flex md:w-56 md:flex-col">
        <div className="flex h-16 items-center px-5 text-lg font-semibold">SalesMaster Pro</div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
                pathname?.startsWith(item.href)
                  ? 'bg-brand-50 font-medium text-brand-700 dark:bg-gray-800'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              <span>{item.icon}</span> {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-gray-200 p-3 text-xs text-gray-500 dark:border-gray-700">
          {memberships.length > 1 ? (
            <select
              className="mb-2 w-full rounded border border-gray-300 bg-transparent px-2 py-1 dark:border-gray-600"
              value={currentTenantId ?? ''}
              onChange={(e) => setCurrentTenantId(e.target.value)}
            >
              {memberships.map((m) => (
                <option key={m.tenantId} value={m.tenantId}>
                  {m.tenantName}
                </option>
              ))}
            </select>
          ) : (
            <p className="mb-2 truncate">{memberships[0]?.tenantName}</p>
          )}
          <p className="truncate">{user.email}</p>
          <button
            onClick={() => logout().then(() => router.push('/login'))}
            className="mt-2 text-brand-600 hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>

      <main className="pb-20 md:ml-56 md:pb-0">
        <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 flex border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 md:hidden">
        {NAV_ITEMS.slice(0, 5).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
              pathname?.startsWith(item.href) ? 'text-brand-600' : 'text-gray-500'
            }`}
          >
            <span className="text-lg">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
