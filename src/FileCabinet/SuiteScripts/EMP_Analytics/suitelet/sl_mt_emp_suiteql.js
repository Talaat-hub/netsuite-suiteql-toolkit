/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 *
 * SuiteQL Employee Explorer — Demonstrates N/query (SuiteQL) for querying
 * and displaying custom record data with aggregation, filtering, and joins.
 */
define([
    'N/ui/serverWidget',
    'N/query',
    'N/record',
    'N/runtime',
    'N/log',
    'N/url'
], (serverWidget, query, record, runtime, log, url) => {

    /* ──────────────────────────────────────────
     *  CONSTANTS
     * ────────────────────────────────────────── */

    const RECORD_TYPE  = 'customrecord_emp_mahmoud';
    const TABLE_NAME   = 'customrecord_emp_mahmoud';

    const SCRIPT_ID    = 'customscript_sl_mt_emp_suiteql';
    const DEPLOY_ID    = 'customdeploy_sl_mt_emp_suiteql';

    /* ──────────────────────────────────────────
     *  ENTRY POINT
     * ────────────────────────────────────────── */

    const onRequest = (context) => {
        try {
            const action = context.request.parameters.action;

            if (action === 'getData')          return respondJSON(context, getAllData());
            if (action === 'getEmployee')      return respondJSON(context, getEmployee(context.request.parameters.empId));
            if (action === 'deleteEmployee')   return respondJSON(context, deleteEmployeeById(context.request.parameters.empId));

            return renderDashboard(context);
        } catch (errOnRequest) {
            log.error('errOnRequest', errOnRequest);
            context.response.write('<h2>Error: ' + errOnRequest.message + '</h2>');
        }
    };

    /* ──────────────────────────────────────────
     *  SUITEQL QUERIES
     * ────────────────────────────────────────── */

    /**
     * Fetches all employees with SuiteQL.
     * Demonstrates: SELECT, aliases, COALESCE, ORDER BY.
     */
    const queryAllEmployees = () => {
        try {
            const sql = `
                SELECT
                    id,
                    name                                          AS name,
                    COALESCE(custrecord_emp_mahmoud_email, '') AS email,
                    COALESCE(custrecord_emp_mahmoud_phone, '') AS phone,
                    COALESCE(custrecord_emp_mahmoud_jobtitle, 'Unspecified') AS jobTitle,
                    COALESCE(custrecord_emp_mahmoud_status, '') AS status,
                    COALESCE(custrecord_emp_mahmoud_address, '') AS address,
                    custrecord_emp_mahmoud_dob                 AS dob,
                    COALESCE(custrecord_emp_mahmoud_about, '')  AS about
                FROM
                    ${TABLE_NAME}
                ORDER BY
                    name ASC
            `;

            const resultSet = query.runSuiteQL({ query: sql });
            return resultSet.asMappedResults();
        } catch (errQueryAllEmployees) {
            log.error('errQueryAllEmployees', errQueryAllEmployees);
            throw errQueryAllEmployees;
        }
    };

    /**
     * Aggregation query — count employees per job title.
     * Demonstrates: GROUP BY, COUNT, ORDER BY aggregate.
     */
    const queryJobTitleStats = () => {
        try {
            const sql = `
                SELECT
                    COALESCE(custrecord_emp_mahmoud_jobtitle, 'Unspecified') AS jobTitle,
                    COUNT(*)                                                    AS cnt
                FROM
                    ${TABLE_NAME}
                GROUP BY
                    custrecord_emp_mahmoud_jobtitle
                ORDER BY
                    cnt DESC
            `;

            const resultSet = query.runSuiteQL({ query: sql });
            return resultSet.asMappedResults();
        } catch (errQueryJobTitleStats) {
            log.error('errQueryJobTitleStats', errQueryJobTitleStats);
            throw errQueryJobTitleStats;
        }
    };

    /**
     * Aggregation query — count employees per city/address.
     * Demonstrates: GROUP BY on a different dimension.
     */
    const queryLocationStats = () => {
        try {
            const sql = `
                SELECT
                    COALESCE(custrecord_emp_mahmoud_address, 'Unknown') AS city,
                    COUNT(*)                                               AS cnt
                FROM
                    ${TABLE_NAME}
                GROUP BY
                    custrecord_emp_mahmoud_address
                ORDER BY
                    cnt DESC
            `;

            const resultSet = query.runSuiteQL({ query: sql });
            return resultSet.asMappedResults();
        } catch (errQueryLocationStats) {
            log.error('errQueryLocationStats', errQueryLocationStats);
            throw errQueryLocationStats;
        }
    };

    /**
     * Summary KPIs via a single query.
     * Demonstrates: COUNT, COUNT with CASE, multiple aggregates.
     */
    const queryKPIs = () => {
        try {
            const sql = `
                SELECT
                    COUNT(*)                                                                AS total,
                    COUNT(DISTINCT custrecord_emp_mahmoud_jobtitle)                       AS uniqueJobTitles,
                    COUNT(DISTINCT custrecord_emp_mahmoud_address)                        AS uniqueCities,
                    SUM(CASE WHEN custrecord_emp_mahmoud_email IS NOT NULL THEN 1 ELSE 0 END) AS withEmail
                FROM
                    ${TABLE_NAME}
            `;

            const resultSet = query.runSuiteQL({ query: sql });
            const rows = resultSet.asMappedResults();
            return rows.length > 0 ? rows[0] : { total: 0, uniquejobtitles: 0, uniquecities: 0, withemail: 0 };
        } catch (errQueryKPIs) {
            log.error('errQueryKPIs', errQueryKPIs);
            throw errQueryKPIs;
        }
    };

    /**
     * Fetch a single employee by ID using a parameterized query.
     * Demonstrates: WHERE with bind parameter (prevents SQL injection).
     */
    const querySingleEmployee = (empId) => {
        try {
            const sql = `
                SELECT
                    id,
                    name,
                    COALESCE(custrecord_emp_mahmoud_email, '')      AS email,
                    COALESCE(custrecord_emp_mahmoud_phone, '')      AS phone,
                    COALESCE(custrecord_emp_mahmoud_jobtitle, '')   AS jobTitle,
                    COALESCE(custrecord_emp_mahmoud_status, '')     AS status,
                    COALESCE(custrecord_emp_mahmoud_address, '')    AS address,
                    custrecord_emp_mahmoud_dob                      AS dob,
                    COALESCE(custrecord_emp_mahmoud_about, '')      AS about
                FROM
                    ${TABLE_NAME}
                WHERE
                    id = ?
            `;

            const resultSet = query.runSuiteQL({ query: sql, params: [empId] });
            const rows = resultSet.asMappedResults();
            return rows.length > 0 ? rows[0] : null;
        } catch (errQuerySingleEmployee) {
            log.error('errQuerySingleEmployee', errQuerySingleEmployee);
            throw errQuerySingleEmployee;
        }
    };

    /**
     * Duplicate detection query.
     * Demonstrates: GROUP BY + HAVING, subquery-like aggregation.
     */
    const queryDuplicates = () => {
        try {
            const sql = `
                SELECT
                    COALESCE(custrecord_emp_mahmoud_email, '') AS email,
                    COALESCE(custrecord_emp_mahmoud_phone, '') AS phone,
                    COUNT(*) AS cnt
                FROM
                    ${TABLE_NAME}
                GROUP BY
                    custrecord_emp_mahmoud_email,
                    custrecord_emp_mahmoud_phone
                HAVING
                    COUNT(*) > 1
                ORDER BY
                    cnt DESC
            `;

            const resultSet = query.runSuiteQL({ query: sql });
            return resultSet.asMappedResults();
        } catch (errQueryDuplicates) {
            log.error('errQueryDuplicates', errQueryDuplicates);
            throw errQueryDuplicates;
        }
    };

    /* ──────────────────────────────────────────
     *  AJAX HANDLERS
     * ────────────────────────────────────────── */

    const getAllData = () => {
        try {
            const employees     = queryAllEmployees();
            const kpis          = queryKPIs();
            const jobTitleStats = queryJobTitleStats();
            const locationStats = queryLocationStats();
            const duplicates    = queryDuplicates();

            const completeness = kpis.total > 0
                ? ((kpis.withemail / kpis.total) * 100).toFixed(1)
                : '0.0';

            return {
                success: true,
                employees: employees,
                kpis: {
                    total:          kpis.total,
                    uniqueJobTitles: kpis.uniquejobtitles,
                    uniqueCities:   kpis.uniquecities,
                    completeness:   completeness,
                },
                jobTitleStats: jobTitleStats,
                locationStats: locationStats,
                duplicates:    duplicates,
            };
        } catch (errGetAllData) {
            log.error('errGetAllData', errGetAllData);
            return { success: false, error: errGetAllData.message };
        }
    };

    const getEmployee = (empId) => {
        try {
            if (!empId) throw new Error('Missing empId');
            const emp = querySingleEmployee(parseInt(empId, 10));
            if (!emp) throw new Error('Employee not found (ID: ' + empId + ')');
            return { success: true, employee: emp };
        } catch (errGetEmployee) {
            log.error('errGetEmployee', errGetEmployee);
            return { success: false, error: errGetEmployee.message };
        }
    };

    const deleteEmployeeById = (empId) => {
        try {
            if (!empId) throw new Error('Missing empId');
            const recId = parseInt(empId, 10);
            record.delete({ type: RECORD_TYPE, id: recId });
            log.audit('SuiteQL Dashboard - Deleted', { id: recId });
            return { success: true, id: recId };
        } catch (errDeleteEmployeeById) {
            log.error('errDeleteEmployeeById', errDeleteEmployeeById);
            return { success: false, error: errDeleteEmployeeById.message };
        }
    };

    /* ──────────────────────────────────────────
     *  HELPERS
     * ────────────────────────────────────────── */

    const respondJSON = (context, data) => {
        try {
            context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
            context.response.write(JSON.stringify(data));
        } catch (errRespondJSON) {
            log.error('errRespondJSON', errRespondJSON);
            throw errRespondJSON;
        }
    };

    /* ──────────────────────────────────────────
     *  RENDER DASHBOARD
     * ────────────────────────────────────────── */

    const renderDashboard = (context) => {
        try {
            const form = serverWidget.createForm({ title: ' ' });

            const htmlField = form.addField({
                id: 'custpage_suiteql_html',
                type: serverWidget.FieldType.INLINEHTML,
                label: 'SuiteQL Dashboard'
            });

            htmlField.defaultValue = getDashboardHTML(context);
            context.response.writePage(form);
        } catch (errRenderDashboard) {
            log.error('errRenderDashboard', errRenderDashboard);
            throw errRenderDashboard;
        }
    };

    /* ──────────────────────────────────────────
     *  INLINE HTML
     * ────────────────────────────────────────── */

    const getDashboardHTML = (context) => {
        try {
            const dashUrl   = url.resolveScript({ scriptId: SCRIPT_ID, deploymentId: DEPLOY_ID });
            const userName  = runtime.getCurrentUser().name || 'User';
            const userInitial = userName.charAt(0).toUpperCase();

            return /* html */ `
<script src="https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js"><\/script>

<style>
  #main_form { background: transparent !important; margin: 0 !important; padding: 0 !important; }
  .uir-page-title-secondline, .uir-page-title { display: none !important; }
  body { background: #F0F2F5 !important; }

  :root {
    --pri:#6366F1;--pri-l:#818CF8;--pri-bg:#EEF2FF;--pri-dk:#4F46E5;
    --teal:#14B8A6;--teal-bg:#F0FDFA;
    --amber:#F59E0B;--amber-bg:#FFFBEB;
    --rose:#F43F5E;--rose-bg:#FFF1F2;
    --violet:#8B5CF6;--violet-bg:#F5F3FF;
    --g50:#F9FAFB;--g100:#F3F4F6;--g200:#E5E7EB;--g300:#D1D5DB;--g400:#9CA3AF;
    --g500:#6B7280;--g600:#4B5563;--g700:#374151;--g800:#1F2937;--g900:#111827;
    --white:#FFF;
    --sh:0 1px 3px rgba(0,0,0,.08);--sh-md:0 4px 12px rgba(0,0,0,.08);--sh-lg:0 10px 25px rgba(0,0,0,.1);
    --r:10px;--r-lg:14px;
  }
  .sq *{box-sizing:border-box;margin:0;padding:0}
  .sq{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:var(--g800);max-width:1360px;margin:0 auto;padding:24px 16px}

  /* Top bar */
  .sq-top{background:linear-gradient(135deg,var(--pri-dk),var(--pri),var(--pri-l));color:#fff;display:flex;align-items:center;height:56px;padding:0 28px;border-radius:var(--r-lg) var(--r-lg) 0 0;box-shadow:var(--sh-md)}
  .sq-top .logo{font-weight:700;font-size:16px;display:flex;align-items:center;gap:8px;letter-spacing:-.3px}
  .sq-top .badge{background:rgba(255,255,255,.2);font-size:10px;padding:2px 8px;border-radius:20px;font-weight:600;letter-spacing:.5px}
  .sq-top .usr{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:13px}
  .sq-top .av{width:32px;height:32px;background:rgba(255,255,255,.2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:13px}

  /* Page Header */
  .sq-ph{background:var(--white);padding:20px 28px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--g200)}
  .sq-ph h1{font-size:22px;font-weight:800;color:var(--g900);letter-spacing:-.5px}
  .sq-ph .sub{font-size:13px;color:var(--g500);margin-top:2px}

  /* KPI */
  .sq-kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;padding:20px 28px;background:var(--white);border-bottom:1px solid var(--g200)}
  .sq-kc{padding:20px;border-radius:var(--r-lg);border:1px solid var(--g200);display:flex;align-items:center;gap:14px;transition:.25s;background:var(--white)}
  .sq-kc:hover{box-shadow:var(--sh-md);transform:translateY(-2px)}
  .sq-ki{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .sq-ki.c1{background:var(--pri-bg)}.sq-ki.c2{background:var(--teal-bg)}.sq-ki.c3{background:var(--amber-bg)}.sq-ki.c4{background:var(--violet-bg)}
  .sq-kv{font-size:26px;font-weight:800;color:var(--g900);line-height:1;letter-spacing:-.5px}
  .sq-kl{font-size:11.5px;color:var(--g500);margin-top:3px;text-transform:uppercase;letter-spacing:.3px;font-weight:600}

  /* Charts */
  .sq-charts{display:grid;grid-template-columns:1fr 1fr;gap:0;background:var(--white);border-bottom:1px solid var(--g200)}
  .sq-cbox{padding:20px 28px;border-right:1px solid var(--g200)}
  .sq-cbox:last-child{border-right:none}
  .sq-ctitle{font-size:14px;font-weight:700;color:var(--g800);margin-bottom:12px;display:flex;align-items:center;gap:6px}
  .sq-ctitle .tag{background:var(--pri-bg);color:var(--pri);font-size:10px;padding:2px 8px;border-radius:20px;font-weight:600}

  /* Duplicates */
  .sq-dup{background:var(--white);border-bottom:1px solid var(--g200);padding:20px 28px}
  .sq-dup h3{font-size:14px;font-weight:700;color:var(--g800);margin-bottom:12px;display:flex;align-items:center;gap:8px}
  .sq-dup .dup-badge{background:var(--rose-bg);color:var(--rose);font-size:11px;padding:2px 10px;border-radius:20px;font-weight:700}
  .sq-dup-tbl{width:100%;border-collapse:collapse}
  .sq-dup-tbl th{background:var(--rose-bg);color:var(--rose);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;padding:8px 14px;text-align:left}
  .sq-dup-tbl td{padding:8px 14px;font-size:13px;color:var(--g700);border-bottom:1px solid var(--g100)}
  .sq-dup .no-dup{color:var(--teal);font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px}

  /* Grid Section */
  .sq-grid{background:var(--white);border-radius:0 0 var(--r-lg) var(--r-lg);overflow:hidden}
  .sq-grid-head{padding:16px 28px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--g200)}
  .sq-grid-head h2{font-size:15px;font-weight:700;color:var(--g800)}
  .sq-grid-head .cnt{background:var(--pri-bg);color:var(--pri);font-size:11px;padding:2px 10px;border-radius:20px;font-weight:700;margin-left:8px}
  .sq-fbar{display:flex;gap:8px;align-items:center}
  .sq-fbar input,.sq-fbar select{padding:8px 14px;border:1px solid var(--g300);border-radius:8px;font-size:13px;color:var(--g700);background:var(--white);transition:.2s}
  .sq-fbar input:focus,.sq-fbar select:focus{outline:none;border-color:var(--pri);box-shadow:0 0 0 3px rgba(99,102,241,.12)}
  .sq-fbar input{width:240px}

  /* Table */
  .sq-tbl{width:100%;border-collapse:collapse}
  .sq-tbl thead th{background:var(--g50);color:var(--g600);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:10px 14px;text-align:left;border-bottom:2px solid var(--g200);cursor:pointer;user-select:none;white-space:nowrap}
  .sq-tbl thead th:hover{background:var(--g100)}
  .sq-tbl thead th .si{display:inline-block;margin-left:4px;color:var(--g400);font-size:9px}
  .sq-tbl thead th.asc .si::after{content:'\\25B2';color:var(--pri)}
  .sq-tbl thead th.desc .si::after{content:'\\25BC';color:var(--pri)}
  .sq-tbl thead th:not(.asc):not(.desc) .si::after{content:'\\25B2\\25BC';font-size:8px;letter-spacing:-2px;opacity:.3}
  .sq-tbl tbody tr{border-bottom:1px solid var(--g100);transition:background .15s}
  .sq-tbl tbody tr:hover{background:var(--pri-bg)}
  .sq-tbl tbody td{padding:10px 14px;font-size:13px;color:var(--g800);vertical-align:middle}
  .sq-tbl .emp-n{color:var(--pri);font-weight:600;cursor:pointer;text-decoration:none}
  .sq-tbl .emp-n:hover{text-decoration:underline;color:var(--pri-dk)}
  .sq-tbl .ec{color:var(--g400)}

  /* Badges */
  .bd{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:700;white-space:nowrap}
  .bd-p{background:var(--pri-bg);color:var(--pri)}.bd-t{background:var(--teal-bg);color:var(--teal)}.bd-a{background:var(--amber-bg);color:var(--amber)}.bd-r{background:var(--rose-bg);color:var(--rose)}.bd-v{background:var(--violet-bg);color:var(--violet)}

  /* Pagination */
  .sq-pag{display:flex;align-items:center;justify-content:space-between;padding:12px 28px;border-top:1px solid var(--g200);background:var(--g50)}
  .sq-pag .info{font-size:13px;color:var(--g500)}
  .sq-pag .btns{display:flex;gap:4px}
  .sq-pag .pg{padding:6px 12px;border:1px solid var(--g300);border-radius:6px;background:var(--white);color:var(--g700);font-size:13px;cursor:pointer;transition:.2s;font-weight:500}
  .sq-pag .pg:hover:not(:disabled){background:var(--pri-bg);border-color:var(--pri);color:var(--pri)}
  .sq-pag .pg:disabled{opacity:.4;cursor:default}
  .sq-pag .pg.on{background:var(--pri);color:var(--white);border-color:var(--pri)}

  /* Buttons */
  .sbtn{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;border:none;transition:.2s}
  .sbtn-v{background:var(--pri-bg);color:var(--pri)}.sbtn-v:hover{background:#DDD6FE}
  .sbtn-d{background:var(--rose-bg);color:var(--rose)}.sbtn-d:hover{background:#FECDD3}
  .sbtn-sec{background:var(--white);color:var(--g700);border:1px solid var(--g300);padding:8px 16px;border-radius:8px;font-size:13px;font-weight:500}
  .sbtn-sec:hover{background:var(--g50)}

  /* Modal */
  .sq-mbg{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.45);z-index:9999;align-items:center;justify-content:center;backdrop-filter:blur(2px)}
  .sq-mbg.show{display:flex}
  .sq-modal{background:var(--white);border-radius:var(--r-lg);width:580px;max-height:80vh;overflow-y:auto;box-shadow:var(--sh-lg);padding:28px}
  .sq-modal h2{font-size:18px;font-weight:800;color:var(--g900);margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;letter-spacing:-.3px}
  .sq-modal .xbtn{background:none;border:none;cursor:pointer;color:var(--g400);font-size:22px;padding:4px;line-height:1}
  .sq-modal .xbtn:hover{color:var(--g700)}
  .sq-modal .fg{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .sq-modal .fi{padding:14px;background:var(--g50);border-radius:var(--r);border:1px solid var(--g200)}
  .sq-modal .fi.fw{grid-column:1/3}
  .sq-modal .fi .fl{font-size:10px;color:var(--g400);text-transform:uppercase;letter-spacing:.6px;font-weight:700}
  .sq-modal .fi .fv{font-size:14px;font-weight:500;color:var(--g800);margin-top:4px;word-break:break-word}

  /* Query Viewer */
  .sq-qv{background:var(--white);border-bottom:1px solid var(--g200);padding:20px 28px}
  .sq-qv h3{font-size:14px;font-weight:700;color:var(--g800);margin-bottom:12px;display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none}
  .sq-qv h3 .arr{transition:.2s;display:inline-block}
  .sq-qv h3 .arr.open{transform:rotate(90deg)}
  .sq-qv pre{background:var(--g900);color:#A5F3FC;padding:16px 20px;border-radius:var(--r);font-size:12.5px;line-height:1.6;overflow-x:auto;font-family:'Fira Code','Cascadia Code',monospace;display:none}
  .sq-qv pre.show{display:block}
  .sq-qv pre .kw{color:#C084FC}.sq-qv pre .fn{color:#34D399}.sq-qv pre .str{color:#FCD34D}.sq-qv pre .cm{color:var(--g500)}

  .sq-loading{text-align:center;padding:60px 20px;color:var(--g400);font-size:14px}

  @keyframes sqFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .sq-anim{animation:sqFade .35s ease forwards}
  @media(max-width:1024px){.sq-kpi{grid-template-columns:repeat(2,1fr)}.sq-charts{grid-template-columns:1fr}.sq-modal .fg{grid-template-columns:1fr}.sq-modal .fi.fw{grid-column:1}}
</style>

<div class="sq sq-anim">
  <!-- Top Nav -->
  <div class="sq-top">
    <div class="logo">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
      SuiteQL Explorer
      <span class="badge">N/query</span>
    </div>
    <div class="usr"><div class="av">${userInitial}</div><span>${userName}</span></div>
  </div>

  <!-- Page Header -->
  <div class="sq-ph">
    <div><h1>Employee Data Explorer</h1><p class="sub">Powered by SuiteQL — real-time queries on custom records</p></div>
    <button class="sbtn-sec" onclick="sqRefresh()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px"><polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
      Refresh
    </button>
  </div>

  <!-- KPIs -->
  <div class="sq-kpi">
    <div class="sq-kc"><div class="sq-ki c1"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2"/><circle cx="9" cy="7" r="4"/></svg></div><div><div class="sq-kv" id="sqTotal">--</div><div class="sq-kl">Total Employees</div></div></div>
    <div class="sq-kc"><div class="sq-ki c2"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#14B8A6" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg></div><div><div class="sq-kv" id="sqComplete">--%</div><div class="sq-kl">Email Completeness</div></div></div>
    <div class="sq-kc"><div class="sq-ki c3"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h4"/></svg></div><div><div class="sq-kv" id="sqJobs">--</div><div class="sq-kl">Job Titles</div></div></div>
    <div class="sq-kc"><div class="sq-ki c4"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></div><div><div class="sq-kv" id="sqCities">--</div><div class="sq-kl">Cities</div></div></div>
  </div>

  <!-- Charts -->
  <div class="sq-charts">
    <div class="sq-cbox"><div class="sq-ctitle">Employees by Job Title <span class="tag">GROUP BY</span></div><div id="sqJobChart" style="height:280px"></div></div>
    <div class="sq-cbox" style="border-right:none"><div class="sq-ctitle">Employees by City <span class="tag">GROUP BY</span></div><div id="sqCityChart" style="height:280px"></div></div>
  </div>

  <!-- Query Viewer -->
  <div class="sq-qv">
    <h3 onclick="sqToggleSQL()"><span class="arr" id="sqArr">&#9654;</span> View SuiteQL Queries Used</h3>
    <pre id="sqPre">
<span class="cm">-- KPI Summary (COUNT, COUNT DISTINCT, CASE)</span>
<span class="kw">SELECT</span>
    <span class="fn">COUNT</span>(*) <span class="kw">AS</span> total,
    <span class="fn">COUNT</span>(<span class="kw">DISTINCT</span> custrecord_emp_mahmoud_jobtitle) <span class="kw">AS</span> uniqueJobTitles,
    <span class="fn">COUNT</span>(<span class="kw">DISTINCT</span> custrecord_emp_mahmoud_address) <span class="kw">AS</span> uniqueCities,
    <span class="fn">SUM</span>(<span class="kw">CASE WHEN</span> custrecord_emp_mahmoud_email <span class="kw">IS NOT NULL THEN</span> <span class="str">1</span> <span class="kw">ELSE</span> <span class="str">0</span> <span class="kw">END</span>) <span class="kw">AS</span> withEmail
<span class="kw">FROM</span> customrecord_emp_mahmoud

<span class="cm">-- Job Title Stats (GROUP BY + ORDER BY aggregate)</span>
<span class="kw">SELECT</span>
    <span class="fn">COALESCE</span>(custrecord_emp_mahmoud_jobtitle, <span class="str">'Unspecified'</span>) <span class="kw">AS</span> jobTitle,
    <span class="fn">COUNT</span>(*) <span class="kw">AS</span> cnt
<span class="kw">FROM</span> customrecord_emp_mahmoud
<span class="kw">GROUP BY</span> custrecord_emp_mahmoud_jobtitle
<span class="kw">ORDER BY</span> cnt <span class="kw">DESC</span>

<span class="cm">-- Single Employee (parameterized WHERE)</span>
<span class="kw">SELECT</span> id, name, ...
<span class="kw">FROM</span> customrecord_emp_mahmoud
<span class="kw">WHERE</span> id = <span class="str">?</span>

<span class="cm">-- Duplicate Detection (GROUP BY + HAVING)</span>
<span class="kw">SELECT</span>
    custrecord_emp_mahmoud_email <span class="kw">AS</span> email,
    custrecord_emp_mahmoud_phone <span class="kw">AS</span> phone,
    <span class="fn">COUNT</span>(*) <span class="kw">AS</span> cnt
<span class="kw">FROM</span> customrecord_emp_mahmoud
<span class="kw">GROUP BY</span> custrecord_emp_mahmoud_email, custrecord_emp_mahmoud_phone
<span class="kw">HAVING COUNT</span>(*) > <span class="str">1</span>
    </pre>
  </div>

  <!-- Duplicates -->
  <div class="sq-dup" id="sqDupSec" style="display:none">
    <h3>Duplicate Records <span class="dup-badge" id="sqDupCount">0</span></h3>
    <div id="sqDupBody"></div>
  </div>

  <!-- Employee Directory -->
  <div class="sq-grid">
    <div class="sq-grid-head">
      <h2>Employee Directory <span class="cnt" id="sqDirCnt">0</span></h2>
      <div class="sq-fbar">
        <input type="text" placeholder="Search employees..." id="sqSearch" oninput="sqFilter()">
        <select id="sqJobFilter" onchange="sqFilter()"><option value="">All Job Titles</option></select>
        <select id="sqCityFilter" onchange="sqFilter()"><option value="">All Cities</option></select>
      </div>
    </div>
    <div id="sqTableWrap">
      <div class="sq-loading">Loading employees via SuiteQL...</div>
    </div>
    <div class="sq-pag" id="sqPag" style="display:none">
      <div class="info" id="sqPagInfo">Showing 0 of 0</div>
      <div class="btns" id="sqPagBtns"></div>
    </div>
  </div>
</div>

<!-- Detail Modal -->
<div class="sq-mbg" id="sqModal" onclick="if(event.target===this)sqCloseModal()">
  <div class="sq-modal sq-anim">
    <h2><span id="sqModalTitle">Employee Details</span><button class="xbtn" onclick="sqCloseModal()">&times;</button></h2>
    <div class="fg" id="sqModalBody"></div>
  </div>
</div>

<script>
(function(){
  var URL = '${dashUrl}';
  var all = [], filtered = [];
  var PS = 10, page = 1, sCol = 'name', sDir = 'asc';

  function load() {
    fetch(URL + '&action=getData')
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (!d.success) { console.error(d.error); return; }
        all = d.employees; filtered = all.slice();
        renderKPIs(d.kpis);
        renderCharts(d.jobTitleStats, d.locationStats);
        renderDups(d.duplicates);
        populateFilters(d.jobTitleStats, d.locationStats);
        renderTable();
      })
      .catch(function(e){ console.error(e); });
  }

  function renderKPIs(k) {
    document.getElementById('sqTotal').textContent = k.total;
    document.getElementById('sqComplete').textContent = k.completeness + '%';
    document.getElementById('sqJobs').textContent = k.uniqueJobTitles;
    document.getElementById('sqCities').textContent = k.uniqueCities;
  }

  function renderCharts(jts, locs) {
    var colors = ['#6366F1','#14B8A6','#F59E0B','#F43F5E','#8B5CF6','#EC4899','#06B6D4','#84CC16'];
    // Job Title Bar Chart
    var jc = echarts.init(document.getElementById('sqJobChart'));
    var jn = jts.map(function(r){ return r.jobtitle; }).reverse();
    var jv = jts.map(function(r){ return r.cnt; }).reverse();
    jc.setOption({
      tooltip: { trigger:'axis', backgroundColor:'#fff', borderColor:'#e5e7eb', textStyle:{color:'#374151',fontSize:12} },
      grid: { left:100, right:20, top:12, bottom:24 },
      xAxis: { type:'value', axisLine:{show:false}, splitLine:{lineStyle:{color:'#f3f4f6',type:'dashed'}}, axisLabel:{color:'#9CA3AF',fontSize:11} },
      yAxis: { type:'category', data:jn, axisLine:{lineStyle:{color:'#e5e7eb'}}, axisLabel:{color:'#6B7280',fontSize:11}, axisTick:{show:false} },
      series: [{ type:'bar', barWidth:20, itemStyle:{borderRadius:[0,5,5,0],color:function(p){return colors[p.dataIndex%colors.length]}}, data:jv }]
    });
    // City Pie Chart
    var cc = echarts.init(document.getElementById('sqCityChart'));
    var cd = locs.map(function(r,i){ return { name:r.city, value:r.cnt, itemStyle:{color:colors[i%colors.length]} }; });
    cc.setOption({
      tooltip: { trigger:'item', backgroundColor:'#fff', borderColor:'#e5e7eb', textStyle:{color:'#374151',fontSize:12}, formatter:'{b}: {c} ({d}%)' },
      series: [{ type:'pie', radius:['45%','75%'], center:['50%','52%'], label:{show:true,fontSize:11,color:'#6B7280',formatter:'{b}\\n{d}%'}, labelLine:{lineStyle:{color:'#D1D5DB'}}, itemStyle:{borderColor:'#fff',borderWidth:2}, data:cd }]
    });
    window.addEventListener('resize', function(){ jc.resize(); cc.resize(); });
  }

  function renderDups(dups) {
    var sec = document.getElementById('sqDupSec');
    if (!dups || dups.length === 0) { sec.style.display = 'none'; return; }
    sec.style.display = 'block';
    document.getElementById('sqDupCount').textContent = dups.length + ' group' + (dups.length > 1 ? 's' : '');
    var h = '<table class="sq-dup-tbl"><thead><tr><th>Email</th><th>Phone</th><th>Count</th></tr></thead><tbody>';
    dups.forEach(function(d){ h += '<tr><td>' + esc(d.email || '(empty)') + '</td><td>' + esc(d.phone || '(empty)') + '</td><td style="font-weight:700;color:var(--rose)">' + d.cnt + '</td></tr>'; });
    h += '</tbody></table>';
    document.getElementById('sqDupBody').innerHTML = h;
  }

  function populateFilters(jts, locs) {
    var js = document.getElementById('sqJobFilter');
    while(js.options.length>1) js.remove(1);
    jts.forEach(function(r){ var o=document.createElement('option'); o.value=r.jobtitle; o.textContent=r.jobtitle+' ('+r.cnt+')'; js.appendChild(o); });

    var cs = document.getElementById('sqCityFilter');
    while(cs.options.length>1) cs.remove(1);
    locs.forEach(function(r){ var o=document.createElement('option'); o.value=r.city; o.textContent=r.city+' ('+r.cnt+')'; cs.appendChild(o); });
  }

  function renderTable() {
    sort();
    var st = (page-1)*PS, pg = filtered.slice(st, st+PS), tot = filtered.length;
    var cols = [{k:'id',l:'ID',w:'60px'},{k:'name',l:'Name',w:'160px'},{k:'email',l:'Email',w:'200px'},{k:'phone',l:'Phone',w:'130px'},{k:'jobtitle',l:'Job Title',w:'140px'},{k:'address',l:'City',w:'120px'},{k:'_a',l:'Actions',w:'140px'}];
    var h = '<table class="sq-tbl"><thead><tr>';
    cols.forEach(function(c){
      var cls = c.k !== '_a' && sCol === c.k ? sDir : '';
      h += '<th class="'+cls+'" style="width:'+c.w+'" onclick="'+(c.k!=='_a'?"sqSort(\\'"+c.k+"\\')":'')+'">'+c.l+(c.k!=='_a'?'<span class="si"></span>':'')+'</th>';
    });
    h += '</tr></thead><tbody>';
    if (!pg.length) h += '<tr><td colspan="7" style="text-align:center;padding:40px;color:var(--g400)">No employees found</td></tr>';
    var bc = ['bd-p','bd-t','bd-a','bd-r','bd-v'];
    pg.forEach(function(e){
      var ji = Math.abs(hash(e.jobtitle||'')) % bc.length;
      h += '<tr>';
      h += '<td style="color:var(--g500);font-weight:600">#'+e.id+'</td>';
      h += '<td><a class="emp-n" onclick="sqView(\\''+e.id+'\\')">'+esc(e.name||'')+'</a></td>';
      h += '<td>'+esc(e.email||'')+'</td><td>'+esc(e.phone||'')+'</td>';
      h += '<td>'+(e.jobtitle?'<span class="bd '+bc[ji]+'">'+esc(e.jobtitle)+'</span>':'<span class="ec">\\u2014</span>')+'</td>';
      h += '<td>'+esc(e.address||'')+'</td>';
      h += '<td><button class="sbtn sbtn-v" onclick="sqView(\\''+e.id+'\\')">View</button> <button class="sbtn sbtn-d" onclick="sqDel(\\''+e.id+'\\',\\''+esc(e.name||'')+'\\')">Delete</button></td>';
      h += '</tr>';
    });
    h += '</tbody></table>';
    document.getElementById('sqTableWrap').innerHTML = h;
    document.getElementById('sqDirCnt').textContent = tot;

    var tp = Math.ceil(tot/PS)||1;
    if (page>tp) page=tp;
    var s2=tot>0?st+1:0, e2=Math.min(st+PS,tot);
    document.getElementById('sqPagInfo').textContent='Showing '+s2+'-'+e2+' of '+tot;
    var bh='<button class="pg" onclick="sqPage('+(page-1)+')" '+(page<=1?'disabled':'')+'>Prev</button>';
    for(var i=1;i<=tp;i++){
      if(tp>7&&i>3&&i<tp-2&&Math.abs(i-page)>1){if(i===4||i===tp-3)bh+='<span style="padding:6px 4px;color:var(--g400)">...</span>';continue;}
      bh+='<button class="pg'+(i===page?' on':'')+'" onclick="sqPage('+i+')">'+i+'</button>';
    }
    bh+='<button class="pg" onclick="sqPage('+(page+1)+')" '+(page>=tp?'disabled':'')+'>Next</button>';
    document.getElementById('sqPagBtns').innerHTML=bh;
    document.getElementById('sqPag').style.display='flex';
  }

  function sort(){ filtered.sort(function(a,b){ var va=(a[sCol]||'').toString().toLowerCase(),vb=(b[sCol]||'').toString().toLowerCase(); var na=parseFloat(va),nb=parseFloat(vb); if(!isNaN(na)&&!isNaN(nb)){va=na;vb=nb;} if(va<vb)return sDir==='asc'?-1:1; if(va>vb)return sDir==='asc'?1:-1; return 0; }); }
  function esc(s){ var d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
  function hash(s){ var h=0; for(var i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i); h|=0;} return h; }

  window.sqSort = function(c){ if(sCol===c) sDir=sDir==='asc'?'desc':'asc'; else {sCol=c;sDir='asc';} page=1; renderTable(); };
  window.sqPage = function(p){ var tp=Math.ceil(filtered.length/PS)||1; if(p<1||p>tp)return; page=p; renderTable(); };
  window.sqFilter = function(){
    var txt=(document.getElementById('sqSearch').value||'').toLowerCase();
    var jt=document.getElementById('sqJobFilter').value;
    var ct=document.getElementById('sqCityFilter').value;
    filtered=all.filter(function(e){
      if(jt&&e.jobtitle!==jt)return false;
      if(ct&&e.address!==ct)return false;
      if(txt){var hay=[e.name,e.email,e.phone,e.jobtitle,e.address,e.id].join(' ').toLowerCase();if(hay.indexOf(txt)===-1)return false;}
      return true;
    });
    page=1; renderTable();
  };
  window.sqRefresh = function(){ load(); };

  window.sqDel = function(id, nm) {
    if(!confirm('Delete "'+nm+'" (ID: '+id+')?'))return;
    fetch(URL+'&action=deleteEmployee&empId='+id).then(function(r){return r.json();}).then(function(d){ if(!d.success){alert(d.error);return;} load(); }).catch(function(e){alert(e.message);});
  };

  window.sqView = function(id) {
    fetch(URL+'&action=getEmployee&empId='+id).then(function(r){return r.json();}).then(function(d){ if(!d.success){alert(d.error);return;} showModal(d.employee); });
  };

  function showModal(e) {
    document.getElementById('sqModalTitle').textContent = e.name || 'Employee Details';
    var fields = [
      {l:'Name',v:e.name},{l:'Email',v:e.email},{l:'Phone',v:e.phone},{l:'Job Title',v:e.jobtitle},
      {l:'Status',v:e.status},{l:'Date of Birth',v:e.dob},{l:'Address',v:e.address,f:true},{l:'About',v:e.about,f:true}
    ];
    var h='';
    fields.forEach(function(f){ h+='<div class="fi'+(f.f?' fw':'')+'"><div class="fl">'+f.l+'</div><div class="fv">'+(f.v||'<span style="color:var(--g400)">\\u2014</span>')+'</div></div>'; });
    document.getElementById('sqModalBody').innerHTML=h;
    document.getElementById('sqModal').classList.add('show');
  }

  window.sqCloseModal = function(){ document.getElementById('sqModal').classList.remove('show'); };
  window.sqToggleSQL = function(){
    var p=document.getElementById('sqPre'),a=document.getElementById('sqArr');
    p.classList.toggle('show'); a.classList.toggle('open');
  };
  document.addEventListener('keydown',function(e){if(e.key==='Escape')sqCloseModal();});

  load();
})();
<\/script>
`;
        } catch (errGetDashboardHTML) {
            log.error('errGetDashboardHTML', errGetDashboardHTML);
            throw errGetDashboardHTML;
        }
    };

    return { onRequest };
});
