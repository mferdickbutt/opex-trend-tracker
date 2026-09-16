/**
 * Pure OPEX analytics. Safe on zero expense, empty series, null inputs,
 * and single-category months: never returns NaN or Infinity (null instead).
 *
 * Works in Node (CommonJS) and the browser (global `Opex`).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root && typeof root === "object") {
    root.Opex = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CATEGORIES = ["payroll", "software", "facilities", "marketing", "other"];
  var MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function asNumber(value) {
    if (value == null || value === "") return null;
    if (typeof value === "boolean") return null;
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === "string") {
      var trimmed = value.trim();
      if (!trimmed) return null;
      var parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  }

  function finiteOrNull(value) {
    return isFiniteNumber(value) ? value : null;
  }

  /**
   * Sum of known OPEX categories.
   * Missing/null categories are skipped. All-missing → null.
   * Explicit zeros sum to 0 (zero expense is a valid total).
   */
  function totalOpex(opex) {
    if (opex == null || typeof opex !== "object" || Array.isArray(opex)) {
      return null;
    }
    var sum = 0;
    var seen = false;
    for (var i = 0; i < CATEGORIES.length; i++) {
      var key = CATEGORIES[i];
      if (!Object.prototype.hasOwnProperty.call(opex, key)) continue;
      if (opex[key] == null || opex[key] === "") continue;
      var n = asNumber(opex[key]);
      if (n == null) return null;
      sum += n;
      seen = true;
    }
    return seen ? finiteOrNull(sum) : null;
  }

  /**
   * Month-over-month change as a ratio: (current - previous) / previous.
   * Null when either side is null or previous is 0.
   */
  function monthOverMonth(current, previous) {
    var cur = asNumber(current);
    var prev = asNumber(previous);
    if (cur == null || prev == null || prev === 0) return null;
    return finiteOrNull((cur - prev) / prev);
  }

  /**
   * Share of total OPEX for each category (0–1).
   * When total is null or 0, every share is null.
   * Missing categories are 0 when total > 0.
   */
  function categoryMix(opex, total) {
    var mix = {};
    var t = arguments.length > 1 ? asNumber(total) : totalOpex(opex);
    var invalid =
      opex == null ||
      typeof opex !== "object" ||
      Array.isArray(opex) ||
      t == null ||
      t === 0;
    if (invalid) {
      for (var i = 0; i < CATEGORIES.length; i++) mix[CATEGORIES[i]] = null;
      return mix;
    }
    for (var j = 0; j < CATEGORIES.length; j++) {
      var key = CATEGORIES[j];
      if (!Object.prototype.hasOwnProperty.call(opex, key) || opex[key] == null || opex[key] === "") {
        mix[key] = 0;
        continue;
      }
      var n = asNumber(opex[key]);
      mix[key] = n == null ? null : finiteOrNull(n / t);
    }
    return mix;
  }

  /**
   * OPEX / revenue. Null when revenue is 0 or either input is null.
   * Zero OPEX with positive revenue → 0.
   */
  function opexToRevenue(total, revenue) {
    var t = asNumber(total);
    var r = asNumber(revenue);
    if (t == null || r == null || r === 0) return null;
    return finiteOrNull(t / r);
  }

  /**
   * Actual vs target: delta and delta as a share of target.
   * Null when actual/target is null or target is 0.
   */
  function compareToTarget(actual, target) {
    var a = asNumber(actual);
    var g = asNumber(target);
    if (a == null || g == null || g === 0) return null;
    var delta = a - g;
    var deltaPct = delta / g;
    if (!Number.isFinite(delta) || !Number.isFinite(deltaPct)) return null;
    return {
      actual: a,
      target: g,
      delta: delta,
      deltaPct: deltaPct,
      overTarget: a > g,
    };
  }

  function analyzeMonth(row, previousTotal, targets) {
    if (row == null || typeof row !== "object") return null;
    var total = totalOpex(row.opex);
    var revenue = asNumber(row.revenue);
    var mix = categoryMix(row.opex, total);
    var ratio = opexToRevenue(total, revenue);
    var mom = monthOverMonth(total, previousTotal);
    var opexTarget = null;
    var ratioTarget = null;
    var mixTargets = null;
    if (targets && typeof targets === "object") {
      if (targets.monthlyOpex != null) {
        opexTarget = compareToTarget(total, targets.monthlyOpex);
      }
      if (targets.opexToRevenue != null) {
        ratioTarget = compareToTarget(ratio, targets.opexToRevenue);
      }
      if (targets.categoryMix && typeof targets.categoryMix === "object") {
        mixTargets = {};
        for (var i = 0; i < CATEGORIES.length; i++) {
          var key = CATEGORIES[i];
          mixTargets[key] = compareToTarget(mix[key], targets.categoryMix[key]);
        }
      }
    }
    return {
      month: typeof row.month === "string" ? row.month : null,
      opex: row.opex && typeof row.opex === "object" ? row.opex : null,
      total: total,
      revenue: revenue,
      mix: mix,
      opexToRevenue: ratio,
      mom: mom,
      vsOpexTarget: opexTarget,
      vsRatioTarget: ratioTarget,
      vsMixTarget: mixTargets,
    };
  }

  /**
   * Analyze a full data document `{ meta, targets, months }`.
   * Empty/null series → `{ months: [], latest: null, mom: null }`.
   */
  function analyzeSeries(data) {
    var empty = {
      months: [],
      latest: null,
      previous: null,
      mom: null,
      targets: null,
      currency: "USD",
      categories: CATEGORIES.slice(),
      meta: null,
    };
    if (data == null || typeof data !== "object") return empty;
    var targets = data.targets && typeof data.targets === "object" ? data.targets : null;
    var rows = Array.isArray(data.months) ? data.months.filter(Boolean) : [];
    var sorted = rows.slice().sort(function (a, b) {
      return String((a && a.month) || "").localeCompare(String((b && b.month) || ""));
    });
    var months = [];
    var prevTotal = null;
    for (var i = 0; i < sorted.length; i++) {
      var analyzed = analyzeMonth(sorted[i], prevTotal, targets);
      if (analyzed) {
        months.push(analyzed);
        prevTotal = analyzed.total;
      }
    }
    var latest = months.length ? months[months.length - 1] : null;
    var previous = months.length > 1 ? months[months.length - 2] : null;
    return {
      months: months,
      latest: latest,
      previous: previous,
      mom: latest ? latest.mom : null,
      targets: targets,
      currency: (data.meta && data.meta.currency) || "USD",
      categories: CATEGORIES.slice(),
      meta: data.meta || null,
    };
  }

  function monthLabel(iso) {
    if (iso == null || typeof iso !== "string") return "—";
    var parts = iso.split("-");
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    if (!year || month < 1 || month > 12) return iso;
    return MONTH_NAMES[month - 1] + " " + year;
  }

  function formatMoney(value) {
    if (!isFiniteNumber(value)) return "—";
    var abs = Math.abs(value);
    var formatted = abs.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });
    return value < 0 ? "-" + formatted : formatted;
  }

  function formatPercent(ratio, signed, digits) {
    if (!isFiniteNumber(ratio)) return "—";
    var places = isFiniteNumber(digits) ? digits : 1;
    var pct = ratio * 100;
    var body = pct.toFixed(places) + "%";
    if (signed && pct > 0) return "+" + body;
    return body;
  }

  function formatRatio(ratio) {
    return formatPercent(ratio, false, 1);
  }

  function categoryLabel(key) {
    if (!key) return "—";
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  return {
    CATEGORIES: CATEGORIES,
    isFiniteNumber: isFiniteNumber,
    asNumber: asNumber,
    totalOpex: totalOpex,
    monthOverMonth: monthOverMonth,
    categoryMix: categoryMix,
    opexToRevenue: opexToRevenue,
    compareToTarget: compareToTarget,
    analyzeMonth: analyzeMonth,
    analyzeSeries: analyzeSeries,
    monthLabel: monthLabel,
    formatMoney: formatMoney,
    formatPercent: formatPercent,
    formatRatio: formatRatio,
    categoryLabel: categoryLabel,
  };
});
