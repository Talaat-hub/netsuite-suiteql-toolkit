# NetSuite SuiteQL Toolkit

A generic, safety-guarded SuiteQL query engine for NetSuite — exposed as both a RESTlet API and a browser-based SQL dashboard Suitelet — plus an applied example that runs SuiteQL directly against a custom Employee record. Built as a self-study project to go deep on NetSuite's `N/query` module and SQL-2011 support inside SuiteScript.

## What's in here

| Script | Type | Purpose |
|---|---|---|
| `SuiteQL_Dashboard/rl_mt_suiteql_api.js` | RESTlet | Executes validated, read-only SuiteQL and returns JSON |
| `SuiteQL_Dashboard/sl_mt_suiteql_dash.js` | Suitelet | Browser UI for running ad-hoc queries and pre-approved templates |
| `SuiteQL_Dashboard/suiteql_config.js` | Config module | Shared validation rules, query limits, and a library of pre-approved query templates — imported by both the RESTlet and the Suitelet so the rules never drift out of sync |
| `EMP_Analytics/suitelet/sl_mt_emp_suiteql.js` | Suitelet | "Employee Explorer" — an applied example demonstrating `N/query` with filtering, aggregation, and joins against `customrecord_emp_mahmoud` |

### How the query engine stays safe

This isn't a raw SQL passthrough. `suiteql_config.js` enforces, on every request:

- Only `SELECT` / `WITH` (CTE) statements are accepted as the first keyword.
- A blocklist rejects `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `DROP`, `TRUNCATE`, `ALTER`, `CREATE`, `GRANT`, `REVOKE`, and stacked (`;`-separated) statements — even inside subqueries.
- Query length, page size, and result-row caps are enforced server-side.
- An optional role allow-list can restrict who can run ad-hoc queries at all.
- A curated set of pre-approved templates (employee counts by job title/city, duplicate-email detection, recent invoices, top customers, sales orders with resolved names via `BUILTIN.DF`, sales order line joins) ship out of the box as safe starting points.

## Testing

Every script has a matching Jest suite in `__tests__/`, run against a local mock layer (`__mocks__/`) standing in for `N/query`, `N/record`, `N/ui/serverWidget`, `N/runtime`, `N/log`, and the rest of the NetSuite SuiteScript API — no live NetSuite account required.

```bash
npm install
npm test              # runs the full suite with coverage
```

CI runs the same suite on every push via [`.github/workflows/test.yml`](.github/workflows/test.yml).

## Documentation

[`docs/SUITEQL_REFERENCE.md`](docs/SUITEQL_REFERENCE.md) is a 20-section SuiteQL reference guide covering SuiteQL vs. Saved Search tradeoffs, SQL-2011 syntax rules in NetSuite, `N/query` integration patterns, schema discovery, record-to-table mappings, joins/subrecords, aggregation, date functions, custom fields, debugging via the SuiteQL Workbench, and performance best practices — written up while building this toolkit.

## Project structure

```
src/
├── manifest.xml                          # SDF project manifest
├── deploy.xml                            # SDF deployment config
├── Objects/                              # Script/deployment record definitions (XML)
└── FileCabinet/SuiteScripts/
    ├── SuiteQL_Dashboard/
    │   ├── rl_mt_suiteql_api.js
    │   ├── sl_mt_suiteql_dash.js
    │   └── suiteql_config.js
    └── EMP_Analytics/suitelet/sl_mt_emp_suiteql.js
docs/
├── SUITEQL_REFERENCE.md
└── suiteql_export_SO.csv
__mocks__/                                  # Jest mocks for NetSuite N/* modules
__tests__/                                  # Jest test suites (one per script)
```

## Deploying to a NetSuite account

This is an SDF (SuiteCloud Development Framework) `ACCOUNTCUSTOMIZATION` project. With the [SuiteCloud CLI](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_157017623577.html) authenticated against your own account:

```bash
suitecloud project:deploy
```

The Employee Explorer suitelet references a custom record (`customrecord_emp_mahmoud`) that must already exist in the target account.

## Tech stack

SuiteScript 2.1 · N/query (SuiteQL) · N/ui/serverWidget · N/record · N/runtime · Jest 29

## Related project

`netsuite-restlets-suitelets` — the Employee CRUD RESTlet/Suitelet platform that owns the custom record queried here.

## Author

[Mahmoud Talaat](https://www.linkedin.com/in/mahmoudtalaat21/) — NetSuite / SuiteScript developer.

## License

MIT — see [LICENSE](LICENSE).
