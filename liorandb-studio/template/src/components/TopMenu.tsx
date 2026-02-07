'use client';

import React, { useRef, useState } from 'react';
import { Menu, Settings, LogOut, HelpCircle, Home, FileText, Database } from 'lucide-react';
import { useAppStore } from '@/store';
import { useThemeStore } from '@/store/theme';

interface TopMenuProps {
  onLogout: () => void;
}

export function TopMenu({ onLogout }: TopMenuProps) {
  const { queries, addQuery } = useAppStore();
  const { theme } = useThemeStore();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const editMenuRef = useRef<HTMLDivElement>(null);
  const helpMenuRef = useRef<HTMLDivElement>(null);

  const handleNewQuery = () => {
    const newQuery = {
      id: 'query_' + Date.now(),
      name: `Query ${queries.length + 1}`,
      database: '',
      collection: '',
      content: 'db.collection.find({})',
      results: null,
    };
    addQuery(newQuery);
    setOpenMenu(null);
  };

  const handleOpenFile = () => {
    // In a real app, this would open a file dialog
    setOpenMenu(null);
  };

  const handleExportQueries = () => {
    const json = JSON.stringify(queries, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'queries.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setOpenMenu(null);
  };

  const closeMenus = () => {
    setOpenMenu(null);
  };

  React.useEffect(() => {
    document.addEventListener('click', closeMenus);
    return () => document.removeEventListener('click', closeMenus);
  }, []);

  return (
    <div className={`h-14 bg-slate-100 dark:bg-slate-900 border-b border-slate-300 dark:border-slate-700 flex items-center px-4 gap-6 ${theme === 'dark' ? 'dark' : ''}`}>
      {/* Logo / Title */}
      <div className="flex items-center gap-2 min-w-fit">
        <Database size={20} className="text-blue-600 dark:text-blue-400" />
        <span className="font-semibold text-slate-900 dark:text-slate-50">LioranDB Studio</span>
      </div>

      {/* Menu Bar */}
      <div className="flex items-center gap-1">
        {/* File Menu */}
        <div className="relative" ref={fileMenuRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpenMenu(openMenu === 'file' ? null : 'file');
            }}
            className="px-3 py-2 text-sm font-medium text-slate-900 dark:text-slate-50 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition"
          >
            File
          </button>
          {openMenu === 'file' && (
            <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg shadow-lg z-50">
              <button
                onClick={handleNewQuery}
                className="w-full text-left px-4 py-2 text-sm text-slate-900 dark:text-slate-50 hover:bg-blue-500 hover:text-white transition" 
              >
                <div className="flex items-center gap-2">
                  <FileText size={16} />
                  New Query
                </div>
              </button>
              <button
                onClick={handleOpenFile}
                className="w-full text-left px-4 py-2 text-sm text-slate-900 dark:text-slate-50 hover:bg-blue-500 hover:text-white transition"
              >
                <div className="flex items-center gap-2">
                  <Menu size={16} />
                  Open Query
                </div>
              </button>
              <hr className="my-1 border-slate-300 dark:border-slate-700" />
              <button
                onClick={handleExportQueries}
                className="w-full text-left px-4 py-2 text-sm text-slate-900 dark:text-slate-50 hover:bg-blue-500 hover:text-white transition"
              >
                <div className="flex items-center gap-2">
                  <Database size={16} />
                  Export Queries
                </div>
              </button>
              <hr className="my-1 border-slate-300 dark:border-slate-700" />
              <button
                onClick={onLogout}
                className="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-500 hover:text-white transition"
              >
                <div className="flex items-center gap-2">
                  <LogOut size={16} />
                  Exit
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Edit Menu */}
        <div className="relative" ref={editMenuRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpenMenu(openMenu === 'edit' ? null : 'edit');
            }}
            className="px-3 py-2 text-sm font-medium text-slate-900 dark:text-slate-50 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition"
          >
            Edit
          </button>
          {openMenu === 'edit' && (
            <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg shadow-lg z-50">
              <button className="w-full text-left px-4 py-2 text-sm text-slate-900 dark:text-slate-50 hover:bg-blue-500 hover:text-white transition">
                <div className="flex items-center justify-between">
                  <span>Undo</span>
                  <span className="text-xs text-slate-500">Ctrl+Z</span>
                </div>
              </button>
              <button className="w-full text-left px-4 py-2 text-sm text-slate-900 dark:text-slate-50 hover:bg-blue-500 hover:text-white transition">
                <div className="flex items-center justify-between">
                  <span>Redo</span>
                  <span className="text-xs text-slate-500">Ctrl+Y</span>
                </div>
              </button>
            </div>
          )}
        </div>

        {/* Help Menu */}
        <div className="relative" ref={helpMenuRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpenMenu(openMenu === 'help' ? null : 'help');
            }}
            className="px-3 py-2 text-sm font-medium text-slate-900 dark:text-slate-50 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition"
          >
            Help
          </button>
          {openMenu === 'help' && (
            <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg shadow-lg z-50">
              <button className="w-full text-left px-4 py-2 text-sm text-slate-900 dark:text-slate-50 hover:bg-blue-500 hover:text-white transition">
                <div className="flex items-center gap-2">
                  <HelpCircle size={16} />
                  Documentation
                </div>
              </button>
              <button className="w-full text-left px-4 py-2 text-sm text-slate-900 dark:text-slate-50 hover:bg-blue-500 hover:text-white transition">
                <div className="flex items-center gap-2">
                  <Settings size={16} />
                  Settings
                </div>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Status Bar */}
      <div className="flex items-center gap-4 text-xs text-slate-600 dark:text-slate-400">
        <span>Queries: {queries.length}</span>
        <span className="w-1 h-1 rounded-full bg-slate-400 dark:bg-slate-600" />
        <span className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          Connected
        </span>
      </div>
    </div>
  );
}
