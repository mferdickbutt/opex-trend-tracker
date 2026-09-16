# OPEX Trend Tracker

Public operating-expense ledger: category mix, month-over-month change, OPEX-to-revenue, and target comparisons. **First paint is fully baked HTML** — a static `curl -sL` of `index.html` already contains every required metric and all 18 month rows. No JavaScript, and no `Loading…` shell.

## Data

[`data/opex.json`](data/opex.json) is the source of truth: 18 months (April 2025–September 2026) of OPEX by category (`payroll`, `software`, `facilities`, `marketing`, `other`), monthly revenue, and comparison targets.

## Formulas

All math lives in [`js/opex.js`](js/opex.js). Invalid, missing, or undefined results are **`null`**, never `NaN` or `Infinity`.

**Total OPEX** for month \(t\):

\[
T_t = \sum_c e_{t,c}
\]

Null or missing categories are skipped. If every category is missing, \(T_t\) is `null`. Explicit zeros are a valid total of `0`.

**MoM change**:

\[
\Delta_t = \frac{T_t - T_{t-1}}{T_{t-1}}
\]

`null` when \(T_t\) is null, \(T_{t-1}\) is null, or \(T_{t-1} = 0\).

**Category mix** (share of total):

\[
m_{t,c} = \frac{e_{t,c}}{T_t}
\]

Every share is `null` when \(T_t\) is null or `0`. A single-category month with \(T_t > 0\) is `1` for that category and `0` for the others.

**OPEX-to-revenue**:

\[
r_t = \frac{T_t}{R_t}
\]

`null` when \(T_t\) is null, \(R_t\) is null, or \(R_t = 0\). Zero expense on positive revenue is `0`.

**Target comparisons** for an actual \(A\) and goal \(G\):

\[
d = A - G, \qquad d\% = \frac{A - G}{G}
\]

`null` when \(A\) or \(G\) is null, or \(G = 0\). The UI treats OPEX and the OPEX-to-revenue ratio as “lower is better”: over target is a warning.

## How to re-render

```bash
node scripts/render-static.js
```

That reads `data/opex.json`, runs `js/opex.js`, and overwrites `index.html` with baked summary cards, category mix, spark bars, and the monthly table. Progressive enhancement in `js/app.js` (sortable columns, row select) is optional and must not replace first paint.

```bash
bash scripts/test.sh
```

Expect `Summary: N passed, 0 failed` and exit code 0. Checks cover zero expense, empty series, null inputs, single-category months, and static HTML first paint (including `curl -sL`).

## Suggested next improvements

- Replace the sample series with a live export (finance system or spreadsheet) and keep the same JSON shape.
- Add trailing-twelve-month totals and a rolling OPEX-to-revenue band, still baked at render time.
- Split targets by month instead of a single monthly goal, so seasonality (marketing, facilities) is compared fairly.
- Publish to GitHub Pages as-is (`.nojekyll` is already in the repo).
