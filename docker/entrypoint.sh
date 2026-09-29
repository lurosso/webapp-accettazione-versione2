#!/bin/sh
# Avvio del container dell'accettazione (Dockerfile). Due passi, poi il programma:
# 1. con Infinity reale, il DSN ODBC verso il driver SQL Anywhere 17 montato in $SQLANY_DIR
#    (host, database e credenziali arrivano dalle variabili INFINITY_ODBC_*);
# 2. con il database SQLite, le migrazioni (idempotenti: quelle già applicate si saltano).
# Un driver mancante NON ferma l'avvio: l'officina deve poter lavorare anche senza la sync.
set -eu

fornitore_infinity="${INFINITY_PROVIDER:-${SERVICES_PROVIDER:-mock}}"
if [ "$fornitore_infinity" = "real" ]; then
  driver="${SQLANY_ODBC_DRIVER:-${SQLANY_DIR}/lib64/libdbodbc17_r.so}"
  if [ -f "$driver" ]; then
    mkdir -p "$ODBCSYSINI"
    printf '[SQL Anywhere 17]\nDriver=%s\n' "$driver" > "$ODBCSYSINI/odbcinst.ini"
    printf '[%s]\nDriver=SQL Anywhere 17\n' "${INFINITY_ODBC_DSN:-Infinity}" > "$ODBCSYSINI/odbc.ini"
    LD_LIBRARY_PATH="${SQLANY_DIR}/lib64${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
    export LD_LIBRARY_PATH
    echo "[avvio] DSN ODBC «${INFINITY_ODBC_DSN:-Infinity}» sul driver $driver"
  else
    echo "[avvio] ATTENZIONE: driver SQL Anywhere non trovato in $driver: la sync da Infinity non potrà partire (montare il client in $SQLANY_DIR)" >&2
  fi
fi

if [ "${REPOSITORY_PROVIDER:-memory}" = "prisma" ]; then
  echo "[avvio] migrazioni del database"
  (cd /migrator && node node_modules/prisma/build/index.js migrate deploy)
fi

exec "$@"
