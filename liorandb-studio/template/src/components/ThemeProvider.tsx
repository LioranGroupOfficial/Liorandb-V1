'use client';

import React, { useEffect } from 'react';
import { useThemeStore } from '@/store/theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { loadFromStorage, theme } = useThemeStore();

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    const html = document.documentElement;
    if (theme === 'dark') {
      html.classList.add('dark');
    } else {
      html.classList.remove('dark');
    }
  }, [theme]);

  return <>{children}</>;
}
