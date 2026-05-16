import { GoogleGenAI } from "@google/genai";
import type { PhotoAnalysis } from "./store";

const MODEL = "gemini-2.5-flash";

const PROMPT = `You audit fiber-optic trench installation photos submitted by contractors. Your verdict gates payment — be strict. A false positive (approving a bad photo) is worse than a false negative.

Contractors dig a trench, lay sand bedding, place a duct on the sand, then backfill. To certify the work they photograph the open trench with a vertical measuring stick to prove depth, often include an address sheet, and must show warning tape placed above the duct before backfilling.

Judge only on what is unambiguously visible. Do not infer what the photo "should" show.

Criteria:
- has_trench: an open, freshly excavated channel in the ground with visible depth and walls. Not: filled ground, finished pavement, a shallow scrape, generic dirt, or indoor shot.
- has_vertical_measuring_stick: a ruler standing upright in the trench, typically light-grey with red-and-black markings. Markings must be legible.
- has_sand_bedding: a distinct lighter-coloured sand layer at the trench bottom, clearly different from surrounding soil. Not: uniform dirt, gravel, or rubble.
- has_warning_tape: a brightly coloured (orange or yellow) flat plastic warning tape visible in the trench or above the duct layer.
- has_side_view: the trench is photographed from the side so its cross-section, walls, and depth are clearly visible — not a top-down or oblique overhead shot.
- has_address_sheet: a printed or hand-written sheet of paper listing street addresses. A sign, equipment label, or phone screen does not count.
- addresses: every street address on the sheet, transcribed exactly as written. Empty array if none legible.
- depth_cm: if has_vertical_measuring_stick is true and the depth is legible from the ruler markings, return the numeric depth in centimetres as a number. Otherwise return null.
- depth_cm_confidence: confidence 0–100 for the depth reading. 0 if depth_cm is null.

For every boolean also return confidence 0–100. When in doubt answer false with low confidence.

Return JSON with these exact keys:
has_trench, has_trench_confidence,
has_vertical_measuring_stick, has_vertical_measuring_stick_confidence,
has_sand_bedding, has_sand_bedding_confidence,
has_warning_tape, has_warning_tape_confidence,
has_side_view, has_side_view_confidence,
has_address_sheet, has_address_sheet_confidence,
addresses,
depth_cm, depth_cm_confidence`;

type RawResult = {
  has_trench: boolean;
  has_trench_confidence: number;
  has_vertical_measuring_stick: boolean;
  has_vertical_measuring_stick_confidence: number;
  has_sand_bedding: boolean;
  has_sand_bedding_confidence: number;
  has_warning_tape: boolean;
  has_warning_tape_confidence: number;
  has_side_view: boolean;
  has_side_view_confidence: number;
  has_address_sheet: boolean;
  has_address_sheet_confidence: number;
  addresses: string[];
  depth_cm: number | null;
  depth_cm_confidence: number;
};

export async function analyseImage(
  imageBytes: Buffer,
  mimeType: string,
  existingHashes: Map<string, string>,
  fileHash: string,
): Promise<PhotoAnalysis> {
  const duplicateOf = existingHashes.get(fileHash) ?? null;
  const isDuplicate = duplicateOf !== null;

  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return {
      trench: false, trenchConf: 0,
      measuringStick: false, measuringStickConf: 0,
      depth_cm: null, depth_cm_confidence: 0,
      sandBedding: false, sandBeddingConf: 0,
      warningTape: false, warningTapeConf: 0,
      sideView: false, sideViewConf: 0,
      addressSheet: false, addressSheetConf: 0,
      addresses: [],
      isDuplicate,
      duplicateOf,
      gpsOnSite: null,
      model: "none",
      analysedAt: new Date().toISOString(),
    };
  }

  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        parts: [
          { text: PROMPT },
          { inlineData: { mimeType, data: imageBytes.toString("base64") } },
        ],
      },
    ],
    config: { responseMimeType: "application/json" },
  });

  const raw = JSON.parse(response.text ?? "{}") as Partial<RawResult>;

  return {
    trench: raw.has_trench ?? false,
    trenchConf: raw.has_trench_confidence ?? 0,
    measuringStick: raw.has_vertical_measuring_stick ?? false,
    measuringStickConf: raw.has_vertical_measuring_stick_confidence ?? 0,
    depth_cm: raw.depth_cm ?? null,
    depth_cm_confidence: raw.depth_cm_confidence ?? 0,
    sandBedding: raw.has_sand_bedding ?? false,
    sandBeddingConf: raw.has_sand_bedding_confidence ?? 0,
    warningTape: raw.has_warning_tape ?? false,
    warningTapeConf: raw.has_warning_tape_confidence ?? 0,
    sideView: raw.has_side_view ?? false,
    sideViewConf: raw.has_side_view_confidence ?? 0,
    addressSheet: raw.has_address_sheet ?? false,
    addressSheetConf: raw.has_address_sheet_confidence ?? 0,
    addresses: Array.isArray(raw.addresses) ? raw.addresses : [],
    isDuplicate,
    duplicateOf,
    gpsOnSite: null,
    model: MODEL,
    analysedAt: new Date().toISOString(),
  };
}
