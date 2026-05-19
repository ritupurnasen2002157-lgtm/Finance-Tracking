/* Personal Finance Tracker (Indian)
   - LocalStorage persistence
   - Expense CRUD
   - Budget tracking
   - Category + search filtering
   - Charts via Chart.js
   - Optional: dark/light toggle
*/

(() => {
  'use strict';

  // ---------- Helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const LS_KEYS = {
    expenses: 'pft_expenses_v1',
    budget: 'pft_budget_v1',
    theme: 'pft_theme_v1',
  };

  const currencyINR = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  });

  function uid() {
    // stable enough for local app
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function safeNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function monthKeyFromInput(monthStr) {
    // input value is YYYY-MM
    return monthStr || new Date().toISOString().slice(0, 7);
  }

  function parseDateToISO(dateStr) {
    // dateStr from <input type="date"> is YYYY-MM-DD
    // keep as-is (lexicographically sortable)
    return dateStr;
  }

  function getMonthFromISODate(isoDate) {
    // isoDate: YYYY-MM-DD
    return isoDate ? isoDate.slice(0, 7) : '';
  }

  function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function toCSV(rows) {
    // rows: array of arrays
    const esc = (cell) => {
      const s = String(cell ?? '');
      // escape quotes
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    return rows.map((r) => r.map(esc).join(',')).join('\n');
  }

  // ---------- State ----------
  let state = {
    expenses: [], // {id, title, amount, category, date}
    budget: { month: '', amount: 0 }, // per month
    filters: {
      search: '',
      category: 'All',
    },
    edit: {
      id: null,
    },
    charts: {
      categoryChart: null,
      dailyChart: null,
    },
  };

  // ---------- Storage ----------
  function loadState() {
    try {
      const ex = JSON.parse(localStorage.getItem(LS_KEYS.expenses) || '[]');
      state.expenses = Array.isArray(ex) ? ex : [];
    } catch {
      state.expenses = [];
    }

    try {
      const b = JSON.parse(localStorage.getItem(LS_KEYS.budget) || 'null');
      if (b && typeof b === 'object') {
        state.budget = {
          month: typeof b.month === 'string' ? b.month : new Date().toISOString().slice(0, 7),
          amount: safeNumber(b.amount),
        };
      } else {
        state.budget = { month: new Date().toISOString().slice(0, 7), amount: 0 };
      }
    } catch {
      state.budget = { month: new Date().toISOString().slice(0, 7), amount: 0 };
    }
  }

  function saveExpenses() {
    localStorage.setItem(LS_KEYS.expenses, JSON.stringify(state.expenses));
  }

  function saveBudget() {
    localStorage.setItem(LS_KEYS.budget, JSON.stringify(state.budget));
  }

  // ---------- Theme ----------
  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'light') root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');
  }

  function initTheme() {
    const saved = localStorage.getItem(LS_KEYS.theme);
    const theme = saved === 'light' ? 'light' : 'dark';
    applyTheme(theme);
    const toggle = $('#themeToggle');
    if (!toggle) return;

    toggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
      const next = current === 'light' ? 'dark' : 'light';
      localStorage.setItem(LS_KEYS.theme, next);
      applyTheme(next);
      // update button icon
      toggle.textContent = next === 'light' ? '🌞' : '🌓';
    });

    toggle.textContent = theme === 'light' ? '🌞' : '🌓';
  }

  // ---------- Elements ----------
  const monthPicker = $('#monthPicker');
  const remainingBudgetEl = $('#remainingBudget');
  const summaryCardsEl = $('#summaryCards');

  const budgetForm = $('#budgetForm');
  const budgetAmountEl = $('#budgetAmount');

  const expenseForm = $('#expenseForm');
  const expenseTitleEl = $('#expenseTitle');
  const expenseAmountEl = $('#expenseAmount');
  const expenseCategoryEl = $('#expenseCategory');
  const expenseDateEl = $('#expenseDate');

  const cancelEditBtn = $('#cancelEditBtn');
  const exportCsvBtn = $('#exportCsvBtn');

  const searchInput = $('#searchInput');
  const categoryFilterEl = $('#categoryFilter');
  const resultCountEl = $('#resultCount');
  const emptyStateEl = $('#emptyState');
  const expenseTbody = $('#expenseTbody');

  // ---------- Derived data ----------
  function getActiveMonth() {
    return monthKeyFromInput(monthPicker?.value);
  }

  function getExpensesForActiveMonth() {
    const active = getActiveMonth();
    return state.expenses.filter((e) => getMonthFromISODate(e.date) === active);
  }

  function getFilteredExpenses() {
    const list = getExpensesForActiveMonth();
    const q = (state.filters.search || '').trim().toLowerCase();
    const cat = state.filters.category;

    return list.filter((e) => {
      const matchesCat = cat === 'All' ? true : e.category === cat;
      const matchesQ = !q
        ? true
        : `${e.title} ${e.category}`.toLowerCase().includes(q);
      return matchesCat && matchesQ;
    });
  }

  function computeTotals() {
    const list = getExpensesForActiveMonth();
    const totalSpent = list.reduce((sum, e) => sum + safeNumber(e.amount), 0);
    const budget = state.budget.month === getActiveMonth() ? safeNumber(state.budget.amount) : 0;
    const remaining = budget - totalSpent;

    return { totalSpent, budget, remaining };
  }

  function normalizeCategoryList(expenses) {
    const set = new Set(expenses.map((e) => e.category));
    const all = ['Food', 'Travel', 'Shopping', 'Bills', 'Health', 'Education', 'Entertainment', 'Other'];
    // keep ordering for nicer UX
    return all.filter((c) => set.has(c)).sort((a, b) => a.localeCompare(b, 'en'));
  }

  // ---------- Rendering ----------
  function renderSummary() {
    const { totalSpent, budget, remaining } = computeTotals();

    const cards = [
      { label: 'Total Spent', value: currencyINR.format(totalSpent), sub: `This month` },
      { label: 'Monthly Budget', value: currencyINR.format(budget), sub: state.budget.month === getActiveMonth() ? 'Set by you' : 'Not set for this month' },
      { label: 'Remaining', value: currencyINR.format(remaining), sub: remaining >= 0 ? 'On track' : 'Over budget' },
    ];

    summaryCardsEl.innerHTML = cards
      .map(
        (c) => `
      <div class="stat">
        <div class="label">${c.label}</div>
        <div class="value">${c.value}</div>
        <div class="sub">${c.sub}</div>
      </div>
    `
      )
      .join('');

    remainingBudgetEl.textContent = currencyINR.format(remaining);
  }

  function renderCategoryOptions() {
    const list = getExpensesForActiveMonth();
    const categories = normalizeCategoryList(list);

    // keep All + categories found (still allow selecting categories even if none in filtered list)
    categoryFilterEl.innerHTML = '<option value="All">All</option>' +
      categories.map((c) => `<option value="${c}">${c}</option>`).join('');

    // If current category disappears due to month change, reset
    if (state.filters.category !== 'All') {
      const stillExists = categories.includes(state.filters.category);
      if (!stillExists) state.filters.category = 'All';
    }
    categoryFilterEl.value = state.filters.category;
  }

  function renderExpenseList() {
    const filtered = getFilteredExpenses();
    const totalForMonth = getExpensesForActiveMonth().length;

    resultCountEl.textContent = `${filtered.length} of ${totalForMonth} item(s)`;

    emptyStateEl.hidden = filtered.length !== 0;

    if (!filtered.length) {
      expenseTbody.innerHTML = '';
      return;
    }

    // Use document fragment to reduce reflow
    const frag = document.createDocumentFragment();

    for (const e of filtered) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div style="font-weight:900;">${escapeHTML(e.title)}</div>
        </td>
        <td>${escapeHTML(e.category)}</td>
        <td>${escapeHTML(e.date)}</td>
        <td style="text-align:right; font-weight:900;">${currencyINR.format(safeNumber(e.amount))}</td>
        <td style="text-align:right;">
          <div class="action-btns">
            <button class="icon-btn" data-action="edit" data-id="${e.id}" title="Edit">✏️</button>
            <button class="icon-btn danger" data-action="delete" data-id="${e.id}" title="Delete">🗑️</button>
          </div>
        </td>
      `;
      frag.appendChild(tr);
    }

    expenseTbody.innerHTML = '';
    expenseTbody.appendChild(frag);
  }

  function escapeHTML(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '<')
      .replaceAll('>', '>')
      .replaceAll('"', '"')
      .replaceAll("'", '&#039;');
  }

  function renderCharts() {
    if (typeof Chart === 'undefined') {
      $('#chartMeta').textContent = 'Chart library not loaded.';
      return;
    }

    const monthExpenses = getExpensesForActiveMonth();

    // If no data, clear charts
    if (!monthExpenses.length) {
      if (state.charts.categoryChart) state.charts.categoryChart.destroy();
      if (state.charts.dailyChart) state.charts.dailyChart.destroy();
      state.charts.categoryChart = null;
      state.charts.dailyChart = null;

      $('#categoryLegend').innerHTML = '';
      $('#dailyLegend').innerHTML = '';
      $('#chartMeta').textContent = 'Add a few expenses to see charts.';
      return;
    }

    $('#chartMeta').textContent = 'For selected month.';

    // Category distribution (pie/doughnut)
    const catMap = new Map();
    for (const e of monthExpenses) {
      catMap.set(e.category, (catMap.get(e.category) || 0) + safeNumber(e.amount));
    }
    const catLabels = [...catMap.keys()];
    const catValues = catLabels.map((k) => catMap.get(k));

    const palette = [
      '#4f8cff', '#2fe4ab', '#ffb020', '#ff5c7a', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16'
    ];

    const catColors = catLabels.map((_, i) => palette[i % palette.length]);

    const categoryCtx = $('#categoryChart');
    const dailyCtx = $('#dailyChart');

    if (state.charts.categoryChart) state.charts.categoryChart.destroy();
    state.charts.categoryChart = new Chart(categoryCtx, {
      type: 'doughnut',
      data: {
        labels: catLabels,
        datasets: [
          {
            data: catValues,
            backgroundColor: catColors,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const label = ctx.label || '';
                const val = safeNumber(ctx.parsed);
                return `${label}: ${currencyINR.format(val)}`;
              },
            },
          },
        },
      },
    });

    // Legend
    $('#categoryLegend').innerHTML = catLabels
      .map(
        (lab, i) => `
        <div class="legend-item">
          <span class="legend-swatch" style="background:${catColors[i]}"></span>
          <span>${escapeHTML(lab)}</span>
        </div>`
      )
      .join('');

    // Daily spending (bar)
    // Group by date
    const dayMap = new Map();
    for (const e of monthExpenses) {
      dayMap.set(e.date, (dayMap.get(e.date) || 0) + safeNumber(e.amount));
    }

    const dayLabels = [...dayMap.keys()].sort();
    const dayValues = dayLabels.map((d) => dayMap.get(d));

    // Keep labels short for readability on mobile
    const shortLabels = dayLabels.map((d) => d.slice(8, 10)); // DD

    if (state.charts.dailyChart) state.charts.dailyChart.destroy();
    state.charts.dailyChart = new Chart(dailyCtx, {
      type: 'bar',
      data: {
        labels: shortLabels,
        datasets: [
          {
            label: 'Daily spend',
            data: dayValues,
            backgroundColor: '#4f8cff',
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const val = safeNumber(ctx.parsed.y ?? ctx.parsed);
                return ` ${currencyINR.format(val)}`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { maxRotation: 0, autoSkip: true },
          },
          y: {
            ticks: {
              callback: (v) => {
                // keep compact
                const n = safeNumber(v);
                if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
                if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
                return `₹${Math.round(n)}`;
              },
            },
          },
        },
      },
    });

    $('#dailyLegend').innerHTML = `<div class="muted small">Shows total spend per day (₹).</div>`;
  }

  // ---------- CRUD ----------
  function resetExpenseForm() {
    state.edit.id = null;
    expenseForm.reset();

    // default date to today
    const today = new Date();
    const iso = today.toISOString().slice(0, 10);
    expenseDateEl.value = iso;

    cancelEditBtn.hidden = true;
    $('#addExpenseBtn').textContent = 'Add Expense';
    expenseTitleEl.focus();
  }

  function setFormForEdit(exp) {
    state.edit.id = exp.id;
    expenseTitleEl.value = exp.title;
    expenseAmountEl.value = exp.amount;
    expenseCategoryEl.value = exp.category;
    expenseDateEl.value = exp.date;

    cancelEditBtn.hidden = false;
    $('#addExpenseBtn').textContent = 'Update Expense';
    expenseTitleEl.focus();
  }

  function validateExpenseInput() {
    const title = (expenseTitleEl.value || '').trim();
    const amount = safeNumber(expenseAmountEl.value);
    const category = expenseCategoryEl.value;
    const date = parseDateToISO(expenseDateEl.value);

    if (!title) return { ok: false, msg: 'Title is required.' };
    if (!(amount > 0)) return { ok: false, msg: 'Amount must be greater than 0.' };
    if (!category) return { ok: false, msg: 'Category is required.' };
    if (!date) return { ok: false, msg: 'Date is required.' };

    return { ok: true, value: { title, amount, category, date } };
  }

  function onSubmitExpense(e) {
    e.preventDefault();

    const v = validateExpenseInput();
    if (!v.ok) {
      alert(v.msg);
      return;
    }

    if (state.edit.id) {
      const idx = state.expenses.findIndex((x) => x.id === state.edit.id);
      if (idx >= 0) {
        state.expenses[idx] = { ...state.expenses[idx], ...v.value };
      }
    } else {
      state.expenses.unshift({ id: uid(), ...v.value });
    }

    saveExpenses();
    resetExpenseForm();

    // rerender everything that depends on month + filters
    renderCategoryOptions();
    renderSummary();
    renderExpenseList();
    renderCharts();
  }

  function deleteExpense(id) {
    state.expenses = state.expenses.filter((e) => e.id !== id);
    saveExpenses();

    if (state.edit.id === id) resetExpenseForm();

    renderCategoryOptions();
    renderSummary();
    renderExpenseList();
    renderCharts();
  }

  function handleExpenseTableClick(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id');
    const exp = state.expenses.find((x) => x.id === id);

    if (!exp) return;

    if (action === 'edit') {
      setFormForEdit(exp);
    } else if (action === 'delete') {
      const ok = confirm('Delete this expense?');
      if (ok) deleteExpense(id);
    }
  }

  // ---------- Budget ----------
  function onSubmitBudget(e) {
    e.preventDefault();

    const amount = safeNumber(budgetAmountEl.value);
    if (!(amount >= 0)) {
      alert('Budget amount must be 0 or more.');
      return;
    }

    state.budget = {
      month: getActiveMonth(),
      amount,
    };

    saveBudget();
    budgetForm.reset();

    renderSummary();
    renderExpenseList();
    renderCharts();
  }

  // ---------- CSV Export ----------
  function exportCSV() {
    const rows = [
      ['Title', 'Category', 'Date', 'Amount (INR)'],
    ];

    const monthExpenses = getExpensesForActiveMonth();
    const filtered = getFilteredExpenses();

    // Export respects filters/search/category for better UX
    const exportList = filtered.length ? filtered : monthExpenses;

    for (const e of exportList) {
      rows.push([e.title, e.category, e.date, e.amount]);
    }

    const csv = toCSV(rows);
    downloadTextFile(`Indian_Finance_Tracker_${getActiveMonth()}.csv`, csv);
  }

  // ---------- Init / Events ----------
  function init() {
    loadState();
    initTheme();

    // month picker defaults
    const activeMonth = getActiveMonth();
    if (monthPicker) {
      monthPicker.value = activeMonth;
      // show current budget amount if same month
      if (state.budget.month === activeMonth) {
        budgetAmountEl.value = state.budget.amount;
      }
    }

    // date default
    const today = new Date();
    expenseDateEl.value = today.toISOString().slice(0, 10);

    // render first time
    renderCategoryOptions();
    renderSummary();
    renderExpenseList();
    renderCharts();

    // events
    expenseForm.addEventListener('submit', onSubmitExpense);
    cancelEditBtn.addEventListener('click', resetExpenseForm);

    budgetForm.addEventListener('submit', onSubmitBudget);

    exportCsvBtn.addEventListener('click', exportCSV);

    // table delegation
    expenseTbody.addEventListener('click', handleExpenseTableClick);

    // filtering
    searchInput.addEventListener('input', () => {
      state.filters.search = searchInput.value;
      renderExpenseList();
      renderCharts();
    });

    categoryFilterEl.addEventListener('change', () => {
      state.filters.category = categoryFilterEl.value;
      renderExpenseList();
      renderCharts();
    });

    // month change
    if (monthPicker) {
      monthPicker.addEventListener('change', () => {
        const m = getActiveMonth();
        // update budget input field for that month
        budgetAmountEl.value = state.budget.month === m ? state.budget.amount : '';
        state.filters.search = searchInput.value = '';
        state.filters.category = categoryFilterEl.value = 'All';

        renderCategoryOptions();
        renderSummary();
        renderExpenseList();
        renderCharts();
        resetExpenseForm();
      });
    }

    // initial category filter
    state.filters.category = 'All';
    state.filters.search = '';
  }

  // start
  init();
})();

