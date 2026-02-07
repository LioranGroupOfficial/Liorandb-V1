'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store';

export default function Home() {
  const router = useRouter();
  const { loadFromStorage, isLoggedIn } = useAppStore();

  useEffect(() => {
    loadFromStorage();
    
    // Check localStorage for existing session
    const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('liorandb_token');
    
    if (hasToken) {
      router.push('/dashboard');
    } else {
      router.push('/login');
    }
  }, [router, loadFromStorage]);

  return (
    <div className="h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="text-4xl">⚡</div>
        <p className="text-slate-400">Connecting to LioranDB...</p>
      </div>
    </div>
  );
}
