// The services built on the connector kit. Importing this file registers them.
import { registerServices, type ServiceDef } from "../connector-kit.ts";
import { asana } from "./asana.ts";
import { slackService } from "./slack.ts";
import { woocommerce } from "./woocommerce.ts";

export const SERVICES: ServiceDef[] = [woocommerce, slackService, asana];
registerServices(...SERVICES);
