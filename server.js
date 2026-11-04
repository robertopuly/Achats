const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { generateShoppingListPdf, generatePurchasesPdf } = require("./pdf_generator");

const PORT = Number(process.env.PORT || 8090);
const BASE_DIR = __dirname;
const DEFAULT_DB_PATH = path.join(BASE_DIR, "achats.db");
const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : DEFAULT_DB_PATH;

// Se DB_PATH è in una sottocartella (es. /app/data/achats.db su Docker/NAS Synology),
// crea la cartella e copia il database iniziale se non esiste ancora nel volume persistente
if (DB_PATH !== DEFAULT_DB_PATH) {
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
    }
    if (!fs.existsSync(DB_PATH) && fs.existsSync(DEFAULT_DB_PATH)) {
        fs.copyFileSync(DEFAULT_DB_PATH, DB_PATH);
    }
}

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// 1. Tabelle base (Utenti, Sessioni, Categorie, Catalogo, Liste della Spesa)
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL COLLATE NOCASE,
        icon TEXT DEFAULT '📦',
        color TEXT DEFAULT '#475569',
        sort_order INTEGER DEFAULT 10,
        column_group INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS catalog_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        default_unit TEXT DEFAULT '',
        last_unit_price REAL DEFAULT 0,
        last_fornitore TEXT DEFAULT '',
        created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shopping_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        list_date TEXT NOT NULL,
        fornitore TEXT DEFAULT 'Aldi',
        created_by INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS shopping_list_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id INTEGER NOT NULL,
        product_id INTEGER,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        unit TEXT DEFAULT '',
        quantity TEXT DEFAULT '',
        unit_price REAL DEFAULT 0,
        total_price REAL DEFAULT 0,
        fornitore TEXT DEFAULT '',
        in_list INTEGER DEFAULT 0,
        purchased INTEGER DEFAULT 0,
        notes TEXT DEFAULT '',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES catalog_products(id) ON DELETE SET NULL
    );
`);

// 2. Tabella Fornitori (precompilata con Aldi, Coop, Lidl, Migros e modificabile)
db.exec(`
    CREATE TABLE IF NOT EXISTS fornitori (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT UNIQUE NOT NULL COLLATE NOCASE,
        sort_order INTEGER DEFAULT 10
    );
`);

const DEFAULT_FORNITORI = [
    { nome: "Aldi", sort_order: 1 },
    { nome: "Coop", sort_order: 2 },
    { nome: "Lidl", sort_order: 3 },
    { nome: "Migros", sort_order: 4 },
];
const countFornitori = db.prepare("SELECT COUNT(*) AS c FROM fornitori").get().c;
if (countFornitori === 0) {
    const insForn = db.prepare("INSERT OR IGNORE INTO fornitori (nome, sort_order) VALUES (?, ?)");
    for (const f of DEFAULT_FORNITORI) {
        insForn.run(f.nome, f.sort_order);
    }
}

// 3. Tabella principale ACQUISTI
db.exec(`
    CREATE TABLE IF NOT EXISTS acquisti (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        descrizione_prodotto TEXT NOT NULL,
        fornitore TEXT NOT NULL DEFAULT 'Aldi',
        categoria TEXT DEFAULT 'ALIMENTARI',
        unita TEXT DEFAULT 'Pz',
        prezzo_unitario REAL NOT NULL DEFAULT 0,
        quantita REAL NOT NULL DEFAULT 1,
        prezzo_totale REAL NOT NULL DEFAULT 0,
        data_acquisto TEXT NOT NULL,
        anno INTEGER NOT NULL,
        mese TEXT NOT NULL,
        giorno TEXT NOT NULL,
        list_id INTEGER,
        list_item_id INTEGER,
        note TEXT DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_acquisti_data ON acquisti(data_acquisto);
    CREATE INDEX IF NOT EXISTS idx_acquisti_anno ON acquisti(anno);
    CREATE INDEX IF NOT EXISTS idx_acquisti_mese ON acquisti(mese);
    CREATE INDEX IF NOT EXISTS idx_acquisti_giorno ON acquisti(giorno);
    CREATE INDEX IF NOT EXISTS idx_acquisti_prodotto ON acquisti(descrizione_prodotto);
`);

// Migrazione sicura colonne su tabelle esistenti
function ensureColumn(table, colName, colDef) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === colName)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${colName} ${colDef}`);
    }
}
ensureColumn("acquisti", "fornitore", "TEXT NOT NULL DEFAULT 'Aldi'");
ensureColumn("shopping_lists", "fornitore", "TEXT DEFAULT 'Aldi'");
ensureColumn("shopping_list_items", "unit_price", "REAL DEFAULT 0");
ensureColumn("shopping_list_items", "total_price", "REAL DEFAULT 0");
ensureColumn("shopping_list_items", "fornitore", "TEXT DEFAULT ''");
ensureColumn("catalog_products", "last_unit_price", "REAL DEFAULT 0");
ensureColumn("catalog_products", "last_fornitore", "TEXT DEFAULT ''");

db.exec("CREATE INDEX IF NOT EXISTS idx_acquisti_fornitore ON acquisti(fornitore);");

// Popolamento automatico categorie e catalogo iniziale se il database è nuovo
(function seedInitialDatabaseIfEmpty() {
    const seedPath = path.join(BASE_DIR, "seed_catalog.json");
    if (!fs.existsSync(seedPath)) return;
    try {
        const seed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
        const catCount = db.prepare("SELECT COUNT(*) AS c FROM categories").get().c;
        if (catCount === 0 && Array.isArray(seed.categories)) {
            const insCat = db.prepare(
                "INSERT OR IGNORE INTO categories (name, icon, color, sort_order, column_group) VALUES (?, ?, ?, ?, ?)"
            );
            for (const c of seed.categories) {
                insCat.run(c.name, c.icon || "📦", c.color || "#475569", c.sort_order ?? 10, c.column_group ?? 1);
            }
        }
        const prodCount = db.prepare("SELECT COUNT(*) AS c FROM catalog_products").get().c;
        const ts = new Date().toISOString().slice(0, 19);
        if (prodCount === 0 && Array.isArray(seed.products)) {
            const insProd = db.prepare(
                "INSERT INTO catalog_products (name, category, default_unit, created_at) VALUES (?, ?, ?, ?)"
            );
            for (const p of seed.products) {
                insProd.run(p.name, p.category || "ALIMENTARI", p.default_unit || "", ts);
            }
        }
        const listCount = db.prepare("SELECT COUNT(*) AS c FROM shopping_lists").get().c;
        if (listCount === 0) {
            const today = new Date().toISOString().slice(0, 10);
            const info = db
                .prepare(
                    "INSERT INTO shopping_lists (name, list_date, fornitore, created_by, created_at, updated_at) VALUES (?, ?, 'Aldi', NULL, ?, ?)"
                )
                .run("Lista Supermercato", today, ts, ts);
            const listId = Number(info.lastInsertRowid);
            const prods = db.prepare("SELECT id, name, category, default_unit FROM catalog_products").all();
            const insItem = db.prepare(
                `INSERT INTO shopping_list_items (list_id, product_id, name, category, unit, quantity, unit_price, total_price, fornitore, in_list, purchased, notes, updated_at)
                 VALUES (?, ?, ?, ?, ?, '', 0, 0, 'Aldi', 0, 0, '', ?)`
            );
            for (const p of prods) {
                insItem.run(listId, p.id, p.name, p.category, p.default_unit, ts);
            }
        }
    } catch (_) {}
})();

function ensureSupplierExists(nome) {
    const clean = String(nome || "").trim();
    if (!clean) return "Aldi";
    const existing = db.prepare("SELECT nome FROM fornitori WHERE LOWER(nome) = LOWER(?)").get(clean);
    if (existing) return existing.nome;
    const maxOrd = db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM fornitori").get().m;
    db.prepare("INSERT OR IGNORE INTO fornitori (nome, sort_order) VALUES (?, ?)").run(clean, maxOrd + 1);
    return clean;
}

function nowIso() {
    return new Date().toISOString().slice(0, 19);
}

function todayIso() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function parseNumber(val, fallback = 0) {
    if (val === null || val === undefined || val === "") return fallback;
    const cleaned = String(val).trim().replace(",", ".");
    const num = parseFloat(cleaned);
    return Number.isFinite(num) ? num : fallback;
}

function roundMoney(val) {
    return Math.round((Number(val) + Number.EPSILON) * 100) / 100;
}

function extractDateParts(dateStr) {
    const clean = String(dateStr || "").trim();
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : todayIso();
    const anno = parseInt(iso.slice(0, 4), 10);
    const mese = iso.slice(0, 7);
    const giorno = iso;
    return { data_acquisto: iso, anno, mese, giorno };
}

function syncListItemToAcquisti(item, parentList) {
    const ts = nowIso();
    const listDate = parentList ? parentList.list_date : todayIso();
    const listFornitore = (parentList && parentList.fornitore) || "Aldi";
    const fornitore = ensureSupplierExists(item.fornitore || listFornitore || "Aldi");
    const { data_acquisto, anno, mese, giorno } = extractDateParts(listDate);
    const qtyNum = parseNumber(item.quantity, 1) || 1;
    const unitPriceNum = roundMoney(parseNumber(item.unit_price, 0));
    const totalPriceNum = roundMoney(qtyNum * unitPriceNum);

    const existing = db.prepare("SELECT id FROM acquisti WHERE list_item_id = ?").get(item.id);
    if (item.purchased === 1 || (existing && item.in_list === 1)) {
        if (existing) {
            db.prepare(
                `UPDATE acquisti
                 SET descrizione_prodotto = ?, fornitore = ?, categoria = ?, unita = ?, prezzo_unitario = ?, quantita = ?, prezzo_totale = ?,
                     data_acquisto = ?, anno = ?, mese = ?, giorno = ?, note = ?, updated_at = ?
                 WHERE id = ?`
            ).run(
                item.name,
                fornitore,
                item.category || "ALIMENTARI",
                item.unit || "Pz",
                unitPriceNum,
                qtyNum,
                totalPriceNum,
                data_acquisto,
                anno,
                mese,
                giorno,
                item.notes || "",
                ts,
                existing.id
            );
        } else {
            db.prepare(
                `INSERT INTO acquisti
                 (descrizione_prodotto, fornitore, categoria, unita, prezzo_unitario, quantita, prezzo_totale,
                  data_acquisto, anno, mese, giorno, list_id, list_item_id, note, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
                item.name,
                fornitore,
                item.category || "ALIMENTARI",
                item.unit || "Pz",
                unitPriceNum,
                qtyNum,
                totalPriceNum,
                data_acquisto,
                anno,
                mese,
                giorno,
                item.list_id,
                item.id,
                item.notes || "",
                ts,
                ts
            );
        }
    } else if (existing) {
        db.prepare("DELETE FROM acquisti WHERE list_item_id = ?").run(item.id);
    }
}

function getLanIp(reqHost = "") {
    if (process.env.PUBLIC_HOST) {
        return process.env.PUBLIC_HOST;
    }
    const cleanHost = String(reqHost || "").split(":")[0].trim();
    if (cleanHost && cleanHost !== "localhost" && cleanHost !== "127.0.0.1" && !cleanHost.startsWith("172.")) {
        return cleanHost;
    }
    const interfaces = os.networkInterfaces();
    const candidates = [];
    for (const name of Object.keys(interfaces)) {
        for (const net of interfaces[name] || []) {
            if (net.family === "IPv4" && !net.internal && !net.address.startsWith("169.254.") && !net.address.startsWith("172.")) {
                candidates.push(net.address);
            }
        }
    }
    if (candidates.includes("192.168.20.195")) return "192.168.20.195";
    const tailscale = candidates.find((ip) => ip.startsWith("100."));
    if (tailscale) return tailscale;
    const lan = candidates.find((ip) => ip.startsWith("192.168."));
    return lan || candidates[0] || "127.0.0.1";
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
    if (!stored) return false;
    if (stored.startsWith("scrypt$")) {
        const parts = stored.split("$");
        if (parts.length !== 3) return false;
        const [, salt, originalHash] = parts;
        const hash = crypto.scryptSync(password, salt, 64).toString("hex");
        return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(originalHash, "hex"));
    }
    return false;
}

function parseCookies(req) {
    const list = {};
    const cookieHeader = req.headers?.cookie;
    if (!cookieHeader) return list;
    cookieHeader.split(";").forEach((cookie) => {
        const parts = cookie.split("=");
        const key = parts.shift().trim();
        const value = decodeURI(parts.join("="));
        list[key] = value;
    });
    return list;
}

function getAuthUser(req) {
    const cookies = parseCookies(req);
    const token = cookies["achats_sid"];
    if (!token) return null;
    const row = db
        .prepare(
            `SELECT u.id, u.username, u.display_name, u.created_at
             FROM user_sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.token = ?`
        )
        .get(token);
    return row || null;
}

function createSessionCookie(userId) {
    const token = crypto.randomBytes(32).toString("hex");
    db.prepare("INSERT INTO user_sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(
        token,
        userId,
        nowIso()
    );
    const maxAge = 365 * 24 * 60 * 60;
    return `achats_sid=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`;
}

function clearSessionCookie(req) {
    const cookies = parseCookies(req);
    const token = cookies["achats_sid"];
    if (token) {
        db.prepare("DELETE FROM user_sessions WHERE token = ?").run(token);
    }
    return "achats_sid=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax";
}

function sendJson(res, status, data, extraHeaders = {}) {
    const payload = JSON.stringify(data);
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...extraHeaders,
    });
    res.end(payload);
}

function readJsonBody(req) {
    return new Promise((resolve) => {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk.toString("utf-8");
        });
        req.on("end", () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (_) {
                resolve({});
            }
        });
    });
}

function getFornitoriList() {
    return db.prepare("SELECT id, nome, sort_order FROM fornitori ORDER BY sort_order ASC, nome COLLATE NOCASE ASC").all();
}

function getFullShoppingList(listId) {
    const lst = db
        .prepare("SELECT id, name, list_date, COALESCE(fornitore, 'Aldi') AS fornitore, created_by, created_at, updated_at FROM shopping_lists WHERE id = ?")
        .get(listId);
    if (!lst) return null;
    const categories = db
        .prepare("SELECT id, name, icon, color, sort_order, column_group FROM categories ORDER BY sort_order ASC, name ASC")
        .all();
    const fornitori = getFornitoriList();
    const items = db
        .prepare(
            `SELECT id, list_id, product_id, name, category, unit, quantity, unit_price, total_price,
                    COALESCE(fornitore, '') AS fornitore, in_list, purchased, notes, updated_at
             FROM shopping_list_items
             WHERE list_id = ?
             ORDER BY name COLLATE NOCASE ASC`
        )
        .all(listId);
    return { list: lst, categories, fornitori, items };
}

function touchList(listId) {
    db.prepare("UPDATE shopping_lists SET updated_at = ? WHERE id = ?").run(nowIso(), listId);
}

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
};

async function handleRequest(req, res) {
    try {
        const hostHeader = req.headers.host || `localhost:${PORT}`;
        const urlObj = new URL(req.url, `http://${hostHeader}`);
        const pathname = urlObj.pathname;
        const method = req.method.toUpperCase();

        // 1. Pagine e file statici
        if (method === "GET" && (pathname === "/" || pathname === "/index.html")) {
            const htmlPath = path.join(BASE_DIR, "templates", "index.html");
            const content = fs.readFileSync(htmlPath, "utf-8");
            res.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "no-store",
            });
            return res.end(content);
        }

        if (method === "GET" && pathname.startsWith("/static/")) {
            const relPath = pathname.replace(/^\/static\//, "");
            const safePath = path.normalize(path.join(BASE_DIR, "static", relPath));
            if (!safePath.startsWith(path.join(BASE_DIR, "static")) || !fs.existsSync(safePath)) {
                res.writeHead(404);
                return res.end("Not found");
            }
            const ext = path.extname(safePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || "application/octet-stream";
            res.writeHead(200, {
                "Content-Type": contentType,
                "Cache-Control": "no-store",
            });
            return res.end(fs.readFileSync(safePath));
        }

        // 2. API AUTH
        if (pathname === "/api/auth/me" && method === "GET") {
            const lanIp = getLanIp(hostHeader);
            const reqPort = hostHeader.includes(":") ? hostHeader.split(":")[1] : String(PORT);
            const serverUrl = process.env.PUBLIC_URL || `http://${lanIp}:${reqPort}`;
            const user = getAuthUser(req);
            if (!user) {
                return sendJson(res, 200, { authenticated: false, server_url: serverUrl, lan_ip: lanIp });
            }
            return sendJson(res, 200, {
                authenticated: true,
                user,
                server_url: serverUrl,
                lan_ip: lanIp,
            });
        }

        if (pathname === "/api/auth/register" && method === "POST") {
            const data = await readJsonBody(req);
            const username = String(data.username || "").trim();
            const password = String(data.password || "");
            const display_name = String(data.display_name || "").trim() || username;

            if (username.length < 2) {
                return sendJson(res, 400, { error: "Il nome utente deve contenere almeno 2 caratteri." });
            }
            if (password.length < 3) {
                return sendJson(res, 400, { error: "La password deve contenere almeno 3 caratteri." });
            }

            const existing = db.prepare("SELECT id FROM users WHERE LOWER(username) = LOWER(?)").get(username);
            if (existing) {
                return sendJson(res, 409, { error: "Questo nome utente è già registrato. Usa il login." });
            }

            const pwHash = hashPassword(password);
            const ts = nowIso();
            const info = db
                .prepare("INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)")
                .run(username, display_name, pwHash, ts);
            const userId = Number(info.lastInsertRowid);

            const cookie = createSessionCookie(userId);
            return sendJson(
                res,
                200,
                {
                    authenticated: true,
                    user: { id: userId, username, display_name },
                },
                { "Set-Cookie": cookie }
            );
        }

        if (pathname === "/api/auth/login" && method === "POST") {
            const data = await readJsonBody(req);
            const username = String(data.username || "").trim();
            const password = String(data.password || "");

            const user = db
                .prepare("SELECT id, username, display_name, password_hash FROM users WHERE LOWER(username) = LOWER(?)")
                .get(username);

            if (!user || !verifyPassword(password, user.password_hash)) {
                return sendJson(res, 401, { error: "Credenziali non valide. Verifica nome utente e password." });
            }

            const cookie = createSessionCookie(user.id);
            return sendJson(
                res,
                200,
                {
                    authenticated: true,
                    user: { id: user.id, username: user.username, display_name: user.display_name },
                },
                { "Set-Cookie": cookie }
            );
        }

        if (pathname === "/api/auth/logout" && method === "POST") {
            const cookie = clearSessionCookie(req);
            return sendJson(res, 200, { authenticated: false }, { "Set-Cookie": cookie });
        }

        // Tutte le altre API richiedono il login
        const currentUser = getAuthUser(req);
        if (!currentUser) {
            return sendJson(res, 401, { error: "Autenticazione richiesta", authenticated: false });
        }

        // =====================================================================
        // 3. FORNITORI API (Aldi, Coop, Lidl, Migros + personalizzabili)
        // =====================================================================
        if (pathname === "/api/fornitori" && method === "GET") {
            return sendJson(res, 200, getFornitoriList());
        }

        if (pathname === "/api/fornitori" && method === "POST") {
            const data = await readJsonBody(req);
            const nome = String(data.nome || "").trim();
            if (!nome) return sendJson(res, 400, { error: "Inserisci il nome del fornitore." });
            ensureSupplierExists(nome);
            return sendJson(res, 200, getFornitoriList());
        }

        const fornMatch = pathname.match(/^\/api\/fornitori\/(\d+)$/);
        if (fornMatch) {
            const fId = Number(fornMatch[1]);
            const row = db.prepare("SELECT * FROM fornitori WHERE id = ?").get(fId);
            if (!row) return sendJson(res, 404, { error: "Fornitore non trovato." });

            if (method === "PUT") {
                const data = await readJsonBody(req);
                const newNome = String(data.nome || "").trim();
                if (!newNome) return sendJson(res, 400, { error: "Inserisci il nome del fornitore." });
                db.prepare("UPDATE fornitori SET nome = ? WHERE id = ?").run(newNome, fId);
                db.prepare("UPDATE acquisti SET fornitore = ? WHERE LOWER(fornitore) = LOWER(?)").run(newNome, row.nome);
                db.prepare("UPDATE shopping_lists SET fornitore = ? WHERE LOWER(fornitore) = LOWER(?)").run(newNome, row.nome);
                db.prepare("UPDATE shopping_list_items SET fornitore = ? WHERE LOWER(fornitore) = LOWER(?)").run(newNome, row.nome);
                return sendJson(res, 200, getFornitoriList());
            }

            if (method === "DELETE") {
                db.prepare("DELETE FROM fornitori WHERE id = ?").run(fId);
                return sendJson(res, 200, getFornitoriList());
            }
        }

        // 4. CATEGORIES API
        if (pathname === "/api/categories" && method === "GET") {
            const rows = db
                .prepare("SELECT id, name, icon, color, sort_order, column_group FROM categories ORDER BY sort_order ASC, name ASC")
                .all();
            return sendJson(res, 200, rows);
        }

        if (pathname === "/api/categories" && method === "POST") {
            const data = await readJsonBody(req);
            const name = String(data.name || "").trim().toUpperCase();
            const icon = String(data.icon || "📦").trim();
            const color = String(data.color || "#0ea5e9").trim();
            if (!name) return sendJson(res, 400, { error: "Inserisci il nome del tipo/categoria." });

            const maxOrder = db.prepare("SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories").get().m;
            db.prepare(
                "INSERT OR IGNORE INTO categories (name, icon, color, sort_order, column_group) VALUES (?, ?, ?, ?, 1)"
            ).run(name, icon, color, maxOrder + 1);
            const cat = db.prepare("SELECT * FROM categories WHERE name = ?").get(name);
            return sendJson(res, 200, cat);
        }

        // 5. LISTS API
        if (pathname === "/api/lists" && method === "GET") {
            const rows = db
                .prepare(
                    `SELECT
                        l.id,
                        l.name,
                        l.list_date,
                        COALESCE(l.fornitore, 'Aldi') AS fornitore,
                        l.created_at,
                        l.updated_at,
                        COUNT(i.id) AS total_catalog_items,
                        SUM(CASE WHEN (TRIM(COALESCE(i.quantity, '')) != '' AND TRIM(COALESCE(i.quantity, '')) != '0') OR i.in_list = 1 THEN 1 ELSE 0 END) AS active_items,
                        SUM(CASE WHEN i.purchased = 1 THEN 1 ELSE 0 END) AS purchased_items
                    FROM shopping_lists l
                    LEFT JOIN shopping_list_items i ON i.list_id = l.id
                    GROUP BY l.id
                    ORDER BY l.list_date DESC, l.id DESC`
                )
                .all();
            return sendJson(res, 200, rows);
        }

        if (pathname === "/api/lists" && method === "POST") {
            const data = await readJsonBody(req);
            const list_date = String(data.list_date || "").trim() || todayIso();
            const name = String(data.name || "").trim() || "Lista Supermercato";
            const fornitore = ensureSupplierExists(data.fornitore || "Aldi");
            const mode = String(data.mode || "template").trim();
            const source_list_id = data.source_list_id;
            const ts = nowIso();

            const info = db
                .prepare("INSERT INTO shopping_lists (name, list_date, fornitore, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
                .run(name, list_date, fornitore, currentUser.id, ts, ts);
            const newListId = Number(info.lastInsertRowid);

            const insertItem = db.prepare(
                `INSERT INTO shopping_list_items
                 (list_id, product_id, name, category, unit, quantity, unit_price, total_price, fornitore, in_list, purchased, notes, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
            );

            if (mode === "copy" && source_list_id) {
                const srcItems = db
                    .prepare(
                        "SELECT product_id, name, category, unit, quantity, unit_price, total_price, fornitore, in_list FROM shopping_list_items WHERE list_id = ?"
                    )
                    .all(source_list_id);
                for (const it of srcItems) {
                    // In una lista nuova il commento (notes) deve sempre sparire ('')
                    insertItem.run(
                        newListId,
                        it.product_id,
                        it.name,
                        it.category,
                        it.unit,
                        it.quantity,
                        it.unit_price || 0,
                        it.total_price || 0,
                        it.fornitore || fornitore,
                        it.in_list,
                        "",
                        ts
                    );
                }
            } else if (mode !== "empty") {
                const prods = db
                    .prepare(
                        "SELECT id, name, category, default_unit, COALESCE(last_unit_price, 0) AS last_unit_price, COALESCE(last_fornitore, '') AS last_fornitore FROM catalog_products ORDER BY category ASC, name COLLATE NOCASE ASC"
                    )
                    .all();
                for (const p of prods) {
                    insertItem.run(
                        newListId,
                        p.id,
                        p.name,
                        p.category,
                        p.default_unit,
                        "",
                        p.last_unit_price || 0,
                        0,
                        p.last_fornitore || fornitore,
                        0,
                        "",
                        ts
                    );
                }
            }

            return sendJson(res, 200, getFullShoppingList(newListId));
        }

        // Match /api/lists/:id/version
        const versionMatch = pathname.match(/^\/api\/lists\/(\d+)\/version$/);
        if (versionMatch && method === "GET") {
            const listId = Number(versionMatch[1]);
            const row = db
                .prepare("SELECT id, updated_at, list_date, name, COALESCE(fornitore, 'Aldi') AS fornitore FROM shopping_lists WHERE id = ?")
                .get(listId);
            if (!row) return sendJson(res, 404, { error: "Lista non trovata." });
            return sendJson(res, 200, row);
        }

        // Match /api/lists/:id/pdf
        const pdfMatch = pathname.match(/^\/api\/lists\/(\d+)\/pdf$/);
        if (pdfMatch && method === "GET") {
            const listId = Number(pdfMatch[1]);
            const payload = getFullShoppingList(listId);
            if (!payload) return sendJson(res, 404, { error: "Lista non trovata." });

            const filterMode = urlObj.searchParams.get("filter") || "all";
            const selectedCategory = (urlObj.searchParams.get("category") || "ALL").toUpperCase();
            const sortMode = urlObj.searchParams.get("sort") || "type_alpha";
            const searchQuery = (urlObj.searchParams.get("q") || "").trim().toLowerCase();

            const isItemActive = (item) => {
                const q = String(item.quantity || "").trim();
                return (q !== "" && q !== "0") || item.in_list === 1 || item.purchased === 1;
            };

            const filteredItems = payload.items.filter((item) => {
                if (selectedCategory !== "ALL" && String(item.category || "").toUpperCase() !== selectedCategory) {
                    return false;
                }
                if (filterMode === "active" && !isItemActive(item)) {
                    return false;
                }
                if (filterMode === "purchased" && item.purchased !== 1) {
                    return false;
                }
                if (
                    searchQuery &&
                    !String(item.name || "").toLowerCase().includes(searchQuery) &&
                    !String(item.category || "").toLowerCase().includes(searchQuery)
                ) {
                    return false;
                }
                return true;
            });

            const pdfBuffer = generateShoppingListPdf({
                list: payload.list,
                categories: payload.categories,
                items: filteredItems,
                filterMode,
                selectedCategory,
                sortMode,
                searchQuery,
            });

            const suffixMap = {
                all: "Completa",
                active: "Solo_in_Lista",
                purchased: "Acquistati",
            };
            const suffix = suffixMap[filterMode] || "Lista";
            const catSuffix = selectedCategory !== "ALL" ? `_${selectedCategory.replace(/[^A-Z0-9]/gi, "")}` : "";
            const safeDate = String(payload.list.list_date || todayIso()).replace(/[^0-9-]/g, "");
            const fileName = `Lista_Supermercato_${safeDate}_${suffix}${catSuffix}.pdf`;

            res.writeHead(200, {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${fileName}"`,
                "Content-Length": pdfBuffer.length,
                "Cache-Control": "no-store",
            });
            return res.end(pdfBuffer);
        }

        // Match /api/lists/:id/reset-excel
        const resetMatch = pathname.match(/^\/api\/lists\/(\d+)\/reset-excel$/);
        if (resetMatch && method === "POST") {
            const listId = Number(resetMatch[1]);
            const lst = db.prepare("SELECT COALESCE(fornitore, 'Aldi') AS fornitore FROM shopping_lists WHERE id = ?").get(listId);
            const existingNames = new Set(
                db
                    .prepare("SELECT name FROM shopping_list_items WHERE list_id = ?")
                    .all(listId)
                    .map((r) => r.name.trim().toLowerCase())
            );
            const catalogProds = db
                .prepare("SELECT id, name, category, default_unit, COALESCE(last_unit_price, 0) AS last_unit_price, COALESCE(last_fornitore, '') AS last_fornitore FROM catalog_products")
                .all();
            const insertItem = db.prepare(
                `INSERT INTO shopping_list_items
                 (list_id, product_id, name, category, unit, quantity, unit_price, total_price, fornitore, in_list, purchased, notes, updated_at)
                 VALUES (?, ?, ?, ?, ?, '', ?, 0, ?, 0, 0, '', ?)`
            );
            const ts = nowIso();
            for (const p of catalogProds) {
                if (!existingNames.has(p.name.trim().toLowerCase())) {
                    insertItem.run(
                        listId,
                        p.id,
                        p.name,
                        p.category,
                        p.default_unit,
                        p.last_unit_price || 0,
                        p.last_fornitore || lst?.fornitore || "Aldi",
                        ts
                    );
                }
            }
            touchList(listId);
            return sendJson(res, 200, getFullShoppingList(listId));
        }

        // Match /api/lists/:id/items
        const listItemsMatch = pathname.match(/^\/api\/lists\/(\d+)\/items$/);
        if (listItemsMatch && method === "POST") {
            const listId = Number(listItemsMatch[1]);
            const parentList = db.prepare("SELECT * FROM shopping_lists WHERE id = ?").get(listId);
            const data = await readJsonBody(req);
            const name = String(data.name || "").trim();
            const category = String(data.category || "ALIMENTARI").trim().toUpperCase();
            const unit = String(data.unit || "").trim();
            const quantity = String(data.quantity ?? "").trim();
            const unit_price = roundMoney(parseNumber(data.unit_price, 0));
            const qtyNum = parseNumber(quantity, 0);
            const total_price = roundMoney(qtyNum * unit_price);
            const fornitore = ensureSupplierExists(data.fornitore || parentList?.fornitore || "Aldi");
            const save_to_catalog = data.save_to_catalog !== false;
            const notes = String(data.notes || "").trim();

            if (!name) return sendJson(res, 400, { error: "Inserisci il nome del prodotto." });

            const ts = nowIso();
            db.prepare(
                "INSERT OR IGNORE INTO categories (name, icon, color, sort_order, column_group) VALUES (?, '📦', '#0ea5e9', 10, 1)"
            ).run(category);

            let productId = null;
            if (save_to_catalog) {
                const existingProd = db.prepare("SELECT id FROM catalog_products WHERE LOWER(name) = LOWER(?)").get(name);
                if (existingProd) {
                    productId = existingProd.id;
                    db.prepare(
                        "UPDATE catalog_products SET category = ?, default_unit = ?, last_fornitore = ?, last_unit_price = CASE WHEN ? > 0 THEN ? ELSE last_unit_price END WHERE id = ?"
                    ).run(category, unit, fornitore, unit_price, unit_price, productId);
                } else {
                    const pInfo = db
                        .prepare("INSERT INTO catalog_products (name, category, default_unit, last_unit_price, last_fornitore, created_at) VALUES (?, ?, ?, ?, ?, ?)")
                        .run(name, category, unit, unit_price, fornitore, ts);
                    productId = Number(pInfo.lastInsertRowid);
                }
            }

            const in_list = (quantity !== "" && quantity !== "0") || data.in_list ? 1 : 0;
            const iInfo = db
                .prepare(
                    `INSERT INTO shopping_list_items
                     (list_id, product_id, name, category, unit, quantity, unit_price, total_price, fornitore, in_list, purchased, notes, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
                )
                .run(listId, productId, name, category, unit, quantity, unit_price, total_price, fornitore, in_list, notes, ts);

            touchList(listId);
            const item = db.prepare("SELECT * FROM shopping_list_items WHERE id = ?").get(Number(iInfo.lastInsertRowid));
            return sendJson(res, 200, item);
        }

        // Match /api/lists/:id
        const singleListMatch = pathname.match(/^\/api\/lists\/(\d+)$/);
        if (singleListMatch) {
            const listId = Number(singleListMatch[1]);
            if (method === "GET") {
                const payload = getFullShoppingList(listId);
                if (!payload) return sendJson(res, 404, { error: "Lista non trovata." });
                return sendJson(res, 200, payload);
            }
            if (method === "PUT") {
                const data = await readJsonBody(req);
                const lst = db.prepare("SELECT * FROM shopping_lists WHERE id = ?").get(listId);
                if (!lst) return sendJson(res, 404, { error: "Lista non trovata." });

                const name = ("name" in data ? String(data.name).trim() : lst.name) || "Lista Supermercato";
                const list_date = ("list_date" in data ? String(data.list_date).trim() : lst.list_date) || lst.list_date;
                const fornitore = "fornitore" in data ? ensureSupplierExists(data.fornitore) : lst.fornitore || "Aldi";
                const ts = nowIso();

                db.prepare("UPDATE shopping_lists SET name = ?, list_date = ?, fornitore = ?, updated_at = ? WHERE id = ?").run(
                    name,
                    list_date,
                    fornitore,
                    ts,
                    listId
                );

                // Se cambia il fornitore predefinito della lista, aggiorna le voci della lista e gli acquisti collegati
                if ("fornitore" in data) {
                    db.prepare("UPDATE shopping_list_items SET fornitore = ? WHERE list_id = ?").run(fornitore, listId);
                    db.prepare("UPDATE acquisti SET fornitore = ?, updated_at = ? WHERE list_id = ?").run(fornitore, ts, listId);
                }

                if ("list_date" in data && list_date !== lst.list_date) {
                    const { data_acquisto, anno, mese, giorno } = extractDateParts(list_date);
                    db.prepare(
                        "UPDATE acquisti SET data_acquisto = ?, anno = ?, mese = ?, giorno = ?, updated_at = ? WHERE list_id = ?"
                    ).run(data_acquisto, anno, mese, giorno, ts, listId);
                }

                if (data.action === "clear_purchased") {
                    db.prepare("UPDATE shopping_list_items SET purchased = 0, updated_at = ? WHERE list_id = ?").run(ts, listId);
                } else if (data.action === "clear_quantities") {
                    db.prepare(
                        "UPDATE shopping_list_items SET quantity = '', total_price = 0, notes = '', in_list = 0, purchased = 0, updated_at = ? WHERE list_id = ?"
                    ).run(ts, listId);
                }
                return sendJson(res, 200, getFullShoppingList(listId));
            }
            if (method === "DELETE") {
                db.prepare("DELETE FROM shopping_lists WHERE id = ?").run(listId);
                let remaining = db.prepare("SELECT id FROM shopping_lists ORDER BY list_date DESC, id DESC LIMIT 1").get();
                if (!remaining) {
                    const ts = nowIso();
                    const info = db
                        .prepare("INSERT INTO shopping_lists (name, list_date, fornitore, created_by, created_at, updated_at) VALUES (?, ?, 'Aldi', ?, ?, ?)")
                        .run("Lista Supermercato", todayIso(), currentUser.id, ts, ts);
                    const newId = Number(info.lastInsertRowid);
                    const prods = db.prepare("SELECT id, name, category, default_unit, COALESCE(last_unit_price, 0) AS last_unit_price FROM catalog_products").all();
                    const ins = db.prepare(
                        "INSERT INTO shopping_list_items (list_id, product_id, name, category, unit, quantity, unit_price, total_price, fornitore, in_list, purchased, notes, updated_at) VALUES (?, ?, ?, ?, ?, '', ?, 0, 'Aldi', 0, 0, '', ?)"
                    );
                    for (const p of prods) ins.run(newId, p.id, p.name, p.category, p.default_unit, p.last_unit_price || 0, ts);
                    remaining = { id: newId };
                }
                return sendJson(res, 200, { deleted: true, next_list_id: remaining.id });
            }
        }

        // Match /api/items/:id
        const itemMatch = pathname.match(/^\/api\/items\/(\d+)$/);
        if (itemMatch) {
            const itemId = Number(itemMatch[1]);
            const item = db.prepare("SELECT * FROM shopping_list_items WHERE id = ?").get(itemId);
            if (!item) return sendJson(res, 404, { error: "Prodotto non trovato." });

            if (method === "PUT") {
                const data = await readJsonBody(req);
                const parentList = db.prepare("SELECT * FROM shopping_lists WHERE id = ?").get(item.list_id);
                const name = ("name" in data ? String(data.name).trim() : item.name) || item.name;
                const category = ("category" in data ? String(data.category).trim().toUpperCase() : item.category) || item.category;
                const unit = "unit" in data ? String(data.unit).trim() : item.unit;
                const notes = "notes" in data ? String(data.notes).trim() : item.notes;
                const quantity = "quantity" in data ? String(data.quantity ?? "").trim() : item.quantity;
                const unit_price = "unit_price" in data ? roundMoney(parseNumber(data.unit_price, 0)) : roundMoney(parseNumber(item.unit_price, 0));
                const fornitore =
                    "fornitore" in data && String(data.fornitore || "").trim()
                        ? ensureSupplierExists(data.fornitore)
                        : item.fornitore || parentList?.fornitore || "Aldi";

                const qtyNum = parseNumber(quantity, 0);
                const total_price = roundMoney(qtyNum * unit_price);

                let in_list = item.in_list;
                if ("in_list" in data) {
                    in_list = data.in_list ? 1 : 0;
                } else if ("quantity" in data) {
                    in_list = quantity !== "" && quantity !== "0" ? 1 : 0;
                }

                let purchased = item.purchased;
                if ("purchased" in data) {
                    purchased = data.purchased ? 1 : 0;
                    if (purchased === 1 && in_list === 0) in_list = 1;
                } else if ("quantity" in data && (quantity === "" || quantity === "0")) {
                    purchased = 0;
                }

                const ts = nowIso();
                db.prepare(
                    "INSERT OR IGNORE INTO categories (name, icon, color, sort_order, column_group) VALUES (?, '📦', '#0ea5e9', 10, 1)"
                ).run(category);

                db.prepare(
                    `UPDATE shopping_list_items
                     SET name = ?, category = ?, unit = ?, quantity = ?, unit_price = ?, total_price = ?, fornitore = ?, in_list = ?, purchased = ?, notes = ?, updated_at = ?
                     WHERE id = ?`
                ).run(name, category, unit, quantity, unit_price, total_price, fornitore, in_list, purchased, notes, ts, itemId);

                if (item.product_id && ("name" in data || "category" in data || "unit" in data || "unit_price" in data || "fornitore" in data)) {
                    db.prepare(
                        `UPDATE catalog_products
                         SET name = ?, category = ?, default_unit = ?, last_fornitore = ?,
                             last_unit_price = CASE WHEN ? > 0 THEN ? ELSE last_unit_price END
                         WHERE id = ?`
                    ).run(name, category, unit, fornitore, unit_price, unit_price, item.product_id);
                }

                touchList(item.list_id);
                const updated = db.prepare("SELECT * FROM shopping_list_items WHERE id = ?").get(itemId);
                syncListItemToAcquisti(updated, parentList);

                return sendJson(res, 200, updated);
            }

            if (method === "DELETE") {
                const deleteFromCatalog = urlObj.searchParams.get("catalog") === "1";
                db.prepare("DELETE FROM acquisti WHERE list_item_id = ?").run(itemId);
                db.prepare("DELETE FROM shopping_list_items WHERE id = ?").run(itemId);
                if (deleteFromCatalog && item.product_id) {
                    db.prepare("DELETE FROM catalog_products WHERE id = ?").run(item.product_id);
                }
                touchList(item.list_id);
                return sendJson(res, 200, { deleted: true, id: itemId });
            }
        }

        // =====================================================================
        // 6. TABELLA PRINCIPALE ACQUISTI API (Descrizione, Fornitore, Prezzo unitario, Quantità, Prezzo totale, Data, Anno/Mese/Giorno)
        // =====================================================================
        if (pathname === "/api/acquisti" && method === "GET") {
            const filterAnno = (urlObj.searchParams.get("anno") || "").trim();
            const filterMese = (urlObj.searchParams.get("mese") || "").trim();
            const filterGiorno = (urlObj.searchParams.get("giorno") || "").trim();
            const filterFornitore = (urlObj.searchParams.get("fornitore") || "").trim();
            const q = (urlObj.searchParams.get("q") || "").trim().toLowerCase();

            const clauses = [];
            const params = [];
            if (filterAnno) {
                clauses.push("anno = ?");
                params.push(Number(filterAnno));
            }
            if (filterMese) {
                if (filterMese.includes("-")) {
                    clauses.push("mese = ?");
                    params.push(filterMese);
                } else {
                    clauses.push("SUBSTR(mese, 6, 2) = ?");
                    params.push(filterMese.padStart(2, "0"));
                }
            }
            if (filterGiorno) {
                clauses.push("giorno = ?");
                params.push(filterGiorno);
            }
            if (filterFornitore) {
                clauses.push("LOWER(fornitore) = LOWER(?)");
                params.push(filterFornitore);
            }
            if (q) {
                clauses.push("(LOWER(descrizione_prodotto) LIKE ? OR LOWER(categoria) LIKE ? OR LOWER(fornitore) LIKE ?)");
                params.push(`%${q}%`, `%${q}%`, `%${q}%`);
            }

            const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
            const rows = db
                .prepare(
                    `SELECT id, descrizione_prodotto, COALESCE(fornitore, 'Aldi') AS fornitore, categoria, unita,
                            prezzo_unitario, quantita, prezzo_totale,
                            data_acquisto, anno, mese, giorno, list_id, list_item_id, note, created_at, updated_at
                     FROM acquisti
                     ${whereSql}
                     ORDER BY data_acquisto DESC, descrizione_prodotto COLLATE NOCASE ASC, id DESC`
                )
                .all(...params);

            const availableYears = db.prepare("SELECT DISTINCT anno FROM acquisti ORDER BY anno DESC").all().map((r) => r.anno);
            const catalogSuggestions = db
                .prepare(
                    "SELECT name, category, default_unit, COALESCE(last_unit_price, 0) AS last_unit_price, COALESCE(last_fornitore, 'Aldi') AS last_fornitore FROM catalog_products ORDER BY name COLLATE NOCASE ASC"
                )
                .all();

            return sendJson(res, 200, {
                items: rows,
                fornitori: getFornitoriList(),
                available_years: availableYears,
                catalog_suggestions: catalogSuggestions,
            });
        }

        if (pathname === "/api/acquisti" && method === "POST") {
            const data = await readJsonBody(req);
            const descrizione_prodotto = String(data.descrizione_prodotto || "").trim();
            if (!descrizione_prodotto) {
                return sendJson(res, 400, { error: "Inserisci la descrizione del prodotto." });
            }
            const fornitore = ensureSupplierExists(data.fornitore || "Aldi");
            const categoria = String(data.categoria || "ALIMENTARI").trim().toUpperCase();
            const unita = String(data.unita || "Pz").trim();
            const prezzo_unitario = roundMoney(parseNumber(data.prezzo_unitario, 0));
            const quantita = parseNumber(data.quantita, 1);
            const prezzo_totale = roundMoney(quantita * prezzo_unitario);
            const { data_acquisto, anno, mese, giorno } = extractDateParts(data.data_acquisto);
            const note = String(data.note || "").trim();
            const ts = nowIso();

            const info = db
                .prepare(
                    `INSERT INTO acquisti
                     (descrizione_prodotto, fornitore, categoria, unita, prezzo_unitario, quantita, prezzo_totale,
                      data_acquisto, anno, mese, giorno, list_id, list_item_id, note, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`
                )
                .run(
                    descrizione_prodotto,
                    fornitore,
                    categoria,
                    unita,
                    prezzo_unitario,
                    quantita,
                    prezzo_totale,
                    data_acquisto,
                    anno,
                    mese,
                    giorno,
                    note,
                    ts,
                    ts
                );

            db.prepare(
                "UPDATE catalog_products SET last_fornitore = ?, last_unit_price = CASE WHEN ? > 0 THEN ? ELSE last_unit_price END WHERE LOWER(name) = LOWER(?)"
            ).run(fornitore, prezzo_unitario, prezzo_unitario, descrizione_prodotto);

            const created = db.prepare("SELECT * FROM acquisti WHERE id = ?").get(Number(info.lastInsertRowid));
            return sendJson(res, 200, created);
        }

        if (pathname === "/api/acquisti/import-list" && method === "POST") {
            const data = await readJsonBody(req);
            const listId = Number(data.list_id);
            const mode = data.mode || "active";
            const lst = db.prepare("SELECT * FROM shopping_lists WHERE id = ?").get(listId);
            if (!lst) return sendJson(res, 404, { error: "Lista non trovata." });

            const items = db.prepare("SELECT * FROM shopping_list_items WHERE list_id = ?").all(listId);
            const { data_acquisto, anno, mese, giorno } = extractDateParts(lst.list_date);
            const defaultFornitore = ensureSupplierExists(lst.fornitore || "Aldi");
            const ts = nowIso();
            let importedCount = 0;

            for (const item of items) {
                const qStr = String(item.quantity || "").trim();
                const hasQty = qStr !== "" && qStr !== "0";
                const isEligible = mode === "purchased" ? item.purchased === 1 : hasQty || item.in_list === 1 || item.purchased === 1;
                if (!isEligible) continue;

                const qtyNum = parseNumber(item.quantity, 1) || 1;
                const unitPriceNum = roundMoney(parseNumber(item.unit_price, 0));
                const totalPriceNum = roundMoney(qtyNum * unitPriceNum);
                const itemFornitore = ensureSupplierExists(item.fornitore || defaultFornitore);

                const existing = db.prepare("SELECT id FROM acquisti WHERE list_item_id = ?").get(item.id);
                if (existing) {
                    db.prepare(
                        `UPDATE acquisti
                         SET descrizione_prodotto = ?, fornitore = ?, categoria = ?, unita = ?, prezzo_unitario = ?, quantita = ?, prezzo_totale = ?,
                             data_acquisto = ?, anno = ?, mese = ?, giorno = ?, note = ?, updated_at = ?
                         WHERE id = ?`
                    ).run(
                        item.name,
                        itemFornitore,
                        item.category || "ALIMENTARI",
                        item.unit || "Pz",
                        unitPriceNum,
                        qtyNum,
                        totalPriceNum,
                        data_acquisto,
                        anno,
                        mese,
                        giorno,
                        item.notes || "",
                        ts,
                        existing.id
                    );
                } else {
                    db.prepare(
                        `INSERT INTO acquisti
                         (descrizione_prodotto, fornitore, categoria, unita, prezzo_unitario, quantita, prezzo_totale,
                          data_acquisto, anno, mese, giorno, list_id, list_item_id, note, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                    ).run(
                        item.name,
                        itemFornitore,
                        item.category || "ALIMENTARI",
                        item.unit || "Pz",
                        unitPriceNum,
                        qtyNum,
                        totalPriceNum,
                        data_acquisto,
                        anno,
                        mese,
                        giorno,
                        listId,
                        item.id,
                        item.notes || "",
                        ts,
                        ts
                    );
                }
                importedCount++;
            }

            return sendJson(res, 200, { imported: importedCount, list_date: data_acquisto });
        }

        if (pathname === "/api/acquisti/pdf" && method === "GET") {
            const filterAnno = (urlObj.searchParams.get("anno") || "").trim();
            const filterMese = (urlObj.searchParams.get("mese") || "").trim();
            const filterGiorno = (urlObj.searchParams.get("giorno") || "").trim();
            const filterFornitore = (urlObj.searchParams.get("fornitore") || "").trim();
            const groupBy = (urlObj.searchParams.get("group_by") || "day").trim();
            const q = (urlObj.searchParams.get("q") || "").trim().toLowerCase();

            const clauses = [];
            const params = [];
            if (filterAnno) {
                clauses.push("anno = ?");
                params.push(Number(filterAnno));
            }
            if (filterMese) {
                if (filterMese.includes("-")) {
                    clauses.push("mese = ?");
                    params.push(filterMese);
                } else {
                    clauses.push("SUBSTR(mese, 6, 2) = ?");
                    params.push(filterMese.padStart(2, "0"));
                }
            }
            if (filterGiorno) {
                clauses.push("giorno = ?");
                params.push(filterGiorno);
            }
            if (filterFornitore) {
                clauses.push("LOWER(fornitore) = LOWER(?)");
                params.push(filterFornitore);
            }
            if (q) {
                clauses.push("(LOWER(descrizione_prodotto) LIKE ? OR LOWER(categoria) LIKE ? OR LOWER(fornitore) LIKE ?)");
                params.push(`%${q}%`, `%${q}%`, `%${q}%`);
            }

            const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
            const rows = db
                .prepare(
                    `SELECT * FROM acquisti ${whereSql} ORDER BY data_acquisto DESC, descrizione_prodotto COLLATE NOCASE ASC, id DESC`
                )
                .all(...params);

            const pdfBuffer = generatePurchasesPdf({
                purchases: rows,
                groupBy,
                filterYear: filterAnno,
                filterMonth: filterMese,
                filterDate: filterGiorno,
                filterSupplier: filterFornitore,
                searchQuery: q,
            });

            const fileName = `Registro_Acquisti_${todayIso()}_${groupBy}.pdf`;
            res.writeHead(200, {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="${fileName}"`,
                "Content-Length": pdfBuffer.length,
                "Cache-Control": "no-store",
            });
            return res.end(pdfBuffer);
        }

        const singleAcquistoMatch = pathname.match(/^\/api\/acquisti\/(\d+)$/);
        if (singleAcquistoMatch) {
            const acqId = Number(singleAcquistoMatch[1]);
            const row = db.prepare("SELECT * FROM acquisti WHERE id = ?").get(acqId);
            if (!row) return sendJson(res, 404, { error: "Record acquisto non trovato." });

            if (method === "PUT") {
                const data = await readJsonBody(req);
                const descrizione_prodotto =
                    ("descrizione_prodotto" in data ? String(data.descrizione_prodotto).trim() : row.descrizione_prodotto) ||
                    row.descrizione_prodotto;
                const fornitore =
                    "fornitore" in data && String(data.fornitore || "").trim()
                        ? ensureSupplierExists(data.fornitore)
                        : row.fornitore || "Aldi";
                const categoria =
                    ("categoria" in data ? String(data.categoria).trim().toUpperCase() : row.categoria) || "ALIMENTARI";
                const unita = "unita" in data ? String(data.unita).trim() : row.unita;
                const prezzo_unitario =
                    "prezzo_unitario" in data ? roundMoney(parseNumber(data.prezzo_unitario, 0)) : row.prezzo_unitario;
                const quantita = "quantita" in data ? parseNumber(data.quantita, 1) : row.quantita;
                const prezzo_totale = roundMoney(quantita * prezzo_unitario);
                const dateInput = "data_acquisto" in data ? data.data_acquisto : row.data_acquisto;
                const { data_acquisto, anno, mese, giorno } = extractDateParts(dateInput);
                const note = "note" in data ? String(data.note).trim() : row.note;
                const ts = nowIso();

                db.prepare(
                    `UPDATE acquisti
                     SET descrizione_prodotto = ?, fornitore = ?, categoria = ?, unita = ?, prezzo_unitario = ?, quantita = ?, prezzo_totale = ?,
                         data_acquisto = ?, anno = ?, mese = ?, giorno = ?, note = ?, updated_at = ?
                     WHERE id = ?`
                ).run(
                    descrizione_prodotto,
                    fornitore,
                    categoria,
                    unita,
                    prezzo_unitario,
                    quantita,
                    prezzo_totale,
                    data_acquisto,
                    anno,
                    mese,
                    giorno,
                    note,
                    ts,
                    acqId
                );

                if (row.list_item_id) {
                    db.prepare(
                        "UPDATE shopping_list_items SET fornitore = ?, unit_price = ?, total_price = ?, notes = ?, updated_at = ? WHERE id = ?"
                    ).run(fornitore, prezzo_unitario, prezzo_totale, note, ts, row.list_item_id);
                }
                db.prepare(
                    "UPDATE catalog_products SET last_fornitore = ?, last_unit_price = CASE WHEN ? > 0 THEN ? ELSE last_unit_price END WHERE LOWER(name) = LOWER(?)"
                ).run(fornitore, prezzo_unitario, prezzo_unitario, descrizione_prodotto);

                const updated = db.prepare("SELECT * FROM acquisti WHERE id = ?").get(acqId);
                return sendJson(res, 200, updated);
            }

            if (method === "DELETE") {
                db.prepare("DELETE FROM acquisti WHERE id = ?").run(acqId);
                return sendJson(res, 200, { deleted: true, id: acqId });
            }
        }

        return sendJson(res, 404, { error: "Endpoint non trovato" });
    } catch (err) {
        console.error("Server error:", err);
        return sendJson(res, 500, { error: err.message || "Errore interno del server" });
    }
}

const serverPrimary = http.createServer(handleRequest);
serverPrimary.listen(PORT, "0.0.0.0", () => {
    const lanIp = getLanIp();
    console.log("================================================================");
    console.log(" [OK] SERVER ACHATS (Node.js) ATTIVO IN RETE LOCALE!");
    console.log(` [PC]  http://localhost:${PORT}`);
    console.log(` [LAN] http://${lanIp}:${PORT}`);
    console.log("================================================================");
});
