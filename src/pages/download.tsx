import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import Link from '@docusaurus/Link';
import CodeBlock from '@theme/CodeBlock';

import styles from './download.module.css';

type WindowsRelease = {
  version: string;
  url: string;
  type?: 'zip' | 'exe' | string;
};

type ReleaseJson = {
  currentVersion?: string;
  earlyProductionVersion?: string;
  windows?: WindowsRelease[];
};

type WindowsDownloads = {
  zip: WindowsRelease | null;
  exe: WindowsRelease | null;
};

function inferWindowsType(rel: WindowsRelease): 'zip' | 'exe' | null {
  const explicit = (rel.type ?? '').toLowerCase();
  if (explicit === 'zip' || explicit === 'exe') return explicit;
  const url = rel.url.toLowerCase();
  if (url.endsWith('.zip')) return 'zip';
  if (url.endsWith('.exe')) return 'exe';
  return null;
}

function pickWindowsDownloads(data: ReleaseJson | null): WindowsDownloads {
  const releases = (data?.windows ?? []).filter((r) => Boolean(r?.url));
  let zip: WindowsRelease | null = null;
  let exe: WindowsRelease | null = null;

  for (const rel of releases) {
    const kind = inferWindowsType(rel);
    if (kind === 'zip' && !zip) zip = rel;
    if (kind === 'exe' && !exe) exe = rel;
  }

  if (!zip) zip = releases.find((r) => !inferWindowsType(r)) ?? null;
  if (!exe) exe = releases.find((r) => !inferWindowsType(r) && r !== zip) ?? null;

  return { zip, exe };
}

export default function DownloadPage(): ReactNode {
  const [releaseData, setReleaseData] = useState<ReleaseJson | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [winChoice, setWinChoice] = useState<'zip' | 'exe'>('zip');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/release.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ReleaseJson;
        if (!cancelled) setReleaseData(data);
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Failed to load release.json');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const windows = useMemo(() => pickWindowsDownloads(releaseData), [releaseData]);
  const headlineVersion = releaseData?.currentVersion ?? windows.zip?.version ?? windows.exe?.version;

  useEffect(() => {
    if (windows.zip) setWinChoice('zip');
    else if (windows.exe) setWinChoice('exe');
  }, [windows.zip, windows.exe]);

  const chosenWindows = winChoice === 'zip' ? windows.zip : windows.exe;

  return (
    <Layout title="Download" description="Download Liorandb for Windows and get started with the server via npm.">
      <header className={clsx('hero hero--primary', styles.heroBanner)}>
        <div className="container">
          <Heading as="h1" className="hero__title">
            Download
          </Heading>
          <p className="hero__subtitle">
            Windows installer + npm server package{headlineVersion ? ` (v${headlineVersion})` : ''}.
          </p>
        </div>
      </header>

      <main className="container margin-vert--lg">
        <div className={clsx('row', styles.rowTight, styles.cards)}>
          <div className="col col--6">
            <div className={styles.card}>
              <Heading as="h2" className={styles.cardTitle}>
                Windows Download
              </Heading>
              <p className={styles.muted}>
                {chosenWindows?.version ? `Version: v${chosenWindows.version}` : 'Version: loading…'}
              </p>

              <div className={styles.actions}>
                <div className="button-group" role="group" aria-label="Windows download format">
                  <button
                    type="button"
                    className={clsx('button', winChoice === 'zip' ? 'button--primary' : 'button--secondary')}
                    onClick={() => setWinChoice('zip')}
                    disabled={!windows.zip}
                  >
                    ZIP (portable)
                  </button>
                  <button
                    type="button"
                    className={clsx('button', winChoice === 'exe' ? 'button--primary' : 'button--secondary')}
                    onClick={() => setWinChoice('exe')}
                    disabled={!windows.exe}
                  >
                    EXE (installer)
                  </button>
                </div>

                {chosenWindows?.url ? (
                  <a className="button button--primary button--lg" href={chosenWindows.url}>
                    Download {winChoice.toUpperCase()}
                  </a>
                ) : (
                  <span className={clsx('button button--primary button--lg', 'button--disabled')} aria-disabled="true">
                    Download {winChoice.toUpperCase()}
                  </span>
                )}
                <Link className="button button--secondary button--lg" to="/docs/server/server-quickstart">
                  Server quickstart
                </Link>
              </div>

              {winChoice === 'zip' && (
                <>
                  <p className={styles.finePrint}>
                    After downloading, unzip it somewhere permanent (example: <code>C:\Program Files\LioranDB</code> or{' '}
                    <code>C:\LioranDB</code>), then add that folder to your system <code>PATH</code>.
                  </p>
                  <CodeBlock language="text">{`Windows steps (portable ZIP):
1) Download ZIP
2) Unzip to a folder (e.g. C:\\LioranDB)
3) Add that folder to PATH (Environment Variables)
4) Open a new terminal (PATH refresh)
5) Run: ldb-serve`}</CodeBlock>
                </>
              )}

              {loadError ? (
                <p className={styles.finePrint}>
                  Couldn&apos;t load <code>/release.json</code> ({loadError}). Showing limited info.
                </p>
              ) : (
                <p className={styles.finePrint}>
                  This button is driven by <code>static/release.json</code>.
                </p>
              )}
            </div>
          </div>

          <div className="col col--6">
            <div className={styles.card}>
              <Heading as="h2" className={styles.cardTitle}>
                Install via npm (recommended)
              </Heading>
              <p className={styles.muted}>
                Install the server + CLI globally, then follow the quickstart.
              </p>
              <CodeBlock language="bash">{`npm i -g @liorandb/db\nldb-serve`}</CodeBlock>
              <div className={styles.actions}>
                <Link className="button button--secondary" to="/docs/server/server-quickstart">
                  Continue to quickstart
                </Link>
                <a className="button button--link" href="https://db.lioransolutions.com/docs/server/server-quickstart">
                  Open docs site
                </a>
              </div>
              <p className={styles.finePrint}>macOS and Linux downloads are coming soon.</p>
            </div>
          </div>
        </div>
      </main>
    </Layout>
  );
}
