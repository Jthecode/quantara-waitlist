import "dotenv/config";
import { Client } from "pg";
const c = new Client({ connectionString: process.env.DATABASE_URL!, ssl: { rejectUnauthorized: false }});
await c.connect();
const r = await c.query("select now(), current_database() db, current_user usr");
console.table(r.rows);
await c.end();
