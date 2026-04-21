'use client';

import React from 'react';
import { Database, LogOut, Moon, Sun, UserRound } from 'lucide-react';
import { useAppStore } from '@/store';
import { truncateMiddle } from '@/lib/utils';
import { useThemeStore } from '@/store/theme';

interface NavbarProps {
  onLogout: () => void;
}

export function Navbar({ onLogout }: NavbarProps) {
  const { currentDatabase, selectedCollection, isLoading, connectionUri, user } = useAppStore();
  const { theme, toggleTheme } = useThemeStore();

  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-4 text-slate-900 dark:border-slate-800 dark:bg-black dark:text-slate-100">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
          <Database className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">LioranDB Studio</span>
            <span className="hidden text-xs text-slate-500 dark:text-slate-400 md:inline">
              {connectionUri ? truncateMiddle(connectionUri, 54) : 'No active host'}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              Connected
            </span>
            {currentDatabase ? <span>{currentDatabase}</span> : <span>No database selected</span>}
            {selectedCollection ? (
              <span className="text-slate-500 dark:text-slate-500">/ {selectedCollection}</span>
            ) : null}
            {isLoading ? <span className="text-slate-500 dark:text-slate-500">Syncing…</span> : null}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {user ? (
          <div className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-slate-800 dark:bg-slate-950 md:flex">
            <UserRound className="h-4 w-4 text-slate-500 dark:text-slate-400" />
            <span className="max-w-[12rem] truncate">{user.username}</span>
          </div>
        ) : null}

        <button
          type="button"
          onClick={toggleTheme}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <button
          onClick={onLogout}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:hover:bg-slate-900"
        >
          <LogOut className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          Disconnect
        </button>
      </div>
    </header>
  );
}
