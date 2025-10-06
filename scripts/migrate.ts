import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

const client = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false }});
await client.connect();
await migrate(drizzle(client), { migrationsFolder: "db/migrations" });
await client.end();
console.log("✅ migrations applied");
