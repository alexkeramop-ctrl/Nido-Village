/** Άμεση ανταπόκριση στην πλοήγηση: εμφανίζεται αμέσως όσο φορτώνει η σελίδα. */
export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse" aria-busy="true" aria-label="Φόρτωση">
      <div className="h-8 w-56 rounded-xl bg-surface-3" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card h-24" />
        ))}
      </div>
      <div className="card h-72" />
    </div>
  );
}
