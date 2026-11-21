import { redirect } from "next/navigation";

/** Παλιός σύνδεσμος: οι εκδρομές είναι πλέον φίλτρο του γενικού ημερολογίου. */
export default function OldTripsPage() {
  redirect("/pda/calendar?s=trips");
}
