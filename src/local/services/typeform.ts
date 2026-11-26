// Typeform: forms and the answers people give. Facts from Typeform's developer documentation, read November 2026:
// typeform.com/developers/get-started/personal-access-token and /scopes, and the reference for retrieving forms, one
// form and responses. Reading only. Accounts stored in the EU use a different address, chosen when connecting.
import { call, count, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

const HOSTS: Record<string, string> = { us: "https://api.typeform.com", eu: "https://api.eu.typeform.com", eu2: "https://api.typeform.eu" };
const base = (c: Pick<Connection, "values">) => (process.env.TALQAVA_TYPEFORM_API || HOSTS[c.values.region] || HOSTS.us).replace(/\/+$/, "");
const api = <T = any>(c: Pick<Connection, "values">, path: string) => call<T>(`${base(c)}${path}`, { name: "Typeform", headers: { authorization: `Bearer ${c.values.token}` } });
const formId = (v: unknown) => {
  const t = String(v ?? "");
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(t)) throw new Error("Give the form's number in brackets, from list_forms.");
  return t;
};
/** One answer as words, whatever its type. */
const answerText = (a: any): string => {
  const v = a[a.type];
  if (v == null) return "";
  if (typeof v !== "object") return plain(v, 1000);
  if (Array.isArray(v.labels)) return plain(v.labels.join(", "), 1000);
  return plain(v.label ?? v.other ?? JSON.stringify(v), 1000);
};

/** Responses in words: each with when it was sent and every question beside its answer. */
function answersText(form: { fields?: any[] }, items: any[]): string {
  const titles = new Map<string, string>();
  const walk = (fields: any[] = []) => fields.forEach((f) => (titles.set(f.id, plain(f.title, 200)), walk(f.properties?.fields)));
  walk(form.fields);
  return items.map((it) => `Sent ${String(it.submitted_at ?? "").slice(0, 16).replace("T", " ")}\n${(it.answers ?? []).map((a: any) => `- ${titles.get(a.field?.id) ?? "Question"}: ${answerText(a)}`).join("\n")}`).join("\n\n");
}

export const typeform: ServiceDef = {
  id: "typeform",
  name: "Typeform",
  category: "Forms and surveys",
  about: "Read your Typeform forms and the answers people have sent.",
  steps: [
    "In Typeform, open the menu beside your name, choose Account, then Personal tokens, and press Generate a new token. Name it Talqava.",
    "Choose the scopes accounts:read, forms:read and responses:read, and press Generate token.",
    "Copy the token (it starts with tfp_) and paste it below.",
  ],
  docs: "https://www.typeform.com/developers/get-started/personal-access-token/",
  fields: [{ key: "token", label: "Personal token", secret: true, placeholder: "tfp_…" }],
  async check(values) {
    // The account may be stored in the US or in one of Typeform's two EU locations: the one that accepts the token is kept.
    let last: unknown;
    for (const region of process.env.TALQAVA_TYPEFORM_API ? ["us"] : ["us", "eu", "eu2"]) {
      try {
        const forms = await api<{ total_items: number }>({ values: { ...values, region } }, `/forms${query({ page_size: 1 })}`);
        return { label: `${forms.total_items} form${forms.total_items === 1 ? "" : "s"}${region === "us" ? "" : " (EU)"}`, values: { region } };
      } catch (err) {
        last = err;
        if (!(err as { refused?: boolean }).refused) throw err;
      }
    }
    throw last;
  },
  triggers: [
    {
      name: "new_answer",
      summary: "Someone sends in a form",
      param: { label: "Which form (its number, from the form's address)", placeholder: "abc123", required: true },
      list: async (c, form) => (await api<{ items: any[] }>(c, `/forms/${formId(form)}/responses${query({ page_size: 25 })}`)).items.map((it) => String(it.response_id ?? it.token)),
      async describe(c, id, form) {
        const [def, r] = await Promise.all([api<{ title: string; fields?: any[] }>(c, `/forms/${formId(form)}`), api<{ items: any[] }>(c, `/forms/${formId(form)}/responses${query({ included_response_ids: id })}`)]);
        return { title: `${plain(def.title, 100)}: a new answer`, text: answersText(def, r.items) };
      },
    },
  ],
  actions: [
    {
      name: "list_forms",
      kind: "read",
      summary: "See your forms",
      description: "Lists the forms, most recently changed first. Give words to search their titles.",
      properties: { search: { type: "string" }, limit: { type: "number", description: "How many, at most 100. Usually 30." } },
      async run(c, input) {
        const r = await api<{ items: any[] }>(c, `/forms${query({ search: input.search, page_size: count(input.limit, 30, 100), sort_by: "last_updated_at", order_by: "desc" })}`);
        return r.items.map((f) => `[${f.id}] ${plain(f.title, 160)} · changed ${String(f.last_updated_at ?? "").slice(0, 10)}${f._links?.display ? ` · ${f._links.display}` : ""}`).join("\n") || "No forms.";
      },
    },
    {
      name: "read_answers",
      kind: "read",
      summary: "Read the answers people sent to a form",
      description: "Returns completed responses to a form, newest first, each with its questions and answers. Narrow with since and until (dates) or words. Answers from the last half hour may not be there yet.",
      properties: { form: { type: "string", description: "The form's number in brackets, from list_forms." }, since: { type: "string", description: "A date like 2026-11-01." }, until: { type: "string" }, words: { type: "string" }, limit: { type: "number", description: "How many responses, at most 100. Usually 20." } },
      required: ["form"],
      async run(c, input) {
        const id = formId(input.form);
        const day = (v: unknown, end = false) => `${String(v).slice(0, 10)}T${end ? "23:59:59" : "00:00:00"}Z`;
        const [form, r] = await Promise.all([
          api<{ title: string; fields?: any[] }>(c, `/forms/${id}`),
          api<{ total_items: number; items: any[] }>(c, `/forms/${id}/responses${query({ page_size: count(input.limit, 20, 100), since: input.since ? day(input.since) : undefined, until: input.until ? day(input.until, true) : undefined, query: input.words })}`),
        ]);
        if (!r.items.length) return `No responses to “${plain(form.title, 160)}” in that period.`;
        return `${plain(form.title, 160)}: ${r.total_items} response${r.total_items === 1 ? "" : "s"} in all, showing ${r.items.length}.\n\n${answersText(form, r.items)}`;
      },
    },
  ],
};
