import express from "express";
import dotenv from "dotenv";

import authRoutes from "./routes/auth.routes";
import databaseRoutes from "./routes/database.routes";
import collectionRoutes from "./routes/collection.routes";
import documentRoutes from "./routes/document.routes";

dotenv.config();

const app = express();
app.use(express.json());

// health check
app.get("/health", (req, res) =>
  res.json({ ok: true, time: new Date().toISOString() })
);

// routes
app.use("/auth", authRoutes);
app.use("/databases", databaseRoutes);
app.use("/db/:db/collections", collectionRoutes);
app.use("/db/:db/collections/:col", documentRoutes);

export default app;
