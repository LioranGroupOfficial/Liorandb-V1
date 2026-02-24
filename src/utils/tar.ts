import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import zlib from "zlib";
import tar from "tar-stream";

/**
 * Create a TAR.GZ archive from a directory
 */
export async function createTarGz(
  sourceDir: string,
  outFile: string
): Promise<void> {
  await fs.promises.mkdir(path.dirname(outFile), { recursive: true });

  const pack = tar.pack();
  const gzip = zlib.createGzip();
  const out = fs.createWriteStream(outFile + ".tmp");

  const writeStream = pipeline(pack, gzip, out);

  async function walk(dir: string) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.relative(sourceDir, fullPath);

      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const stat = await fs.promises.stat(fullPath);
        const stream = fs.createReadStream(fullPath);

        await new Promise<void>((resolve, reject) => {
          const header = {
            name: relPath,
            size: stat.size,
            mode: stat.mode,
            mtime: stat.mtime
          };

          const entryStream = pack.entry(header, err => {
            if (err) reject(err);
            else resolve();
          });

          stream.pipe(entryStream);
        });
      }
    }
  }

  await walk(sourceDir);

  pack.finalize();
  await writeStream;

  await fs.promises.rename(outFile + ".tmp", outFile);
}

/**
 * Extract TAR.GZ archive into directory
 */
export async function extractTarGz(
  archiveFile: string,
  targetDir: string
): Promise<void> {
  await fs.promises.mkdir(targetDir, { recursive: true });

  const extract = tar.extract();
  const gunzip = zlib.createGunzip();
  const input = fs.createReadStream(archiveFile);

  extract.on("entry", async (header, stream, next) => {
    const outPath = path.join(targetDir, header.name);

    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });

    const out = fs.createWriteStream(outPath, {
      mode: header.mode
    });

    await pipeline(stream, out);
    next();
  });

  await pipeline(input, gunzip, extract);
}