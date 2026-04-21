'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Database, Moon, Sun } from 'lucide-react';
import { useAppStore } from '@/store';
import { LioranDBService } from '@/lib/lioran';
import { formatConnectionUri, formatHttpUri, parseConnectionUri } from '@/lib/utils';
import { useToast } from '@/components/Toast';
import { useThemeStore } from '@/store/theme';

type LoginMode = 'credentials' | 'uri' | 'token';

export default function LoginPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const { setLoggedIn } = useAppStore();
  const { theme, toggleTheme } = useThemeStore();

  const [mode, setMode] = useState<LoginMode>('credentials');
  const [isLoading, setIsLoading] = useState(false);

  const [uri, setUri] = useState('lioran://admin:admin@localhost:4000');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('4000');
  const [protocol, setProtocol] = useState<'http' | 'https'>('http');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [tokenUri, setTokenUri] = useState('http://localhost:4000');
  const [token, setToken] = useState('');

  useEffect(() => {
    const savedUri = localStorage.getItem('liorandb_uri');
    const savedToken = localStorage.getItem('liorandb_token');

    if (savedUri && savedToken) {
      void restoreSession(savedUri, savedToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function restoreSession(savedUri: string, savedToken: string) {
    try {
      setIsLoading(true);
      const session = await LioranDBService.restore(savedUri, savedToken);
      await LioranDBService.listDatabases();

      setLoggedIn({
        loggedIn: true,
        token: session.token,
        uri: session.uri,
        user: session.user,
      });

      router.replace('/dashboard');
    } catch {
      localStorage.removeItem('liorandb_uri');
      localStorage.removeItem('liorandb_token');
      localStorage.removeItem('liorandb_user');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();

    try {
      setIsLoading(true);

      let session;

      if (mode === 'uri') {
        parseConnectionUri(uri);
        session = await LioranDBService.initialize(uri, { mode: 'uri' });
      } else if (mode === 'credentials') {
        const baseUri = formatHttpUri(protocol, host, Number(port));
        parseConnectionUri(baseUri);
        session = await LioranDBService.initialize(baseUri, {
          mode: 'credentials',
          username,
          password,
        });
        setUri(formatConnectionUri(username, password, host, Number(port)));
      } else {
        parseConnectionUri(tokenUri);
        session = await LioranDBService.initialize(tokenUri, {
          mode: 'token',
          token,
        });
      }

      const databases = await LioranDBService.listDatabases();

      useAppStore.setState({ databases });
      setLoggedIn({
        loggedIn: true,
        token: session.token,
        uri: session.uri,
        user: session.user,
      });

      addToast('Connected to LioranDB host', 'success');
      router.replace('/dashboard');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Connection failed', 'error');
    } finally {
      setIsLoading(false);
    }
  }

  const isSubmitDisabled =
    isLoading ||
    (mode === 'credentials' && (!host || !port || !username || !password)) ||
    (mode === 'uri' && !uri) ||
    (mode === 'token' && (!tokenUri || !token));

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-900 dark:bg-black dark:text-slate-100 md:p-8">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-xl items-center justify-center md:min-h-[calc(100vh-4rem)]">
        <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950 md:p-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-black">
                <Database className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">LioranDB Studio</h1>
                <p className="text-sm text-slate-600 dark:text-slate-400">Connect to a LioranDB host</p>
              </div>
            </div>

            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
              title="Toggle theme"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>

          <div className="mb-6 flex gap-2 rounded-lg bg-slate-100 p-1 dark:bg-slate-900">
            {(['credentials', 'uri', 'token'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className={`flex-1 rounded-md px-3 py-2 text-sm transition ${
                  mode === item
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-black dark:text-slate-100'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {item === 'credentials' ? 'Credentials' : item === 'uri' ? 'URI' : 'Token'}
              </button>
            ))}
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            {mode === 'credentials' ? (
              <>
                <div className="grid gap-4 sm:grid-cols-[130px_1fr_120px]">
                  <Field label="Protocol">
                    <select
                      value={protocol}
                      onChange={(event) => setProtocol(event.target.value as 'http' | 'https')}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-black dark:text-slate-100"
                    >
                      <option value="http">http</option>
                      <option value="https">https</option>
                    </select>
                  </Field>
                  <Field label="Host">
                    <input
                      value={host}
                      onChange={(event) => setHost(event.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-black dark:text-slate-100 dark:placeholder:text-slate-600"
                      placeholder="localhost"
                    />
                  </Field>
                  <Field label="Port">
                    <input
                      value={port}
                      onChange={(event) => setPort(event.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-black dark:text-slate-100 dark:placeholder:text-slate-600"
                      placeholder="4000"
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Username">
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-black dark:text-slate-100 dark:placeholder:text-slate-600"
                      placeholder="admin"
                    />
                  </Field>
                  <Field label="Password">
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-black dark:text-slate-100 dark:placeholder:text-slate-600"
                      placeholder="admin"
                    />
                  </Field>
                </div>
              </>
            ) : null}

            {mode === 'uri' ? (
              <Field label="Connection URI">
                <input
                  value={uri}
                  onChange={(event) => setUri(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-black dark:text-slate-100 dark:placeholder:text-slate-600"
                  placeholder="lioran://admin:admin@localhost:4000"
                />
              </Field>
            ) : null}

            {mode === 'token' ? (
              <>
                <Field label="Base URL">
                  <input
                    value={tokenUri}
                    onChange={(event) => setTokenUri(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-black dark:text-slate-100 dark:placeholder:text-slate-600"
                    placeholder="http://localhost:4000"
                  />
                </Field>
                <Field label="JWT token">
                  <textarea
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    className="min-h-32 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-800 dark:bg-black dark:text-slate-100 dark:placeholder:text-slate-600"
                    placeholder="eyJhbGciOi..."
                  />
                </Field>
              </>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitDisabled}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>{isLoading ? 'Connecting...' : 'Open Studio'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-black dark:text-slate-300">
            Default host user (first run): <span className="font-mono">admin / admin</span>
          </div>
        </div>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}

