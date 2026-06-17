// Turns the raw, often-cryptic errors thrown during an import (Postgres COPY/transform
// failures, stalled uploads, etc.) into a clear, human-readable reason the UI can show.
// The goal: when a file doesn't import, the user learns *why* and what to fix — not just
// "extra data after last expected column".

interface PgLikeError {
  code?: string;
  message: string;
  detail?: string;
  hint?: string;
  where?: string;
  column?: string;
}

function asPgError(err: unknown): PgLikeError | undefined {
  if (err && typeof err === "object" && "message" in err) {
    return err as PgLikeError;
  }
  return undefined;
}

// Postgres tags COPY failures with context like:
//   "COPY persons_staging, line 42, column email: \"...\""
// Pull the line (and column, when present) out so we can point the user at the row.
function locationFrom(where?: string): { line?: string; column?: string } {
  if (!where) return {};
  const line = /line (\d+)/i.exec(where)?.[1];
  const column = /column ([^\s:,]+)/i.exec(where)?.[1];
  return { line, column };
}

function atRow(line?: string): string {
  return line ? ` (at row ${line} of the file)` : "";
}

// Map a raw import failure to a clear explanation. Falls back to the original message so we
// never hide information — we only ever make it friendlier.
export function explainImportError(err: unknown): string {
  const e = asPgError(err);
  if (!e) return String(err);

  const raw = e.message ?? "";
  const { line, column: whereCol } = locationFrom(e.where);
  const col = e.column ?? whereCol;

  // --- Custom stream/upload errors thrown by our own pipeline ---
  if (raw.includes("upload stalled")) {
    return "Upload stalled — no data arrived for a while, so the import was aborted. Check your network connection and try uploading the file again.";
  }
  if (raw.includes("upload connection closed")) {
    return "The upload was interrupted before the whole file arrived. Re-upload the file (a flaky connection or closing the tab can cause this).";
  }

  // --- Postgres error codes (https://www.postgresql.org/docs/current/errcodes-appendix.html) ---
  switch (e.code) {
    // Malformed COPY input: wrong number of columns / bad delimiter.
    case "22P04": {
      if (/extra data/i.test(raw)) {
        return `Too many columns${atRow(line)}. The file has more tab-separated fields than the schema expects — this usually means a wrong delimiter (commas instead of tabs), stray tab characters inside a value, or the "First row is a header" option being set incorrectly.`;
      }
      if (/missing data/i.test(raw)) {
        return `Too few columns${atRow(line)}. The file has fewer tab-separated fields than the schema expects — check for missing trailing columns or a wrong delimiter.`;
      }
      return `The file's format doesn't match what COPY expects${atRow(line)}: ${raw}`;
    }

    // Value can't be cast to the column's type (e.g. text where a number/date is expected).
    case "22P02": // invalid_text_representation
    case "22007": // invalid_datetime_format
    case "22008": // datetime_field_overflow
    case "22003": // numeric_value_out_of_range
      return `A value doesn't match the expected data type${atRow(line)}${
        col ? ` in column "${col}"` : ""
      }: ${raw}. Fix the offending value or enable "Quarantine bad values" to skip rows like this.`;

    // File isn't valid UTF-8.
    case "22021": // character_not_in_repertoire
      return `The file isn't valid UTF-8 text${atRow(line)}. Re-save it with UTF-8 encoding (in Excel: "CSV UTF-8", or set the export encoding to UTF-8) and try again.`;

    case "23502": // not_null_violation
      return `A required value is missing${
        col ? ` in column "${col}"` : ""
      }${atRow(line)}. Every row must have a value for that column.`;

    case "23505": // unique_violation
      return `Duplicate key — a row collides with existing data${
        e.detail ? `: ${e.detail}` : ""
      }. Use "Upsert" mode if you want existing rows updated instead of rejected.`;

    case "53100": // disk_full
      return "The database server ran out of disk space, so the import couldn't finish. Free up space and retry.";

    case "57014": // query_canceled
      return "The import was cancelled before it finished.";

    case "08006": // connection_failure
    case "08003": // connection_does_not_exist
    case "57P01": // admin_shutdown
      return "Lost the connection to the database during the import. Make sure PostgreSQL is running and try again.";
  }

  // Encoding errors sometimes arrive without the code set on the JS error.
  if (/invalid byte sequence for encoding/i.test(raw)) {
    return `The file isn't valid UTF-8 text${atRow(line)}. Re-save it with UTF-8 encoding and try again.`;
  }

  // Unknown failure: surface the original message plus the row, if we have it.
  return line ? `${raw}${atRow(line)}` : raw;
}
