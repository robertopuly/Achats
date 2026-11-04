// ============================================================================
// GENERATORE PDF NATIVO VETTORIALE (Nessuna dipendenza esterna richiesta)
// Supporta caratteri accentati (WinAnsiEncoding), colori, tabelle e multi-pagina
// ============================================================================

function toWinAnsiHex(str) {
    const text = String(str ?? "");
    let hex = "";
    for (let i = 0; i < text.length; i++) {
        let code = text.charCodeAt(i);
        // Mappatura caratteri tipografici comuni in WinAnsi (CP1252)
        if (code === 0x2019 || code === 0x2018) code = 0x27; // apostrofo
        else if (code === 0x2013 || code === 0x2014) code = 0x2d; // trattino
        else if (code === 0x2192) code = 0x3e; // ->
        else if (code > 255) code = 0x3f; // ignora emoji/simboli fuori CP1252
        hex += code.toString(16).padStart(2, "0").toUpperCase();
    }
    return `<${hex}>`;
}

function stripEmojis(str) {
    return String(str ?? "")
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, "")
        .trim();
}

function hexToRgb01(hex) {
    const clean = String(hex || "#334155").replace("#", "");
    if (clean.length !== 6) return [0.2, 0.25, 0.33];
    const r = parseInt(clean.slice(0, 2), 16) / 255;
    const g = parseInt(clean.slice(2, 4), 16) / 255;
    const b = parseInt(clean.slice(4, 6), 16) / 255;
    return [
        Number(r.toFixed(3)),
        Number(g.toFixed(3)),
        Number(b.toFixed(3)),
    ];
}

function truncateText(str, maxChars) {
    const s = stripEmojis(str);
    if (s.length <= maxChars) return s;
    return s.slice(0, maxChars - 1) + ".";
}

function formatDateIT(isoStr) {
    if (!isoStr) return "";
    const parts = String(isoStr).split("-");
    if (parts.length !== 3) return isoStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/**
 * Genera un Buffer PDF A4 (595.28 x 841.89 pt) della lista della spesa
 */
function generateShoppingListPdf({
    list,
    categories,
    items,
    filterMode = "all",
    selectedCategory = "ALL",
    sortMode = "type_alpha",
    searchQuery = "",
}) {
    const PAGE_W = 595.28;
    const PAGE_H = 841.89;
    const MARGIN_X = 28;
    const MARGIN_TOP = 32;
    const MARGIN_BOTTOM = 34;

    const pages = [];
    let currentOps = [];

    function startNewPage(pageIndex) {
        currentOps = [];
        pages.push(currentOps);

        // Intestazione documento (Eco-Print: fondo bianco, bordo sottile, zero spreco di toner)
        const headerY = PAGE_H - MARGIN_TOP - 38;
        drawRect(MARGIN_X, headerY, PAGE_W - MARGIN_X * 2, 42, [1, 1, 1], [0.25, 0.3, 0.38], 0.9);
        drawLine(MARGIN_X, headerY + 21, PAGE_W - MARGIN_X, headerY + 21, 0.4, [0.82, 0.85, 0.9]);

        const fornStr = list.fornitore ? ` [${stripEmojis(list.fornitore)}]` : "";
        const titleText = `LISTA SUPERMERCATO${fornStr} — ${stripEmojis(list.name || "Spesa")}`;
        drawText(MARGIN_X + 10, headerY + 26, titleText, "F2", 11.5, [0.05, 0.08, 0.15]);

        const filterLabels = {
            all: "Tutti i prodotti",
            active: "Solo prodotti in lista (Da acquistare)",
            purchased: "Prodotti acquistati",
        };
        const filterDesc = filterLabels[filterMode] || "Tutti i prodotti";
        const catDesc = selectedCategory !== "ALL" ? ` | Reparto: ${selectedCategory}` : "";
        const searchDesc = searchQuery ? ` | Ricerca: "${searchQuery}"` : "";
        const subText = `Data: ${formatDateIT(list.list_date)}   |   Filtro: ${filterDesc}${catDesc}${searchDesc}`;
        drawText(MARGIN_X + 10, headerY + 6.5, subText, "F1", 8.3, [0.28, 0.33, 0.42]);

        // Contatori a destra nell'header
        const activeCount = items.filter((i) => {
            const q = String(i.quantity || "").trim();
            return (q !== "" && q !== "0") || i.in_list === 1 || i.purchased === 1;
        }).length;
        const purchasedCount = items.filter((i) => i.purchased === 1).length;
        const rightSummary = `Voci: ${items.length}  |  In lista: ${activeCount}  |  Acquistati: ${purchasedCount}`;
        drawTextRight(PAGE_W - MARGIN_X - 10, headerY + 26, rightSummary, "F2", 8.5, [0.12, 0.25, 0.55]);

        if (pageIndex > 1) {
            drawTextRight(PAGE_W - MARGIN_X - 10, headerY + 6.5, `Pagina ${pageIndex}`, "F1", 8, [0.35, 0.4, 0.48]);
        }

        // Piè di pagina
        drawLine(MARGIN_X, MARGIN_BOTTOM - 6, PAGE_W - MARGIN_X, MARGIN_BOTTOM - 6, 0.5, [0.75, 0.78, 0.84]);
        drawText(
            MARGIN_X,
            MARGIN_BOTTOM - 18,
            `Generato da App Lista Supermercato — Data lista: ${formatDateIT(list.list_date)}`,
            "F1",
            7.5,
            [0.35, 0.4, 0.48]
        );
        drawTextRight(
            PAGE_W - MARGIN_X,
            MARGIN_BOTTOM - 18,
            "[X] = Acquistato   |   [ ] Grassetto = Da acquistare",
            "F1",
            7.5,
            [0.35, 0.4, 0.48]
        );

        return headerY - 12;
    }

    function drawRect(x, y, w, h, rgbFill, rgbStroke = null, lineWidth = 0.5) {
        currentOps.push("q");
        if (rgbFill) {
            currentOps.push(`${rgbFill[0]} ${rgbFill[1]} ${rgbFill[2]} rg`);
        }
        if (rgbStroke) {
            currentOps.push(`${rgbStroke[0]} ${rgbStroke[1]} ${rgbStroke[2]} RG`);
            currentOps.push(`${lineWidth} w`);
        }
        const op = rgbFill && rgbStroke ? "B" : rgbFill ? "f" : "S";
        currentOps.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${op}`);
        currentOps.push("Q");
    }

    function drawLine(x1, y1, x2, y2, width, rgb) {
        currentOps.push("q");
        currentOps.push(`${rgb[0]} ${rgb[1]} ${rgb[2]} RG`);
        currentOps.push(`${width} w`);
        currentOps.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
        currentOps.push("Q");
    }

    function drawText(x, y, text, fontRef, size, rgb = [0.06, 0.09, 0.16]) {
        const clean = stripEmojis(text);
        if (!clean) return;
        currentOps.push("BT");
        currentOps.push(`/${fontRef} ${size} Tf`);
        currentOps.push(`${rgb[0]} ${rgb[1]} ${rgb[2]} rg`);
        currentOps.push(`${x.toFixed(2)} ${y.toFixed(2)} Td`);
        currentOps.push(`${toWinAnsiHex(clean)} Tj`);
        currentOps.push("ET");
    }

    function estimateTextWidth(text, size) {
        const clean = stripEmojis(text);
        return clean.length * size * 0.52;
    }

    function drawTextRight(rightX, y, text, fontRef, size, rgb = [0.06, 0.09, 0.16]) {
        const w = estimateTextWidth(text, size);
        drawText(rightX - w, y, text, fontRef, size, rgb);
    }

    const ROW_H = 16.5;
    const CAT_HEADER_H = 19;

    function drawCategoryHeader(x, topY, width, title, colorHex, countText) {
        const y = topY - CAT_HEADER_H;
        const rgb = hexToRgb01(colorHex);
        // Eco-Print: fondo bianco con bordo del colore reparto e tacca laterale sinistra
        drawRect(x, y, width, CAT_HEADER_H, [1, 1, 1], rgb, 0.9);
        drawRect(x, y, 4.5, CAT_HEADER_H, rgb);
        drawText(x + 10, y + 5.5, stripEmojis(title).toUpperCase(), "F2", 9.2, [0.05, 0.08, 0.15]);
        drawTextRight(x + width - 6, y + 5.5, countText, "F2", 7.8, [0.25, 0.3, 0.38]);
        return y;
    }

    function drawItemRow(x, topY, width, item, showCategoryBadge = false) {
        const y = topY - ROW_H;
        const qStr = String(item.quantity || "").trim();
        const hasQty = qStr !== "" && qStr !== "0";
        const isActive = hasQty || item.in_list === 1 || item.purchased === 1;
        const isPurchased = item.purchased === 1;

        // Eco-Print: sfondo sempre bianco per risparmiare toner
        const bgRgb = [1, 1, 1];
        let textRgb = [0.15, 0.2, 0.28];
        let borderRgb = [0.84, 0.87, 0.91];

        if (isPurchased) {
            textRgb = [0.72, 0.25, 0.0];
            borderRgb = [0.88, 0.55, 0.25];
        } else if (isActive) {
            textRgb = [0.04, 0.08, 0.18];
            borderRgb = [0.7, 0.78, 0.88];
        }

        drawRect(x, y, width, ROW_H, bgRgb, borderRgb, 0.4);
        if (isPurchased) {
            // Sottile indicatore laterale arancione invece del fondo pieno
            drawRect(x, y, 3, ROW_H, [0.9, 0.4, 0.0]);
        } else if (isActive) {
            drawRect(x, y, 2.2, ROW_H, [0.15, 0.38, 0.85]);
        }

        // Casella di spunta a sinistra
        const boxSize = 8.5;
        const boxX = x + 6;
        const boxY = y + (ROW_H - boxSize) / 2;
        if (isPurchased) {
            drawRect(boxX, boxY, boxSize, boxSize, [1, 1, 1], [0.8, 0.32, 0.0], 0.8);
            drawText(boxX + 1.5, boxY + 1.5, "X", "F2", 7, [0.8, 0.32, 0.0]);
        } else {
            drawRect(boxX, boxY, boxSize, boxSize, [1, 1, 1], isActive ? [0.12, 0.28, 0.65] : [0.58, 0.63, 0.7], 0.7);
        }

        // Nome prodotto + eventuale commento accanto al nome
        const maxNameChars = showCategoryBadge ? 34 : 28;
        const noteText = stripEmojis(item.notes || "");
        const rawDisplayName = noteText ? `${item.name} (${noteText})` : item.name;
        const prodName = truncateText(rawDisplayName, maxNameChars);
        const font = isActive || isPurchased ? "F2" : "F1";
        drawText(x + 19, y + 4.8, prodName, font, 8.6, textRgb);

        if (showCategoryBadge && item.category) {
            const catShort = truncateText(item.category, 14);
            drawText(x + width - 125, y + 5.2, `[${catShort}]`, "F1", 7.2, [0.4, 0.46, 0.54]);
        }

        // Quantità + Unità a destra
        const unitStr = stripEmojis(item.unit || "");
        const qtyDisplay = hasQty ? `${qStr} ${unitStr}`.trim() : unitStr ? `____ ${unitStr}` : "____";
        const qtyColor = isPurchased ? [0.72, 0.25, 0.0] : hasQty ? [0.05, 0.15, 0.45] : [0.55, 0.6, 0.68];
        drawTextRight(x + width - 7, y + 4.8, qtyDisplay, hasQty || isPurchased ? "F2" : "F1", 8.5, qtyColor);

        return y;
    }

    // Avvia prima pagina
    let pageNum = 1;
    let cursorY = startNewPage(pageNum);

    if (items.length === 0) {
        drawText(
            MARGIN_X + 10,
            cursorY - 24,
            "Nessun prodotto presente con i filtri attuali.",
            "F1",
            11,
            [0.4, 0.45, 0.52]
        );
    } else if (sortMode === "type_alpha") {
        // Raggruppamento per Tipo + Ordine Alfabetico (Stile Excel a 2 colonne se ci sono più categorie)
        const catMetaMap = new Map();
        for (const c of categories || []) {
            catMetaMap.set(String(c.name).toUpperCase(), c);
        }

        const groups = new Map();
        for (const item of items) {
            const key = String(item.category || "ALTRO").toUpperCase();
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(item);
        }
        for (const [, arr] of groups.entries()) {
            arr.sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }));
        }

        const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
            const oa = catMetaMap.get(a)?.sort_order ?? 99;
            const ob = catMetaMap.get(b)?.sort_order ?? 99;
            if (oa !== ob) return oa - ob;
            return a.localeCompare(b, "it");
        });

        const useTwoColumns = sortedKeys.length > 1 && selectedCategory === "ALL";

        if (useTwoColumns) {
            const GAP = 14;
            const COL_W = (PAGE_W - MARGIN_X * 2 - GAP) / 2;
            const col1X = MARGIN_X;
            const col2X = MARGIN_X + COL_W + GAP;

            // Separiamo le categorie nelle 2 colonne del file Excel (Col 1: Verdura + Pulizia, Col 2: Frutta + Alimentari)
            const col1Cats = [];
            const col2Cats = [];
            for (const k of sortedKeys) {
                const meta = catMetaMap.get(k) || { name: k, color: "#334155", column_group: 1 };
                if (meta.column_group === 2) col2Cats.push({ key: k, meta, list: groups.get(k) });
                else col1Cats.push({ key: k, meta, list: groups.get(k) });
            }
            if (col1Cats.length === 0 || col2Cats.length === 0) {
                col1Cats.length = 0;
                col2Cats.length = 0;
                sortedKeys.forEach((k, idx) => {
                    const meta = catMetaMap.get(k) || { name: k, color: "#334155" };
                    if (idx % 2 === 0) col1Cats.push({ key: k, meta, list: groups.get(k) });
                    else col2Cats.push({ key: k, meta, list: groups.get(k) });
                });
            }

            // Costruiamo la coda di elementi per ciascuna colonna
            const buildQueue = (catArr) => {
                const q = [];
                for (const c of catArr) {
                    const activeCnt = c.list.filter((i) => {
                        const v = String(i.quantity || "").trim();
                        return (v !== "" && v !== "0") || i.in_list === 1 || i.purchased === 1;
                    }).length;
                    q.push({
                        type: "header",
                        title: c.meta.name,
                        color: c.meta.color || "#334155",
                        countText: activeCnt > 0 ? `${activeCnt} in lista` : `${c.list.length} voci`,
                    });
                    for (const item of c.list) {
                        q.push({ type: "item", item });
                    }
                    q.push({ type: "spacer", height: 8 });
                }
                return q;
            };

            const q1 = buildQueue(col1Cats);
            const q2 = buildQueue(col2Cats);
            let i1 = 0;
            let i2 = 0;

            while (i1 < q1.length || i2 < q2.length) {
                if (pages.length > 1 || (i1 > 0 || i2 > 0)) {
                    pageNum++;
                    cursorY = startNewPage(pageNum);
                }
                let y1 = cursorY;
                let y2 = cursorY;

                while (i1 < q1.length) {
                    const entry = q1[i1];
                    const needed = entry.type === "header" ? CAT_HEADER_H + ROW_H : entry.type === "item" ? ROW_H : entry.height;
                    if (y1 - needed < MARGIN_BOTTOM + 6) break;
                    if (entry.type === "header") {
                        y1 = drawCategoryHeader(col1X, y1, COL_W, entry.title, entry.color, entry.countText);
                    } else if (entry.type === "item") {
                        y1 = drawItemRow(col1X, y1, COL_W, entry.item, false);
                    } else {
                        y1 -= entry.height;
                    }
                    i1++;
                }

                while (i2 < q2.length) {
                    const entry = q2[i2];
                    const needed = entry.type === "header" ? CAT_HEADER_H + ROW_H : entry.type === "item" ? ROW_H : entry.height;
                    if (y2 - needed < MARGIN_BOTTOM + 6) break;
                    if (entry.type === "header") {
                        y2 = drawCategoryHeader(col2X, y2, COL_W, entry.title, entry.color, entry.countText);
                    } else if (entry.type === "item") {
                        y2 = drawItemRow(col2X, y2, COL_W, entry.item, false);
                    } else {
                        y2 -= entry.height;
                    }
                    i2++;
                }
            }
        } else {
            // Singola colonna a larghezza piena
            const FULL_W = PAGE_W - MARGIN_X * 2;
            for (const k of sortedKeys) {
                const meta = catMetaMap.get(k) || { name: k, color: "#334155" };
                const list = groups.get(k);
                if (cursorY - (CAT_HEADER_H + ROW_H) < MARGIN_BOTTOM + 6) {
                    pageNum++;
                    cursorY = startNewPage(pageNum);
                }
                const activeCnt = list.filter((i) => {
                    const v = String(i.quantity || "").trim();
                    return (v !== "" && v !== "0") || i.in_list === 1 || i.purchased === 1;
                }).length;
                cursorY = drawCategoryHeader(
                    MARGIN_X,
                    cursorY,
                    FULL_W,
                    meta.name,
                    meta.color || "#334155",
                    activeCnt > 0 ? `${activeCnt} in lista` : `${list.length} voci`
                );
                for (const item of list) {
                    if (cursorY - ROW_H < MARGIN_BOTTOM + 6) {
                        pageNum++;
                        cursorY = startNewPage(pageNum);
                        cursorY = drawCategoryHeader(MARGIN_X, cursorY, FULL_W, `${meta.name} (cont.)`, meta.color || "#334155", "");
                    }
                    cursorY = drawItemRow(MARGIN_X, cursorY, FULL_W, item, false);
                }
                cursorY -= 10;
            }
        }
    } else {
        // Ordine Alfabetico Globale (A -> Z o Z -> A)
        const FULL_W = PAGE_W - MARGIN_X * 2;
        const sorted = [...items].sort((a, b) => {
            const cmp = a.name.localeCompare(b.name, "it", { sensitivity: "base" });
            return sortMode === "alpha_desc" ? -cmp : cmp;
        });
        const hdrTitle = sortMode === "alpha_desc" ? "ORDINE ALFABETICO (Z - A)" : "ORDINE ALFABETICO (A - Z)";
        cursorY = drawCategoryHeader(MARGIN_X, cursorY, FULL_W, hdrTitle, "#1e293b", `${sorted.length} prodotti`);
        for (const item of sorted) {
            if (cursorY - ROW_H < MARGIN_BOTTOM + 6) {
                pageNum++;
                cursorY = startNewPage(pageNum);
                cursorY = drawCategoryHeader(MARGIN_X, cursorY, FULL_W, `${hdrTitle} (cont.)`, "#1e293b", "");
            }
            cursorY = drawItemRow(MARGIN_X, cursorY, FULL_W, item, true);
        }
    }

    // Assemblaggio finale documento PDF 1.4
    const objects = [];
    const addObj = (body) => {
        objects.push(body);
        return objects.length;
    };

    // 1: Font Helvetica, 2: Font Helvetica-Bold
    const fontRegularId = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontBoldId = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

    const pagesRootId = addObj(""); // placeholder per /Pages
    const pageIds = [];

    for (const ops of pages) {
        const streamContent = ops.join("\n");
        const streamByteLen = Buffer.byteLength(streamContent, "ascii");
        const contentId = addObj(`<< /Length ${streamByteLen} >>\nstream\n${streamContent}\nendstream`);
        const pageId = addObj(
            `<< /Type /Page /Parent ${pagesRootId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`
        );
        pageIds.push(pageId);
    }

    objects[pagesRootId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesRootId} 0 R >>`);

    let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets = [];
    for (let i = 0; i < objects.length; i++) {
        offsets.push(Buffer.byteLength(pdf, "binary"));
        pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }

    const xrefOffset = Buffer.byteLength(pdf, "binary");
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += "0000000000 65535 f \n";
    for (const off of offsets) {
        pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    return Buffer.from(pdf, "binary");
}

const MONTH_NAMES_IT = [
    "",
    "Gennaio",
    "Febbraio",
    "Marzo",
    "Aprile",
    "Maggio",
    "Giugno",
    "Luglio",
    "Agosto",
    "Settembre",
    "Ottobre",
    "Novembre",
    "Dicembre",
];

function formatMonthIT(ym) {
    if (!ym || !ym.includes("-")) return ym || "";
    const [y, m] = ym.split("-");
    const mIdx = parseInt(m, 10);
    return `${MONTH_NAMES_IT[mIdx] || m} ${y}`;
}

/**
 * Genera un Buffer PDF A4 per la Tabella Principale Acquisti (con raggruppamento per giorno, mese, anno, prodotto o tabella unica)
 */
function generatePurchasesPdf({
    purchases = [],
    groupBy = "day", // 'day' | 'month' | 'year' | 'supplier' | 'product' | 'none'
    filterYear = "",
    filterMonth = "",
    filterDate = "",
    filterSupplier = "",
    searchQuery = "",
}) {
    const PAGE_W = 595.28;
    const PAGE_H = 841.89;
    const MARGIN_X = 28;
    const MARGIN_TOP = 32;
    const MARGIN_BOTTOM = 36;
    const FULL_W = PAGE_W - MARGIN_X * 2;

    const pages = [];
    let currentOps = [];

    function drawRect(x, y, w, h, rgbFill, rgbStroke = null, lineWidth = 0.5) {
        currentOps.push("q");
        if (rgbFill) currentOps.push(`${rgbFill[0]} ${rgbFill[1]} ${rgbFill[2]} rg`);
        if (rgbStroke) {
            currentOps.push(`${rgbStroke[0]} ${rgbStroke[1]} ${rgbStroke[2]} RG`);
            currentOps.push(`${lineWidth} w`);
        }
        const op = rgbFill && rgbStroke ? "B" : rgbFill ? "f" : "S";
        currentOps.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${op}`);
        currentOps.push("Q");
    }

    function drawLine(x1, y1, x2, y2, width, rgb) {
        currentOps.push("q");
        currentOps.push(`${rgb[0]} ${rgb[1]} ${rgb[2]} RG`);
        currentOps.push(`${width} w`);
        currentOps.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
        currentOps.push("Q");
    }

    function drawText(x, y, text, fontRef, size, rgb = [0.06, 0.09, 0.16]) {
        const clean = stripEmojis(text);
        if (!clean) return;
        currentOps.push("BT");
        currentOps.push(`/${fontRef} ${size} Tf`);
        currentOps.push(`${rgb[0]} ${rgb[1]} ${rgb[2]} rg`);
        currentOps.push(`${x.toFixed(2)} ${y.toFixed(2)} Td`);
        currentOps.push(`${toWinAnsiHex(clean)} Tj`);
        currentOps.push("ET");
    }

    function estimateTextWidth(text, size) {
        return stripEmojis(text).length * size * 0.52;
    }

    function drawTextRight(rightX, y, text, fontRef, size, rgb = [0.06, 0.09, 0.16]) {
        const w = estimateTextWidth(text, size);
        drawText(rightX - w, y, text, fontRef, size, rgb);
    }

    const grandTotal = purchases.reduce((acc, r) => acc + (Number(r.prezzo_totale) || 0), 0);

    function startNewPage(pageIndex) {
        currentOps = [];
        pages.push(currentOps);

        const headerY = PAGE_H - MARGIN_TOP - 40;
        // Eco-Print: fondo bianco, bordo sottile, zero spreco di toner
        drawRect(MARGIN_X, headerY, FULL_W, 42, [1, 1, 1], [0.25, 0.3, 0.38], 0.9);
        drawLine(MARGIN_X, headerY + 21, MARGIN_X + FULL_W, headerY + 21, 0.4, [0.82, 0.85, 0.9]);
        drawText(MARGIN_X + 10, headerY + 26, "REGISTRO ACQUISTI SUPERMERCATO", "F2", 12, [0.05, 0.08, 0.15]);

        const groupLabels = {
            day: "Raggruppato per Giorno",
            month: "Raggruppato per Mese",
            year: "Raggruppato per Anno",
            supplier: "Raggruppato per Fornitore",
            product: "Raggruppato per Prodotto",
            none: "Elenco Completo",
        };
        let sub = groupLabels[groupBy] || "Elenco";
        if (filterSupplier) sub += ` | Fornitore: ${filterSupplier}`;
        if (filterDate) sub += ` | Giorno: ${formatDateIT(filterDate)}`;
        else {
            if (filterYear) sub += ` | Anno: ${filterYear}`;
            if (filterMonth) sub += ` | Mese: ${filterMonth}`;
        }
        if (searchQuery) sub += ` | Filtro: "${searchQuery}"`;
        drawText(MARGIN_X + 10, headerY + 6.5, sub, "F1", 8.5, [0.28, 0.33, 0.42]);

        drawTextRight(
            PAGE_W - MARGIN_X - 10,
            headerY + 26,
            `TOTALE GENERALE: ${grandTotal.toFixed(2)}`,
            "F2",
            10,
            [0.05, 0.38, 0.2]
        );
        drawTextRight(
            PAGE_W - MARGIN_X - 10,
            headerY + 6.5,
            `Voci: ${purchases.length}  |  Pag. ${pageIndex}`,
            "F1",
            8,
            [0.35, 0.4, 0.48]
        );

        drawLine(MARGIN_X, MARGIN_BOTTOM - 6, PAGE_W - MARGIN_X, MARGIN_BOTTOM - 6, 0.5, [0.75, 0.78, 0.84]);
        drawText(MARGIN_X, MARGIN_BOTTOM - 18, "Tabella Principale Acquisti — Achats", "F1", 7.5, [0.35, 0.4, 0.48]);
        drawTextRight(
            PAGE_W - MARGIN_X,
            MARGIN_BOTTOM - 18,
            `Totale complessivo: ${grandTotal.toFixed(2)}`,
            "F2",
            7.5,
            [0.15, 0.22, 0.32]
        );

        return headerY - 12;
    }

    const ROW_H = 17;
    const GROUP_H = 20;
    const COL_DATE_X = MARGIN_X + 6;
    const COL_SUPP_X = MARGIN_X + 68;
    const COL_DESC_X = MARGIN_X + 140;
    const COL_UNIT_PRICE_RIGHT = MARGIN_X + 375;
    const COL_QTY_RIGHT = MARGIN_X + 448;
    const COL_TOTAL_RIGHT = MARGIN_X + FULL_W - 8;

    function drawTableColumnsHeader(topY) {
        const y = topY - 16;
        drawRect(MARGIN_X, y, FULL_W, 16, [1, 1, 1], [0.72, 0.77, 0.84], 0.6);
        drawText(COL_DATE_X, y + 4.5, "DATA", "F2", 7.5, [0.18, 0.24, 0.33]);
        drawText(COL_SUPP_X, y + 4.5, "FORNITORE", "F2", 7.5, [0.18, 0.24, 0.33]);
        drawText(COL_DESC_X, y + 4.5, "DESCRIZIONE PRODOTTO", "F2", 7.5, [0.18, 0.24, 0.33]);
        drawTextRight(COL_UNIT_PRICE_RIGHT, y + 4.5, "PR. UNIT.", "F2", 7.5, [0.18, 0.24, 0.33]);
        drawTextRight(COL_QTY_RIGHT, y + 4.5, "QUANTITÀ", "F2", 7.5, [0.18, 0.24, 0.33]);
        drawTextRight(COL_TOTAL_RIGHT, y + 4.5, "TOTALE", "F2", 7.5, [0.18, 0.24, 0.33]);
        return y;
    }

    function drawPurchaseRow(topY, r) {
        const y = topY - ROW_H;
        drawRect(MARGIN_X, y, FULL_W, ROW_H, [1, 1, 1], [0.85, 0.88, 0.92], 0.4);

        drawText(COL_DATE_X, y + 5, formatDateIT(r.data_acquisto), "F1", 8.0, [0.3, 0.36, 0.45]);
        drawText(COL_SUPP_X, y + 5, truncateText(r.fornitore || "-", 12), "F2", 8.0, [0.15, 0.35, 0.65]);
        const noteStr = stripEmojis(r.note || "");
        const fullDesc = noteStr ? `${r.descrizione_prodotto} (${noteStr})` : r.descrizione_prodotto;
        const desc = truncateText(fullDesc, 34);
        drawText(COL_DESC_X, y + 5, desc, "F2", 8.4, [0.08, 0.12, 0.2]);

        const pu = Number(r.prezzo_unitario || 0).toFixed(2);
        const qty = `${Number(r.quantita || 0)} ${stripEmojis(r.unita || "")}`.trim();
        const pt = Number(r.prezzo_totale || 0).toFixed(2);

        drawTextRight(COL_UNIT_PRICE_RIGHT, y + 5, pu, "F1", 8.2, [0.2, 0.25, 0.33]);
        drawTextRight(COL_QTY_RIGHT, y + 5, qty, "F1", 8.2, [0.2, 0.25, 0.33]);
        drawTextRight(COL_TOTAL_RIGHT, y + 5, pt, "F2", 8.6, [0.06, 0.35, 0.22]);
        return y;
    }

    let pageNum = 1;
    let cursorY = startNewPage(pageNum);

    if (purchases.length === 0) {
        drawText(MARGIN_X + 10, cursorY - 24, "Nessun acquisto registrato per i filtri selezionati.", "F1", 10.5, [0.4, 0.45, 0.52]);
    } else if (groupBy === "none") {
        cursorY = drawTableColumnsHeader(cursorY);
        purchases.forEach((r, idx) => {
            if (cursorY - ROW_H < MARGIN_BOTTOM + 8) {
                pageNum++;
                cursorY = startNewPage(pageNum);
                cursorY = drawTableColumnsHeader(cursorY);
            }
            cursorY = drawPurchaseRow(cursorY, r, idx);
        });
    } else {
        const groups = new Map();
        for (const r of purchases) {
            let key = "";
            let label = "";
            if (groupBy === "day") {
                key = r.giorno || r.data_acquisto;
                label = `Giorno: ${formatDateIT(key)}`;
            } else if (groupBy === "month") {
                key = r.mese || String(r.data_acquisto).slice(0, 7);
                label = `Mese: ${formatMonthIT(key)}`;
            } else if (groupBy === "year") {
                key = String(r.anno || String(r.data_acquisto).slice(0, 4));
                label = `Anno: ${key}`;
            } else if (groupBy === "supplier") {
                key = String(r.fornitore || "Non specificato").toUpperCase();
                label = `Fornitore: ${r.fornitore || "Non specificato"}`;
            } else if (groupBy === "product") {
                key = String(r.descrizione_prodotto || "").toUpperCase();
                label = `Prodotto: ${r.descrizione_prodotto}`;
            }
            if (!groups.has(key)) groups.set(key, { label, items: [] });
            groups.get(key).items.push(r);
        }

        for (const [, grp] of groups.entries()) {
            if (cursorY - (GROUP_H + 16 + ROW_H) < MARGIN_BOTTOM + 8) {
                pageNum++;
                cursorY = startNewPage(pageNum);
            }
            const subTotal = grp.items.reduce((acc, x) => acc + (Number(x.prezzo_totale) || 0), 0);
            const subQty = grp.items.reduce((acc, x) => acc + (Number(x.quantita) || 0), 0);

            const gy = cursorY - GROUP_H;
            drawRect(MARGIN_X, gy, FULL_W, GROUP_H, [1, 1, 1], [0.18, 0.3, 0.55], 0.9);
            drawRect(MARGIN_X, gy, 4.5, GROUP_H, [0.12, 0.25, 0.55]);
            drawText(MARGIN_X + 10, gy + 6, grp.label, "F2", 9.5, [0.05, 0.08, 0.15]);
            drawTextRight(
                MARGIN_X + FULL_W - 10,
                gy + 6,
                `Voci: ${grp.items.length}  |  Q.tà tot: ${Math.round(subQty * 100) / 100}  |  Subtotale: ${subTotal.toFixed(2)}`,
                "F2",
                8.5,
                [0.12, 0.25, 0.55]
            );
            cursorY = gy;
            cursorY = drawTableColumnsHeader(cursorY);

            grp.items.forEach((r, idx) => {
                if (cursorY - ROW_H < MARGIN_BOTTOM + 8) {
                    pageNum++;
                    cursorY = startNewPage(pageNum);
                    cursorY = drawTableColumnsHeader(cursorY);
                }
                cursorY = drawPurchaseRow(cursorY, r, idx);
            });
            cursorY -= 10;
        }
    }

    const objects = [];
    const addObj = (body) => {
        objects.push(body);
        return objects.length;
    };
    const fontRegularId = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontBoldId = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const pagesRootId = addObj("");
    const pageIds = [];

    for (const ops of pages) {
        const streamContent = ops.join("\n");
        const streamByteLen = Buffer.byteLength(streamContent, "ascii");
        const contentId = addObj(`<< /Length ${streamByteLen} >>\nstream\n${streamContent}\nendstream`);
        const pageId = addObj(
            `<< /Type /Page /Parent ${pagesRootId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`
        );
        pageIds.push(pageId);
    }

    objects[pagesRootId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
    const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesRootId} 0 R >>`);

    let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
    const offsets = [];
    for (let i = 0; i < objects.length; i++) {
        offsets.push(Buffer.byteLength(pdf, "binary"));
        pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefOffset = Buffer.byteLength(pdf, "binary");
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) {
        pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    return Buffer.from(pdf, "binary");
}

module.exports = { generateShoppingListPdf, generatePurchasesPdf };
