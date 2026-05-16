import type { PhotoRecord, PhotoAnalysis } from "@/lib/store";

export type LotApprovalStatus = "approved" | "reviewing" | "rejected";

export type LotApproval = {
  lotId: string;
  status: LotApprovalStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  comment: string | null;
};

export type QcRule = {
  key: keyof PhotoAnalysis;
  labelDe: string;
  labelGuided: string;
  enabled: boolean;
  weight: number;
};

export const DEFAULT_QC_RULES: QcRule[] = [
  { key: "trench",         labelDe: "Trench visible",  labelGuided: "Is the trench clearly visible?",    enabled: true,  weight: 3 },
  { key: "measuringStick", labelDe: "Measuring stick", labelGuided: "Is a measuring stick readable?",    enabled: true,  weight: 2 },
  { key: "sandBedding",    labelDe: "Sand bedding",    labelGuided: "Is sand bedding present?",          enabled: true,  weight: 2 },
  { key: "warningTape",    labelDe: "Warning tape",    labelGuided: "Is warning tape visible?",          enabled: true,  weight: 1 },
  { key: "sideView",       labelDe: "Side-view angle", labelGuided: "Is it photographed from the side?", enabled: true,  weight: 2 },
  { key: "addressSheet",   labelDe: "Address sheet",   labelGuided: "Is an address sheet in the photo?", enabled: false, weight: 1 },
];

function makeAnalysis(o: Partial<PhotoAnalysis> = {}): PhotoAnalysis {
  return {
    trench: true,            trenchConf: 92,
    measuringStick: true,    measuringStickConf: 88,
    sandBedding: true,       sandBeddingConf: 85,
    warningTape: true,       warningTapeConf: 79,
    sideView: true,          sideViewConf: 94,
    addressSheet: false,     addressSheetConf: 11,
    addresses: [],
    isDuplicate: false,
    duplicateOf: null,
    gpsOnSite: true,
    model: "gemini-2.5-flash",
    analysedAt: new Date(Date.now() - Math.random() * 3600000).toISOString(),
    ...o,
  };
}

const BASE = { lat: 46.55, lon: 14.41 };

function rec(
  id: string,
  name: string,
  lotId: string,
  project: string,
  dLat: number,
  dLon: number,
  analysis: PhotoAnalysis | null,
): PhotoRecord {
  const hasGps = analysis?.gpsOnSite !== false;
  return {
    id,
    filename: `${id}.jpg`,
    originalName: name,
    size: 2_200_000 + Math.floor(Math.random() * 800_000),
    uploadedAt: new Date(Date.now() - Math.random() * 86400000 * 4).toISOString(),
    project,
    lotId,
    latitude:  hasGps ? BASE.lat + dLat : null,
    longitude: hasGps ? BASE.lon + dLon : null,
    takenAt:   new Date(Date.now() - Math.random() * 86400000 * 10).toISOString(),
    width: 4032,
    height: 3024,
    hasGps,
    hasExif: true,
    exifFieldCount: 44,
    timestampSource: "exif",
    gpsSource: "exif",
    overlayApp: null,
    overlayLatitude: null,
    overlayLongitude: null,
    overlayAddress: null,
    overlayTakenAt: null,
    overlayFound: false,
    overlayDetected: false,
    fileHash: null,
    analysis,
  };
}

export const MOCK_PHOTOS: PhotoRecord[] = [
  rec("mock-001", "IMG_20240501_090011.jpg", "A01", "CLP20417A", 0.0012, 0.0021, makeAnalysis()),
  rec("mock-002", "IMG_20240501_090215.jpg", "A01", "CLP20417A", 0.0017, 0.0027, makeAnalysis()),
  rec("mock-003", "IMG_20240501_090442.jpg", "A01", "CLP20417A", 0.0022, 0.0032, makeAnalysis({ addresses: ["Hauptstr. 12, 9121 Tainach"] })),
  rec("mock-004", "IMG_20240501_090703.jpg", "A01", "CLP20417A", 0.0028, 0.0038, makeAnalysis()),

  rec("mock-005", "IMG_20240501_110023.jpg", "A02", "CLP20417A", -0.0011, 0.0041, makeAnalysis({ sandBedding: false, sandBeddingConf: 24 })),
  rec("mock-006", "IMG_20240501_110318.jpg", "A02", "CLP20417A", -0.0016, 0.0047, makeAnalysis({ warningTape: false, warningTapeConf: 17 })),
  rec("mock-007", "IMG_20240501_110547.jpg", "A02", "CLP20417A", -0.0021, 0.0053, makeAnalysis()),
  rec("mock-008", "IMG_20240501_110812.jpg", "A02", "CLP20417A", -0.0026, 0.0058, makeAnalysis({ sandBedding: false, sandBeddingConf: 19, warningTape: false, warningTapeConf: 8 })),

  rec("mock-009", "IMG_20240501_130044.jpg", "B01", "CLP20417A", 0.0031, -0.0012, makeAnalysis({ trench: false, trenchConf: 13, sideView: false, sideViewConf: 7 })),
  rec("mock-010", "IMG_20240501_130302.jpg", "B01", "CLP20417A", 0.0036, -0.0017, makeAnalysis({ trench: false, trenchConf: 21, sideView: true, sideViewConf: 60 })),
  rec("mock-011", "IMG_20240501_130531.jpg", "B01", "CLP20417A", 0.0041, -0.0022, makeAnalysis()),
  rec("mock-012", "IMG_20240501_130759.jpg", "B01", "CLP20417A", 0.0047, -0.0027, makeAnalysis({ sideView: false, sideViewConf: 12 })),

  rec("mock-013", "IMG_20240501_150011.jpg", "B02", "CLP20417A", -0.0031, -0.0021, makeAnalysis()),
  rec("mock-014", "IMG_20240501_150011_dup.jpg", "B02", "CLP20417A", -0.0031, -0.0021, makeAnalysis({ isDuplicate: true, duplicateOf: "mock-013" })),
  rec("mock-015", "IMG_20240501_150233.jpg", "B02", "CLP20417A", -0.0037, -0.0026, makeAnalysis()),

  {
    ...rec("mock-016", "IMG_20240501_170044.jpg", "C01", "CLP20417A", 0, 0, makeAnalysis({ gpsOnSite: false })),
    latitude: null, longitude: null, hasGps: false,
  },
  {
    ...rec("mock-017", "IMG_20240501_170302.jpg", "C01", "CLP20417A", 0, 0, null),
    latitude: null, longitude: null, hasGps: false,
  },

  rec("mock-018", "IMG_20240501_190011.jpg", "C02", "CLP20417A", 0.0052, 0.0063, null),
  rec("mock-019", "IMG_20240501_190234.jpg", "C02", "CLP20417A", 0.0057, 0.0068, null),
  rec("mock-020", "IMG_20240501_190501.jpg", "C02", "CLP20417A", 0.0062, 0.0073, makeAnalysis()),
];

export const MOCK_LOT_APPROVALS: Record<string, LotApproval> = {
  "CLP20417A::A01": {
    lotId: "A01", status: "approved",
    approvedBy: "M. Weber", approvedAt: new Date(Date.now() - 3600000 * 2).toISOString(), comment: null,
  },
  "CLP20417A::A02": {
    lotId: "A02", status: "reviewing",
    approvedBy: null, approvedAt: null, comment: null,
  },
  "CLP20417A::B01": {
    lotId: "B01", status: "rejected",
    approvedBy: "K. Huber", approvedAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    comment: "Trench not visible in 2 photos — re-upload required.",
  },
  "CLP20417A::B02": {
    lotId: "B02", status: "reviewing",
    approvedBy: null, approvedAt: null, comment: null,
  },
};

export function deriveCategory(photo: PhotoRecord, _rules: QcRule[]): 1 | 2 | 3 | 4 {
  if (!photo.analysis) return 2;
  const a = photo.analysis;
  if (a.isDuplicate || a.gpsOnSite === false) return 4;
  if (a.trench && a.measuringStick) return 1;
  if (a.trench) return 2;
  if (a.measuringStick) return 3;
  return 4;
}
