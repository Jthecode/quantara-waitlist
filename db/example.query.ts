/* Quantara • Devnet-0 • example query (local dev helper) */

import { getDb } from './client.node.js';   // ← add .js
import { userAccount } from './schema.js';  // ← add .js

async function main() {
  const db = await getDb();
  const users = await db.select().from(userAccount).limit(5);
  console.log(users);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
