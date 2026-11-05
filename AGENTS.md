# Regole Progetto Achats (Synology NAS DS1522+ & GitHub)

## Promemoria obbligatorio dopo ogni modifica al codice
Ogni volta che vengono modificati i file della webapp in `c:\Progetti\Achats`:
1. Esegui il commit e il push su GitHub (`https://github.com/robertopuly/Achats`).
2. **Ricorda SEMPRE all'utente i passaggi esatti per trasferire l'aggiornamento sul NAS Synology DS1522+ (`/Webapp/Achats`)**:
   - **Se sono stati modificati solo file frontend (`templates/index.html`, `static/css/style.css`, `static/js/app.js`)**:
     1. Copia i file modificati da `c:\Progetti\Achats` alla cartella condivisa `/Webapp/Achats` sul NAS (senza toccare la cartella `data`).
     2. Ricarica semplicemente la pagina nel browser (`F5`), senza bisogno di riavviare il container in Container Manager.
   - **Se sono stati modificati file backend (`server.js`, `pdf_generator.js`, `seed_catalog.json`)**:
     1. Copia i file modificati da `c:\Progetti\Achats` alla cartella condivisa `/Webapp/Achats` sul NAS (senza toccare la cartella `data`).
     2. In **Container Manager** → **Projet** → seleziona **`achats`** → clicca **Action → Redémarrer** (Riavvia).
   - **Se è stato modificato `Dockerfile` o `docker-compose.yml`**:
     1. Copia i file modificati in `/Webapp/Achats`.
     2. In **Container Manager** → **Projet** → seleziona **`achats`** → **Action → Nettoyer** e poi **Action → Créer**.
