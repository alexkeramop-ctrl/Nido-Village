import { renderCalendar } from "../events/render";

export const dynamic = "force-dynamic";

export default async function Page(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return renderCalendar("parties", props);
}
