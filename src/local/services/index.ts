// The services built on the connector kit. Importing this file registers them.
import { registerServices, type ServiceDef } from "../connector-kit.ts";
import { asana } from "./asana.ts";
import { calendly } from "./calendly.ts";
import { hubspot } from "./hubspot.ts";
import { mailchimp } from "./mailchimp.ts";
import { slackService } from "./slack.ts";
import { trello } from "./trello.ts";
import { typeform } from "./typeform.ts";
import { woocommerce } from "./woocommerce.ts";

export const SERVICES: ServiceDef[] = [woocommerce, hubspot, mailchimp, slackService, asana, trello, calendly, typeform];
registerServices(...SERVICES);
