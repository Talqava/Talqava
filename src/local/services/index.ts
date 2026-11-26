// The services built on the connector kit. Importing this file registers them.
import { registerServices, type ServiceDef } from "../connector-kit.ts";
import { asana } from "./asana.ts";
import { calendly } from "./calendly.ts";
import { gmail, googleCalendar, googleDrive } from "./google.ts";
import { hubspot } from "./hubspot.ts";
import { mailchimp } from "./mailchimp.ts";
import { onedrive, outlook } from "./microsoft.ts";
import { shopify } from "./shopify.ts";
import { slackService } from "./slack.ts";
import { trello } from "./trello.ts";
import { typeform } from "./typeform.ts";
import { woocommerce } from "./woocommerce.ts";

export const SERVICES: ServiceDef[] = [gmail, googleCalendar, googleDrive, outlook, onedrive, shopify, woocommerce, hubspot, mailchimp, slackService, asana, trello, calendly, typeform];
registerServices(...SERVICES);
