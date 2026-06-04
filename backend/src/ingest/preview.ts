import fs from "node:fs";
import { TSV_HEADER } from "./schema.js";

// Read the first N lines of a (possibly huge) file without loading it whole — open a
// stream, accumulate until we have enough newlines, then stop.
export function readFirstLines(filePath: string, n: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, {
      encoding: "utf8",
      highWaterMark: 64 * 1024,
    });
    let buf = "";
    const lines: string[] = [];

    const done = () => {
      stream.destroy();
      resolve(lines.slice(0, n));
    };

    stream.on("data", (chunk: string | Buffer) => {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        lines.push(buf.slice(0, idx).replace(/\r$/, ""));
        buf = buf.slice(idx + 1);
        if (lines.length >= n) {
          done();
          return;
        }
      }
    });
    stream.on("end", () => {
      if (buf.length > 0 && lines.length < n) lines.push(buf.replace(/\r$/, ""));
      resolve(lines.slice(0, n));
    });
    stream.on("error", reject);
  });
}

export interface PreviewResult {
  detectedColumns: string[];
  expectedColumns: string[];
  columnCountMatches: boolean;
  headerMatches: boolean;
  sampleRows: string[][];
}

export async function previewFile(
  filePath: string,
  hasHeader: boolean
): Promise<PreviewResult> {
  const lines = await readFirstLines(filePath, hasHeader ? 11 : 10);
  const split = (l: string) => l.split("\t");

  let detectedColumns: string[];
  let sampleLines: string[];
  if (hasHeader) {
    detectedColumns = lines.length > 0 ? split(lines[0]!) : [];
    sampleLines = lines.slice(1);
  } else {
    detectedColumns = TSV_HEADER.map((_, i) => `col_${i + 1}`);
    sampleLines = lines;
  }

  const expected = [...TSV_HEADER];
  return {
    detectedColumns,
    expectedColumns: expected,
    columnCountMatches: detectedColumns.length === expected.length,
    headerMatches: hasHeader
      ? detectedColumns.length === expected.length &&
        detectedColumns.every((c, i) => c === expected[i])
      : detectedColumns.length === expected.length,
    sampleRows: sampleLines.map(split),
  };
}
