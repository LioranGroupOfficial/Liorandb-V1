import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';

export default function Home(): JSX.Element {
  return (
    <Layout title="LioranDB" description="LioranDB documentation">
      <main style={{ padding: '3rem 1rem', maxWidth: 960, margin: '0 auto' }}>
        <h1 style={{ marginBottom: '0.75rem' }}>LioranDB</h1>
        <p style={{ marginTop: 0, marginBottom: '1.5rem' }}>
          Documentation for the server, embedded engine, and drivers.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <Link className="button button--primary" to="/docs/intro">
            Read the docs
          </Link>
          <Link className="button button--secondary" to="/download">
            Download
          </Link>
        </div>
      </main>
    </Layout>
  );
}

