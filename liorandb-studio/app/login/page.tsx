'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store';
import { LioranDBService } from '@/lib/lioran';
import { parseConnectionUri } from '@/lib/utils';
import { useToast } from '@/components/Toast';

export default function LoginPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const { setLoggedIn } = useAppStore();

  const [uri, setUri] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [host, setHost] = useState('localhost');
  const [port, setPort] = useState('4000');

  useEffect(() => {
    // Load saved URI from localStorage
    const savedUri = localStorage.getItem('liorandb_uri');
    const savedToken = localStorage.getItem('liorandb_token');

    if (savedUri && savedToken) {
      // Try to auto-login
      attemptAutoLogin(savedUri, savedToken);
    }
  }, []);

  async function attemptAutoLogin(uri: string, token: string) {
    try {
      setIsLoading(true);
      LioranDBService.initialize(uri);

      // Test connection
      const databases = await LioranDBService.listDatabases();

      setLoggedIn(true, token, uri);
      useAppStore.setState({ databases });
      addToast('Connected successfully', 'success');
      router.push('/dashboard');
    } catch (error) {
      localStorage.removeItem('liorandb_token');
      localStorage.removeItem('liorandb_uri');
      addToast(`Connection failed: ${error}`, 'error');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();

    const loginUri = showAdvanced
      ? `lioran://${username}:${password}@${host}:${port}`
      : uri;

    if (!loginUri) {
      addToast('Please enter a connection URI', 'warning');
      return;
    }

    try {
      setIsLoading(true);

      // Validate URI format
      try {
        parseConnectionUri(loginUri);
      } catch (err) {
        addToast(String(err), 'error');
        return;
      }

      // Initialize client
      await LioranDBService.initialize(loginUri);

      // List databases to verify connection
      const databases = await LioranDBService.listDatabases();

      // Store session (in a real app, you'd get a token from the server)
      const token = `token_${Date.now()}`;

      setLoggedIn(true, token, loginUri);
      useAppStore.setState({ databases });

      addToast('Connected successfully', 'success');
      router.push('/dashboard');
    } catch (error) {
      addToast(`Login failed: ${error}`, 'error');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 flex items-center justify-center p-4">
      {/* Background Effect */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-emerald-500/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-cyan-500/5 rounded-full blur-3xl" />
      </div>

      {/* Login Card */}
      <div className="relative w-full max-w-md">
        <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="px-8 pt-8 pb-6 border-b border-slate-800">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-gradient-to-br from-emerald-400 to-cyan-400 rounded-lg flex items-center justify-center">
                <span className="text-slate-900 font-bold text-lg">⚡</span>
              </div>
              <h1 className="text-2xl font-bold text-slate-100">LioranDB</h1>
            </div>
            <p className="text-slate-400 text-sm">Database Studio</p>
          </div>

          {/* Form */}
          <form onSubmit={handleLogin} className="px-8 py-8 space-y-6">
            {!showAdvanced ? (
              // Quick Connect
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Connection URI
                </label>
                <input
                  type="text"
                  value={uri}
                  onChange={(e) => setUri(e.target.value)}
                  placeholder="lioran://admin:password@localhost:4000"
                  className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                  disabled={isLoading}
                />
              </div>
            ) : (
              // Advanced Connect
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                    disabled={isLoading}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                    disabled={isLoading}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Host
                    </label>
                    <input
                      type="text"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                      disabled={isLoading}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      Port
                    </label>
                    <input
                      type="text"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      className="w-full bg-slate-800/50 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition"
                      disabled={isLoading}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Toggle Advanced */}
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-sm text-emerald-400 hover:text-emerald-300 transition"
              disabled={isLoading}
            >
              {showAdvanced ? '← Back to Quick Connect' : 'Advanced Options →'}
            </button>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading || (!showAdvanced && !uri) || (showAdvanced && !password)}
              className="w-full bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-semibold py-3 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Connecting...' : 'Connect to LioranDB'}
            </button>
          </form>

          {/* Footer */}
          <div className="px-8 py-6 bg-slate-800/30 border-t border-slate-800">
            <p className="text-xs text-slate-400 text-center">
              Default: <code className="bg-slate-900 px-2 py-1 rounded">lioran://admin:password@localhost:4000</code>
            </p>
          </div>
        </div>

        {/* Beta Badge */}
        <div className="absolute -top-3 right-4 bg-amber-500 text-slate-900 px-3 py-1 rounded-full text-xs font-semibold">
          BETA
        </div>
      </div>
    </div>
  );
}
