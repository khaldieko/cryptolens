import fs from "fs";
import path from "path";
import { pool } from "./db";

async function main() {
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    console.log(`Running ${f}...`);
    await pool.query(sql);
  }
  console.log("Migrations complete.");
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
