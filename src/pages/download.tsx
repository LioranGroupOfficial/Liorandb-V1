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
  schemaVersion?: number;
  defaultChannel?: string;
  channels?: unknown;

  // legacy fields (kept for backward compatibility)
  currentVersion?: string;
  earlyProductionVersion?: string;
  windows?: unknown[];
};

type WindowsEntryLinks = {
  version?: string;
  ['zip-url']?: string;
};

type ArtifactObj = {
  url?: string;
};

type ChannelV1 = {
  version?: string;
  platforms?: {
    windows?: {
      artifacts?: unknown;
    };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getChannel(data: ReleaseJson | null): ChannelV1 | null {
  if (!data || data.schemaVersion !== 1) return null;
  if (!isRecord(data.channels)) return null;

  const defaultChannel = typeof data.defaultChannel === 'string' ? data.defaultChannel : null;
  const channels = data.channels as Record<string, unknown>;
  const candidate =
    (defaultChannel && channels[defaultChannel]) ||
    channels.earlyProduction ||
    channels.stable ||
    channels.beta ||
    Object.values(channels)[0];

  return (isRecord(candidate) ? (candidate as ChannelV1) : null) ?? null;
}

function getWindowsZipUrl(data: ReleaseJson | null): WindowsRelease | null {
  // v1 schema (scalable):
  // channels[channel].platforms.windows.artifacts.zip.url
  const channel = getChannel(data);
  const v1Version = channel?.version ?? data?.currentVersion ?? data?.earlyProductionVersion ?? '';
  const artifacts = channel?.platforms?.windows?.artifacts;
  if (artifacts) {
    // object form: { zip: { url } }
    if (isRecord(artifacts)) {
      const zipObj = artifacts.zip;
      const zipUrl = isRecord(zipObj) ? (zipObj as ArtifactObj).url : undefined;
      if (zipUrl) {
        return { version: v1Version, url: zipUrl };
      }
    }

    // array form: [{ type: 'zip', url }, ...]
    if (Array.isArray(artifacts)) {
      for (const item of artifacts) {
        if (!isRecord(item)) continue;
        const type = typeof item.type === 'string' ? item.type.toLowerCase() : '';
        const url = typeof item.url === 'string' ? item.url : '';
        if (url && type === 'zip') {
          return { version: v1Version, url };
        }
      }
    }
  }

  const windowsRaw = data?.windows ?? [];

  // New schema support:
  // windows: [{ version, "zip-url": "..." }]
  for (const entry of windowsRaw) {
    const obj = entry as WindowsEntryLinks;
    const zipUrl = obj?.['zip-url'];
    if (zipUrl) {
      const version = obj?.version ?? data?.currentVersion ?? data?.earlyProductionVersion ?? '';
      return { version, url: zipUrl };
    }
  }

  // Legacy schema support (only zip):
  // windows: [{ version, url }, ...]
  const releases = windowsRaw
    .filter((r) => typeof r === 'object' && r !== null)
    .map((r) => r as Partial<WindowsRelease>)
    .filter((r): r is WindowsRelease => typeof r.url === 'string' && typeof r.version === 'string');

  return releases[0] ?? null;
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

  const winZip = useMemo(() => getWindowsZipUrl(releaseData), [releaseData]);
  const headlineVersion = releaseData?.currentVersion ?? winZip?.version;

  return (
    <Layout title="Download" description="Download LioranDB and get started via Windows ZIP, npm, pip, or Docker.">
      <header className={clsx('hero hero--primary', styles.heroBanner)}>
        <div className="container">
          <Heading as="h1" className="hero__title">
            Download & Install
          </Heading>
          <p className="hero__subtitle">
            Choose your preferred installation method{headlineVersion ? ` (v${headlineVersion})` : ''}.
          </p>
        </div>
      </header>

      <main className="container margin-vert--lg">
        <div className={clsx(styles.grid4)}>
          {/* Windows ZIP Card */}
          <div className={styles.card}>
            <div className={styles.cardIcon}>💾</div>
            <Heading as="h2" className={styles.cardTitle}>
              Windows ZIP
            </Heading>
            <p className={styles.muted}>
              Portable executable
            </p>
            <p className={styles.description}>
              Download and extract to any folder. Self-contained, no installation required.
            </p>
            <p className={styles.muted}>
              {winZip?.version ? `Version: v${winZip.version}` : 'Version: loading…'}
            </p>
            {winZip?.url ? (
              <a className="button button--primary button--lg" href={winZip.url} style={{ marginBottom: '0.4rem' }}>
                Download ZIP
              </a>
            ) : (
              <span className={clsx('button button--primary button--lg', 'button--disabled')} aria-disabled="true" style={{ marginBottom: '0.4rem' }}>
                Download ZIP
              </span>
            )}
            <Link className="button button--secondary button--block" to="/docs/server/server-quickstart">
              Setup guide
            </Link>
            {loadError && (
              <p className={styles.finePrint}>
                Couldn&apos;t load <code>/release.json</code> ({loadError}).
              </p>
            )}
          </div>

          {/* npm Card */}
          <div className={styles.card}>
            <div className={styles.cardIcon}>📦</div>
            <Heading as="h2" className={styles.cardTitle}>
              npm (Recommended)
            </Heading>
            <p className={styles.muted}>
              Node.js package manager
            </p>
            <p className={styles.description}>
              Install globally and get both the server and CLI tools.
            </p>
            <CodeBlock language="bash">{`npm i -g @liorandb/db\nldb-serve`}</CodeBlock>
            <Link className="button button--secondary button--block" to="/docs/server/server-quickstart">
              Setup guide
            </Link>
          </div>

          {/* pip Card */}
          <div className={styles.card}>
            <div className={styles.cardIcon}>🐍</div>
            <Heading as="h2" className={styles.cardTitle}>
              pip (Python)
            </Heading>
            <p className={styles.muted}>
              Python package manager
            </p>
            <p className={styles.description}>
              Installs Windows portable ZIP with auto-PATH setup.
            </p>
            <CodeBlock language="bash">{`pip install liorandb-server-windows\nliorandb-server-windows`}</CodeBlock>
            <Link className="button button--secondary button--block" to="/docs/server/server-quickstart">
              Setup guide
            </Link>
          </div>

          {/* Docker Card */}
          <div className={styles.card}>
            <div className={styles.cardIcon}>🐳</div>
            <Heading as="h2" className={styles.cardTitle}>
              Docker
            </Heading>
            <p className={styles.muted}>
              Container image
            </p>
            <p className={styles.description}>
              Run LioranDB in a containerized environment.
            </p>
            <CodeBlock language="bash">{`docker run -d -p 4000:4000 -v ".\\liorandb-data:/root/LioranDB" --name liorandb ldep/liorandb:latest`}</CodeBlock>
            <Link className="button button--secondary button--block" to="/docs/server/production#docker-example">
              Docker guide
            </Link>
          </div>
        </div>

        {/* Documentation Links Section */}
        <div className={clsx('margin-top--xl', styles.docsSection)}>
          <Heading as="h2" className="text--center">
            📚 Documentation
          </Heading>
          <div className={clsx(styles.gridDocs)}>
            <Link className="button button--link" to="/docs/server/server-quickstart">
              → Server Quickstart
            </Link>
            <Link className="button button--link" to="/docs/server/production">
              → Production Setup
            </Link>
            <Link className="button button--link" to="/docs/embedded/getting-started">
              → Embedded Database
            </Link>
            <Link className="button button--link" to="/docs/driver/getting-started">
              → Node.js Driver
            </Link>
            <Link className="button button--link" to="/docs/driver-python/getting-started">
              → Python Driver
            </Link>
            <Link className="button button--link" to="/docs/server/users">
              → Users & Auth
            </Link>
          </div>
        </div>
      </main>
    </Layout>
  );
}
