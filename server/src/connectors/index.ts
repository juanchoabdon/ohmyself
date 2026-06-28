import { googleCalendarConnector } from "./google-calendar.js";
import type { Connector } from "./types.js";

/** Registry of available connectors. Add new integrations here. */
export const connectors: Record<string, Connector<never>> = {
  [googleCalendarConnector.id]: googleCalendarConnector as Connector<never>,
};

export function getConnector(id: string): Connector<never> | undefined {
  return connectors[id];
}

export * from "./types.js";
export { googleCalendarConnector } from "./google-calendar.js";
