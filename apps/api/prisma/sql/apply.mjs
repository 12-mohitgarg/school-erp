/**
 * Applies the raw SQL files in this folder that Prisma's migration engine
 * cannot express (PostGIS generated columns, triggers, functions).
 *
 * Idempotent — every statement uses CREATE OR REPLACE / IF NOT EXISTS, so this
 * is safe to re-run after each `prisma migrate`.
 *
 *   node prisma/sql/apply.mjs
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Split a script into individual statements.
 *
 * A naive split on `;` is wrong three ways, all of which appear in these files:
 *   * `$$ ... $$` plpgsql bodies are full of semicolons;
 *   * `--` line comments contain prose semicolons;
 *   * single-quoted literals can contain semicolons.
 * Each is skipped over rather than split on.
 */
function splitStatements(sql) {
  const statements = [];
  let current = '';
  let i = 0;

  while (i < sql.length) {
    // Dollar-quoted body: copy through verbatim to the closing tag.
    if (sql.startsWith('$$', i)) {
      const end = sql.indexOf('$$', i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      current += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // Line comment: drop it, but keep the newline so tokens stay separated.
    if (sql.startsWith('--', i)) {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl + 1;
      current += '\n';
      continue;
    }

    // Single-quoted literal, honouring '' escaping.
    if (sql[i] === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j += 1; break; }
        j += 1;
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }

    if (sql[i] === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      i += 1;
      continue;
    }

    current += sql[i];
    i += 1;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

/** Neon suspends idle branches; the first connection can time out while it wakes. */
async function withRetry(fn, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const coldStart = /Can't reach database server|Connection terminated/i.test(String(err.message));
      if (!coldStart || attempt === attempts) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL } },
});

try {
  const files = (await readdir(here)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = await readFile(join(here, file), 'utf8');
    const statements = splitStatements(sql);

    process.stdout.write(`\n${file} — ${statements.length} statements\n`);

    let applied = 0;
    for (const statement of statements) {
      try {
        await withRetry(() => prisma.$executeRawUnsafe(statement));
        applied += 1;
      } catch (err) {
        const first = String(err.message).split('\n').find((l) => l.includes('ERROR')) ?? err.message;
        process.stdout.write(`  ! ${statement.slice(0, 70).replace(/\s+/g, ' ')}...\n    ${first.trim()}\n`);
      }
    }
    process.stdout.write(`  applied ${applied}/${statements.length}\n`);
  }

  // Confirm the spatial machinery actually landed.
  const checks = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT count(*) FROM pg_extension WHERE extname = 'postgis')                      AS postgis,
      (SELECT count(*) FROM information_schema.columns
        WHERE table_name = 'location_pings' AND column_name = 'geom')                    AS ping_geom,
      (SELECT count(*) FROM information_schema.columns
        WHERE table_name = 'geofences' AND column_name IN ('center_geom','area_geom'))   AS fence_geom,
      (SELECT count(*) FROM pg_proc WHERE proname = 'erp_geofences_containing')          AS fn_containing,
      (SELECT count(*) FROM pg_proc WHERE proname = 'erp_purge_location_history')        AS fn_purge
  `);

  process.stdout.write(`\nVerification: ${JSON.stringify(checks[0], (_k, v) => (typeof v === 'bigint' ? Number(v) : v))}\n`);
} finally {
  await prisma.$disconnect();
}
