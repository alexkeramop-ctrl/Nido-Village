import { beforeAll, describe, expect, it } from "vitest";
import { seeded, employeeByName } from "./helpers";
import { conflictingEvents, deleteEvent, listEvents, setEventStatus, upcomingEvents, upsertEvent } from "@/server/services/events";
import { listAreas } from "@/server/services/floor";
import { todayAthens, addDays } from "@/server/services/reports";

let admin: { id: number };
beforeAll(async () => {
  await seeded();
  admin = await employeeByName("Αλέξης");
});

describe("events calendar", () => {
  it("creates, lists, detects conflicts, changes status and deletes", async () => {
    const areas = await listAreas();
    const paidiki = areas.find((a) => a.name === "Παιδική")!;
    const today = todayAthens();
    const d = addDays(today, 3);
    await expect(upsertEvent({ title: "", type: "party", date: d }, admin.id)).rejects.toThrow(/τίτλος/);
    await expect(upsertEvent({ title: "x", type: "party", date: "2026-13-40" }, admin.id)).rejects.toThrow(/ημερομηνία/);
    const party = await upsertEvent(
      { title: "Πάρτι γενεθλίων Μάριος", type: "party", date: d, startTime: "17:00", endTime: "20:00", guests: 25, areaId: paidiki.id, customerName: "Μαρία Κ.", customerPhone: "6900000000", priceCents: 25000, depositCents: 5000 },
      admin.id,
    );
    expect(party.status).toBe("inquiry");
    const wedding = await upsertEvent({ title: "Γάμος Νίκου & Άννας", type: "wedding", date: addDays(today, 10), startTime: "19:00", endTime: "23:59", guests: 180, priceCents: 900000, status: "confirmed" }, admin.id);
    expect(wedding.status).toBe("confirmed");

    const conflicts = await conflictingEvents({ date: d, startTime: "18:00", endTime: "19:00", areaId: paidiki.id });
    expect(conflicts.map((c) => c.id)).toEqual([party.id]);
    expect(await conflictingEvents({ date: d, startTime: "20:00", endTime: "22:00", areaId: paidiki.id })).toHaveLength(0);
    expect(await conflictingEvents({ date: d, startTime: "18:00", endTime: "19:00", areaId: areas.find((a) => a.name === "Κέντρο")!.id })).toHaveLength(0);

    const list = await listEvents(today, addDays(today, 30));
    expect(list.map((e) => e.title)).toEqual([party.title, wedding.title]);
    expect((await upcomingEvents(5)).map((e) => e.id)).toEqual([party.id]);

    await setEventStatus(party.id, "cancelled", admin.id);
    expect((await listEvents(today, addDays(today, 30))).map((e) => e.id)).toEqual([wedding.id]);
    expect((await listEvents(today, addDays(today, 30), { includeCancelled: true })).length).toBe(2);
    await deleteEvent(party.id, admin.id);
    await expect(deleteEvent(party.id, admin.id)).rejects.toThrow();
  });

  it("filters by type, for the PDA school-trip calendar", async () => {
    const today = todayAthens();
    const d = addDays(today, 40);
    const trip = await upsertEvent({ title: "3ο Δημοτικό Θέρμης", type: "school_trip", date: d, startTime: "10:00", endTime: "13:00", guests: 52, status: "confirmed" }, admin.id);
    const cancelledTrip = await upsertEvent({ title: "Γυμνάσιο Βασιλικών", type: "school_trip", date: d, startTime: "11:00", endTime: "14:00", guests: 30, status: "cancelled" }, admin.id);
    const party = await upsertEvent({ title: "Πάρτι Ελένης", type: "party", date: d, startTime: "17:00", endTime: "20:00", guests: 20 }, admin.id);

    const trips = await listEvents(d, d, { type: "school_trip" });
    expect(trips.map((e) => e.id)).toEqual([trip.id]);
    expect((await listEvents(d, d, { type: "school_trip", includeCancelled: true })).map((e) => e.id)).toEqual([trip.id, cancelledTrip.id]);
    expect((await listEvents(d, d)).map((e) => e.id)).toEqual([trip.id, party.id]);

    for (const e of [trip, cancelledTrip, party]) await deleteEvent(e.id, admin.id);
  });
});
