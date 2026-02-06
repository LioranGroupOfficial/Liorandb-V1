'use client';

import React, { useState } from 'react';
import { LogOut, Settings, Zap } from 'lucide-react';
import { useAppStore } from '@/store';

interface NavbarProps {
  onLogout: () => void;
  onSettings?: () => void;
}

export function Navbar({ onLogout, onSettings }: NavbarProps) {
  const { currentDatabase, selectedCollection, isLoading } = useAppStore();
  const [connectionStatus] = useState(true);

  return (
    <div className="h-16 bg-slate-950 border-b border-slate-800 flex items-center justify-between px-6">
      {/* Left: Breadcrumb */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div
            className={`w-2.5 h-2.5 rounded-full transition ${
              connectionStatus ? 'bg-emerald-500' : 'bg-red-500'
            }`}
          />
          <span className="text-slate-400 text-sm">
            {connectionStatus ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        {currentDatabase && (
          <>
            <span className="text-slate-600">/</span>
            <span className="text-slate-300 font-medium">{currentDatabase}</span>

            {selectedCollection && (
              <>
                <span className="text-slate-600">/</span>
                <span className="text-slate-300 font-medium">{selectedCollection}</span>
              </>
            )}
          </>
        )}
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-3">
        {isLoading && (
          <div className="flex items-center gap-2 text-slate-400">
            <Zap size={16} className="animate-spin" />
            <span className="text-sm">Loading...</span>
          </div>
        )}

        {onSettings && (
          <button
            onClick={onSettings}
            className="p-2 hover:bg-slate-800 rounded transition text-slate-400 hover:text-slate-200"
            title="Settings"
          >
            <Settings size={18} />
          </button>
        )}

        <button
          onClick={onLogout}
          className="flex items-center gap-2 px-3 py-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition"
          title="Logout"
        >
          <LogOut size={16} />
          <span className="text-sm">Logout</span>
        </button>
      </div>
    </div>
  );
}
