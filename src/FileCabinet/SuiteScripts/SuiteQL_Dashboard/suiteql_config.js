/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Shared SuiteQL Dashboard configuration:
 *   - Pre-approved query templates
 *   - SQL validation rules (limit & complexity guards)
 *   - Allowed roles
 *
 * Used by both the Restlet and the Suitelet so the rules stay in sync.
 */
define([], () => {

    /**
     * Pre-approved query templates.
     * To add a template: append a new object with id/title/description/sql.
     * Use ${param} placeholders for runtime substitution.
     */
    const TEMPLATES = [
        {
            id: 'all_employees',
            title: 'All Employees',
            description: 'List all custom employee records with key fields.',
            sql: `SELECT id, name,
                         custrecord_emp_mahmoud_email   AS email,
                         custrecord_emp_mahmoud_phone   AS phone,
                         custrecord_emp_mahmoud_jobtitle AS job_title,
                         custrecord_emp_mahmoud_address AS city
                  FROM customrecord_emp_mahmoud
                  ORDER BY id DESC`
        },
        {
            id: 'employees_by_jobtitle',
            title: 'Employee Count by Job Title',
            description: 'Group employees by job title (aggregate).',
            sql: `SELECT custrecord_emp_mahmoud_jobtitle AS job_title,
                         COUNT(*) AS total
                  FROM customrecord_emp_mahmoud
                  GROUP BY custrecord_emp_mahmoud_jobtitle
                  ORDER BY total DESC`
        },
        {
            id: 'employees_by_city',
            title: 'Employee Count by City',
            description: 'Group employees by city (aggregate).',
            sql: `SELECT custrecord_emp_mahmoud_address AS city,
                         COUNT(*) AS total
                  FROM customrecord_emp_mahmoud
                  GROUP BY custrecord_emp_mahmoud_address
                  ORDER BY total DESC`
        },
        {
            id: 'duplicate_emails',
            title: 'Duplicate Emails',
            description: 'Find emails that appear in more than one record.',
            sql: `SELECT custrecord_emp_mahmoud_email AS email,
                         COUNT(*) AS occurrences
                  FROM customrecord_emp_mahmoud
                  GROUP BY custrecord_emp_mahmoud_email
                  HAVING COUNT(*) > 1
                  ORDER BY occurrences DESC`
        },
        {
            id: 'recent_invoices',
            title: 'Recent Invoices (Last 30 Days)',
            description: 'Native record example: invoices created in the last 30 days.',
            sql: `SELECT id, tranid, trandate, entity, total
                  FROM transaction
                  WHERE type = 'CustInvc'
                    AND trandate >= TO_DATE(SYSDATE - 30)
                  ORDER BY trandate DESC`
        },
        {
            id: 'top_customers',
            title: 'Top 10 Customers by Invoice Total',
            description: 'Aggregate native data — top 10 customers.',
            sql: `SELECT entity, SUM(total) AS total_invoiced
                  FROM transaction
                  WHERE type = 'CustInvc'
                  GROUP BY entity
                  ORDER BY total_invoiced DESC
                  FETCH FIRST 10 ROWS ONLY`
        },
        {
            id: 'sales_orders',
            title: 'Sales Orders (with names)',
            description: 'Recent Sales Orders with customer name and status TEXT (not internal IDs).',
            sql: `SELECT t.id,
                         t.tranid,
                         t.trandate,
                         BUILTIN.DF(t.entity)   AS customer,
                         BUILTIN.DF(t.status)   AS status,
                         t.memo,
                         t.foreigntotal         AS total
                  FROM transaction t
                  WHERE t.type = 'SalesOrd'
                  ORDER BY t.trandate DESC, t.id DESC`
        },
        {
            id: 'sales_order_lines',
            title: 'Sales Order Lines (with item names)',
            description: 'Sales order line items joined to item master — returns item name and unit text.',
            sql: `SELECT t.id           AS order_id,
                         t.tranid       AS order_no,
                         t.trandate,
                         BUILTIN.DF(t.entity) AS customer,
                         tl.linesequencenumber AS line_no,
                         BUILTIN.DF(tl.item)   AS item,
                         tl.quantity,
                         tl.rate,
                         tl.foreignamount      AS amount
                  FROM   transaction t
                  JOIN   transactionline tl ON tl.transaction = t.id
                  WHERE  t.type = 'SalesOrd'
                    AND  tl.itemtype IS NOT NULL
                    AND  tl.mainline = 'F'
                  ORDER BY t.trandate DESC, t.id DESC, tl.linesequencenumber`
        }
    ];

    /**
     * Query limit/complexity rules — adjust to taste.
     * These are enforced server-side; client-side mirrors them for fast feedback.
     */
    const LIMITS = {
        MAX_SQL_LENGTH:        4000,   // characters
        MAX_RESULT_ROWS:       5000,   // hard cap
        DEFAULT_PAGE_SIZE:     50,
        MAX_PAGE_SIZE:         500,
        ALLOWED_FIRST_KEYWORD: ['SELECT', 'WITH']  // SELECT / WITH (CTE) only
    };

    /** Statements/keywords that are flat-out banned, even inside subqueries. */
    const BLOCKED_PATTERNS = [
        /\bINSERT\b/i,
        /\bUPDATE\b/i,
        /\bDELETE\b/i,
        /\bMERGE\b/i,
        /\bDROP\b/i,
        /\bTRUNCATE\b/i,
        /\bALTER\b/i,
        /\bCREATE\b/i,
        /\bGRANT\b/i,
        /\bREVOKE\b/i,
        /;\s*\S/    // multiple statements (semicolon followed by anything)
    ];

    /**
     * Optional role allow-list. Empty array = everyone authenticated.
     * Populate with role internal IDs (e.g. [3, 1057]) to restrict access.
     */
    const ALLOWED_ROLES = [];

    /**
     * Validate a SuiteQL query. Returns { ok: true } or { ok: false, error: '...' }.
     * Pure function — safe to call client-side AND server-side.
     */
    const validateSQL = (sql) => {
        if (typeof sql !== 'string') {
            return { ok: false, error: 'SQL must be a string.' };
        }
        const trimmed = sql.trim();
        if (!trimmed) {
            return { ok: false, error: 'SQL is empty.' };
        }
        if (trimmed.length > LIMITS.MAX_SQL_LENGTH) {
            return {
                ok: false,
                error: `SQL exceeds maximum length of ${LIMITS.MAX_SQL_LENGTH} characters.`
            };
        }

        // First non-whitespace keyword must be SELECT or WITH
        const firstWord = trimmed.split(/\s+/)[0].toUpperCase();
        if (LIMITS.ALLOWED_FIRST_KEYWORD.indexOf(firstWord) === -1) {
            return {
                ok: false,
                error: `Only ${LIMITS.ALLOWED_FIRST_KEYWORD.join('/')} statements are allowed.`
            };
        }

        // Banned keywords / multi-statement
        for (let i = 0; i < BLOCKED_PATTERNS.length; i++) {
            if (BLOCKED_PATTERNS[i].test(trimmed)) {
                return {
                    ok: false,
                    error: 'Query contains a disallowed keyword or statement.'
                };
            }
        }

        return { ok: true };
    };

    /** Check if the current user role is allowed (returns boolean). */
    const isRoleAllowed = (currentRoleId) => {
        if (!ALLOWED_ROLES || ALLOWED_ROLES.length === 0) return true;
        return ALLOWED_ROLES.indexOf(Number(currentRoleId)) !== -1;
    };

    return {
        TEMPLATES,
        LIMITS,
        ALLOWED_ROLES,
        validateSQL,
        isRoleAllowed
    };
});
