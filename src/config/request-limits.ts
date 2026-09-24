// Quanto corpo di richiesta il proxy di Next lascia arrivare alle rotte.
//
// Con `src/proxy.ts` presente, Next copia in memoria il corpo di ogni richiesta che il proxy
// intercetta (per poterlo leggere due volte) e si ferma a `experimental.proxyClientMaxBodySize`,
// 10 MB se non si dice niente. Oltre quella soglia NON dà errore: tronca in silenzio e la rotta
// riceve un multipart monco. Il caricamento dei media del check-in passa dal proxy (controllo di
// origine e di sessione) e un video del giro può arrivare a 80 MB: con il limite di default ogni
// video oltre i 10 MB veniva rifiutato come «corpo non valido», e la coda del tablet lo dava per
// perso. La soglia qui sta sopra il tetto dell'intera richiesta di caricamento (video massimo più
// il contorno multipart, `MAX_UPLOAD_REQUEST_BYTES` nella rotta): un test la tiene allineata.
export const PROXY_CLIENT_MAX_BODY_BYTES = 81 * 1024 * 1024;
