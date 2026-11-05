// ============================================================================
// APP LISTA SUPERMERCATO & DATABASE ACQUISTI — FRONTEND LOGIC (PC & SMARTPHONE)
// ============================================================================

const state = {
    user: null,
    serverUrl: window.location.origin,
    activeSection: "list",   // 'list' | 'db'
    lists: [],
    currentList: null,
    categories: [],
    fornitori: [
        { id: 1, nome: "Aldi" },
        { id: 2, nome: "Coop" },
        { id: 3, nome: "Lidl" },
        { id: 4, nome: "Migros" },
    ],
    items: [],
    filterMode: "all",       // 'all' | 'active' | 'purchased'
    selectedCategory: "ALL", // 'ALL' oppure nome categoria (es. 'VERDURA')
    selectedSupplier: "ALL", // 'ALL' oppure nome fornitore (es. 'Aldi', 'Coop', 'Lidl', 'Migros')
    sortMode: "type_alpha",  // 'type_alpha' | 'alpha_asc' | 'alpha_desc'
    searchQuery: "",
    syncTimer: null,

    // Stato Sezione Database Principale Acquisti
    acquisti: [],
    dbGroupBy: "day",        // 'day' | 'month' | 'year' | 'supplier' | 'product' | 'none'
    dbFilterYear: "",
    dbFilterMonth: "",
    dbFilterDate: "",
    dbFilterSupplier: "",
    dbSearchQuery: "",
    availableYears: [],
    catalogSuggestions: [],
};

const LONG_PRESS_MS = 1000; // > 1 secondo per evidenziare in arancione

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

function isSmartphoneDevice() {
    const ua = navigator.userAgent || "";
    const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    const isSmallScreen = window.matchMedia && window.matchMedia("(max-width: 820px)").matches;
    return isMobileUA || isSmallScreen;
}

// ============================================================================
// INIZIALIZZAZIONE
// ============================================================================
document.addEventListener("DOMContentLoaded", async () => {
    if (isSmartphoneDevice()) {
        document.body.classList.add("is-smartphone");
    }
    window.addEventListener("resize", () => {
        const smart = isSmartphoneDevice();
        document.body.classList.toggle("is-smartphone", smart);
        if (smart && state.activeSection === "db") {
            switchMainSection("list");
        }
    });
    await checkAuthStatus();
});

function todayISO() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function formatDateIT(isoStr) {
    if (!isoStr) return "";
    const parts = String(isoStr).split("-");
    if (parts.length !== 3) return isoStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatMonthIT(ym) {
    if (!ym || !ym.includes("-")) return ym || "";
    const [y, m] = ym.split("-");
    const idx = parseInt(m, 10);
    return `${MONTH_NAMES_IT[idx] || m} ${y}`;
}

function showToast(msg, type = "default") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const el = document.createElement("div");
    el.className = `toast ${type === "orange" ? "toast-orange" : type === "success" ? "toast-success" : ""}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
        el.style.opacity = "0";
        el.style.transition = "opacity 0.25s ease";
        setTimeout(() => el.remove(), 260);
    }, 2600);
}

async function apiFetch(url, options = {}) {
    const opts = {
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        ...options,
    };
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        if (res.status === 401) {
            showAuthScreen();
        }
        throw new Error(data.error || "Errore di comunicazione con il server");
    }
    return data;
}

// ============================================================================
// AUTENTICAZIONE (LOGIN & REGISTRAZIONE CON LOGIN AUTOMATICO)
// ============================================================================
async function checkAuthStatus() {
    try {
        const res = await fetch("/api/auth/me", { credentials: "same-origin" });
        const data = await res.json();
        if (data.server_url) {
            state.serverUrl = data.server_url;
            updateLanUrls(data.server_url);
        }
        if (data.authenticated && data.user) {
            state.user = data.user;
            await enterApp();
        } else {
            showAuthScreen();
        }
    } catch (err) {
        console.error(err);
        showAuthScreen();
    }
}

function updateLanUrls(url) {
    const authLan = document.getElementById("auth-lan-url");
    if (authLan) authLan.textContent = url;
    const modalLink = document.getElementById("lan-modal-link");
    if (modalLink) {
        modalLink.textContent = url;
        modalLink.href = url;
    }
}

function showAuthScreen() {
    stopRealtimeSync();
    document.getElementById("app-screen").classList.add("hidden");
    document.getElementById("auth-screen").classList.remove("hidden");
}

function switchAuthTab(tab) {
    const loginForm = document.getElementById("login-form");
    const regForm = document.getElementById("register-form");
    const tabLogin = document.getElementById("tab-login");
    const tabReg = document.getElementById("tab-register");
    const errBox = document.getElementById("auth-error");
    errBox.classList.add("hidden");

    if (tab === "login") {
        loginForm.classList.remove("hidden");
        regForm.classList.add("hidden");
        tabLogin.classList.add("active");
        tabReg.classList.remove("active");
    } else {
        loginForm.classList.add("hidden");
        regForm.classList.remove("hidden");
        tabLogin.classList.remove("active");
        tabReg.classList.add("active");
    }
}

function showAuthError(msg) {
    const errBox = document.getElementById("auth-error");
    errBox.textContent = msg;
    errBox.classList.remove("hidden");
}

async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value;
    try {
        const data = await apiFetch("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ username, password }),
        });
        state.user = data.user;
        showToast(`Bentornato, ${state.user.display_name}!`, "success");
        await enterApp();
    } catch (err) {
        showAuthError(err.message);
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const username = document.getElementById("reg-username").value.trim();
    const display_name = document.getElementById("reg-displayname").value.trim();
    const password = document.getElementById("reg-password").value;
    try {
        const data = await apiFetch("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({ username, display_name, password }),
        });
        state.user = data.user;
        showToast(`Registrazione completata! Accesso eseguito come ${state.user.display_name}.`, "success");
        await enterApp();
    } catch (err) {
        showAuthError(err.message);
    }
}

async function handleLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    state.user = null;
    showAuthScreen();
}

async function enterApp() {
    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("app-screen").classList.remove("hidden");
    document.getElementById("current-user-name").textContent =
        state.user.display_name || state.user.username;

    await loadFornitoriList();
    await loadListsAndSelectLatest();
    await loadAcquistiDatabase();
    startRealtimeSync();
}

// ============================================================================
// GESTIONE ELENCO FORNITORI (Aldi, Coop, Lidl, Migros + modificabili)
// ============================================================================
async function loadFornitoriList() {
    try {
        const list = await apiFetch("/api/fornitori");
        if (Array.isArray(list) && list.length > 0) {
            state.fornitori = list;
        }
        renderAllFornitoriSelects();
    } catch (err) {
        console.error(err);
    }
}

function getFornitoriNames(extraName = "") {
    const names = state.fornitori.map((f) => f.nome);
    if (extraName && !names.some((n) => n.toLowerCase() === extraName.toLowerCase())) {
        names.push(extraName);
    }
    return names;
}

function renderAllFornitoriSelects() {
    // 1. Filtro fornitore nella barra in alto della Lista della Spesa
    const listFornSel = document.getElementById("current-list-fornitore");
    if (listFornSel) {
        const currentFilter = state.selectedSupplier || "ALL";
        const names = getFornitoriNames(currentFilter !== "ALL" ? currentFilter : "");
        listFornSel.innerHTML = `<option value="ALL">Tutti i fornitori</option>`;
        for (const n of names) {
            const opt = document.createElement("option");
            opt.value = n;
            opt.textContent = n;
            if (currentFilter !== "ALL" && n.toLowerCase() === currentFilter.toLowerCase()) {
                opt.selected = true;
            }
            listFornSel.appendChild(opt);
        }
        const editOpt = document.createElement("option");
        editOpt.value = "__MANAGE__";
        editOpt.textContent = "✎ Gestisci fornitori...";
        listFornSel.appendChild(editOpt);
    }

    // 2. Filtro fornitore nella barra Database Acquisti
    const dbFilterSel = document.getElementById("db-filter-supplier");
    if (dbFilterSel) {
        const currentFilter = state.dbFilterSupplier || "";
        const names = getFornitoriNames(currentFilter);
        dbFilterSel.innerHTML = `<option value="">Tutti i fornitori</option>`;
        for (const n of names) {
            const opt = document.createElement("option");
            opt.value = n;
            opt.textContent = n;
            if (n.toLowerCase() === currentFilter.toLowerCase()) opt.selected = true;
            dbFilterSel.appendChild(opt);
        }
    }
}

function openFornitoriModal() {
    renderFornitoriManageModalList();
    document.getElementById("new-fornitore-input").value = "";
    openModal("modal-fornitori");
}

function renderFornitoriManageModalList() {
    const container = document.getElementById("fornitori-manage-list");
    if (!container) return;
    container.innerHTML = "";

    for (const f of state.fornitori) {
        const row = document.createElement("div");
        row.className = "fornitore-manage-row";
        row.innerHTML = `
            <input type="text" value="${escapeHtmlAttr(f.nome)}" data-forn-id="${f.id}" />
            <button type="button" class="btn btn-primary btn-sm" data-act="save">Salva</button>
            <button type="button" class="btn btn-danger btn-sm" data-act="del">🗑</button>
        `;
        const inp = row.querySelector("input");
        row.querySelector('[data-act="save"]').addEventListener("click", async () => {
            const newName = inp.value.trim();
            if (!newName) return;
            try {
                state.fornitori = await apiFetch(`/api/fornitori/${f.id}`, {
                    method: "PUT",
                    body: JSON.stringify({ nome: newName }),
                });
                renderFornitoriManageModalList();
                renderAllFornitoriSelects();
                if (state.activeSection === "db") await loadAcquistiDatabase();
                else if (state.currentList) await loadSingleList(state.currentList.id);
                showToast(`Fornitore aggiornato in "${newName}"!`, "success");
            } catch (err) {
                showToast(err.message);
            }
        });
        row.querySelector('[data-act="del"]').addEventListener("click", async () => {
            if (!confirm(`Vuoi rimuovere "${f.nome}" dall'elenco fornitori?`)) return;
            try {
                state.fornitori = await apiFetch(`/api/fornitori/${f.id}`, { method: "DELETE" });
                renderFornitoriManageModalList();
                renderAllFornitoriSelects();
                showToast(`Fornitore "${f.nome}" rimosso.`);
            } catch (err) {
                showToast(err.message);
            }
        });
        container.appendChild(row);
    }
}

async function addNewFornitoreFromModal(e) {
    e.preventDefault();
    const inp = document.getElementById("new-fornitore-input");
    const nome = inp.value.trim();
    if (!nome) return;
    try {
        state.fornitori = await apiFetch("/api/fornitori", {
            method: "POST",
            body: JSON.stringify({ nome }),
        });
        inp.value = "";
        renderFornitoriManageModalList();
        renderAllFornitoriSelects();
        showToast(`Fornitore "${nome}" aggiunto!`, "success");
    } catch (err) {
        showToast(err.message);
    }
}

// ============================================================================
// NAVIGAZIONE TRA "LISTA DELLA SPESA" E "DATABASE ACQUISTI"
// ============================================================================
async function switchMainSection(section) {
    if (section === "db" && isSmartphoneDevice()) {
        section = "list";
    }
    state.activeSection = section;
    const isList = section === "list";

    document.getElementById("nav-tab-list").classList.toggle("active", isList);
    document.getElementById("nav-tab-db").classList.toggle("active", !isList);

    document.getElementById("list-header-toolbar").classList.toggle("hidden", !isList);
    document.getElementById("db-header-toolbar").classList.toggle("hidden", isList);

    document.getElementById("section-shopping-list").classList.toggle("hidden", !isList);
    document.getElementById("section-database-acquisti").classList.toggle("hidden", isList);

    if (!isList) {
        await loadAcquistiDatabase();
    } else if (state.currentList) {
        await loadSingleList(state.currentList.id);
    }
}

// ============================================================================
// GESTIONE LISTE DELLA SPESA, DATA E FORNITORE
// ============================================================================
function sortListsMostRecentFirst(lists) {
    return [...(lists || [])].sort((a, b) => {
        const dA = String(a.list_date || "");
        const dB = String(b.list_date || "");
        if (dA !== dB) return dB.localeCompare(dA);
        return (Number(b.id) || 0) - (Number(a.id) || 0);
    });
}

async function loadListsAndSelectLatest(preferredListId = null) {
    const rawLists = await apiFetch("/api/lists");
    state.lists = sortListsMostRecentFirst(rawLists);
    state.lastKnownNewestListId = state.lists[0]?.id || null;
    renderListSelector();

    // All'apertura dell'app (preferredListId === null) seleziona SEMPRE la lista con data più recente (state.lists[0])
    const targetId =
        preferredListId && state.lists.some((l) => l.id === Number(preferredListId))
            ? Number(preferredListId)
            : state.lists[0]?.id;

    if (targetId) {
        await loadSingleList(targetId);
    }
}

function renderListSelector() {
    const sel = document.getElementById("list-select");
    if (!sel) return;
    sel.innerHTML = "";
    for (const l of state.lists) {
        const opt = document.createElement("option");
        opt.value = l.id;
        const activeCount = l.active_items || 0;
        const purchasedCount = l.purchased_items || 0;
        const dateFormatted = formatDateIT(l.list_date);
        const forn = l.fornitore ? ` [${l.fornitore}]` : "";
        opt.textContent = `${dateFormatted}${forn} — ${l.name} (${activeCount} in lista, ${purchasedCount} acq.)`;
        if (state.currentList && state.currentList.id === l.id) {
            opt.selected = true;
        }
        sel.appendChild(opt);
    }
}

async function loadSingleList(listId) {
    const data = await apiFetch(`/api/lists/${listId}`);
    state.currentList = data.list;
    state.categories = data.categories;
    if (Array.isArray(data.fornitori) && data.fornitori.length > 0) {
        state.fornitori = data.fornitori;
    }
    state.items = data.items;

    const sel = document.getElementById("list-select");
    if (sel) sel.value = String(state.currentList.id);

    const dateInput = document.getElementById("current-list-date");
    if (dateInput) dateInput.value = state.currentList.list_date;

    renderAllFornitoriSelects();
    renderAll();
}

async function onSelectListChange(listId) {
    if (!listId) return;
    await loadSingleList(Number(listId));
}

async function onChangeListDate(newDate) {
    if (!state.currentList || !newDate) return;
    try {
        const data = await apiFetch(`/api/lists/${state.currentList.id}`, {
            method: "PUT",
            body: JSON.stringify({ list_date: newDate }),
        });
        state.currentList = data.list;
        await refreshListsSummaryOnly();
        showToast(`Data lista aggiornata al ${formatDateIT(newDate)}`, "success");
    } catch (err) {
        showToast(err.message);
    }
}

async function onChangeListFornitore(val) {
    if (val === "__MANAGE__") {
        renderAllFornitoriSelects();
        openFornitoriModal();
        return;
    }
    state.selectedSupplier = val || "ALL";
    renderAll();
}

async function refreshListsSummaryOnly() {
    try {
        const rawLists = await apiFetch("/api/lists");
        state.lists = sortListsMostRecentFirst(rawLists);
        state.lastKnownNewestListId = state.lists[0]?.id || null;
        renderListSelector();
    } catch (e) {
        console.error(e);
    }
}

function openNewListModal() {
    document.getElementById("new-list-date").value = todayISO();
    document.getElementById("new-list-name").value = "Lista Supermercato";
    document.getElementById("new-list-mode").value = "template";

    const sel = document.getElementById("new-list-fornitore");
    if (sel) {
        sel.innerHTML = "";
        for (const n of getFornitoriNames(state.currentList?.fornitore || "Aldi")) {
            const opt = document.createElement("option");
            opt.value = n;
            opt.textContent = n;
            sel.appendChild(opt);
        }
    }
    openModal("modal-new-list");
}

async function submitNewList(e) {
    e.preventDefault();
    const list_date = document.getElementById("new-list-date").value || todayISO();
    const fornitore = document.getElementById("new-list-fornitore").value || "Aldi";
    const name = document.getElementById("new-list-name").value.trim() || "Lista Supermercato";
    const mode = document.getElementById("new-list-mode").value;

    try {
        const data = await apiFetch("/api/lists", {
            method: "POST",
            body: JSON.stringify({
                name,
                list_date,
                fornitore,
                mode,
                source_list_id: state.currentList ? state.currentList.id : null,
            }),
        });
        closeModal("modal-new-list");
        state.currentList = data.list;
        state.categories = data.categories;
        state.items = data.items;
        state.filterMode = "all";
        updateFilterButtonsUI();
        await refreshListsSummaryOnly();
        renderAllFornitoriSelects();
        renderAll();
        showToast(`Nuova lista creata (${formatDateIT(list_date)} — ${fornitore})!`, "success");
    } catch (err) {
        showToast(err.message);
    }
}

function openListMenuModal() {
    if (!state.currentList) return;
    document.getElementById("edit-list-name").value = state.currentList.name;
    openModal("modal-list-menu");
}

async function saveListName() {
    if (!state.currentList) return;
    const name = document.getElementById("edit-list-name").value.trim();
    if (!name) return;
    const data = await apiFetch(`/api/lists/${state.currentList.id}`, {
        method: "PUT",
        body: JSON.stringify({ name }),
    });
    state.currentList = data.list;
    await refreshListsSummaryOnly();
    closeModal("modal-list-menu");
    showToast("Nome della lista aggiornato!", "success");
}

async function clearPurchasedItems() {
    if (!state.currentList) return;
    const data = await apiFetch(`/api/lists/${state.currentList.id}`, {
        method: "PUT",
        body: JSON.stringify({ action: "clear_purchased" }),
    });
    state.currentList = data.list;
    state.items = data.items;
    await refreshListsSummaryOnly();
    renderAll();
    closeModal("modal-list-menu");
    showToast("Evidenziazione arancione rimossa da tutti i prodotti.");
}

async function clearAllQuantities() {
    if (!state.currentList) return;
    if (!confirm("Vuoi azzerare tutte le quantità e i prodotti evidenziati di questa lista?")) return;
    const data = await apiFetch(`/api/lists/${state.currentList.id}`, {
        method: "PUT",
        body: JSON.stringify({ action: "clear_quantities" }),
    });
    state.currentList = data.list;
    state.items = data.items;
    await refreshListsSummaryOnly();
    renderAll();
    closeModal("modal-list-menu");
    showToast("Tutte le quantità sono state azzerate.");
}

async function syncMissingFromExcel() {
    if (!state.currentList) return;
    const data = await apiFetch(`/api/lists/${state.currentList.id}/reset-excel`, {
        method: "POST",
    });
    state.currentList = data.list;
    state.categories = data.categories;
    state.items = data.items;
    await refreshListsSummaryOnly();
    renderAll();
    closeModal("modal-list-menu");
    showToast("Catalogo Excel sincronizzato nella lista!", "success");
}

async function deleteCurrentList() {
    if (!state.currentList) return;
    if (!confirm(`Vuoi eliminare definitivamente la lista "${state.currentList.name}" del ${formatDateIT(state.currentList.list_date)}?`)) {
        return;
    }
    const res = await apiFetch(`/api/lists/${state.currentList.id}`, { method: "DELETE" });
    closeModal("modal-list-menu");
    await loadListsAndSelectLatest(res.next_list_id);
    showToast("Lista eliminata.");
}

// ============================================================================
// FILTRI, RICERCA E ORDINAMENTO (SEZIONE LISTA DELLA SPESA)
// ============================================================================
function isItemActive(item) {
    const q = String(item.quantity || "").trim();
    return (q !== "" && q !== "0") || item.in_list === 1 || item.purchased === 1;
}

function setFilterMode(mode) {
    state.filterMode = mode;
    updateFilterButtonsUI();
    renderProducts();
}

function updateFilterButtonsUI() {
    document.getElementById("filter-btn-all").classList.toggle("active", state.filterMode === "all");
    document.getElementById("filter-btn-active").classList.toggle("active", state.filterMode === "active");
    document.getElementById("filter-btn-purchased").classList.toggle("active", state.filterMode === "purchased");
}

function setSortMode(mode) {
    state.sortMode = mode;
    renderProducts();
}

function selectCategory(catName) {
    state.selectedCategory = catName;
    renderCategoryPills();
    renderProducts();
}

function onSearchInput(val) {
    state.searchQuery = val.trim();
    document.getElementById("clear-search-btn").classList.toggle("hidden", state.searchQuery === "");
    renderProducts();
}

function clearSearch() {
    const input = document.getElementById("search-input");
    input.value = "";
    onSearchInput("");
}

// ============================================================================
// RENDERING UI LISTA DELLA SPESA
// ============================================================================
function renderAll() {
    updateStatsCounters();
    renderCategoryPills();
    renderProducts();
}

function updateStatsCounters() {
    const total = state.items.length;
    const activeItems = state.items.filter((i) => isItemActive(i));
    const active = activeItems.length;
    const purchased = state.items.filter((i) => i.purchased === 1).length;
    const totalMoney = activeItems.reduce((acc, i) => {
        const q = parseFloat(String(i.quantity || "0").replace(",", ".")) || (i.purchased === 1 ? 1 : 0);
        const p = Number(i.unit_price || 0);
        return acc + q * p;
    }, 0);

    document.getElementById("count-total").textContent = total;
    document.getElementById("count-active").textContent = active;
    document.getElementById("count-purchased").textContent = purchased;
    document.getElementById("seg-count-active").textContent = active;
    document.getElementById("seg-count-purchased").textContent = purchased;
    const moneyEl = document.getElementById("count-list-money");
    if (moneyEl) moneyEl.textContent = totalMoney.toFixed(2);
}

function renderCategoryPills() {
    const nav = document.getElementById("category-pills");
    if (!nav) return;
    nav.innerHTML = "";

    const allPill = document.createElement("button");
    allPill.type = "button";
    allPill.className = `cat-pill ${state.selectedCategory === "ALL" ? "active" : ""}`;
    allPill.innerHTML = `<span>Tutti i Tipi</span> <span class="cat-pill-count">${state.items.length}</span>`;
    allPill.onclick = () => selectCategory("ALL");
    nav.appendChild(allPill);

    const catMap = new Map();
    for (const c of state.categories) {
        catMap.set(c.name.toUpperCase(), c);
    }
    for (const item of state.items) {
        const key = (item.category || "ALTRO").toUpperCase();
        if (!catMap.has(key)) {
            catMap.set(key, { name: key, icon: "📦", color: "#475569", sort_order: 99, column_group: 1 });
        }
    }

    const sortedCats = Array.from(catMap.values()).sort((a, b) => (a.sort_order || 99) - (b.sort_order || 99));

    for (const cat of sortedCats) {
        const count = state.items.filter((i) => (i.category || "").toUpperCase() === cat.name.toUpperCase()).length;
        const pill = document.createElement("button");
        pill.type = "button";
        pill.className = `cat-pill ${state.selectedCategory === cat.name.toUpperCase() ? "active" : ""}`;
        pill.innerHTML = `<span>${cat.icon || "📦"} ${cat.name}</span> <span class="cat-pill-count">${count}</span>`;
        pill.onclick = () => selectCategory(cat.name.toUpperCase());
        nav.appendChild(pill);
    }
}

function getFilteredItems() {
    const q = state.searchQuery.toLowerCase();
    return state.items.filter((item) => {
        if (state.selectedCategory !== "ALL" && (item.category || "").toUpperCase() !== state.selectedCategory) {
            return false;
        }
        if (state.selectedSupplier && state.selectedSupplier !== "ALL") {
            const itemSupp = (item.fornitore || state.currentList?.fornitore || "Aldi").trim();
            if (itemSupp.toLowerCase() !== state.selectedSupplier.toLowerCase()) {
                return false;
            }
        }
        if (state.filterMode === "active" && !isItemActive(item)) {
            return false;
        }
        if (state.filterMode === "purchased" && item.purchased !== 1) {
            return false;
        }
        if (q && !item.name.toLowerCase().includes(q) && !(item.category || "").toLowerCase().includes(q)) {
            return false;
        }
        return true;
    });
}

function renderProducts() {
    const container = document.getElementById("products-container");
    if (!container) return;
    container.innerHTML = "";

    const filtered = getFilteredItems();

    if (filtered.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        if (state.filterMode === "active") {
            empty.innerHTML = `
                <h3>Nessun prodotto ancora selezionato per l'acquisto</h3>
                <p>Passa alla vista <strong>"📋 Tutti"</strong> per inserire le quantità dei prodotti, oppure aggiungi un nuovo prodotto.</p>
                <div style="margin-top:14px; display:flex; gap:8px; justify-content:center; flex-wrap:wrap;">
                    <button type="button" class="btn btn-primary" onclick="setFilterMode('all')">📋 Mostra tutti i prodotti</button>
                    <button type="button" class="btn btn-secondary" onclick="openAddProductModal()">＋ Aggiungi Prodotto</button>
                </div>
            `;
        } else if (state.filterMode === "purchased") {
            empty.innerHTML = `
                <h3>Nessun prodotto evidenziato in arancione</h3>
                <p>Tieni premuto per più di <strong>1 secondo</strong> su un prodotto quando lo metti nel carrello per evidenziarlo in arancione!</p>
            `;
        } else {
            empty.innerHTML = `
                <h3>Nessun prodotto trovato</h3>
                <p>Prova a modificare la ricerca oppure aggiungi questo prodotto alla lista.</p>
                <div style="margin-top:14px;">
                    <button type="button" class="btn btn-primary" onclick="openAddProductModal('${escapeHtmlAttr(state.searchQuery)}')">
                        ＋ Aggiungi "${escapeHtml(state.searchQuery || "Nuovo Prodotto")}"
                    </button>
                </div>
            `;
        }
        container.appendChild(empty);
        return;
    }

    if (state.sortMode === "type_alpha") {
        const catMetaMap = new Map();
        for (const c of state.categories) {
            catMetaMap.set(c.name.toUpperCase(), c);
        }

        const groups = new Map();
        for (const item of filtered) {
            const cKey = (item.category || "ALTRO").toUpperCase();
            if (!groups.has(cKey)) groups.set(cKey, []);
            groups.get(cKey).push(item);
        }

        for (const [, arr] of groups.entries()) {
            arr.sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }));
        }

        const sortedGroupKeys = Array.from(groups.keys()).sort((a, b) => {
            const oa = catMetaMap.get(a)?.sort_order ?? 99;
            const ob = catMetaMap.get(b)?.sort_order ?? 99;
            if (oa !== ob) return oa - ob;
            return a.localeCompare(b, "it");
        });

        if (sortedGroupKeys.length > 1 && state.selectedCategory === "ALL") {
            const grid = document.createElement("div");
            grid.className = "excel-columns-grid";
            const col1 = document.createElement("div");
            col1.className = "excel-column";
            const col2 = document.createElement("div");
            col2.className = "excel-column";

            for (const cKey of sortedGroupKeys) {
                const meta = catMetaMap.get(cKey) || { name: cKey, icon: "📦", color: "#475569", column_group: 1 };
                const sectionEl = buildCategorySection(meta, groups.get(cKey), false);
                if (meta.column_group === 2) {
                    col2.appendChild(sectionEl);
                } else {
                    col1.appendChild(sectionEl);
                }
            }
            grid.appendChild(col1);
            grid.appendChild(col2);
            container.appendChild(grid);
        } else {
            for (const cKey of sortedGroupKeys) {
                const meta = catMetaMap.get(cKey) || { name: cKey, icon: "📦", color: "#475569" };
                container.appendChild(buildCategorySection(meta, groups.get(cKey), false));
            }
        }
    } else {
        const sorted = [...filtered].sort((a, b) => {
            const cmp = a.name.localeCompare(b.name, "it", { sensitivity: "base" });
            return state.sortMode === "alpha_desc" ? -cmp : cmp;
        });
        const meta = {
            name: state.sortMode === "alpha_desc" ? "ORDINE ALFABETICO (Z → A)" : "ORDINE ALFABETICO (A → Z)",
            icon: "🔤",
            color: "#1e293b",
        };
        container.appendChild(buildCategorySection(meta, sorted, true));
    }
}

function buildCategorySection(meta, items, showCatBadgeOnRow) {
    const section = document.createElement("section");
    section.className = "category-section";

    const activeInCat = items.filter((i) => isItemActive(i)).length;
    const purchasedInCat = items.filter((i) => i.purchased === 1).length;

    const header = document.createElement("div");
    header.className = "category-header";
    header.style.backgroundColor = meta.color || "#334155";
    header.innerHTML = `
        <div class="category-header-left">
            <span>${meta.icon || "📦"}</span>
            <span>${escapeHtml(meta.name)}</span>
        </div>
        <div class="category-header-right">
            <span>${activeInCat > 0 ? `${purchasedInCat}/${activeInCat} acq.` : `${items.length} prod.`}</span>
            <button type="button" class="btn-quick-add-cat" onclick="openAddProductModal('', '${escapeHtmlAttr(meta.name)}')">
                ＋ Aggiungi
            </button>
        </div>
    `;
    section.appendChild(header);

    const listEl = document.createElement("div");
    listEl.className = "items-list";
    for (const item of items) {
        listEl.appendChild(buildProductRow(item, showCatBadgeOnRow));
    }
    section.appendChild(listEl);

    return section;
}

// ============================================================================
// RIGA PRODOTTO: PRESSIONE > 1 SECONDO (ARANCIONE), QUANTITÀ E PREZZO UNITARIO
// ============================================================================
function buildProductRow(item, showCatBadge = false) {
    const row = document.createElement("div");
    row.className = "product-row";
    row.dataset.itemId = item.id;

    const active = isItemActive(item);
    const purchased = item.purchased === 1;
    if (active) row.classList.add("is-active");
    if (purchased) row.classList.add("is-purchased");

    const hasQty = String(item.quantity || "").trim() !== "" && String(item.quantity || "").trim() !== "0";
    const unitPriceNum = Number(item.unit_price || 0);
    const qtyNum = parseFloat(String(item.quantity || "0").replace(",", ".")) || 0;
    const rowTotal = qtyNum > 0 && unitPriceNum > 0 ? (qtyNum * unitPriceNum).toFixed(2) : "";
    const suppName = (item.fornitore || state.currentList?.fornitore || "Aldi").trim();
    const commentText = String(item.notes || "").trim();

    const fornOptions = getFornitoriNames(suppName);
    const suppOptionsHtml =
        fornOptions
            .map(
                (fn) =>
                    `<option value="${escapeHtmlAttr(fn)}" ${
                        fn.toLowerCase() === suppName.toLowerCase() ? "selected" : ""
                    }>${escapeHtml(fn)}</option>`
            )
            .join("") + `<option value="__MANAGE__">＋ Altro...</option>`;

    const commentHtml = commentText
        ? `<span class="comment-pill" data-action="comment-edit" title="Clicca per modificare il commento (vale solo per questa lista)">
               💬 <span class="comment-pill-text">${escapeHtml(commentText)}</span>
               <button type="button" class="comment-pill-clear" data-action="comment-clear" title="Cancella commento">✕</button>
           </span>`
        : `<button type="button" class="btn-add-comment" data-action="comment-edit" title="Aggiungi commento accanto al nome (solo per questa lista)">💬</button>`;

    row.innerHTML = `
        <div class="longpress-progress"></div>
        <div class="product-info">
            <div class="product-title-line">
                ${purchased ? `<span class="purchased-pill">✓<span class="pc-only"> Acquistato</span></span>` : ""}
                <span class="product-name">${escapeHtml(item.name)}</span>
                ${showCatBadge ? `<span class="cat-mini-badge">${escapeHtml(item.category)}</span>` : ""}
            </div>
            <div class="product-sub-line">
                <label class="product-supplier-wrap" title="Fornitore del prodotto (modificabile)">
                    <span class="product-supplier-icon">🏪</span>
                    <select class="product-supplier-select" aria-label="Fornitore per ${escapeHtmlAttr(item.name)}">
                        ${suppOptionsHtml}
                    </select>
                </label>
                <span class="comment-slot">${commentHtml}</span>
                ${rowTotal ? `<span class="row-total-badge" title="Prezzo Totale (Q.tà × Prezzo Unit.)">= ${rowTotal}</span>` : ""}
            </div>
        </div>
        <div class="product-controls">
            <div class="price-inline-box">
                <input
                    type="number"
                    step="0.01"
                    min="0"
                    class="price-input"
                    value="${unitPriceNum > 0 ? unitPriceNum : ""}"
                    placeholder="Prezzo"
                    title="Prezzo Unitario per ${escapeHtmlAttr(item.name)}"
                />
            </div>
            <div class="qty-stepper">
                <button type="button" class="qty-btn" title="Diminuisci quantità" data-action="dec">−</button>
                <input
                    type="text"
                    inputmode="decimal"
                    class="qty-input ${hasQty ? "has-val" : ""}"
                    value="${escapeHtmlAttr(item.quantity || "")}"
                    placeholder="Q.tà"
                    aria-label="Quantità per ${escapeHtmlAttr(item.name)}"
                />
                <button type="button" class="qty-btn" title="Aumenta quantità" data-action="inc">＋</button>
            </div>
            <span class="unit-badge" title="Clicca per modificare unità, fornitore o dettagli prodotto" data-action="edit">
                ${escapeHtml(item.unit || "Pz")}
            </span>
            <button type="button" class="row-action-btn" title="Modifica o elimina prodotto" data-action="edit">
                ✎
            </button>
        </div>
    `;

    const decBtn = row.querySelector('[data-action="dec"]');
    const incBtn = row.querySelector('[data-action="inc"]');
    const qtyInput = row.querySelector(".qty-input");
    const priceInput = row.querySelector(".price-input");
    const editBtns = row.querySelectorAll('[data-action="edit"]');

    decBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        adjustQuantityStep(item.id, -1);
    });

    incBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        adjustQuantityStep(item.id, +1);
    });

    qtyInput.addEventListener("click", (e) => e.stopPropagation());
    qtyInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            qtyInput.blur();
        }
    });
    qtyInput.addEventListener("change", () => {
        saveQuantityDirect(item.id, qtyInput.value);
    });

    priceInput.addEventListener("click", (e) => e.stopPropagation());
    priceInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            priceInput.blur();
        }
    });
    priceInput.addEventListener("change", () => {
        saveUnitPriceDirect(item.id, priceInput.value);
    });

    editBtns.forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            openEditProductModal(item.id);
        });
    });

    // Gestione commento inline accanto al nome prodotto
    const commentSlot = row.querySelector(".comment-slot");
    const commentClearBtn = row.querySelector('[data-action="comment-clear"]');
    const commentEditTrigger = row.querySelector('[data-action="comment-edit"]');

    if (commentClearBtn) {
        commentClearBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            saveCommentDirect(item.id, "");
        });
    }

    if (commentEditTrigger && commentSlot) {
        commentEditTrigger.addEventListener("click", (e) => {
            e.stopPropagation();
            openInlineCommentEditor(commentSlot, item);
        });
    }

    // Selettore fornitore direttamente sotto il nome del prodotto
    const suppSelect = row.querySelector(".product-supplier-select");
    if (suppSelect) {
        suppSelect.addEventListener("click", (e) => e.stopPropagation());
        suppSelect.addEventListener("change", (e) => {
            e.stopPropagation();
            const val = suppSelect.value;
            if (val === "__MANAGE__") {
                suppSelect.value = suppName;
                openFornitoriModal();
                return;
            }
            saveItemSupplierDirect(item.id, val);
        });
    }

    attachLongPressHandler(row, item.id);
    return row;
}

async function saveItemSupplierDirect(itemId, newFornitore) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;

    const cleanForn = String(newFornitore || "Aldi").trim() || "Aldi";
    item.fornitore = cleanForn;
    renderAll();

    try {
        const updated = await apiFetch(`/api/items/${itemId}`, {
            method: "PUT",
            body: JSON.stringify({ fornitore: cleanForn }),
        });
        Object.assign(item, updated);
        showToast(`🏪 Fornitore di "${item.name}" impostato su ${cleanForn}`, "success");
    } catch (err) {
        showToast(err.message);
    }
}

function openInlineCommentEditor(slotEl, item) {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "inline-comment-input";
    inp.placeholder = "Commento...";
    inp.value = item.notes || "";
    slotEl.innerHTML = "";
    slotEl.appendChild(inp);
    inp.focus();
    inp.select();

    let saved = false;
    const commit = () => {
        if (saved) return;
        saved = true;
        saveCommentDirect(item.id, inp.value.trim());
    };

    inp.addEventListener("click", (e) => e.stopPropagation());
    inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            commit();
        } else if (e.key === "Escape") {
            saved = true;
            renderAll();
        }
    });
    inp.addEventListener("blur", commit);
}

async function saveCommentDirect(itemId, newComment) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;

    const cleanComment = String(newComment || "").trim();
    if (cleanComment === String(item.notes || "").trim()) {
        renderAll();
        return;
    }

    item.notes = cleanComment;
    renderAll();

    try {
        const updated = await apiFetch(`/api/items/${itemId}`, {
            method: "PUT",
            body: JSON.stringify({ notes: cleanComment }),
        });
        Object.assign(item, updated);
        if (cleanComment) {
            showToast(`💬 Commento salvato per "${item.name}"`, "success");
        }
    } catch (err) {
        showToast(err.message);
    }
}

function attachLongPressHandler(rowEl, itemId) {
    let pressTimer = null;
    let startX = 0;
    let startY = 0;

    const isInteractiveTarget = (target) => {
        return Boolean(
            target.closest(
                ".product-controls, .comment-slot, .btn-add-comment, .comment-pill, .inline-comment-input, input, button, select, a"
            )
        );
    };

    const startPress = (clientX, clientY, target) => {
        if (isInteractiveTarget(target)) return;
        startX = clientX;
        startY = clientY;
        rowEl.classList.add("pressing");

        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
            rowEl.classList.remove("pressing");
            if (navigator.vibrate) {
                try {
                    navigator.vibrate(65);
                } catch (_) {}
            }
            togglePurchasedOrange(itemId);
        }, LONG_PRESS_MS);
    };

    const cancelPress = () => {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
        rowEl.classList.remove("pressing");
    };

    const movePress = (clientX, clientY) => {
        if (!pressTimer) return;
        const dx = Math.abs(clientX - startX);
        const dy = Math.abs(clientY - startY);
        if (dx > 12 || dy > 12) {
            cancelPress();
        }
    };

    rowEl.addEventListener(
        "touchstart",
        (e) => {
            if (e.touches.length !== 1) {
                cancelPress();
                return;
            }
            const t = e.touches[0];
            startPress(t.clientX, t.clientY, e.target);
        },
        { passive: true }
    );

    rowEl.addEventListener(
        "touchmove",
        (e) => {
            if (e.touches.length !== 1) return;
            const t = e.touches[0];
            movePress(t.clientX, t.clientY);
        },
        { passive: true }
    );

    rowEl.addEventListener("touchend", cancelPress);
    rowEl.addEventListener("touchcancel", cancelPress);

    rowEl.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return;
        startPress(e.clientX, e.clientY, e.target);
    });
    rowEl.addEventListener("mousemove", (e) => movePress(e.clientX, e.clientY));
    rowEl.addEventListener("mouseup", cancelPress);
    rowEl.addEventListener("mouseleave", cancelPress);

    rowEl.addEventListener("contextmenu", (e) => {
        if (!isInteractiveTarget(e.target)) {
            e.preventDefault();
        }
    });
}

async function togglePurchasedOrange(itemId) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;

    const newPurchased = item.purchased === 1 ? 0 : 1;
    let newQty = item.quantity;
    if (newPurchased === 1 && (!newQty || String(newQty).trim() === "" || String(newQty).trim() === "0")) {
        newQty = "1";
    }

    item.purchased = newPurchased;
    item.quantity = newQty;
    if (newPurchased === 1) item.in_list = 1;
    renderAll();

    if (newPurchased === 1) {
        showToast(`🟠 "${item.name}" acquistato e registrato nel Database!`, "orange");
    } else {
        showToast(`Evidenziazione rimossa da "${item.name}".`);
    }

    try {
        const updated = await apiFetch(`/api/items/${itemId}`, {
            method: "PUT",
            body: JSON.stringify({
                purchased: newPurchased,
                quantity: newQty,
            }),
        });
        Object.assign(item, updated);
        updateStatsCounters();
        refreshListsSummaryOnly();
        refreshDbCounterBadge();
    } catch (err) {
        showToast(err.message);
    }
}

async function adjustQuantityStep(itemId, delta) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;

    const raw = String(item.quantity || "").trim().replace(",", ".");
    let currentNum = parseFloat(raw);
    if (isNaN(currentNum)) currentNum = 0;

    const step = raw.includes(".") ? 0.5 : 1;
    let nextNum = Math.round((currentNum + delta * step) * 100) / 100;
    if (nextNum < 0) nextNum = 0;

    const nextQty = nextNum === 0 ? "" : String(nextNum);
    await saveQuantityDirect(itemId, nextQty);
}

async function saveQuantityDirect(itemId, newQtyValue) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;

    const cleanQty = String(newQtyValue || "").trim();
    const isZeroOrEmpty = cleanQty === "" || cleanQty === "0";
    const keepPurchased = isZeroOrEmpty ? 0 : item.purchased;
    const nextInList = isZeroOrEmpty ? 0 : 1;

    item.quantity = isZeroOrEmpty ? "" : cleanQty;
    item.in_list = nextInList;
    item.purchased = keepPurchased;
    renderAll();

    try {
        const updated = await apiFetch(`/api/items/${itemId}`, {
            method: "PUT",
            body: JSON.stringify({
                quantity: item.quantity,
                in_list: nextInList,
                purchased: keepPurchased,
            }),
        });
        Object.assign(item, updated);
        updateStatsCounters();
        refreshListsSummaryOnly();
        refreshDbCounterBadge();
    } catch (err) {
        showToast(err.message);
    }
}

async function saveUnitPriceDirect(itemId, newPriceValue) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;

    const unit_price = parseFloat(String(newPriceValue || "0").replace(",", ".")) || 0;
    item.unit_price = unit_price;
    renderAll();

    try {
        const updated = await apiFetch(`/api/items/${itemId}`, {
            method: "PUT",
            body: JSON.stringify({ unit_price }),
        });
        Object.assign(item, updated);
        updateStatsCounters();
        refreshDbCounterBadge();
    } catch (err) {
        showToast(err.message);
    }
}

// ============================================================================
// AGGIUNTA, MODIFICA ED ELIMINAZIONE PRODOTTI NELLA LISTA
// ============================================================================
function populateCategorySelect(selectedCat = "VERDURA") {
    const sel = document.getElementById("prod-category");
    if (!sel) return;
    sel.innerHTML = "";

    const catNames = new Set(state.categories.map((c) => c.name.toUpperCase()));
    for (const item of state.items) {
        if (item.category) catNames.add(item.category.toUpperCase());
    }

    for (const cName of catNames) {
        const opt = document.createElement("option");
        opt.value = cName;
        opt.textContent = cName;
        if (cName === selectedCat.toUpperCase()) opt.selected = true;
        sel.appendChild(opt);
    }

    const newOpt = document.createElement("option");
    newOpt.value = "__NEW__";
    newOpt.textContent = "＋ Nuovo Tipo / Reparto...";
    sel.appendChild(newOpt);

    document.getElementById("new-category-group").classList.add("hidden");
}

function populateProductFornitoreSelect(selectedForn = "Aldi") {
    const sel = document.getElementById("prod-fornitore");
    if (!sel) return;
    sel.innerHTML = "";

    const names = getFornitoriNames(selectedForn);
    for (const n of names) {
        const opt = document.createElement("option");
        opt.value = n;
        opt.textContent = n;
        if (n.toLowerCase() === (selectedForn || "Aldi").toLowerCase()) opt.selected = true;
        sel.appendChild(opt);
    }

    const newOpt = document.createElement("option");
    newOpt.value = "__NEW__";
    newOpt.textContent = "＋ Nuovo Fornitore...";
    sel.appendChild(newOpt);

    document.getElementById("prod-new-fornitore-group").classList.add("hidden");
}

function onProdCategorySelectChange(val) {
    const grp = document.getElementById("new-category-group");
    if (val === "__NEW__") {
        grp.classList.remove("hidden");
        document.getElementById("prod-new-category").focus();
    } else {
        grp.classList.add("hidden");
    }
}

function onProdFornitoreSelectChange(val) {
    const grp = document.getElementById("prod-new-fornitore-group");
    if (val === "__NEW__") {
        grp.classList.remove("hidden");
        document.getElementById("prod-new-fornitore").focus();
    } else {
        grp.classList.add("hidden");
    }
}

function openAddProductModal(prefillName = "", prefillCategory = "") {
    document.getElementById("modal-product-title").textContent = "➕ Aggiungi Prodotto";
    document.getElementById("prod-edit-id").value = "";
    document.getElementById("prod-name").value = prefillName;
    document.getElementById("prod-quantity").value = "1";
    document.getElementById("prod-unit").value = "Pz";
    document.getElementById("prod-unit-price").value = "";
    document.getElementById("prod-notes").value = "";
    document.getElementById("prod-save-catalog").checked = true;
    document.getElementById("prod-save-catalog-wrap").classList.remove("hidden");
    document.getElementById("btn-delete-product").classList.add("hidden");

    const defaultCat =
        prefillCategory ||
        (state.selectedCategory !== "ALL" ? state.selectedCategory : "ALIMENTARI");
    populateCategorySelect(defaultCat);
    populateProductFornitoreSelect(state.currentList?.fornitore || "Aldi");
    openModal("modal-product");
    setTimeout(() => document.getElementById("prod-name").focus(), 60);
}

function openEditProductModal(itemId) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return;

    document.getElementById("modal-product-title").textContent = "✎ Modifica Prodotto";
    document.getElementById("prod-edit-id").value = String(item.id);
    document.getElementById("prod-name").value = item.name;
    document.getElementById("prod-quantity").value = item.quantity || "";
    document.getElementById("prod-unit").value = item.unit || "";
    document.getElementById("prod-unit-price").value = item.unit_price > 0 ? item.unit_price : "";
    document.getElementById("prod-notes").value = item.notes || "";
    document.getElementById("prod-save-catalog-wrap").classList.add("hidden");
    document.getElementById("btn-delete-product").classList.remove("hidden");

    populateCategorySelect(item.category || "ALIMENTARI");
    populateProductFornitoreSelect(item.fornitore || state.currentList?.fornitore || "Aldi");
    openModal("modal-product");
}

async function submitProductModal(e) {
    e.preventDefault();
    const editId = document.getElementById("prod-edit-id").value;
    const name = document.getElementById("prod-name").value.trim();
    const catSelect = document.getElementById("prod-category").value;
    const newCatName = document.getElementById("prod-new-category").value.trim().toUpperCase();
    const category = catSelect === "__NEW__" ? newCatName || "ALTRO" : catSelect;

    const fornSelect = document.getElementById("prod-fornitore").value;
    const newFornName = document.getElementById("prod-new-fornitore").value.trim();
    const fornitore = fornSelect === "__NEW__" ? newFornName || "Aldi" : fornSelect;

    const quantity = document.getElementById("prod-quantity").value.trim();
    const unit = document.getElementById("prod-unit").value.trim();
    const unit_price = parseFloat(document.getElementById("prod-unit-price").value || "0") || 0;
    const notes = document.getElementById("prod-notes").value.trim();
    const save_to_catalog = document.getElementById("prod-save-catalog").checked;

    if (!name) return;

    try {
        if (editId) {
            const updated = await apiFetch(`/api/items/${editId}`, {
                method: "PUT",
                body: JSON.stringify({ name, category, fornitore, quantity, unit, unit_price, notes }),
            });
            const idx = state.items.findIndex((i) => i.id === Number(editId));
            if (idx !== -1) state.items[idx] = updated;
            showToast(`Prodotto "${name}" aggiornato!`, "success");
        } else {
            const created = await apiFetch(`/api/lists/${state.currentList.id}/items`, {
                method: "POST",
                body: JSON.stringify({ name, category, fornitore, quantity, unit, unit_price, notes, save_to_catalog }),
            });
            state.items.push(created);
            showToast(`Prodotto "${name}" aggiunto alla lista!`, "success");
        }

        state.categories = await apiFetch("/api/categories");
        await loadFornitoriList();
        closeModal("modal-product");
        renderAll();
        refreshListsSummaryOnly();
        refreshDbCounterBadge();
    } catch (err) {
        showToast(err.message);
    }
}

async function deleteProductFromModal() {
    const editId = document.getElementById("prod-edit-id").value;
    if (!editId) return;
    const item = state.items.find((i) => i.id === Number(editId));
    if (!item) return;

    const alsoCatalog = confirm(
        `Vuoi rimuovere "${item.name}" anche dal catalogo base per le liste future?\n\nPremi OK per eliminarlo anche dal catalogo base, oppure Annulla per rimuoverlo solo da questa lista.`
    );

    try {
        await apiFetch(`/api/items/${editId}?catalog=${alsoCatalog ? "1" : "0"}`, {
            method: "DELETE",
        });
        state.items = state.items.filter((i) => i.id !== Number(editId));
        closeModal("modal-product");
        renderAll();
        refreshListsSummaryOnly();
        refreshDbCounterBadge();
        showToast(`"${item.name}" rimosso dalla lista.`);
    } catch (err) {
        showToast(err.message);
    }
}

// ============================================================================
// SEZIONE 2: DATABASE ACQUISTI (TABELLA PRINCIPALE & RAGGRUPPAMENTO ANNO/MESE/GIORNO/FORNITORE)
// ============================================================================
async function refreshDbCounterBadge() {
    try {
        const data = await apiFetch("/api/acquisti");
        const countEl = document.getElementById("nav-db-count");
        if (countEl) countEl.textContent = data.items ? data.items.length : 0;
    } catch (_) {}
}

async function loadAcquistiDatabase() {
    try {
        const params = new URLSearchParams();
        if (state.dbFilterYear) params.set("anno", state.dbFilterYear);
        if (state.dbFilterMonth) params.set("mese", state.dbFilterMonth);
        if (state.dbFilterDate) params.set("giorno", state.dbFilterDate);
        if (state.dbFilterSupplier) params.set("fornitore", state.dbFilterSupplier);
        if (state.dbSearchQuery) params.set("q", state.dbSearchQuery);

        const data = await apiFetch(`/api/acquisti?${params.toString()}`);
        state.acquisti = data.items || [];
        if (Array.isArray(data.fornitori) && data.fornitori.length > 0) {
            state.fornitori = data.fornitori;
        }
        state.availableYears = data.available_years || [];
        state.catalogSuggestions = data.catalog_suggestions || [];

        const countEl = document.getElementById("nav-db-count");
        if (
            countEl &&
            !state.dbFilterYear &&
            !state.dbFilterMonth &&
            !state.dbFilterDate &&
            !state.dbFilterSupplier &&
            !state.dbSearchQuery
        ) {
            countEl.textContent = state.acquisti.length;
        }

        renderAllFornitoriSelects();
        populateDbYearsDropdown();
        populateCatalogDatalist();
        renderAcquistiSection();
    } catch (err) {
        showToast(err.message);
    }
}

function populateDbYearsDropdown() {
    const sel = document.getElementById("db-filter-year");
    if (!sel) return;
    const currentVal = state.dbFilterYear;
    const years = new Set([new Date().getFullYear(), ...state.availableYears]);
    const sorted = Array.from(years).sort((a, b) => b - a);

    sel.innerHTML = `<option value="">Tutti gli anni</option>`;
    for (const y of sorted) {
        const opt = document.createElement("option");
        opt.value = String(y);
        opt.textContent = String(y);
        if (String(y) === String(currentVal)) opt.selected = true;
        sel.appendChild(opt);
    }
}

function populateCatalogDatalist() {
    const dl = document.getElementById("catalog-products-datalist");
    if (!dl) return;
    dl.innerHTML = "";
    for (const p of state.catalogSuggestions) {
        const opt = document.createElement("option");
        opt.value = p.name;
        dl.appendChild(opt);
    }
}

function setDbGroupBy(mode) {
    state.dbGroupBy = mode;
    ["day", "month", "year", "supplier", "product", "none"].forEach((m) => {
        document.getElementById(`grp-btn-${m}`)?.classList.toggle("active", m === mode);
    });
    renderAcquistiSection();
}

function onDbFilterChange() {
    state.dbFilterSupplier = document.getElementById("db-filter-supplier").value;
    state.dbFilterYear = document.getElementById("db-filter-year").value;
    state.dbFilterMonth = document.getElementById("db-filter-month").value;
    state.dbFilterDate = document.getElementById("db-filter-date").value;
    loadAcquistiDatabase();
}

let dbSearchTimeout = null;
function onDbSearchInput(val) {
    state.dbSearchQuery = val.trim();
    clearTimeout(dbSearchTimeout);
    dbSearchTimeout = setTimeout(() => {
        loadAcquistiDatabase();
    }, 180);
}

function resetDbFilters() {
    state.dbFilterSupplier = "";
    state.dbFilterYear = "";
    state.dbFilterMonth = "";
    state.dbFilterDate = "";
    state.dbSearchQuery = "";
    document.getElementById("db-filter-supplier").value = "";
    document.getElementById("db-filter-year").value = "";
    document.getElementById("db-filter-month").value = "";
    document.getElementById("db-filter-date").value = "";
    document.getElementById("db-search-input").value = "";
    loadAcquistiDatabase();
}

function renderAcquistiSection() {
    const rows = state.acquisti;
    const totalMoney = rows.reduce((acc, r) => acc + (Number(r.prezzo_totale) || 0), 0);
    const totalQty = rows.reduce((acc, r) => acc + (Number(r.quantita) || 0), 0);
    const uniqueDays = new Set(rows.map((r) => r.giorno || r.data_acquisto)).size;

    document.getElementById("db-kpi-total").textContent = totalMoney.toFixed(2);
    document.getElementById("db-kpi-rows").textContent = rows.length;
    document.getElementById("db-kpi-qty").textContent = Math.round(totalQty * 100) / 100;
    document.getElementById("db-kpi-days").textContent = uniqueDays;

    const container = document.getElementById("db-table-container");
    if (!container) return;
    container.innerHTML = "";

    if (rows.length === 0) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        empty.innerHTML = `
            <h3>Nessun acquisto presente nella Tabella Principale con questi filtri</h3>
            <p>Puoi aggiungere un acquisto manualmente, importare i prodotti dalla Lista della Spesa attiva, oppure evidenziare i prodotti in arancione nella Lista della Spesa.</p>
            <div style="margin-top:14px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap;">
                <button type="button" class="btn btn-primary" onclick="openAcquistoModal()">＋ Nuovo Acquisto</button>
                <button type="button" class="btn btn-db-sync" onclick="importCurrentListToDb('active')">📥 Importa da Lista Attiva</button>
            </div>
        `;
        container.appendChild(empty);
        return;
    }

    if (state.dbGroupBy === "none") {
        const block = document.createElement("div");
        block.className = "db-group-block";
        block.innerHTML = `
            <div class="db-group-header">
                <div class="db-group-title">📋 Tabella Principale Acquisti (Tutti i record)</div>
                <div class="db-group-stats">
                    <span>Voci: <strong>${rows.length}</strong></span>
                    <span class="db-subtotal-badge">Totale: ${totalMoney.toFixed(2)}</span>
                </div>
            </div>
        `;
        block.appendChild(buildAcquistiTableElement(rows));
        container.appendChild(block);
        return;
    }

    // Raggruppamento per Giorno, Mese, Anno, Fornitore o Prodotto
    const groups = new Map();
    for (const r of rows) {
        let key = "";
        let title = "";
        if (state.dbGroupBy === "day") {
            key = r.giorno || r.data_acquisto;
            title = `📅 Giorno: ${formatDateIT(key)}`;
        } else if (state.dbGroupBy === "month") {
            key = r.mese || String(r.data_acquisto).slice(0, 7);
            title = `🗓️ Mese: ${formatMonthIT(key)}`;
        } else if (state.dbGroupBy === "year") {
            key = String(r.anno || String(r.data_acquisto).slice(0, 4));
            title = `📆 Anno: ${key}`;
        } else if (state.dbGroupBy === "supplier") {
            key = String(r.fornitore || "Aldi").toUpperCase();
            title = `🏪 Fornitore: ${r.fornitore || "Aldi"}`;
        } else if (state.dbGroupBy === "product") {
            key = String(r.descrizione_prodotto || "").toUpperCase();
            title = `📦 Prodotto: ${r.descrizione_prodotto}`;
        }
        if (!groups.has(key)) {
            groups.set(key, { key, title, items: [] });
        }
        groups.get(key).items.push(r);
    }

    for (const [, grp] of groups.entries()) {
        const subTotal = grp.items.reduce((acc, x) => acc + (Number(x.prezzo_totale) || 0), 0);
        const subQty = grp.items.reduce((acc, x) => acc + (Number(x.quantita) || 0), 0);

        const block = document.createElement("div");
        block.className = "db-group-block";
        block.innerHTML = `
            <div class="db-group-header">
                <div class="db-group-title">${escapeHtml(grp.title)}</div>
                <div class="db-group-stats">
                    <span>Prodotti: <strong>${grp.items.length}</strong></span>
                    <span>Q.tà tot: <strong>${Math.round(subQty * 100) / 100}</strong></span>
                    <span class="db-subtotal-badge">Totale: ${subTotal.toFixed(2)}</span>
                </div>
            </div>
        `;
        block.appendChild(buildAcquistiTableElement(grp.items));
        container.appendChild(block);
    }
}

function buildAcquistiTableElement(rows) {
    const wrap = document.createElement("div");
    wrap.className = "db-table-wrap";

    const table = document.createElement("table");
    table.className = "db-table";
    table.innerHTML = `
        <thead>
            <tr>
                <th>Data di Acquisto</th>
                <th>Fornitore</th>
                <th>Descrizione del Prodotto</th>
                <th>Commento</th>
                <th class="num-col">Prezzo Unitario</th>
                <th class="num-col">Quantità</th>
                <th class="num-col">Prezzo Totale</th>
                <th class="num-col">Azioni</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");
    for (const r of rows) {
        const tr = document.createElement("tr");
        const pu = Number(r.prezzo_unitario || 0);
        const qty = Number(r.quantita || 0);
        const pt = Number(r.prezzo_totale || 0).toFixed(2);
        const currentForn = r.fornitore || "Aldi";
        const fornOptions = getFornitoriNames(currentForn);

        const optionsHtml =
            fornOptions
                .map(
                    (fn) =>
                        `<option value="${escapeHtmlAttr(fn)}" ${
                            fn.toLowerCase() === currentForn.toLowerCase() ? "selected" : ""
                        }>${escapeHtml(fn)}</option>`
                )
                .join("") + `<option value="__CUSTOM__">✎ Altro / Modifica...</option>`;

        tr.innerHTML = `
            <td>
                <input
                    type="date"
                    class="db-inline-date"
                    value="${escapeHtmlAttr(r.data_acquisto)}"
                    title="Modifica data di acquisto"
                />
            </td>
            <td>
                <select class="db-inline-select select-forn" title="Seleziona o modifica Fornitore (Aldi, Coop, Lidl, Migros...)">
                    ${optionsHtml}
                </select>
            </td>
            <td>
                <strong>${escapeHtml(r.descrizione_prodotto)}</strong>
                <span class="cat-mini-badge" style="margin-left:6px;">${escapeHtml(r.categoria || "")}</span>
            </td>
            <td>
                <input
                    type="text"
                    class="db-inline-note input-note"
                    value="${escapeHtmlAttr(r.note || "")}"
                    placeholder="Nessun commento"
                    title="Commento memorizzato nel database"
                />
            </td>
            <td class="num-col">
                <input
                    type="number"
                    step="0.01"
                    min="0"
                    class="db-inline-input input-pu"
                    value="${pu > 0 ? pu.toFixed(2) : ""}"
                    placeholder="0.00"
                    title="Inserisci Prezzo Unitario"
                />
            </td>
            <td class="num-col">
                <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    class="db-inline-input input-qty"
                    value="${qty}"
                    style="width:64px;"
                    title="Modifica Quantità"
                />
                <span style="font-size:0.78rem; color:#64748b; margin-left:3px;">${escapeHtml(r.unita || "Pz")}</span>
            </td>
            <td class="num-col db-total-cell">${pt}</td>
            <td class="num-col">
                <button type="button" class="row-action-btn" title="Modifica acquisto" data-act="edit">✎</button>
                <button type="button" class="row-action-btn" title="Elimina acquisto" data-act="del">🗑</button>
            </td>
        `;

        const dateInp = tr.querySelector(".db-inline-date");
        const fornSel = tr.querySelector(".select-forn");
        const noteInp = tr.querySelector(".input-note");
        const puInp = tr.querySelector(".input-pu");
        const qtyInp = tr.querySelector(".input-qty");
        const editBtn = tr.querySelector('[data-act="edit"]');
        const delBtn = tr.querySelector('[data-act="del"]');

        dateInp.addEventListener("change", () => {
            updateAcquistoInline(r.id, { data_acquisto: dateInp.value });
        });
        noteInp.addEventListener("change", () => {
            updateAcquistoInline(r.id, { note: noteInp.value.trim() });
        });
        fornSel.addEventListener("change", async () => {
            if (fornSel.value === "__CUSTOM__") {
                const customName = prompt("Inserisci il nome del Fornitore:", currentForn);
                if (customName && customName.trim()) {
                    await updateAcquistoInline(r.id, { fornitore: customName.trim() });
                } else {
                    fornSel.value = currentForn;
                }
            } else {
                await updateAcquistoInline(r.id, { fornitore: fornSel.value });
            }
        });
        puInp.addEventListener("change", () => {
            updateAcquistoInline(r.id, { prezzo_unitario: puInp.value });
        });
        qtyInp.addEventListener("change", () => {
            updateAcquistoInline(r.id, { quantita: qtyInp.value });
        });
        editBtn.addEventListener("click", () => openEditAcquistoModal(r.id));
        delBtn.addEventListener("click", () => deleteAcquistoRow(r.id, r.descrizione_prodotto));

        tbody.appendChild(tr);
    }

    wrap.appendChild(table);
    return wrap;
}

async function updateAcquistoInline(id, patch) {
    try {
        await apiFetch(`/api/acquisti/${id}`, {
            method: "PUT",
            body: JSON.stringify(patch),
        });
        await loadAcquistiDatabase();
        showToast("Acquisto aggiornato!", "success");
    } catch (err) {
        showToast(err.message);
    }
}

async function deleteAcquistoRow(id, name) {
    if (!confirm(`Vuoi eliminare "${name}" dal Database Acquisti?`)) return;
    try {
        await apiFetch(`/api/acquisti/${id}`, { method: "DELETE" });
        await loadAcquistiDatabase();
        showToast("Voce rimossa dal Database Acquisti.");
    } catch (err) {
        showToast(err.message);
    }
}

function populateAcqModalFornitoreSelect(selectedForn = "Aldi") {
    const sel = document.getElementById("acq-fornitore-select");
    if (!sel) return;
    sel.innerHTML = "";
    const names = getFornitoriNames(selectedForn);
    for (const n of names) {
        const opt = document.createElement("option");
        opt.value = n;
        opt.textContent = n;
        if (n.toLowerCase() === (selectedForn || "Aldi").toLowerCase()) opt.selected = true;
        sel.appendChild(opt);
    }
    const customOpt = document.createElement("option");
    customOpt.value = "__CUSTOM__";
    customOpt.textContent = "＋ Nuovo Fornitore...";
    sel.appendChild(customOpt);

    document.getElementById("acq-custom-fornitore-group").classList.add("hidden");
    document.getElementById("acq-fornitore-custom").value = "";
}

function onAcqFornitoreSelectChange(val) {
    const grp = document.getElementById("acq-custom-fornitore-group");
    if (val === "__CUSTOM__") {
        grp.classList.remove("hidden");
        document.getElementById("acq-fornitore-custom").focus();
    } else {
        grp.classList.add("hidden");
    }
}

function openAcquistoModal() {
    document.getElementById("modal-acquisto-title").textContent = "➕ Registra Acquisto nel Database";
    document.getElementById("acq-edit-id").value = "";
    document.getElementById("acq-descrizione").value = "";
    document.getElementById("acq-data").value = state.currentList?.list_date || todayISO();
    document.getElementById("acq-unita").value = "Pz";
    document.getElementById("acq-prezzo-unitario").value = "";
    document.getElementById("acq-quantita").value = "1";
    document.getElementById("acq-prezzo-totale").value = "0.00";
    document.getElementById("acq-note").value = "";
    document.getElementById("btn-delete-acquisto").classList.add("hidden");

    populateAcqModalFornitoreSelect(state.currentList?.fornitore || "Aldi");
    openModal("modal-acquisto");
    setTimeout(() => document.getElementById("acq-descrizione").focus(), 60);
}

function openEditAcquistoModal(id) {
    const r = state.acquisti.find((x) => x.id === id);
    if (!r) return;
    document.getElementById("modal-acquisto-title").textContent = "✎ Modifica Acquisto";
    document.getElementById("acq-edit-id").value = String(r.id);
    document.getElementById("acq-descrizione").value = r.descrizione_prodotto;
    document.getElementById("acq-data").value = r.data_acquisto;
    document.getElementById("acq-unita").value = r.unita || "Pz";
    document.getElementById("acq-prezzo-unitario").value = r.prezzo_unitario;
    document.getElementById("acq-quantita").value = r.quantita;
    document.getElementById("acq-prezzo-totale").value = Number(r.prezzo_totale || 0).toFixed(2);
    document.getElementById("acq-note").value = r.note || "";
    document.getElementById("btn-delete-acquisto").classList.remove("hidden");

    populateAcqModalFornitoreSelect(r.fornitore || "Aldi");
    openModal("modal-acquisto");
}

function onAcquistoProductInput(val) {
    const clean = String(val || "").trim().toLowerCase();
    const match = state.catalogSuggestions.find((p) => p.name.toLowerCase() === clean);
    if (match) {
        if (match.default_unit) {
            document.getElementById("acq-unita").value = match.default_unit;
        }
        if (match.last_fornitore) {
            populateAcqModalFornitoreSelect(match.last_fornitore);
        }
        if (match.last_unit_price > 0 && !document.getElementById("acq-prezzo-unitario").value) {
            document.getElementById("acq-prezzo-unitario").value = match.last_unit_price;
            recalcAcquistoModalTotal();
        }
    }
}

function recalcAcquistoModalTotal() {
    const pu = parseFloat(document.getElementById("acq-prezzo-unitario").value || "0") || 0;
    const qty = parseFloat(document.getElementById("acq-quantita").value || "0") || 0;
    const tot = Math.round(pu * qty * 100) / 100;
    document.getElementById("acq-prezzo-totale").value = tot.toFixed(2);
}

async function submitAcquistoModal(e) {
    e.preventDefault();
    const editId = document.getElementById("acq-edit-id").value;
    const descrizione_prodotto = document.getElementById("acq-descrizione").value.trim();
    const fornSelect = document.getElementById("acq-fornitore-select").value;
    const fornCustom = document.getElementById("acq-fornitore-custom").value.trim();
    const fornitore = fornSelect === "__CUSTOM__" ? fornCustom || "Aldi" : fornSelect;

    const data_acquisto = document.getElementById("acq-data").value || todayISO();
    const unita = document.getElementById("acq-unita").value.trim() || "Pz";
    const prezzo_unitario = parseFloat(document.getElementById("acq-prezzo-unitario").value || "0") || 0;
    const quantita = parseFloat(document.getElementById("acq-quantita").value || "1") || 1;
    const note = document.getElementById("acq-note").value.trim();

    const match = state.catalogSuggestions.find(
        (p) => p.name.toLowerCase() === descrizione_prodotto.toLowerCase()
    );
    const categoria = match ? match.category : "ALIMENTARI";

    try {
        if (editId) {
            await apiFetch(`/api/acquisti/${editId}`, {
                method: "PUT",
                body: JSON.stringify({
                    descrizione_prodotto,
                    fornitore,
                    categoria,
                    unita,
                    prezzo_unitario,
                    quantita,
                    data_acquisto,
                    note,
                }),
            });
            showToast(`Acquisto "${descrizione_prodotto}" aggiornato!`, "success");
        } else {
            await apiFetch("/api/acquisti", {
                method: "POST",
                body: JSON.stringify({
                    descrizione_prodotto,
                    fornitore,
                    categoria,
                    unita,
                    prezzo_unitario,
                    quantita,
                    data_acquisto,
                    note,
                }),
            });
            showToast(`Acquisto "${descrizione_prodotto}" (${fornitore}) salvato nel Database!`, "success");
        }
        closeModal("modal-acquisto");
        await loadAcquistiDatabase();
    } catch (err) {
        showToast(err.message);
    }
}

async function deleteAcquistoFromModal() {
    const editId = document.getElementById("acq-edit-id").value;
    if (!editId) return;
    try {
        await apiFetch(`/api/acquisti/${editId}`, { method: "DELETE" });
        closeModal("modal-acquisto");
        await loadAcquistiDatabase();
        showToast("Acquisto eliminato dal Database.");
    } catch (err) {
        showToast(err.message);
    }
}

async function importCurrentListToDb(mode = "active") {
    if (!state.currentList) return;
    try {
        const res = await apiFetch("/api/acquisti/import-list", {
            method: "POST",
            body: JSON.stringify({
                list_id: state.currentList.id,
                mode,
            }),
        });
        await refreshDbCounterBadge();
        showToast(
            `📊 ${res.imported} prodotti della lista (${formatDateIT(res.list_date)}) registrati nella Tabella Principale Acquisti!`,
            "success"
        );
        await switchMainSection("db");
    } catch (err) {
        showToast(err.message);
    }
}

// ============================================================================
// ESPORTAZIONE PDF (LISTA DELLA SPESA & TABELLA ACQUISTI)
// ============================================================================
function downloadCurrentViewPdf() {
    if (!state.currentList) return;
    const params = new URLSearchParams({
        filter: state.filterMode || "all",
        category: state.selectedCategory || "ALL",
        fornitore: state.selectedSupplier || "ALL",
        sort: state.sortMode || "type_alpha",
        q: state.searchQuery || "",
    });
    const pdfUrl = `/api/lists/${state.currentList.id}/pdf?${params.toString()}`;
    const filterNames = {
        all: "Tutti i prodotti",
        active: "Solo in Lista",
        purchased: "Acquistati",
    };
    showToast(`📄 Creazione PDF (${filterNames[state.filterMode] || "Lista"})...`, "success");

    const a = document.createElement("a");
    a.href = pdfUrl;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
}

function downloadPurchasesPdf() {
    const params = new URLSearchParams({
        group_by: state.dbGroupBy || "day",
        anno: state.dbFilterYear || "",
        mese: state.dbFilterMonth || "",
        giorno: state.dbFilterDate || "",
        fornitore: state.dbFilterSupplier || "",
        q: state.dbSearchQuery || "",
    });
    const pdfUrl = `/api/acquisti/pdf?${params.toString()}`;
    showToast("📄 Creazione PDF Registro Acquisti...", "success");

    const a = document.createElement("a");
    a.href = pdfUrl;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
}

// ============================================================================
// SINCRONIZZAZIONE AUTOMATICA PC <-> SMARTPHONE
// ============================================================================
let visibilitySyncBound = false;

function startRealtimeSync() {
    stopRealtimeSync();

    if (!visibilitySyncBound) {
        visibilitySyncBound = true;
        // Quando si riapre lo smartphone o si torna alla scheda, seleziona automaticamente la lista con data più recente
        document.addEventListener("visibilitychange", async () => {
            if (document.visibilityState === "visible" && state.user) {
                try {
                    await loadListsAndSelectLatest();
                } catch (_) {}
            }
        });
        window.addEventListener("pageshow", async () => {
            if (state.user) {
                try {
                    await loadListsAndSelectLatest();
                } catch (_) {}
            }
        });
    }

    state.syncTimer = setInterval(async () => {
        if (!state.currentList) return;
        const activeTag = document.activeElement?.tagName;
        if (activeTag === "INPUT" || activeTag === "SELECT" || activeTag === "TEXTAREA") {
            return;
        }
        try {
            if (state.activeSection === "list") {
                const ver = await apiFetch(`/api/lists/${state.currentList.id}/version`);
                if (ver.deleted && ver.latest_list_id) {
                    await loadListsAndSelectLatest(ver.latest_list_id);
                    return;
                }
                if (ver.latest_list_id && state.lastKnownNewestListId && ver.latest_list_id !== state.lastKnownNewestListId) {
                    await loadListsAndSelectLatest(ver.latest_list_id);
                    await refreshDbCounterBadge();
                    return;
                }
                if (ver.updated_at && ver.updated_at !== state.currentList.updated_at) {
                    await loadSingleList(state.currentList.id);
                    await refreshListsSummaryOnly();
                    await refreshDbCounterBadge();
                }
            }
        } catch (_) {}
    }, 3000);
}

function stopRealtimeSync() {
    if (state.syncTimer) {
        clearInterval(state.syncTimer);
        state.syncTimer = null;
    }
}

// ============================================================================
// MODALI E UTILITÀ
// ============================================================================
function openModal(id) {
    document.getElementById(id)?.classList.remove("hidden");
}

function closeModal(id) {
    document.getElementById(id)?.classList.add("hidden");
}

function closeModalOnBackdrop(e, id) {
    if (e.target.id === id) {
        closeModal(id);
    }
}

function openLanModal() {
    openModal("modal-lan");
}

function copyLanUrl() {
    navigator.clipboard?.writeText(state.serverUrl);
    showToast("Indirizzo copiato negli appunti!", "success");
}

function escapeHtml(str) {
    return String(str ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function escapeHtmlAttr(str) {
    return escapeHtml(str).replace(/'/g, "&#39;");
}
