import { NextRequest } from "next/server";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import {
  loadIndex,
  mergeAnalysisRun,
  photoFilePath,
  type AnalysisRun,
  type AnalysisRunUpdate,
  type BackendAssessment,
  type GeminiAnalysis,
  type PhotoRecord,
} from "@/lib/store";

export const runtime = "nodejs";

// Each analysis spawns one python subprocess that makes a single Gemini call.
// A handful in parallel keeps throughput up without hammering the API.
const GEMINI_CONCURRENCY = Math.max(
  1,
  Number(process.env.GEMINI_CONCURRENCY ?? 4),
);

const ANALYSIS_TIMEOUT_MS = 120_000;

// Defaults to the local dev venv; Docker sets PYTHON_BIN to the image's venv.
const PYTHON =
  process.env.PYTHON_BIN ||
  path.join(process.cwd(), "util", ".venv", "bin", "python");
const UTIL_DIR = path.join(process.cwd(), "util");
const ANALYZE_SCRIPT = path.join(UTIL_DIR, "analyze_image.py");
const BACKEND_SCRIPT = path.join(UTIL_DIR, "backend_analyze.py");
const PROMPTS_DIR = path.join(UTIL_DIR, "prompts");

type ResolvedPath =
  | { kind: "util"; pathId: string; promptFile: string }
  | { kind: "backend"; pathId: string };

// A path id is either "backend" or "util:<prompt-file>.txt".
async function resolvePath(pathId: string): Promise<ResolvedPath | null> {
  if (pathId === "backend") return { kind: "backend", pathId };
  if (pathId.startsWith("util:")) {
    const file = pathId.slice("util:".length);
    // Guard against traversal — only a bare .txt filename is accepted.
    if (!/^[\w.\- ]+\.txt$/.test(file)) return null;
    const promptFile = path.join(PROMPTS_DIR, file);
    try {
      await fs.access(promptFile);
    } catch {
      return null;
    }
    return { kind: "util", pathId, promptFile };
  }
  return null;
}

function runScript(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // PYTHONDONTWRITEBYTECODE keeps __pycache__ out of the bind-mounted
    // util/ and backend/ dirs — stray .pyc files there trip the Next dev
    // file-watcher and crash the dev server.
    const proc = spawn(PYTHON, args, {
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
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
          resolve(JSON.parse(out.trim()));
        } catch {
          reject(new Error(`could not parse output: ${out.slice(0, 200)}`));
        }
      }),
    );
  });
}

function analyse(resolved: ResolvedPath, photoPath: string): Promise<unknown> {
  if (resolved.kind === "backend") {
    return runScript([BACKEND_SCRIPT, photoPath]);
  }
  return runScript([ANALYZE_SCRIPT, photoPath, "-f", resolved.promptFile]);
}

// Analyse every photo that has no result yet for the requested path. Streams
// NDJSON progress and persists each run as it lands.
export async function POST(req: NextRequest) {
  const pathId = req.nextUrl.searchParams.get("path") || "util:v1.txt";
  const resolved = await resolvePath(pathId);
  if (!resolved) {
    return new Response(
      JSON.stringify({ error: `unknown analysis path: ${pathId}` }),
      { status: 400 },
    );
  }

  const index = await loadIndex();
  const pending = index.filter((r) => !r.analyses?.[pathId]);

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const write = (obj: unknown) => {
        controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      };

      write({ event: "start", pathId, total: pending.length });

      // Serialise persistence — workers run concurrently but mergeAnalysisRun
      // does a read-modify-write of the whole index.
      let saveChain: Promise<unknown> = Promise.resolve();
      const persist = (update: AnalysisRunUpdate) => {
        saveChain = saveChain.then(() => mergeAnalysisRun([update]));
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

            let result: unknown = null;
            let error: string | null = null;
            try {
              result = await analyse(resolved, photoFilePath(rec.filename));
            } catch (e) {
              error = (e as Error).message;
            }
            const run: AnalysisRun = {
              pathId,
              kind: resolved.kind,
              analyzedAt: result ? new Date().toISOString() : null,
              error,
              result: result as GeminiAnalysis | BackendAssessment | null,
            };

            await persist({ id: rec.id, run });

            done++;
            const updated: PhotoRecord = {
              ...rec,
              analyses: { ...(rec.analyses ?? {}), [pathId]: run },
            };
            write({
              event: "analyzed",
              pathId,
              done,
              total: pending.length,
              record: updated,
            });
          }
        },
      );
      await Promise.all(workers);
      await saveChain;

      write({ event: "done", pathId });
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
