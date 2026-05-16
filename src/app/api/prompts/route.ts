import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";

const PROMPTS_DIR = path.join(process.cwd(), "util", "prompts");

// Lists the prompt files available for the default (analyze_image.py) Gemini
// path. The upload page turns these into "Process" dropdown options.
export async function GET() {
  let prompts: string[] = [];
  try {
    const entries = await fs.readdir(PROMPTS_DIR);
    prompts = entries.filter((name) => name.endsWith(".txt")).sort();
  } catch {
    // Directory missing — return an empty list rather than erroring.
  }
  return Response.json({ prompts });
}
