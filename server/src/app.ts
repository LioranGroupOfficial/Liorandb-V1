import express from "express";
import authRoutes from "./routes/auth.routes";
import databaseRoutes from "./routes/database.routes";
import collectionRoutes from "./routes/collection.routes";
import documentRoutes from "./routes/document.routes";
import { requestLogger } from "./middleware/requestLogger.middleware";

const app = express();
app.use(express.json());
app.use(requestLogger);

// health check
app.get("/health", (req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

app.get("/", (_, res) => {
  res.json({
    name: "LioranDB",
    role: "Database Host",
    status: "online"
  });
});

// routes
app.use("/auth", authRoutes);
app.use("/databases", databaseRoutes);
app.use("/db/:db/collections", collectionRoutes);
app.use("/db/:db/collections/:col", documentRoutes);

export default app;
