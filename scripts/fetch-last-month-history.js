#!/usr/bin/env node
/**
 * One-time script: fetch all alerts from last month via GraphQL API,
 * write data/history.json in dashboard format, then git add/commit/push.
 *
 * Run from repo root: node scripts/fetch-last-month-history.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const REPO_ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(REPO_ROOT, "data");
const GRAPHQL_URL = "https://pikud-haoref-graphql-api.tuval-simha.workers.dev/graphql";

async function fetchAllLastMonthAlerts() {
  let after = null;
  let all = [];

  while (true) {
    const query = `
      query GetLastMonth($first: Int!, $after: String) {
        allAlertsFromLastMonth(orderBy: CREATED_AT_DESC, first: $first, after: $after) {
          edges {
            node {
              category
              date
              location
              title
            }
            cursor
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `;

    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { first: 100, after } }),
    });

    if (!res.ok) throw new Error(res.status + " " + res.statusText);
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));

    const page = json.data?.allAlertsFromLastMonth;
    if (!page?.edges) throw new Error("Unexpected response shape");

    all.push(...page.edges.map((e) => e.node));
    console.log("Fetched page, total so far:", all.length);

    if (!page.pageInfo?.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }

  return all;
}

function toHistoryItem(node) {
  return {
    alertDate: node.date,
    data: node.location,
    category: node.category,
    title: node.title,
  };
}

async function main() {
  console.log("Fetching all alerts from last month (GraphQL)...");
  const nodes = await fetchAllLastMonthAlerts();
  console.log("Total alerts:", nodes.length);

  const history = nodes.map(toHistoryItem);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const historyPath = path.join(DATA_DIR, "history.json");
  fs.writeFileSync(historyPath, JSON.stringify(history, null, 0), "utf8");
  console.log("Wrote", historyPath);

  execSync("git add data/history.json", { cwd: REPO_ROOT, stdio: "inherit" });
  try {
    execSync("git diff --staged --quiet", { cwd: REPO_ROOT, stdio: "pipe" });
    console.log("No changes to commit.");
    return;
  } catch (_) {}
  execSync('git commit -m "history: backfill last month from GraphQL API [skip ci]"', {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  execSync("git pull --rebase origin main", { cwd: REPO_ROOT, stdio: "pipe" });
  execSync("git push origin main", { cwd: REPO_ROOT, stdio: "inherit" });
  console.log("Pushed to origin main.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
