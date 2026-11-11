# Premier Reports Center — existing-source implementation map

Date: 2026-11-11. PR #158. This is a source-first audit and implementation inventory, not a claim that every report requested in the supplied design brief is present.

## Actual application entry
- `src/app/routes.tsx` routes both `APP_ROUTES.reports` and `APP_ROUTES.financialReports` into **`ReportsCenterPage`**, with ProtectedRoute permissions.
- `src/features/reporting/pages/ReportsCenterPage.tsx` selects only permitted operational report definitions from `REPORT_REGISTRY`, filtered again by `businessReportAllowed(runtime,...)`; financial routes require `reports.financial` and `businessFinancialViewAllowed`.
- `src/features/reporting/pages/ReportsPage.tsx` provides the **existing live operational report loaders** and their filters, summary, partial-data failure guard, Excel/CSV print and saved report configs.
- `src/features/accounting/pages/FinancialReportsPage.tsx` implements the existing accounting reports and account/finance access model. No accounting logic was duplicated in the center.

## Source truth: report → existing loader → filters → permission
| Available report | Existing source | Filters | Permissions |
| --- | --- | --- | --- |
| Sales, payment channel, sales by employee/product, detailed invoices | `ReportsPage` + `reportCoreLoaders` / `reportSalesLoaders` / `numericIntegrity` | existing `reportFilters` + branch scope/date | `reports.view` |
| Purchases, expenses | `ReportsPage` + `reportCoreLoaders` | supplier/buyer/warehouse/status or payment/category, as supported | `reports.view` |
| Gross/net profitability report | existing `ReportsPage` `profit` workflow + underlying `costing` / reporting RPCs | supported period/branch | `reports.view` AND `reports.costing` |
| Stock, low-stock, waste, consumption and components | `ReportsPage` + `reportInventoryLoaders` + existing costing logic | warehouse/product/category as supported | `reports.view`, and `reports.costing` for sensitive rows |
| Cashier/shift performance | `ReportsPage` + `reportSalesLoaders` | cashier and period/branch | `reports.view` |
| Daily closing and finance reconciliation | existing `ReportsPage` + `reporting` RPCs | period/branch | `reports.view` AND `reports.financial` |
| Trial balance, ledger, income, balance sheet, cash flow, aging/party statements | `FinancialReportsPage` + current finance service/RPCs | current report-supported filters | `reports.financial`, plus module restrictions |

Every report is further subject to organization module visibility, branch scope and history visibility. Export/print retain `reports.export` / `reports.print` checks.

## UI changes actually implemented
- Existing `/reports` view reorganized into **Premier Reports Center** with RTL Arabic-first styling, responsive sidebar/mobile directory, category filtering/search, existing browser-local favorite storage key, report descriptions and permission-scoped financial links.
- Existing branch-selection state reused via `useBranchScope` and filtered `organizationBranches`.
- Existing operational report detail filters/tables/summary/column-picker/csv/xlsx/print/saved-config remain in place and are not re-created.
- Graph added to four existing reports using their **already loaded `chartData`**, with an explicit label that these are existing returned groups/records and not independently computed totals. The center does not introduce new queries or tables.

## Iteration 2 — authorized report table interactions

- Operational report detail tables now support **search within the already authorized rows, natural-column sorting and 10/25/50/100-row visual pages**, on mobile and desktop. The presentation helper `reportTablePresentation.ts` does not issue a network request or recompute financial data.
- Existing CSV/XLSX and print use the **same search/sort results** rather than only the currently visible page. When a local search is active, XLSX omits the original report-wide financial total row to avoid presenting a mathematically incompatible filtered subtotal. The authoritative report-wide total remains visible in the existing report filter/summary area with an explicit scope disclaimer.
- Unit tests cover negative transactions, Arabic search, natural invoice sorting, missing values, page bounds, and preservation of input rows.
- **Caution:** This is **presentation pagination** of records already loaded by existing report services, not a claim of backend/server paging. Some legacy loaders still call `fetchAllReportRows` to exhaust their authorized result range in batches. Converting those to server-backed page/count endpoints must not be attempted without retaining report-wide financial correctness and export completeness.

## Iteration 3 — exact-source invoice drilldown

- For **sales, detailed invoices and returns** loaded through the existing authorized report services, the report row now carries its actual `sales.id` in non-enumerable, symbol-backed **navigation-only metadata**. The source ID cannot accidentally appear in visible report columns, CSV/XLSX, JSON, print or saved column selections.
- When a user has `sales.view`, the invoice value becomes a link to `/sales?saleId=<uuid>`; there are no guessed invoice-name joins, no arbitrary new financial queries and no links on grouped cost/profit rows that have no single source invoice.
- The existing SalesPage resolves that exact ID with the **same sale detail projection**, the authenticated Supabase connection, `branch_id IN current authorized branchScope.selectedBranchIds`, `is_archived=false`, and the `sales.view` gate. Missing, invalid, inaccessible or out-of-scope invoice URLs all show the **same unavailable message**, without revealing if a foreign-branch ID exists. Changing branch scope or permission clears any previously displayed detail.
- This source navigation provides a supported invoice detail entry, not a guarantee that every report row (e.g. aggregated profitability, inventory consumption, finance reconciliation) has a corresponding source record link. Do not infer transaction IDs from displayed invoice numbers.

## Iteration 4 — authoritative income statement KPIs

- Added a small executive **income statement** panel at the top of the existing reports center for users with `reports.financial` and an organization whose `income` view is enabled. It loads **only on explicit user request** for an ISO date range, respecting the user's currently selected authorized branch IDs and historical range rules.
- The KPI panel calls the exact existing `reporting.getIncomeStatement` RPC that `FinancialReportsPage` already relies upon for each branch. It uses `requireFinancialReport` and verifies all seven returned accounting fields (`revenue`, `discount`, `net_revenue`, `cogs`, `gross_profit`, `expenses`, `net_income`) are finite numbers. **Any missing/failed branch hides the whole panel**, never reporting incomplete cross-branch totals as a successful result.
- Shows net revenue, COGS, gross profit, expenses and net income, with explicit fixed-date scope. Net margin is shown only when net revenue is positive. No independent sale-level revenue/cost calculations or duplicate financial service.
- To prevent invalid consolidated reporting, the panel **rejects mixed or unknown currencies** across chosen branches; no inferred FX conversion. Data is discarded when branch scope, permissions or dates change, and async responses from a superseded request cannot overwrite the newer display.
- Each panel displays a link to the corresponding existing income statement report (same date filters), so financial detail remains the authoritative source rather than an invented chart. This is an **income-based financial overview**, not a full performance dashboard across sales/returns/stock valuation, and has no new accounting definitions or recurring reporting job.
- Unit tests cover negative values, malformed and incomplete branch reports, missing data, invalid numbers, and source/permission guards.

## Not yet implemented / intentionally not misrepresented
- A unified multi-report executive KPI panel (net profit, inventory valuation, COGS, net sales, returns and comparisons) **requires auditing exact source definitions and completeness before showing numeric cards**. It has not been asserted as available. Existing report totals appear where authoritative source already supports them.
- Full advanced report-builder with SQL-free custom aggregations, arbitrary column widths, all cross-module deep links, automated email schedules, all specialized restaurant/HR/production reports, unusual trend detection, and AI analysis **not implemented**. Existing saved custom report preferences are retained.
- Financial transaction links and per-report navigation remain as provided by the original report modules; this PR does not claim that every requested detail drill-down is available.
- Some legacy component/recipe reports remain intentionally hidden by the existing gate due to previous source-integrity concerns.
- No new report engine, no independent COGS/profit calculation, no database changes, and no production data change.

## Acceptance / rollout
Run lint/typecheck/build/unit tests, disposable-Postgres integration and browser smoke at the exact PR head. Review operational vs reporting numbers for representative multi-branch sales, returns and split-tender invoices. The PR is **draft** until these checks are proven and a separate deployment decision is made.
