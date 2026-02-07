import { create } from 'zustand';

export type Theme = 'light' | 'dark';

interface ThemeStore {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  loadFromStorage: () => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: 'dark',

  setTheme: (theme: Theme) => {
    set({ theme });
    if (typeof window !== 'undefined') {
      localStorage.setItem('liorandb_theme', theme);
      // Update document class for Tailwind
      const html = document.documentElement;
      if (theme === 'dark') {
        html.classList.add('dark');
      } else {
        html.classList.remove('dark');
      }
    }
  },

  toggleTheme: () => {
    set((state) => {
      const newTheme = state.theme === 'dark' ? 'light' : 'dark';
      if (typeof window !== 'undefined') {
        localStorage.setItem('liorandb_theme', newTheme);
        const html = document.documentElement;
        if (newTheme === 'dark') {
          html.classList.add('dark');
        } else {
          html.classList.remove('dark');
        }
      }
      return { theme: newTheme };
    });
  },

  loadFromStorage: () => {
    if (typeof window !== 'undefined') {
      const savedTheme = localStorage.getItem('liorandb_theme') as Theme | null;
      const theme = savedTheme || 'dark';
      set({ theme });
      const html = document.documentElement;
      if (theme === 'dark') {
        html.classList.add('dark');
      } else {
        html.classList.remove('dark');
      }
    }
  },
}));
