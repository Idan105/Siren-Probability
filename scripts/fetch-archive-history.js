#!/usr/bin/env node
/**
 * One-time backfill: fetch historical alerts from dleshem/israel-alerts-data (CSV),
 * filter to last 30 days, expand multi-city rows to one record per city,
 * merge with existing data/history.json, sort by alertDate, write data/history.json.
 *
 * Run from repo root: node scripts/fetch-archive-history.js
 *
 * No geo-restriction; data is from GitHub.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const ARCHIVE_CSV_URL =
  "https://raw.githubusercontent.com/dleshem/israel-alerts-data/main/israel-alerts.csv";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Parse a single CSV line; handles quoted fields with commas */
function parseCSVLine(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      const end = line.indexOf('"', i);
      const last = end === -1 ? line.length : end;
      out.push(line.slice(i, last).trim());
      i = last + (end === -1 ? 0 : 1);
      if (line[i] === ",") i++;
    } else {
      const end = line.indexOf(",", i);
      const last = end === -1 ? line.length : end;
      out.push(line.slice(i, last).trim());
      i = last + (end === -1 ? 0 : 1);
    }
  }
  return out;
}

async function fetchArchiveCSV() {
  console.log("Fetching archive CSV from GitHub...");
  const res = await fetch(ARCHIVE_CSV_URL);
  if (!res.ok) {
    throw new Error("Archive CSV: " + res.status + " " + res.statusText);
  }
  return res.text();
}

function csvToHistoryItems(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = parseCSVLine(lines[0]);
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const items = [];
  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    // columns: data, date, time, alertDate, category, category_desc, matrix_id, rid
    const dataRaw = row[0];
    const alertDate = row[3];
    const category = row[4];
    const title = row[5] || "";
    if (!alertDate || !dataRaw) continue;
    if (String(dataRaw).indexOf("בדיקה") !== -1) continue;
    const ts = new Date(alertDate).getTime();
    if (isNaN(ts) || ts < cutoff) continue;
    const cities = dataRaw.split(",").map((s) => s.trim()).filter(Boolean);
    for (const city of cities) {
      if (String(city).indexOf("בדיקה") !== -1) continue;
      items.push({
        alertDate,
        data: city,
        category: category ? parseInt(category, 10) || category : 1,
        title,
      });
    }
  }
  return items;
}

async function main() {
  const historyPath = path.join(DATA_DIR, "history.json");
  let existing = [];
  if (fs.existsSync(historyPath)) {
    try {
      const raw = fs.readFileSync(historyPath, "utf8").trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        existing = Array.isArray(parsed) ? parsed : [];
      }
    } catch (_) {}
  }
  console.log("Existing history items:", existing.length);

  const csvText = await fetchArchiveCSV();
  const fromArchive = csvToHistoryItems(csvText);
  console.log("From archive (last 30 days, expanded):", fromArchive.length);

  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const seen = new Set();
  const merged = [];
  for (const item of [...existing, ...fromArchive]) {
    const id = (item.alertDate || "") + "|" + (item.data || "").trim();
    if (seen.has(id)) continue;
    const ts = new Date(item.alertDate).getTime();
    if (isNaN(ts) || ts < cutoff) continue;
    seen.add(id);
    merged.push({
      alertDate: item.alertDate,
      data: (item.data || "").trim(),
      category: item.category,
      title: item.title,
    });
  }
  const history = merged.sort((a, b) => {
    const tA = new Date(a.alertDate).getTime();
    const tB = new Date(b.alertDate).getTime();
    return tA - tB;
  });

  console.log("Merged (last 30 days):", history.length);

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 0), "utf8");
  console.log("Wrote", historyPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
