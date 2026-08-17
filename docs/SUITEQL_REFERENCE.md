# SuiteQL — Comprehensive Reference Guide

> **Audience:** Experienced SuiteScript / NetSuite developers  
> **SuiteScript Version:** 2.1  
> **Last Updated:** April 19, 2026

---

## Table of Contents

1. [SuiteQL vs Saved Searches — Decision Matrix](#1-suiteql-vs-saved-searches--decision-matrix)
2. [SQL-2011 Syntax Rules in NetSuite](#2-sql-2011-syntax-rules-in-netsuite)
3. [Key Limitations & Gotchas](#3-key-limitations--gotchas)
4. [N/query Module — SuiteScript Integration](#4-nquery-module--suitescript-integration)
5. [Schema Discovery — OA_TABLES & OA_COLUMNS](#5-schema-discovery--oa_tables--oa_columns)
6. [NetSuite Record-to-Table Mapping](#6-netsuite-record-to-table-mapping)
7. [Transaction Queries](#7-transaction-queries)
8. [Customer & Vendor Queries](#8-customer--vendor-queries)
9. [Employee Queries](#9-employee-queries)
10. [Item Queries](#10-item-queries)
11. [Custom Record Queries](#11-custom-record-queries)
12. [Joins & Subrecords](#12-joins--subrecords)
13. [Aggregation Patterns](#13-aggregation-patterns)
14. [Date Functions & Filtering](#14-date-functions--filtering)
15. [Custom Fields](#15-custom-fields)
16. [Advanced Patterns](#16-advanced-patterns)
17. [Debugging & the SuiteQL Workbench](#17-debugging--the-suiteql-workbench)
18. [Performance & Best Practices](#18-performance--best-practices)
19. [Error Handling in SuiteScript](#19-error-handling-in-suitescript)
20. [Quick Reference Cheat Sheet](#20-quick-reference-cheat-sheet)

---

## 1. SuiteQL vs Saved Searches — Decision Matrix

| Criteria | SuiteQL | Saved Search |
|----------|---------|-------------|
| **Syntax** | Standard SQL-2011 | NetSuite proprietary API |
| **JOINs** | Explicit SQL JOINs across any related tables | Limited to predefined join paths |
| **Aggregation** | Full `GROUP BY`, `HAVING`, subqueries | Limited summary types |
| **UNION** | Supported (`UNION ALL`) | Not available |
| **Subqueries** | Supported (correlated and non-correlated) | Not available |
| **CASE/WHEN** | Full support | Formula fields only |
| **Performance** | Runs directly against analytics tables; often faster for complex queries | Optimized for UI rendering; slower for complex aggregations |
| **Governance** | 10 units per `runSuiteQL()` call | 10 units per `search.create().run()` |
| **Max results (single call)** | 5,000 rows | 4,000 rows (paged) |
| **UI exposure** | No built-in UI (code only, or via Workbench) | Can be saved, shared, scheduled, used in portlets |
| **Formulas** | SQL functions (`BUILTIN.DF`, `NVL`, `TO_CHAR`, etc.) | NetSuite formula syntax `{field}` |
| **Custom segments** | Full support via column names | Supported via joins |
| **Record type discovery** | Query `OA_TABLES` / `OA_COLUMNS` | Limited to API reference |

### When to Use SuiteQL

- Complex multi-table JOINs not available via saved search join paths
- Aggregation with `GROUP BY` / `HAVING` across related records
- `UNION ALL` to merge result sets from different record types
- Subqueries (e.g., "customers whose last order was over 90 days ago")
- Bulk data extraction for integrations / reporting
- Schema discovery when working with unfamiliar record types

### When to Use Saved Search

- Results need to be displayed in the NetSuite UI (portlets, sublists, KPIs)
- Business users need to edit/maintain the search without code
- Scheduling (saved search can be emailed on a schedule natively)
- You need joined fields from a well-known path (e.g., `customer.companyname` from a transaction)
- The query is simple enough that SQL adds no benefit

---

## 2. SQL-2011 Syntax Rules in NetSuite

### Supported SQL Features

```sql
-- Standard clauses
SELECT, FROM, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT, OFFSET

-- Joins
INNER JOIN, LEFT OUTER JOIN, RIGHT OUTER JOIN, CROSS JOIN

-- Set operations
UNION ALL          -- UNION (deduplicated) is NOT supported; use UNION ALL

-- Subqueries
WHERE field IN (SELECT ...)
WHERE EXISTS (SELECT ...)
SELECT (SELECT ... ) AS alias    -- scalar subquery in SELECT

-- Expressions
CASE WHEN ... THEN ... ELSE ... END
COALESCE(a, b, c)
NVL(field, default)
NULLIF(a, b)

-- Literals
'string', 123, 123.45, NULL
TO_DATE('2026-01-01', 'YYYY-MM-DD')
```

### NOT Supported

```sql
SELECT *                    -- Must enumerate columns explicitly
UNION                       -- Only UNION ALL is supported
CREATE / INSERT / UPDATE / DELETE  -- Read-only; no DDL/DML
WITH (CTE)                  -- Common Table Expressions not supported
FULL OUTER JOIN             -- Not supported
DISTINCT ON                 -- Not supported (DISTINCT in SELECT is fine)
LIMIT without ORDER BY      -- Technically works but order is non-deterministic
LIKE with unicode escapes   -- Standard LIKE only
```

### Identifier Rules

- **Table names** are lowercase internal record IDs: `transaction`, `customer`, `employee`, `item`, `customrecord_myrecord`
- **Column names** are lowercase internal field IDs: `id`, `email`, `companyname`, `custbody_myfield`
- **Aliases** follow standard SQL: `AS alias_name` (case-insensitive)
- **Reserved words** as aliases must be double-quoted: `"date"`, `"name"`, `"type"`
- **No backticks** — use double quotes for identifiers: `"transaction"."id"`

### String Rules

- Single quotes for string literals: `'Active'`
- Escape single quote by doubling: `'O''Brien'`
- String comparison is case-sensitive by default — use `UPPER()` or `LOWER()` for case-insensitive matching

---

## 3. Key Limitations & Gotchas

### 3.1 No `SELECT *`

Every query must enumerate columns. This is the single most common error:

```sql
-- ❌ FAILS
SELECT * FROM customer

-- ✅ Works
SELECT id, companyname, email FROM customer
```

### 3.2 Result Set Maximum: 5,000 Rows

A single `runSuiteQL()` call returns at most **5,000 rows**. For larger result sets, use paging (see Section 4).

### 3.3 `BUILTIN.DF()` — Display Field Function

Many NetSuite fields store internal IDs (integers) for list/record references. To get the display text:

```sql
-- Returns internal ID (integer)
SELECT status FROM transaction WHERE id = 123
-- Result: 'B'

-- Returns display text
SELECT BUILTIN.DF(status) AS status_text FROM transaction WHERE id = 123
-- Result: 'Pending Fulfillment'
```

`BUILTIN.DF()` works on:
- List/record fields (status, subsidiary, department, class, location)
- Entity fields (customer, vendor, employee references)
- Currency fields (currency ID → currency name)
- Custom list fields (`custbody_mylist`)

**Cost:** `BUILTIN.DF()` adds overhead — avoid on large result sets if you can resolve the lookup in code.

### 3.4 NULL Handling

NetSuite follows SQL NULL semantics, but with quirks:

```sql
-- Empty strings are stored as NULL in many fields
-- This catches both:
WHERE email IS NULL

-- This will NOT match NULL values:
WHERE email = ''           -- ❌ Does not match NULLs

-- Use NVL for safe defaults:
SELECT NVL(email, 'N/A') AS email FROM customer

-- NULL in comparisons:
WHERE amount > 100         -- Rows where amount IS NULL are excluded
```

### 3.5 Date Gotchas

- Dates are stored as timestamps internally
- `TO_DATE()` truncates time: `TO_DATE('2026-01-01', 'YYYY-MM-DD')`
- Date comparisons should use `>=` and `<` rather than `BETWEEN` to avoid time boundary issues
- The format mask is Oracle-style: `YYYY-MM-DD`, `DD/MM/YYYY`, `MM/DD/YYYY`

### 3.6 Boolean Fields

Boolean (checkbox) fields store `'T'` or `'F'` as strings, not `true/false` or `1/0`:

```sql
WHERE isinactive = 'F'
WHERE mainline = 'T'
```

### 3.7 Transaction Type Filtering

The `transaction` table holds ALL transaction types. Always filter by `type`:

```sql
-- ❌ Scanning everything — extremely slow
SELECT id, tranid FROM transaction WHERE entity = 123

-- ✅ Filter by type first
SELECT id, tranid FROM transaction WHERE type = 'SalesOrd' AND entity = 123
```

Common type codes: `SalesOrd`, `CustInvc`, `CustPymt`, `PurchOrd`, `VendBill`, `VendPymt`, `CashSale`, `ItemShip`, `Journal`, `Check`, `Deposit`, `Transfer`, `InvAdjst`, `Build`, `Estimate`, `Opprtnty`, `RtnAuth`, `CustCred`, `VendCred`

### 3.8 `mainline` — Transaction Header vs Lines

```sql
-- Header only (no line-level data)
SELECT id, tranid, entity, total FROM transaction WHERE mainline = 'T'

-- Lines only (each row is one line item)
SELECT id, tranid, item, quantity, rate FROM transactionLine WHERE mainline = 'F'
```

### 3.9 Governance

| Operation | Units |
|-----------|-------|
| `query.runSuiteQL()` | 10 |
| `query.runSuiteQLPaged()` | 10 |
| `PagedData.fetch()` (each page) | 5 |

---

## 4. N/query Module — SuiteScript Integration

### 4.1 Basic Execution: `runSuiteQL()`

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 */
define(['N/query'], (query) => {

    const onRequest = (context) => {
        try {
            const results = query.runSuiteQL({
                query: `
                    SELECT id, companyname, email
                    FROM customer
                    WHERE isinactive = 'F'
                    ORDER BY companyname ASC
                    FETCH FIRST 100 ROWS ONLY
                `,
            });

            // results is a query.ResultSet object
            const rows = results.asMappedResults();
            // rows = [{ id: 1, companyname: 'Acme', email: 'a@acme.com' }, ...]

            log.debug('Customer count', rows.length);

            // Access individual columns by name (lowercase)
            rows.forEach((row) => {
                log.debug('Customer', row.companyname + ' — ' + row.email);
            });

        } catch (e) {
            log.error('SuiteQL Error', e.message);
        }
    };

    return { onRequest };
});
```

### 4.2 asMappedResults() vs Column Index Access

```javascript
// Option A: asMappedResults() — returns array of objects
const rows = results.asMappedResults();
// rows[0].companyname

// Option B: Direct column index access via results.results
const rawRows = results.results;
// rawRows[0].values — array of values in column order
// rawRows[0].values[0] = id
// rawRows[0].values[1] = companyname

// Option C: Column metadata
const columns = results.columns;
// columns[0].label = 'id'
// columns[0].type = 'INTEGER'
// columns[1].label = 'companyname'
// columns[1].type = 'VARCHAR'
```

**Recommendation:** Use `asMappedResults()` for readability. Use raw `results` only when you need column metadata or type info.

### 4.3 Parameterized Queries (SQL Injection Prevention)

**Critical for security.** Never concatenate user input into SQL strings:

```javascript
// ❌ VULNERABLE — SQL injection
const sql = `SELECT id FROM customer WHERE companyname = '${userInput}'`;

// ✅ SAFE — parameterized
const results = query.runSuiteQL({
    query: `SELECT id, companyname FROM customer WHERE companyname = ?`,
    params: [userInput],
});

// Multiple parameters — positional binding
const results = query.runSuiteQL({
    query: `
        SELECT id, tranid, total
        FROM transaction
        WHERE type = ? AND entity = ? AND total > ?
    `,
    params: ['SalesOrd', customerId, minimumAmount],
});
```

Parameters are bound positionally (`?`). Each `?` maps to the corresponding index in the `params` array.

**Supported parameter types:** String, Number, Boolean, null. Date parameters should be passed as strings in `YYYY-MM-DD` format and compared with `TO_DATE()`.

### 4.4 Paged Execution: `runSuiteQLPaged()`

For result sets exceeding 5,000 rows:

```javascript
/**
 * Fetch all active customers using paged execution.
 * Each page costs 5 governance units to fetch.
 */
const fetchAllCustomers = () => {
    const allRows = [];

    const pagedData = query.runSuiteQLPaged({
        query: `
            SELECT id, companyname, email, phone
            FROM customer
            WHERE isinactive = 'F'
            ORDER BY id
        `,
        pageSize: 1000,  // Min: 5, Max: 1000, Default: 50
    });

    // pagedData.count = total number of results
    log.debug('Total customers', pagedData.count);

    // Iterate pages
    pagedData.pageRanges.forEach((pageRange) => {
        const page = pagedData.fetch(pageRange.index);  // 5 units per fetch
        const rows = page.data.asMappedResults();
        allRows.push(...rows);
    });

    return allRows;
};
```

### 4.5 Efficient Paging with Iterator Pattern

```javascript
/**
 * Process large result sets without holding everything in memory.
 * Uses a callback per page to process and discard.
 */
const processLargeResultSet = (sql, params, callback) => {
    const pagedData = query.runSuiteQLPaged({
        query: sql,
        params: params,
        pageSize: 1000,
    });

    let processedCount = 0;

    for (const pageRange of pagedData.pageRanges) {
        const page = pagedData.fetch(pageRange.index);
        const rows = page.data.asMappedResults();

        callback(rows, processedCount);
        processedCount += rows.length;
    }

    return processedCount;
};

// Usage:
processLargeResultSet(
    `SELECT id, tranid, total FROM transaction WHERE type = ? ORDER BY id`,
    ['SalesOrd'],
    (rows, offset) => {
        rows.forEach((row) => {
            // Process each row — update a record, write to file, etc.
            log.debug('Processing SO', row.tranid);
        });
    }
);
```

### 4.6 FETCH FIRST / OFFSET (SQL-level Paging)

```sql
-- First 50 rows
SELECT id, companyname FROM customer
ORDER BY companyname
FETCH FIRST 50 ROWS ONLY

-- Skip 50, take next 50 (page 2)
SELECT id, companyname FROM customer
ORDER BY companyname
OFFSET 50 ROWS FETCH NEXT 50 ROWS ONLY
```

> **Warning:** `OFFSET` without `ORDER BY` returns non-deterministic results. Always pair with `ORDER BY` on a stable column (usually `id`).

---

## 5. Schema Discovery — OA_TABLES & OA_COLUMNS

### 5.1 Find All Available Tables

```sql
SELECT tablename, description
FROM OA_TABLES
ORDER BY tablename
```

```javascript
const tables = query.runSuiteQL({
    query: `SELECT tablename, description FROM OA_TABLES ORDER BY tablename`,
}).asMappedResults();

tables.forEach((t) => log.debug(t.tablename, t.description));
```

### 5.2 Find Tables by Name Pattern

```sql
-- Find all transaction-related tables
SELECT tablename, description
FROM OA_TABLES
WHERE LOWER(tablename) LIKE '%transaction%'
ORDER BY tablename
```

Common results:
- `transaction` — Transaction header
- `transactionline` — Transaction lines
- `transactionaccountingline` — GL impact lines
- `transactionstatus` — Transaction status history
- `previousTransactionLink` — Linked transactions (e.g., SO → Invoice)

### 5.3 Find Columns for a Table

```sql
SELECT columnname, datatype, description
FROM OA_COLUMNS
WHERE tablename = 'transaction'
ORDER BY columnname
```

```javascript
// Discovery function — reusable for any table
const discoverColumns = (tableName) => {
    return query.runSuiteQL({
        query: `
            SELECT columnname, datatype, description
            FROM OA_COLUMNS
            WHERE LOWER(tablename) = ?
            ORDER BY columnname
        `,
        params: [tableName.toLowerCase()],
    }).asMappedResults();
};

const cols = discoverColumns('customer');
cols.forEach((c) => log.debug(c.columnname, c.datatype + ' — ' + c.description));
```

### 5.4 Find Custom Fields on a Table

```sql
-- Custom body fields on transactions
SELECT columnname, datatype, description
FROM OA_COLUMNS
WHERE tablename = 'transaction'
  AND columnname LIKE 'custbody%'
ORDER BY columnname

-- Custom entity fields on customers
SELECT columnname, datatype, description
FROM OA_COLUMNS
WHERE tablename = 'customer'
  AND columnname LIKE 'custentity%'
ORDER BY columnname
```

### 5.5 Find a Custom Record Table

```sql
-- Custom records appear as tables with 'customrecord_' prefix
SELECT tablename, description
FROM OA_TABLES
WHERE tablename LIKE 'customrecord_%'
ORDER BY tablename
```

### 5.6 Full Schema Dump for a Record Type

```javascript
/**
 * Get complete schema for a record type — useful for debugging.
 * Returns { tableName, columns: [{ name, type, description }] }
 */
const getSchema = (tableName) => {
    try {
        const columns = query.runSuiteQL({
            query: `
                SELECT columnname, datatype, description
                FROM OA_COLUMNS
                WHERE LOWER(tablename) = ?
                ORDER BY columnname
            `,
            params: [tableName.toLowerCase()],
        }).asMappedResults();

        return {
            tableName,
            columnCount: columns.length,
            columns: columns.map((c) => ({
                name: c.columnname,
                type: c.datatype,
                desc: c.description || '',
            })),
        };
    } catch (e) {
        log.error('Schema discovery failed', e.message);
        return null;
    }
};
```

---

## 6. NetSuite Record-to-Table Mapping

### Core Entity Tables

| Record Type | SuiteQL Table | Key Columns |
|------------|---------------|-------------|
| Customer | `customer` | `id`, `companyname`, `entityid`, `email`, `phone`, `subsidiary`, `isinactive`, `datecreated` |
| Vendor | `vendor` | `id`, `companyname`, `entityid`, `email`, `phone`, `subsidiary`, `isinactive` |
| Employee | `employee` | `id`, `firstname`, `lastname`, `email`, `supervisor`, `department`, `subsidiary`, `isinactive`, `hiredate` |
| Partner | `partner` | `id`, `companyname`, `entityid`, `email` |
| Contact | `contact` | `id`, `firstname`, `lastname`, `email`, `company`, `phone` |
| Entity (union) | `entity` | `id`, `entityid`, `type` — parent table of all entity types |

### Transaction Tables

| Record Type | SuiteQL Table | Key Columns |
|------------|---------------|-------------|
| All transactions (header) | `transaction` | `id`, `tranid`, `type`, `entity`, `trandate`, `total`, `status`, `mainline`, `subsidiary` |
| Transaction lines | `transactionline` | `transaction`, `id` (line ID), `item`, `quantity`, `rate`, `amount`, `class`, `department`, `location` |
| GL lines | `transactionaccountingline` | `transaction`, `account`, `debit`, `credit`, `amount` |
| Linked transactions | `previoustransactionlink` | `previousdoc`, `nextdoc`, `type`, `linktype` |

### Item Tables

| Record Type | SuiteQL Table | Key Columns |
|------------|---------------|-------------|
| All items | `item` | `id`, `itemid`, `displayname`, `itemtype`, `baseprice`, `isinactive`, `subsidiary` |
| Item subtypes | `inventoryitem`, `noninventoryitem`, `serviceitem`, `kititem`, `assemblyitem`, `discountitem`, `paymentitem`, `markupitem` |
| Pricing | `pricing` | `item`, `pricelevel`, `unitprice`, `quantity`, `currency` |
| Item location | `inventoryitemlocations` | `item`, `location`, `quantityonhand`, `quantityavailable`, `quantityonorder` |

### Other Core Tables

| Record Type | SuiteQL Table |
|------------|---------------|
| Subsidiary | `subsidiary` |
| Department | `department` |
| Classification | `classification` |
| Location | `location` |
| Account | `account` |
| Currency | `currency` |
| Custom List Values | `customlist_*` |
| Custom Records | `customrecord_*` |
| File | `file` |
| Folder | `mediaitemfolder` |
| Note | `note` |
| Message | `message` |

---

## 7. Transaction Queries

### 7.1 Sales Orders — Header

```sql
SELECT
    t.id,
    t.tranid AS so_number,
    t.trandate,
    BUILTIN.DF(t.entity) AS customer_name,
    BUILTIN.DF(t.status) AS status,
    t.total,
    BUILTIN.DF(t.subsidiary) AS subsidiary
FROM transaction t
WHERE t.type = 'SalesOrd'
  AND t.mainline = 'T'
  AND t.trandate >= TO_DATE('2026-01-01', 'YYYY-MM-DD')
ORDER BY t.trandate DESC
FETCH FIRST 100 ROWS ONLY
```

```javascript
const getRecentSalesOrders = () => {
    return query.runSuiteQL({
        query: `
            SELECT
                t.id,
                t.tranid AS so_number,
                t.trandate,
                BUILTIN.DF(t.entity) AS customer_name,
                BUILTIN.DF(t.status) AS status,
                t.total,
                BUILTIN.DF(t.subsidiary) AS subsidiary
            FROM transaction t
            WHERE t.type = 'SalesOrd'
              AND t.mainline = 'T'
              AND t.trandate >= TO_DATE(?, 'YYYY-MM-DD')
            ORDER BY t.trandate DESC
            FETCH FIRST 100 ROWS ONLY
        `,
        params: ['2026-01-01'],
    }).asMappedResults();
};
```

### 7.2 Sales Order Lines with Item Details

```sql
SELECT
    t.tranid AS so_number,
    tl.linesequencenumber AS line_num,
    BUILTIN.DF(tl.item) AS item_name,
    tl.quantity,
    tl.rate,
    tl.netamount,
    BUILTIN.DF(tl.class) AS class_name,
    BUILTIN.DF(tl.department) AS department
FROM transaction t
INNER JOIN transactionline tl ON t.id = tl.transaction
WHERE t.type = 'SalesOrd'
  AND t.id = 12345
  AND tl.mainline = 'F'
  AND tl.item IS NOT NULL
ORDER BY tl.linesequencenumber
```

### 7.3 Open Invoices (Aged)

```sql
SELECT
    t.id,
    t.tranid AS invoice_number,
    t.trandate,
    t.duedate,
    BUILTIN.DF(t.entity) AS customer,
    t.total,
    t.amountremaining,
    ROUND(SYSDATE - t.duedate) AS days_overdue
FROM transaction t
WHERE t.type = 'CustInvc'
  AND t.mainline = 'T'
  AND t.status = 'CustInvc:A'              -- Open status
  AND t.amountremaining > 0
ORDER BY days_overdue DESC
```

### 7.4 Purchase Orders Pending Receipt

```sql
SELECT
    t.id,
    t.tranid AS po_number,
    BUILTIN.DF(t.entity) AS vendor,
    t.trandate,
    t.total,
    BUILTIN.DF(t.status) AS status
FROM transaction t
WHERE t.type = 'PurchOrd'
  AND t.mainline = 'T'
  AND t.status IN ('PurchOrd:B', 'PurchOrd:D', 'PurchOrd:E')  -- Pending Receipt / Partially Received
ORDER BY t.trandate ASC
```

### 7.5 GL Impact — Transaction Accounting Lines

```sql
SELECT
    t.tranid,
    t.trandate,
    BUILTIN.DF(tal.account) AS account_name,
    tal.debit,
    tal.credit,
    tal.amount,
    BUILTIN.DF(tal.subsidiary) AS subsidiary
FROM transactionaccountingline tal
INNER JOIN transaction t ON tal.transaction = t.id
WHERE t.type = 'Journal'
  AND t.trandate >= TO_DATE('2026-01-01', 'YYYY-MM-DD')
ORDER BY t.trandate, tal.account
```

### 7.6 Linked Transactions (SO → Invoice → Payment)

```sql
-- Find invoices created from a specific sales order
SELECT
    so.tranid AS so_number,
    inv.tranid AS invoice_number,
    inv.trandate AS invoice_date,
    inv.total AS invoice_total,
    BUILTIN.DF(inv.status) AS invoice_status
FROM transaction so
INNER JOIN previoustransactionlink ptl ON so.id = ptl.previousdoc
INNER JOIN transaction inv ON ptl.nextdoc = inv.id
WHERE so.type = 'SalesOrd'
  AND inv.type = 'CustInvc'
  AND so.id = 12345
```

---

## 8. Customer & Vendor Queries

### 8.1 Active Customers with Contact Info

```sql
SELECT
    c.id,
    c.entityid AS customer_id,
    c.companyname,
    c.email,
    c.phone,
    BUILTIN.DF(c.subsidiary) AS subsidiary,
    BUILTIN.DF(c.category) AS category,
    c.datecreated,
    c.lastmodifieddate
FROM customer c
WHERE c.isinactive = 'F'
ORDER BY c.companyname
```

### 8.2 Customer with Billing Address

```sql
SELECT
    c.id,
    c.companyname,
    ca.addr1,
    ca.addr2,
    ca.city,
    ca.state,
    ca.zip,
    BUILTIN.DF(ca.country) AS country
FROM customer c
LEFT OUTER JOIN customerAddressbook cab
    ON c.id = cab.entity AND cab.defaultbilling = 'T'
LEFT OUTER JOIN customerAddressbookEntityAddress ca
    ON cab.addressbookaddress = ca.nkey
WHERE c.isinactive = 'F'
ORDER BY c.companyname
FETCH FIRST 50 ROWS ONLY
```

> **Note:** Address joins are notoriously complex in NetSuite. The path is: `customer` → `customerAddressbook` → `customerAddressbookEntityAddress`. The `nkey` column links the address subrecord.

### 8.3 Customer Revenue Summary (Last 12 Months)

```sql
SELECT
    c.id,
    c.companyname,
    COUNT(t.id) AS invoice_count,
    SUM(t.total) AS total_revenue,
    MAX(t.trandate) AS last_invoice_date
FROM customer c
INNER JOIN transaction t ON c.id = t.entity
WHERE t.type = 'CustInvc'
  AND t.mainline = 'T'
  AND t.trandate >= ADD_MONTHS(SYSDATE, -12)
  AND c.isinactive = 'F'
GROUP BY c.id, c.companyname
HAVING SUM(t.total) > 0
ORDER BY total_revenue DESC
FETCH FIRST 50 ROWS ONLY
```

### 8.4 Vendors with Open Bills

```sql
SELECT
    v.id,
    v.companyname,
    COUNT(t.id) AS open_bill_count,
    SUM(t.amountremaining) AS total_outstanding
FROM vendor v
INNER JOIN transaction t ON v.id = t.entity
WHERE t.type = 'VendBill'
  AND t.mainline = 'T'
  AND t.amountremaining > 0
  AND v.isinactive = 'F'
GROUP BY v.id, v.companyname
ORDER BY total_outstanding DESC
```

### 8.5 Customers Without Orders (Churn Detection)

```sql
SELECT c.id, c.companyname, c.email, c.datecreated
FROM customer c
WHERE c.isinactive = 'F'
  AND c.id NOT IN (
      SELECT DISTINCT t.entity
      FROM transaction t
      WHERE t.type = 'SalesOrd'
        AND t.mainline = 'T'
        AND t.trandate >= ADD_MONTHS(SYSDATE, -6)
  )
ORDER BY c.datecreated DESC
```

---

## 9. Employee Queries

### 9.1 Active Employees with Department

```sql
SELECT
    e.id,
    e.entityid,
    e.firstname,
    e.lastname,
    e.email,
    BUILTIN.DF(e.department) AS department,
    BUILTIN.DF(e.subsidiary) AS subsidiary,
    BUILTIN.DF(e.supervisor) AS supervisor,
    e.hiredate,
    BUILTIN.DF(e.title) AS job_title
FROM employee e
WHERE e.isinactive = 'F'
ORDER BY e.lastname, e.firstname
```

### 9.2 Employee Headcount by Department

```sql
SELECT
    BUILTIN.DF(e.department) AS department,
    COUNT(*) AS headcount
FROM employee e
WHERE e.isinactive = 'F'
GROUP BY BUILTIN.DF(e.department)
ORDER BY headcount DESC
```

### 9.3 Employee Direct Reports

```sql
SELECT
    mgr.firstname || ' ' || mgr.lastname AS manager,
    e.firstname || ' ' || e.lastname AS direct_report,
    BUILTIN.DF(e.department) AS department,
    e.email
FROM employee e
INNER JOIN employee mgr ON e.supervisor = mgr.id
WHERE e.isinactive = 'F'
  AND mgr.id = ?
ORDER BY e.lastname
```

### 9.4 Custom Record — Employee (Mahmoud) Example

```sql
-- Querying the custom record used in this project
SELECT
    id,
    name,
    custrecord_emp_mahmoud_email AS email,
    custrecord_emp_mahmoud_phone AS phone,
    custrecord_emp_mahmoud_jobtitle AS job_title,
    custrecord_emp_mahmoud_address AS address,
    custrecord_emp_mahmoud_status AS status
FROM customrecord_emp_mahmoud
WHERE name IS NOT NULL
ORDER BY name ASC
```

```javascript
// SuiteScript implementation
const getEmployeeRecords = () => {
    return query.runSuiteQL({
        query: `
            SELECT id, name,
                custrecord_emp_mahmoud_email AS email,
                custrecord_emp_mahmoud_phone AS phone,
                custrecord_emp_mahmoud_jobtitle AS job_title,
                custrecord_emp_mahmoud_address AS address
            FROM customrecord_emp_mahmoud
            ORDER BY name
        `,
    }).asMappedResults();
};
```

---

## 10. Item Queries

### 10.1 All Active Items

```sql
SELECT
    i.id,
    i.itemid AS item_name,
    i.displayname,
    i.itemtype,
    BUILTIN.DF(i.itemtype) AS item_type_name,
    i.baseprice,
    BUILTIN.DF(i.subsidiary) AS subsidiary
FROM item i
WHERE i.isinactive = 'F'
ORDER BY i.itemid
```

### 10.2 Inventory Items with Stock Levels

```sql
SELECT
    i.id,
    i.itemid AS sku,
    i.displayname,
    il.quantityonhand,
    il.quantityavailable,
    il.quantityonorder,
    BUILTIN.DF(il.location) AS location_name
FROM item i
INNER JOIN inventoryitemlocations il ON i.id = il.item
WHERE i.isinactive = 'F'
  AND i.itemtype = 'InvtPart'
  AND il.quantityonhand > 0
ORDER BY i.itemid, location_name
```

### 10.3 Low Stock Alert

```sql
SELECT
    i.id,
    i.itemid AS sku,
    i.displayname,
    il.quantityavailable,
    il.reorderpoint,
    BUILTIN.DF(il.location) AS location_name
FROM item i
INNER JOIN inventoryitemlocations il ON i.id = il.item
WHERE i.isinactive = 'F'
  AND i.itemtype = 'InvtPart'
  AND il.reorderpoint IS NOT NULL
  AND il.quantityavailable < il.reorderpoint
ORDER BY (il.reorderpoint - il.quantityavailable) DESC
```

### 10.4 Top Selling Items (by Revenue)

```sql
SELECT
    BUILTIN.DF(tl.item) AS item_name,
    SUM(tl.quantity) AS total_qty,
    SUM(tl.netamount) AS total_revenue,
    COUNT(DISTINCT tl.transaction) AS order_count
FROM transactionline tl
INNER JOIN transaction t ON tl.transaction = t.id
WHERE t.type = 'SalesOrd'
  AND t.mainline = 'F'
  AND tl.mainline = 'F'
  AND tl.item IS NOT NULL
  AND t.trandate >= ADD_MONTHS(SYSDATE, -12)
GROUP BY BUILTIN.DF(tl.item)
ORDER BY total_revenue DESC
FETCH FIRST 20 ROWS ONLY
```

### 10.5 Item Pricing Across Price Levels

```sql
SELECT
    i.itemid,
    i.displayname,
    BUILTIN.DF(p.pricelevel) AS price_level,
    BUILTIN.DF(p.currency) AS currency,
    p.unitprice
FROM item i
INNER JOIN pricing p ON i.id = p.item
WHERE i.id = ?
ORDER BY p.pricelevel, p.currency
```

---

## 11. Custom Record Queries

### 11.1 Basic Custom Record Query

```sql
-- Table name = 'customrecord_' + script ID suffix
SELECT id, name, created, lastmodified
FROM customrecord_myrecord
WHERE isinactive = 'F'
ORDER BY name
```

### 11.2 Custom Record with Custom Fields

```sql
SELECT
    id,
    name,
    custrecord_myfield_text AS text_field,
    custrecord_myfield_number AS number_field,
    BUILTIN.DF(custrecord_myfield_list) AS list_value,
    custrecord_myfield_date AS date_field,
    custrecord_myfield_checkbox AS is_checked
FROM customrecord_myrecord
WHERE custrecord_myfield_checkbox = 'T'
ORDER BY custrecord_myfield_date DESC
```

### 11.3 Custom Record Joined to Transaction

```sql
-- Example: Custom record linked to a transaction via a field
SELECT
    cr.id AS record_id,
    cr.name AS record_name,
    t.tranid AS transaction_number,
    t.total
FROM customrecord_myrecord cr
INNER JOIN transaction t ON cr.custrecord_myfield_transaction = t.id
WHERE t.type = 'SalesOrd'
ORDER BY t.trandate DESC
```

### 11.4 Custom List Values

```sql
-- Custom lists are also accessible as tables
SELECT id, name, isinactive
FROM customlist_mystatus
WHERE isinactive = 'F'
ORDER BY name
```

### 11.5 Discovering Custom Record Fields

```javascript
// Discover all fields on a custom record
const discoverCustomRecord = (recordId) => {
    const schema = query.runSuiteQL({
        query: `
            SELECT columnname, datatype, description
            FROM OA_COLUMNS
            WHERE tablename = ?
            ORDER BY columnname
        `,
        params: [recordId],
    }).asMappedResults();

    log.debug('Schema for ' + recordId, JSON.stringify(schema));
    return schema;
};

// Usage:
discoverCustomRecord('customrecord_emp_mahmoud');
```

---

## 12. Joins & Subrecords

### 12.1 JOIN Types and When to Use Them

```sql
-- INNER JOIN: Only rows that match in both tables
-- Use when: You need data from both tables and want to exclude non-matches
SELECT t.tranid, BUILTIN.DF(t.entity) AS customer
FROM transaction t
INNER JOIN customer c ON t.entity = c.id
WHERE t.type = 'SalesOrd' AND c.isinactive = 'F'

-- LEFT OUTER JOIN: All rows from left, matching rows from right (NULLs for non-matches)
-- Use when: You want all records from the left table even if no match exists
SELECT c.companyname, t.tranid, t.total
FROM customer c
LEFT OUTER JOIN transaction t ON c.id = t.entity AND t.type = 'SalesOrd'
WHERE c.isinactive = 'F'

-- RIGHT OUTER JOIN: Inverse of LEFT — rarely used, prefer LEFT for readability
```

### 12.2 Multi-Table Joins

```sql
-- Sales Order → Customer → Subsidiary → Item lines
SELECT
    t.tranid AS so_number,
    c.companyname AS customer,
    BUILTIN.DF(c.subsidiary) AS subsidiary,
    tl.linesequencenumber AS line,
    BUILTIN.DF(tl.item) AS item,
    tl.quantity,
    tl.rate,
    tl.netamount
FROM transaction t
INNER JOIN customer c ON t.entity = c.id
INNER JOIN transactionline tl ON t.id = tl.transaction
WHERE t.type = 'SalesOrd'
  AND t.mainline = 'T'
  AND tl.mainline = 'F'
  AND tl.item IS NOT NULL
  AND t.trandate >= TO_DATE('2026-01-01', 'YYYY-MM-DD')
ORDER BY t.tranid, tl.linesequencenumber
```

### 12.3 Self-Joins

```sql
-- Employee hierarchy: employee → supervisor → supervisor's supervisor
SELECT
    e.firstname || ' ' || e.lastname AS employee,
    s1.firstname || ' ' || s1.lastname AS supervisor,
    s2.firstname || ' ' || s2.lastname AS grand_supervisor
FROM employee e
LEFT OUTER JOIN employee s1 ON e.supervisor = s1.id
LEFT OUTER JOIN employee s2 ON s1.supervisor = s2.id
WHERE e.isinactive = 'F'
ORDER BY grand_supervisor, supervisor, employee
```

### 12.4 Transaction Header + Line + Item Subrecord

```sql
SELECT
    t.tranid,
    tl.linesequencenumber,
    i.itemid AS sku,
    i.displayname,
    BUILTIN.DF(i.itemtype) AS item_type,
    tl.quantity,
    tl.rate,
    tl.netamount,
    BUILTIN.DF(tl.location) AS fulfill_location
FROM transaction t
INNER JOIN transactionline tl ON t.id = tl.transaction
INNER JOIN item i ON tl.item = i.id
WHERE t.type = 'SalesOrd'
  AND tl.mainline = 'F'
  AND t.id = ?
ORDER BY tl.linesequencenumber
```

### 12.5 Address Subrecord Joins

Address joins are the most complex in SuiteQL. Each entity type has its own address path:

```sql
-- Customer billing address
SELECT c.companyname, ea.addr1, ea.city, ea.state, ea.zip
FROM customer c
LEFT OUTER JOIN customerAddressbook cab
    ON c.id = cab.entity AND cab.defaultbilling = 'T'
LEFT OUTER JOIN customerAddressbookEntityAddress ea
    ON cab.addressbookaddress = ea.nkey
WHERE c.isinactive = 'F'

-- Vendor address (same pattern, different table names)
SELECT v.companyname, ea.addr1, ea.city, ea.state, ea.zip
FROM vendor v
LEFT OUTER JOIN vendorAddressbook vab
    ON v.id = vab.entity AND vab.defaultbilling = 'T'
LEFT OUTER JOIN vendorAddressbookEntityAddress ea
    ON vab.addressbookaddress = ea.nkey
WHERE v.isinactive = 'F'
```

---

## 13. Aggregation Patterns

### 13.1 GROUP BY Basics

```sql
-- Revenue by customer
SELECT
    BUILTIN.DF(t.entity) AS customer,
    COUNT(t.id) AS order_count,
    SUM(t.total) AS total_revenue,
    AVG(t.total) AS avg_order_value,
    MIN(t.trandate) AS first_order,
    MAX(t.trandate) AS last_order
FROM transaction t
WHERE t.type = 'SalesOrd'
  AND t.mainline = 'T'
  AND t.trandate >= TO_DATE('2025-01-01', 'YYYY-MM-DD')
GROUP BY BUILTIN.DF(t.entity)
ORDER BY total_revenue DESC
```

### 13.2 HAVING — Filter After Aggregation

```sql
-- Customers with more than $100K in orders
SELECT
    BUILTIN.DF(t.entity) AS customer,
    SUM(t.total) AS total_spent
FROM transaction t
WHERE t.type = 'SalesOrd'
  AND t.mainline = 'T'
GROUP BY BUILTIN.DF(t.entity)
HAVING SUM(t.total) > 100000
ORDER BY total_spent DESC
```

### 13.3 Multi-Level GROUP BY

```sql
-- Revenue by subsidiary, then department
SELECT
    BUILTIN.DF(t.subsidiary) AS subsidiary,
    BUILTIN.DF(tl.department) AS department,
    COUNT(DISTINCT t.id) AS order_count,
    SUM(tl.netamount) AS revenue
FROM transaction t
INNER JOIN transactionline tl ON t.id = tl.transaction
WHERE t.type = 'SalesOrd'
  AND tl.mainline = 'F'
  AND tl.item IS NOT NULL
GROUP BY BUILTIN.DF(t.subsidiary), BUILTIN.DF(tl.department)
ORDER BY subsidiary, revenue DESC
```

### 13.4 COUNT(DISTINCT ...)

```sql
-- Number of unique customers who ordered each item
SELECT
    BUILTIN.DF(tl.item) AS item_name,
    COUNT(DISTINCT t.entity) AS unique_customers,
    SUM(tl.quantity) AS total_qty_sold
FROM transactionline tl
INNER JOIN transaction t ON tl.transaction = t.id
WHERE t.type = 'SalesOrd'
  AND tl.mainline = 'F'
  AND tl.item IS NOT NULL
GROUP BY BUILTIN.DF(tl.item)
HAVING COUNT(DISTINCT t.entity) >= 5
ORDER BY unique_customers DESC
```

### 13.5 CASE in Aggregation (Pivot Pattern)

```sql
-- Monthly revenue pivot for current year
SELECT
    BUILTIN.DF(t.entity) AS customer,
    SUM(CASE WHEN EXTRACT(MONTH FROM t.trandate) = 1 THEN t.total ELSE 0 END) AS jan,
    SUM(CASE WHEN EXTRACT(MONTH FROM t.trandate) = 2 THEN t.total ELSE 0 END) AS feb,
    SUM(CASE WHEN EXTRACT(MONTH FROM t.trandate) = 3 THEN t.total ELSE 0 END) AS mar,
    SUM(CASE WHEN EXTRACT(MONTH FROM t.trandate) = 4 THEN t.total ELSE 0 END) AS apr,
    SUM(t.total) AS total
FROM transaction t
WHERE t.type = 'CustInvc'
  AND t.mainline = 'T'
  AND EXTRACT(YEAR FROM t.trandate) = EXTRACT(YEAR FROM SYSDATE)
GROUP BY BUILTIN.DF(t.entity)
ORDER BY total DESC
```

---

## 14. Date Functions & Filtering

### 14.1 Core Date Functions

```sql
-- Current date/time
SYSDATE                                         -- 2026-04-19 14:30:00

-- Extract components
EXTRACT(YEAR FROM t.trandate)                   -- 2026
EXTRACT(MONTH FROM t.trandate)                  -- 4
EXTRACT(DAY FROM t.trandate)                    -- 19

-- Date arithmetic
SYSDATE - 30                                    -- 30 days ago
ADD_MONTHS(SYSDATE, -12)                        -- 12 months ago
ADD_MONTHS(SYSDATE, 3)                          -- 3 months from now

-- Date construction
TO_DATE('2026-01-01', 'YYYY-MM-DD')
TO_DATE('01/15/2026', 'MM/DD/YYYY')

-- Format date to string
TO_CHAR(t.trandate, 'YYYY-MM-DD')              -- '2026-04-19'
TO_CHAR(t.trandate, 'Mon DD, YYYY')            -- 'Apr 19, 2026'
TO_CHAR(t.trandate, 'Day')                     -- 'Saturday'

-- Truncate to start of period
TRUNC(SYSDATE)                                  -- Start of today (midnight)
TRUNC(SYSDATE, 'MM')                           -- First day of current month
TRUNC(SYSDATE, 'YYYY')                         -- First day of current year
TRUNC(SYSDATE, 'Q')                            -- First day of current quarter

-- Days between dates
ROUND(t.duedate - SYSDATE)                     -- Days until due
ROUND(SYSDATE - t.trandate)                    -- Days since transaction
```

### 14.2 Date Range Filtering Patterns

```sql
-- Today
WHERE TRUNC(t.trandate) = TRUNC(SYSDATE)

-- This month
WHERE t.trandate >= TRUNC(SYSDATE, 'MM')
  AND t.trandate < ADD_MONTHS(TRUNC(SYSDATE, 'MM'), 1)

-- Last 30 days
WHERE t.trandate >= SYSDATE - 30

-- Last 12 months
WHERE t.trandate >= ADD_MONTHS(SYSDATE, -12)

-- This quarter
WHERE t.trandate >= TRUNC(SYSDATE, 'Q')
  AND t.trandate < ADD_MONTHS(TRUNC(SYSDATE, 'Q'), 3)

-- Specific year
WHERE EXTRACT(YEAR FROM t.trandate) = 2026

-- Date range (parameterized)
WHERE t.trandate >= TO_DATE(?, 'YYYY-MM-DD')
  AND t.trandate < TO_DATE(?, 'YYYY-MM-DD')
-- params: ['2026-01-01', '2026-04-01']
```

### 14.3 Date Grouping for Reports

```sql
-- Monthly summary
SELECT
    TO_CHAR(t.trandate, 'YYYY-MM') AS month,
    COUNT(t.id) AS order_count,
    SUM(t.total) AS revenue
FROM transaction t
WHERE t.type = 'SalesOrd' AND t.mainline = 'T'
GROUP BY TO_CHAR(t.trandate, 'YYYY-MM')
ORDER BY month DESC

-- Quarterly summary
SELECT
    EXTRACT(YEAR FROM t.trandate) AS yr,
    TO_CHAR(t.trandate, 'Q') AS quarter,
    SUM(t.total) AS revenue
FROM transaction t
WHERE t.type = 'CustInvc' AND t.mainline = 'T'
GROUP BY EXTRACT(YEAR FROM t.trandate), TO_CHAR(t.trandate, 'Q')
ORDER BY yr DESC, quarter DESC

-- Day of week analysis
SELECT
    TO_CHAR(t.trandate, 'Day') AS day_name,
    COUNT(t.id) AS order_count,
    SUM(t.total) AS revenue
FROM transaction t
WHERE t.type = 'SalesOrd' AND t.mainline = 'T'
GROUP BY TO_CHAR(t.trandate, 'Day'), TO_CHAR(t.trandate, 'D')
ORDER BY TO_CHAR(t.trandate, 'D')
```

---

## 15. Custom Fields

### 15.1 Custom Field Naming Conventions

| Prefix | Applied To | Example |
|--------|-----------|---------|
| `custbody_` | Transaction body (header) | `custbody_approval_notes` |
| `custcol_` | Transaction line (column) | `custcol_delivery_date` |
| `custentity_` | Entity (customer, vendor, employee) | `custentity_industry` |
| `custitem_` | Item | `custitem_weight_kg` |
| `custrecord_` | Custom record field | `custrecord_myfield_status` |
| `custevent_` | Event (CRM events) | `custevent_follow_up` |
| `custrecord_` on custom record | Field on the custom record itself | `custrecord_emp_mahmoud_email` |

### 15.2 Custom Body Fields (Transaction Header)

```sql
-- Custom fields on a sales order
SELECT
    t.id,
    t.tranid,
    t.custbody_approval_notes AS approval_notes,
    BUILTIN.DF(t.custbody_project) AS project_name,
    t.custbody_external_ref AS external_ref
FROM transaction t
WHERE t.type = 'SalesOrd'
  AND t.mainline = 'T'
  AND t.custbody_external_ref IS NOT NULL
```

### 15.3 Custom Column Fields (Transaction Lines)

```sql
-- Custom fields on transaction lines
SELECT
    t.tranid,
    tl.linesequencenumber,
    BUILTIN.DF(tl.item) AS item,
    tl.quantity,
    tl.custcol_delivery_date AS delivery_date,
    tl.custcol_serial_number AS serial_no
FROM transaction t
INNER JOIN transactionline tl ON t.id = tl.transaction
WHERE t.type = 'SalesOrd'
  AND tl.mainline = 'F'
  AND tl.custcol_delivery_date IS NOT NULL
```

### 15.4 Custom Entity Fields

```sql
-- Custom fields on customers
SELECT
    c.id,
    c.companyname,
    c.custentity_industry AS industry,
    BUILTIN.DF(c.custentity_account_manager) AS account_manager,
    c.custentity_credit_limit AS credit_limit,
    c.custentity_notes AS notes
FROM customer c
WHERE c.isinactive = 'F'
  AND c.custentity_credit_limit > 50000
```

### 15.5 Custom List Field Resolution

```sql
-- If custentity_region is a custom list field:
-- Use BUILTIN.DF() to get the display value
SELECT
    c.companyname,
    c.custentity_region AS region_id,                      -- Returns internal ID (integer)
    BUILTIN.DF(c.custentity_region) AS region_name         -- Returns display text
FROM customer c
WHERE c.custentity_region IS NOT NULL

-- To filter by display value, join the custom list table:
SELECT c.companyname
FROM customer c
INNER JOIN customlist_regions r ON c.custentity_region = r.id
WHERE r.name = 'Middle East'
```

---

## 16. Advanced Patterns

### 16.1 UNION ALL — Combining Result Sets

```sql
-- Combine customers and vendors into one entity list
SELECT id, companyname AS name, email, 'Customer' AS entity_type
FROM customer
WHERE isinactive = 'F'

UNION ALL

SELECT id, companyname AS name, email, 'Vendor' AS entity_type
FROM vendor
WHERE isinactive = 'F'

ORDER BY name
```

> **Reminder:** Only `UNION ALL` is supported. If you need deduplication, wrap in a subquery or handle in code.

### 16.2 Subqueries — IN / NOT IN

```sql
-- Customers who purchased a specific item
SELECT c.id, c.companyname
FROM customer c
WHERE c.id IN (
    SELECT DISTINCT t.entity
    FROM transaction t
    INNER JOIN transactionline tl ON t.id = tl.transaction
    WHERE t.type = 'SalesOrd'
      AND tl.item = 1234
)
ORDER BY c.companyname
```

### 16.3 Subqueries — EXISTS

```sql
-- Items that have never been sold
SELECT i.id, i.itemid, i.displayname
FROM item i
WHERE i.isinactive = 'F'
  AND i.itemtype = 'InvtPart'
  AND NOT EXISTS (
      SELECT 1
      FROM transactionline tl
      INNER JOIN transaction t ON tl.transaction = t.id
      WHERE tl.item = i.id
        AND t.type IN ('SalesOrd', 'CustInvc', 'CashSale')
  )
ORDER BY i.itemid
```

### 16.4 Scalar Subqueries in SELECT

```sql
-- Customer with their most recent order date
SELECT
    c.id,
    c.companyname,
    (
        SELECT MAX(t.trandate)
        FROM transaction t
        WHERE t.entity = c.id
          AND t.type = 'SalesOrd'
          AND t.mainline = 'T'
    ) AS last_order_date
FROM customer c
WHERE c.isinactive = 'F'
ORDER BY c.companyname
```

### 16.5 CASE Statements

```sql
-- Categorize customers by spending tier
SELECT
    BUILTIN.DF(t.entity) AS customer,
    SUM(t.total) AS total_spent,
    CASE
        WHEN SUM(t.total) >= 100000 THEN 'Platinum'
        WHEN SUM(t.total) >= 50000 THEN 'Gold'
        WHEN SUM(t.total) >= 10000 THEN 'Silver'
        ELSE 'Bronze'
    END AS tier
FROM transaction t
WHERE t.type = 'CustInvc' AND t.mainline = 'T'
GROUP BY BUILTIN.DF(t.entity)
ORDER BY total_spent DESC
```

### 16.6 NVL / COALESCE / NULLIF

```sql
-- NVL: Replace NULL with a default
SELECT id, NVL(email, 'no-email@unknown.com') AS email FROM customer

-- COALESCE: First non-NULL value from a list
SELECT id, COALESCE(phone, altphone, fax, 'No contact') AS contact_number FROM customer

-- NULLIF: Returns NULL if two values are equal (useful for avoiding division by zero)
SELECT id, total / NULLIF(quantity, 0) AS unit_price FROM transactionline
```

### 16.7 String Functions

```sql
-- Concatenation
SELECT firstname || ' ' || lastname AS full_name FROM employee

-- Length
SELECT companyname, LENGTH(companyname) AS name_length FROM customer

-- Substring
SELECT SUBSTR(tranid, 1, 3) AS prefix FROM transaction

-- Upper/Lower
SELECT UPPER(email) AS email_upper FROM customer

-- Trim
SELECT TRIM(companyname) AS clean_name FROM customer

-- Replace
SELECT REPLACE(phone, '-', '') AS clean_phone FROM customer

-- Position (INSTR)
SELECT INSTR(email, '@') AS at_position FROM customer
```

### 16.8 Numeric Functions

```sql
ROUND(amount, 2)           -- Round to 2 decimal places
CEIL(amount)               -- Round up to nearest integer
FLOOR(amount)              -- Round down to nearest integer
ABS(amount)                -- Absolute value
MOD(id, 10)                -- Modulo (remainder)
POWER(2, 10)               -- Exponentiation (1024)
GREATEST(a, b, c)          -- Maximum of multiple values
LEAST(a, b, c)             -- Minimum of multiple values
```

### 16.9 Conditional Aggregation (Crosstab Reports)

```sql
-- Order count by status for each customer
SELECT
    BUILTIN.DF(t.entity) AS customer,
    COUNT(CASE WHEN t.status = 'SalesOrd:A' THEN 1 END) AS pending_approval,
    COUNT(CASE WHEN t.status = 'SalesOrd:B' THEN 1 END) AS pending_fulfillment,
    COUNT(CASE WHEN t.status = 'SalesOrd:C' THEN 1 END) AS partially_fulfilled,
    COUNT(CASE WHEN t.status = 'SalesOrd:G' THEN 1 END) AS billed,
    COUNT(*) AS total_orders
FROM transaction t
WHERE t.type = 'SalesOrd' AND t.mainline = 'T'
GROUP BY BUILTIN.DF(t.entity)
ORDER BY total_orders DESC
```

### 16.10 Running a Dynamic Query Builder

```javascript
/**
 * Build a SuiteQL query dynamically based on user filters.
 * Uses parameterized queries to prevent SQL injection.
 */
const buildEmployeeQuery = (filters) => {
    try {
        let sql = `
            SELECT id, name,
                custrecord_emp_mahmoud_email AS email,
                custrecord_emp_mahmoud_jobtitle AS job_title,
                custrecord_emp_mahmoud_address AS address
            FROM customrecord_emp_mahmoud
            WHERE 1=1
        `;
        const params = [];

        if (filters.name) {
            sql += ` AND LOWER(name) LIKE ?`;
            params.push('%' + filters.name.toLowerCase() + '%');
        }

        if (filters.jobTitle) {
            sql += ` AND custrecord_emp_mahmoud_jobtitle = ?`;
            params.push(filters.jobTitle);
        }

        if (filters.address) {
            sql += ` AND LOWER(custrecord_emp_mahmoud_address) LIKE ?`;
            params.push('%' + filters.address.toLowerCase() + '%');
        }

        sql += ` ORDER BY name FETCH FIRST 200 ROWS ONLY`;

        return query.runSuiteQL({ query: sql, params }).asMappedResults();
    } catch (e) {
        log.error('buildEmployeeQuery', e.message);
        return [];
    }
};
```

---

## 17. Debugging & the SuiteQL Workbench

### 17.1 SuiteQL Workbench (In-App)

NetSuite provides a built-in SuiteQL query tool:

**Navigation:** Customization > Scripting > SuiteQL Query Tool (or search "SuiteQL" in the global search)

**Features:**
- Execute arbitrary SuiteQL queries
- View results in a table
- See column types
- Test queries before embedding in code

> **Tip:** Not all accounts have this enabled. If unavailable, use the SuiteQL REST API endpoint or a Suitelet debugging page.

### 17.2 REST API — SuiteQL Endpoint

```
POST https://{accountId}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql
Content-Type: application/json
Prefer: transient

{
    "q": "SELECT id, companyname FROM customer FETCH FIRST 10 ROWS ONLY"
}
```

Authentication: OAuth 1.0 (TBA) or OAuth 2.0.

**Useful for:**
- Testing queries from Postman before writing SuiteScript
- CI/CD query validation
- External reporting tools

### 17.3 Debugging Suitelet

Build a simple Suitelet that exposes a SuiteQL workbench for quick testing:

```javascript
/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Simple SuiteQL debugger Suitelet — run queries from the browser.
 */
define(['N/query', 'N/ui/serverWidget', 'N/log'], (query, serverWidget, log) => {

    const onRequest = (context) => {
        if (context.request.method === 'GET') {
            const form = serverWidget.createForm({ title: 'SuiteQL Workbench' });

            form.addField({
                id: 'custpage_sql',
                type: serverWidget.FieldType.LONGTEXT,
                label: 'SuiteQL Query',
            }).defaultValue = context.request.parameters.sql || '';

            form.addSubmitButton({ label: 'Execute' });

            if (context.request.parameters.sql) {
                try {
                    const results = query.runSuiteQL({
                        query: context.request.parameters.sql,
                    });
                    const rows = results.asMappedResults();

                    const resultField = form.addField({
                        id: 'custpage_results',
                        type: serverWidget.FieldType.INLINEHTML,
                        label: 'Results',
                    });

                    let html = '<p><b>' + rows.length + ' rows returned</b></p>';
                    if (rows.length > 0) {
                        const cols = Object.keys(rows[0]);
                        html += '<table border="1" cellpadding="4"><tr>';
                        cols.forEach((c) => { html += '<th>' + c + '</th>'; });
                        html += '</tr>';
                        rows.forEach((r) => {
                            html += '<tr>';
                            cols.forEach((c) => { html += '<td>' + (r[c] ?? '') + '</td>'; });
                            html += '</tr>';
                        });
                        html += '</table>';
                    }
                    resultField.defaultValue = html;
                } catch (e) {
                    form.addField({
                        id: 'custpage_error',
                        type: serverWidget.FieldType.INLINEHTML,
                        label: 'Error',
                    }).defaultValue = '<p style="color:red"><b>Error:</b> ' + e.message + '</p>';
                }
            }

            context.response.writePage(form);
        } else {
            // POST — redirect back with SQL in URL
            const sql = context.request.parameters.custpage_sql;
            const scriptUrl = '/app/site/hosting/scriptlet.nl?script=SCRIPTID&deploy=DEPLOYID';
            context.response.sendRedirect({
                type: 'SUITELET',
                identifier: 'customscript_suiteql_workbench',
                id: 'customdeploy_suiteql_workbench',
                parameters: { sql: sql },
            });
        }
    };

    return { onRequest };
});
```

### 17.4 Log-Based Debugging

```javascript
// Log the raw SQL for inspection
const sql = `SELECT id, name FROM customer WHERE id = ?`;
const params = [123];
log.debug('Executing SuiteQL', { sql, params });

try {
    const results = query.runSuiteQL({ query: sql, params });
    const rows = results.asMappedResults();
    log.debug('Results', JSON.stringify(rows).substring(0, 3999));  // Log limit: 3999 chars
    log.debug('Row count', rows.length);
    log.debug('Columns', JSON.stringify(results.columns.map(c => c.label)));
} catch (e) {
    log.error('SuiteQL Error', {
        message: e.message,
        name: e.name,
        sql: sql,
        params: JSON.stringify(params),
    });
}
```

---

## 18. Performance & Best Practices

### 18.1 Indexing Awareness

NetSuite indexes these columns on most tables:
- `id` (primary key)
- `type` (transaction types)
- `entity` (customer/vendor on transactions)
- `subsidiary`
- `isinactive`
- `trandate` (transactions)
- `item` (transaction lines)
- `mainline`

**Best practice:** Always filter on indexed columns first, then add additional predicates.

```sql
-- ✅ Good: Filter on type and mainline first (indexed)
WHERE t.type = 'SalesOrd' AND t.mainline = 'T' AND t.custbody_myfield = 'value'

-- ❌ Bad: Custom field filter without type narrowing
WHERE t.custbody_myfield = 'value'
```

### 18.2 Avoid Full-Table Scans

```sql
-- ❌ Scans entire transaction table
SELECT id, tranid FROM transaction WHERE custbody_myfield LIKE '%keyword%'

-- ✅ Narrow by type and date first, then filter
SELECT id, tranid FROM transaction
WHERE type = 'SalesOrd'
  AND mainline = 'T'
  AND trandate >= ADD_MONTHS(SYSDATE, -6)
  AND custbody_myfield LIKE '%keyword%'
```

### 18.3 Limit Results

Always use `FETCH FIRST n ROWS ONLY` or `OFFSET` paging in production code. Never return unbounded result sets:

```sql
-- ✅ Always limit
SELECT id, companyname FROM customer
ORDER BY datecreated DESC
FETCH FIRST 100 ROWS ONLY

-- For paging:
ORDER BY id
OFFSET 200 ROWS FETCH NEXT 100 ROWS ONLY
```

### 18.4 BUILTIN.DF() Performance

`BUILTIN.DF()` performs a lookup for each row. On large result sets, this is expensive:

```sql
-- ❌ Slow on 10,000+ rows
SELECT id, BUILTIN.DF(entity) AS customer FROM transaction WHERE type = 'SalesOrd'

-- ✅ Better: JOIN explicitly, or resolve in code
SELECT t.id, c.companyname
FROM transaction t
INNER JOIN customer c ON t.entity = c.id
WHERE t.type = 'SalesOrd'
```

### 18.5 Governance Budget Planning

| Script Type | Max Units | SuiteQL Calls at 10 units each |
|-------------|-----------|-------------------------------|
| Client Script | 1,000 | 100 |
| User Event | 1,000 | 100 |
| Suitelet | 1,000 | 100 |
| Restlet | 5,000 | 500 |
| Scheduled Script | 10,000 | 1,000 |
| Map/Reduce | 10,000 per phase | 1,000 per phase |

### 18.6 Caching Frequently Queried Data

```javascript
/**
 * Cache SuiteQL results in N/cache for frequently accessed lookups.
 */
define(['N/query', 'N/cache', 'N/log'], (query, cache, log) => {

    const CACHE_NAME = 'SUITEQL_LOOKUP';
    const CACHE_TTL = 300;  // 5 minutes

    const myCache = cache.getCache({ name: CACHE_NAME, scope: cache.Scope.PUBLIC });

    const getActiveCustomers = () => {
        return JSON.parse(myCache.get({
            key: 'active_customers',
            ttl: CACHE_TTL,
            loader: () => {
                const rows = query.runSuiteQL({
                    query: `SELECT id, companyname FROM customer WHERE isinactive = 'F' ORDER BY companyname`,
                }).asMappedResults();
                return JSON.stringify(rows);
            },
        }));
    };
});
```

### 18.7 SELECT Only What You Need

```sql
-- ❌ Fetching unnecessary columns
SELECT id, companyname, email, phone, fax, altphone, url, category,
       subsidiary, territory, salesrep, datecreated, lastmodifieddate,
       custentity_field1, custentity_field2, custentity_field3
FROM customer

-- ✅ Only what the code actually uses
SELECT id, companyname, email FROM customer
```

---

## 19. Error Handling in SuiteScript

### 19.1 Common SuiteQL Errors

| Error | Cause | Solution |
|-------|-------|---------|
| `INVALID_SEARCH_QUERY` | Syntax error in SQL | Check SQL syntax, column names |
| `SSS_INVALID_SRCH_COL` | Column doesn't exist on table | Use `OA_COLUMNS` to verify |
| `UNEXPECTED_ERROR` | Various | Check for reserved words, missing quotes |
| `SSS_SEARCH_TIMEOUT` | Query too slow | Add filters, limit results, use indexed columns |
| `INVALID_SEARCH_QUERY: ... SELECT *` | Used `SELECT *` | Enumerate columns explicitly |

### 19.2 Robust Error Handling Pattern

```javascript
/**
 * Execute SuiteQL with comprehensive error handling.
 * Returns { success, data, error, rowCount }
 */
const executeSuiteQL = (sql, params, options) => {
    const { label = 'SuiteQL', maxRetries = 0, fallback = null } = options || {};

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const results = query.runSuiteQL({
                query: sql,
                params: params || [],
            });

            const rows = results.asMappedResults();

            return {
                success: true,
                data: rows,
                rowCount: rows.length,
                columns: results.columns.map((c) => ({ label: c.label, type: c.type })),
            };
        } catch (e) {
            log.error(label + ' - Attempt ' + (attempt + 1), {
                message: e.message,
                name: e.name,
                sql: sql.substring(0, 500),
                params: JSON.stringify(params),
            });

            if (attempt === maxRetries) {
                return {
                    success: false,
                    error: e.message,
                    data: fallback || [],
                    rowCount: 0,
                };
            }
        }
    }
};

// Usage:
const result = executeSuiteQL(
    `SELECT id, companyname FROM customer WHERE id = ?`,
    [123],
    { label: 'GetCustomer', maxRetries: 1, fallback: [] }
);

if (result.success) {
    log.debug('Found', result.rowCount + ' rows');
} else {
    log.error('Query failed', result.error);
}
```

### 19.3 Validating Queries Before Execution

```javascript
/**
 * Quick validation — run the query with FETCH FIRST 1 ROW to test syntax
 * before executing the full query.
 */
const validateQuery = (sql) => {
    try {
        // Strip any existing FETCH/OFFSET clauses for the test
        const testSql = sql.replace(/FETCH\s+.*/i, '').replace(/OFFSET\s+.*/i, '');
        query.runSuiteQL({
            query: testSql + ' FETCH FIRST 1 ROWS ONLY',
        });
        return { valid: true };
    } catch (e) {
        return { valid: false, error: e.message };
    }
};
```

---

## 20. Quick Reference Cheat Sheet

### Query Templates

```sql
-- Count records
SELECT COUNT(*) AS cnt FROM {table} WHERE {conditions}

-- Exists check
SELECT CASE WHEN EXISTS (SELECT 1 FROM {table} WHERE {conditions}) THEN 1 ELSE 0 END AS exists_flag FROM DUAL

-- Lookup single value
SELECT {column} FROM {table} WHERE id = ? FETCH FIRST 1 ROWS ONLY

-- List with paging
SELECT {columns} FROM {table} WHERE {conditions} ORDER BY {column} OFFSET ? ROWS FETCH NEXT ? ROWS ONLY

-- Aggregate report
SELECT {group_column}, COUNT(*), SUM({amount}) FROM {table} WHERE {conditions} GROUP BY {group_column} HAVING {aggregate_condition} ORDER BY {column}
```

### Transaction Type Codes

| Type | Code | Status Prefix |
|------|------|---------------|
| Sales Order | `SalesOrd` | `SalesOrd:A/B/C/G/H` |
| Invoice | `CustInvc` | `CustInvc:A/B` |
| Customer Payment | `CustPymt` | `CustPymt:A/C` |
| Purchase Order | `PurchOrd` | `PurchOrd:A/B/D/E/G` |
| Vendor Bill | `VendBill` | `VendBill:A/B` |
| Vendor Payment | `VendPymt` | `VendPymt:A/Z` |
| Cash Sale | `CashSale` | `CashSale:A/B/C` |
| Item Fulfillment | `ItemShip` | `ItemShip:A/B/C` |
| Item Receipt | `ItemRcpt` | `ItemRcpt:A/B/C` |
| Journal Entry | `Journal` | `Journal:A/B` |
| Estimate/Quote | `Estimate` | `Estimate:A/B/V/X` |
| Opportunity | `Opprtnty` | `Opprtnty:A/B` |
| Return Auth | `RtnAuth` | `RtnAuth:A/B/C` |
| Credit Memo | `CustCred` | `CustCred:A/B` |
| Vendor Credit | `VendCred` | `VendCred:A/B` |
| Transfer Order | `TrnfrOrd` | `TrnfrOrd:A/B/D/E/F` |
| Inventory Adjustment | `InvAdjst` | `InvAdjst:A/B` |
| Work Order | `WorkOrd` | `WorkOrd:A/B/D/G` |

### BUILTIN Functions

```sql
BUILTIN.DF(field)               -- Display value of list/record field
BUILTIN.CF(field)               -- Currency-formatted value
BUILTIN.CONSOLIDATE(amount, acct, periodStart, periodEnd, subsidiary)  -- Multi-currency
```

### NULL Helpers

```sql
NVL(field, default)             -- Replace NULL with default
NVL2(field, not_null_val, null_val)  -- If not null return X, else Y
COALESCE(a, b, c, ...)         -- First non-NULL
NULLIF(a, b)                   -- NULL if a = b
```

### Date Quick Reference

```sql
SYSDATE                        -- Now
TRUNC(SYSDATE)                 -- Today at midnight
ADD_MONTHS(SYSDATE, -n)        -- n months ago
SYSDATE - n                    -- n days ago
TO_DATE('YYYY-MM-DD', fmt)     -- Parse string to date
TO_CHAR(date, fmt)             -- Format date to string
EXTRACT(YEAR/MONTH/DAY FROM d) -- Get date component
TRUNC(date, 'MM')              -- First of month
TRUNC(date, 'Q')               -- First of quarter
TRUNC(date, 'YYYY')            -- First of year
```

### SuiteScript N/query Quick Reference

```javascript
// Simple query
query.runSuiteQL({ query: 'SELECT ...', params: [] }).asMappedResults();

// Paged query
const pd = query.runSuiteQLPaged({ query: 'SELECT ...', pageSize: 1000 });
pd.pageRanges.forEach(pr => { const rows = pd.fetch(pr.index).data.asMappedResults(); });

// Governance: runSuiteQL = 10 units, fetch per page = 5 units
```

---

*End of SuiteQL Reference Guide*
