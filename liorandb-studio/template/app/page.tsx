'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DatabaseZap } from 'lucide-react';
import { useAppStore } from '@/store';

export default function Home() {
  const router = useRouter();
  const { loadFromStorage } = useAppStore();

  useEffect(() => {
    loadFromStorage();

    const hasToken = typeof window !== 'undefined' && Boolean(localStorage.getItem('liorandb_token'));
    router.replace(hasToken ? '/dashboard' : '/login');
  }, [loadFromStorage, router]);

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="glass-panel animate-fade-up w-full max-w-md rounded-[28px] p-8 text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
          <DatabaseZap className="h-8 w-8 text-[var(--accent)]" />
        </div>
        <h1 className="text-2xl font-semibold text-white">Preparing LioranDB Studio</h1>
        <p className="mt-3 text-sm text-[var(--muted)]">
          Restoring your workspace and reconnecting to the selected host.
        </p>
      </div>
    </main>
  );
}
