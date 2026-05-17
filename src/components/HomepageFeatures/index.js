"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = HomepageFeatures;
var clsx_1 = require("clsx");
var Heading_1 = require("@theme/Heading");
var styles_module_css_1 = require("./styles.module.css");
var FeatureList = [
    {
        title: 'Embedded by default',
        Svg: require('@site/static/img/undraw_docusaurus_mountain.svg').default,
        description: (<>
        Use <code>@liorandb/core</code> as a file-based database inside Node.js scripts and apps — no server required.
      </>),
    },
    {
        title: 'Optional server + CLI',
        Svg: require('@site/static/img/undraw_docusaurus_tree.svg').default,
        description: (<>
        Install <code>@liorandb/db</code> to run <code>ldb-serve</code>, manage users with <code>ldb-users</code>, and use the interactive shell <code>ldb-cli</code>.
      </>),
    },
    {
        title: 'TypeScript-first driver',
        Svg: require('@site/static/img/undraw_docusaurus_react.svg').default,
        description: (<>
        Use <code>@liorandb/driver</code> to talk to a server over HTTP with prebuilt types and a small API surface.
      </>),
    },
];
function Feature(_a) {
    var title = _a.title, Svg = _a.Svg, description = _a.description;
    return (<div className={(0, clsx_1.default)('col col--4')}>
      <div className="text--center">
        <Svg className={styles_module_css_1.default.featureSvg} role="img"/>
      </div>
      <div className="text--center padding-horiz--md">
        <Heading_1.default as="h3">{title}</Heading_1.default>
        <p>{description}</p>
      </div>
    </div>);
}
function HomepageFeatures() {
    return (<section className={styles_module_css_1.default.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map(function (props, idx) { return (<Feature key={idx} {...props}/>); })}
        </div>
      </div>
    </section>);
}
