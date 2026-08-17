/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 *
 * SuiteQL Dashboard — REST API.
 *
 * Endpoints (all dispatched by `action` query/body parameter):
 *
 *   GET  ?action=templates                → { ok, templates: [...], limits: {...} }
 *   GET  ?action=execute&template=ID      → run template, paged
 *   POST { action:'execute', sql, page, pageSize }
 *
 * Auth: Standard NetSuite TBA (handled by NetSuite). Optional role allow-list
 *       enforced via SUITEQL_CONFIG.ALLOWED_ROLES.
 */
define([
    'N/query',
    'N/runtime',
    'N/log',
    'N/error',
    './suiteql_config'
],
(query, runtime, log, error, cfg) => {

    // ─── Helpers ───

    const checkAccess = () => {
        const user = runtime.getCurrentUser();
        if (!cfg.isRoleAllowed(user.role)) {
            throw error.create({
                name: 'PERMISSION_DENIED',
                message: 'Your role is not authorized to use the SuiteQL Dashboard.'
            });
        }
    };

    const getTemplate = (id) => {
        for (let i = 0; i < cfg.TEMPLATES.length; i++) {
            if (cfg.TEMPLATES[i].id === id) return cfg.TEMPLATES[i];
        }
        return null;
    };

    /**
     * Run a SuiteQL query with paging.
     * Returns { ok, columns, rows, page, pageSize, totalRows, truncated }.
     */
    const runSql = (sql, page, pageSize) => {
        const validation = cfg.validateSQL(sql);
        if (!validation.ok) {
            return { ok: false, error: validation.error };
        }

        const safePageSize = Math.min(
            Math.max(parseInt(pageSize, 10) || cfg.LIMITS.DEFAULT_PAGE_SIZE, 1),
            cfg.LIMITS.MAX_PAGE_SIZE
        );
        const safePage = Math.max(parseInt(page, 10) || 1, 1);
        const offset = (safePage - 1) * safePageSize;

        try {
            // Execute. N/query handles its own paging via .runPaged when needed,
            // but for typical dashboard queries we run once and slice in memory
            // up to MAX_RESULT_ROWS for safety.
            const rs = query.runSuiteQL({ query: sql });
            const all = rs.asMappedResults();

            const truncated = all.length > cfg.LIMITS.MAX_RESULT_ROWS;
            const capped = truncated ? all.slice(0, cfg.LIMITS.MAX_RESULT_ROWS) : all;

            const columns = capped.length > 0
                ? Object.keys(capped[0])
                : (rs.columns ? rs.columns.map(c => c.alias || c.label) : []);

            const slice = capped.slice(offset, offset + safePageSize);

            return {
                ok: true,
                columns,
                rows: slice,
                page: safePage,
                pageSize: safePageSize,
                totalRows: capped.length,
                truncated
            };
        } catch (errRunSql) {
            log.error('errRunSql', errRunSql);
            return {
                ok: false,
                error: errRunSql.message || String(errRunSql),
                code: errRunSql.name || 'SUITEQL_ERROR'
            };
        }
    };

    // ─── Entry points ───

    const onGet = (params) => {
        try {
            checkAccess();
            const action = (params.action || '').toLowerCase();

            if (action === 'templates') {
                return {
                    ok: true,
                    templates: cfg.TEMPLATES,
                    limits: cfg.LIMITS
                };
            }

            if (action === 'execute') {
                const tpl = getTemplate(params.template);
                if (!tpl) return { ok: false, error: 'Template not found.' };
                return runSql(tpl.sql, params.page, params.pageSize);
            }

            return { ok: false, error: 'Unknown action. Use action=templates or action=execute.' };
        } catch (errOnGet) {
            log.error('errOnGet', errOnGet);
            return { ok: false, error: errOnGet.message || String(errOnGet) };
        }
    };

    const onPost = (body) => {
        try {
            checkAccess();
            const action = (body.action || 'execute').toLowerCase();

            if (action !== 'execute') {
                return { ok: false, error: 'Only action=execute is allowed via POST.' };
            }

            return runSql(body.sql, body.page, body.pageSize);
        } catch (errOnPost) {
            log.error('errOnPost', errOnPost);
            return { ok: false, error: errOnPost.message || String(errOnPost) };
        }
    };

    return {
        get:  onGet,
        post: onPost
    };
});
