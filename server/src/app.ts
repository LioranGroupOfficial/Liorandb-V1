import express from "express";
import path from "path";
import authRoutes from "./routes/auth.routes";
import databaseRoutes from "./routes/database.routes";
import collectionRoutes from "./routes/collection.routes";
import documentRoutes from "./routes/document.routes";
import indexRoutes from "./routes/index.routes";
import maintenanceRoutes from "./routes/maintenance.routes";
import docsRoutes from "./routes/docs.routes";
import { requestLogger } from "./middleware/requestLogger.middleware";
import { securityHeaders } from "./middleware/securityHeaders.middleware";
import { createRateLimiter } from "./middleware/rateLimit.middleware";
import { createConcurrencyLimiter } from "./middleware/concurrency.middleware";
import { buildCorsMiddleware } from "./middleware/corsConfig.middleware";
import { maintenanceMiddleware } from "./middleware/maintenance.middleware";

const app = express();
app.disable("x-powered-by");

const trustProxy = process.env.LIORANDB_TRUST_PROXY;
if (trustProxy) {
  const asNum = Number(trustProxy);
  app.set("trust proxy", Number.isFinite(asNum) ? asNum : 1);
}

const bodyLimit = process.env.LIORANDB_BODY_LIMIT || "1mb";
app.use(express.json({ limit: bodyLimit }));
app.use(buildCorsMiddleware());
app.use(securityHeaders);

app.use(
  createConcurrencyLimiter({
    maxGlobal: Number(process.env.LIORANDB_MAX_INFLIGHT_GLOBAL || 500),
    maxPerIp: Number(process.env.LIORANDB_MAX_INFLIGHT_PER_IP || 50),
  })
);

app.use(
  createRateLimiter({
    windowMs: Number(process.env.LIORANDB_RATE_LIMIT_WINDOW_MS || 60_000),
    max: Number(process.env.LIORANDB_RATE_LIMIT_MAX || 240),
    softMax: Number(process.env.LIORANDB_RATE_LIMIT_SOFT_MAX || 180),
    softDelayMs: Number(process.env.LIORANDB_RATE_LIMIT_SOFT_DELAY_MS || 150),
  })
);

// Stricter brute-force protection for auth endpoints
app.use(
  "/auth",
  createRateLimiter({
    windowMs: Number(process.env.LIORANDB_AUTH_RATE_LIMIT_WINDOW_MS || 60_000),
    max: Number(process.env.LIORANDB_AUTH_RATE_LIMIT_MAX || 20),
    softMax: Number(process.env.LIORANDB_AUTH_RATE_LIMIT_SOFT_MAX || 10),
    softDelayMs: Number(process.env.LIORANDB_AUTH_RATE_LIMIT_SOFT_DELAY_MS || 250),
    blockMs: Number(process.env.LIORANDB_AUTH_RATE_LIMIT_BLOCK_MS || 5 * 60_000),
  })
);

app.use(requestLogger);
app.use(maintenanceMiddleware);

// Static dashboard UI
const publicDir = path.join(__dirname, "..", "public");
app.use("/dashboard", express.static(path.join(publicDir, "dashboard")));

// health check
app.get("/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get("/", (_req, res) => {
  res.json({
    name: "LioranDB",
    role: "Database Host",
    status: "online",
  });
});

app.get("/dashboard", (_req, res) => res.redirect("/dashboard/"));

// routes
app.use("/auth", authRoutes);
app.use("/docs", docsRoutes);
app.use("/maintenance", maintenanceRoutes);
app.use("/databases", databaseRoutes);
app.use("/db/:db/collections", collectionRoutes);
app.use("/db/:db/collections/:col/indexes", indexRoutes);
app.use("/db/:db/collections/:col", documentRoutes);

export default app;
