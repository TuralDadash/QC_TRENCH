import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { PHOTOS_DIR } from "@/lib/store";

export const runtime = "nodejs";

// We resolve the file by scanning PHOTOS_DIR for a file whose name starts
// with the id, instead of consulting the index. The index is only persisted
// when a batch finishes; during a streaming upload, individual photos are
// already on disk and the client renders thumbnails before the batch is
// committed.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = params.id;
  let filename: string | undefined;
  try {
    const entries = await fs.readdir(PHOTOS_DIR);
    filename = entries.find((name) => name.startsWith(id + "."));
  } catch {
    // PHOTOS_DIR may not exist yet — fall through to 404.
  }
  if (!filename) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const data = await fs.readFile(path.join(PHOTOS_DIR, filename));
  const ext = filename.split(".").pop()?.toLowerCase() || "jpg";
  const type =
    ext === "png"
      ? "image/png"
      : ext === "webp"
        ? "image/webp"
        : "image/jpeg";
  return new NextResponse(data, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
