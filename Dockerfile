# syntax=docker/dockerfile:1.7
#
# Immagine dell'accettazione per il server AI di Autoclub (SRV-AI): docs/HOSTING_SRV-AI.md e il
# README («Rilascio su SRV-AI»). Next.js in modalità `standalone`, UN solo processo Node, utente non
# root, dati in /data (volume).
#
# Il driver ODBC di SQL Anywhere 17 NON è nell'immagine (software SAP, con la sua licenza): si
# monta in sola lettura in /opt/sqlanywhere17 (compose.yaml) e l'avvio scrive il DSN ODBC
# (docker/entrypoint.sh). Senza il driver il programma parte lo stesso: la sync da Infinity fallisce
# e la dashboard lo dice, il resto dell'officina lavora.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# --- Dipendenze: i moduli nativi (odbc, better-sqlite3) si compilano qui per Linux -------------
# I loro script di installazione partono perché sono approvati in `allowScripts` (package.json).
FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ unixodbc-dev ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# `postinstall` lancia `prisma generate`: servono schema e configurazione di Prisma.
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src/config/database-url.ts ./src/config/database-url.ts
RUN npm ci --no-audit --no-fund

# --- Build: `prisma generate && next build` → .next/standalone -----------------------------------
FROM deps AS build
COPY . .
RUN npm run build

# --- Migrazioni: la CLI di Prisma (dipendenza di sviluppo, fuori dal bundle), alla stessa versione
FROM base AS migrator
# Prisma riconosce la piattaforma (OpenSSL 3) per scaricare il motore delle migrazioni giusto.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /migrator
COPY package-lock.json /tmp/package-lock.json
# npm ≥ 11.19 esegue gli script di installazione solo dei pacchetti approvati (`allowScripts`, come
# nel package.json del progetto): qui servono quelli di prisma e dei suoi motori.
RUN versione="$(node -p "require('/tmp/package-lock.json').packages['node_modules/prisma'].version")" \
  && node -e "require('fs').writeFileSync('package.json', JSON.stringify({ name: 'migrator', private: true, allowScripts: { ['prisma@' + process.argv[1]]: true, ['@prisma/engines@' + process.argv[1]]: true } }))" "$versione" \
  && npm install --no-audit --no-fund --omit=dev "prisma@${versione}" \
  && rm /tmp/package-lock.json
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY src/config/database-url.ts ./src/config/database-url.ts

# --- Immagine finale ------------------------------------------------------------------------------
FROM base AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends unixodbc openssl ca-certificates tzdata tini \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    TZ=Europe/Rome \
    REPOSITORY_PROVIDER=prisma \
    DATABASE_URL=file:/data/accettazione.db \
    MEDIA_STORAGE_DIR=/data/uploads \
    DB_BACKUP_DIR=/data/backup \
    SQLANY_DIR=/opt/sqlanywhere17 \
    ODBCSYSINI=/tmp/odbc
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=migrator --chown=node:node /migrator /migrator
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh && mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
# Vivo finché il processo risponde; `?probe=dependencies` (Infinity, Spoki) è per il monitoraggio.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["node", "server.js"]
