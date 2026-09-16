#!/usr/bin/env node
// Genera i valori segreti del profilo di seed "real" da incollare in .env.local (MAI nel repository):
// password provvisoria dell'amministratore con il suo hash scrypt (codificato base64, perché il
// formato scrypt contiene "$" che i caricatori di .env espandono come variabile), segreto dei token
// dei display e SESSION_SECRET. Stampa e basta: non scrive nulla. Stesso formato di hash di
// src/lib/hash-password.ts (il test tests/unit/genera-credenziali.test.ts lo garantisce).
//
//   npm run seed:credenziali
import { randomBytes, randomInt, scryptSync } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Niente 0/O, 1/I/L: la password si detta a voce senza dubbi (come generateTemporaryPassword). */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SCRYPT = { N: 16384, r: 8, p: 1 };

/** Password provvisoria `XXXX-XXXX-XXXX` (CSPRNG). */
export function generaPasswordProvvisoria() {
  let s = '';
  for (let i = 0; i < 12; i += 1) {
    s += ALFABETO.charAt(randomInt(ALFABETO.length));
  }
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** Hash scrypt nel formato `scrypt$N=<n>,r=<r>,p=<p>$<sale base64>$<hash base64>`. */
export function hashScrypt(password) {
  const sale = randomBytes(16);
  const hash = scryptSync(password, sale, 64, SCRYPT);
  return `scrypt$N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p}$${sale.toString('base64')}$${hash.toString('base64')}`;
}

/** Valore per SEED_ADMIN_PASSWORD_HASH: l'hash in base64 con prefisso, senza "$" nel file .env. */
export function codificaHashPerEnv(hash) {
  return `base64:${Buffer.from(hash, 'utf8').toString('base64')}`;
}

/** Segreto casuale esadecimale (default 32 byte = 64 caratteri). */
export function generaSegreto(byte = 32) {
  return randomBytes(byte).toString('hex');
}

function main() {
  const password = generaPasswordProvvisoria();
  const righe = [
    '# Generato da `npm run seed:credenziali`. Incollare in .env.local (ignorato da git), MAI nel repository.',
    `# Password provvisoria dell'amministratore (utente "admin"), da cambiare al primo accesso: ${password}`,
    'SEED_PROFILE=real',
    `SEED_ADMIN_PASSWORD_HASH=${codificaHashPerEnv(hashScrypt(password))}`,
    `SEED_DISPLAY_TOKEN_SECRET=${generaSegreto(24)}`,
    `SESSION_SECRET=${generaSegreto(32)}`,
  ];
  console.log(righe.join('\n'));
}

const eseguitoDirettamente =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (eseguitoDirettamente) {
  main();
}
