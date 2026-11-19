// Ενσωματώνει τα SQL migrations (drizzle/) σε module, ώστε να τρέχουν και χωρίς δίσκο (Cloudflare Workers).
// Τρέχει αυτόματα πριν από το build για Cloudflare (npm run build:cf).
import { writeFileSync } from "node:fs";
import { readMigrationFiles } from "drizzle-orm/migrator";

const migrations = readMigrationFiles({ migrationsFolder: "drizzle" });
const out = `// ΑΥΤΟΜΑΤΟ ΑΡΧΕΙΟ από scripts/embed-migrations.mjs — μην το αλλάζετε με το χέρι.\nexport const embeddedMigrations = ${JSON.stringify(migrations)};\n`;
writeFileSync("src/db/migrations.generated.ts", out);
console.log(`[embed-migrations] ${migrations.length} migrations -> src/db/migrations.generated.ts`);
