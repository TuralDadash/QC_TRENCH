import { spawn } from "child_process";
import sharp from "sharp";

export type OverlayExtraction = {
  latitude: number | null;
  longitude: number | null;
  address: string | null;
  takenAt: string | null;
  app: string | null;
  rawText: string;
  detected: boolean;
  found: boolean;
  parsedCoords: boolean;
  parsedTimestamp: boolean;
};

function runTesseract(
  imageBuf: Buffer,
  psm: number,
  lang = "deu+eng",
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("tesseract", [
      "stdin",
      "stdout",
      "-l",
      lang,
      "--oem",
      "1",
      "--psm",
      String(psm),
    ]);
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`tesseract exited ${code}: ${err}`));
    });
    proc.stdin.write(imageBuf);
    proc.stdin.end();
  });
}

type OcrPasses = {
  bandText: string;
  allText: string;
};

async function multiPassOcr(source: Buffer): Promise<OcrPasses> {
  const meta = await sharp(source).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;

  if (w < 400 || h < 400) {
    return { bandText: "", allText: "" };
  }

  const prepBottom = await sharp(source)
    .extract({
      left: 0,
      top: Math.floor(h * 0.6),
      width: w,
      height: Math.floor(h * 0.4),
    })
    .resize({ width: 1400 })
    .greyscale()
    .linear(1.6, -30)
    .toBuffer();

  const prepTop = await sharp(source)
    .extract({ left: 0, top: 0, width: w, height: Math.floor(h * 0.4) })
    .resize({ width: 1400 })
    .greyscale()
    .normalise()
    .toBuffer();

  const bottom = await runTesseract(prepBottom, 6).catch(() => "");
  const top = await runTesseract(prepTop, 6).catch(() => "");

  const combined = normaliseOcr(top + "\n" + bottom);
  return { bandText: combined, allText: combined };
}

function normaliseOcr(s: string): string {
  return s
    .replace(/‚/g, ",")
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/[′ʹ]/g, "'")
    .replace(/[″ʺ]/g, '"')
    .replace(/ /g, " ");
}

function parseDecimalCoords(text: string): [number, number] | null {
  const m = text.match(
    /Lat[^0-9\-]*(-?\d{1,3}[.,]\d+)[\s,]*Long[^0-9\-]*(-?\d{1,3}[.,]\d+)/i,
  );
  if (m) {
    const lat = Number(m[1].replace(",", "."));
    const lon = Number(m[2].replace(",", "."));
    if (isValidLat(lat) && isValidLon(lon)) return [lat, lon];
  }
  return null;
}

function parseDmsCoords(text: string): [number, number] | null {
  const re =
    /(\d{1,3})\D{1,4}(\d{1,2})\D{1,4}(\d{1,2}(?:[.,]\d+)?)\D{0,5}([NSns])\D{1,8}(\d{1,3})\D{1,4}(\d{1,2})\D{1,4}(\d{1,2}(?:[.,]\d+)?)\D{0,5}([EWew])/;
  const m = text.match(re);
  if (!m) return null;
  const lat = dmsToDecimal(m[1], m[2], m[3], m[4]);
  const lon = dmsToDecimal(m[5], m[6], m[7], m[8]);
  if (lat === null || lon === null) return null;
  if (!isValidLat(lat) || !isValidLon(lon)) return null;
  return [lat, lon];
}

function dmsToDecimal(
  deg: string,
  min: string,
  sec: string,
  hemi: string,
): number | null {
  const d = Number(deg);
  const mi = Number(min);
  const s = Number(sec.replace(",", "."));
  if (![d, mi, s].every(Number.isFinite)) return null;
  let dec = d + mi / 60 + s / 3600;
  if (/[SW]/i.test(hemi)) dec = -dec;
  return dec;
}

function isValidLat(n: number) {
  return n >= -90 && n <= 90;
}
function isValidLon(n: number) {
  return n >= -180 && n <= 180;
}

function parseTimestamp(text: string): string | null {
  let m = text.match(
    /(\d{1,2})\/(\d{1,2})\/(\d{4})[\s,]+(\d{1,2}):(\d{2})(?:\s*([AP])M)?(?:\s*GMT\s*([+\-]\d{1,2}(?::\d{2})?))?/i,
  );
  if (m) {
    let h = Number(m[4]);
    const ampm = m[6];
    if (ampm) {
      if (/p/i.test(ampm) && h < 12) h += 12;
      if (/a/i.test(ampm) && h === 12) h = 0;
    }
    const tz = m[7]
      ? normaliseTz(m[7])
      : "Z";
    const iso = `${m[3]}-${pad(m[1])}-${pad(m[2])}T${pad(String(h))}:${m[5]}:00${tz}`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  m = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})[\s,]+(\d{1,2}):(\d{2})/);
  if (m) {
    const iso = `${m[3]}-${pad(m[2])}-${pad(m[1])}T${pad(m[4])}:${m[5]}:00`;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  return null;
}

function pad(s: string) {
  return s.padStart(2, "0");
}

function normaliseTz(tz: string) {
  const m = tz.match(/^([+\-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!m) return "Z";
  return `${m[1]}${pad(m[2])}:${m[3] ?? "00"}`;
}

function detectApp(text: string): string | null {
  if (/GPS\s*Map\s*Cam(?:era|er[ai])?/i.test(text)) return "GPS Map Camera";
  if (/Timestamp\s*Camera/i.test(text)) return "Timestamp Camera";
  return null;
}

function extractAddress(text: string): string | null {
  const skip = (l: string) =>
    /(Lat\s+-?\d|Long\s+-?\d|GPS\s*Map|Note\s*:|Captured by|Google)/i.test(l) ||
    /\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}/.test(l) ||
    /\d{1,3}\D{1,4}\d{1,2}\D{1,4}\d{1,2}\D{0,5}[NSEW]/i.test(l);
  const candidates = text
    .split(/\r?\n/)
    .map((rawLine) => {
      const good = rawLine
        .split(/\s+/)
        .filter((t) => t.length > 0)
        .filter(
          (t) =>
            (t.length >= 3 && /[A-Za-zÄÖÜäöüß]/.test(t)) ||
            /^\d{2,5}[,.]?$/.test(t),
        );
      return good.join(" ").replace(/^[^A-Za-zÄÖÜäöüß0-9]+/, "").trim();
    })
    .filter((l) => {
      if (l.length < 5) return false;
      if (!/[A-Za-zÄÖÜäöüß]{5,}/.test(l)) return false;
      return !skip(l);
    });
  if (candidates.length === 0) return null;
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const l of candidates) {
    const key = l.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(l);
    if (unique.length >= 4) break;
  }
  return unique.join(" · ");
}

function detectOverlay(text: string): boolean {
  if (/GPS\s*Map\s*Cam|Timestamp\s*Camera|Captured by/i.test(text)) return true;
  if (/\d{1,3}\s*°\s*\d{1,2}\D{0,4}\d{1,2}[.,]\d+\D{0,4}[NS]/i.test(text)) return true;
  if (/Lat\s+-?\d{1,3}[.,]\d/i.test(text) && /Long\s+-?\d{1,3}[.,]\d/i.test(text))
    return true;
  return false;
}

export async function extractOverlay(
  imageBuf: Buffer,
): Promise<OverlayExtraction> {
  let passes: OcrPasses;
  try {
    passes = await multiPassOcr(imageBuf);
  } catch {
    return {
      latitude: null,
      longitude: null,
      address: null,
      takenAt: null,
      app: null,
      rawText: "",
      detected: false,
      found: false,
      parsedCoords: false,
      parsedTimestamp: false,
    };
  }

  const decimal = parseDecimalCoords(passes.allText);
  const dms = decimal ? null : parseDmsCoords(passes.allText);
  const coords = decimal ?? dms;

  const takenAt = parseTimestamp(passes.allText);
  const app = detectApp(passes.allText);
  const address = extractAddress(passes.bandText);
  const detected = detectOverlay(passes.bandText) || app !== null;

  const parsedCoords = coords !== null;
  const parsedTimestamp = takenAt !== null;
  const found = parsedCoords || parsedTimestamp;

  return {
    latitude: coords ? coords[0] : null,
    longitude: coords ? coords[1] : null,
    address,
    takenAt,
    app,
    rawText: passes.allText,
    detected,
    found,
    parsedCoords,
    parsedTimestamp,
  };
}
