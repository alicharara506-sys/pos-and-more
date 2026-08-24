import type { Metadata } from 'next';
import { SessionProvider } from '@/lib/session-context';
import './globals.css';

export const metadata: Metadata = {
  title: 'SalesMaster Pro',
  description: 'Point of sale, CRM, inventory, and invoicing for growing businesses',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
