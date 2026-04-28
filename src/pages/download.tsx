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
};

type ReleaseJson = {
  currentVersion?: string;
  earlyProductionVersion?: string;
  windows?: WindowsRelease[];
};

function pickWindowsRelease(data: ReleaseJson | null): WindowsRelease | null {
  const first = data?.windows?.[0];
  if (!first?.url) return null;
  return first;
}

export default function DownloadPage(): ReactNode {
  const [releaseData, setReleaseData] = useState<ReleaseJson | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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

  const windows = useMemo(() => pickWindowsRelease(releaseData), [releaseData]);
  const headlineVersion = releaseData?.currentVersion ?? windows?.version;

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
                Windows Installer
              </Heading>
              <p className={styles.muted}>
                {windows?.version ? `Installer version: v${windows.version}` : 'Installer version: loading…'}
              </p>

              <div className={styles.actions}>
                {windows?.url ? (
                  <a className="button button--primary button--lg" href={windows.url}>
                    Download for Windows
                  </a>
                ) : (
                  <span className={clsx('button button--primary button--lg', 'button--disabled')} aria-disabled="true">
                    Download for Windows
                  </span>
                )}
                <Link className="button button--secondary button--lg" to="/docs/server/server-quickstart">
                  Server quickstart
                </Link>
              </div>

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
