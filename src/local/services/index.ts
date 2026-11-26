// The services built on the connector kit. Importing this file registers them.
import { registerServices, type ServiceDef } from "../connector-kit.ts";
import { asana } from "./asana.ts";
import { calendly } from "./calendly.ts";
import { clickup } from "./clickup.ts";
import { gitlab } from "./gitlab.ts";
import { gmail, googleCalendar, googleDrive } from "./google.ts";
import { hubspot } from "./hubspot.ts";
import { jira } from "./jira.ts";
import { klaviyo } from "./klaviyo.ts";
import { mailchimp } from "./mailchimp.ts";
import { onedrive, outlook } from "./microsoft.ts";
import { pipedrive } from "./pipedrive.ts";
import { slackService } from "./slack.ts";
import { square } from "./square.ts";
import { todoist } from "./todoist.ts";
import { trello } from "./trello.ts";
import { typeform } from "./typeform.ts";
import { xero } from "./xero.ts";
import { zendesk } from "./zendesk.ts";

export const SERVICES: ServiceDef[] = [gmail, googleCalendar, googleDrive, outlook, onedrive, hubspot, mailchimp, slackService, asana, trello, calendly, typeform, zendesk, gitlab, xero, pipedrive, todoist, jira, clickup, klaviyo, square];
registerServices(...SERVICES);
