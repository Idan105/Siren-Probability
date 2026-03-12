#!/usr/bin/env node
/**
 * One-time script: fetch alerts history from Pikud HaOref's official history API
 * (see https://github.com/eladnava/pikud-haoref-api config: AlertsHistory.json),
 * filter to last 30 days, write data/history.json in dashboard format, then git add/commit/push.
 *
 * Run from repo root: node scripts/fetch-last-month-history.js
 *
 * Note: The Oref API is geo-restricted; run from Israel or use a proxy.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "data");
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
  console.log("Fetching alerts history from Oref (AlertsHistory.json)...");
  const raw = await fetchOrefHistory();
  console.log("Raw items from API:", raw.length);

  const cutoff = Date.now() - THIRTY_DAYS_MS;
  const filtered = raw.filter((item) => {
    if (!item.alertDate || !item.data) return false;
    if (String(item.data || "").indexOf("בדיקה") !== -1) return false;
    const ts = new Date(item.alertDate).getTime();
    return !isNaN(ts) && ts >= cutoff;
  });

  const history = filtered.map(toHistoryItem).sort((a, b) => {
    const tA = new Date(a.alertDate).getTime();
    const tB = new Date(b.alertDate).getTime();
    return tA - tB;
  });

  console.log("Last 30 days (after filter):", history.length);

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const historyPath = path.join(DATA_DIR, "history.json");
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 0), "utf8");
  console.log("Wrote", historyPath);

  execSync("git add data/history.json", { cwd: REPO_ROOT, stdio: "inherit" });
  try {
    execSync("git diff --staged --quiet", { cwd: REPO_ROOT, stdio: "pipe" });
    console.log("No changes to commit.");
    return;
  } catch (_) {}
  execSync(
    'git commit -m "history: backfill last 30 days from Oref AlertsHistory API [skip ci]"',
    { cwd: REPO_ROOT, stdio: "inherit" }
  );

  let stashed = false;
  const status = execSync("git status --porcelain", {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (status.trim()) {
    execSync('git stash push -u -m "fetch-last-month-history"', {
      cwd: REPO_ROOT,
      stdio: "inherit",
    });
    stashed = true;
  }
  try {
    execSync("git pull --rebase origin main", { cwd: REPO_ROOT, stdio: "pipe" });
    execSync("git push origin main", { cwd: REPO_ROOT, stdio: "inherit" });
    console.log("Pushed to origin main.");
  } finally {
    if (stashed) {
      execSync("git stash pop", { cwd: REPO_ROOT, stdio: "inherit" });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
