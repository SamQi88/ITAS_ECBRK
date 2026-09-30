# Estrazione dati da rendiconti PDF: design

Data: 2026-09-30

## Obiettivo

App demo (uso interno, mostrata in riunione) in SAP BAS / Cloud Foundry. L'utente carica un PDF di rendiconto provvigionale. L'app estrae i dati di ogni polizza con un LLM, li salva in SQLite e li mostra in una pagina web.

Campi estratti per ogni riga di polizza: data effetto, contraente, numero polizza, premi, provvigioni, data incasso.

Criteri di successo:

- I due PDF di esempio (AON 636016: 10 righe, testuale; IBC VITA: 3 righe, scansione) producono il numero di righe e i valori corretti.
- Un secondo upload dello stesso file viene bloccato con un avviso, senza chiamare il modello.
- L'app è deployata su Cloud Foundry e testata.

## Decisioni prese

- Stack: Node.js CAP, front-end UI5 freestyle (non Fiori elements), deploy MTA su Cloud Foundry.
- Estrazione: GPT-5.5 via SAP AI Core (scenario `azure-openai`, deployment già RUNNING, resource group `default`). Non si usa SAP Document AI, che ispira solo il layout.
- % di accuratezza: **non calcolata**. Non c'è la colonna nel DB né nella UI.
- Persistenza: SQLite su file, anche su CF. I dati si perdono a restart/restage: accettato (demo). Una sola istanza.
- Autenticazione: nessuna (app interna, mostrata in riunione). Da dichiarare nel README.
- Duplicati: confronto hash SHA-256 del contenuto del file, non del nome.
- Fuori scope: storico documenti, modifica campi, export, verifica automatica dei totali.

## Modello dati

`Documents` (un record per file):

- `ID_OPERAZIONE` (UUID generato a ogni upload, chiave)
- `NOME_DOCUMENTO`
- `HASH_SHA256` (univoco)
- `DATA_CARICAMENTO`

`Policies` (una riga per polizza estratta):

- `ID`
- `ID_OPERAZIONE` (associazione a `Documents`)
- `NOME_DOCUMENTO` (ripetuto, richiesto)
- `DATA_EFFETTO`, `CONTRAENTE`, `NUMERO_POLIZZA`
- `PREMI`, `PROVVIGIONI`, `DATA_INCASSO`

Formati: date `YYYY-MM-DD` (convertite da `gg/mm/aaaa`), importi decimali (`5.725,73` → `5725.73`). Valore assente nel PDF = `NULL`, mai inventato.

### Mapping dei campi

| Campo | AON | IBC VITA |
|---|---|---|
| Data effetto | Data Effetto | Dec.Rata |
| Contraente | Cliente | Contraente |
| Numero polizza | Nro Contratto (primo valore, senza il duplicato dopo `\|\|`) | Polizza |
| Premi | Premio Lordo | Premi |
| Provvigioni | Provvigioni Attive Totali (prima della ritenuta) | Provvigioni |
| Data incasso | Data Incasso | Data incasso |

## Flusso di upload

1. L'utente sceglie il PDF; la preview appare subito a sinistra (dal browser, il server non conserva il PDF).
2. Il browser invia il file a `POST /upload`.
3. Il backend calcola l'hash. Se esiste già in `Documents`: `409` con messaggio "Documento già caricato il gg/mm/aaaa"; stop, nessuna chiamata al modello.
4. Estrazione del testo dal PDF. Se è sotto soglia (circa 100 caratteri per pagina, scansione), le pagine diventano immagini PNG.
5. Chiamata a GPT-5.5 su AI Core con testo o immagini, richiesta di solo JSON con un array di righe.
6. Validazione del JSON; salvataggio di documento e righe in un'unica transazione.
7. La risposta di `/upload` riempie la tabella a destra.

Limite noto: il file deve essere identico byte per byte per essere riconosciuto come duplicato. Un PDF rigenerato dal gestionale con contenuto uguale viene elaborato come nuovo.

## Backend

File (CAP Node.js):

- `srv/upload.js`: endpoint `POST /upload` (multer); coordina duplicati, estrazione, salvataggio, risposta.
- `srv/lib/pdf.js`: estrazione testo; fallback a immagini con una libreria senza binari nativi.
- `srv/lib/llm.js`: token OAuth con le credenziali del binding AI Core (cache fino a scadenza) e chiamata al deployment.
- `srv/lib/schema.js`: schema del JSON atteso, validazione, conversione di date e importi.

Chiamata al modello:

- `AI_API_URL`, `DEPLOYMENT_ID`, `RESOURCE_GROUP` da configurazione, mai nel codice.
- Il prompt contiene il mapping sopra e chiede solo JSON.
- Output strutturato (JSON schema) se il deployment lo supporta; altrimenti il JSON viene estratto dalla risposta e validato. Da verificare nel primo test.
- Temperatura bassa.

Errori, sempre con messaggio chiaro per l'utente:

- File non PDF o oltre 10 MB: rifiutato subito.
- Duplicato: `409`.
- AI Core non raggiungibile o risposta non valida: `502`, nessun salvataggio, dettaglio nei log.
- Nessuna riga trovata: messaggio "Nessuna polizza trovata", nessun documento salvato.

Limite noto: il modello può saltare righe nelle tabelle lunghe. La UI mostra il numero di righe estratte, da controllare contro il PDF.

## Interfaccia (UI5 freestyle, vista unica)

- Barra in alto: titolo, pulsante "Carica documento" (solo `.pdf`), nome del file corrente.
- Sinistra (circa 50%): preview PDF con `<iframe>`/`<object>` su `URL.createObjectURL`.
- Destra (circa 50%): titolo "Campi estratti (N)" e tabella `sap.m.Table` con Data effetto, Contraente, Numero polizza, Premi, Provvigioni, Data incasso. Importi allineati a destra in euro.
- `Splitter` ridimensionabile tra i due riquadri.
- Durante l'elaborazione: indicatore di caricamento, pulsante disabilitato, messaggio "Elaborazione in corso…".
- Duplicato: `MessageBox` di avviso; la preview resta, la tabella non cambia.
- Altri errori: `MessageBox` di errore senza dettagli tecnici.
- Campo mancante: cella vuota.
- Al reload della pagina tabella e preview ripartono vuote (i dati restano nel DB).

## Repository, configurazione e deploy

Struttura: `db/` (schema), `srv/` (servizio e librerie), `app/` (UI5 `webapp/`), `mta.yaml`, `.gitignore` (esclude `node_modules`, `.env`, `*.db`, `gen/`), `README.md` (configurazione, deploy, nota sull'assenza di autenticazione).

Segreti:

- Locale/BAS: `.env` non versionato con `AI_CORE_CLIENT_ID`, `AI_CORE_CLIENT_SECRET`, `AI_CORE_AUTH_URL`, `AI_API_URL`, `DEPLOYMENT_ID`, `RESOURCE_GROUP`. Nel repo solo `.env.example` senza valori.
- CF: servizio AI Core legato nel `mta.yaml`; se l'istanza è in un altro subaccount/spazio, user-provided service (`cf cups`) o `cf set-env`. Da decidere al deploy.
- La service key non va mai nel repo.

Database in CF: SQLite su filesystem del container, una sola istanza nel `mta.yaml`.

Flusso di rilascio:

1. Sviluppo e verifica locale con `cds watch` e i due PDF.
2. Push su GitHub.
3. Clone in BAS, `.env`, `npm install`.
4. `mbt build` e `cf deploy` (login CF a cura dell'utente).
5. Test sull'URL pubblico.

## Test

- Locale con LLM reale: i due PDF di esempio (10 e 3 righe, valori corretti) e secondo upload dello stesso file che dà l'avviso di duplicato.
- Automatici senza rete: controllo duplicati, validazione e conversione di date/importi, endpoint con modello simulato.
- Su CF: stessa prova con i due PDF e controllo dei log. Da verificare solo lì: memoria dell'app con le immagini (parto da 1 GB) e raggiungibilità di AI Core dal container.

## Aperto, da verificare in implementazione

- Il deployment GPT-5.5 supporta l'output strutturato e l'input immagine? Da provare con la prima chiamata reale.
- L'istanza AI Core è bindabile dallo spazio CF di deploy, o serve un user-provided service?
- Il deploy su CF lo esegue l'utente in BAS: dal repo locale si arriva fino al push su GitHub.
