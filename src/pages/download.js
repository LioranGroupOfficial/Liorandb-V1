"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = DownloadPage;
var react_1 = require("react");
var clsx_1 = require("clsx");
var Layout_1 = require("@theme/Layout");
var Heading_1 = require("@theme/Heading");
var Link_1 = require("@docusaurus/Link");
var CodeBlock_1 = require("@theme/CodeBlock");
var download_module_css_1 = require("./download.module.css");
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function getChannel(data) {
    var _a;
    if (!data || data.schemaVersion !== 1)
        return null;
    if (!isRecord(data.channels))
        return null;
    var defaultChannel = typeof data.defaultChannel === 'string' ? data.defaultChannel : null;
    var channels = data.channels;
    var candidate = (defaultChannel && channels[defaultChannel]) ||
        channels.earlyProduction ||
        channels.stable ||
        channels.beta ||
        Object.values(channels)[0];
    return (_a = (isRecord(candidate) ? candidate : null)) !== null && _a !== void 0 ? _a : null;
}
function getWindowsZipUrl(data) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    // v1 schema (scalable):
    // channels[channel].platforms.windows.artifacts.zip.url
    var channel = getChannel(data);
    var v1Version = (_c = (_b = (_a = channel === null || channel === void 0 ? void 0 : channel.version) !== null && _a !== void 0 ? _a : data === null || data === void 0 ? void 0 : data.currentVersion) !== null && _b !== void 0 ? _b : data === null || data === void 0 ? void 0 : data.earlyProductionVersion) !== null && _c !== void 0 ? _c : '';
    var artifacts = (_e = (_d = channel === null || channel === void 0 ? void 0 : channel.platforms) === null || _d === void 0 ? void 0 : _d.windows) === null || _e === void 0 ? void 0 : _e.artifacts;
    if (artifacts) {
        // object form: { zip: { url } }
        if (isRecord(artifacts)) {
            var zipObj = artifacts.zip;
            var zipUrl = isRecord(zipObj) ? zipObj.url : undefined;
            if (zipUrl) {
                return { version: v1Version, url: zipUrl };
            }
        }
        // array form: [{ type: 'zip', url }, ...]
        if (Array.isArray(artifacts)) {
            for (var _i = 0, artifacts_1 = artifacts; _i < artifacts_1.length; _i++) {
                var item = artifacts_1[_i];
                if (!isRecord(item))
                    continue;
                var type = typeof item.type === 'string' ? item.type.toLowerCase() : '';
                var url = typeof item.url === 'string' ? item.url : '';
                if (url && type === 'zip') {
                    return { version: v1Version, url: url };
                }
            }
        }
    }
    var windowsRaw = (_f = data === null || data === void 0 ? void 0 : data.windows) !== null && _f !== void 0 ? _f : [];
    // New schema support:
    // windows: [{ version, "zip-url": "..." }]
    for (var _l = 0, windowsRaw_1 = windowsRaw; _l < windowsRaw_1.length; _l++) {
        var entry = windowsRaw_1[_l];
        var obj = entry;
        var zipUrl = obj === null || obj === void 0 ? void 0 : obj['zip-url'];
        if (zipUrl) {
            var version = (_j = (_h = (_g = obj === null || obj === void 0 ? void 0 : obj.version) !== null && _g !== void 0 ? _g : data === null || data === void 0 ? void 0 : data.currentVersion) !== null && _h !== void 0 ? _h : data === null || data === void 0 ? void 0 : data.earlyProductionVersion) !== null && _j !== void 0 ? _j : '';
            return { version: version, url: zipUrl };
        }
    }
    // Legacy schema support (only zip):
    // windows: [{ version, url }, ...]
    var releases = windowsRaw
        .filter(function (r) { return typeof r === 'object' && r !== null; })
        .map(function (r) { return r; })
        .filter(function (r) { return typeof r.url === 'string' && typeof r.version === 'string'; });
    return (_k = releases[0]) !== null && _k !== void 0 ? _k : null;
}
function DownloadPage() {
    var _this = this;
    var _a;
    var _b = (0, react_1.useState)(null), releaseData = _b[0], setReleaseData = _b[1];
    var _c = (0, react_1.useState)(null), loadError = _c[0], setLoadError = _c[1];
    // Keep legacy install options in the codebase, but hide them in the UI.
    var hideWindowsZip = true;
    var hidePython = true;
    (0, react_1.useEffect)(function () {
        var cancelled = false;
        (function () { return __awaiter(_this, void 0, void 0, function () {
            var res, data, err_1;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        _a.trys.push([0, 3, , 4]);
                        return [4 /*yield*/, fetch('/release.json', { cache: 'no-store' })];
                    case 1:
                        res = _a.sent();
                        if (!res.ok)
                            throw new Error("HTTP ".concat(res.status));
                        return [4 /*yield*/, res.json()];
                    case 2:
                        data = (_a.sent());
                        if (!cancelled)
                            setReleaseData(data);
                        return [3 /*break*/, 4];
                    case 3:
                        err_1 = _a.sent();
                        if (cancelled)
                            return [2 /*return*/];
                        setLoadError(err_1 instanceof Error ? err_1.message : 'Failed to load release.json');
                        return [3 /*break*/, 4];
                    case 4: return [2 /*return*/];
                }
            });
        }); })();
        return function () {
            cancelled = true;
        };
    }, []);
    var winZip = (0, react_1.useMemo)(function () { return getWindowsZipUrl(releaseData); }, [releaseData]);
    var headlineVersion = (_a = releaseData === null || releaseData === void 0 ? void 0 : releaseData.currentVersion) !== null && _a !== void 0 ? _a : winZip === null || winZip === void 0 ? void 0 : winZip.version;
    return (<Layout_1.default title="Download" description="Download LioranDB and get started via Node.js or Docker.">
      <header className={(0, clsx_1.default)('hero hero--primary', download_module_css_1.default.heroBanner)}>
        <div className="container">
          <Heading_1.default as="h1" className="hero__title">
            Download & Install
          </Heading_1.default>
          <p className="hero__subtitle">
            Choose your preferred installation method{headlineVersion ? " (v".concat(headlineVersion, ")") : ''}.
          </p>
        </div>
      </header>

      <main className="container margin-vert--lg">
        <div className={(0, clsx_1.default)(download_module_css_1.default.grid4)}>
          {/* Windows ZIP Card */}
          <div className={download_module_css_1.default.card} style={hideWindowsZip ? { display: 'none' } : undefined}>
            <div className={download_module_css_1.default.cardIcon}>💾</div>
            <Heading_1.default as="h2" className={download_module_css_1.default.cardTitle}>
              Windows ZIP
            </Heading_1.default>
            <p className={download_module_css_1.default.muted}>
              Portable executable
            </p>
            <p className={download_module_css_1.default.description}>
              Download and extract to any folder. Self-contained, no installation required.
            </p>
            <p className={download_module_css_1.default.muted}>
              {(winZip === null || winZip === void 0 ? void 0 : winZip.version) ? "Version: v".concat(winZip.version) : 'Version: loading…'}
            </p>
            {(winZip === null || winZip === void 0 ? void 0 : winZip.url) ? (<a className="button button--primary button--lg" href={winZip.url} style={{ marginBottom: '0.75rem' }}>
                Download ZIP
              </a>) : (<span className={(0, clsx_1.default)('button button--primary button--lg', 'button--disabled')} aria-disabled="true" style={{ marginBottom: '0.75rem' }}>
                Download ZIP
              </span>)}
            <div className={download_module_css_1.default.steps}>
              <p className={download_module_css_1.default.stepTitle}>Steps:</p>
              <ol className={download_module_css_1.default.stepsList}>
                <li>Download the ZIP file</li>
                <li>Extract to a folder (e.g., <code>C:\LioranDB</code>)</li>
                <li>Copy the extracted folder path</li>
                <li>Add path to Environment Variables</li>
                <li>Open new terminal and run: <code>ldb-serve</code></li>
              </ol>
            </div>
            <Link_1.default className="button button--secondary button--block" to="/docs/server/server-quickstart">
              Setup guide
            </Link_1.default>
            {loadError && (<p className={download_module_css_1.default.finePrint}>
                Couldn&apos;t load <code>/release.json</code> ({loadError}).
              </p>)}
          </div>

          {/* npm Card */}
          <div className={download_module_css_1.default.card}>
            <div className={download_module_css_1.default.cardIcon}>📦</div>
            <Heading_1.default as="h2" className={download_module_css_1.default.cardTitle}>
              npm (Recommended)
            </Heading_1.default>
            <p className={download_module_css_1.default.muted}>
              Node.js package manager
            </p>
            <p className={download_module_css_1.default.description}>
              Install globally and get both the server and CLI tools.
            </p>
            <p className={download_module_css_1.default.finePrint}>Install using:</p>
            <CodeBlock_1.default language="bash">{"npm i -g @liorandb/db"}</CodeBlock_1.default>
            <p className={download_module_css_1.default.finePrint}>Run server using:</p>
            <CodeBlock_1.default language="bash">{"ldb-serve"}</CodeBlock_1.default>
            <Link_1.default className="button button--secondary button--block" to="/docs/server/server-quickstart">
              Setup guide
            </Link_1.default>
          </div>

          {/* pip Card */}
          <div className={download_module_css_1.default.card} style={hidePython ? { display: 'none' } : undefined}>
            <div className={download_module_css_1.default.cardIcon}>🐍</div>
            <Heading_1.default as="h2" className={download_module_css_1.default.cardTitle}>
              pip (Python)
            </Heading_1.default>
            <p className={download_module_css_1.default.muted}>
              Python package manager
            </p>
            <p className={download_module_css_1.default.description}>
              Installs Windows portable ZIP with auto-PATH setup.
            </p>
            <p className={download_module_css_1.default.finePrint}>Install using:</p>
            <CodeBlock_1.default language="bash">{"pip install liorandb-server-windows"}</CodeBlock_1.default>
            <p className={download_module_css_1.default.finePrint}>Run setup using:</p>
            <CodeBlock_1.default language="bash">{"liorandb-server-windows"}</CodeBlock_1.default>
            <p className={download_module_css_1.default.finePrint}>Run server using:</p>
            <CodeBlock_1.default language="bash">{"ldb-serve"}</CodeBlock_1.default>
            <Link_1.default className="button button--secondary button--block" to="/docs/server/server-quickstart">
              Setup guide
            </Link_1.default>
          </div>

          {/* Docker Card */}
          <div className={download_module_css_1.default.card}>
            <div className={download_module_css_1.default.cardIcon}>🐳</div>
            <Heading_1.default as="h2" className={download_module_css_1.default.cardTitle}>
              Docker
            </Heading_1.default>
            <p className={download_module_css_1.default.muted}>
              Container image
            </p>
            <p className={download_module_css_1.default.description}>
              Run LioranDB in a containerized environment.
            </p>
            <p className={download_module_css_1.default.finePrint}>Create <code>docker-compose.yml</code>:</p>
            <CodeBlock_1.default language="yaml">{"services:\n  liorandb:\n    build:\n      context: ..\n      dockerfile: docker/Dockerfile\n    # image: ldep/liorandb:latest\n    container_name: liorandb-test\n    ports:\n      - \"4000:4000\"\n    environment:\n      # Persist data to the mounted volume (recommended for Docker)\n      LIORANDB_ROOT_PATH: /data\n      # Change this in real deployments\n      LIORANDB_RPC_TOKEN: change-me\n      # Ensure host port publishing works in single-node mode\n      LIORANDB_HTTP_HOST: 0.0.0.0\n    volumes:\n      - ./lioran-data:/data"}</CodeBlock_1.default>
            <p className={download_module_css_1.default.finePrint}>Then run:</p>
            <CodeBlock_1.default language="bash">{"docker compose up -d"}</CodeBlock_1.default>
            <p className={download_module_css_1.default.muted}>After running the command:</p>
            <p className={download_module_css_1.default.description}>
              Visit <a href="http://localhost:4000" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ifm-link-color)', fontWeight: 'bold' }}>localhost:4000</a> for Studio
            </p>
            <p className={download_module_css_1.default.finePrint}>
              <strong>Default credentials:</strong><br />
              Username: <code>admin</code><br />
              Password: <code>admin</code>
            </p>
            <Link_1.default className="button button--secondary button--block" to="/docs/server/production#docker-example">
              Docker guide
            </Link_1.default>
          </div>
        </div>

        {/* Documentation Links Section */}
        <div className={(0, clsx_1.default)('margin-top--xl', download_module_css_1.default.docsSection)}>
          <Heading_1.default as="h2" className="text--center">
            📚 Documentation
          </Heading_1.default>
          <div className={(0, clsx_1.default)(download_module_css_1.default.gridDocs)}>
            <Link_1.default className="button button--link" to="/docs/server/server-quickstart">
              → Server Quickstart
            </Link_1.default>
            <Link_1.default className="button button--link" to="/docs/server/production">
              → Production Setup
            </Link_1.default>
            <Link_1.default className="button button--link" to="/docs/embedded/getting-started">
              → Embedded Database
            </Link_1.default>
            <Link_1.default className="button button--link" to="/docs/driver/getting-started">
              → Node.js Driver
            </Link_1.default>
            <Link_1.default className="button button--link" to="/docs/driver-python/getting-started" style={hidePython ? { display: 'none' } : undefined}>
              → Python Driver
            </Link_1.default>
            <Link_1.default className="button button--link" to="/docs/server/users">
              → Users & Auth
            </Link_1.default>
          </div>
        </div>

        {/* Next Steps Section */}
        <div className={(0, clsx_1.default)('margin-top--xl', download_module_css_1.default.nextStepsSection)}>
          <Heading_1.default as="h2" className="text--center">
            🚀 Next Steps
          </Heading_1.default>
          <p className="text--center" style={{ marginBottom: '2rem', color: 'var(--ifm-color-emphasis-700)' }}>
            Continue with the driver of your choice to interact with LioranDB
          </p>
          <div className={(0, clsx_1.default)(download_module_css_1.default.gridNextSteps)}>
            <div className={download_module_css_1.default.nextStepCard}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📘</div>
              <Heading_1.default as="h3" style={{ marginBottom: '0.75rem' }}>
                Node.js
              </Heading_1.default>
              <p style={{ marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--ifm-color-emphasis-700)' }}>
                Build server-side applications with JavaScript
              </p>
              <Link_1.default className="button button--secondary button--block" to="/docs/driver/getting-started">
                Get started
              </Link_1.default>
            </div>
            <div className={download_module_css_1.default.nextStepCard} style={hidePython ? { display: 'none' } : undefined}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🐍</div>
              <Heading_1.default as="h3" style={{ marginBottom: '0.75rem' }}>
                Python
              </Heading_1.default>
              <p style={{ marginBottom: '1rem', fontSize: '0.9rem', color: 'var(--ifm-color-emphasis-700)' }}>
                Build applications with Python for data science and more
              </p>
              <Link_1.default className="button button--secondary button--block" to="/docs/driver-python/getting-started">
                Get started
              </Link_1.default>
            </div>
          </div>
        </div>
      </main>
    </Layout_1.default>);
}
