// Xero: invoices, bills, contacts and the two main reports. Facts from Xero's developer documentation
// (developer.xero.com/documentation), read November 2026: guides/oauth2/pkce-flow, scopes, limits and
// troubleshooting, and the Accounting API pages for invoices, contacts, reports, accounts and organisation.
// Signs in through the browser with an "Auth Code with PKCE" app, which has no secret. Apps made since March 2026
// must ask for the narrower permission names used here (accounting.invoices rather than accounting.transactions).
// Not confirmed there: that a port on the localhost return address is accepted, and the exact wrapping of a new
// invoice or contact in the request (the {"Invoices": [...]} form the answers use is sent).
import { call, count, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

const base = () => (process.env.TALQAVA_XERO_API || "https://api.xero.com").replace(/\/+$/, "");
const headers = (c: Pick<Connection, "values">) => ({ authorization: `Bearer ${c.values.access_token}`, ...(c.values.tenant_id ? { "xero-tenant-id": c.values.tenant_id } : {}) });
const api = <T = any>(c: Pick<Connection, "values">, path: string, method = "GET", body?: unknown) => call<T>(`${base()}/api.xro/2.0${path}`, { name: "Xero", method, headers: headers(c), body });

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ["DRAFT", "SUBMITTED", "AUTHORISED", "PAID", "VOIDED"];
const oneOf = (v: unknown, list: string[], what: string) => {
  const t = String(v).toUpperCase();
  if (!list.includes(t)) throw new Error(`For ${what}, choose one of: ${list.join(", ").toLowerCase()}.`);
  return t;
};
/** A day as YYYY-MM-DD, from what Xero sends ("/Date(1439434356790+0000)/" or "2009-05-27T00:00:00"). */
const day = (v: unknown): string => {
  const t = String(v ?? "");
  const ms = /\/Date\((-?\d+)/.exec(t)?.[1];
  return ms ? new Date(Number(ms)).toISOString().slice(0, 10) : t.slice(0, 10);
};
const isDay = (v: unknown, what: string) => {
  const t = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(t))) throw new Error(`Give ${what} as a date like 2026-11-30.`);
  return t;
};
const money = (n: unknown, currency?: unknown) => `${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${plain(currency, 3)}` : ""}`;
const kindOf = (v: unknown) => (String(v ?? "sales") === "bills" ? "ACCPAY" : "ACCREC");
const invoiceLine = (i: any) =>
  `${plain(i.InvoiceNumber || "(no number)", 60)} · ${i.Type === "ACCPAY" ? "bill from" : "to"} ${plain(i.Contact?.Name, 100)} · ${day(i.DateString ?? i.Date)} · due ${day(i.DueDateString ?? i.DueDate) || "not set"} · ${money(i.Total, i.CurrencyCode)}${Number(i.AmountDue) ? ` · ${money(i.AmountDue)} unpaid` : ""} · ${String(i.Status ?? "").toLowerCase()} [${i.InvoiceID}]`;

/** A report's nested rows as indented lines: section titles, then each row's cells. */
function reportText(report: any): string {
  const out: string[] = [[plain(report?.ReportName, 80), ...(report?.ReportTitles ?? []).slice(1).map((t: unknown) => plain(t, 80))].filter(Boolean).join(" · ")];
  const cells = (row: any) => (row.Cells ?? []).map((c: any) => plain(c?.Value, 80)).filter((v: string, i: number) => v || i === 0);
  const walk = (rows: any[], depth: number) => {
    for (const row of rows ?? []) {
      if (out.length > 400) return;
      if (row.RowType === "Section") {
        if (row.Title) out.push(`${"  ".repeat(depth)}${plain(row.Title, 100)}`);
        walk(row.Rows, depth + (row.Title ? 1 : 0));
      } else if (cells(row).some(Boolean)) out.push(`${"  ".repeat(depth)}${cells(row).join(" | ")}`);
    }
  };
  walk(report?.Rows, 0);
  return out.join("\n");
}

export const xero: ServiceDef = {
  id: "xero",
  name: "Xero",
  category: "Accounting and invoices",
  about: "See your Xero invoices, bills, contacts, profit and loss and balance sheet, and draft invoices for you to approve in Xero.",
  steps: [],
  docs: "https://developer.xero.com/documentation/guides/oauth2/pkce-flow",
  fields: [],
  browser: {
    authUrl: "https://login.xero.com/identity/connect/authorize",
    tokenUrl: "https://identity.xero.com/connect/token",
    scopes: ["offline_access", "accounting.invoices", "accounting.contacts", "accounting.settings.read", "accounting.reports.profitandloss.read", "accounting.reports.balancesheet.read"],
    secret: "never",
    appSteps: [
      "Open developer.xero.com/app/manage, sign in with your Xero account and add a new app.",
      "Name it Talqava Agents (Xero does not allow its own name in an app's name). For the company or application URL give your website's https address.",
      "Choose the kind of app for a mobile or desktop app: Auth Code with PKCE. It has no secret.",
      "For the OAuth 2.0 redirect URI paste exactly: {redirect}",
      "Create the app, open its Configuration page, and copy the Client ID. Paste it below and press the button. Xero asks which organisation Talqava may use.",
    ],
  },
  async check(values) {
    const list = await call<any[]>(`${base()}/connections`, { name: "Xero", headers: headers({ values: { access_token: values.access_token } }) });
    const orgs = (Array.isArray(list) ? list : []).filter((t) => t.tenantType === "ORGANISATION" && GUID.test(String(t.tenantId)));
    if (!orgs.length) throw Object.assign(new Error("Xero signed you in, but no organisation was allowed. Sign in again and choose your organisation."), { refused: true });
    // The organisation allowed most recently is the one this sign-in was for.
    const org = orgs.sort((a, b) => String(b.updatedDateUtc ?? "").localeCompare(String(a.updatedDateUtc ?? "")))[0];
    return { label: plain(org.tenantName, 120) || "Your Xero organisation", values: { tenant_id: String(org.tenantId) } };
  },
  triggers: [
    {
      name: "new_invoice",
      summary: "A new sales invoice is created",
      list: async (c) => ((await api<{ Invoices: any[] }>(c, `/Invoices${query({ where: 'Type=="ACCREC"', order: "UpdatedDateUTC DESC", page: 1, pageSize: 25, summaryOnly: true })}`)).Invoices ?? []).map((i) => String(i.InvoiceID)),
      async describe(c, id) {
        if (!GUID.test(id)) throw new Error("That is not an invoice of this organisation.");
        const i = (await api<{ Invoices: any[] }>(c, `/Invoices/${id}`)).Invoices?.[0] ?? {};
        return { title: `Invoice ${plain(i.InvoiceNumber, 60)} to ${plain(i.Contact?.Name, 100)}`, text: invoiceLine(i) };
      },
    },
  ],
  actions: [
    {
      name: "list_invoices",
      kind: "read",
      summary: "See sales invoices or bills",
      description: "Lists sales invoices (the usual) or bills to pay, newest first: number, who, date, due date, total, what is unpaid and status. Filter by status, by unpaid only, or by words in the number or reference.",
      properties: {
        kind: { type: "string", enum: ["sales", "bills"], description: "sales: invoices you sent. bills: invoices you received." },
        status: { type: "string", enum: STATUSES.map((s) => s.toLowerCase()), description: "Optional. authorised means approved and waiting for payment." },
        unpaid_only: { type: "boolean", description: "Only approved invoices that still have an amount due." },
        words: { type: "string", description: "Optional: part of the invoice number or reference." },
        limit: { type: "number", description: "How many, at most 100. Usually 25." },
      },
      async run(c, input) {
        const conditions = [`Type=="${kindOf(input.kind)}"`, ...(input.unpaid_only ? ["AmountDue>0"] : [])];
        const statuses = input.unpaid_only ? "AUTHORISED" : input.status ? oneOf(input.status, STATUSES, "status") : "";
        const r = await api<{ Invoices: any[] }>(c, `/Invoices${query({ where: conditions.join(" AND "), Statuses: statuses, SearchTerm: plain(input.words, 100), order: "Date DESC", page: 1, pageSize: count(input.limit, 25, 100), summaryOnly: true })}`);
        return (r.Invoices ?? []).map(invoiceLine).join("\n") || "No invoices match.";
      },
    },
    {
      name: "get_invoice",
      kind: "read",
      summary: "Read one invoice with its lines",
      description: "Returns one invoice or bill with its lines: description, quantity, unit price, account code and line total. Give its number (INV-0042) or the id in square brackets from list_invoices.",
      properties: { invoice: { type: "string", description: "The invoice number, or its id." } },
      required: ["invoice"],
      async run(c, input) {
        const ref = String(input.invoice ?? "").trim();
        if (!ref || ref.length > 255 || /[/?#\\\s]/.test(ref)) throw new Error("Give the invoice's number or id, without spaces.");
        const i = (await api<{ Invoices: any[] }>(c, `/Invoices/${encodeURIComponent(ref)}`)).Invoices?.[0];
        if (!i) return "Xero has no such invoice.";
        const lines = (i.LineItems ?? []).slice(0, 100).map((l: any) => `- ${plain(l.Description, 200)} · ${Number(l.Quantity ?? 0)} × ${money(l.UnitAmount)} = ${money(l.LineAmount)}${l.AccountCode ? ` · account ${plain(l.AccountCode, 20)}` : ""}`);
        return `${invoiceLine(i)}${i.Reference ? `\nReference: ${plain(i.Reference, 200)}` : ""}\n${lines.join("\n") || "(no lines)"}\nTax: ${money(i.TotalTax)} · Total: ${money(i.Total, i.CurrencyCode)} · Paid: ${money(i.AmountPaid)}`;
      },
    },
    {
      name: "find_contacts",
      kind: "read",
      summary: "Find customers and suppliers",
      description: "Finds contacts (customers and suppliers) by words in their name, email or number. Returns each one's name, email and id; use the id with draft_invoice.",
      properties: { words: { type: "string", description: "Part of the name or email. Leave out to list contacts." }, limit: { type: "number", description: "How many, at most 100. Usually 20." } },
      async run(c, input) {
        const r = await api<{ Contacts: any[] }>(c, `/Contacts${query({ searchTerm: plain(input.words, 100), order: "Name ASC", page: 1, pageSize: count(input.limit, 20, 100), summaryOnly: true })}`);
        return (r.Contacts ?? []).map((p) => `${plain(p.Name, 120)}${p.EmailAddress ? ` · ${plain(p.EmailAddress, 120)}` : ""} [${p.ContactID}]`).join("\n") || "No contacts match.";
      },
    },
    {
      name: "create_contact",
      kind: "write",
      summary: "Add a customer or supplier",
      description: "Adds a contact with a name and, optionally, an email address. Look with find_contacts first, so the same contact is not added twice.",
      properties: { name: { type: "string" }, email: { type: "string" } },
      required: ["name"],
      async run(c, input) {
        const name = plain(input.name, 255);
        if (!name) throw new Error("Give the contact's name.");
        const email = String(input.email ?? "").trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("That email address does not look right.");
        const p = (await api<{ Contacts: any[] }>(c, "/Contacts", "PUT", { Contacts: [{ Name: name, ...(email ? { EmailAddress: email } : {}) }] })).Contacts?.[0] ?? {};
        return `Added the contact ${plain(p.Name ?? name, 120)} [${p.ContactID}].`;
      },
    },
    {
      name: "draft_invoice",
      kind: "write",
      summary: "Draft an invoice or bill for you to approve in Xero",
      description: "Creates a DRAFT sales invoice (or bill) in Xero. It is never approved or sent from here: the owner reviews and approves it in Xero. Give the contact's id from find_contacts and at least one line; take account codes from list_accounts.",
      properties: {
        kind: { type: "string", enum: ["sales", "bills"] },
        contact_id: { type: "string", description: "The contact's id, from find_contacts." },
        lines: { type: "array", description: "The invoice's lines.", items: { type: "object", properties: { description: { type: "string" }, quantity: { type: "number" }, unit_amount: { type: "number", description: "Price for one, before tax." }, account_code: { type: "string", description: "The account's code, from list_accounts." } }, required: ["description", "quantity", "unit_amount"] } },
        date: { type: "string", description: "Optional: the invoice date, like 2026-11-30. Today when left out." },
        due_date: { type: "string", description: "Optional: when it is due, like 2026-12-30." },
        reference: { type: "string" },
      },
      required: ["contact_id", "lines"],
      async run(c, input) {
        const contact = String(input.contact_id ?? "").trim();
        if (!GUID.test(contact)) throw new Error("Give the contact's id, from find_contacts.");
        const lines = (Array.isArray(input.lines) ? input.lines : []).slice(0, 100).map((l: any) => {
          const description = plain(l?.description, 4000);
          const quantity = Number(l?.quantity);
          const unit = Number(l?.unit_amount);
          if (!description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unit) || unit < 0) throw new Error("Each line needs a description, a quantity above zero and a unit amount.");
          const code = String(l?.account_code ?? "").trim();
          if (code && !/^[\w.-]{1,10}$/.test(code)) throw new Error("An account code is the short code from list_accounts, such as 200.");
          return { Description: description, Quantity: quantity, UnitAmount: unit, ...(code ? { AccountCode: code } : {}) };
        });
        if (!lines.length) throw new Error("Give at least one line.");
        const invoice = { Type: kindOf(input.kind), Status: "DRAFT", Contact: { ContactID: contact }, LineItems: lines, ...(input.date ? { Date: isDay(input.date, "the date") } : {}), ...(input.due_date ? { DueDate: isDay(input.due_date, "the due date") } : {}), ...(plain(input.reference, 255) ? { Reference: plain(input.reference, 255) } : {}) };
        const i = (await api<{ Invoices: any[] }>(c, "/Invoices", "PUT", { Invoices: [invoice] })).Invoices?.[0] ?? {};
        return `Drafted ${invoiceLine(i)}\nIt is a draft: approve and send it in Xero.`;
      },
    },
    {
      name: "list_accounts",
      kind: "read",
      summary: "See the chart of accounts",
      description: "Lists the active accounts in the chart of accounts: code, name and type. Use a code for an invoice line's account_code.",
      properties: { type: { type: "string", description: "Optional: only one type, such as REVENUE, EXPENSE or BANK." } },
      async run(c, input) {
        const type = String(input.type ?? "").trim().toUpperCase();
        if (type && !/^[A-Z]{2,20}$/.test(type)) throw new Error("Give an account type in one word, such as REVENUE.");
        const r = await api<{ Accounts: any[] }>(c, `/Accounts${query({ where: ['Status=="ACTIVE"', ...(type ? [`Type=="${type}"`] : [])].join(" AND "), order: "Code ASC" })}`);
        return (r.Accounts ?? []).slice(0, 300).map((a) => `${plain(a.Code || "(no code)", 20)} · ${plain(a.Name, 120)} · ${plain(a.Type, 30).toLowerCase()}`).join("\n") || "No accounts match.";
      },
    },
    {
      name: "profit_and_loss",
      kind: "read",
      summary: "See profit and loss for a period",
      description: "Returns the profit and loss report between two dates (the current month when left out): income, costs and profit, by account.",
      properties: { from: { type: "string", description: "First day, like 2026-11-01." }, to: { type: "string", description: "Last day, like 2026-11-30." } },
      async run(c, input) {
        if (Boolean(input.from) !== Boolean(input.to)) throw new Error("Give both the first and the last day, or neither for the current month.");
        const r = await api<{ Reports: any[] }>(c, `/Reports/ProfitAndLoss${query(input.from ? { fromDate: isDay(input.from, "the first day"), toDate: isDay(input.to, "the last day") } : {})}`);
        return reportText(r.Reports?.[0]) || "Xero returned an empty report.";
      },
    },
    {
      name: "balance_sheet",
      kind: "read",
      summary: "See the balance sheet on a date",
      description: "Returns the balance sheet as at a date (today when left out): assets, liabilities and equity, by account.",
      properties: { date: { type: "string", description: "The day, like 2026-11-30." } },
      async run(c, input) {
        const r = await api<{ Reports: any[] }>(c, `/Reports/BalanceSheet${query(input.date ? { date: isDay(input.date, "the day") } : {})}`);
        return reportText(r.Reports?.[0]) || "Xero returned an empty report.";
      },
    },
  ],
};
