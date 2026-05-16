import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import {
  loadIndex,
  mergeAnalysis,
  photoFilePath,
  type AnalysisUpdate,
  type PhotoAnalysis,
} from "@/lib/store";
import { analyseImage } from "@/lib/analyse";

export const runtime = "nodejs";

const GEMINI_CONCURRENCY = Math.max(
  1,
  Number(process.env.GEMINI_CONCURRENCY ?? 4),
);

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

export async function POST(_req: NextRequest) {
  const index = await loadIndex();
  const pending = index.filter((r) => !r.analysis);

  const existingHashes = new Map<string, string>();
  for (const r of index) {
    if (r.fileHash) existingHashes.set(r.fileHash, r.id);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const write = (obj: unknown) =>
        controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));

      write({ event: "start", total: pending.length });

      let saveChain: Promise<unknown> = Promise.resolve();
      const persist = (update: AnalysisUpdate) => {
        saveChain = saveChain.then(() => mergeAnalysis([update]));
        return saveChain;
      };

      let nextIndex = 0;
      let done = 0;

      const workers = Array.from(
        { length: Math.min(GEMINI_CONCURRENCY, pending.length) },
        async () => {
          while (true) {
            const i = nextIndex++;
            if (i >= pending.length) break;
            const rec = pending[i];

            let analysis: PhotoAnalysis | null = null;
            try {
              const buf = await fs.readFile(photoFilePath(rec.filename));
              const ext = path.extname(rec.filename).toLowerCase();
              const mime = MIME_MAP[ext] ?? "image/jpeg";
              const fileHash =
                rec.fileHash ??
                crypto.createHash("sha256").update(buf).digest("hex");
              if (!existingHashes.has(fileHash)) {
                existingHashes.set(fileHash, rec.id);
              }
              analysis = await analyseImage(buf, mime, existingHashes, fileHash);
            } catch {
              analysis = null;
            }

            await persist({ id: rec.id, analysis });

            done++;
            write({
              event: "analyzed",
              done,
              total: pending.length,
              record: { ...rec, analysis },
            });
          }
        },
      );

      await Promise.all(workers);
      await saveChain;

      write({ event: "done" });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
