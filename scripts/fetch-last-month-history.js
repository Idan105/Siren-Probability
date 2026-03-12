#!/usr/bin/env node
/**
 * Fetch alerts history from Pikud HaOref's official history API and merge with
 * existing data/history.json. The API only returns a short recent window (hours);
 * by merging we keep up to 30 days across runs (same logic as the workflow).
 * Writes data/history.json. You can commit and push yourself.
 *
 * Run from repo root: node scripts/fetch-last-month-history.js
 *
 * Note: The Oref API is geo-restricted; run from Israel or use a proxy.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const OREF_HISTORY_URL =
  "https://www.oref.org.il/warningMessages/alert/History/AlertsHistory.json";

// Same headers as pikud-haoref-api to avoid cache and get valid response
const OREF_HEADERS = {
  Pragma: "no-cache",
  "Cache-Control": "max-age=0",
  Referer: "https://www.oref.org.il/11226-he/pakar.aspx",
  "X-Requested-With": "XMLHttpRequest",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function decodeOrefBody(buffer) {
  // API may return UTF-16-LE or UTF-8 with BOM (per pikud-haoref-api lib/alerts.js)
  let encoding = "utf8";
  let buf = Buffer.from(buffer);
  if (buf.length > 1 && buf[0] === 0xff && buf[1] === 0xfe) {
    encoding = "utf16le";
    buf = buf.slice(2);
  } else if (
    buf.length > 2 &&
    buf[0] === 0xef &&
    buf[1] === 0xbb &&
    buf[2] === 0xbf
  ) {
    buf = buf.slice(3);
  }
  let body = buf.toString(encoding);
  body = body.replace(/\x00/g, "");
  body = body.replace(/\u0a7b/g, "");
  return body;
}

async function fetchOrefHistory() {
  const url = OREF_HISTORY_URL + "?" + Math.round(Date.now() / 1000);
  const res = await fetch(url, {
    method: "GET",
    headers: OREF_HEADERS,
  });

  if (!res.ok) {
    throw new Error("Oref history API: " + res.status + " " + res.statusText);
  }

  const arrayBuffer = await res.arrayBuffer();
  const body = decodeOrefBody(arrayBuffer);
  if (!body.trim()) {
    return [];
  }

  const json = JSON.parse(body);
  if (!Array.isArray(json)) {
    throw new Error("Unexpected response: expected array of alerts");
  }

  return json;
}

function toHistoryItem(item) {
  return {
    alertDate: item.alertDate,
    data: item.data,
    category: item.category,
    title: item.title,
  };
}

async function main() {
  // Oref's API only returns a short recent window (hours/same day). Merge with existing
  // data/history.json so we keep building up to 30 days across runs (same as the workflow).
  let existing = [];
  const historyPath = path.join(DATA_DIR, "history.json");
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

  console.log("Fetching alerts history from Oref (AlertsHistory.json)...");
  const raw = await fetchOrefHistory();
  console.log("Raw items from API:", raw.length);

  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const fresh = raw
    .filter((item) => {
      if (!item.alertDate || !item.data) return false;
      if (String(item.data || "").indexOf("בדיקה") !== -1) return false;
      const ts = new Date(item.alertDate).getTime();
      return !isNaN(ts) && ts >= cutoff;
    })
    .map(toHistoryItem);

  const seen = new Set();
  const merged = [];
  for (const item of [...existing, ...fresh]) {
    const id = (item.alertDate || "") + "|" + (item.data || "");
    if (seen.has(id)) continue;
    const ts = new Date(item.alertDate).getTime();
    if (isNaN(ts) || ts < cutoff) continue;
    seen.add(id);
    merged.push(item);
  }
  const history = merged.sort((a, b) => {
    const tA = new Date(a.alertDate).getTime();
    const tB = new Date(b.alertDate).getTime();
    return tA - tB;
  });

  console.log("Last 30 days (after merge):", history.length);

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
