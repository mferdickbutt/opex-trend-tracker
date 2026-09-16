#!/usr/bin/env bash
# OPEX tracker checks: pure math edge cases + static first-paint HTML.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0

pass() {
  echo "PASS: $1"
  PASS=$((PASS + 1))
}

fail() {
  echo "FAIL: $1"
  FAIL=$((FAIL + 1))
}

if ! command -v node >/dev/null 2>&1; then
  echo "FAIL: node is required"
  echo "Summary: 0 passed, 1 failed"
  exit 1
fi

MATH_OUT="$(node << 'NODE'
const fs = require("fs");
const Opex = require("./js/opex.js");

function isPoison(value) {
  if (typeof value === "number") return !Number.isFinite(value);
  if (value && typeof value === "object") {
    if (Array.isArray(value)) return value.some(isPoison);
    return Object.keys(value).some((k) => isPoison(value[k]));
  }
  return false;
}

function check(name, cond) {
  process.stdout.write((cond ? "PASS: " : "FAIL: ") + name + "\n");
}

check("null input totalOpex returns null", Opex.totalOpex(null) === null);
check("empty object totalOpex returns null", Opex.totalOpex({}) === null);
check("zero expense total is 0 not null", Opex.totalOpex({
  payroll: 0, software: 0, facilities: 0, marketing: 0, other: 0
}) === 0);

const zeroMix = Opex.categoryMix({
  payroll: 0, software: 0, facilities: 0, marketing: 0, other: 0
});
check("zero expense category mix is null shares", Object.values(zeroMix).every((v) => v === null));

check("MoM with previous zero returns null", Opex.monthOverMonth(100, 0) === null);
check("MoM with null inputs returns null", Opex.monthOverMonth(null, null) === null);
check("MoM 110 vs 100 is 0.1", Opex.monthOverMonth(110, 100) === 0.1);

check("opex-to-revenue with zero revenue returns null", Opex.opexToRevenue(80, 0) === null);
check("opex-to-revenue null inputs return null", Opex.opexToRevenue(null, null) === null);
check("zero expense vs positive revenue is 0", Opex.opexToRevenue(0, 500) === 0);

const single = Opex.categoryMix({ payroll: 2500 });
check("single-category month mix is 100% payroll", single.payroll === 1);
check("single-category remaining categories are 0", single.software === 0 && single.facilities === 0 && single.marketing === 0 && single.other === 0);
check("single-category totalOpex equals the one category", Opex.totalOpex({ payroll: 2500 }) === 2500);

const empty = Opex.analyzeSeries({ months: [] });
check("empty series latest is null", empty.latest === null && empty.mom === null && Array.isArray(empty.months) && empty.months.length === 0);
check("null series analyzeSeries returns empty months", Opex.analyzeSeries(null).months.length === 0);

check("compareToTarget with zero target returns null", Opex.compareToTarget(10, 0) === null);
check("compareToTarget 90 vs 100 is under by 10%", Opex.compareToTarget(90, 100).overTarget === false && Opex.compareToTarget(90, 100).deltaPct === -0.1);

const infGuard = Opex.analyzeSeries({
  targets: { monthlyOpex: 0, opexToRevenue: 0 },
  months: [
    { month: "2026-01", revenue: 0, opex: { payroll: 0, software: 0, facilities: 0, marketing: 0, other: 0 } },
    { month: "2026-02", revenue: null, opex: null },
    { month: "2026-03", revenue: 1000, opex: { payroll: 1000 } }
  ]
});
check("zero/empty/null series never yields NaN or Infinity", !isPoison(infGuard));
check("single-category month in mixed series has 100% mix", infGuard.months[2] && infGuard.months[2].mix.payroll === 1 && infGuard.months[2].total === 1000);

const sample = JSON.parse(fs.readFileSync("./data/opex.json", "utf8"));
const series = Opex.analyzeSeries(sample);
check("sample series has 18 months", series.months.length === 18);
check("sample latest total OPEX is finite", Opex.isFiniteNumber(series.latest && series.latest.total));
check("sample latest MoM is finite", Opex.isFiniteNumber(series.latest && series.latest.mom));
check("sample latest category mix sums to 1", Math.abs(Opex.CATEGORIES.reduce((s, k) => s + series.latest.mix[k], 0) - 1) < 1e-9);
check("sample latest OPEX-to-revenue is finite", Opex.isFiniteNumber(series.latest && series.latest.opexToRevenue));
NODE
)"

printf '%s\n' "$MATH_OUT"
while IFS= read -r line; do
  case "$line" in
    PASS:*) PASS=$((PASS + 1)) ;;
    FAIL:*) FAIL=$((FAIL + 1)) ;;
  esac
done <<< "$MATH_OUT"

# --- Static first-paint HTML ---
if [[ ! -f "$ROOT/index.html" ]]; then
  fail "index.html exists for first paint"
else
  pass "index.html exists for first paint"
fi

HTML="$(cat "$ROOT/index.html")"

if grep -q -E 'Loading…|Loading\.\.\.|Loading\.\.|id="loading"' "$ROOT/index.html"; then
  fail "static HTML has no Loading shell"
else
  pass "static HTML has no Loading shell"
fi

echo "$HTML" | grep -q "Total OPEX" && pass "static HTML includes Total OPEX" || fail "static HTML includes Total OPEX"
echo "$HTML" | grep -q "MoM change" && pass "static HTML includes MoM change" || fail "static HTML includes MoM change"
echo "$HTML" | grep -q "Category mix" && pass "static HTML includes Category mix" || fail "static HTML includes Category mix"
echo "$HTML" | grep -q "OPEX-to-revenue" && pass "static HTML includes OPEX-to-revenue" || fail "static HTML includes OPEX-to-revenue"
echo "$HTML" | grep -q "Target comparisons" && pass "static HTML includes Target comparisons" || fail "static HTML includes Target comparisons"

ROW_COUNT="$(grep -c 'data-month="' "$ROOT/index.html" || true)"
if [[ "$ROW_COUNT" -eq 18 ]]; then
  pass "static HTML has 18 month rows"
else
  fail "static HTML has 18 month rows (found ${ROW_COUNT})"
fi

echo "$HTML" | grep -q 'data-month="2025-04"' && pass "static HTML includes first month 2025-04" || fail "static HTML includes first month 2025-04"
echo "$HTML" | grep -q 'data-month="2026-09"' && pass "static HTML includes last month 2026-09" || fail "static HTML includes last month 2026-09"

LATEST_TOTAL="$(node -e 'const O=require("./js/opex.js");const d=require("./data/opex.json");const s=O.analyzeSeries(d);process.stdout.write(O.formatMoney(s.latest.total));')"
echo "$HTML" | grep -F -q "$LATEST_TOTAL" && pass "baked Total OPEX value ${LATEST_TOTAL} is in HTML" || fail "baked Total OPEX value ${LATEST_TOTAL} is in HTML"

# curl -sL against a static server (no JS execution)
PORT=8765
python3 -m http.server "$PORT" --bind 127.0.0.1 >/tmp/opex-http.log 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" >/dev/null 2>&1 || true; }
trap cleanup EXIT
sleep 0.4

CURL_HTML="$(curl -sL "http://127.0.0.1:${PORT}/")"
if [[ -z "$CURL_HTML" ]]; then
  fail "curl -sL returns HTML"
else
  pass "curl -sL returns HTML"
fi

echo "$CURL_HTML" | grep -q "Total OPEX" && echo "$CURL_HTML" | grep -q "MoM change" && echo "$CURL_HTML" | grep -q "Category mix" && echo "$CURL_HTML" | grep -q "OPEX-to-revenue" \
  && pass "curl -sL first paint includes Total OPEX / MoM / category mix / OPEX-to-revenue" \
  || fail "curl -sL first paint includes Total OPEX / MoM / category mix / OPEX-to-revenue"

CURL_ROWS="$(printf '%s\n' "$CURL_HTML" | grep -c 'data-month="' || true)"
if [[ "$CURL_ROWS" -eq 18 ]]; then
  pass "curl -sL first paint includes 18 month rows"
else
  fail "curl -sL first paint includes 18 month rows (found ${CURL_ROWS})"
fi

if [[ -f "$ROOT/.nojekyll" ]]; then
  pass ".nojekyll present for GitHub Pages"
else
  fail ".nojekyll present for GitHub Pages"
fi

echo "Summary: ${PASS} passed, ${FAIL} failed"
if [[ "$FAIL" -ne 0 ]]; then
  exit 1
fi
exit 0
