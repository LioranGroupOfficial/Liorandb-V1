'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { DatabaseZap } from 'lucide-react';
import { useAppStore } from '@/store';

export default function Home() {
  const router = useRouter();
  const { loadFromStorage, isLoggedIn } = useAppStore();

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    router.replace(isLoggedIn ? '/dashboard' : '/login');
  }, [isLoggedIn, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-8 text-slate-900 dark:bg-black dark:text-slate-100">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-black">
          <DatabaseZap className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h1 className="text-2xl font-semibold">Preparing LioranDB Studio</h1>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">
          Restoring your workspace and reconnecting to the selected host.
        </p>
      </div>
    </main>
  );
}
