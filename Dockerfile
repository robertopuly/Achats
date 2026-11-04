# Dockerfile per Achats (Lista Supermercato & Database Acquisti)
# Usa Node.js 24 Alpine (include il modulo nativo node:sqlite senza dipendenze esterne)
FROM node:24-alpine

WORKDIR /app

# Imposta fuso orario europeo (Zurigo/Roma)
ENV NODE_ENV=production
ENV PORT=8090
ENV DB_PATH=/app/data/achats.db
ENV TZ=Europe/Zurich

# Copia i file dell'applicazione e il catalogo di seed
COPY server.js pdf_generator.js seed_catalog.json ./
COPY templates ./templates
COPY static ./static

# Cartella volume persistente per il database SQLite sul NAS Synology
RUN mkdir -p /app/data

EXPOSE 8090

CMD ["node", "server.js"]
