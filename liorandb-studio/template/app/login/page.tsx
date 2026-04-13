'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Database, KeyRound, ShieldCheck, Sparkles } from 'lucide-react';
import { useAppStore } from '@/store';
import { LioranDBService } from '@/lib/lioran';
import { formatConnectionUri, formatHttpUri, parseConnectionUri } from '@/lib/utils';
import { useToast } from '@/components/Toast';

type LoginMode = 'uri' | 'credentials' | 'token';

export default function LoginPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const { setLoggedIn } = useAppStore();

  const [mode, setMode] = useState<LoginMode>('credentials');
  const [isLoading, setIsLoading] = useState(false);

  const [uri, setUri] = useState('lioran://admin:password123@localhost:4000');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('4000');
  const [protocol, setProtocol] = useState<'http' | 'https'>('http');
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [tokenUri, setTokenUri] = useState('http://localhost:4000');
  const [token, setToken] = useState('');

  useEffect(() => {
    const savedUri = localStorage.getItem('liorandb_uri');
    const savedToken = localStorage.getItem('liorandb_token');

    if (savedUri && savedToken) {
      void restoreSession(savedUri, savedToken);
    }
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

  return (
    <main className="relative min-h-screen overflow-auto p-4 md:p-8">
      <div className="subtle-grid absolute inset-0 opacity-30" />
      <div className="relative mx-auto grid min-h-[calc(100vh-2rem)] max-w-7xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="glass-panel animate-fade-up flex flex-col justify-between rounded-[32px] p-8 lg:p-12">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
              <Sparkles className="h-4 w-4 text-[var(--accent)]" />
              LioranDB Studio Template
            </div>
            <h1 className="max-w-2xl text-4xl font-semibold leading-tight text-white md:text-6xl">
              A sharper database cockpit for LioranDB.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-[var(--muted)] md:text-lg">
              Connect with the new <code className="rounded bg-white/5 px-2 py-1 font-mono text-sm">@liorandb/driver</code>,
              authenticate cleanly, and browse collections from a workspace designed to feel closer to modern MongoDB tools.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <FeatureCard
              icon={<KeyRound className="h-5 w-5 text-[var(--accent)]" />}
              title="Real auth flow"
              description="URI login, username/password, or existing JWT token reuse."
            />
            <FeatureCard
              icon={<Database className="h-5 w-5 text-[var(--accent-secondary)]" />}
              title="Explorer-first UX"
              description="Browse databases, collections, document previews, and query results in one flow."
            />
            <FeatureCard
              icon={<ShieldCheck className="h-5 w-5 text-[var(--warning)]" />}
              title="Developer friendly"
              description="Cleaner defaults, stronger validation, and faster onboarding to a running host."
            />
          </div>
        </section>

        <section className="glass-panel-strong animate-fade-up rounded-[32px] p-6 md:p-8">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-white">Connect to your host</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Start with credentials for local development, use a <code className="font-mono">lioran://</code> URI for one-step login,
              or attach an existing JWT for hosted sessions.
            </p>
          </div>

          <div className="mb-6 grid grid-cols-3 gap-2 rounded-2xl border border-white/8 bg-black/20 p-1">
            {(['credentials', 'uri', 'token'] as LoginMode[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className={`rounded-xl px-3 py-2 text-sm transition ${
                  mode === item
                    ? 'bg-white text-slate-950'
                    : 'text-[var(--muted)] hover:bg-white/6 hover:text-white'
                }`}
              >
                {item === 'credentials' ? 'Credentials' : item === 'uri' ? 'URI' : 'Token'}
              </button>
            ))}
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            {mode === 'credentials' && (
              <>
                <div className="grid gap-4 sm:grid-cols-[120px_1fr_120px]">
                  <Field label="Protocol">
                    <select
                      value={protocol}
                      onChange={(event) => setProtocol(event.target.value as 'http' | 'https')}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition focus:border-[var(--accent)]"
                    >
                      <option value="http">http</option>
                      <option value="https">https</option>
                    </select>
                  </Field>
                  <Field label="Host">
                    <input
                      value={host}
                      onChange={(event) => setHost(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-[var(--accent)]"
                      placeholder="localhost"
                    />
                  </Field>
                  <Field label="Port">
                    <input
                      value={port}
                      onChange={(event) => setPort(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-[var(--accent)]"
                      placeholder="4000"
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Username">
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-[var(--accent)]"
                      placeholder="admin"
                    />
                  </Field>
                  <Field label="Password">
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-[var(--accent)]"
                      placeholder="password123"
                    />
                  </Field>
                </div>
              </>
            )}

            {mode === 'uri' && (
              <Field label="Connection URI">
                <input
                  value={uri}
                  onChange={(event) => setUri(event.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[var(--accent)]"
                  placeholder="lioran://admin:password123@localhost:4000"
                />
              </Field>
            )}

            {mode === 'token' && (
              <>
                <Field label="Base URL">
                  <input
                    value={tokenUri}
                    onChange={(event) => setTokenUri(event.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[var(--accent)]"
                    placeholder="http://localhost:4000"
                  />
                </Field>
                <Field label="JWT token">
                  <textarea
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    className="min-h-32 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 font-mono text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[var(--accent)]"
                    placeholder="eyJhbGciOi..."
                  />
                </Field>
              </>
            )}

            <button
              type="submit"
              disabled={
                isLoading ||
                (mode === 'credentials' && (!host || !port || !username || !password)) ||
                (mode === 'uri' && !uri) ||
                (mode === 'token' && (!tokenUri || !token))
              }
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,var(--accent),var(--accent-secondary))] px-4 py-3 font-medium text-slate-950 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>{isLoading ? 'Connecting...' : 'Open Studio'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          <div className="mt-6 rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-[var(--muted)]">
            First-time host setup:
            <div className="mt-2 rounded-xl bg-black/30 p-3 font-mono text-xs text-slate-200">
              ldb-cli 'admin.create("admin","password123")'
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[24px] border border-white/8 bg-black/20 p-5">
      <div className="mb-4 inline-flex rounded-2xl border border-white/10 bg-white/5 p-3">{icon}</div>
      <h3 className="text-base font-semibold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{description}</p>
    </div>
  );
}
