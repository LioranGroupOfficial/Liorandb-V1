import fs from "fs";
import path from "path";
import { Request, Response } from "express";

type DocEntry = { id: string; title: string; filePath: string };

function serverRoot() {
  // src -> dist; we want server/ folder
  return path.join(__dirname, "..");
}

function buildDocsIndex(): DocEntry[] {
  const root = serverRoot();
  const entries: DocEntry[] = [
    { id: "api", title: "API.md", filePath: path.join(root, "API.md") },
    { id: "server-readme", title: "README.md", filePath: path.join(root, "README.md") },
  ];

  const docsDir = path.join(root, "docs");
  if (fs.existsSync(docsDir)) {
    const files = fs.readdirSync(docsDir).filter((f) => f.endsWith(".md")).sort();
    for (const file of files) {
      const id = file.replace(/\.md$/i, "");
      entries.push({
        id,
        title: file,
        filePath: path.join(docsDir, file),
      });
    }
  }

  return entries;
}

export const listDocs = async (_req: Request, res: Response) => {
  const docs = buildDocsIndex().map(({ id, title }) => ({ id, title }));
  return res.json({ ok: true, docs });
};

export const getDoc = async (req: Request, res: Response) => {
  const id = String(req.params.id || "").trim();
  const entry = buildDocsIndex().find((d) => d.id === id);
  if (!entry) {
    return res.status(404).json({ error: "doc not found" });
  }

  try {
    const content = await fs.promises.readFile(entry.filePath, "utf8");
    return res.json({ ok: true, id: entry.id, title: entry.title, content });
  } catch {
    return res.status(500).json({ error: "failed to read doc" });
  }
};

