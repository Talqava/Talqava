// Calendly: booked meetings and booking links. Facts from Calendly's developer documentation, read November 2026:
// developer.calendly.com/docs/authentication/how-to-authenticate-with-personal-access-tokens, /docs/authentication/scopes,
// and the reference for the current user, scheduled events, invitees and event types. Reading only: Talqava does not
// cancel or book meetings.
import { baseOf, call, count, plain, query, type Connection, type ServiceDef } from "../connector-kit.ts";

const api = <T = any>(c: Pick<Connection, "values">, path: string) => call<T>(`${baseOf("calendly", "https://api.calendly.com")}${path}`, { name: "Calendly", headers: { authorization: `Bearer ${c.values.token}` } });
const uuid = (v: unknown) => {
  const t = String(v ?? "").split("/").pop() ?? "";
  if (!/^[A-Za-z0-9-]{8,60}$/.test(t)) throw new Error("Give the meeting's number in brackets, from list_meetings.");
  return t;
};
const time = (t: unknown) => String(t ?? "").slice(0, 16).replace("T", " ");

export const calendly: ServiceDef = {
  id: "calendly",
  name: "Calendly",
  category: "Email and calendar",
  about: "See the meetings people have booked with you on Calendly, who booked them, and your booking links.",
  steps: [
    "In Calendly, open your profile menu, then Developer › Personal access tokens, and press Create personal access token. Name it Talqava.",
    "Choose the scopes users:read, scheduled_events:read and event_types:read, and press Create.",
    "Enter the code Calendly emails you, then copy the token and paste it below. Calendly shows it only once.",
  ],
  docs: "https://developer.calendly.com/docs/authentication/how-to-authenticate-with-personal-access-tokens",
  fields: [{ key: "token", label: "Personal access token", secret: true }],
  async check(values) {
    const me = (await api<{ resource: { uri: string; name: string; email: string } }>({ values }, "/users/me")).resource;
    return { label: me.email ? `${me.name} (${me.email})` : me.name, values: { user: me.uri } };
  },
  triggers: [
    {
      name: "new_booking",
      summary: "Someone books a meeting",
      list: async (c) => (await api<{ collection: any[] }>(c, `/scheduled_events${query({ user: c.values.user, status: "active", min_start_time: new Date().toISOString(), sort: "start_time:asc", count: 100 })}`)).collection.map((e) => String(e.uri).split("/").pop()!),
      async describe(c, meeting) {
        const text = await calendly.actions.find((a) => a.name === "get_meeting")!.run(c as Connection, { meeting });
        return { title: `Booking: ${text.split(" · ")[0]}`, text };
      },
    },
  ],
  actions: [
    {
      name: "list_meetings",
      kind: "read",
      summary: "See booked meetings",
      description: "Lists the owner's booked meetings in start-time order. By default the upcoming ones; give from and to (dates) for another period, or cancelled to see cancelled ones. Times are in UTC.",
      properties: { from: { type: "string", description: "A date like 2026-12-01. Today when left out." }, to: { type: "string" }, cancelled: { type: "boolean" }, limit: { type: "number", description: "How many, at most 50. Usually 20." } },
      async run(c, input) {
        const day = (v: unknown, end = false) => `${String(v).slice(0, 10)}T${end ? "23:59:59" : "00:00:00"}.000000Z`;
        const r = await api<{ collection: any[] }>(c, `/scheduled_events${query({ user: c.values.user, status: input.cancelled ? "canceled" : "active", min_start_time: input.from ? day(input.from) : new Date().toISOString(), max_start_time: input.to ? day(input.to, true) : undefined, sort: "start_time:asc", count: count(input.limit, 20, 50) })}`);
        return r.collection.map((e) => `[${String(e.uri).split("/").pop()}] ${time(e.start_time)} to ${time(e.end_time).slice(11)} UTC · ${plain(e.name, 120)} · ${e.status}${e.invitees_counter?.total ? ` · ${e.invitees_counter.total} invitee${e.invitees_counter.total === 1 ? "" : "s"}` : ""}`).join("\n") || "No meetings in that period.";
      },
    },
    {
      name: "get_meeting",
      kind: "read",
      summary: "Read one meeting and who booked it",
      description: "Returns one meeting with the people who booked it: their names, email addresses and the answers they gave when booking.",
      properties: { meeting: { type: "string", description: "The meeting's number in brackets, from list_meetings." } },
      required: ["meeting"],
      async run(c, input) {
        const id = uuid(input.meeting);
        const [e, inv] = await Promise.all([api<{ resource: any }>(c, `/scheduled_events/${id}`), api<{ collection: any[] }>(c, `/scheduled_events/${id}/invitees${query({ count: 50 })}`)]);
        const m = e.resource;
        const where = m.location?.join_url || m.location?.location || m.location?.type || "";
        return [
          `${plain(m.name, 120)} · ${time(m.start_time)} to ${time(m.end_time).slice(11)} UTC · ${m.status}`,
          where ? `Where: ${plain(where, 200)}` : "",
          ...inv.collection.map((p) => `- ${plain(p.name, 100)} <${p.email}> · ${p.status}${p.timezone ? ` · ${p.timezone}` : ""}${(p.questions_and_answers ?? []).map((q: any) => `\n    ${plain(q.question, 120)}: ${plain(q.answer, 400)}`).join("")}`),
        ].filter(Boolean).join("\n");
      },
    },
    {
      name: "list_booking_links",
      kind: "read",
      summary: "See your booking links",
      description: "Lists the owner's active event types with their booking links, to share with someone who should book a time.",
      properties: {},
      async run(c) {
        const r = await api<{ collection: any[] }>(c, `/event_types${query({ user: c.values.user, active: true, count: 50 })}`);
        return r.collection.map((t) => `${plain(t.name, 120) || "(no name)"}${t.duration ? ` · ${t.duration} min` : ""}${t.scheduling_url ? ` · ${t.scheduling_url}` : ""}`).join("\n") || "No active event types.";
      },
    },
  ],
};
