import { NextRequest } from "next/server";
import { spawn } from "child_process";
import path from "path";
import {
  loadIndex,
  mergeAnalysis,
  photoFilePath,
  type AnalysisUpdate,
  type GeminiAnalysis,
  type PhotoRecord,
} from "@/lib/store";

export const runtime = "nodejs";

// Each analysis spawns one `python analyze_image.py` subprocess, which makes a
// single network call to Gemini. A handful in parallel keeps throughput up
// without hammering the API; bump via env on faster keys.
const GEMINI_CONCURRENCY = Math.max(
  1,
  Number(process.env.GEMINI_CONCURRENCY ?? 4),
);

const ANALYSIS_TIMEOUT_MS = 120_000;

// Defaults to the local dev venv; Docker sets PYTHON_BIN to the image's venv
// (see Dockerfile) since the host venv isn't valid inside the container.
const PYTHON =
  process.env.PYTHON_BIN ||
  path.join(process.cwd(), "util", ".venv", "bin", "python");
const SCRIPT = path.join(process.cwd(), "util", "analyze_image.py");
const PROMPT_FILE = path.join(process.cwd(), "util", "prompts", "v1.txt");

function runAnalysis(photoPath: string): Promise<GeminiAnalysis> {
  return new Promise((resolve, reject) => {
    const proc = spawn(PYTHON, [SCRIPT, photoPath, "-f", PROMPT_FILE], {
      env: process.env,
    });
    let out = "";
    let err = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      finish(() => reject(new Error("analysis timed out after 120s")));
    }, ANALYSIS_TIMEOUT_MS);

    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", (e) => finish(() => reject(e)));
    proc.on("close", (code) =>
      finish(() => {
        if (code !== 0) {
          reject(new Error(err.trim() || `python exited with code ${code}`));
          return;
        }
        try {
          resolve(JSON.parse(out.trim()) as GeminiAnalysis);
        } catch {
          reject(
            new Error(`could not parse Gemini output: ${out.slice(0, 200)}`),
          );
        }
      }),
    );
  });
}

// Analyse every uploaded photo that doesn't yet have a Gemini result. Streams
// NDJSON progress so the UI can update row-by-row, and persists each result as
// it lands so an interrupted run keeps the work already paid for.
export async function POST(_req: NextRequest) {
  const index = await loadIndex();
  const pending = index.filter((r) => !r.analysis);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const write = (obj: unknown) => {
        controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      };

      write({ event: "start", total: pending.length });

      // Serialise persistence — workers run concurrently but mergeAnalysis
      // does a read-modify-write of the whole index, so chain the saves.
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

            let analysis: GeminiAnalysis | null = null;
            let analysisError: string | null = null;
            try {
              analysis = await runAnalysis(photoFilePath(rec.filename));
            } catch (e) {
              analysisError = (e as Error).message;
            }
            const analyzedAt = analysis ? new Date().toISOString() : null;

            await persist({ id: rec.id, analysis, analyzedAt, analysisError });

            done++;
            const updated: PhotoRecord = {
              ...rec,
              analysis,
              analyzedAt,
              analysisError,
            };
            write({
              event: "analyzed",
              done,
              total: pending.length,
              record: updated,
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
