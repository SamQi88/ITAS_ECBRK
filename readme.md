# Estrazione rendiconti provvigionali

App demo (SAP CAP Node.js + UI5) che carica un PDF di rendiconto provvigionale, estrae con un modello di SAP AI Core (OpenAI, Google Gemini o Anthropic Claude, a scelta) una riga per polizza e la salva in SQLite.

Campi estratti per ogni riga: data effetto, contraente, numero polizza, premi, provvigioni, data incasso. Ogni riga è salvata con `ID_OPERAZIONE` e nome del documento.

La pagina mostra la preview del PDF a sinistra e la tabella dei campi estratti a destra. Sopra la tabella compaiono "Totale premi" e "Totale provvigioni", calcolati come somma degli importi letti dall'IA (non i totali scritti nel PDF), e "Ritenuta d'acconto", l'importo complessivo letto dal documento, solo se presente (salvato in `Documents.RITENUTA_ACCONTO`). In alto a destra c'è il nome del modello IA in uso. I PDF con testo selezionabile vengono letti come testo; le scansioni vengono inviate al modello come immagini.

## Sviluppo locale

```bash
npm install
cp .env.example .env     # poi compilare i valori (vedi sotto)
npm start                # http://localhost:4004
npm test
```

Valori di `.env`: `AI_CORE_CLIENT_ID`, `AI_CORE_CLIENT_SECRET`, `AI_CORE_AUTH_URL` (`clientid`, `clientsecret`, `url` della service key di AI Core), `AI_API_URL` (`serviceurls.AI_API_URL`), `RESOURCE_GROUP` (default `default`) e le variabili del modello descritte sotto. Il file `.env` non è versionato.

## Scelta del modello

Il modello si sceglie solo da configurazione, senza toccare il codice: la variabile `LLM_PROVIDER` indica la famiglia e ogni famiglia ha il suo deployment di AI Core.

| `LLM_PROVIDER` | Deployment | Variabili |
|---|---|---|
| `openai` (default) | GPT-5.5, esecutore `azure-openai` | `DEPLOYMENT_ID_OPENAI` (vale ancora anche `DEPLOYMENT_ID`) |
| `google` | Gemini, esecutore `gcp-vertexai` | `DEPLOYMENT_ID_GOOGLE` e `GOOGLE_MODEL` (per esempio `gemini-3.8-flash`, fa parte dell'URL) |
| `anthropic` | Claude, esecutore `aws-bedrock` | `DEPLOYMENT_ID_ANTHROPIC` (API Converse) |

Su Cloud Foundry si cambia `LLM_PROVIDER` in `mta.yaml` e si rifà il deploy, oppure `cf set-env itas-ecbrk-srv LLM_PROVIDER google` seguito da `cf restage itas-ecbrk-srv`. Per usare un altro modello della stessa famiglia basta un altro ID di deployment (e `GOOGLE_MODEL` per Gemini).

Il codice che dipende dal formato di ciascuna famiglia sta in `srv/lib/providers/` (un file per famiglia). Per aggiungerne una si crea un file con `buildRequest` e `parseResponse` e lo si registra in `srv/lib/llm.js`.

Il nome mostrato in alto a destra viene da `MODEL_LABEL_OPENAI`, `MODEL_LABEL_GOOGLE` e `MODEL_LABEL_ANTHROPIC` (in `mta.yaml`); se mancano si usa un nome generico ("OpenAI GPT", "Google Gemini", "Anthropic Claude"). Si aggiorna insieme a `LLM_PROVIDER` quando cambi deployment.

Verificato con `AON 636016.pdf` (11 righe, testo) e `IBC VITA.PDF` (3 righe, scansione) su tutte e tre le famiglie: righe, totali di premi e provvigioni e ritenuta d'acconto coincidono con quelli dei documenti.

## Parsing Confidence Score

A destra del titolo "Posizioni estratto conto" compare una percentuale unica per documento: verde da 90%, arancione da 70% a 89%, rosso sotto il 70%. Il passaggio del mouse mostra il dettaglio.

**Non è una probabilità del modello** (i modelli generativi non ne restituiscono una affidabile): è un indice di coerenza calcolato da controlli oggettivi in `srv/lib/confidence.js`.

| Controllo | Peso | Come |
|---|---|---|
| Completezza | 40% | quota dei sei campi di ogni riga letti e validi |
| Quadratura premi | 30% | somma delle righe uguale al totale premi stampato nel documento (tolleranza 2 centesimi) |
| Quadratura provvigioni | 30% | come sopra, per le provvigioni |

Per la quadratura l'IA legge anche i totali stampati nel PDF (`totalePremiDocumento`, `totaleProvvigioniDocumento`), usati solo per il controllo: i totali mostrati in pagina restano la somma delle righe. Se il documento non stampa un totale, quel controllo è escluso e i pesi degli altri si riscalano. Un 100% significa che i campi ci sono e i numeri tornano, non che ogni singolo valore sia garantito. Il punteggio non viene salvato nel database.

Se l'IA salta una riga, la quadratura fallisce e il punteggio scende (verificato alterando il totale premi di AON: 70% con tutte e tre le famiglie).

## Tempi di risposta

Con i due PDF di esempio l'estrazione richiede da 4 a 10 secondi. Per OpenAI e Gemini il ragionamento interno del modello è impostato su `low` (`reasoning_effort` e `thinkingLevel`, in `srv/lib/providers/`): dimezza i tempi con gli stessi risultati. Claude non ragiona e non ha un parametro equivalente.

Ogni richiesta scrive nei log tre righe di soli metadati (mai il contenuto dei documenti), leggibili con `cf logs itas-ecbrk-srv --recent`:
- `[extract] pdf=…ms testo=…car` (o `immagini=N`): lettura del PDF;
- `[llm] provider=… token=…ms chiamata=…ms finish=…`: ottenimento del token OAuth (`cache` se già valido) e chiamata al modello;
- `[upload] totale=…ms stato=…`: durata complessiva della richiesta.

Se una richiesta è lenta, il confronto tra `totale` e `chiamata` indica se il tempo è speso nel modello o altrove.

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
