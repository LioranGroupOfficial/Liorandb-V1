import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Heading from '@theme/Heading';
import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';
import CodeBlock from '@theme/CodeBlock';
import { FiZap, FiServer } from 'react-icons/fi';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">
          Embedded, file-based database for NodeJs.
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/embedded/getting-started"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            {/* 2. Add the icon before the text */}
            <FiZap /> Embedded quickstart
          </Link>
          <Link
            className="button button--secondary button--lg"
            to="/docs/server/server-quickstart"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            {/* 3. Add the icon before the text */}
            <FiServer /> Server quickstart
          </Link>
        </div>
        <div className={styles.codeSample}>
          <Tabs
            groupId="language"
            defaultValue="ts"
            values={[
              {label: '', value: 'ts'},
              {label: '', value: 'js'},
            ]}>
            <TabItem value="ts">
              <CodeBlock language="ts">{`import { LioranManager } from "@liorandb/core";

const manager = new LioranManager({ rootPath: "./data" });
const db = await manager.db("app");
const users = db.collection<{ email: string }>("users");

await users.insertOne({ email: "dev@lioran.dev" });
console.log(await users.findOne({ email: "dev@lioran.dev" }));

await manager.close();`}</CodeBlock>
            </TabItem>
            <TabItem value="js">
              <CodeBlock language="js">{`import { LioranManager } from "@liorandb/core";

const manager = new LioranManager({ rootPath: "./data" });
const db = await manager.db("app");
const users = db.collection("users");

await users.insertOne({ email: "dev@lioran.dev" });
console.log(await users.findOne({ email: "dev@lioran.dev" }));

await manager.close();`}</CodeBlock>
            </TabItem>
          </Tabs>
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="Embedded file-based database for Node.js with optional server + driver.">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
