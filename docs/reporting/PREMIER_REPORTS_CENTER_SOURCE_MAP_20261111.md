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

## Not yet implemented / intentionally not misrepresented
- A unified multi-report executive KPI panel (net profit, inventory valuation, COGS, net sales, returns and comparisons) **requires auditing exact source definitions and completeness before showing numeric cards**. It has not been asserted as available. Existing report totals appear where authoritative source already supports them.
- Full advanced report-builder with SQL-free custom aggregations, arbitrary column widths, all cross-module deep links, automated email schedules, all specialized restaurant/HR/production reports, unusual trend detection, and AI analysis **not implemented**. Existing saved custom report preferences are retained.
- Financial transaction links and per-report navigation remain as provided by the original report modules; this PR does not claim that every requested detail drill-down is available.
- Some legacy component/recipe reports remain intentionally hidden by the existing gate due to previous source-integrity concerns.
- No new report engine, no independent COGS/profit calculation, no database changes, and no production data change.

## Acceptance / rollout
Run lint/typecheck/build/unit tests, disposable-Postgres integration and browser smoke at the exact PR head. Review operational vs reporting numbers for representative multi-branch sales, returns and split-tender invoices. The PR is **draft** until these checks are proven and a separate deployment decision is made.
