import os
import glob
import sqlite3
import socket
from datetime import datetime, date, timedelta
from functools import wraps
from flask import Flask, request, jsonify, session, render_template
from werkzeug.security import generate_password_hash, check_password_hash
import openpyxl

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.path.join(BASE_DIR, "achats.db")

app = Flask(__name__)
app.secret_key = os.environ.get("ACHATS_SECRET_KEY", "achats-supermarche-local-secret-key-2026")
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=365)
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"


def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def now_iso():
    return datetime.now().isoformat(timespec="seconds")


def parse_excel_catalog():
    """Legge il file 'Liste supermarché.xlsx' presente nella cartella e restituisce i prodotti divisi per tipo."""
    xlsx_files = glob.glob(os.path.join(BASE_DIR, "*.xlsx"))
    if not xlsx_files:
        return []

    xlsx_path = xlsx_files[0]
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb.active

    items = []
    # Colonna B (2) = Nome, Colonna C (3) & D (4) = Unità/Quantità
    # Righe 2..45: VERDURA, Righe 49..56: PULIZIA E CASA
    # Colonna E (5) = Nome, Colonna F (6) = Unità/Quantità
    # Righe 2..12: FRUTTA, Righe 14..57: ALIMENTARI
    for r in range(2, ws.max_row + 1):
        name_left = ws.cell(r, 2).value
        unit_left_1 = ws.cell(r, 3).value
        unit_left_2 = ws.cell(r, 4).value
        if name_left and str(name_left).strip():
            cat = "VERDURA" if r < 47 else "PULIZIA E CASA"
            u1 = str(unit_left_1).strip() if unit_left_1 else ""
            u2 = str(unit_left_2).strip() if unit_left_2 else ""
            unit = f"{u1}/{u2}" if (u1 and u2) else (u1 or u2)
            items.append({
                "name": str(name_left).strip(),
                "category": cat,
                "default_unit": unit,
            })

        name_right = ws.cell(r, 5).value
        unit_right = ws.cell(r, 6).value
        if name_right and str(name_right).strip():
            cat = "FRUTTA" if r < 13 else "ALIMENTARI"
            u = str(unit_right).strip() if unit_right else ""
            items.append({
                "name": str(name_right).strip(),
                "category": cat,
                "default_unit": u,
            })

    return items


DEFAULT_CATEGORIES = [
    {"name": "VERDURA", "icon": "🥬", "color": "#16a34a", "sort_order": 1, "column_group": 1},
    {"name": "FRUTTA", "icon": "🍎", "color": "#ea580c", "sort_order": 2, "column_group": 2},
    {"name": "ALIMENTARI", "icon": "🧀", "color": "#2563eb", "sort_order": 3, "column_group": 2},
    {"name": "PULIZIA E CASA", "icon": "🧼", "color": "#7c3aed", "sort_order": 4, "column_group": 1},
]


def init_db():
    conn = get_db()
    cur = conn.cursor()

    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL COLLATE NOCASE,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
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
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS shopping_lists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            list_date TEXT NOT NULL,
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
            in_list INTEGER DEFAULT 0,
            purchased INTEGER DEFAULT 0,
            notes TEXT DEFAULT '',
            updated_at TEXT NOT NULL,
            FOREIGN KEY (list_id) REFERENCES shopping_lists(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES catalog_products(id) ON DELETE SET NULL
        );
        """
    )

    # Popola categorie predefinite
    for cat in DEFAULT_CATEGORIES:
        cur.execute(
            """
            INSERT OR IGNORE INTO categories (name, icon, color, sort_order, column_group)
            VALUES (?, ?, ?, ?, ?)
            """,
            (cat["name"], cat["icon"], cat["color"], cat["sort_order"], cat["column_group"]),
        )

    # Popola il catalogo base dal file Excel se vuoto
    cur.execute("SELECT COUNT(*) AS cnt FROM catalog_products")
    if cur.fetchone()["cnt"] == 0:
        excel_items = parse_excel_catalog()
        ts = now_iso()
        for item in excel_items:
            cur.execute(
                """
                INSERT INTO catalog_products (name, category, default_unit, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (item["name"], item["category"], item["default_unit"], ts),
            )

    # Se non esiste alcuna lista, creiamo una lista iniziale con la data odierna
    cur.execute("SELECT COUNT(*) AS cnt FROM shopping_lists")
    if cur.fetchone()["cnt"] == 0:
        today_str = date.today().isoformat()
        ts = now_iso()
        cur.execute(
            """
            INSERT INTO shopping_lists (name, list_date, created_by, created_at, updated_at)
            VALUES (?, ?, NULL, ?, ?)
            """,
            ("Lista Supermercato", today_str, ts, ts),
        )
        list_id = cur.lastrowid
        cur.execute("SELECT id, name, category, default_unit FROM catalog_products")
        for prod in cur.fetchall():
            cur.execute(
                """
                INSERT INTO shopping_list_items
                (list_id, product_id, name, category, unit, quantity, in_list, purchased, notes, updated_at)
                VALUES (?, ?, ?, ?, ?, '', 0, 0, '', ?)
                """,
                (list_id, prod["id"], prod["name"], prod["category"], prod["default_unit"], ts),
            )

    conn.commit()
    conn.close()


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        user_id = session.get("user_id")
        if not user_id:
            return jsonify({"error": "Autenticazione richiesta", "authenticated": False}), 401
        conn = get_db()
        user = conn.execute(
            "SELECT id, username, display_name FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        conn.close()
        if not user:
            session.clear()
            return jsonify({"error": "Sessione non valida", "authenticated": False}), 401
        request.current_user = dict(user)
        return f(*args, **kwargs)

    return decorated


def touch_list(conn, list_id):
    conn.execute(
        "UPDATE shopping_lists SET updated_at = ? WHERE id = ?",
        (now_iso(), list_id),
    )


@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# AUTH API
# ---------------------------------------------------------------------------
@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    lan_ip = get_lan_ip()
    port = request.host.split(":")[1] if ":" in request.host else "8090"
    server_url = f"http://{lan_ip}:{port}"

    user_id = session.get("user_id")
    if not user_id:
        return jsonify({
            "authenticated": False,
            "server_url": server_url,
            "lan_ip": lan_ip,
        })

    conn = get_db()
    user = conn.execute(
        "SELECT id, username, display_name, created_at FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    conn.close()

    if not user:
        session.clear()
        return jsonify({
            "authenticated": False,
            "server_url": server_url,
            "lan_ip": lan_ip,
        })

    return jsonify({
        "authenticated": True,
        "user": dict(user),
        "server_url": server_url,
        "lan_ip": lan_ip,
    })


@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    data = request.get_json(force=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    display_name = (data.get("display_name") or "").strip() or username

    if len(username) < 2:
        return jsonify({"error": "Il nome utente deve contenere almeno 2 caratteri."}), 400
    if len(password) < 3:
        return jsonify({"error": "La password deve contenere almeno 3 caratteri."}), 400

    conn = get_db()
    existing = conn.execute(
        "SELECT id FROM users WHERE username = ?", (username,)
    ).fetchone()
    if existing:
        conn.close()
        return jsonify({"error": "Questo nome utente è già registrato. Usa il login."}), 409

    pw_hash = generate_password_hash(password)
    ts = now_iso()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO users (username, display_name, password_hash, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (username, display_name, pw_hash, ts),
    )
    user_id = cur.lastrowid
    conn.commit()
    conn.close()

    # Login automatico immediato dopo la registrazione
    session.permanent = True
    session["user_id"] = user_id

    return jsonify({
        "authenticated": True,
        "message": "Registrazione completata e login effettuato automaticamente.",
        "user": {
            "id": user_id,
            "username": username,
            "display_name": display_name,
        },
    })


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json(force=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""

    if not username or not password:
        return jsonify({"error": "Inserisci nome utente e password."}), 400

    conn = get_db()
    user = conn.execute(
        "SELECT id, username, display_name, password_hash FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    conn.close()

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Credenziali non valide. Verifica nome utente e password."}), 401

    session.permanent = True
    session["user_id"] = user["id"]

    return jsonify({
        "authenticated": True,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "display_name": user["display_name"],
        },
    })


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    session.clear()
    return jsonify({"authenticated": False})


# ---------------------------------------------------------------------------
# CATEGORIES API
# ---------------------------------------------------------------------------
@app.route("/api/categories", methods=["GET"])
@login_required
def get_categories():
    conn = get_db()
    rows = conn.execute(
        "SELECT id, name, icon, color, sort_order, column_group FROM categories ORDER BY sort_order ASC, name ASC"
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/categories", methods=["POST"])
@login_required
def create_category():
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip().upper()
    icon = (data.get("icon") or "📦").strip()
    color = (data.get("color") or "#0ea5e9").strip()
    if not name:
        return jsonify({"error": "Inserisci il nome del tipo/categoria."}), 400

    conn = get_db()
    max_order = conn.execute("SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories").fetchone()["m"]
    cur = conn.cursor()
    cur.execute(
        """
        INSERT OR IGNORE INTO categories (name, icon, color, sort_order, column_group)
        VALUES (?, ?, ?, ?, 1)
        """,
        (name, icon, color, max_order + 1),
    )
    conn.commit()
    cat = conn.execute("SELECT * FROM categories WHERE name = ?", (name,)).fetchone()
    conn.close()
    return jsonify(dict(cat))


# ---------------------------------------------------------------------------
# SHOPPING LISTS API
# ---------------------------------------------------------------------------
@app.route("/api/lists", methods=["GET"])
@login_required
def list_shopping_lists():
    conn = get_db()
    rows = conn.execute(
        """
        SELECT
            l.id,
            l.name,
            l.list_date,
            l.created_at,
            l.updated_at,
            COUNT(i.id) AS total_catalog_items,
            SUM(CASE WHEN (TRIM(COALESCE(i.quantity, '')) != '' AND TRIM(COALESCE(i.quantity, '')) != '0') OR i.in_list = 1 THEN 1 ELSE 0 END) AS active_items,
            SUM(CASE WHEN i.purchased = 1 THEN 1 ELSE 0 END) AS purchased_items
        FROM shopping_lists l
        LEFT JOIN shopping_list_items i ON i.list_id = l.id
        GROUP BY l.id
        ORDER BY l.list_date DESC, l.id DESC
        """
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route("/api/lists", methods=["POST"])
@login_required
def create_shopping_list():
    data = request.get_json(force=True) or {}
    list_date = (data.get("list_date") or "").strip() or date.today().isoformat()
    name = (data.get("name") or "").strip() or "Lista Supermercato"
    mode = (data.get("mode") or "template").strip()  # 'template', 'copy', 'empty'
    source_list_id = data.get("source_list_id")

    ts = now_iso()
    conn = get_db()
    cur = conn.cursor()

    cur.execute(
        """
        INSERT INTO shopping_lists (name, list_date, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (name, list_date, request.current_user["id"], ts, ts),
    )
    new_list_id = cur.lastrowid

    if mode == "copy" and source_list_id:
        source_items = conn.execute(
            """
            SELECT product_id, name, category, unit, quantity, in_list, notes
            FROM shopping_list_items
            WHERE list_id = ?
            """,
            (source_list_id,),
        ).fetchall()
        for item in source_items:
            cur.execute(
                """
                INSERT INTO shopping_list_items
                (list_id, product_id, name, category, unit, quantity, in_list, purchased, notes, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
                """,
                (
                    new_list_id,
                    item["product_id"],
                    item["name"],
                    item["category"],
                    item["unit"],
                    item["quantity"],
                    item["in_list"],
                    item["notes"],
                    ts,
                ),
            )
    elif mode == "empty":
        pass
    else:
        # 'template': carica tutti i prodotti del catalogo base (derivato dall'Excel + eventuali aggiunte)
        products = conn.execute(
            "SELECT id, name, category, default_unit FROM catalog_products ORDER BY category ASC, name COLLATE NOCASE ASC"
        ).fetchall()
        for prod in products:
            cur.execute(
                """
                INSERT INTO shopping_list_items
                (list_id, product_id, name, category, unit, quantity, in_list, purchased, notes, updated_at)
                VALUES (?, ?, ?, ?, ?, '', 0, 0, '', ?)
                """,
                (
                    new_list_id,
                    prod["id"],
                    prod["name"],
                    prod["category"],
                    prod["default_unit"],
                    ts,
                ),
            )

    conn.commit()
    conn.close()
    return get_shopping_list(new_list_id)


@app.route("/api/lists/<int:list_id>", methods=["GET"])
@login_required
def get_shopping_list(list_id):
    conn = get_db()
    lst = conn.execute(
        "SELECT id, name, list_date, created_by, created_at, updated_at FROM shopping_lists WHERE id = ?",
        (list_id,),
    ).fetchone()
    if not lst:
        conn.close()
        return jsonify({"error": "Lista non trovata."}), 404

    categories = conn.execute(
        "SELECT id, name, icon, color, sort_order, column_group FROM categories ORDER BY sort_order ASC, name ASC"
    ).fetchall()

    items = conn.execute(
        """
        SELECT id, list_id, product_id, name, category, unit, quantity, in_list, purchased, notes, updated_at
        FROM shopping_list_items
        WHERE list_id = ?
        ORDER BY name COLLATE NOCASE ASC
        """,
        (list_id,),
    ).fetchall()
    conn.close()

    return jsonify({
        "list": dict(lst),
        "categories": [dict(c) for c in categories],
        "items": [dict(i) for i in items],
    })


@app.route("/api/lists/<int:list_id>/version", methods=["GET"])
@login_required
def get_shopping_list_version(list_id):
    conn = get_db()
    row = conn.execute(
        "SELECT id, updated_at, list_date, name FROM shopping_lists WHERE id = ?",
        (list_id,),
    ).fetchone()
    conn.close()
    if not row:
        return jsonify({"error": "Lista non trovata."}), 404
    return jsonify(dict(row))


@app.route("/api/lists/<int:list_id>", methods=["PUT"])
@login_required
def update_shopping_list(list_id):
    data = request.get_json(force=True) or {}
    conn = get_db()
    lst = conn.execute("SELECT * FROM shopping_lists WHERE id = ?", (list_id,)).fetchone()
    if not lst:
        conn.close()
        return jsonify({"error": "Lista non trovata."}), 404

    name = (data.get("name") if "name" in data else lst["name"]).strip() or "Lista Supermercato"
    list_date = (data.get("list_date") if "list_date" in data else lst["list_date"]).strip() or lst["list_date"]
    action = data.get("action")

    ts = now_iso()
    conn.execute(
        "UPDATE shopping_lists SET name = ?, list_date = ?, updated_at = ? WHERE id = ?",
        (name, list_date, ts, list_id),
    )

    if action == "clear_purchased":
        conn.execute(
            "UPDATE shopping_list_items SET purchased = 0, updated_at = ? WHERE list_id = ?",
            (ts, list_id),
        )
    elif action == "clear_quantities":
        conn.execute(
            "UPDATE shopping_list_items SET quantity = '', in_list = 0, purchased = 0, updated_at = ? WHERE list_id = ?",
            (ts, list_id),
        )

    conn.commit()
    conn.close()
    return get_shopping_list(list_id)


@app.route("/api/lists/<int:list_id>", methods=["DELETE"])
@login_required
def delete_shopping_list(list_id):
    conn = get_db()
    conn.execute("DELETE FROM shopping_lists WHERE id = ?", (list_id,))
    # Se non sono rimaste liste, ne ricrea una vuota/template odierna
    remaining = conn.execute("SELECT id FROM shopping_lists ORDER BY list_date DESC, id DESC LIMIT 1").fetchone()
    conn.commit()
    conn.close()

    if not remaining:
        init_db()
        conn = get_db()
        remaining = conn.execute("SELECT id FROM shopping_lists ORDER BY id DESC LIMIT 1").fetchone()
        conn.close()

    return jsonify({"deleted": True, "next_list_id": remaining["id"] if remaining else None})


# ---------------------------------------------------------------------------
# ITEMS API (Quantità, Acquistato/Arancione, Aggiunta, Modifica, Rimozione)
# ---------------------------------------------------------------------------
@app.route("/api/lists/<int:list_id>/items", methods=["POST"])
@login_required
def add_item_to_list(list_id):
    data = request.get_json(force=True) or {}
    name = (data.get("name") or "").strip()
    category = (data.get("category") or "ALIMENTARI").strip().upper()
    unit = (data.get("unit") or "").strip()
    quantity = str(data.get("quantity") if data.get("quantity") is not None else "").strip()
    save_to_catalog = data.get("save_to_catalog", True)
    notes = (data.get("notes") or "").strip()

    if not name:
        return jsonify({"error": "Inserisci il nome del prodotto."}), 400

    conn = get_db()
    lst = conn.execute("SELECT id FROM shopping_lists WHERE id = ?", (list_id,)).fetchone()
    if not lst:
        conn.close()
        return jsonify({"error": "Lista non trovata."}), 404

    ts = now_iso()
    cur = conn.cursor()

    # Assicura che la categoria esista
    cur.execute(
        "INSERT OR IGNORE INTO categories (name, icon, color, sort_order, column_group) VALUES (?, '📦', '#0ea5e9', 10, 1)",
        (category,),
    )

    product_id = None
    if save_to_catalog:
        existing_prod = conn.execute(
            "SELECT id FROM catalog_products WHERE LOWER(name) = LOWER(?)", (name,)
        ).fetchone()
        if existing_prod:
            product_id = existing_prod["id"]
            cur.execute(
                "UPDATE catalog_products SET category = ?, default_unit = ? WHERE id = ?",
                (category, unit, product_id),
            )
        else:
            cur.execute(
                """
                INSERT INTO catalog_products (name, category, default_unit, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (name, category, unit, ts),
            )
            product_id = cur.lastrowid

    in_list = 1 if (quantity and quantity != "0") or data.get("in_list", True) else 0

    cur.execute(
        """
        INSERT INTO shopping_list_items
        (list_id, product_id, name, category, unit, quantity, in_list, purchased, notes, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        """,
        (list_id, product_id, name, category, unit, quantity, in_list, notes, ts),
    )
    item_id = cur.lastrowid
    touch_list(conn, list_id)
    conn.commit()

    item = conn.execute("SELECT * FROM shopping_list_items WHERE id = ?", (item_id,)).fetchone()
    conn.close()
    return jsonify(dict(item))


@app.route("/api/items/<int:item_id>", methods=["PUT"])
@login_required
def update_item(item_id):
    data = request.get_json(force=True) or {}
    conn = get_db()
    item = conn.execute("SELECT * FROM shopping_list_items WHERE id = ?", (item_id,)).fetchone()
    if not item:
        conn.close()
        return jsonify({"error": "Prodotto non trovato."}), 404

    name = (data.get("name") if "name" in data else item["name"]).strip() or item["name"]
    category = (data.get("category") if "category" in data else item["category"]).strip().upper() or item["category"]
    unit = (data.get("unit") if "unit" in data else item["unit"]).strip()
    notes = (data.get("notes") if "notes" in data else item["notes"]).strip()

    if "quantity" in data:
        quantity = str(data["quantity"] if data["quantity"] is not None else "").strip()
    else:
        quantity = item["quantity"]

    if "in_list" in data:
        in_list = 1 if data["in_list"] else 0
    else:
        if "quantity" in data:
            if quantity != "" and quantity != "0":
                in_list = 1
            else:
                in_list = 0
                # Se la quantità viene azzerata, azzeriamo anche acquistato salvo diversa indicazione
                if "purchased" not in data:
                    data["purchased"] = 0
        else:
            in_list = item["in_list"]

    if "purchased" in data:
        purchased = 1 if data["purchased"] else 0
        # Se un prodotto viene evidenziato come acquistato, assicuriamoci che sia visibile come attivo nella lista
        if purchased == 1 and in_list == 0:
            in_list = 1
    else:
        purchased = item["purchased"]

    ts = now_iso()
    cur = conn.cursor()

    # Assicura che la categoria esista
    cur.execute(
        "INSERT OR IGNORE INTO categories (name, icon, color, sort_order, column_group) VALUES (?, '📦', '#0ea5e9', 10, 1)",
        (category,),
    )

    cur.execute(
        """
        UPDATE shopping_list_items
        SET name = ?, category = ?, unit = ?, quantity = ?, in_list = ?, purchased = ?, notes = ?, updated_at = ?
        WHERE id = ?
        """,
        (name, category, unit, quantity, in_list, purchased, notes, ts, item_id),
    )

    # Se il prodotto è collegato al catalogo e abbiamo cambiato nome, categoria o unità, aggiorniamo anche il catalogo base
    if item["product_id"] and any(k in data for k in ("name", "category", "unit")):
        cur.execute(
            """
            UPDATE catalog_products
            SET name = ?, category = ?, default_unit = ?
            WHERE id = ?
            """,
            (name, category, unit, item["product_id"]),
        )

    touch_list(conn, item["list_id"])
    conn.commit()

    updated = conn.execute("SELECT * FROM shopping_list_items WHERE id = ?", (item_id,)).fetchone()
    conn.close()
    return jsonify(dict(updated))


@app.route("/api/items/<int:item_id>", methods=["DELETE"])
@login_required
def delete_item(item_id):
    delete_from_catalog = request.args.get("catalog") == "1"
    conn = get_db()
    item = conn.execute("SELECT * FROM shopping_list_items WHERE id = ?", (item_id,)).fetchone()
    if not item:
        conn.close()
        return jsonify({"error": "Prodotto non trovato."}), 404

    list_id = item["list_id"]
    product_id = item["product_id"]

    conn.execute("DELETE FROM shopping_list_items WHERE id = ?", (item_id,))
    if delete_from_catalog and product_id:
        conn.execute("DELETE FROM catalog_products WHERE id = ?", (product_id,))

    touch_list(conn, list_id)
    conn.commit()
    conn.close()
    return jsonify({"deleted": True, "id": item_id})


@app.route("/api/lists/<int:list_id>/reset-excel", methods=["POST"])
@login_required
def sync_from_excel(list_id):
    """Sincronizza eventuali prodotti mancanti dal file Excel 'Liste supermarché.xlsx' nella lista corrente."""
    excel_items = parse_excel_catalog()
    conn = get_db()
    cur = conn.cursor()
    ts = now_iso()

    existing_names = {
        row["name"].strip().lower()
        for row in conn.execute(
            "SELECT name FROM shopping_list_items WHERE list_id = ?", (list_id,)
        ).fetchall()
    }

    added = 0
    for item in excel_items:
        key = item["name"].strip().lower()
        if key not in existing_names:
            # Controlla se è già in catalog_products
            prod = conn.execute(
                "SELECT id FROM catalog_products WHERE LOWER(name) = LOWER(?)",
                (item["name"],),
            ).fetchone()
            if not prod:
                cur.execute(
                    "INSERT INTO catalog_products (name, category, default_unit, created_at) VALUES (?, ?, ?, ?)",
                    (item["name"], item["category"], item["default_unit"], ts),
                )
                prod_id = cur.lastrowid
            else:
                prod_id = prod["id"]

            cur.execute(
                """
                INSERT INTO shopping_list_items
                (list_id, product_id, name, category, unit, quantity, in_list, purchased, notes, updated_at)
                VALUES (?, ?, ?, ?, ?, '', 0, 0, '', ?)
                """,
                (list_id, prod_id, item["name"], item["category"], item["default_unit"], ts),
            )
            existing_names.add(key)
            added += 1

    touch_list(conn, list_id)
    conn.commit()
    conn.close()
    return get_shopping_list(list_id)


if __name__ == "__main__":
    init_db()
    lan_ip = get_lan_ip()
    port = int(os.environ.get("PORT", 8090))
    print("=" * 64)
    print(" [OK] APP LISTA SUPERMERCATO ATTIVA!")
    print(f" [PC] Da questo PC:        http://localhost:{port}")
    print(f" [LAN] Da Smartphone WiFi: http://{lan_ip}:{port}")
    print("=" * 64)
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
