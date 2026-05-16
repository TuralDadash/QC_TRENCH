import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { loadIndex, photoFilePath } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const records = await loadIndex();
  const record = records.find((r) => r.id === params.id);
  if (!record) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const data = await fs.readFile(photoFilePath(record.filename));
  const ext = record.filename.split(".").pop()?.toLowerCase() || "jpg";
  const type =
    ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return new NextResponse(data, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
