#!/usr/bin/env node
/**
 * Bake OPEX summary metrics and the monthly table into index.html.
 * First paint does not require JavaScript.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const Opex = require("../js/opex.js");

const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "opex.json");
const OUT_PATH = path.join(ROOT, "index.html");

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attr(value) {
  return value == null || !Number.isFinite(Number(value)) ? "" : String(value);
}

function toneClass(value, invert) {
  if (!Opex.isFiniteNumber(value) || value === 0) return "";
  const upIsBad = invert !== false;
  if (value > 0) return upIsBad ? "up" : "down good";
  return upIsBad ? "down good" : "up";
}

function targetCopy(comparison, unit) {
  if (!comparison) return "No target comparison (missing actual or target).";
  const verb = comparison.overTarget ? "over" : "under";
  const cls = comparison.overTarget ? "warn" : "good";
  const relative = Opex.formatPercent(Math.abs(comparison.deltaPct), false, 1);
  if (unit === "money") {
    return (
      '<span class="' +
      cls +
      '">' +
      verb +
      " target by " +
      Opex.formatMoney(Math.abs(comparison.delta)) +
      " (" +
      relative +
      ")</span>"
    );
  }
  return (
    '<span class="' +
    cls +
    '">' +
    verb +
    " target by " +
    Opex.formatPercent(Math.abs(comparison.delta), false, 1) +
    " pts (" +
    relative +
    " relative)</span>"
  );
}

function pill(comparison) {
  if (!comparison) return '<span class="pill">—</span>';
  const cls = comparison.overTarget ? "over" : "under";
  const label = comparison.overTarget ? "Over" : "Under";
  return (
    '<span class="pill ' +
    cls +
    '">' +
    label +
    " " +
    Opex.formatPercent(Math.abs(comparison.deltaPct), false, 1) +
    "</span>"
  );
}

function mixRows(latest) {
  return Opex.CATEGORIES.map(function (key) {
    if (!latest) {
      return (
        '<div class="mix-row"><div>' +
        escapeHtml(Opex.categoryLabel(key)) +
        '</div><div class="mix-bar"><span style="width:0%"></span></div><div>—</div><div class="sub">—</div></div>'
      );
    }
    const share = latest.mix[key];
    const width = Opex.isFiniteNumber(share) ? Math.max(0, Math.min(100, share * 100)).toFixed(1) : "0";
    const vs = latest.vsMixTarget ? latest.vsMixTarget[key] : null;
    const vsText = vs
      ? (vs.overTarget ? "over" : "under") + " mix target " + Opex.formatPercent(Math.abs(vs.delta), false, 1) + " pts"
      : "no mix target";
    return (
      '<div class="mix-row"><div>' +
      escapeHtml(Opex.categoryLabel(key)) +
      '</div><div class="mix-bar" title="' +
      escapeHtml(Opex.formatPercent(share, false, 1)) +
      '"><span style="width:' +
      width +
      '%"></span></div><div>' +
      Opex.formatPercent(share, false, 1) +
      '</div><div class="sub">' +
      escapeHtml(vsText) +
      "</div></div>"
    );
  }).join("");
}

function sparkBars(months) {
  const totals = months.map(function (row) {
    return Opex.isFiniteNumber(row.total) ? row.total : 0;
  });
  const max = totals.reduce(function (acc, n) {
    return n > acc ? n : acc;
  }, 0);
  return months
    .map(function (row, index) {
      const height = max > 0 && Opex.isFiniteNumber(row.total) ? (row.total / max) * 100 : 0;
      const latest = index === months.length - 1 ? " is-latest" : "";
      return (
        '<div class="bar' +
        latest +
        '" style="height:' +
        height.toFixed(1) +
        '%" title="' +
        escapeHtml(Opex.monthLabel(row.month) + " " + Opex.formatMoney(row.total)) +
        '"></div>'
      );
    })
    .join("");
}

function monthRows(months) {
  return months
    .map(function (row) {
      const opex = row.opex || {};
      const cells = Opex.CATEGORIES.map(function (key) {
        const n = Opex.asNumber(opex[key]);
        return (
          '<td data-key="' +
          key +
          '" data-value="' +
          attr(n) +
          '">' +
          Opex.formatMoney(n) +
          "</td>"
        );
      }).join("");
      return (
        '<tr data-month="' +
        escapeHtml(row.month || "") +
        '" data-label="' +
        escapeHtml(Opex.monthLabel(row.month)) +
        '" data-total="' +
        escapeHtml(Opex.formatMoney(row.total)) +
        '">' +
        '<td data-key="month" data-value="' +
        escapeHtml(row.month || "") +
        '">' +
        escapeHtml(Opex.monthLabel(row.month)) +
        "</td>" +
        cells +
        '<td data-key="total" data-value="' +
        attr(row.total) +
        '">' +
        Opex.formatMoney(row.total) +
        "</td>" +
        '<td data-key="revenue" data-value="' +
        attr(row.revenue) +
        '">' +
        Opex.formatMoney(row.revenue) +
        "</td>" +
        '<td data-key="ratio" data-value="' +
        attr(row.opexToRevenue) +
        '">' +
        Opex.formatRatio(row.opexToRevenue) +
        "</td>" +
        '<td data-key="mom" data-value="' +
        attr(row.mom) +
        '">' +
        Opex.formatPercent(row.mom, true, 1) +
        "</td>" +
        '<td data-key="target">' +
        pill(row.vsOpexTarget) +
        "</td>" +
        "</tr>"
      );
    })
    .join("\n");
}

function render(data) {
  const series = Opex.analyzeSeries(data);
  const latest = series.latest;
  const coverage = data.meta && data.meta.coverage ? data.meta.coverage : "";
  const monthCount = series.months.length;
  const latestLabel = latest ? Opex.monthLabel(latest.month) : "—";
  const totalText = latest ? Opex.formatMoney(latest.total) : "—";
  const momText = latest ? Opex.formatPercent(latest.mom, true, 1) : "—";
  const ratioText = latest ? Opex.formatRatio(latest.opexToRevenue) : "—";
  const momHint =
    latest && series.previous
      ? "vs " + Opex.monthLabel(series.previous.month) + " (" + Opex.formatMoney(series.previous.total) + ")"
      : "MoM change needs a prior month with non-zero OPEX";
  const targetOpex = series.targets ? Opex.formatMoney(series.targets.monthlyOpex) : "—";
  const targetRatio = series.targets ? Opex.formatPercent(series.targets.opexToRevenue, false, 0) : "—";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OPEX Trend Tracker</title>
  <meta name="description" content="Operating expense trend tracker with category mix, MoM change, OPEX-to-revenue, and target comparisons. First paint is fully baked HTML.">
  <link rel="stylesheet" href="css/styles.css">
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <div class="kicker">Operating expense ledger</div>
      <h1>OPEX Trend Tracker</h1>
      <p>
        ${monthCount} months of sample operating expense (${escapeHtml(coverage)}).
        Summary metrics and the monthly table below are baked into this HTML so a static
        <code>curl -sL</code> first paint shows Total OPEX, MoM change, category mix, OPEX-to-revenue, and every month row with no JavaScript placeholder.
      </p>
    </header>

    <section class="metrics" aria-label="Summary metrics">
      <article class="card" id="metric-total-opex">
        <h2>Total OPEX</h2>
        <p class="value">${totalText}</p>
        <p class="hint">${escapeHtml(latestLabel)}</p>
      </article>
      <article class="card" id="metric-mom">
        <h2>MoM change</h2>
        <p class="value ${toneClass(latest && latest.mom)}">${momText}</p>
        <p class="hint">${escapeHtml(momHint)}</p>
      </article>
      <article class="card" id="metric-opex-to-revenue">
        <h2>OPEX-to-revenue</h2>
        <p class="value">${ratioText}</p>
        <p class="hint">OPEX as a share of monthly revenue</p>
      </article>
      <article class="card" id="metric-targets">
        <h2>Target comparisons</h2>
        <p class="sub">OPEX target ${targetOpex}: ${latest ? targetCopy(latest.vsOpexTarget, "money") : "—"}</p>
        <p class="sub">OPEX-to-revenue target ${targetRatio}: ${latest ? targetCopy(latest.vsRatioTarget, "ratio") : "—"}</p>
      </article>
    </section>

    <section class="mix" id="category-mix" aria-label="Category mix">
      <h2>Category mix</h2>
      <p class="hint">Percent of total by category for ${escapeHtml(latestLabel)}.</p>
      <div class="mix-grid">
        ${mixRows(latest)}
      </div>
    </section>

    <section class="trend" aria-label="OPEX sparkline">
      <h2>Monthly OPEX</h2>
      <div class="spark">${sparkBars(series.months)}</div>
    </section>

    <section aria-label="Monthly table">
      <h2>Monthly table</h2>
      <p class="hint">Click a column header to sort after JavaScript loads. Rows and values are already in the markup.</p>
      <p id="selected-month"></p>
      <div class="table-wrap">
        <table id="monthly-table">
          <thead>
            <tr>
              <th data-sort="month" data-type="string">Month</th>
              <th data-sort="payroll" data-type="number">Payroll</th>
              <th data-sort="software" data-type="number">Software</th>
              <th data-sort="facilities" data-type="number">Facilities</th>
              <th data-sort="marketing" data-type="number">Marketing</th>
              <th data-sort="other" data-type="number">Other</th>
              <th data-sort="total" data-type="number">Total OPEX</th>
              <th data-sort="revenue" data-type="number">Revenue</th>
              <th data-sort="ratio" data-type="number">OPEX-to-revenue</th>
              <th data-sort="mom" data-type="number">MoM</th>
              <th>vs OPEX target</th>
            </tr>
          </thead>
          <tbody>
${monthRows(series.months)}
          </tbody>
        </table>
      </div>
    </section>

    <footer>
      <p>Source data: <a href="data/opex.json"><code>data/opex.json</code></a>. Re-render with <code>node scripts/render-static.js</code>.</p>
    </footer>
  </div>
  <script src="js/opex.js" defer></script>
  <script src="js/app.js" defer></script>
</body>
</html>
`;
}

function main() {
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const html = render(data);
  fs.writeFileSync(OUT_PATH, html);
  const series = Opex.analyzeSeries(data);
  process.stdout.write(
    "Wrote " +
      path.relative(ROOT, OUT_PATH) +
      " with " +
      series.months.length +
      " month rows; latest total " +
      (series.latest ? Opex.formatMoney(series.latest.total) : "—") +
      "\n"
  );
}

main();
