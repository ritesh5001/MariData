import fs from "node:fs";
import { TSV_HEADER } from "../src/ingest/schema.js";

// Generate a valid 39-column sample TSV for testing the ingestion pipeline.
// Usage: npm run make-sample -- <rows> <outPath>
// Includes a fraction of rows with deliberately bad date/json/number values to exercise
// the quarantine path, and a couple of duplicate _id values to exercise ON CONFLICT.

const rows = Number(process.argv[2] ?? 1000);
const out = process.argv[3] ?? "/tmp/maridata-sample.tsv";

const firsts = ["Maria", "John", "Wei", "Aisha", "Carlos", "Priya", "Liam", "Sofia"];
const lasts = ["Smith", "Chen", "Khan", "Garcia", "Patel", "Nguyen", "Rossi", "Kim"];
const titles = ["CEO", "VP Sales", "Founder", "CTO", "Marketing Manager", "Engineer"];
const seniorities = ["c_suite", "vp", "founder", "manager", "senior", "entry"];
const countries = ["US", "GB", "IN", "DE", "BR", "CA", "AU", "SG"];
const states = ["California", "Texas", "London", "Maharashtra", "Bavaria", "Ontario"];
const orgs = ["Acme Corp", "Globex", "Initech", "Umbrella", "Hooli", "Stark Industries"];

const pick = <T>(a: T[], i: number): T => a[i % a.length]!;

const lines: string[] = [TSV_HEADER.join("\t")];

for (let i = 0; i < rows; i++) {
  const first = pick(firsts, i);
  const last = pick(lasts, i + 3);
  const name = `${first} ${last}`;
  const org = pick(orgs, i + 1);
  const country = pick(countries, i);
  const badJson = i % 17 === 0; // ~6% bad json
  const badDate = i % 23 === 0; // ~4% bad date
  const badNum = i % 29 === 0; // ~3% bad number
  // Two rows share an external_id to test ON CONFLICT dedup.
  const externalId = i === 5 ? "ext-2" : `ext-${i}`;

  const geojson = badJson
    ? '{not valid json'
    : `{"type":"Point","coordinates":[${(i % 90).toFixed(4)},${(i % 45).toFixed(4)}]}`;
  const predictive = `{"score":${(i % 100) / 100}}`;

  const row = [
    name, // person_name
    first, // first
    last, // last
    name.toLowerCase(), // downcase
    pick(titles, i), // title
    `["${pick(titles, i).toLowerCase()}","sales"]`, // functions (JSON array)
    pick(seniorities, i), // seniority
    "verified", // email_status_cd
    badNum ? "not-a-number" : (0.5 + (i % 50) / 100).toFixed(2), // email confidence
    `${first.toLowerCase()}.${last.toLowerCase()}@${org.replace(/\s/g, "").toLowerCase()}.com`, // email
    `+1-555-${String(1000 + (i % 9000)).padStart(4, "0")}`, // phone
    `+1555${String(1000 + (i % 9000)).padStart(4, "0")}`, // sanitized phone
    "", // email_analyzed
    `https://linkedin.com/in/${first.toLowerCase()}-${last.toLowerCase()}-${i}`, // linkedin
    "sales", // detailed function
    pick(titles, i), // title normalized
    pick(titles, i), // primary title faceting
    org, // org
    pick(["San Francisco", "Austin", "London", "Mumbai", "Munich"], i), // city
    `${pick(["San Francisco", "Austin", "London"], i)}, ${country}`, // city_full
    pick(states, i), // state
    `${pick(states, i)}, ${country}`, // state_full
    country, // country
    String(10000 + (i % 89999)), // postal
    badDate ? "31/13/2020" : `20${10 + (i % 15)}-0${1 + (i % 9)}-1${i % 9}`, // job_start_date
    `["org-${i % 100}"]`, // current_organization_ids
    "email", // modality
    `["team-${i % 10}"]`, // prospected_by_team_ids
    "", // excluded_by_team_ids
    ((i % 100) / 100).toFixed(2), // relevance_boost
    badNum ? "abc" : String(50 + (i % 4000)), // num_linkedin_connections
    geojson, // location_geojson
    predictive, // predictive_scores
    `20${10 + (i % 15)}-01-01T00:00:00Z`, // vacuumed_at
    (Math.random()).toFixed(6), // random
    "people_v3", // _index
    "person", // _type
    externalId, // _id
    (0.5 + (i % 50) / 100).toFixed(3), // _score
  ];

  if (row.length !== TSV_HEADER.length) {
    throw new Error(`row ${i} has ${row.length} cols, expected ${TSV_HEADER.length}`);
  }
  lines.push(row.join("\t"));
}

fs.writeFileSync(out, lines.join("\n") + "\n");
console.log(`wrote ${rows} rows -> ${out}`);
