# Estrazione rendiconti provvigionali

App demo (SAP CAP Node.js + UI5) che carica un PDF di rendiconto provvigionale, estrae con GPT-5.5 (SAP AI Core) una riga per polizza e la salva in SQLite.

Campi estratti per ogni riga: data effetto, contraente, numero polizza, premi, provvigioni, data incasso. Ogni riga è salvata con `ID_OPERAZIONE` e nome del documento.

La pagina mostra la preview del PDF a sinistra e la tabella dei campi estratti a destra. I PDF con testo selezionabile vengono letti come testo; le scansioni vengono inviate al modello come immagini.

## Sviluppo locale

```bash
npm install
cp .env.example .env     # poi compilare i valori (vedi sotto)
npm start                # http://localhost:4004
npm test
```

Valori di `.env`: `AI_CORE_CLIENT_ID`, `AI_CORE_CLIENT_SECRET`, `AI_CORE_AUTH_URL` (`clientid`, `clientsecret`, `url` della service key di AI Core), `AI_API_URL` (`serviceurls.AI_API_URL`), `DEPLOYMENT_ID` (deployment GPT-5.5 di AI Core), `RESOURCE_GROUP` (default `default`). Il file `.env` non è versionato.

Il database è il file `db.sqlite`, creato all'avvio se non esiste. L'OData in sola lettura è su `/odata/archivio` (`Documents`, `Policies`).

## Deploy su Cloud Foundry

In `mta.yaml` sostituire `aicore-instance-name` con il nome dell'istanza AI Core mostrato da `cf services`. Se l'istanza non è visibile nello spazio di deploy, togliere `requires` e la sezione `resources` e impostare le credenziali dopo il deploy con `cf set-env itas-ecbrk-srv <VARIABILE> <valore>` (le variabili di `.env.example`), poi `cf restage itas-ecbrk-srv`.

```bash
npm install -g mbt
mbt build
cf login
cf deploy mta_archives/itas-ecbrk_1.0.0.mtar
```

## Note

- **Nessuna autenticazione:** app interna, pensata per essere mostrata in riunione. Chiunque abbia l'URL può caricare documenti, consumare AI Core e leggere tutti i dati estratti (nomi dei contraenti, polizze, importi) dall'OData `/odata/archivio`. Non esporre l'URL al di fuori della demo.
- **SQLite senza persistenza su CF:** il filesystem del container è effimero, quindi i dati (e l'elenco dei documenti già caricati) si perdono a ogni restart o restage. L'app gira in una sola istanza.
- **Duplicati:** il confronto usa l'hash SHA-256 del file. Un documento già caricato non viene bloccato: viene elaborato e salvato di nuovo, e l'utente riceve un avviso con la data del primo caricamento. Un PDF rigenerato con contenuto uguale ma byte diversi non genera l'avviso.
- **Database esistente:** all'avvio `srv/init-db.js` aggiorna un `db.sqlite` creato con lo schema vecchio (con vincolo di univocità sull'hash), conservandone i dati e lasciando una copia di sicurezza `db.sqlite.bak-*`.
- **Limiti:** file PDF fino a 10 MB. Nelle tabelle lunghe il modello può saltare righe: controllare il numero di righe estratte accanto al titolo della tabella.
- **Licenza:** la libreria `mupdf` (estrazione di testo e immagini dal PDF) è AGPL, accettabile per una demo interna.
- **Segreti:** nessun segreto nel repository.
