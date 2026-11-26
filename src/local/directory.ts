// The integrations directory: every service Talqava connects to or plans to, filed under plain categories, each with
// one line on what agents could do with it. The Integrations page is drawn from this, so a person can find any
// service in one place and see honestly whether it is connected, available or still coming.
//
// A "coming" entry promises nothing about how it will connect: that is checked against the service's own
// documentation when it is built.

/** The categories, in the order they are shown, named for what a business owner is trying to do. */
export const DIRECTORY_CATEGORIES = [
  "Email and calendar",
  "Files and documents",
  "Team chat",
  "Websites and content",
  "Social media",
  "Email marketing",
  "Sales and customer records",
  "Customer support",
  "Payments and online shop",
  "Accounting and invoices",
  "Projects and tasks",
  "Forms and surveys",
  "People and hiring",
  "Code and technical",
  "AI models",
  "Advanced",
] as const;
export type DirectoryCategory = (typeof DIRECTORY_CATEGORIES)[number];

/** Where each built integration is filed. Catalogue connectors are filed by their own id. */
export const FILED_UNDER: Record<string, DirectoryCategory> = {
  "ai-models": "AI models",
  openrouter: "AI models",
  wordpress: "Websites and content",
  git: "Code and technical",
  mcp: "Advanced",
  "api-keys": "Advanced",
  langfuse: "Advanced",
  stripe: "Payments and online shop",
  airtable: "Sales and customer records",
  monday: "Sales and customer records",
  intercom: "Customer support",
  linear: "Projects and tasks",
  github: "Code and technical",
};

export interface ComingService {
  name: string;
  category: DirectoryCategory;
  /** What an agent could do with it, in one line. */
  about: string;
}

/** Services that are planned and not built yet. Shown so nobody has to wonder. */
export const COMING_SERVICES: ComingService[] = [
  { name: "Gmail", category: "Email and calendar", about: "Read, search and draft email, and send it with your approval." },
  { name: "Google Calendar", category: "Email and calendar", about: "See your schedule, find free time, and add or move events." },
  { name: "Outlook (Microsoft 365)", category: "Email and calendar", about: "Read, draft and send email, and manage the calendar." },
  { name: "Calendly", category: "Email and calendar", about: "See booked meetings and share booking links." },
  { name: "Google Drive", category: "Files and documents", about: "Find, read and save files and folders." },
  { name: "Google Docs and Sheets", category: "Files and documents", about: "Read and write documents and spreadsheets." },
  { name: "SharePoint", category: "Files and documents", about: "Find, read and save the files of your team sites." },
  { name: "Dropbox", category: "Files and documents", about: "Find, read and save files." },
  { name: "Box", category: "Files and documents", about: "Find, read and save files." },
  { name: "Slack", category: "Team chat", about: "Read channels, post updates and answer questions." },
  { name: "Microsoft Teams", category: "Team chat", about: "Post updates and read channel messages." },
  { name: "Discord", category: "Team chat", about: "Post to and read from a server." },
  { name: "Telegram", category: "Team chat", about: "Send and receive messages." },
  { name: "WhatsApp Business", category: "Team chat", about: "Answer customers on WhatsApp." },
  { name: "Webflow", category: "Websites and content", about: "Update site content and blog items." },
  { name: "Ghost", category: "Websites and content", about: "Write and publish posts and newsletters." },
  { name: "Medium", category: "Websites and content", about: "Publish articles." },
  { name: "LinkedIn", category: "Social media", about: "Post to your profile or company page." },
  { name: "X", category: "Social media", about: "Post and reply." },
  { name: "Facebook and Instagram", category: "Social media", about: "Post to your Page and account, and read comments." },
  { name: "YouTube", category: "Social media", about: "Read channel figures and comments, and update video details." },
  { name: "Mailchimp", category: "Email marketing", about: "Manage your audience and draft campaigns." },
  { name: "Klaviyo", category: "Email marketing", about: "Manage lists and draft campaigns for a shop." },
  { name: "Brevo", category: "Email marketing", about: "Manage contacts and send campaigns." },
  { name: "HubSpot", category: "Sales and customer records", about: "Find and update contacts, companies and deals." },
  { name: "Salesforce", category: "Sales and customer records", about: "Find and update leads, accounts and opportunities." },
  { name: "Pipedrive", category: "Sales and customer records", about: "Find and update deals and contacts." },
  { name: "Zendesk", category: "Customer support", about: "Read, answer and update support tickets." },
  { name: "Freshdesk", category: "Customer support", about: "Read, answer and update support tickets." },
  { name: "Help Scout", category: "Customer support", about: "Read and answer customer conversations." },
  { name: "Shopify", category: "Payments and online shop", about: "See orders, products and customers, and update products." },
  { name: "WooCommerce", category: "Payments and online shop", about: "See orders and products on a WordPress shop." },
  { name: "Square", category: "Payments and online shop", about: "See sales, customers and catalogue items." },
  { name: "PayPal", category: "Payments and online shop", about: "See payments and send invoices." },
  { name: "QuickBooks", category: "Accounting and invoices", about: "See invoices, bills and reports, and draft invoices." },
  { name: "Xero", category: "Accounting and invoices", about: "See invoices, bills and reports, and draft invoices." },
  { name: "FreshBooks", category: "Accounting and invoices", about: "See and draft invoices and expenses." },
  { name: "Asana", category: "Projects and tasks", about: "Read and update tasks and projects." },
  { name: "Trello", category: "Projects and tasks", about: "Read and move cards on your boards." },
  { name: "Jira", category: "Projects and tasks", about: "Read and update issues." },
  { name: "ClickUp", category: "Projects and tasks", about: "Read and update tasks." },
  { name: "Todoist", category: "Projects and tasks", about: "Read and add to-dos." },
  { name: "Google Forms", category: "Forms and surveys", about: "Read form answers." },
  { name: "Typeform", category: "Forms and surveys", about: "Read form answers." },
  { name: "Tally", category: "Forms and surveys", about: "Read form answers." },
  { name: "Gusto", category: "People and hiring", about: "See team and payroll details." },
  { name: "BambooHR", category: "People and hiring", about: "See employee records and time off." },
  { name: "GitLab", category: "Code and technical", about: "Read and update issues and merge requests." },
];
