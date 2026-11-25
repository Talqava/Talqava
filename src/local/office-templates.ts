// Ready-made Office files: documents and sheets a small business starts from, so nobody faces a blank page.
// Each is plain Markdown or sheet text; placeholders are in [SQUARE BRACKETS] for the owner to replace.
import type { Org } from "./orgs.ts";
import { workspace } from "./workspace.ts";
import type { Page } from "./workspace.ts";

export interface OfficeTemplate {
  id: string;
  kind: "doc" | "sheet" | "note";
  name: string;
  summary: string;
  folder: string;
  /** A Workspace page this file is meant to be filled from, by name, when there is one. */
  uses?: string;
  text: string;
}

export const OFFICE_TEMPLATES: OfficeTemplate[] = [
  {
    id: "proposal",
    kind: "doc",
    name: "Proposal",
    summary: "A one-page proposal: what the customer asked for, what you will do, the price and next steps.",
    folder: "Customers",
    uses: "Price list",
    text: `Prepared by [YOUR COMPANY] for [CUSTOMER] · valid for 30 days

## What you asked for

[One or two sentences in the customer's own words.]

## What we will do

- [First thing]
- [Second thing]

## Price

| Item | Unit | Price |
| --- | --- | --- |
| [Item] | [each / per month] | [YOUR PRICE] |

Prices exclude tax. [Any discount, and the reason for it.]

## Next steps

Reply to accept, and we will confirm a start date within [NUMBER] working days.
`,
  },
  {
    id: "quote",
    kind: "doc",
    name: "Quote",
    summary: "A short quote with items, quantities, a total and how long it stands.",
    folder: "Customers",
    uses: "Price list",
    text: `Quote [NUMBER] · [DATE] · for [CUSTOMER]

| Item | Quantity | Unit price | Line total |
| --- | --- | --- | --- |
| [Item] | [N] | [YOUR PRICE] | [TOTAL] |

**Total before tax:** [TOTAL]
**Tax:** [TAX]
**Total:** [TOTAL]

This quote is valid until [DATE]. To accept, reply to this message.
`,
  },
  {
    id: "payment-reminder",
    kind: "doc",
    name: "Payment reminder letter",
    summary: "A polite first reminder for an invoice that is overdue.",
    folder: "Finance",
    text: `Dear [NAME],

Our invoice [NUMBER] for [AMOUNT], dated [DATE], was due on [DATE] and we have not yet received payment.

If you have already paid, thank you, and please ignore this note. If not, could you let us know when we can expect it? You can pay by [HOW TO PAY].

If anything about the invoice is not right, tell us and we will sort it out.

Kind regards,
[YOUR NAME]
[YOUR COMPANY]
`,
  },
  {
    id: "meeting-notes",
    kind: "note",
    name: "Meeting notes",
    summary: "Who was there, what was decided, and who does what by when.",
    folder: "Meetings",
    text: `**With:** [NAMES] · **Date:** [DATE]

## Decided

- [Decision]

## To do

- [ ] [What] · [who] · by [when]
- [ ] [What] · [who] · by [when]

## Notes

[Anything else worth keeping.]
`,
  },
  {
    id: "budget",
    kind: "sheet",
    name: "Monthly budget",
    summary: "Income and costs for one month, with planned and actual amounts and the difference worked out.",
    folder: "Finance",
    text: `!sheet Budget
!lock A1:D1
!fmt B2:D12 money
A1\tLine
B1\tPlanned
C1\tActual
D1\tDifference
A2\tSales
D2\t=C2-B2
A3\tOther income
D3\t=C3-B3
A4\tTotal income
B4\t=SUM(B2:B3)
C4\t=SUM(C2:C3)
D4\t=C4-B4
A6\tPayroll
D6\t=B6-C6
A7\tRent and utilities
D7\t=B7-C7
A8\tSupplies
D8\t=B8-C8
A9\tMarketing
D9\t=B9-C9
A10\tTotal costs
B10\t=SUM(B6:B9)
C10\t=SUM(C6:C9)
D10\t=B10-C10
A12\tLeft over
B12\t=B4-B10
C12\t=C4-C10
D12\t=C12-B12
`,
  },
  {
    id: "cash-forecast",
    kind: "sheet",
    name: "Cash forecast",
    summary: "Three months of cash in and out, with the cash left at the end of each month and a chart.",
    folder: "Finance",
    text: `!sheet Forecast
!lock A1:E1
!lock A8:E8
!fmt B2:E8 money
!chart bar B8:D8 Cash at the end of each month
A1\tLine
B1\tMonth 1
C1\tMonth 2
D1\tMonth 3
E1\tQuarter
A2\tCash at start
C2\t=B8
D2\t=C8
E2\t=B2
A3\tPayroll
E3\t=SUM(B3:D3)
A4\tRent and utilities
E4\t=SUM(B4:D4)
A5\tSupplies
E5\t=SUM(B5:D5)
A6\tMoney in from customers
E6\t=SUM(B6:D6)
A7\tTax set aside
E7\t=SUM(B7:D7)
A8\tCash at end
B8\t=B2+B6-SUM(B3:B5)-B7
C8\t=C2+C6-SUM(C3:C5)-C7
D8\t=D2+D6-SUM(D3:D5)-D7
E8\t=D8
`,
  },
];

export function listOfficeTemplates() {
  return OFFICE_TEMPLATES.map(({ text, ...t }) => ({ ...t, lines: text.split("\n").filter(Boolean).length }));
}

/** A new file from a template. Deleting the file undoes it. */
export function useOfficeTemplate(org: Org, id: string): Page {
  const t = OFFICE_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error("There is no such template.");
  return workspace.create(org, null, { kind: t.kind, title: t.name, folder: t.folder, markdown: t.text });
}
