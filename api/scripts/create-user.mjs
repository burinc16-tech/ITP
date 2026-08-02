#!/usr/bin/env node
/**
 * Seed a user account (task 4). Auth has no open registration, so accounts are
 * created out-of-band by an admin with this script. It hashes the password with
 * the SAME PBKDF2 scheme the Worker uses and prints an INSERT you apply to D1.
 *
 * Usage:
 *   node api/scripts/create-user.mjs <email> <name> <role> <password>
 *   # role is site_engineer or qa_qc
 *
 * Apply locally:
 *   node api/scripts/create-user.mjs jo@site.co "Jo Lee" qa_qc 's3cret' \
 *     | node ./node_modules/wrangler/bin/wrangler.js d1 execute itp-itr --local \
 *         --config api/wrangler.toml --command "$(cat)"
 * Or copy the printed SQL and run it via `wrangler d1 execute ... --command "..."`
 * (add --remote for production).
 */
import { webcrypto as crypto } from "node:crypto";

const [, , email, name, role, password] = process.argv;
if (!email || !name || !role || !password) {
  console.error("usage: create-user.mjs <email> <name> <role:site_engineer|qa_qc> <password>");
  process.exit(1);
}
if (role !== "site_engineer" && role !== "qa_qc") {
  console.error(`invalid role "${role}" — use site_engineer or qa_qc`);
  process.exit(1);
}

const ITERATIONS = 100_000;
const b64 = (u8) => Buffer.from(u8).toString("base64");

const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
  "deriveBits",
]);
const bits = new Uint8Array(
  await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, key, 256),
);
const passwordHash = `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(bits)}`;

const id = crypto.randomUUID();
const createdAt = new Date().toISOString();
const esc = (s) => String(s).replace(/'/g, "''");

process.stdout.write(
  `INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES ` +
    `('${id}', '${esc(email.toLowerCase())}', '${esc(name)}', '${role}', '${passwordHash}', '${createdAt}');\n`,
);
