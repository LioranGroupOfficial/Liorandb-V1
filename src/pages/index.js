"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Home;
var clsx_1 = require("clsx");
var Link_1 = require("@docusaurus/Link");
var useDocusaurusContext_1 = require("@docusaurus/useDocusaurusContext");
var Layout_1 = require("@theme/Layout");
var HomepageFeatures_1 = require("@site/src/components/HomepageFeatures");
var Heading_1 = require("@theme/Heading");
var Tabs_1 = require("@theme/Tabs");
var TabItem_1 = require("@theme/TabItem");
var CodeBlock_1 = require("@theme/CodeBlock");
var fi_1 = require("react-icons/fi");
var index_module_css_1 = require("./index.module.css");
function HomepageHeader() {
    var siteConfig = (0, useDocusaurusContext_1.default)().siteConfig;
    return (<header className={(0, clsx_1.default)('hero hero--primary', index_module_css_1.default.heroBanner)}>
      <div className="container">
        <Heading_1.default as="h1" className="hero__title">
          {siteConfig.title}
        </Heading_1.default>
        <p className="hero__subtitle">
          Embedded, file-based database for NodeJs.
        </p>
        <div className={index_module_css_1.default.buttons}>
          <Link_1.default className="button button--secondary button--lg" to="/docs/embedded/getting-started" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            {/* 2. Add the icon before the text */}
            <fi_1.FiZap /> Embedded quickstart
          </Link_1.default>
          <Link_1.default className="button button--secondary button--lg" to="/docs/server/server-quickstart" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
            {/* 3. Add the icon before the text */}
            <fi_1.FiServer /> Server quickstart
          </Link_1.default>
        </div>
        <div className={index_module_css_1.default.codeSample}>
          <Tabs_1.default groupId="language" defaultValue="ts" values={[
            { label: '', value: 'ts' },
            { label: '', value: 'js' },
        ]}>
            <TabItem_1.default value="ts">
              <CodeBlock_1.default language="ts">{"import { LioranManager } from \"@liorandb/core\";\n\nconst manager = new LioranManager({ rootPath: \"./data\" });\nconst db = await manager.db(\"app\");\nconst users = db.collection<{ email: string }>(\"users\");\n\nawait users.insertOne({ email: \"dev@lioran.dev\" });\nconsole.log(await users.findOne({ email: \"dev@lioran.dev\" }));\n\nawait manager.close();"}</CodeBlock_1.default>
            </TabItem_1.default>
            <TabItem_1.default value="js">
              <CodeBlock_1.default language="js">{"import { LioranManager } from \"@liorandb/core\";\n\nconst manager = new LioranManager({ rootPath: \"./data\" });\nconst db = await manager.db(\"app\");\nconst users = db.collection(\"users\");\n\nawait users.insertOne({ email: \"dev@lioran.dev\" });\nconsole.log(await users.findOne({ email: \"dev@lioran.dev\" }));\n\nawait manager.close();"}</CodeBlock_1.default>
            </TabItem_1.default>
          </Tabs_1.default>
        </div>
      </div>
    </header>);
}
function Home() {
    var siteConfig = (0, useDocusaurusContext_1.default)().siteConfig;
    return (<Layout_1.default title={siteConfig.title} description="Embedded file-based database for Node.js with optional server + driver.">
      <HomepageHeader />
      <main>
        <HomepageFeatures_1.default />
      </main>
    </Layout_1.default>);
}
