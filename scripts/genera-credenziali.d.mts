// Tipi dello script `genera-credenziali.mjs`, usati solo dai test.
export function generaPasswordProvvisoria(): string;
export function hashScrypt(password: string): string;
export function codificaHashPerEnv(hash: string): string;
export function generaSegreto(byte?: number): string;
