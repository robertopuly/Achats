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

function tomorrowISO() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
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

    updateRobertoMediaButtonVisibility();

    await loadFornitoriList();
    await loadListsAndSelectLatest();
    await loadAcquistiDatabase();
    await checkPendingMediaPopups();
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
// NAVIGAZIONE TRA "LISTA DELLA SPESA", "DATABASE ACQUISTI" E "ANALISI PRODOTTI"
// ============================================================================
async function switchMainSection(section) {
    if ((section === "db" || section === "analytics") && isSmartphoneDevice()) {
        section = "list";
    }
    state.activeSection = section;
    const isList = section === "list";
    const isDb = section === "db";
    const isAnalytics = section === "analytics";

    document.getElementById("nav-tab-list")?.classList.toggle("active", isList);
    document.getElementById("nav-tab-db")?.classList.toggle("active", isDb);
    document.getElementById("nav-tab-analytics")?.classList.toggle("active", isAnalytics);

    document.getElementById("list-header-toolbar")?.classList.toggle("hidden", !isList);
    document.getElementById("db-header-toolbar")?.classList.toggle("hidden", !isDb);
    document.getElementById("analytics-header-toolbar")?.classList.toggle("hidden", !isAnalytics);

    document.getElementById("section-shopping-list")?.classList.toggle("hidden", !isList);
    document.getElementById("section-database-acquisti")?.classList.toggle("hidden", !isDb);
    document.getElementById("section-analytics")?.classList.toggle("hidden", !isAnalytics);

    if (isDb) {
        await loadAcquistiDatabase();
    } else if (isAnalytics) {
        await loadAnalyticsDashboard();
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
        opt.textContent = `${dateFormatted} — ${l.name} (${activeCount} in lista, ${purchasedCount} acq.)`;
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
    checkAndShowSameDayAlertPopup(state.items);
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
    document.getElementById("new-list-date").value = tomorrowISO();
    document.getElementById("new-list-name").value = "Lista Supermercato";
    document.getElementById("new-list-mode").value = "template";
    openModal("modal-new-list");
}

async function submitNewList(e) {
    e.preventDefault();
    const list_date = document.getElementById("new-list-date").value || tomorrowISO();
    const name = document.getElementById("new-list-name").value.trim() || "Lista Supermercato";
    const mode = document.getElementById("new-list-mode").value;

    try {
        const data = await apiFetch("/api/lists", {
            method: "POST",
            body: JSON.stringify({
                name,
                list_date,
                mode,
                source_list_id: state.currentList ? state.currentList.id : null,
            }),
        });
        closeModal("modal-new-list");
        state.currentList = data.list;
        state.categories = data.categories;
        state.items = data.items;
        state.filterMode = "all";
        state.selectedSupplier = "ALL";
        updateFilterButtonsUI();
        await refreshListsSummaryOnly();
        renderAllFornitoriSelects();
        renderAll();
        showToast(`Nuova lista creata (${formatDateIT(list_date)})!`, "success");
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
    const hasQty = String(item.quantity || "").trim() !== "" && String(item.quantity || "").trim() !== "0";
    const isSameDayBlink = isSameDayAlertForOtherAccount(item);

    if (active) row.classList.add("is-active");
    if (purchased) row.classList.add("is-purchased");
    if (isSameDayBlink) row.classList.add("is-same-day-alert");

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
                ${isSameDayBlink ? `<span class="same-day-pill" title="Modificato oggi${item.same_day_updated_by ? " da " + escapeHtmlAttr(item.same_day_updated_by) : ""}">🔔<span class="pc-only"> Aggiornato</span></span>` : ""}
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
                    class="qty-input ${hasQty ? "has-val" : ""} ${isSameDayBlink ? "qty-blink-alert" : ""}"
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
        renderAll();
        if (cleanComment) {
            showToast(`💬 Commento salvato per "${item.name}"`, "success");
        }
    } catch (err) {
        showToast(err.message);
    }
}

let activeCancelLongPressFn = null;
let multiTouchGuardBound = false;

function bindMultiTouchPinchGuard() {
    if (multiTouchGuardBound) return;
    multiTouchGuardBound = true;

    const cancelActive = () => {
        if (typeof activeCancelLongPressFn === "function") {
            activeCancelLongPressFn();
        }
    };

    document.addEventListener(
        "touchstart",
        (e) => {
            if (e.touches && e.touches.length > 1) {
                cancelActive();
            }
        },
        { passive: true }
    );
    document.addEventListener(
        "touchmove",
        (e) => {
            if (e.touches && e.touches.length > 1) {
                cancelActive();
            }
        },
        { passive: true }
    );
    if (window.visualViewport) {
        window.visualViewport.addEventListener("resize", cancelActive);
        window.visualViewport.addEventListener("scroll", cancelActive);
    }
}

function attachLongPressHandler(rowEl, itemId) {
    bindMultiTouchPinchGuard();
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

    const cancelPress = () => {
        if (pressTimer) {
            clearTimeout(pressTimer);
            pressTimer = null;
        }
        rowEl.classList.remove("pressing");
        if (activeCancelLongPressFn === cancelPress) {
            activeCancelLongPressFn = null;
        }
    };

    const startPress = (clientX, clientY, target) => {
        if (isInteractiveTarget(target)) return;
        startX = clientX;
        startY = clientY;
        rowEl.classList.add("pressing");
        activeCancelLongPressFn = cancelPress;

        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
            rowEl.classList.remove("pressing");
            activeCancelLongPressFn = null;
            if (navigator.vibrate) {
                try {
                    navigator.vibrate(65);
                } catch (_) {}
            }
            togglePurchasedOrange(itemId);
        }, LONG_PRESS_MS);
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
            if (e.touches.length !== 1) {
                cancelPress();
                return;
            }
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
    if (newPurchased === 1) {
        item.in_list = 1;
        item.same_day_alert = 0;
    }
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
        renderAll();
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
    const qtyChanged = (isZeroOrEmpty ? "" : cleanQty) !== String(item.quantity || "").trim();
    const keepPurchased = isZeroOrEmpty || qtyChanged ? 0 : item.purchased;
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
            }),
        });
        Object.assign(item, updated);
        renderAll();
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
let currentMobilePdfUrl = "";
let currentMobilePdfFileName = "Lista_Supermercato.pdf";
let currentMobilePdfFile = null;

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
    const suffixMap = {
        all: "Completa",
        active: "Solo_in_Lista",
        purchased: "Acquistati",
    };
    const safeDate = String(state.currentList.list_date || todayISO()).replace(/[^0-9-]/g, "");
    const fileName = `Lista_Supermercato_${safeDate}_${suffixMap[state.filterMode] || "Lista"}.pdf`;

    // Su Smartphone apri l'anteprima interna con la barra di uscita, stampa e condivisione (senza bloccare la pagina)
    if (isSmartphoneDevice() || window.navigator.standalone === true) {
        openMobilePdfModal(pdfUrl, fileName, filterNames[state.filterMode] || "Lista");
        return;
    }

    showToast(`📄 Creazione PDF (${filterNames[state.filterMode] || "Lista"})...`, "success");
    const a = document.createElement("a");
    a.href = pdfUrl;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1000);
}

function openMobilePdfModal(pdfUrl, fileName, filterLabel) {
    currentMobilePdfUrl = pdfUrl;
    currentMobilePdfFileName = fileName;
    currentMobilePdfFile = null;

    // Pre-carica subito il file PDF in memoria così, se il browser supporta Web Share API (navigator.share),
    // il tocco su "💬 WhatsApp PDF" o "🖨️ Stampa / PDF" apre istantaneamente il menu nativo col file PDF allegato
    fetch(pdfUrl, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.blob() : null))
        .then((blob) => {
            if (blob) {
                try {
                    currentMobilePdfFile = new File([blob], fileName, { type: "application/pdf" });
                } catch (_) {}
            }
        })
        .catch(() => {});

    const sheet = document.getElementById("mobile-pdf-sheet");
    const overlay = document.getElementById("modal-mobile-pdf");
    if (!sheet || !overlay || !state.currentList) return;

    const filtered = getFilteredItems();
    const listDateIT = formatDateIT(state.currentList.list_date);
    const suppFilterLabel =
        state.selectedSupplier && state.selectedSupplier !== "ALL"
            ? state.selectedSupplier
            : "Tutti i fornitori";

    let totalMoney = 0;
    for (const i of filtered) {
        const q = parseFloat(String(i.quantity || "0").replace(",", ".")) || (i.purchased === 1 ? 1 : 0);
        const p = Number(i.unit_price || 0);
        if (q > 0 && p > 0) totalMoney += q * p;
    }

    const groups = new Map();
    for (const item of filtered) {
        const cKey = (item.category || "ALTRO").toUpperCase();
        if (!groups.has(cKey)) groups.set(cKey, []);
        groups.get(cKey).push(item);
    }

    let groupsHtml = "";
    if (filtered.length === 0) {
        groupsHtml = `<p style="padding:20px 0; text-align:center; color:#64748b;">Nessun prodotto presente con il filtro selezionato.</p>`;
    } else {
        for (const [catName, items] of groups.entries()) {
            const sortedItems = [...items].sort((a, b) =>
                a.name.localeCompare(b.name, "it", { sensitivity: "base" })
            );
            const rowsHtml = sortedItems
                .map((it) => {
                    const q = String(it.quantity || "").trim() || (it.purchased === 1 ? "1" : "—");
                    const u = it.unit || "Pz";
                    const forn = it.fornitore || state.currentList?.fornitore || "Aldi";
                    const up = Number(it.unit_price || 0);
                    const qNum = parseFloat(String(it.quantity || "0").replace(",", ".")) || (it.purchased === 1 ? 1 : 0);
                    const tot = qNum > 0 && up > 0 ? (qNum * up).toFixed(2) : "—";
                    const note = it.notes ? ` <span style="color:#64748b; font-size:0.74rem;">(${escapeHtml(it.notes)})</span>` : "";
                    const status = it.purchased === 1 ? "✓ Acq." : "☐";
                    return `
                        <tr>
                            <td style="width:26px;">${status}</td>
                            <td><strong>${escapeHtml(it.name)}</strong>${note}</td>
                            <td>${escapeHtml(forn)}</td>
                            <td class="num"><strong>${escapeHtml(q)}</strong> ${escapeHtml(u)}</td>
                            <td class="num">${up > 0 ? up.toFixed(2) : "—"}</td>
                            <td class="num">${tot}</td>
                        </tr>
                    `;
                })
                .join("");

            groupsHtml += `
                <div class="mpdf-cat-block">
                    <div class="mpdf-cat-title">
                        <span>${escapeHtml(catName)}</span>
                        <span>${sortedItems.length} prod.</span>
                    </div>
                    <table class="mpdf-table">
                        <thead>
                            <tr>
                                <th>St.</th>
                                <th>Prodotto</th>
                                <th>Forn.</th>
                                <th class="num">Q.tà</th>
                                <th class="num">Prezzo</th>
                                <th class="num">Tot.</th>
                            </tr>
                        </thead>
                        <tbody>${rowsHtml}</tbody>
                    </table>
                </div>
            `;
        }
    }

    sheet.innerHTML = `
        <div class="mpdf-header">
            <div>
                <div class="mpdf-title">🛒 ${escapeHtml(state.currentList.name || "Lista Supermercato")}</div>
                <div class="mpdf-meta">
                    📅 Data: <strong>${escapeHtml(listDateIT)}</strong> •
                    Filtro: <strong>${escapeHtml(filterLabel)}</strong> •
                    Fornitore: <strong>${escapeHtml(suppFilterLabel)}</strong>
                </div>
            </div>
            <div class="mpdf-meta" style="text-align:right;">
                Prodotti: <strong>${filtered.length}</strong><br/>
                Totale stimato: <strong>${totalMoney.toFixed(2)} CHF/€</strong>
            </div>
        </div>
        ${groupsHtml}
    `;

    document.body.classList.add("printing-mobile-pdf");
    overlay.classList.remove("hidden");

    // Rileva se siamo su iOS e/o su Chrome (CriOS su iPhone o Chrome su Android)
    const ua = navigator.userAgent || "";
    const isChrome = /CriOS|Chrome|Chromium|EdgA/i.test(ua);
    const isIOS =
        /iPhone|iPad|iPod/i.test(ua) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    // Usa SEMPRE &download=1 (Content-Type: application/x-download + X-Content-Type-Options: nosniff + Content-Disposition: attachment):
    // in questo modo iOS/Chrome NON apre MAI l'anteprima PDF bloccata senza pulsanti, ma resta sulla schermata attuale
    // e fa comparire la barra nativa "Scarica / Télécharger" -> "Apri in... / Ouvrir dans..." da cui scegliere WhatsApp o Stampa.
    // Se l'app è stata aperta da un'icona WebClip della schermata Home iOS (window.navigator.standalone === true),
    // passa direttamente a Google Chrome tramite googlechrome:// così la barra di download/condivisione è sempre presente.
    const downloadPdfPath = `${pdfUrl}&download=1`;
    let targetPdfHref = downloadPdfPath;
    if (isIOS && window.navigator.standalone === true) {
        const scheme = window.location.protocol === "https:" ? "googlechromes:" : "googlechrome:";
        targetPdfHref = `${scheme}//${window.location.host}${downloadPdfPath}`;
    }

    const hintEl = document.getElementById("mobile-pdf-hint");
    if (hintEl) {
        if (isChrome || (isIOS && window.navigator.standalone === true)) {
            hintEl.innerHTML = `💡 Tocca <strong>💬 WhatsApp PDF</strong> o <strong>🖨️ Stampa / PDF</strong>: in basso sullo schermo comparirà <strong>Scarica / Télécharger</strong> e subito dopo <strong>Apri in... / Ouvrir dans...</strong> → scegli <strong>WhatsApp</strong> (per inviare il PDF) o <strong>Stampa / Imprimer</strong>!`;
        } else {
            hintEl.innerHTML = `💡 Tocca <strong>💬 WhatsApp PDF</strong> o <strong>🖨️ Stampa / PDF</strong>: nel pannello che si apre tocca l'icona <strong>Condividi ⬆️</strong> (in alto a destra) per inviare il <strong>PDF su WhatsApp</strong> oppure premi <strong>Stampa / Imprimer</strong>!`;
        }
    }

    const bindPdfActionButton = (btnEl, actionKind) => {
        if (!btnEl) return;
        btnEl.href = targetPdfHref;
        btnEl.removeAttribute("target");
        btnEl.setAttribute("download", fileName);
        btnEl.onclick = (e) => {
            if (currentMobilePdfFile && typeof navigator.share === "function") {
                let canShareFile = true;
                try {
                    if (typeof navigator.canShare === "function") {
                        canShareFile = navigator.canShare({ files: [currentMobilePdfFile] });
                    }
                } catch (_) {
                    canShareFile = false;
                }
                if (canShareFile) {
                    e.preventDefault();
                    navigator
                        .share({
                            files: [currentMobilePdfFile],
                            title: currentMobilePdfFileName,
                        })
                        .catch(() => {});
                    return;
                }
            }
            // Su Safari standard (non Chrome e non WebClip bloccata), window.print() apre il pannello nativo iOS
            // che ha sia "Stampa / Imprimer" sia l'icona "Condividi ⬆️" (in alto a destra) che invia il PDF direttamente a WhatsApp!
            if (isIOS && !isChrome && window.navigator.standalone !== true) {
                e.preventDefault();
                document.body.classList.add("printing-mobile-pdf");
                window.print();
                return;
            }
            if (actionKind === "whatsapp") {
                showToast("💬 In basso tocca 'Scarica / Télécharger' → 'Apri in / Ouvrir dans' → WhatsApp!", "success");
            } else {
                showToast("🖨️ In basso tocca 'Scarica / Télécharger' → 'Apri in / Ouvrir dans' → Stampa / Imprimer!", "success");
            }
        };
    };

    // 1. Configura il pulsante "💬 WhatsApp PDF" per inviare sempre il file PDF sia su Safari che su Chrome
    bindPdfActionButton(document.getElementById("btn-mobile-pdf-whatsapp"), "whatsapp");

    // 2. Configura il pulsante "🖨️ Stampa / PDF" per stampare o condividere il file PDF sia su Safari che su Chrome
    bindPdfActionButton(document.getElementById("btn-mobile-pdf-open"), "print");
}

function closeMobilePdfModal() {
    document.body.classList.remove("printing-mobile-pdf");
    document.getElementById("modal-mobile-pdf")?.classList.add("hidden");
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
                    await checkPendingMediaPopups();
                } catch (_) {}
            }
        });
        window.addEventListener("pageshow", async () => {
            if (state.user) {
                try {
                    await loadListsAndSelectLatest();
                    await checkPendingMediaPopups();
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
                if (Number(ver.pending_media_popups) > 0) {
                    await checkPendingMediaPopups();
                }
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
            } else {
                await checkPendingMediaPopups();
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

// ============================================================================
// GESTIONE ACCOUNT UTENTI (SOLO DA PC)
// ============================================================================
async function openUsersModal() {
    document.getElementById("new-user-username").value = "";
    document.getElementById("new-user-display").value = "";
    document.getElementById("new-user-password").value = "";
    openModal("modal-users");
    try {
        const users = await apiFetch("/api/users");
        renderUsersManageModalList(users);
    } catch (err) {
        showToast(err.message);
    }
}

function renderUsersManageModalList(users = []) {
    const container = document.getElementById("users-manage-list");
    if (!container) return;
    container.innerHTML = "";

    for (const u of users) {
        const isCurrent = state.user && state.user.id === u.id;
        const row = document.createElement("div");
        row.className = "fornitore-manage-row";
        row.innerHTML = `
            <div style="flex:1; min-width:0;">
                <strong style="font-size:0.9rem; color:#0f172a;">👤 ${escapeHtml(u.username)}</strong>
                <span style="font-size:0.8rem; color:#64748b; margin-left:4px;">(${escapeHtml(u.display_name)})</span>
                ${isCurrent ? `<span class="cat-mini-badge" style="margin-left:4px;">Tu</span>` : ""}
            </div>
            <input type="text" placeholder="Nuova password..." style="max-width:135px; padding:5px 8px; font-size:0.82rem;" />
            <button type="button" class="btn btn-primary btn-sm" data-act="pw">Cambia PW</button>
            ${!isCurrent ? `<button type="button" class="btn btn-danger btn-sm" data-act="del" title="Elimina account">🗑</button>` : ""}
        `;
        const pwInput = row.querySelector("input");
        row.querySelector('[data-act="pw"]').addEventListener("click", async () => {
            const newPassword = pwInput.value.trim();
            if (newPassword.length < 3) {
                showToast("Inserisci una nuova password di almeno 3 caratteri.");
                return;
            }
            try {
                const updated = await apiFetch(`/api/users/${u.id}`, {
                    method: "PUT",
                    body: JSON.stringify({ password: newPassword }),
                });
                pwInput.value = "";
                renderUsersManageModalList(updated);
                showToast(`Password aggiornata per "${u.username}"!`, "success");
            } catch (err) {
                showToast(err.message);
            }
        });

        const delBtn = row.querySelector('[data-act="del"]');
        if (delBtn) {
            delBtn.addEventListener("click", async () => {
                if (!confirm(`Vuoi eliminare l'account "${u.username}"?`)) return;
                try {
                    const updated = await apiFetch(`/api/users/${u.id}`, { method: "DELETE" });
                    renderUsersManageModalList(updated);
                    showToast(`Account "${u.username}" eliminato.`);
                } catch (err) {
                    showToast(err.message);
                }
            });
        }

        container.appendChild(row);
    }
}

async function createNewUserAccount(e) {
    e.preventDefault();
    const username = document.getElementById("new-user-username").value.trim();
    const display_name = document.getElementById("new-user-display").value.trim() || username;
    const password = document.getElementById("new-user-password").value;

    if (!username || !password) return;
    try {
        const updated = await apiFetch("/api/users", {
            method: "POST",
            body: JSON.stringify({ username, display_name, password }),
        });
        document.getElementById("new-user-username").value = "";
        document.getElementById("new-user-display").value = "";
        document.getElementById("new-user-password").value = "";
        renderUsersManageModalList(updated);
        showToast(`Account "${username}" creato! Ora puoi comunicare nome utente e password al collega.`, "success");
    } catch (err) {
        showToast(err.message);
    }
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

// ============================================================================
// NOTIFICA POPUP E LAMPEGGIO PER MODIFICHE FATTE IL GIORNO STESSO DELLA SPESA
// ============================================================================
const SAME_DAY_ACK_STORAGE_KEY = "achats_same_day_ack_v1";
let localSameDayPopupTimer = null;

function getAckedSameDayAlerts() {
    try {
        const raw = localStorage.getItem(SAME_DAY_ACK_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (_) {
        return {};
    }
}

function saveAckedSameDayAlerts(map) {
    try {
        localStorage.setItem(SAME_DAY_ACK_STORAGE_KEY, JSON.stringify(map));
    } catch (_) {}
}

function getSameDayAlertKey(item) {
    return `${item.id}_${item.same_day_updated_at || item.updated_at || ""}`;
}

function isSameDayAlertForOtherAccount(item) {
    if (!item) return false;
    const hasQty = String(item.quantity || "").trim() !== "" && String(item.quantity || "").trim() !== "0";
    if (Number(item.same_day_alert) !== 1 || item.purchased === 1 || !hasQty) {
        return false;
    }
    // L'avviso e il lampeggio arrivano a tutti gli altri account (smartphone o PC) e NON a chi l'ha inserito
    if (
        state.user &&
        Number(item.same_day_updated_by_id) > 0 &&
        Number(item.same_day_updated_by_id) === Number(state.user.id)
    ) {
        return false;
    }
    return true;
}

function getActiveSameDayAlertItems(items = state.items) {
    return (items || []).filter((i) => isSameDayAlertForOtherAccount(i));
}

function playAlertNotificationSound() {
    try {
        if (navigator.vibrate) {
            navigator.vibrate([120, 60, 120]);
        }
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.setValueAtTime(1174.66, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
    } catch (_) {}
}

function scheduleLocalSameDayPopupCheck() {
    if (localSameDayPopupTimer) {
        clearTimeout(localSameDayPopupTimer);
    }
    localSameDayPopupTimer = setTimeout(() => {
        checkAndShowSameDayAlertPopup(state.items);
    }, 1500);
}

function checkAndShowSameDayAlertPopup(items = state.items) {
    const activeAlerts = getActiveSameDayAlertItems(items);
    if (activeAlerts.length === 0) return;

    const acked = getAckedSameDayAlerts();
    const hasUnacknowledged = activeAlerts.some((item) => !acked[getSameDayAlertKey(item)]);
    if (!hasUnacknowledged) return;

    const listContainer = document.getElementById("same-day-alert-list");
    if (!listContainer) return;

    const sortedAlerts = [...activeAlerts].sort((a, b) => {
        const tA = String(a.same_day_updated_at || a.updated_at || "");
        const tB = String(b.same_day_updated_at || b.updated_at || "");
        return tB.localeCompare(tA);
    });

    listContainer.innerHTML = sortedAlerts
        .map((item) => {
            const supp = escapeHtml(item.fornitore || state.currentList?.fornitore || "Aldi");
            const unit = escapeHtml(item.unit || "Pz");
            const qty = escapeHtml(item.quantity || "1");
            const note = item.notes ? ` • 💬 ${escapeHtml(item.notes)}` : "";
            const by = item.same_day_updated_by ? `da <strong>${escapeHtml(item.same_day_updated_by)}</strong>` : "";
            const rawTime = String(item.same_day_updated_at || "").slice(11, 16);
            const timeLabel = rawTime ? ` alle ${escapeHtml(rawTime)}` : "";
            return `
                <div class="same-day-alert-item">
                    <div class="same-day-alert-item-info">
                        <span class="same-day-alert-item-name">🔔 ${escapeHtml(item.name)}</span>
                        <span class="same-day-alert-item-meta">🏪 ${supp}${note} ${by ? `(${by}${timeLabel})` : ""}</span>
                    </div>
                    <span class="same-day-alert-item-qty">Q.tà: ${qty} ${unit}</span>
                </div>
            `;
        })
        .join("");

    openModal("modal-same-day-alert");
    playAlertNotificationSound();
}

function acknowledgeSameDayAlertModal(scrollToFirst = false) {
    const activeAlerts = getActiveSameDayAlertItems(state.items);
    const acked = getAckedSameDayAlerts();
    for (const item of activeAlerts) {
        acked[getSameDayAlertKey(item)] = true;
    }
    saveAckedSameDayAlerts(acked);
    closeModal("modal-same-day-alert");

    if (scrollToFirst) {
        const firstRow = document.querySelector(".product-row.is-same-day-alert");
        if (firstRow) {
            firstRow.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }
}

// ============================================================================
// SISTEMA IMMAGINI & MINI CLIP POPUP (ESCLUSIVO ACCOUNT ROBERTO PER INVIO)
// ============================================================================
const mediaPopupState = {
    clips: [],
    users: [],
    selectedClipIds: new Set(),
    selectedRecipientIds: new Set(),
    incomingQueue: [],
    incomingIndex: 0,
};

function isCurrentUserRoberto() {
    if (!state.user) return false;
    if (state.user.is_roberto === true) return true;
    const u = String(state.user.username || "").trim().toLowerCase();
    const d = String(state.user.display_name || "").trim().toLowerCase();
    return u === "roberto" || d === "roberto" || u.startsWith("roberto") || d.startsWith("roberto");
}

function updateRobertoMediaButtonVisibility() {
    const btn = document.getElementById("btn-roberto-media-popup");
    if (!btn) return;
    if (isCurrentUserRoberto()) {
        btn.classList.remove("hidden");
    } else {
        btn.classList.add("hidden");
    }
}

async function openMediaPopupModal() {
    if (!isCurrentUserRoberto()) {
        showToast("Funzione riservata esclusivamente all'account di Roberto.");
        return;
    }
    openModal("modal-media-popup-manager");
    await loadMediaClipsAndUsers();
}

async function loadMediaClipsAndUsers() {
    try {
        const data = await apiFetch("/api/media-clips");
        mediaPopupState.clips = data.clips || [];
        mediaPopupState.users = data.users || [];

        // Rimuovi eventuali ID non più esistenti
        const validClipIds = new Set(mediaPopupState.clips.map((c) => Number(c.id)));
        for (const cid of Array.from(mediaPopupState.selectedClipIds)) {
            if (!validClipIds.has(cid)) mediaPopupState.selectedClipIds.delete(cid);
        }

        // Preseleziona di default gli altri account se non c'è ancora nessuna selezione
        if (mediaPopupState.selectedRecipientIds.size === 0) {
            for (const u of mediaPopupState.users) {
                if (Number(u.id) !== Number(state.user?.id)) {
                    mediaPopupState.selectedRecipientIds.add(Number(u.id));
                }
            }
        }

        renderMediaClipsGrid();
        renderMediaRecipientsList();
    } catch (err) {
        showToast(err.message);
    }
}

function renderMediaClipsGrid() {
    const grid = document.getElementById("media-clips-grid");
    const countEl = document.getElementById("media-selected-count");
    if (!grid) return;

    if (countEl) {
        countEl.textContent = String(mediaPopupState.selectedClipIds.size);
    }

    if (mediaPopupState.clips.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align:center; padding:22px 12px; color:#64748b; font-size:0.86rem;">
                Nessuna immagine o mini clip ancora caricata.<br/>
                Usa il pulsante <strong>⬆️ Carica</strong> qui sopra per aggiungere foto, GIF o mini video dal telefono o dal PC!
            </div>
        `;
        return;
    }

    grid.innerHTML = "";
    for (const clip of mediaPopupState.clips) {
        const cid = Number(clip.id);
        const isSelected = mediaPopupState.selectedClipIds.has(cid);
        const isVideo = clip.media_kind === "video";

        const card = document.createElement("div");
        card.className = `media-clip-card ${isSelected ? "is-selected" : ""}`;
        card.onclick = () => toggleSelectMediaClip(cid);

        const mediaHtml = isVideo
            ? `<video src="${escapeHtmlAttr(clip.url)}" muted playsinline preload="metadata"></video>`
            : `<img src="${escapeHtmlAttr(clip.url)}" alt="${escapeHtmlAttr(clip.title)}" loading="lazy" />`;

        card.innerHTML = `
            <div class="media-clip-thumb-wrap">
                <div class="media-clip-check">${isSelected ? "✓" : ""}</div>
                ${mediaHtml}
                <span class="media-clip-kind-badge">${isVideo ? "🎬 Clip" : "🖼️ Foto"}</span>
                <button type="button" class="media-clip-delete-btn" title="Elimina dalla libreria">🗑</button>
            </div>
            <div class="media-clip-info" title="${escapeHtmlAttr(clip.title)}">
                ${escapeHtml(clip.title)}
            </div>
        `;

        const delBtn = card.querySelector(".media-clip-delete-btn");
        if (delBtn) {
            delBtn.addEventListener("click", (ev) => {
                ev.stopPropagation();
                deleteMediaClipItem(cid, clip.title);
            });
        }

        // Hover / touch preview for video thumbnails
        const vidEl = card.querySelector("video");
        if (vidEl) {
            card.addEventListener("mouseenter", () => {
                vidEl.play().catch(() => {});
            });
            card.addEventListener("mouseleave", () => {
                vidEl.pause();
                vidEl.currentTime = 0;
            });
        }

        grid.appendChild(card);
    }
}

function toggleSelectMediaClip(clipId) {
    const cid = Number(clipId);
    if (mediaPopupState.selectedClipIds.has(cid)) {
        mediaPopupState.selectedClipIds.delete(cid);
    } else {
        mediaPopupState.selectedClipIds.add(cid);
    }
    renderMediaClipsGrid();
}

function selectAllMediaClips(selectAll = true) {
    mediaPopupState.selectedClipIds.clear();
    if (selectAll) {
        for (const c of mediaPopupState.clips) {
            mediaPopupState.selectedClipIds.add(Number(c.id));
        }
    }
    renderMediaClipsGrid();
}

async function handleUploadMediaClips() {
    const fileInput = document.getElementById("media-upload-input");
    const titleInput = document.getElementById("media-upload-title");
    const uploadBtn = document.getElementById("btn-upload-media-clip");

    const files = fileInput?.files ? Array.from(fileInput.files) : [];
    if (files.length === 0) {
        showToast("Scegli prima una o più immagini o mini clip da caricare!");
        return;
    }

    const customTitle = (titleInput?.value || "").trim();
    if (uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.textContent = "⏳ Caricamento...";
    }

    try {
        let uploadedCount = 0;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const perFileTitle =
                customTitle && files.length > 1 ? `${customTitle} (${i + 1})` : customTitle;

            const res = await fetch("/api/media-clips/upload", {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": file.type || "application/octet-stream",
                    "X-Mime-Type": file.type || "application/octet-stream",
                    "X-File-Name": encodeURIComponent(file.name || "clip"),
                    "X-Clip-Title": encodeURIComponent(perFileTitle),
                },
                body: file,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || "Errore durante il caricamento del file");
            }
            if (data.clips) {
                mediaPopupState.clips = data.clips;
            }
            if (data.uploaded_id) {
                mediaPopupState.selectedClipIds.add(Number(data.uploaded_id));
            }
            uploadedCount++;
        }

        if (fileInput) fileInput.value = "";
        if (titleInput) titleInput.value = "";
        renderMediaClipsGrid();
        showToast(
            uploadedCount === 1
                ? "File caricato e selezionato nella libreria!"
                : `${uploadedCount} file caricati e selezionati nella libreria!`,
            "success"
        );
    } catch (err) {
        showToast(err.message);
    } finally {
        if (uploadBtn) {
            uploadBtn.disabled = false;
            uploadBtn.textContent = "⬆️ Carica";
        }
    }
}

async function deleteMediaClipItem(clipId, title = "") {
    if (!confirm(`Vuoi eliminare "${title || "questa clip"}" dalla libreria?`)) return;
    try {
        const data = await apiFetch(`/api/media-clips/${clipId}`, { method: "DELETE" });
        mediaPopupState.selectedClipIds.delete(Number(clipId));
        mediaPopupState.clips = data.clips || [];
        renderMediaClipsGrid();
        showToast("Elemento rimosso dalla libreria.");
    } catch (err) {
        showToast(err.message);
    }
}

function renderMediaRecipientsList() {
    const container = document.getElementById("media-recipients-list");
    if (!container) return;
    container.innerHTML = "";

    for (const u of mediaPopupState.users) {
        const uid = Number(u.id);
        const isMe = state.user && Number(state.user.id) === uid;
        const checked = mediaPopupState.selectedRecipientIds.has(uid);

        const label = document.createElement("label");
        label.className = `media-recipient-chip ${checked ? "is-checked" : ""}`;
        label.innerHTML = `
            <input type="checkbox" ${checked ? "checked" : ""} />
            <span>👤 ${escapeHtml(u.display_name || u.username)}</span>
            <small style="opacity:0.75;">(${escapeHtml(u.username)}${isMe ? " • Tu" : ""})</small>
        `;
        const cb = label.querySelector("input");
        cb.addEventListener("change", () => {
            if (cb.checked) {
                mediaPopupState.selectedRecipientIds.add(uid);
            } else {
                mediaPopupState.selectedRecipientIds.delete(uid);
            }
            renderMediaRecipientsList();
        });
        container.appendChild(label);
    }
}

function selectAllMediaRecipients(includeSelf = false) {
    mediaPopupState.selectedRecipientIds.clear();
    for (const u of mediaPopupState.users) {
        const uid = Number(u.id);
        const isMe = state.user && Number(state.user.id) === uid;
        if (!isMe || includeSelf) {
            mediaPopupState.selectedRecipientIds.add(uid);
        }
    }
    renderMediaRecipientsList();
}

async function sendSelectedMediaPopups() {
    const clipIds = Array.from(mediaPopupState.selectedClipIds);
    const recipientIds = Array.from(mediaPopupState.selectedRecipientIds);
    const customMsgInput = document.getElementById("media-popup-custom-message");
    const customMessage = (customMsgInput?.value || "").trim();

    if (clipIds.length === 0) {
        showToast("Seleziona almeno un'immagine o mini clip dalla galleria (punto 2)!");
        return;
    }
    if (recipientIds.length === 0) {
        showToast("Seleziona almeno un account destinatario (punto 3)!");
        return;
    }

    try {
        const res = await apiFetch("/api/media-popups/send", {
            method: "POST",
            body: JSON.stringify({
                clip_ids: clipIds,
                recipient_user_ids: recipientIds,
                custom_message: customMessage,
            }),
        });

        if (customMsgInput) customMsgInput.value = "";
        closeModal("modal-media-popup-manager");
        showToast(
            `🚀 Popup inviato con successo (${res.clips_count} clip a ${res.recipients_count} account)!`,
            "success"
        );

        // Se Roberto ha selezionato anche se stesso per testare, mostra subito il popup
        if (state.user && recipientIds.includes(Number(state.user.id))) {
            await checkPendingMediaPopups();
        }
    } catch (err) {
        showToast(err.message);
    }
}

async function checkPendingMediaPopups() {
    if (!state.user) return;
    try {
        const data = await apiFetch("/api/media-popups/pending");
        const popups = data.popups || [];
        if (popups.length === 0) return;

        const existingIds = new Set(mediaPopupState.incomingQueue.map((p) => Number(p.delivery_id)));
        const hasNew = popups.some((p) => !existingIds.has(Number(p.delivery_id)));

        mediaPopupState.incomingQueue = popups;
        if (mediaPopupState.incomingIndex >= popups.length) {
            mediaPopupState.incomingIndex = 0;
        }

        const modalEl = document.getElementById("modal-incoming-media-popup");
        const isAlreadyOpen = modalEl && !modalEl.classList.contains("hidden");

        if (!isAlreadyOpen || hasNew) {
            if (!isAlreadyOpen) {
                mediaPopupState.incomingIndex = 0;
            }
            renderCurrentIncomingMediaPopup();
            openModal("modal-incoming-media-popup");
            playAlertNotificationSound();
        }
    } catch (_) {}
}

function renderCurrentIncomingMediaPopup() {
    const queue = mediaPopupState.incomingQueue || [];
    if (queue.length === 0) return;

    const idx = Math.max(0, Math.min(mediaPopupState.incomingIndex, queue.length - 1));
    mediaPopupState.incomingIndex = idx;
    const item = queue[idx];

    const senderTitle = document.getElementById("incoming-media-sender-title");
    const counterEl = document.getElementById("incoming-media-counter");
    const customMsgEl = document.getElementById("incoming-media-custom-msg");
    const clipTitleEl = document.getElementById("incoming-media-clip-title");
    const stageEl = document.getElementById("incoming-media-stage");
    const navEl = document.getElementById("incoming-media-nav");

    if (senderTitle) {
        senderTitle.textContent = `🎬 Popup da ${item.sender_name || "Roberto"}!`;
    }
    if (counterEl) {
        counterEl.textContent = `${idx + 1} / ${queue.length}`;
    }
    if (customMsgEl) {
        if (item.custom_message) {
            customMsgEl.textContent = `💬 "${item.custom_message}"`;
            customMsgEl.classList.remove("hidden");
        } else {
            customMsgEl.textContent = "";
            customMsgEl.classList.add("hidden");
        }
    }
    if (clipTitleEl) {
        clipTitleEl.textContent = item.title || "";
    }
    if (navEl) {
        navEl.classList.toggle("hidden", queue.length <= 1);
    }

    if (stageEl) {
        stageEl.innerHTML = "";
        if (item.media_kind === "video") {
            const vid = document.createElement("video");
            vid.src = item.url;
            vid.controls = true;
            vid.autoplay = true;
            vid.loop = true;
            vid.playsInline = true;
            vid.setAttribute("playsinline", "true");
            stageEl.appendChild(vid);

            // Tenta riproduzione con audio; se iOS/browser richiede muto per l'autoplay, avvia in muto e mostra pulsante "🔊 Attiva Audio"
            vid.play().catch(() => {
                vid.muted = true;
                vid.play().catch(() => {});
                const unmuteBtn = document.createElement("button");
                unmuteBtn.type = "button";
                unmuteBtn.className = "incoming-media-unmute-btn";
                unmuteBtn.textContent = "🔊 Attiva Audio";
                unmuteBtn.onclick = () => {
                    vid.muted = false;
                    vid.play().catch(() => {});
                    unmuteBtn.remove();
                };
                stageEl.appendChild(unmuteBtn);
            });
        } else {
            const img = document.createElement("img");
            img.src = item.url;
            img.alt = item.title || "Immagine Popup";
            stageEl.appendChild(img);
        }
    }
}

function stepIncomingMediaPopup(delta) {
    const queue = mediaPopupState.incomingQueue || [];
    if (queue.length <= 1) return;
    mediaPopupState.incomingIndex =
        (mediaPopupState.incomingIndex + delta + queue.length) % queue.length;
    renderCurrentIncomingMediaPopup();
}

async function acknowledgeIncomingMediaPopup() {
    const stageEl = document.getElementById("incoming-media-stage");
    if (stageEl) {
        const vid = stageEl.querySelector("video");
        if (vid) vid.pause();
        stageEl.innerHTML = "";
    }
    const deliveryIds = (mediaPopupState.incomingQueue || []).map((p) => Number(p.delivery_id));
    mediaPopupState.incomingQueue = [];
    mediaPopupState.incomingIndex = 0;
    closeModal("modal-incoming-media-popup");

    try {
        await apiFetch("/api/media-popups/ack", {
            method: "POST",
            body: JSON.stringify({ delivery_ids: deliveryIds }),
        });
    } catch (_) {}
}

// ============================================================================
// SEZIONE 3: ANALISI PRODOTTI & GRAFICI AVANZATI (SOLO PC — UI/UX PRO MAX)
// ============================================================================
const analyticsState = {
    loaded: false,
    rawAcquisti: [],
    rawListItems: [],
    rawCatalog: [],
    rawSupplierPrices: [],
    rawCategories: [],
    rawFornitori: [],
    source: "combined",
    primaryMetric: "spend", // 'spend' | 'qty' | 'unit_price'
    distMode: "category", // 'category' | 'supplier'
    sortBy: "spend_desc",
    searchQuery: "",
    filterCategory: "ALL",
    filterSupplier: "ALL",
    filterYear: "ALL",
    filterMonth: "ALL",
    minPrice: "",
    maxPrice: "",
    minQty: "",
    focusProductName: "",
};

const ANALYTICS_PALETTE = [
    "#2563eb",
    "#7c3aed",
    "#ec4899",
    "#10b981",
    "#f59e0b",
    "#06b6d4",
    "#f43f5e",
    "#6366f1",
    "#14b8a6",
    "#8b5cf6",
    "#ea580c",
    "#0ea5e9",
];

function getAnalyticsCategoryColor(catName) {
    const upper = String(catName || "ALTRO").toUpperCase();
    const found = (analyticsState.rawCategories || state.categories || []).find(
        (c) => String(c.name || "").toUpperCase() === upper
    );
    if (found && found.color) return found.color;
    const map = {
        VERDURA: "#16a34a",
        FRUTTA: "#ea580c",
        ALIMENTARI: "#ca8a04",
        "PULIZIA E CASA": "#9333ea",
        VARIE: "#475569",
    };
    return map[upper] || "#2563eb";
}

async function loadAnalyticsDashboard(forceReload = false) {
    try {
        const data = await apiFetch("/api/analytics/products");
        analyticsState.rawAcquisti = data.acquisti || [];
        analyticsState.rawListItems = data.list_items || [];
        analyticsState.rawCatalog = data.catalog || [];
        analyticsState.rawSupplierPrices = data.supplier_prices || [];
        analyticsState.rawCategories = data.categories || [];
        analyticsState.rawFornitori = data.fornitori || [];
        analyticsState.loaded = true;

        populateAnalyticsFilterDropdowns();
        renderAnalyticsDashboard();
        if (forceReload) {
            showToast("📈 Dati e grafici analitici aggiornati!", "success");
        }
    } catch (err) {
        showToast(err.message || "Errore nel caricamento dell'analisi prodotti");
    }
}

function populateAnalyticsFilterDropdowns() {
    const catSel = document.getElementById("an-filter-category");
    if (catSel) {
        const prev = analyticsState.filterCategory || "ALL";
        const cats = new Set();
        (analyticsState.rawCategories || []).forEach((c) => cats.add(String(c.name || "").toUpperCase()));
        (analyticsState.rawCatalog || []).forEach((c) => cats.add(String(c.category || "").toUpperCase()));
        (analyticsState.rawAcquisti || []).forEach((r) => cats.add(String(r.categoria || "").toUpperCase()));
        (analyticsState.rawListItems || []).forEach((r) => cats.add(String(r.category || "").toUpperCase()));

        catSel.innerHTML = `<option value="ALL">Tutte le categorie</option>`;
        for (const c of Array.from(cats).filter(Boolean)) {
            const opt = document.createElement("option");
            opt.value = c;
            opt.textContent = c;
            if (c === prev) opt.selected = true;
            catSel.appendChild(opt);
        }
    }

    const supSel = document.getElementById("an-filter-supplier");
    if (supSel) {
        const prev = analyticsState.filterSupplier || "ALL";
        const sups = new Set();
        (analyticsState.rawFornitori || []).forEach((f) => sups.add(f.nome));
        (analyticsState.rawAcquisti || []).forEach((r) => sups.add(r.fornitore || "Aldi"));
        (analyticsState.rawListItems || []).forEach((r) => sups.add(r.fornitore || "Aldi"));

        supSel.innerHTML = `<option value="ALL">Tutti i fornitori</option>`;
        for (const s of Array.from(sups).filter(Boolean)) {
            const opt = document.createElement("option");
            opt.value = s;
            opt.textContent = s;
            if (s.toLowerCase() === prev.toLowerCase()) opt.selected = true;
            supSel.appendChild(opt);
        }
    }

    const yearSel = document.getElementById("an-filter-year");
    if (yearSel) {
        const prev = analyticsState.filterYear || "ALL";
        const years = new Set([String(new Date().getFullYear())]);
        (analyticsState.rawAcquisti || []).forEach((r) => {
            const y = String(r.anno || String(r.data_acquisto || "").slice(0, 4));
            if (/^\d{4}$/.test(y)) years.add(y);
        });
        (analyticsState.rawListItems || []).forEach((r) => {
            const y = String(r.list_date || "").slice(0, 4);
            if (/^\d{4}$/.test(y)) years.add(y);
        });

        yearSel.innerHTML = `<option value="ALL">Tutti gli anni</option>`;
        for (const y of Array.from(years).sort((a, b) => b.localeCompare(a))) {
            const opt = document.createElement("option");
            opt.value = y;
            opt.textContent = y;
            if (y === prev) opt.selected = true;
            yearSel.appendChild(opt);
        }
    }
}

function setAnalyticsPrimaryMetric(metric) {
    analyticsState.primaryMetric = metric;
    ["spend", "qty", "unit_price"].forEach((m) => {
        document.getElementById(`an-metric-btn-${m}`)?.classList.toggle("active", m === metric);
    });
    renderAnalyticsDashboard();
}

function setAnalyticsDistMode(mode) {
    analyticsState.distMode = mode;
    document.getElementById("an-dist-btn-cat")?.classList.toggle("active", mode === "category");
    document.getElementById("an-dist-btn-sup")?.classList.toggle("active", mode === "supplier");
    renderAnalyticsDashboard();
}

function setAnalyticsFocusProduct(prodName) {
    if (analyticsState.focusProductName === prodName) {
        analyticsState.focusProductName = "";
    } else {
        analyticsState.focusProductName = prodName || "";
    }
    renderAnalyticsDashboard();
}

let anSearchTimer = null;
function onAnalyticsSearchInput(val) {
    analyticsState.searchQuery = String(val || "").trim();
    clearTimeout(anSearchTimer);
    anSearchTimer = setTimeout(() => {
        renderAnalyticsDashboard();
    }, 120);
}

function onAnalyticsControlChange() {
    analyticsState.source = document.getElementById("an-source-select")?.value || "combined";
    analyticsState.sortBy = document.getElementById("an-sort-select")?.value || "spend_desc";
    analyticsState.filterCategory = document.getElementById("an-filter-category")?.value || "ALL";
    analyticsState.filterSupplier = document.getElementById("an-filter-supplier")?.value || "ALL";
    analyticsState.filterYear = document.getElementById("an-filter-year")?.value || "ALL";
    analyticsState.filterMonth = document.getElementById("an-filter-month")?.value || "ALL";
    analyticsState.minPrice = document.getElementById("an-filter-min-price")?.value || "";
    analyticsState.maxPrice = document.getElementById("an-filter-max-price")?.value || "";
    analyticsState.minQty = document.getElementById("an-filter-min-qty")?.value || "";
    renderAnalyticsDashboard();
}

function resetAnalyticsFilters() {
    analyticsState.searchQuery = "";
    analyticsState.filterCategory = "ALL";
    analyticsState.filterSupplier = "ALL";
    analyticsState.filterYear = "ALL";
    analyticsState.filterMonth = "ALL";
    analyticsState.minPrice = "";
    analyticsState.maxPrice = "";
    analyticsState.minQty = "";
    analyticsState.focusProductName = "";

    const setVal = (id, v) => {
        const el = document.getElementById(id);
        if (el) el.value = v;
    };
    setVal("an-search-input", "");
    setVal("an-filter-category", "ALL");
    setVal("an-filter-supplier", "ALL");
    setVal("an-filter-year", "ALL");
    setVal("an-filter-month", "ALL");
    setVal("an-filter-min-price", "");
    setVal("an-filter-max-price", "");
    setVal("an-filter-min-qty", "");

    renderAnalyticsDashboard();
}

function toggleAnalyticsTableSort(col) {
    const mapToggle = {
        name: analyticsState.sortBy === "name_asc" ? "name_desc" : "name_asc",
        qty: analyticsState.sortBy === "qty_desc" ? "qty_asc" : "qty_desc",
        freq: "freq_desc",
        unit: analyticsState.sortBy === "unit_desc" ? "unit_asc" : "unit_desc",
        avg: "avg_desc",
        spend: analyticsState.sortBy === "spend_desc" ? "spend_asc" : "spend_desc",
    };
    analyticsState.sortBy = mapToggle[col] || "spend_desc";
    const sortSel = document.getElementById("an-sort-select");
    if (sortSel) sortSel.value = analyticsState.sortBy;
    renderAnalyticsDashboard();
}

function parseAnalyticsQty(rawQty, isPurchasedOrActive = false) {
    if (typeof rawQty === "number") return rawQty > 0 ? rawQty : isPurchasedOrActive ? 1 : 0;
    const cleaned = String(rawQty || "").replace(",", ".").trim();
    const m = cleaned.match(/(\d+(?:\.\d+)?)/);
    if (m) return parseFloat(m[1]);
    return isPurchasedOrActive ? 1 : 0;
}

function buildAnalyticsDataset() {
    const source = analyticsState.source || "combined";
    const catalogMap = new Map();
    for (const c of analyticsState.rawCatalog || []) {
        catalogMap.set(String(c.name || "").trim().toLowerCase(), c);
    }

    const supplierPriceMap = new Map();
    for (const sp of analyticsState.rawSupplierPrices || []) {
        const k = String(sp.product_name || "").trim().toLowerCase();
        if (!supplierPriceMap.has(k)) supplierPriceMap.set(k, new Map());
        supplierPriceMap.get(k).set(sp.fornitore || "Aldi", Number(sp.unit_price || 0));
    }

    // Costruisce la lista di eventi / record normalizzati in base alla fonte scelta
    const records = [];
    const importedListItemIds = new Set();

    if (source === "db_only" || source === "combined") {
        for (const r of analyticsState.rawAcquisti || []) {
            if (r.list_item_id) importedListItemIds.add(Number(r.list_item_id));
            const name = String(r.descrizione_prodotto || "").trim();
            if (!name) continue;
            const catItem = catalogMap.get(name.toLowerCase());
            const category = String(r.categoria || catItem?.category || "ALIMENTARI").toUpperCase();
            const supplier = String(r.fornitore || catItem?.last_fornitore || "Aldi").trim();
            const unit = String(r.unita || catItem?.default_unit || "Pz").trim();
            const qty = Number(r.quantita) > 0 ? Number(r.quantita) : 1;
            const unitPrice = Number(r.prezzo_unitario) > 0 ? Number(r.prezzo_unitario) : Number(catItem?.last_unit_price || 0);
            const spend = Number(r.prezzo_totale) > 0 ? Number(r.prezzo_totale) : qty * unitPrice;
            const dateStr = String(r.giorno || r.data_acquisto || "").slice(0, 10);
            records.push({
                name,
                category,
                supplier,
                unit,
                qty,
                unitPrice,
                spend,
                date: dateStr,
            });
        }
    }

    if (source === "combined" || source === "all_lists" || source === "current_list") {
        const activeListId = state.currentList ? Number(state.currentList.id) : null;
        for (const li of analyticsState.rawListItems || []) {
            if (source === "current_list" && activeListId && Number(li.list_id) !== activeListId) {
                continue;
            }
            if (source === "combined" && importedListItemIds.has(Number(li.item_id))) {
                continue;
            }
            const isActiveOrPurchased =
                li.purchased === 1 || li.in_list === 1 || String(li.quantity || "").trim() !== "";
            if (!isActiveOrPurchased) continue;

            const name = String(li.name || "").trim();
            if (!name) continue;
            const catItem = catalogMap.get(name.toLowerCase());
            const category = String(li.category || catItem?.category || "ALIMENTARI").toUpperCase();
            const supplier = String(li.fornitore || catItem?.last_fornitore || "Aldi").trim();
            const unit = String(li.unit || catItem?.default_unit || "Pz").trim();
            const qty = parseAnalyticsQty(li.quantity, true);
            const unitPrice = Number(li.unit_price) > 0 ? Number(li.unit_price) : Number(catItem?.last_unit_price || 0);
            const spend = Number(li.total_price) > 0 ? Number(li.total_price) : qty * unitPrice;
            const dateStr = String(li.list_date || "").slice(0, 10);

            records.push({
                name,
                category,
                supplier,
                unit,
                qty,
                unitPrice,
                spend,
                date: dateStr,
            });
        }
    }

    if (source === "catalog") {
        for (const c of analyticsState.rawCatalog || []) {
            const name = String(c.name || "").trim();
            if (!name) continue;
            const unitPrice = Number(c.last_unit_price || 0);
            records.push({
                name,
                category: String(c.category || "ALIMENTARI").toUpperCase(),
                supplier: String(c.last_fornitore || "Aldi").trim(),
                unit: String(c.default_unit || "Pz").trim(),
                qty: 1,
                unitPrice,
                spend: unitPrice,
                date: todayISO(),
            });
        }
    }

    // Applica i filtri a livello di record (Categoria, Fornitore, Anno, Mese, Ricerca)
    const q = (analyticsState.searchQuery || "").toLowerCase();
    const fCat = analyticsState.filterCategory || "ALL";
    const fSup = analyticsState.filterSupplier || "ALL";
    const fYear = analyticsState.filterYear || "ALL";
    const fMonth = analyticsState.filterMonth || "ALL";

    const filteredRecords = records.filter((rec) => {
        if (fCat !== "ALL" && rec.category.toUpperCase() !== fCat.toUpperCase()) return false;
        if (fSup !== "ALL" && rec.supplier.toLowerCase() !== fSup.toLowerCase()) return false;
        if (fYear !== "ALL" && String(rec.date).slice(0, 4) !== fYear) return false;
        if (fMonth !== "ALL" && String(rec.date).slice(5, 7) !== fMonth) return false;
        if (
            q &&
            !rec.name.toLowerCase().includes(q) &&
            !rec.category.toLowerCase().includes(q) &&
            !rec.supplier.toLowerCase().includes(q)
        ) {
            return false;
        }
        return true;
    });

    // Aggrega per Prodotto
    const productMap = new Map();
    for (const rec of filteredRecords) {
        const key = rec.name.toLowerCase();
        if (!productMap.has(key)) {
            const catItem = catalogMap.get(key);
            productMap.set(key, {
                name: rec.name,
                category: rec.category,
                unit: rec.unit || catItem?.default_unit || "Pz",
                totalQty: 0,
                totalSpend: 0,
                freq: 0,
                currentUnitPrice: Number(catItem?.last_unit_price || 0),
                latestDate: "",
                minPrice: Infinity,
                maxPrice: 0,
                pricePoints: [],
                suppliers: new Map(),
            });
        }
        const p = productMap.get(key);
        p.totalQty += rec.qty;
        p.totalSpend += rec.spend;
        p.freq += 1;

        if (!p.latestDate || rec.date >= p.latestDate) {
            p.latestDate = rec.date;
            if (rec.unitPrice > 0) {
                p.currentUnitPrice = rec.unitPrice;
            }
        }
        if (rec.unitPrice > 0) {
            if (rec.unitPrice < p.minPrice) p.minPrice = rec.unitPrice;
            if (rec.unitPrice > p.maxPrice) p.maxPrice = rec.unitPrice;
            p.pricePoints.push({
                date: rec.date,
                price: rec.unitPrice,
                supplier: rec.supplier,
                qty: rec.qty,
            });
        }

        if (!p.suppliers.has(rec.supplier)) {
            p.suppliers.set(rec.supplier, { qty: 0, spend: 0, lastPrice: rec.unitPrice });
        }
        const supEntry = p.suppliers.get(rec.supplier);
        supEntry.qty += rec.qty;
        supEntry.spend += rec.spend;
        if (rec.unitPrice > 0) supEntry.lastPrice = rec.unitPrice;
    }

    // Arricchisce con eventuali prezzi per fornitore salvati in supplier_product_prices
    for (const [key, p] of productMap.entries()) {
        const spMap = supplierPriceMap.get(key);
        if (spMap) {
            for (const [sName, sPrice] of spMap.entries()) {
                if (fSup !== "ALL" && sName.toLowerCase() !== fSup.toLowerCase()) continue;
                if (!p.suppliers.has(sName)) {
                    p.suppliers.set(sName, { qty: 0, spend: 0, lastPrice: sPrice });
                } else if (!(p.suppliers.get(sName).lastPrice > 0)) {
                    p.suppliers.get(sName).lastPrice = sPrice;
                }
            }
        }
        if (p.minPrice === Infinity) p.minPrice = p.currentUnitPrice || 0;
        if (p.maxPrice === 0) p.maxPrice = p.currentUnitPrice || 0;
        p.avgUnitPrice =
            p.pricePoints.length > 0
                ? p.pricePoints.reduce((s, x) => s + x.price, 0) / p.pricePoints.length
                : p.currentUnitPrice || 0;
        if (!(p.currentUnitPrice > 0) && p.avgUnitPrice > 0) {
            p.currentUnitPrice = p.avgUnitPrice;
        }
    }

    // Applica filtri su Prezzo Min/Max e Quantità Minima
    const minP = parseFloat(analyticsState.minPrice);
    const maxP = parseFloat(analyticsState.maxPrice);
    const minQ = parseFloat(analyticsState.minQty);

    let products = Array.from(productMap.values()).filter((p) => {
        const refPrice = p.currentUnitPrice || p.avgUnitPrice || 0;
        if (!isNaN(minP) && minP > 0 && refPrice < minP) return false;
        if (!isNaN(maxP) && maxP > 0 && refPrice > maxP) return false;
        if (!isNaN(minQ) && minQ > 0 && p.totalQty < minQ) return false;
        return true;
    });

    // Ordinamento personalizzato
    const sortBy = analyticsState.sortBy || "spend_desc";
    products.sort((a, b) => {
        if (sortBy === "spend_desc") return b.totalSpend - a.totalSpend || b.totalQty - a.totalQty;
        if (sortBy === "spend_asc") return a.totalSpend - b.totalSpend || a.totalQty - b.totalQty;
        if (sortBy === "qty_desc") return b.totalQty - a.totalQty || b.totalSpend - a.totalSpend;
        if (sortBy === "qty_asc") return a.totalQty - b.totalQty || a.totalSpend - b.totalSpend;
        if (sortBy === "unit_desc") return b.currentUnitPrice - a.currentUnitPrice || b.totalSpend - a.totalSpend;
        if (sortBy === "unit_asc") return (a.currentUnitPrice || 999999) - (b.currentUnitPrice || 999999);
        if (sortBy === "avg_desc") return b.avgUnitPrice - a.avgUnitPrice;
        if (sortBy === "freq_desc") return b.freq - a.freq || b.totalQty - a.totalQty;
        if (sortBy === "name_asc") return a.name.localeCompare(b.name, "it", { sensitivity: "base" });
        if (sortBy === "name_desc") return b.name.localeCompare(a.name, "it", { sensitivity: "base" });
        return b.totalSpend - a.totalSpend;
    });

    return { products, filteredRecords };
}

function renderAnalyticsDashboard() {
    if (!document.getElementById("section-analytics")) return;
    const { products, filteredRecords } = buildAnalyticsDataset();

    const totalSpend = products.reduce((s, p) => s + p.totalSpend, 0);
    const totalQty = products.reduce((s, p) => s + p.totalQty, 0);
    const pricedProds = products.filter((p) => p.currentUnitPrice > 0);
    const avgUnitPrice =
        pricedProds.length > 0
            ? pricedProds.reduce((s, p) => s + p.currentUnitPrice, 0) / pricedProds.length
            : 0;

    // Aggiorna le 5 Hero KPI Cards
    const setTxt = (id, t) => {
        const el = document.getElementById(id);
        if (el) el.textContent = t;
    };
    setTxt("an-kpi-total-spend", `${totalSpend.toFixed(2)}`);
    setTxt("an-kpi-spend-sub", `CHF/€ su ${filteredRecords.length} registrazioni`);
    setTxt("an-kpi-total-qty", `${Math.round(totalQty * 100) / 100}`);
    setTxt(
        "an-kpi-qty-sub",
        `Media ${products.length > 0 ? (totalQty / products.length).toFixed(1) : "0"} unità / prodotto`
    );
    setTxt("an-kpi-unique-products", `${products.length}`);
    setTxt("an-kpi-avg-price-sub", `Prezzo unit. medio: ${avgUnitPrice.toFixed(2)} CHF/€`);

    const byPrimary = [...products].sort((a, b) => {
        if (analyticsState.primaryMetric === "qty") return b.totalQty - a.totalQty;
        if (analyticsState.primaryMetric === "unit_price") return b.currentUnitPrice - a.currentUnitPrice;
        return b.totalSpend - a.totalSpend;
    });
    const topProd = byPrimary[0];
    if (topProd) {
        setTxt("an-kpi-top-product", topProd.name);
        setTxt(
            "an-kpi-top-product-sub",
            `${topProd.totalSpend.toFixed(2)} CHF/€ • Q.tà: ${Math.round(topProd.totalQty * 100) / 100} ${topProd.unit}`
        );
    } else {
        setTxt("an-kpi-top-product", "—");
        setTxt("an-kpi-top-product-sub", "Nessun dato");
    }

    // Calcola Top Fornitore & Top Categoria
    const supTotals = new Map();
    const catTotals = new Map();
    for (const r of filteredRecords) {
        const val = analyticsState.primaryMetric === "qty" ? r.qty : r.spend;
        supTotals.set(r.supplier, (supTotals.get(r.supplier) || 0) + val);
        catTotals.set(r.category, (catTotals.get(r.category) || 0) + val);
    }
    const topSupEntry = Array.from(supTotals.entries()).sort((a, b) => b[1] - a[1])[0];
    const topCatEntry = Array.from(catTotals.entries()).sort((a, b) => b[1] - a[1])[0];
    setTxt("an-kpi-top-supplier", topSupEntry ? topSupEntry[0] : "—");
    setTxt("an-kpi-top-cat-sub", topCatEntry ? `1° Reparto: ${topCatEntry[0]}` : "—");

    // Renderizza i 4 Grafici Avanzati + la Tabella
    renderAnalyticsTopProductsChart(byPrimary, totalSpend, totalQty);
    renderAnalyticsDistributionChart(filteredRecords);
    renderAnalyticsScatterChart(products);
    renderAnalyticsTrendChart(filteredRecords, products);
    renderAnalyticsProductsTable(products, totalSpend, totalQty);
}

function renderAnalyticsTopProductsChart(sortedProducts, totalSpend, totalQty) {
    const container = document.getElementById("an-chart-top-products");
    if (!container) return;
    const limit = Number(document.getElementById("an-top-limit-select")?.value || 15);
    const slice = sortedProducts.slice(0, limit);

    if (slice.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding:36px 12px;"><p>Nessun prodotto corrisponde ai filtri selezionati.</p></div>`;
        return;
    }

    const metric = analyticsState.primaryMetric;
    const maxVal = Math.max(
        ...slice.map((p) =>
            metric === "qty" ? p.totalQty : metric === "unit_price" ? p.currentUnitPrice : p.totalSpend
        ),
        0.01
    );

    container.innerHTML = slice
        .map((p, idx) => {
            const rank = idx + 1;
            const rankClass = rank <= 3 ? `rank-${rank}` : "";
            const val =
                metric === "qty"
                    ? p.totalQty
                    : metric === "unit_price"
                    ? p.currentUnitPrice
                    : p.totalSpend;
            const widthPct = Math.max(4, Math.min(100, (val / maxVal) * 100));
            const catColor = getAnalyticsCategoryColor(p.category);
            const isFocused =
                analyticsState.focusProductName &&
                analyticsState.focusProductName.toLowerCase() === p.name.toLowerCase();

            let primaryLabel = `${p.totalSpend.toFixed(2)} CHF/€`;
            let secondaryLabel = `Q.tà: ${Math.round(p.totalQty * 100) / 100} ${p.unit} • Unit: ${p.currentUnitPrice.toFixed(2)}`;
            if (metric === "qty") {
                primaryLabel = `${Math.round(p.totalQty * 100) / 100} ${escapeHtml(p.unit)}`;
                secondaryLabel = `Spesa: ${p.totalSpend.toFixed(2)} • Unit: ${p.currentUnitPrice.toFixed(2)}`;
            } else if (metric === "unit_price") {
                primaryLabel = `${p.currentUnitPrice.toFixed(2)} / ${escapeHtml(p.unit)}`;
                secondaryLabel = `Q.tà: ${Math.round(p.totalQty * 100) / 100} • Tot: ${p.totalSpend.toFixed(2)}`;
            }

            const sups = Array.from(p.suppliers.keys()).join(", ");
            return `
                <div class="an-bar-row ${isFocused ? "is-focused" : ""}" onclick="setAnalyticsFocusProduct('${escapeHtmlAttr(p.name)}')" title="Clicca per visualizzare l'andamento prezzo di ${escapeHtmlAttr(p.name)}">
                    <span class="an-bar-rank ${rankClass}">#${rank}</span>
                    <div class="an-bar-name-col">
                        <span class="an-bar-prod-name">${escapeHtml(p.name)}</span>
                        <span class="an-bar-prod-meta">${escapeHtml(p.category)} • 🏪 ${escapeHtml(sups)}</span>
                    </div>
                    <div class="an-bar-track">
                        <div class="an-bar-fill" style="width:${widthPct.toFixed(1)}%; background: linear-gradient(90deg, ${catColor} 0%, #6366f1 100%);"></div>
                    </div>
                    <div class="an-bar-val-col">
                        <span class="an-bar-val-primary">${primaryLabel}</span>
                        <span class="an-bar-val-secondary">${secondaryLabel}</span>
                    </div>
                </div>
            `;
        })
        .join("");
}

function renderAnalyticsDistributionChart(filteredRecords) {
    const container = document.getElementById("an-chart-distribution");
    if (!container) return;

    const mode = analyticsState.distMode || "category";
    const metric = analyticsState.primaryMetric === "qty" ? "qty" : "spend";
    const totals = new Map();

    for (const r of filteredRecords) {
        const key = mode === "supplier" ? r.supplier || "Aldi" : r.category || "ALTRO";
        const val = metric === "qty" ? r.qty : r.spend;
        totals.set(key, (totals.get(key) || 0) + val);
    }

    const entries = Array.from(totals.entries())
        .filter((e) => e[1] > 0)
        .sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
        container.innerHTML = `<div class="empty-state" style="grid-column:span 2; padding:30px 10px;"><p>Nessun dato per il grafico a ciambella.</p></div>`;
        return;
    }

    const grandTotal = entries.reduce((s, e) => s + e[1], 0) || 1;
    const radius = 72;
    const circumference = 2 * Math.PI * radius;
    let accumPct = 0;

    const circlesSvg = entries
        .map(([label, val], idx) => {
            const pct = val / grandTotal;
            const dash = pct * circumference;
            const offset = -accumPct * circumference;
            accumPct += pct;
            const color =
                mode === "category"
                    ? getAnalyticsCategoryColor(label)
                    : ANALYTICS_PALETTE[idx % ANALYTICS_PALETTE.length];
            return `<circle cx="100" cy="100" r="${radius}" fill="transparent" stroke="${color}" stroke-width="26" stroke-dasharray="${dash.toFixed(2)} ${circumference.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" />`;
        })
        .join("");

    const centerValue =
        metric === "qty" ? `${Math.round(grandTotal * 10) / 10}` : `${grandTotal.toFixed(2)}`;
    const centerUnit = metric === "qty" ? "Unità tot." : "CHF/€ tot.";

    const legendHtml = entries
        .map(([label, val], idx) => {
            const pct = ((val / grandTotal) * 100).toFixed(1);
            const color =
                mode === "category"
                    ? getAnalyticsCategoryColor(label)
                    : ANALYTICS_PALETTE[idx % ANALYTICS_PALETTE.length];
            const valFormatted =
                metric === "qty" ? `${Math.round(val * 100) / 100} u.` : `${val.toFixed(2)}`;
            const isActive =
                (mode === "category" && analyticsState.filterCategory === label) ||
                (mode === "supplier" &&
                    analyticsState.filterSupplier.toLowerCase() === label.toLowerCase());

            const clickHandler =
                mode === "category"
                    ? `toggleAnalyticsQuickFilter('category', '${escapeHtmlAttr(label)}')`
                    : `toggleAnalyticsQuickFilter('supplier', '${escapeHtmlAttr(label)}')`;

            return `
                <div class="an-legend-item ${isActive ? "is-active-filter" : ""}" onclick="${clickHandler}" title="Clicca per filtrare per ${escapeHtmlAttr(label)}">
                    <div class="an-legend-left">
                        <span class="an-legend-swatch" style="background:${color};"></span>
                        <span class="an-legend-name">${escapeHtml(label)}</span>
                    </div>
                    <div class="an-legend-right">
                        ${valFormatted}
                        <span class="an-legend-pct">${pct}%</span>
                    </div>
                </div>
            `;
        })
        .join("");

    container.innerHTML = `
        <div class="an-donut-svg-wrap">
            <svg width="200" height="200" viewBox="0 0 200 200">
                <g transform="rotate(-90 100 100)">
                    ${circlesSvg}
                </g>
                <circle cx="100" cy="100" r="54" fill="#ffffff" />
                <text x="100" y="96" text-anchor="middle" fill="#0f172a" font-size="16" font-weight="900">${centerValue}</text>
                <text x="100" y="115" text-anchor="middle" fill="#64748b" font-size="11" font-weight="700">${centerUnit}</text>
            </svg>
        </div>
        <div class="an-donut-legend">
            ${legendHtml}
        </div>
    `;
}

function toggleAnalyticsQuickFilter(kind, value) {
    if (kind === "category") {
        analyticsState.filterCategory = analyticsState.filterCategory === value ? "ALL" : value;
        const sel = document.getElementById("an-filter-category");
        if (sel) sel.value = analyticsState.filterCategory;
    } else if (kind === "supplier") {
        analyticsState.filterSupplier =
            analyticsState.filterSupplier.toLowerCase() === value.toLowerCase() ? "ALL" : value;
        const sel = document.getElementById("an-filter-supplier");
        if (sel) sel.value = analyticsState.filterSupplier;
    }
    renderAnalyticsDashboard();
}

function renderAnalyticsScatterChart(products) {
    const container = document.getElementById("an-chart-scatter");
    if (!container) return;

    const pts = products.filter((p) => p.totalQty > 0 && p.currentUnitPrice > 0).slice(0, 45);
    if (pts.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding:30px 10px;"><p>Inserisci prezzi unitari e quantità per visualizzare la matrice Quantità vs Prezzo.</p></div>`;
        return;
    }

    const w = 620;
    const h = 280;
    const padL = 52;
    const padR = 26;
    const padT = 22;
    const padB = 38;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    const maxQty = Math.max(...pts.map((p) => p.totalQty), 1) * 1.08;
    const maxPrice = Math.max(...pts.map((p) => p.currentUnitPrice), 1) * 1.1;
    const maxSpend = Math.max(...pts.map((p) => p.totalSpend), 1);

    const avgQty = pts.reduce((s, p) => s + p.totalQty, 0) / pts.length;
    const avgPrice = pts.reduce((s, p) => s + p.currentUnitPrice, 0) / pts.length;

    const xOf = (q) => padL + (q / maxQty) * plotW;
    const yOf = (pr) => padT + plotH - (pr / maxPrice) * plotH;

    const avgX = xOf(avgQty);
    const avgY = yOf(avgPrice);

    let gridSvg = "";
    for (let i = 0; i <= 4; i++) {
        const gy = padT + (plotH / 4) * i;
        const pVal = ((maxPrice * (4 - i)) / 4).toFixed(1);
        gridSvg += `
            <line x1="${padL}" y1="${gy}" x2="${w - padR}" y2="${gy}" stroke="#e2e8f0" stroke-dasharray="3 3" />
            <text x="${padL - 8}" y="${gy + 4}" text-anchor="end" font-size="10" font-weight="700" fill="#64748b">${pVal}</text>
        `;
        const gx = padL + (plotW / 4) * i;
        const qVal = Math.round(((maxQty * i) / 4) * 10) / 10;
        gridSvg += `
            <line x1="${gx}" y1="${padT}" x2="${gx}" y2="${padT + plotH}" stroke="#f1f5f9" />
            <text x="${gx}" y="${h - 14}" text-anchor="middle" font-size="10" font-weight="700" fill="#64748b">${qVal}</text>
        `;
    }

    const bubblesSvg = pts
        .map((p) => {
            const cx = xOf(p.totalQty);
            const cy = yOf(p.currentUnitPrice);
            const r = 6 + Math.sqrt(p.totalSpend / maxSpend) * 16;
            const col = getAnalyticsCategoryColor(p.category);
            const isFocused =
                analyticsState.focusProductName &&
                analyticsState.focusProductName.toLowerCase() === p.name.toLowerCase();
            const shortName = p.name.length > 14 ? p.name.slice(0, 12) + "…" : p.name;

            return `
                <g class="an-scatter-pt" style="cursor:pointer;" onclick="setAnalyticsFocusProduct('${escapeHtmlAttr(p.name)}')">
                    <title>${escapeHtml(p.name)} (${escapeHtml(p.category)})\nQuantità: ${Math.round(p.totalQty * 100) / 100} ${escapeHtml(p.unit)}\nPrezzo Unit.: ${p.currentUnitPrice.toFixed(2)}\nSpesa Totale: ${p.totalSpend.toFixed(2)}</title>
                    <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${col}" fill-opacity="${isFocused ? "0.95" : "0.68"}" stroke="${isFocused ? "#0f172a" : "#ffffff"}" stroke-width="${isFocused ? "2.5" : "1.5"}" />
                    <text x="${cx.toFixed(1)}" y="${(cy - r - 4).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#1e293b">${escapeHtml(shortName)}</text>
                </g>
            `;
        })
        .join("");

    container.innerHTML = `
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
            ${gridSvg}
            <!-- Linee medie dei quadranti -->
            <line x1="${avgX.toFixed(1)}" y1="${padT}" x2="${avgX.toFixed(1)}" y2="${padT + plotH}" stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="5 4" />
            <line x1="${padL}" y1="${avgY.toFixed(1)}" x2="${w - padR}" y2="${avgY.toFixed(1)}" stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="5 4" />
            <text x="${w - padR - 4}" y="${padT + 12}" text-anchor="end" font-size="9.5" font-weight="800" fill="#db2777">▲ Alta Q.tà & Alto Prezzo</text>
            <text x="${padL + plotW / 2}" y="${h - 2}" text-anchor="middle" font-size="10.5" font-weight="800" fill="#334155">Quantità Totale Acquistata →</text>
            <text x="13" y="${padT + plotH / 2}" text-anchor="middle" font-size="10.5" font-weight="800" fill="#334155" transform="rotate(-90 13 ${padT + plotH / 2})">Prezzo Unitario →</text>
            ${bubblesSvg}
        </svg>
    `;
}

function renderAnalyticsTrendChart(filteredRecords, products) {
    const container = document.getElementById("an-chart-trend");
    const titleEl = document.getElementById("an-trend-chart-title");
    const subEl = document.getElementById("an-trend-chart-subtitle");
    const clearBtn = document.getElementById("an-clear-focus-product-btn");
    if (!container) return;

    const focusName = analyticsState.focusProductName;
    const focusedProd = focusName
        ? products.find((p) => p.name.toLowerCase() === focusName.toLowerCase())
        : null;

    const w = 620;
    const h = 280;
    const padL = 52;
    const padR = 24;
    const padT = 24;
    const padB = 42;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;

    if (focusedProd && focusedProd.pricePoints.length > 0) {
        clearBtn?.classList.remove("hidden");
        if (titleEl) titleEl.textContent = `📈 Storico Prezzo Unitario: ${focusedProd.name}`;
        if (subEl) {
            subEl.textContent = `Prezzo Corrente: ${focusedProd.currentUnitPrice.toFixed(2)} • Min: ${focusedProd.minPrice.toFixed(2)} • Max: ${focusedProd.maxPrice.toFixed(2)}`;
        }

        const pts = [...focusedProd.pricePoints].sort((a, b) =>
            String(a.date).localeCompare(String(b.date))
        );
        const maxVal = Math.max(...pts.map((x) => x.price), 0.1) * 1.15;
        const minVal = Math.max(0, Math.min(...pts.map((x) => x.price)) * 0.85);
        const span = Math.max(maxVal - minVal, 0.5);

        const coords = pts.map((pt, idx) => {
            const x =
                pts.length === 1
                    ? padL + plotW / 2
                    : padL + (idx / (pts.length - 1)) * plotW;
            const y = padT + plotH - ((pt.price - minVal) / span) * plotH;
            return { x, y, ...pt };
        });

        const pathD = coords
            .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
            .join(" ");
        const areaD =
            coords.length > 1
                ? `${pathD} L${coords[coords.length - 1].x.toFixed(1)},${padT + plotH} L${coords[0].x.toFixed(1)},${padT + plotH} Z`
                : "";

        const dotsSvg = coords
            .map(
                (c) => `
                <g>
                    <title>${formatDateIT(c.date)} — ${escapeHtml(c.supplier)}: ${c.price.toFixed(2)} (Q.tà: ${c.qty})</title>
                    <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="5.5" fill="#ec4899" stroke="#ffffff" stroke-width="2" />
                    <text x="${c.x.toFixed(1)}" y="${(c.y - 10).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="800" fill="#831843">${c.price.toFixed(2)}</text>
                    <text x="${c.x.toFixed(1)}" y="${padT + plotH + 16}" text-anchor="middle" font-size="9" font-weight="700" fill="#64748b">${escapeHtml(String(c.date).slice(5))}</text>
                </g>
            `
            )
            .join("");

        container.innerHTML = `
            <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
                <defs>
                    <linearGradient id="anPinkGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#ec4899" stop-opacity="0.38" />
                        <stop offset="100%" stop-color="#ec4899" stop-opacity="0.02" />
                    </linearGradient>
                </defs>
                <line x1="${padL}" y1="${padT + plotH}" x2="${w - padR}" y2="${padT + plotH}" stroke="#cbd5e1" stroke-width="1.5" />
                ${areaD ? `<path d="${areaD}" fill="url(#anPinkGrad)" />` : ""}
                ${coords.length > 1 ? `<path d="${pathD}" fill="none" stroke="#db2777" stroke-width="3" stroke-linecap="round" />` : ""}
                ${dotsSvg}
            </svg>
        `;
        return;
    }

    clearBtn?.classList.add("hidden");
    const metric = analyticsState.primaryMetric === "qty" ? "qty" : "spend";
    if (titleEl) {
        titleEl.textContent =
            metric === "qty"
                ? "📈 Andamento Temporale Quantità Acquistate"
                : "📈 Andamento Temporale Spesa (CHF/€)";
    }
    if (subEl) {
        subEl.textContent =
            "Evoluzione per data di spesa (clicca su un prodotto nella classifica o tabella per vedere lo storico del suo prezzo)";
    }

    const byDate = new Map();
    for (const r of filteredRecords) {
        const d = String(r.date || "").slice(0, 10);
        if (!d) continue;
        byDate.set(d, (byDate.get(d) || 0) + (metric === "qty" ? r.qty : r.spend));
    }

    const series = Array.from(byDate.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-18);

    if (series.length === 0) {
        container.innerHTML = `<div class="empty-state" style="padding:30px 10px;"><p>Nessuna data disponibile per il grafico temporale.</p></div>`;
        return;
    }

    const maxVal = Math.max(...series.map((s) => s[1]), 1) * 1.12;
    const coords = series.map(([d, v], idx) => {
        const x =
            series.length === 1
                ? padL + plotW / 2
                : padL + (idx / (series.length - 1)) * plotW;
        const y = padT + plotH - (v / maxVal) * plotH;
        return { x, y, date: d, val: v };
    });

    const pathD = coords
        .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
        .join(" ");
    const areaD =
        coords.length > 1
            ? `${pathD} L${coords[coords.length - 1].x.toFixed(1)},${padT + plotH} L${coords[0].x.toFixed(1)},${padT + plotH} Z`
            : "";

    let gridSvg = "";
    for (let i = 0; i <= 4; i++) {
        const gy = padT + (plotH / 4) * i;
        const vLabel = ((maxVal * (4 - i)) / 4).toFixed(metric === "qty" ? 0 : 1);
        gridSvg += `
            <line x1="${padL}" y1="${gy}" x2="${w - padR}" y2="${gy}" stroke="#e2e8f0" stroke-dasharray="3 3" />
            <text x="${padL - 8}" y="${gy + 4}" text-anchor="end" font-size="10" font-weight="700" fill="#64748b">${vLabel}</text>
        `;
    }

    const dotsSvg = coords
        .map(
            (c) => `
            <g>
                <title>${formatDateIT(c.date)}: ${metric === "qty" ? Math.round(c.val * 100) / 100 + " unità" : c.val.toFixed(2) + " CHF/€"}</title>
                <circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="5" fill="#2563eb" stroke="#ffffff" stroke-width="2" />
                <text x="${c.x.toFixed(1)}" y="${(c.y - 9).toFixed(1)}" text-anchor="middle" font-size="9.5" font-weight="800" fill="#1e3a8a">${metric === "qty" ? Math.round(c.val * 10) / 10 : c.val.toFixed(1)}</text>
                <text x="${c.x.toFixed(1)}" y="${padT + plotH + 16}" text-anchor="middle" font-size="9" font-weight="700" fill="#64748b">${escapeHtml(c.date.slice(5))}</text>
            </g>
        `
        )
        .join("");

    container.innerHTML = `
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
            <defs>
                <linearGradient id="anBlueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#2563eb" stop-opacity="0.36" />
                    <stop offset="100%" stop-color="#7c3aed" stop-opacity="0.02" />
                </linearGradient>
            </defs>
            ${gridSvg}
            ${areaD ? `<path d="${areaD}" fill="url(#anBlueGrad)" />` : ""}
            ${coords.length > 1 ? `<path d="${pathD}" fill="none" stroke="#2563eb" stroke-width="3" stroke-linecap="round" />` : ""}
            ${dotsSvg}
        </svg>
    `;
}

function renderAnalyticsProductsTable(products, totalSpend, totalQty) {
    const tbody = document.getElementById("an-products-tbody");
    const countEl = document.getElementById("an-table-count");
    if (countEl) countEl.textContent = String(products.length);
    if (!tbody) return;

    // Aggiorna frecce di ordinamento nelle intestazioni
    const sortBy = analyticsState.sortBy || "spend_desc";
    const indMap = {
        name: sortBy === "name_asc" ? "▲" : sortBy === "name_desc" ? "▼" : "",
        qty: sortBy === "qty_desc" ? "▼" : sortBy === "qty_asc" ? "▲" : "",
        freq: sortBy === "freq_desc" ? "▼" : "",
        unit: sortBy === "unit_desc" ? "▼" : sortBy === "unit_asc" ? "▲" : "",
        avg: sortBy === "avg_desc" ? "▼" : "",
        spend: sortBy === "spend_desc" ? "▼" : sortBy === "spend_asc" ? "▲" : "",
    };
    Object.entries(indMap).forEach(([k, sym]) => {
        const el = document.getElementById(`an-sort-ind-${k}`);
        if (el) el.textContent = sym;
    });

    if (products.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center; padding:32px; color:#64748b; font-weight:700;">
                    Nessun prodotto trovato con i filtri attuali. Prova ad allargare i filtri o clicca su "↺ Reset Filtri".
                </td>
            </tr>
        `;
        return;
    }

    const maxSpend = Math.max(...products.map((p) => p.totalSpend), 0.01);
    const maxQty = Math.max(...products.map((p) => p.totalQty), 0.01);

    tbody.innerHTML = products
        .map((p, idx) => {
            const rank = idx + 1;
            const medal = rank === 1 ? "🥇 " : rank === 2 ? "🥈 " : rank === 3 ? "🥉 " : "";
            const catColor = getAnalyticsCategoryColor(p.category);
            const spendPctOfMax = Math.max(3, Math.min(100, (p.totalSpend / maxSpend) * 100));
            const qtyPctOfMax = Math.max(3, Math.min(100, (p.totalQty / maxQty) * 100));
            const shareOfTotal = totalSpend > 0 ? ((p.totalSpend / totalSpend) * 100).toFixed(1) : "0.0";

            const supChipsHtml = Array.from(p.suppliers.entries())
                .map(([sName, sInfo]) => {
                    const prTxt = sInfo.lastPrice > 0 ? `${sInfo.lastPrice.toFixed(2)}` : "—";
                    return `<span class="an-sup-chip">🏪 ${escapeHtml(sName)}: <strong>${prTxt}</strong></span>`;
                })
                .join("");

            let deltaBadge = "";
            if (p.currentUnitPrice > 0 && p.avgUnitPrice > 0) {
                const diff = p.currentUnitPrice - p.avgUnitPrice;
                if (diff > 0.02) {
                    deltaBadge = `<div class="an-price-delta-up">▲ +${diff.toFixed(2)} vs media</div>`;
                } else if (diff < -0.02) {
                    deltaBadge = `<div class="an-price-delta-down">▼ ${diff.toFixed(2)} vs media</div>`;
                }
            }

            const isFocused =
                analyticsState.focusProductName &&
                analyticsState.focusProductName.toLowerCase() === p.name.toLowerCase();

            return `
                <tr class="${isFocused ? "is-focused-row" : ""}" onclick="setAnalyticsFocusProduct('${escapeHtmlAttr(p.name)}')">
                    <td style="font-weight:900; color:#475569;">${medal}#${rank}</td>
                    <td>
                        <div style="font-weight:800; color:#0f172a; font-size:0.92rem;">${escapeHtml(p.name)}</div>
                        <span class="an-cat-badge" style="background:${catColor};">${escapeHtml(p.category)}</span>
                    </td>
                    <td>
                        <div class="an-sup-chips">${supChipsHtml || "—"}</div>
                    </td>
                    <td class="num-col">
                        <strong style="font-size:0.94rem; color:#4f46e5;">${Math.round(p.totalQty * 100) / 100}</strong>
                        <span style="font-size:0.75rem; color:#64748b;">${escapeHtml(p.unit)}</span>
                        <div class="an-inline-progress"><div class="an-inline-fill-qty" style="width:${qtyPctOfMax.toFixed(1)}%;"></div></div>
                    </td>
                    <td class="num-col">
                        <strong>${p.freq}×</strong>
                        <div style="font-size:0.72rem; color:#64748b;">${p.latestDate ? formatDateIT(p.latestDate) : "—"}</div>
                    </td>
                    <td class="num-col">
                        <strong style="font-size:0.94rem; color:#0f172a;">${p.currentUnitPrice > 0 ? p.currentUnitPrice.toFixed(2) : "—"}</strong>
                        ${deltaBadge}
                    </td>
                    <td class="num-col">
                        <strong>${p.avgUnitPrice > 0 ? p.avgUnitPrice.toFixed(2) : "—"}</strong>
                        <div style="font-size:0.71rem; color:#64748b;">Min ${p.minPrice.toFixed(2)} / Max ${p.maxPrice.toFixed(2)}</div>
                    </td>
                    <td class="num-col">
                        <strong style="font-size:0.98rem; color:#0f172a;">${p.totalSpend.toFixed(2)} CHF/€</strong>
                        <span class="an-legend-pct">${shareOfTotal}%</span>
                        <div class="an-inline-progress"><div class="an-inline-fill-spend" style="width:${spendPctOfMax.toFixed(1)}%;"></div></div>
                    </td>
                </tr>
            `;
        })
        .join("");
}



