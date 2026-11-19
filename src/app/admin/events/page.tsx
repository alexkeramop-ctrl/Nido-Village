import { renderCalendar, type SP } from "./render";

export const dynamic = "force-dynamic";

export default async function EventsPage(props: SP) {
  return renderCalendar("all", props);
}
