import { Transform, type TransformCallback } from "node:stream";
import { StringDecoder } from "node:string_decoder";

// Real-world TSV exports (Apollo, Salesforce, hand-edited files) routinely contain a few
// rows that break the strict COPY parser:
//   - a stray TAB inside a value  -> the row has MORE fields than the schema  -> COPY aborts
//   - a literal NEWLINE inside a value -> one logical record is split across several physical
//     lines, each with too FEW fields -> COPY aborts
//   - missing trailing empty columns -> the row has slightly too few fields
//
// COPY is all-or-nothing, so a single such row kills the whole import. This Transform repairs
// the stream BEFORE COPY so a handful of dirty rows can't sink a multi-hundred-thousand-row
// load. It emits exactly `expectedFields` tab-separated fields per line, with no embedded
// newlines, which the COPY parser then ingests cleanly.
//
// Repair strategy (positional, no guessing about meaning):
//   - exactly N fields            -> pass through
//   - fewer than N (boundary)     -> hold and try to glue the next line(s) onto it; the
//                                    embedded newline that split the value becomes a space
//   - gluing reaches exactly N    -> emit the rejoined record
//   - gluing would OVERSHOOT N    -> the held row was really complete but missing trailing
//                                    empty columns; pad it to N, emit, restart with this line
//   - more than N fields          -> a stray tab we can't positionally place; skip + report

export interface SkippedRow {
  line: number; // 1-based physical line number in the source file
  fields: number; // how many columns the row actually had
  reason: string; // human-readable explanation of why it couldn't be loaded
  sample: string; // first ~120 chars of the row, for identification
}

export interface NormalizeOptions {
  expectedFields: number;
  // Called once per skipped (over-column) row so the caller can count/record it.
  onSkip?: (info: SkippedRow) => void;
}

export class NormalizeTsvStream extends Transform {
  private readonly decoder = new StringDecoder("utf8");
  private buf = "";
  private pending: string[] | null = null;
  private physicalLine = 0;
  // Number of rows dropped because they had more columns than the schema (unrepairable).
  public skipped = 0;

  constructor(private readonly opts: NormalizeOptions) {
    super();
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    // Decode incrementally so a multi-byte UTF-8 char split across chunks isn't corrupted.
    this.buf += this.decoder.write(chunk);
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) !== -1) {
      let line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1); // tolerate CRLF
      this.physicalLine++;
      this.processParts(line.split("\t"));
    }
    cb();
  }

  override _flush(cb: TransformCallback): void {
    this.buf += this.decoder.end();
    if (this.buf.length > 0) {
      let line = this.buf;
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.physicalLine++;
      this.processParts(line.split("\t"));
      this.buf = "";
    }
    // A record still held at EOF is a final short row: pad to width and emit.
    if (this.pending) {
      this.emitRecord(this.pad(this.pending));
      this.pending = null;
    }
    cb();
  }

  private processParts(parts: string[]): void {
    const n = this.opts.expectedFields;

    // Ignore truly blank lines at a record boundary (trailing newline, stray blank line).
    if (this.pending === null && parts.length === 1 && parts[0] === "") return;

    if (this.pending === null) {
      if (parts.length === n) {
        this.emitRecord(parts);
      } else if (parts.length > n) {
        this.skip(parts);
      } else {
        this.pending = parts; // boundary row: wait for the rest of a newline-split value
      }
      return;
    }

    // Mid-record: gluing the held row to this line rejoins a value broken by an embedded
    // newline (the newline is restored as a single space so COPY sees one physical line).
    const mergedLen = this.pending.length + parts.length - 1;
    if (mergedLen === n) {
      this.emitRecord(this.merge(this.pending, parts));
      this.pending = null;
    } else if (mergedLen < n) {
      this.pending = this.merge(this.pending, parts);
    } else {
      // Overshoot: the held row was complete but missing trailing empty columns.
      this.emitRecord(this.pad(this.pending));
      this.pending = null;
      this.processParts(parts); // restart cleanly with the current line
    }
  }

  private merge(a: string[], b: string[]): string[] {
    return [...a.slice(0, -1), `${a[a.length - 1]} ${b[0]}`, ...b.slice(1)];
  }

  private pad(a: string[]): string[] {
    const out = a.slice();
    while (out.length < this.opts.expectedFields) out.push("");
    return out;
  }

  private emitRecord(fields: string[]): void {
    // Scrub stray carriage returns left inside values (old-Mac line endings or CRs embedded
    // mid-value). The CSV COPY parser rejects an unquoted CR, so collapse them to a space —
    // the field keeps its content, just on one line.
    const clean = fields.map((f) => (f.includes("\r") ? f.replace(/\r/g, " ") : f));
    this.push(Buffer.from(`${clean.join("\t")}\n`, "utf8"));
  }

  private skip(parts: string[]): void {
    this.skipped++;
    this.opts.onSkip?.({
      line: this.physicalLine,
      fields: parts.length,
      reason:
        `the row has ${parts.length} columns but the schema expects ${this.opts.expectedFields} — ` +
        `a stray tab or line break inside one of the values split it into too many fields`,
      sample: parts.join("\t").slice(0, 120),
    });
  }
}
