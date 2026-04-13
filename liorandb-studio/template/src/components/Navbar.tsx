'use client';

import React from 'react';
import { LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { useAppStore } from '@/store';
import { truncateMiddle } from '@/lib/utils';

interface NavbarProps {
  onLogout: () => void;
}

export function Navbar({ onLogout }: NavbarProps) {
  const { currentDatabase, selectedCollection, isLoading, connectionUri, user } = useAppStore();

  return (
    <header className="glass-panel flex h-20 items-center justify-between rounded-[28px] px-5 md:px-6">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/6">
            <ShieldCheck className="h-5 w-5 text-[var(--accent)]" />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">Workspace</p>
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-300">
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-[var(--accent)]">Connected</span>
              {currentDatabase ? <span>{currentDatabase}</span> : <span>No database selected</span>}
              {selectedCollection ? <span className="text-[var(--muted)]">/ {selectedCollection}</span> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="ml-4 flex items-center gap-3">
        <div className="hidden rounded-2xl border border-white/8 bg-black/20 px-4 py-2 text-right md:block">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">Endpoint</p>
          <p className="max-w-xs truncate font-mono text-xs text-slate-200">
            {connectionUri ? truncateMiddle(connectionUri, 52) : 'No active host'}
          </p>
        </div>

        {user ? (
          <div className="hidden items-center gap-2 rounded-2xl border border-white/8 bg-black/20 px-4 py-2 md:flex">
            <UserRound className="h-4 w-4 text-[var(--accent-secondary)]" />
            <span className="text-sm text-slate-200">{user.username}</span>
          </div>
        ) : null}

        {isLoading ? <span className="text-sm text-[var(--muted)]">Syncing...</span> : null}

        <button
          onClick={onLogout}
          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-200 transition hover:border-[var(--danger)]/30 hover:bg-[var(--danger)]/10 hover:text-white"
        >
          <LogOut className="h-4 w-4" />
          Disconnect
        </button>
      </div>
    </header>
  );
}
