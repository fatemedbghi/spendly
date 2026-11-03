const STORAGE_KEY = "spendly.web.v1";

const META_COLUMNS = new Set([
  "category",
  "total",
  "total (cad)",
  "share of total",
  "share of total (%)",
  "share",
  "%",
]);

/** Months run light → dark so the most recent month reads strongest. */
const MONTH_RAMP = ["#f3cdb8", "#e69c86", "#a95a74"];

const CATEGORY_COLORS = [
  "#e8907e",
  "#f2b66d",
  "#86b89a",
  "#8fb3dc",
  "#b59ad8",
  "#e9c75f",
  "#d891b5",
  "#6fbfb4",
  "#c9a27e",
  "#a3a8d9",
];
const INK_RGB = [61, 47, 43];
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function monthColor(index, count = state.months.length) {
  if (count <= 1) return MONTH_RAMP[MONTH_RAMP.length - 1];
  const t = (index / (count - 1)) * (MONTH_RAMP.length - 1);
  const seg = Math.min(Math.floor(t), MONTH_RAMP.length - 2);
  const local = t - seg;
  const a = hexToRgb(MONTH_RAMP[seg]);
  const b = hexToRgb(MONTH_RAMP[seg + 1]);
  const mix = a.map((v, i) => Math.round(v + (b[i] - v) * local));
  return `rgb(${mix.join(",")})`;
}

/** Beyond the base palette, reuse it deeper, then lighter, so pastels stay distinguishable. */
function categoryColor(index) {
  const base = hexToRgb(CATEGORY_COLORS[index % CATEGORY_COLORS.length]);
  const round = Math.floor(index / CATEGORY_COLORS.length);
  if (round === 0) return CATEGORY_COLORS[index];
  const toward = round % 2 === 1 ? INK_RGB : [255, 255, 255];
  const amount = round % 2 === 1 ? 0.25 : 0.4;
  const mix = base.map((v, i) => Math.round(v + (toward[i] - v) * amount));
  return `rgb(${mix.join(",")})`;
}

const els = {
  status: document.getElementById("status-line"),
  input: document.getElementById("csv-input"),
  reset: document.getElementById("reset-btn"),
  welcome: document.getElementById("welcome"),
  entryOpen: document.getElementById("entry-open"),
  entryDrawer: document.getElementById("entry-drawer"),
  entryForm: document.getElementById("entry-form"),
  entryError: document.getElementById("entry-error"),
  entryCategories: document.getElementById("entry-categories"),
  exportBtn: document.getElementById("export-btn"),
  dropzone: document.getElementById("dropzone"),
  stats: document.getElementById("stats"),
  chartsPanel: document.getElementById("charts-panel"),
  categoryPanel: document.getElementById("category-panel"),
  comparePanel: document.getElementById("compare-panel"),
  tablePanel: document.getElementById("table-panel"),
  paymentsPanel: document.getElementById("payments-panel"),
  paymentsList: document.getElementById("payments-list"),
  paymentsMonth: document.getElementById("payments-month"),
  paymentsCaption: document.getElementById("payments-caption"),
  tabs: document.getElementById("tabs"),
  incomePanel: document.getElementById("income-panel"),
  incomeMonth: document.getElementById("income-month"),
  incomeCaption: document.getElementById("income-caption"),
  incomeSummary: document.getElementById("income-summary"),
  incomeSources: document.getElementById("income-sources"),
  depositsList: document.getElementById("deposits-list"),
  monthChart: document.getElementById("month-chart"),
  monthChartTitle: document.getElementById("month-chart-title"),
  monthChartLegend: document.getElementById("month-chart-legend"),
  shareChart: document.getElementById("share-chart"),
  monthLegend: document.getElementById("month-legend"),
  compareChart: document.getElementById("compare-chart"),
  compareCount: document.getElementById("compare-count"),
  compareSort: document.getElementById("compare-sort"),
  compareFrom: document.getElementById("compare-from"),
  compareTo: document.getElementById("compare-to"),
  rankList: document.getElementById("rank-list"),
  rankCaption: document.getElementById("rank-caption"),
  tableFrom: document.getElementById("table-from"),
  tableTo: document.getElementById("table-to"),
  shareMonth: document.getElementById("share-month"),
  drawer: document.getElementById("drawer"),
  drawerTitle: document.getElementById("drawer-title"),
  drawerScope: document.getElementById("drawer-scope"),
  drawerMonths: document.getElementById("drawer-months"),
  drawerBody: document.getElementById("drawer-body"),
  drawerClose: document.getElementById("drawer-close"),
  tableHead: document.querySelector("#spend-table thead"),
  tableBody: document.querySelector("#spend-table tbody"),
};

/**
 * @typedef {{ date: string, month: string, merchant: string, category: string, type: string,
 *   amount: number, statement: number|null, adjustment: number, review: string, notes: string }} Txn
 * @typedef {{ date: string, month: string, source: string, description: string, amount: number, notes: string }} Deposit
 * @type {{ months: string[], rows: Record<string, number>[], categories: string[], sources: string[], transactions: Txn[],
 *   income: Record<string, Record<string, number>>, deposits: Deposit[] }}
 */
let state = emptyState();

function emptyState() {
  return { months: [], rows: [], categories: [], sources: [], transactions: [], income: {}, deposits: [] };
}

function money(n) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 2,
  }).format(n || 0);
}

function pct(n) {
  return `${(n || 0).toFixed(2)}%`;
}

function setStatus(message, kind = "") {
  const isError = kind === "err";
  els.status.hidden = !isError;
  els.status.textContent = isError ? message : "";
  els.status.className = `hint${kind ? ` ${kind}` : ""}`;
}

function normalizeHeader(h) {
  return String(h || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase();
}

function cleanMonthLabel(header) {
  return String(header || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .replace(/\s*\((cad|usd|eur|gbp)\)\s*$/i, "")
    .replace(/\s*total\s*$/i, "")
    .trim();
}

function isMetaHeader(header) {
  const n = normalizeHeader(header);
  if (META_COLUMNS.has(n)) return true;
  if (n.startsWith("total")) return true;
  if (n.startsWith("share")) return true;
  if (n.startsWith("average") || n.startsWith("avg")) return true;
  return false;
}

function isMonthHeader(header) {
  if (isMetaHeader(header)) return false;
  const n = normalizeHeader(header);
  if (n === "category" || n === "amount" || n === "month") return false;
  return /[a-z]{3,}|\d{4}/i.test(header);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    if (row.some((c) => String(c).trim() !== "")) rows.push(row);
    row = [];
  };

  const src = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushCell();
    } else if (ch === "\n") {
      pushCell();
      pushRow();
    } else if (ch === "\r") {
      // ignore
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    pushCell();
    pushRow();
  }
  return rows;
}

function toNumber(value) {
  if (value == null || value === "") return 0;
  const cleaned = String(value)
    .replace(/[$£€,\s]/g, "")
    .replace(/\((.*)\)/, "-$1");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function monthSortKey(label) {
  const cleaned = cleanMonthLabel(label);
  const iso = cleaned.match(/^(\d{4})-(\d{1,2})$/);
  if (iso) return Number(iso[1]) * 100 + Number(iso[2]);

  const named = cleaned.match(
    /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})$/i
  );
  if (named) {
    const map = {
      jan: 1,
      january: 1,
      feb: 2,
      february: 2,
      mar: 3,
      march: 3,
      apr: 4,
      april: 4,
      may: 5,
      jun: 6,
      june: 6,
      jul: 7,
      july: 7,
      aug: 8,
      august: 8,
      sep: 9,
      sept: 9,
      september: 9,
      oct: 10,
      october: 10,
      nov: 11,
      november: 11,
      dec: 12,
      december: 12,
    };
    return Number(named[2]) * 100 + (map[named[1].toLowerCase()] || 0);
  }
  return cleaned.toLowerCase();
}

function sortMonths(months) {
  return [...months].sort((a, b) => {
    const ka = monthSortKey(a);
    const kb = monthSortKey(b);
    if (ka < kb) return -1;
    if (ka > kb) return 1;
    return 0;
  });
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Accepts ISO strings, YYYY-MM-DD, M/D/YYYY, or Excel serial numbers. */
function parseDateValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const d = new Date(Math.round((value - 25569) * 86400000));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return { y: +m[3], m: +m[1], d: +m[2] };
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
}

/** "2025-07" → "July 2025"; anything else → "". */
function isoMonthLabel(value) {
  const m = String(value ?? "").trim().match(/^(\d{4})-(\d{1,2})$/);
  if (!m || +m[2] < 1 || +m[2] > 12) return "";
  return `${MONTH_NAMES[+m[2] - 1]} ${m[1]}`;
}

function findHeaderRow(grid) {
  const limit = Math.min(grid.length, 25);
  for (let i = 0; i < limit; i++) {
    const norm = (grid[i] || []).map(normalizeHeader);
    if (norm.includes("category") || norm.includes("categories")) return i;
  }
  return -1;
}

function extractMatrix(csvText, hint = {}) {
  return extractMatrixFromGrid(parseCsv(csvText), hint);
}

function extractMatrixFromGrid(grid, hint = {}) {
  if (!grid.length) throw new Error("The file is empty");

  const headerIdx = findHeaderRow(grid);
  if (headerIdx === -1) {
    throw new Error('Missing a "Category" column');
  }
  const headers = grid[headerIdx].map((h) => String(h ?? "").replace(/^\uFEFF/, "").trim());
  const norm = headers.map(normalizeHeader);
  const body = grid.slice(headerIdx + 1);
  const find = (...names) => norm.findIndex((h) => names.includes(h));

  const catIdx = find("category", "categories");
  const monthIdx = find("month", "period");
  const allocationIdx = find("allocation month");
  const dateIdx = find("date", "transaction date", "posted date");
  const countedIdx = find("counted spending");
  const amountIdx =
    countedIdx !== -1 ? countedIdx : find("amount", "spend", "spent", "value", "cad");

  const byCategory = new Map();
  const months = new Set();

  const ensure = (category) => {
    const key = String(category ?? "").trim();
    if (!key) return null;
    if (/^total$/i.test(key)) return null;
    if (!byCategory.has(key)) byCategory.set(key, {});
    return key;
  };

  if (dateIdx !== -1 && amountIdx !== -1) {
    const col = (...names) => find(...names);
    const merchantIdx = col("merchant / recipient", "merchant", "description", "payee", "recipient", "name");
    const typeIdx = col("type");
    const treatmentIdx = col("treatment");
    const reviewIdx = col("review");
    const notesIdx = col("notes", "note", "memo");
    const statementIdx = col("statement amount");
    const adjustmentIdx = col("adjustment");
    const cell = (row, idx) => (idx === -1 ? "" : String(row[idx] ?? "").trim());

    const transactions = [];
    for (const row of body) {
      const date = parseDateValue(row[dateIdx]);
      if (!date) continue;
      if (/^excluded/i.test(cell(row, treatmentIdx))) continue;
      const cat = ensure(row[catIdx]);
      if (!cat) continue;
      const month =
        (allocationIdx !== -1 && isoMonthLabel(row[allocationIdx])) ||
        `${MONTH_NAMES[date.m - 1]} ${date.y}`;
      const amount = toNumber(row[amountIdx]);
      months.add(month);
      byCategory.get(cat)[month] = (byCategory.get(cat)[month] || 0) + amount;
      transactions.push({
        date: `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`,
        month,
        merchant: cell(row, merchantIdx) || "—",
        category: cat,
        type: cell(row, typeIdx),
        amount,
        statement: statementIdx === -1 ? null : toNumber(row[statementIdx]),
        adjustment: adjustmentIdx === -1 ? 0 : toNumber(row[adjustmentIdx]),
        review: cell(row, reviewIdx),
        notes: cell(row, notesIdx),
      });
    }
    if (!transactions.length) throw new Error("No dated payments found in that file.");
    for (const values of byCategory.values()) {
      for (const m of Object.keys(values)) values[m] = Math.round(values[m] * 100) / 100;
    }
    return { months: [...months], byCategory, transactions };
  }

  if (monthIdx !== -1 && amountIdx !== -1) {
    for (const row of body) {
      const cat = ensure(row[catIdx] || "");
      if (!cat) continue;
      const month = cleanMonthLabel(row[monthIdx] || hint.monthName || "Imported");
      const amount = toNumber(row[amountIdx]);
      months.add(month);
      byCategory.get(cat)[month] = (byCategory.get(cat)[month] || 0) + amount;
    }
    return { months: [...months], byCategory };
  }

  if (amountIdx !== -1) {
    const month = cleanMonthLabel(hint.monthName || "Imported month");
    months.add(month);
    for (const row of body) {
      const cat = ensure(row[catIdx] || "");
      if (!cat) continue;
      byCategory.get(cat)[month] = (byCategory.get(cat)[month] || 0) + toNumber(row[amountIdx]);
    }
    return { months: [...months], byCategory };
  }

  const monthCols = [];
  headers.forEach((header, idx) => {
    if (idx === catIdx) return;
    if (isMonthHeader(header)) {
      monthCols.push({ idx, label: cleanMonthLabel(header) });
      months.add(cleanMonthLabel(header));
    }
  });

  if (!monthCols.length) {
    throw new Error(
      "Could not find month columns. Use Category + month columns, or Category/Amount, or Category/Month/Amount."
    );
  }

  for (const row of body) {
    const hasValues = monthCols.some((col) => String(row[col.idx] ?? "").trim() !== "");
    if (!hasValues) continue;
    const cat = ensure(row[catIdx] || "");
    if (!cat) continue;
    for (const col of monthCols) {
      const amount = toNumber(row[col.idx]);
      byCategory.get(cat)[col.label] =
        (byCategory.get(cat)[col.label] || 0) + amount;
    }
  }

  return { months: [...months], byCategory };
}

/* ---------- XLSX reading (no dependencies) ---------- */

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser can't read .xlsx files. Save the sheet as CSV instead.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error("That doesn't look like a valid .xlsx file.");

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const size = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    files.set(name, { method, size, localOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return async (name) => {
    const entry = files.get(name);
    if (!entry) return null;
    const p = entry.localOffset;
    const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
    const data = bytes.subarray(start, start + entry.size);
    const raw = entry.method === 0 ? data : await inflateRaw(data);
    return decoder.decode(raw);
  };
}

function xmlDoc(text) {
  return new DOMParser().parseFromString(text, "application/xml");
}

function byTag(node, name) {
  return [...node.getElementsByTagNameNS("*", name)];
}

function columnIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

/** Returns every sheet as { name, grid } using the cached cell values. */
async function readXlsx(buffer) {
  const read = await unzip(buffer);
  const workbook = await read("xl/workbook.xml");
  if (!workbook) throw new Error("That doesn't look like an Excel workbook.");

  const relsText = await read("xl/_rels/workbook.xml.rels");
  const targets = new Map();
  if (relsText) {
    for (const rel of byTag(xmlDoc(relsText), "Relationship")) {
      let target = rel.getAttribute("Target").replace(/^\//, "");
      if (!target.startsWith("xl/")) target = `xl/${target}`;
      targets.set(rel.getAttribute("Id"), target);
    }
  }

  const sharedText = await read("xl/sharedStrings.xml");
  const shared = sharedText
    ? byTag(xmlDoc(sharedText), "si").map((si) =>
        byTag(si, "t")
          .filter((t) => t.parentNode.localName !== "rPh")
          .map((t) => t.textContent)
          .join("")
      )
    : [];

  const sheets = [];
  const sheetNodes = byTag(xmlDoc(workbook), "sheet");
  for (const [i, node] of sheetNodes.entries()) {
    const rid = [...node.attributes].find((a) => a.localName === "id")?.value;
    const path = targets.get(rid) || `xl/worksheets/sheet${i + 1}.xml`;
    const text = await read(path);
    if (!text) continue;
    const grid = [];
    for (const row of byTag(xmlDoc(text), "row")) {
      const r = Number(row.getAttribute("r")) - 1;
      const cells = [];
      for (const c of byTag(row, "c")) {
        const ref = c.getAttribute("r");
        const type = c.getAttribute("t");
        const v = byTag(c, "v")[0]?.textContent;
        let value = null;
        if (type === "s") value = v != null ? shared[Number(v)] : null;
        else if (type === "inlineStr") value = byTag(c, "t").map((t) => t.textContent).join("");
        else if (type === "str" || type === "d" || type === "e") value = v ?? null;
        else if (type === "b") value = v === "1";
        else if (v != null) value = Number(v);
        cells[ref ? columnIndex(ref) : cells.length] = value;
      }
      grid[r >= 0 ? r : grid.length] = cells;
    }
    sheets.push({ name: node.getAttribute("name"), grid: Array.from(grid, (r) => r || []) });
  }
  return sheets;
}

const isIncomeSheet = (sheet) => /income/i.test(sheet.name || "");

/** Prefer a payment-level sheet; fall back to the first sheet with a Category column. */
function extractMatrixFromWorkbook(sheets, hint) {
  const spending = sheets.filter((s) => !isIncomeSheet(s));
  const hasPayments = (grid) => {
    const idx = findHeaderRow(grid);
    if (idx === -1) return false;
    const norm = grid[idx].map(normalizeHeader);
    return norm.includes("date");
  };
  const detailed = spending.find((s) => hasPayments(s.grid));
  const summary = spending.find((s) => findHeaderRow(s.grid) !== -1);
  const chosen = detailed || summary;
  if (!chosen) throw new Error('No sheet with a "Category" column was found.');
  const matrix = extractMatrixFromGrid(chosen.grid, hint);
  const income = sheets.filter(isIncomeSheet).map(extractIncome).find(Boolean);
  if (income) matrix.income = income;
  return matrix;
}

/**
 * Reads an Income sheet: a deposit list (Date / Month / Source / Category / Counted income)
 * when present, otherwise a monthly table (Month + one column per source).
 * @returns {{ months: string[], byMonth: Record<string, Record<string, number>>, deposits: Deposit[] } | null}
 */
function extractIncome(sheet) {
  const grid = sheet.grid;
  const norms = grid.map((row) => (row || []).map(normalizeHeader));
  const months = new Set();
  const byMonth = {};
  const add = (month, source, amount) => {
    months.add(month);
    byMonth[month] ||= {};
    byMonth[month][source] = Math.round(((byMonth[month][source] || 0) + amount) * 100) / 100;
  };

  const depositHead = norms.findIndex(
    (n) => n.includes("date") && n.some((h) => h === "counted income" || h.startsWith("received") || h === "amount")
  );
  if (depositHead !== -1) {
    const n = norms[depositHead];
    const find = (...names) => n.findIndex((h) => names.includes(h));
    const dateIdx = find("date");
    const monthIdx = find("month", "allocation month");
    const descIdx = find("source / description", "description", "source", "payer", "from");
    const catIdx = find("category", "source type", "type");
    let amountIdx = find("counted income");
    if (amountIdx === -1) amountIdx = n.findIndex((h) => h.startsWith("received") || h === "amount");
    const treatmentIdx = find("treatment");
    const notesIdx = find("notes", "note", "memo");
    const cell = (row, idx) => (idx === -1 ? "" : String(row[idx] ?? "").trim());

    const deposits = [];
    for (const row of grid.slice(depositHead + 1)) {
      if (!row) continue;
      const date = parseDateValue(row[dateIdx]);
      if (!date) continue;
      if (/^excluded/i.test(cell(row, treatmentIdx))) continue;
      const amount = toNumber(row[amountIdx]);
      if (!amount) continue;
      const month = isoMonthLabel(row[monthIdx]) || `${MONTH_NAMES[date.m - 1]} ${date.y}`;
      const source = cell(row, catIdx) || "Income";
      add(month, source, amount);
      deposits.push({
        date: `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}`,
        month,
        source,
        description: cell(row, descIdx) || source,
        amount,
        notes: cell(row, notesIdx),
      });
    }
    if (deposits.length) {
      const fromTable = extractIncomeTable(grid, norms, depositHead);
      const depositSources = new Set(deposits.map((d) => d.source));
      for (const [month, values] of Object.entries(fromTable?.byMonth || {})) {
        for (const [source, v] of Object.entries(values)) {
          if (!depositSources.has(source)) add(month, source, v);
        }
      }
      return { months: [...months], byMonth, deposits };
    }
  }

  const fromTable = extractIncomeTable(grid, norms, grid.length);
  if (!fromTable) return null;
  for (const [month, values] of Object.entries(fromTable.byMonth)) {
    months.add(month);
    byMonth[month] ||= {};
    for (const [source, v] of Object.entries(values)) add(month, source, v);
  }
  return { months: [...months], byMonth, deposits: [] };
}

/** The monthly income table (Month + one column per source) above row `endRow`. */
function extractIncomeTable(grid, norms, endRow) {
  const tableHead = norms.findIndex((n, i) => i < endRow && n[0] === "month" && n.length > 1);
  if (tableHead === -1) return null;
  const headers = grid[tableHead].map((h) => String(h ?? "").trim());
  const cols = headers
    .map((h, idx) => ({ h, idx }))
    .filter(({ h, idx }) => idx > 0 && h && !isMetaHeader(h));
  const byMonth = {};
  for (const row of grid.slice(tableHead + 1, endRow)) {
    const month = isoMonthLabel(row?.[0]);
    if (!month) continue;
    byMonth[month] ||= {};
    for (const { h, idx } of cols) {
      const v = toNumber(row[idx]);
      if (v) byMonth[month][h] = Math.round(((byMonth[month][h] || 0) + v) * 100) / 100;
    }
  }
  return Object.keys(byMonth).length ? { byMonth } : null;
}

function guessMonthFromName(filename = "") {
  const base = filename.replace(/\.csv$/i, "").replace(/[_-]+/g, " ");
  const named = base.match(
    /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[_\s-]*((?:19|20)\d{2})/i
  );
  if (named) {
    const monthNames = {
      jan: "January",
      january: "January",
      feb: "February",
      february: "February",
      mar: "March",
      march: "March",
      apr: "April",
      april: "April",
      may: "May",
      jun: "June",
      june: "June",
      jul: "July",
      july: "July",
      aug: "August",
      august: "August",
      sep: "September",
      sept: "September",
      september: "September",
      oct: "October",
      october: "October",
      nov: "November",
      november: "November",
      dec: "December",
      december: "December",
    };
    return `${monthNames[named[1].toLowerCase()]} ${named[2]}`;
  }
  const iso = base.match(/((?:19|20)\d{2})[_\s-]?(\d{1,2})/);
  if (iso) {
    const names = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const m = Number(iso[2]);
    if (m >= 1 && m <= 12) return `${names[m - 1]} ${iso[1]}`;
  }
  return "";
}

function mergeIntoState(matrix, sourceLabel) {
  const monthSet = new Set(state.months);
  for (const m of matrix.months) monthSet.add(m);
  for (const m of matrix.income?.months || []) monthSet.add(m);
  const months = sortMonths([...monthSet]);

  const catSet = new Set(state.categories);
  for (const cat of matrix.byCategory.keys()) catSet.add(cat);

  const existing = state.categories.filter((c) => catSet.has(c));
  const added = [...catSet]
    .filter((c) => !existing.includes(c))
    .sort((a, b) => a.localeCompare(b));
  const categories = [...existing, ...added];

  const prev = new Map(state.rows.map((r) => [r.category, r]));
  const rows = categories.map((category) => {
    const next = { category };
    const old = prev.get(category) || {};
    const incoming = matrix.byCategory.get(category) || {};
    for (const month of months) {
      next[month] = matrix.months.includes(month) ? incoming[month] || 0 : old[month] || 0;
    }
    return next;
  });

  const sources = [...state.sources];
  if (sourceLabel && !sources.includes(sourceLabel)) sources.push(sourceLabel);

  const transactions = [
    ...state.transactions.filter((t) => !matrix.months.includes(t.month)),
    ...(matrix.transactions || []),
  ].sort((a, b) => a.date.localeCompare(b.date));

  let { income, deposits } = state;
  if (matrix.income) {
    const replaced = matrix.income.months;
    income = { ...income };
    for (const m of replaced) delete income[m];
    Object.assign(income, matrix.income.byMonth);
    deposits = [...deposits.filter((d) => !replaced.includes(d.month)), ...matrix.income.deposits].sort(
      (a, b) => a.date.localeCompare(b.date)
    );
  }

  state = { months, rows, categories, sources, transactions, income, deposits };
  persist();
}

function hasIncome() {
  return Object.keys(state.income).length > 0;
}

/** Income per month and per source, over every loaded month. */
function computeIncome() {
  const byMonth = Object.fromEntries(state.months.map((m) => [m, 0]));
  const bySource = new Map();
  for (const m of state.months) {
    for (const [source, v] of Object.entries(state.income[m] || {})) {
      byMonth[m] += v;
      const s = bySource.get(source) || { source, total: 0, row: {} };
      s.total += v;
      s.row[m] = (s.row[m] || 0) + v;
      bySource.set(source, s);
    }
  }
  const sources = [...bySource.values()].sort((a, b) => b.total - a.total);
  const grand = sources.reduce((s, x) => s + x.total, 0);
  return { byMonth, sources, grand };
}

function transactionsFor(category, month = "all") {
  return state.transactions.filter(
    (t) => t.category === category && (month === "all" || t.month === month)
  );
}

function computeTotals() {
  const monthTotals = Object.fromEntries(state.months.map((m) => [m, 0]));
  const categoryTotals = state.rows.map((row) => {
    let total = 0;
    for (const m of state.months) {
      const v = row[m] || 0;
      total += v;
      monthTotals[m] += v;
    }
    return { category: row.category, total, row };
  });
  const grand = categoryTotals.reduce((s, c) => s + c.total, 0);
  categoryTotals.sort((a, b) => b.total - a.total);
  return { monthTotals, categoryTotals, grand };
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    setStatus("This device couldn't save the data, so you'll need to add the file again next time.", "err");
  }
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed?.months || !parsed?.rows) return false;
    state = {
      months: parsed.months,
      rows: parsed.rows,
      categories: parsed.categories || parsed.rows.map((r) => r.category),
      sources: parsed.sources || [],
      transactions: parsed.transactions || [],
      income: parsed.income || {},
      deposits: parsed.deposits || [],
    };
    return true;
  } catch {
    return false;
  }
}

function clearPersisted() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function render() {
  const { monthTotals, categoryTotals, grand } = computeTotals();
  const hasData = state.months.length > 0;

  els.welcome.hidden = hasData;
  els.reset.hidden = !hasData;
  els.stats.hidden = !hasData;
  els.chartsPanel.hidden = !hasData;
  els.categoryPanel.hidden = !hasData;
  els.comparePanel.hidden = !hasData;
  els.tablePanel.hidden = !hasData;
  els.paymentsPanel.hidden = !hasData;
  els.incomePanel.hidden = !hasData || !hasIncome();
  els.tabs.querySelector('[data-tab="income"]').hidden = !hasIncome();
  els.tabs.hidden = !hasData;
  els.monthChartTitle.textContent = hasIncome() ? "Income & spending" : "Monthly total";
  els.monthChartLegend.hidden = !hasIncome();

  if (!hasData) return;

  const monthCount = state.months.length;
  const avg = grand / monthCount;
  const top = categoryTotals[0];
  const peakMonth = [...state.months].sort(
    (a, b) => (monthTotals[b] || 0) - (monthTotals[a] || 0)
  )[0];

  const income = computeIncome();
  const saved = income.grand - grand;
  els.stats.innerHTML = hasIncome()
    ? `
    <article class="stat stat-income" style="animation-delay:0.02s">
      <p class="stat-label">Income</p>
      <p class="stat-value">${money(income.grand)}</p>
      <p class="stat-note">${money(income.grand / monthCount)} / month</p>
    </article>
    <article class="stat stat-spent" style="animation-delay:0.08s">
      <p class="stat-label">Spent</p>
      <p class="stat-value">${money(grand)}</p>
      <p class="stat-note">${money(avg)} / month</p>
    </article>
    <article class="stat ${saved >= 0 ? "stat-saved" : "stat-over"}" style="animation-delay:0.14s">
      <p class="stat-label">${saved >= 0 ? "Saved" : "Overspent"}</p>
      <p class="stat-value">${money(Math.abs(saved))}</p>
      <p class="stat-note">${saved < 0 ? "more than came in" : income.grand ? `${((saved / income.grand) * 100).toFixed(1)}% of income` : ""}</p>
    </article>
    <article class="stat" style="animation-delay:0.2s">
      <p class="stat-label">Largest category</p>
      <p class="stat-value is-text" title="${top ? escapeAttr(top.category) : ""}">${top ? escapeHtml(top.category) : "—"}</p>
      <p class="stat-note">${top ? `${money(top.total)} · ${pct((top.total / grand) * 100)}` : ""}</p>
    </article>`
    : `
    <article class="stat" style="animation-delay:0.02s">
      <p class="stat-label">Total spent</p>
      <p class="stat-value">${money(grand)}</p>
      <p class="stat-note">${monthCount} month${monthCount === 1 ? "" : "s"} loaded</p>
    </article>
    <article class="stat" style="animation-delay:0.08s">
      <p class="stat-label">Monthly average</p>
      <p class="stat-value">${money(avg)}</p>
      <p class="stat-note">Across loaded months</p>
    </article>
    <article class="stat" style="animation-delay:0.14s">
      <p class="stat-label">Largest category</p>
      <p class="stat-value is-text" title="${top ? escapeAttr(top.category) : ""}">${top ? escapeHtml(top.category) : "—"}</p>
      <p class="stat-note">${top ? `${money(top.total)} · ${pct((top.total / grand) * 100)}` : ""}</p>
    </article>
    <article class="stat" style="animation-delay:0.2s">
      <p class="stat-label">Peak month</p>
      <p class="stat-value is-text">${peakMonth ? escapeHtml(peakMonth) : "—"}</p>
      <p class="stat-note">${peakMonth ? money(monthTotals[peakMonth]) : ""}</p>
    </article>
  `;

  drawMonthChart(monthTotals);
  renderMonthOptions(els.shareMonth);
  renderCategoryBreakdown(categoryTotals);
  renderCompare(categoryTotals);
  renderRangePickers();
  renderTable(categoryTotals, monthTotals, grand);
  renderMonthOptions(els.paymentsMonth);
  renderPayments();
  renderMonthOptions(els.incomeMonth);
  renderIncome();
  setTab(activeTab, { scroll: false });
}

function redrawCharts() {
  if (!state.months.length) return;
  const { monthTotals, categoryTotals } = computeTotals();
  drawMonthChart(monthTotals);
  const { items, grand } = categoryBreakdown(categoryTotals);
  drawShareChart(items, grand);
  drawCompareChart(compareRows(categoryTotals));
}

/** Non-zero categories for the selected month (or all months), largest first. */
function categoryBreakdown(categoryTotals) {
  const month = els.shareMonth.value || "all";
  const items = categoryTotals
    .map((c) => ({
      category: c.category,
      total: month === "all" ? c.total : c.row[month] || 0,
    }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);
  const grand = items.reduce((s, c) => s + c.total, 0);
  return { items, grand, month };
}

function renderCategoryBreakdown(categoryTotals) {
  const { items, grand, month } = categoryBreakdown(categoryTotals);
  const scope = month === "all" ? "all loaded months" : month;
  els.rankCaption.textContent = `${items.length} categor${items.length === 1 ? "y" : "ies"} · ${scope}`;
  drawShareChart(items, grand);
  renderRankList(items, grand);
}

/** From–to months shared by Compare and Full breakdown; null means the last 3 months. */
let monthRange = null;

function rangeMonths() {
  const months = state.months;
  let a = monthRange ? months.indexOf(monthRange.from) : -1;
  let b = monthRange ? months.indexOf(monthRange.to) : -1;
  if (a === -1 || b === -1) {
    a = Math.max(0, months.length - 3);
    b = months.length - 1;
  }
  if (a > b) [a, b] = [b, a];
  return months.slice(a, b + 1);
}

function rangePickers() {
  return [
    [els.compareFrom, els.compareTo],
    [els.tableFrom, els.tableTo],
  ];
}

function renderRangePickers() {
  const months = rangeMonths();
  const options = state.months.map((m) => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`).join("");
  for (const [from, to] of rangePickers()) {
    from.innerHTML = options;
    to.innerHTML = options;
    from.value = months[0] ?? "";
    to.value = months[months.length - 1] ?? "";
  }
}

function compareMonths() {
  return rangeMonths();
}

/** The category's amount in the month before `month`, or null for the first loaded month. */
function previousMonthValue(row, month) {
  const i = state.months.indexOf(month);
  return i > 0 ? row[state.months[i - 1]] || 0 : null;
}

function categorySwing(row, months = compareMonths()) {
  const values = months.map((m) => row[m] || 0);
  if (!values.length) return 0;
  return Math.max(...values) - Math.min(...values);
}

function compareRows(categoryTotals) {
  const sort = els.compareSort?.value || "total";
  const countRaw = els.compareCount?.value || "12";
  const months = compareMonths();
  const windowTotal = (c) => months.reduce((s, m) => s + (c.row[m] || 0), 0);
  let rows = categoryTotals.filter((c) => months.some((m) => (c.row[m] || 0) > 0));

  rows = [...rows].sort((a, b) => {
    if (sort === "name") return a.category.localeCompare(b.category);
    if (sort === "latest") {
      const last = months[months.length - 1];
      return (b.row[last] || 0) - (a.row[last] || 0);
    }
    if (sort === "swing") return categorySwing(b.row, months) - categorySwing(a.row, months);
    return windowTotal(b) - windowTotal(a);
  });

  if (countRaw !== "all") {
    rows = rows.slice(0, Number(countRaw) || 12);
  }
  return rows;
}

function renderCompare(categoryTotals) {
  const rows = compareRows(categoryTotals);
  renderMonthLegend();
  drawCompareChart(rows);
}

function renderMonthLegend() {
  const months = compareMonths();
  els.monthLegend.innerHTML = months
    .map((month, i) => {
      const color = monthColor(i, months.length);
      return `<span class="month-legend-item"><span class="month-legend-swatch" style="background:${color}"></span>${escapeHtml(month)}</span>`;
    })
    .join("");
}

/** "▲ $1,012 (+194%)" style change label, or null when there's nothing to compare. */
function chartDelta(curr, prev) {
  if (prev == null) return null;
  const d = curr - prev;
  if (Math.abs(d) < 0.5) return { text: "no change", color: "#85726a" };
  let pctText = "";
  if (prev > 0) pctText = ` (${d > 0 ? "+" : "−"}${Math.abs((d / prev) * 100).toFixed(0)}%)`;
  else if (curr > 0) pctText = " new";
  const short = `${d > 0 ? "▲" : "▼"} ${wholeMoney(Math.abs(d))}`;
  return { text: `${short}${pctText}`, short, color: d > 0 ? "#c0563f" : "#4f8f72" };
}

function drawCompareChart(rows) {
  const canvas = els.compareChart;
  if (!canvas || !rows.length || state.months.length < 1) {
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx && ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    return;
  }

  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 900;
  const months = compareMonths();
  const monthN = months.length;
  const rowN = rows.length;
  const barH = monthN > 4 ? 10 : 13;
  const barGap = 4;
  const groupPad = 18;
  const groupH = monthN * (barH + barGap) - barGap + groupPad;
  const pad = { top: 8, right: 0, bottom: 28, left: 0 };
  const cssH = pad.top + pad.bottom + rowN * groupH;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  canvas.style.height = `${cssH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const rawMax = Math.max(
    1,
    ...rows.flatMap((r) => months.map((m) => r.row[m] || 0))
  );
  const scale = niceScale(rawMax, cssW < 560 ? 3 : 4);

  ctx.font = "600 12.5px Nunito, sans-serif";
  const widestLabel = Math.max(...rows.map((r) => ctx.measureText(r.category).width));
  pad.left = Math.round(Math.min(cssW * 0.3, Math.max(60, widestLabel + 16)));

  // Right padding only needs to fit the text trailing each bar, which depends on the plot width.
  const trailing = rows.flatMap((item) =>
    months.map((month) => {
      const v = item.row[month] || 0;
      const prev = previousMonthValue(item.row, month);
      ctx.font = "650 11px Nunito, sans-serif";
      let textW = 6 + ctx.measureText(wholeMoney(v)).width;
      const delta = chartDelta(v, prev);
      if (delta) {
        ctx.font = "650 10.5px Nunito, sans-serif";
        textW += 8 + ctx.measureText(delta.text).width;
      }
      return { frac: v / scale.max, textW: textW + 4 };
    })
  );
  pad.right = 16;
  for (let pass = 0; pass < 3; pass++) {
    const plot = cssW - pad.left - pad.right;
    pad.right = Math.max(16, ...trailing.map((t) => t.textW - (1 - t.frac) * plot));
  }
  pad.right = Math.min(pad.right, cssW * 0.4);

  const plotW = cssW - pad.left - pad.right;
  const plotH = cssH - pad.top - pad.bottom;

  ctx.lineWidth = 1;
  for (let i = 0; i <= scale.ticks; i++) {
    const x = Math.round(pad.left + (plotW * i) / scale.ticks) + 0.5;
    ctx.strokeStyle = i === 0 ? "rgba(90,62,48,0.22)" : "rgba(90,62,48,0.07)";
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotH);
    ctx.stroke();
    ctx.fillStyle = "#85726a";
    ctx.font = "500 11px Nunito, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(compactMoney(scale.step * i), x, pad.top + plotH + 10);
  }

  rows.forEach((item, ri) => {
    const groupTop = pad.top + ri * groupH + groupPad / 2;
    const blockH = groupH - groupPad;

    if (ri > 0) {
      ctx.strokeStyle = "rgba(90,62,48,0.05)";
      ctx.beginPath();
      ctx.moveTo(0, pad.top + ri * groupH + 0.5);
      ctx.lineTo(cssW, pad.top + ri * groupH + 0.5);
      ctx.stroke();
    }

    ctx.fillStyle = "#3d2f2b";
    ctx.font = "600 12.5px Nunito, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const label = truncateLabel(ctx, item.category, pad.left - 14);
    ctx.fillText(label, 0, groupTop + blockH / 2);

    months.forEach((month, mi) => {
      const v = item.row[month] || 0;
      const prev = previousMonthValue(item.row, month);
      const y = groupTop + mi * (barH + barGap);
      const mid = y + barH / 2 + 0.5;
      if (v <= 0 && !prev) return;

      const w = v > 0 ? Math.max(3, (v / scale.max) * plotW) : 0;
      if (w > 0) {
        ctx.fillStyle = monthColor(mi, monthN);
        roundRect(ctx, pad.left, y, w, barH, barH / 2);
        ctx.fill();
      }

      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.font = "650 11px Nunito, sans-serif";
      ctx.fillStyle = v > 0 ? "#3d2f2b" : "rgba(133,114,106,0.55)";
      const valueText = wholeMoney(v);
      let x = pad.left + w + 6;
      ctx.fillText(valueText, x, mid);
      x += ctx.measureText(valueText).width + 8;

      const delta = chartDelta(v, prev);
      if (delta) {
        ctx.font = "650 10.5px Nunito, sans-serif";
        ctx.fillStyle = delta.color;
        const fits = x + ctx.measureText(delta.text).width <= cssW - 2;
        ctx.fillText(fits || !delta.short ? delta.text : delta.short, x, mid);
      }
    });
  });
}

function truncateLabel(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) {
    s = s.slice(0, -1);
  }
  return `${s}…`;
}

function drawMonthChart(monthTotals) {
  const canvas = els.monthChart;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 900;
  const cssH = 280;
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const monthN = state.months.length;
  const values = state.months.map((m) => monthTotals[m] || 0);
  const incomeByMonth = hasIncome() ? computeIncome().byMonth : null;
  const incomes = incomeByMonth ? state.months.map((m) => incomeByMonth[m] || 0) : [];
  const scale = niceScale(Math.max(...values, ...incomes, 1), 4);
  const pad = { top: 44, right: 12, bottom: 44, left: cssW < 500 ? 44 : 56 };
  const plotW = cssW - pad.left - pad.right;
  const plotH = cssH - pad.top - pad.bottom;
  const slotW = plotW / monthN;
  // With many months there is no room for every label, so only key bars get one
  // and the rest show on hover / tap.
  const dense = slotW < 72;
  const barW = dense ? Math.max(3, Math.min(40, slotW * 0.62)) : Math.min(120, slotW * 0.56);
  const hover = monthChartHover >= 0 && monthChartHover < monthN ? monthChartHover : -1;
  const maxIndex = values.indexOf(Math.max(...values));
  const labelEvery = Math.max(1, Math.ceil(30 / slotW));
  monthChartState = { pad, slotW, monthN, plotH };

  ctx.lineWidth = 1;
  for (let i = 0; i <= scale.ticks; i++) {
    const y = Math.round(pad.top + (plotH * i) / scale.ticks) + 0.5;
    ctx.strokeStyle = i === scale.ticks ? "rgba(90,62,48,0.22)" : "rgba(90,62,48,0.07)";
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(pad.left + plotW, y);
    ctx.stroke();
    ctx.fillStyle = "#85726a";
    ctx.font = "500 11px Nunito, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(compactMoney(scale.max - scale.step * i), pad.left - 10, y);
  }

  state.months.forEach((month, i) => {
    const v = values[i];
    const h = (v / scale.max) * plotH;
    const x = pad.left + slotW * i + (slotW - barW) / 2;
    const y = pad.top + plotH - h;
    const isLatest = i === monthN - 1;
    const isHover = i === hover;
    const cx = x + barW / 2;

    const grad = ctx.createLinearGradient(0, y, 0, y + h);
    const strong = isLatest || isHover;
    grad.addColorStop(0, strong ? "#ee9c87" : "#f6d5c3");
    grad.addColorStop(1, strong ? "#cf7464" : "#edb9a5");
    ctx.globalAlpha = hover >= 0 && !isHover ? 0.55 : 1;
    ctx.fillStyle = grad;
    roundRect(ctx, x, y, barW, h, dense ? Math.min(6, barW / 2) : 8);
    ctx.fill();
    ctx.globalAlpha = 1;

    const showValue = !dense || (hover === -1 && (isLatest || i === maxIndex));
    if (showValue) {
      ctx.fillStyle = "#3d2f2b";
      ctx.font = `650 ${dense ? 11 : 12}px Nunito, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(dense ? compactMoney(v) : wholeMoney(v), cx, y - 6);
    }

    const change = i > 0 && values[i - 1] > 0 ? ((v - values[i - 1]) / values[i - 1]) * 100 : null;
    if (!dense && change != null && Math.abs(change) >= 0.5) {
      ctx.fillStyle = change > 0 ? "#c0563f" : "#4f8f72";
      ctx.font = "600 10.5px Nunito, sans-serif";
      ctx.fillText(`${change > 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(0)}%`, cx, y - 22);
    }

    ctx.fillStyle = isHover ? "#3d2f2b" : "#85726a";
    ctx.font = `${isHover ? 700 : 600} 11px Nunito, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    if (dense) {
      const [name, year] = month.split(" ");
      const isJan = name === "January";
      if (i % labelEvery === 0 || isHover || isJan) {
        ctx.fillText(name.slice(0, 3), cx, pad.top + plotH + 10);
      }
      if (i === 0 || isJan) {
        ctx.fillStyle = "#b3a199";
        ctx.font = "600 10px Nunito, sans-serif";
        ctx.fillText(`’${year.slice(2)}`, cx, pad.top + plotH + 25);
      }
    } else {
      wrapLabel(ctx, month.replace(/ 20/, " ’"), cx, pad.top + plotH + 10, barW + 12);
    }
  });

  const yAt = (v) => pad.top + plotH - (Math.max(0, v) / scale.max) * plotH;
  if (incomeByMonth) {
    const points = incomes.map((v, i) => [pad.left + slotW * i + slotW / 2, yAt(v)]);
    ctx.strokeStyle = "rgba(79,143,114,0.85)";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    points.forEach(([x, y], i) => {
      ctx.globalAlpha = hover >= 0 && i !== hover ? 0.55 : 1;
      ctx.beginPath();
      ctx.arc(x, y, i === hover ? 5 : dense ? 3 : 4, 0, Math.PI * 2);
      ctx.fillStyle = "#4f8f72";
      ctx.fill();
      ctx.strokeStyle = "#fffdfa";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  if (hover >= 0 && (dense || incomeByMonth)) {
    const v = values[hover];
    const cx = pad.left + slotW * hover + slotW / 2;
    const top = Math.min(yAt(v), incomeByMonth ? yAt(incomes[hover]) : Infinity);
    const rows = [];
    if (incomeByMonth) {
      const net = incomes[hover] - v;
      rows.push({ text: `Spent ${wholeMoney(v)}`, color: "#fff", font: "700 13px" });
      rows.push({ text: `Income ${wholeMoney(incomes[hover])}`, color: "#9fd1b5", font: "700 12px" });
      rows.push({
        text: `${net >= 0 ? "Saved" : "Overspent"} ${wholeMoney(Math.abs(net))}`,
        color: net >= 0 ? "#9fd1b5" : "#f2a48f",
        font: "700 11px",
      });
    } else {
      const prev = hover > 0 ? values[hover - 1] : 0;
      const change = prev > 0 ? ((v - prev) / prev) * 100 : null;
      rows.push({ text: wholeMoney(v), color: "#fff", font: "700 13px" });
      if (change != null && Math.abs(change) >= 0.5) {
        rows.push({
          text: `${change > 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(0)}% vs ${state.months[hover - 1].split(" ")[0].slice(0, 3)}`,
          color: change > 0 ? "#f2a48f" : "#9fd1b5",
          font: "700 11px",
        });
      }
    }
    const title = state.months[hover];
    ctx.font = "600 11px Nunito, sans-serif";
    let w = ctx.measureText(title).width;
    for (const r of rows) {
      ctx.font = `${r.font} Nunito, sans-serif`;
      w = Math.max(w, ctx.measureText(r.text).width);
    }
    w += 20;
    const bh = 24 + rows.length * 17;
    let bx = Math.min(Math.max(cx - w / 2, 2), cssW - w - 2);
    let by = top - bh - 10;
    if (by < 2) {
      bx = cx + 14 + w <= cssW - 2 ? cx + 14 : cx - 14 - w;
      by = Math.min(Math.max(2, top - bh / 2), cssH - bh - 2);
    }
    ctx.fillStyle = "#3d2f2b";
    roundRect(ctx, bx, by, w, bh, 10);
    ctx.fill();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "600 11px Nunito, sans-serif";
    ctx.fillText(title, bx + 10, by + 8);
    rows.forEach((r, i) => {
      ctx.fillStyle = r.color;
      ctx.font = `${r.font} Nunito, sans-serif`;
      ctx.fillText(r.text, bx + 10, by + 24 + i * 17);
    });
  }
}

let monthChartState = null;
let monthChartHover = -1;

function monthAtPoint(clientX) {
  const s = monthChartState;
  if (!s) return -1;
  const rect = els.monthChart.getBoundingClientRect();
  const x = clientX - rect.left - s.pad.left;
  const i = Math.floor(x / s.slotW);
  return i >= 0 && i < s.monthN ? i : -1;
}

function setMonthHover(index) {
  if (monthChartHover === index) return;
  monthChartHover = index;
  drawMonthChart(computeTotals().monthTotals);
}

function compactMoney(n) {
  if (n >= 1000) {
    const k = (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "");
    return `$${k}k`;
  }
  return `$${Math.round(n)}`;
}

function wholeMoney(n) {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

/** Round an axis maximum up to a readable step (1, 2, 2.5 or 5 × 10ⁿ). */
function niceScale(max, targetTicks = 4) {
  const safeMax = Math.max(max, 1);
  const raw = safeMax / targetTicks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const top = step * Math.ceil(safeMax / step);
  return { step, max: top, ticks: Math.round(top / step) };
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapLabel(ctx, text, x, y, maxWidth) {
  const words = text.split(" ");
  if (words.length === 1 || ctx.measureText(text).width <= maxWidth) {
    ctx.fillText(text, x, y);
    return;
  }
  ctx.fillText(words[0], x, y);
  ctx.fillText(words.slice(1).join(" "), x, y + 13);
}

/** Geometry of the last-drawn donut, used for hover hit-testing. */
let shareChartState = null;

function drawShareChart(items, grand, activeIndex = -1, tapHint = false) {
  const canvas = els.shareChart;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const size = Math.min(canvas.clientWidth || 360, 360);
  canvas.width = Math.floor(size * dpr);
  canvas.height = Math.floor(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);

  const slices = items.map((c, i) => ({
    label: c.category,
    total: c.total,
    color: categoryColor(i),
  }));

  if (!slices.length) {
    ctx.strokeStyle = "rgba(90,62,48,0.1)";
    ctx.lineWidth = size * 0.42 * 0.38;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.42 * 0.81, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#85726a";
    ctx.font = "600 12px Nunito, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No spending this month", size / 2, size / 2);
    shareChartState = null;
    return;
  }

  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.42;
  const inner = radius * 0.62;
  const pop = Math.max(4, size * 0.025);
  let start = 0;

  slices.forEach((slice, i) => {
    const sweep = grand > 0 ? (slice.total / grand) * Math.PI * 2 : 0;
    slice.start = start;
    slice.end = start + sweep;
    const isActive = i === activeIndex;
    const r = isActive ? radius + pop : radius;
    const a0 = start - Math.PI / 2;

    ctx.globalAlpha = activeIndex === -1 || isActive ? 1 : 0.45;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a0, a0 + sweep);
    ctx.closePath();
    ctx.fillStyle = slice.color;
    ctx.fill();
    if (slices.length > 1) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    start += sweep;
  });
  ctx.globalAlpha = 1;

  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const active = slices[activeIndex];
  if (active) {
    const shift = tapHint ? -10 : 0;
    ctx.fillStyle = "#85726a";
    ctx.font = "600 12px Nunito, sans-serif";
    ctx.fillText(truncateLabel(ctx, active.label, inner * 1.7), cx, cy - 20 + shift);
    ctx.fillStyle = "#3d2f2b";
    ctx.font = `650 ${size < 280 ? 18 : 22}px Fraunces, Georgia, serif`;
    ctx.fillText(money(active.total), cx, cy + 2 + shift);
    ctx.fillStyle = "#85726a";
    ctx.font = "700 12px Nunito, sans-serif";
    ctx.fillText(`${((active.total / grand) * 100).toFixed(1)}% of total`, cx, cy + 24 + shift);
    if (tapHint) {
      ctx.fillStyle = "#c96f5f";
      ctx.font = "700 11.5px Nunito, sans-serif";
      ctx.fillText("Tap again for payments ›", cx, cy + 40);
    }
  } else {
    ctx.fillStyle = "#85726a";
    ctx.font = "600 11px Nunito, sans-serif";
    ctx.fillText("TOTAL SPENT", cx, cy - 14);
    ctx.fillStyle = "#3d2f2b";
    ctx.font = `650 ${size < 280 ? 18 : 22}px Fraunces, Georgia, serif`;
    ctx.fillText(wholeMoney(grand), cx, cy + 8);
  }

  shareChartState = { items, grand, slices, size, cx, cy, radius: radius + pop, inner, activeIndex, tapHint };
  canvas.style.cursor = active ? "pointer" : "";
  els.rankList.classList.toggle("has-active", Boolean(active));
  [...els.rankList.children].forEach((li, i) => {
    li.classList.toggle("is-active", i === activeIndex);
  });
}

function sliceAtPoint(clientX, clientY) {
  const s = shareChartState;
  if (!s) return -1;
  const rect = els.shareChart.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * s.size - s.cx;
  const y = ((clientY - rect.top) / rect.height) * s.size - s.cy;
  const dist = Math.hypot(x, y);
  if (dist < s.inner) return "hole";
  if (dist > s.radius) return -1;
  const angle = (Math.atan2(y, x) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
  return s.slices.findIndex((sl) => angle >= sl.start && angle < sl.end);
}

function setActiveShare(index, tapHint = false) {
  const s = shareChartState;
  if (!s || (s.activeIndex === index && s.tapHint === tapHint)) return;
  drawShareChart(s.items, s.grand, index, tapHint);
}

function renderRankList(categories, grand) {
  const max = categories[0]?.total || 1;
  const share = (n) => {
    if (!grand) return "";
    const p = (n / grand) * 100;
    return p < 0.1 ? "<0.1%" : `${p.toFixed(1)}%`;
  };

  if (!categories.length) {
    els.rankList.innerHTML = `<li class="rank-empty">No spending recorded for this month.</li>`;
    return;
  }

  const items = categories.map((item, i) => {
    const width = Math.max(2, (item.total / max) * 100);
    const color = categoryColor(i);
    return `
      <li class="rank-item" tabindex="0" role="button" data-category="${escapeAttr(item.category)}"
        aria-label="${escapeAttr(`${item.category}, ${money(item.total)}. Show payments`)}">
        <span class="rank-index">${String(i + 1).padStart(2, "0")}</span>
        <div class="rank-meta">
          <div class="rank-line">
            <span class="rank-name"><span class="rank-swatch" style="background:${color}"></span>${escapeHtml(item.category)}</span>
            <span class="rank-amount">${money(item.total)}<span class="rank-share">${share(item.total)}</span></span>
          </div>
          <div class="rank-bar"><span style="width:${width}%;background:${color};animation-delay:${Math.min(i, 12) * 0.04}s"></span></div>
        </div>
      </li>`;
  });

  els.rankList.innerHTML = items.join("");
  els.rankList.scrollTop = 0;
}

function renderMonthOptions(select) {
  const current = select.value || "all";
  select.innerHTML =
    `<option value="all">All months</option>` +
    state.months
      .map((m) => `<option value="${escapeAttr(m)}">${escapeHtml(m)}</option>`)
      .join("");
  select.value = state.months.includes(current) ? current : "all";
}

function tableMonths() {
  return rangeMonths();
}

function renderTable(categoryTotals, monthTotals, grand) {
  const months = tableMonths();
  const sumOver = (valueOf) => months.reduce((s, m) => s + (valueOf(m) || 0), 0);
  const scopedGrand = sumOver((m) => monthTotals[m]);
  const showAvg = months.length > 1;
  const avgCell = (total) =>
    showAvg ? `<td class="num avg-cell">${money(total / months.length)}</td>` : "";

  els.tableHead.innerHTML = `<tr>
    <th>Category</th>
    ${months.map((m) => `<th class="num">${escapeHtml(m)}</th>`).join("")}
    <th class="num">Total</th>
    ${showAvg ? `<th class="num avg-cell">Avg / month</th>` : ""}
    <th class="num">Share</th>
  </tr>`;

  const bodyRows = categoryTotals
    .map((c) => {
      const scopedTotal = sumOver((m) => c.row[m]);
      const rowCls = scopedTotal === 0 ? ` class="is-empty"` : "";
      return `<tr${rowCls}>
        <td>${categoryLink(c.category)}</td>
        ${months
          .map((m) => {
            const v = c.row[m] || 0;
            return `<td class="num${v === 0 ? " zero" : ""}">${money(v)}</td>`;
          })
          .join("")}
        <td class="num">${money(scopedTotal)}</td>
        ${avgCell(scopedTotal)}
        <td class="num">${pct(scopedGrand ? (scopedTotal / scopedGrand) * 100 : 0)}</td>
      </tr>`;
    })
    .join("");

  const totalCells = months
    .map((m) => `<td class="num">${money(monthTotals[m] || 0)}</td>`)
    .join("");

  const signedCell = (v) => `<td class="num${v < 0 ? " is-negative" : ""}">${v < 0 ? "−" : ""}${money(Math.abs(v))}</td>`;
  const line = (label, cls, valueOf) => {
    const total = months.reduce((s, m) => s + valueOf(m), 0);
    return `<tr class="${cls}">
        <td>${label}</td>
        ${months.map((m) => signedCell(valueOf(m))).join("")}
        ${signedCell(total)}
        ${showAvg ? `<td class="num avg-cell">${money(total / months.length)}</td>` : ""}
        <td class="num"></td>
      </tr>`;
  };
  // Running totals span every loaded month, so a filtered month still shows its position so far.
  const runningLine = (label, cls, title, valueOf) => {
    let sum = 0;
    const running = Object.fromEntries(state.months.map((m) => [m, (sum += valueOf(m))]));
    return `<tr class="${cls}">
        <td title="${escapeAttr(title)}">${label}</td>
        ${months.map((m) => signedCell(running[m])).join("")}
        ${signedCell(running[months[months.length - 1]] || 0)}
        ${showAvg ? `<td class="num avg-cell"></td>` : ""}
        <td class="num"></td>
      </tr>`;
  };

  let incomeRows = "";
  if (hasIncome()) {
    const { byMonth } = computeIncome();
    incomeRows =
      line("Income", "income-row", (m) => byMonth[m] || 0) +
      line("Saved", "saved-row", (m) => (byMonth[m] || 0) - (monthTotals[m] || 0));
  }
  incomeRows += runningLine("Spent so far", "running-row running-first", "All spending up to the end of each month", (m) => monthTotals[m] || 0);
  if (hasIncome()) {
    const { byMonth } = computeIncome();
    incomeRows += runningLine(
      "Money you have",
      "running-row balance-row",
      "All income minus all spending up to the end of each month",
      (m) => (byMonth[m] || 0) - (monthTotals[m] || 0)
    );
  }

  els.tableBody.innerHTML =
    bodyRows +
    `<tr class="total-row">
      <td>TOTAL</td>
      ${totalCells}
      <td class="num">${money(scopedGrand)}</td>
      ${avgCell(scopedGrand)}
      <td class="num">100.00%</td>
    </tr>` +
    incomeRows;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, "&#39;");
}

function categoryLink(category) {
  return `<button type="button" class="cat-link" data-category="${escapeAttr(category)}">${escapeHtml(category)}</button>`;
}

/* ---------- Category details drawer ---------- */

const drawerState = { category: null, month: "all", returnFocus: null };

function shortDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return { day: d, mon: MONTH_NAMES[m - 1].slice(0, 3), year: y };
}

function manualBadges(id) {
  return `<span class="badge badge-manual">Added by hand</span><button type="button" class="badge badge-delete" data-delete-entry="${escapeAttr(id)}">Delete</button>`;
}

/** Payment rows, newest first. `showCategory` adds a clickable category tag to each row. */
function txnListHtml(txns, { groupByMonth = true, showCategory = false } = {}) {
  const list = [...txns].sort((a, b) => b.date.localeCompare(a.date));
  const monthTotals = {};
  for (const t of list) monthTotals[t.month] = (monthTotals[t.month] || 0) + t.amount;
  const colors = {};
  if (showCategory) {
    const { items } = categoryBreakdown(computeTotals().categoryTotals);
    items.forEach((c, i) => (colors[c.category] = categoryColor(i)));
  }
  let lastMonth = "";
  return list
    .map((t) => {
      const d = shortDate(t.date);
      const heading =
        groupByMonth && t.month !== lastMonth
          ? `<li class="txn-month"><span>${escapeHtml(t.month)}</span>${
              showCategory ? `<span class="txn-month-total">${money(monthTotals[t.month])}</span>` : ""
            }</li>`
          : "";
      lastMonth = t.month;
      const badges = [];
      if (showCategory) {
        badges.push(
          `<button type="button" class="badge badge-cat" data-category="${escapeAttr(t.category)}" data-month="${escapeAttr(t.month)}"><span class="badge-dot" style="background:${colors[t.category] || "#c9b8ad"}"></span>${escapeHtml(t.category)}</button>`
        );
      }
      if (t.type && !/^charge$/i.test(t.type)) {
        badges.push(`<span class="badge${t.amount < 0 ? " badge-credit" : ""}">${escapeHtml(t.type)}</span>`);
      }
      if (t.review) badges.push(`<span class="badge badge-warn">${escapeHtml(t.review)}</span>`);
      if (t.manual) badges.push(manualBadges(t.id));
      if (t.adjustment) {
        badges.push(
          `<span class="badge">Adjusted ${t.adjustment > 0 ? "+" : "−"}${money(Math.abs(t.adjustment))} from ${money(t.statement)}</span>`
        );
      }
      return `${heading}<li class="txn">
        <span class="txn-date"><strong>${d.day}</strong>${d.mon}</span>
        <div class="txn-main">
          <span class="txn-merchant">${escapeHtml(t.merchant)}</span>
          ${badges.length ? `<span class="txn-badges">${badges.join("")}</span>` : ""}
          ${t.notes ? `<span class="txn-notes" title="Click to show the full note">${escapeHtml(t.notes)}</span>` : ""}
        </div>
        <span class="txn-amount${t.amount < 0 ? " is-credit" : ""}">${t.amount < 0 ? "−" : ""}${money(Math.abs(t.amount))}</span>
      </li>`;
    })
    .join("");
}

function renderPayments() {
  const month = els.paymentsMonth.value || "all";
  const txns = state.transactions.filter((t) => month === "all" || t.month === month);
  if (!state.transactions.length) {
    els.paymentsCaption.textContent = "Payment details aren't loaded";
    els.paymentsList.innerHTML = `<li class="drawer-empty">Only monthly totals are loaded. Import the Excel workbook (with its Payment details sheet) to see individual payments.</li>`;
    return;
  }
  const total = txns.reduce((s, t) => s + t.amount, 0);
  els.paymentsCaption.textContent = `${plural(txns.length, "payment")} · ${money(total)}`;
  els.paymentsList.innerHTML = txns.length
    ? txnListHtml(txns, { groupByMonth: month === "all", showCategory: true })
    : `<li class="drawer-empty">No payments in this month.</li>`;
}

/** "Electronic Funds Transfer PAY 000001234567890 ACME PAYROLL SERVICES" → "Acme Payroll Services". */
function tidyDeposit(text) {
  const cleaned = String(text || "")
    .replace(/^electronic funds transfer\s+/i, "")
    .replace(/^(pay|deposit)\s+/i, "")
    .replace(/\b\d{6,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned !== cleaned.toUpperCase()) return cleaned || text;
  return cleaned.replace(/[A-Z]+/g, (w) => {
    if (/^(OF|AND|THE|FOR|DE|DU|LA|LE)$/.test(w)) return w.toLowerCase();
    return w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase();
  });
}

const INCOME_COLORS = ["#4f8f72", "#86b89a", "#8fb3dc", "#6fbfb4", "#e9c75f", "#b59ad8", "#c9a27e"];

function renderIncome() {
  if (!hasIncome()) return;
  const month = els.incomeMonth.value || "all";
  const income = computeIncome();
  const spent = computeTotals().monthTotals;
  const scoped = (byMonth) =>
    month === "all" ? state.months.reduce((s, m) => s + (byMonth[m] || 0), 0) : byMonth[month] || 0;
  const received = scoped(income.byMonth);
  const spentTotal = scoped(spent);
  const net = received - spentTotal;
  const deposits = state.deposits.filter((d) => month === "all" || d.month === month);

  els.incomeCaption.textContent = deposits.length
    ? `${plural(deposits.length, "deposit")} · ${month === "all" ? "all loaded months" : month}`
    : month === "all"
      ? "All loaded months"
      : month;

  els.incomeSummary.innerHTML = `
    <div><p class="stat-label">Received</p><p class="income-figure is-income">${money(received)}</p></div>
    <div><p class="stat-label">Spent</p><p class="income-figure">${money(spentTotal)}</p></div>
    <div><p class="stat-label">${net >= 0 ? "Saved" : "Overspent"}</p><p class="income-figure ${net >= 0 ? "is-income" : "is-over"}">${money(Math.abs(net))}</p>
      <p class="income-rate">${net < 0 ? "more than came in" : received ? `${((net / received) * 100).toFixed(0)}% of income` : ""}</p></div>`;
  const sources = income.sources
    .map((s, i) => ({ ...s, value: month === "all" ? s.total : s.row[month] || 0, color: INCOME_COLORS[i % INCOME_COLORS.length] }))
    .filter((s) => s.value > 0);
  const max = Math.max(1, ...sources.map((s) => s.value));
  els.incomeSources.innerHTML = sources.length
    ? sources
        .map(
          (s) => `<li class="income-source">
        <div class="rank-line">
          <span class="rank-name"><span class="rank-swatch" style="background:${s.color}"></span>${escapeHtml(s.source)}</span>
          <span class="rank-amount">${money(s.value)}<span class="rank-share">${received ? `${((s.value / received) * 100).toFixed(1)}%` : ""}</span></span>
        </div>
        <div class="rank-bar"><span style="width:${Math.max(2, (s.value / max) * 100)}%;background:${s.color}"></span></div>
      </li>`
        )
        .join("")
    : `<li class="rank-empty">No income recorded for this month.</li>`;

  const colorOf = Object.fromEntries(income.sources.map((s, i) => [s.source, INCOME_COLORS[i % INCOME_COLORS.length]]));
  const list = [...deposits].sort((a, b) => b.date.localeCompare(a.date));
  const monthSums = {};
  for (const d of list) monthSums[d.month] = (monthSums[d.month] || 0) + d.amount;
  let lastMonth = "";
  els.depositsList.innerHTML = list.length
    ? list
        .map((d) => {
          const heading =
            month === "all" && d.month !== lastMonth
              ? `<li class="txn-month"><span>${escapeHtml(d.month)}</span><span class="txn-month-total">${money(monthSums[d.month])}</span></li>`
              : "";
          lastMonth = d.month;
          const day = shortDate(d.date);
          return `${heading}<li class="txn">
        <span class="txn-date"><strong>${day.day}</strong>${day.mon}</span>
        <div class="txn-main">
          <span class="txn-merchant" title="${escapeAttr(d.description)}">${escapeHtml(tidyDeposit(d.description))}</span>
          <span class="txn-badges"><span class="badge"><span class="badge-dot" style="background:${colorOf[d.source] || "#86b89a"}"></span>${escapeHtml(d.source)}</span>${d.manual ? manualBadges(d.id) : ""}</span>
          ${d.notes ? `<span class="txn-notes" title="Click to show the full note">${escapeHtml(d.notes)}</span>` : ""}
        </div>
        <span class="txn-amount is-income">+${money(d.amount)}</span>
      </li>`;
        })
        .join("")
    : `<li class="drawer-empty">${state.deposits.length ? "No deposits in this month." : "Only monthly income totals are loaded."}</li>`;
}

/* ---------- Tabs ---------- */

const TABS = ["overview", "compare", "breakdown", "payments", "income"];
let activeTab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "overview";

function setTab(name, { scroll = true } = {}) {
  if (!TABS.includes(name)) return;
  if (name === "income" && !hasIncome()) name = "overview";
  activeTab = name;
  for (const btn of els.tabs.querySelectorAll("[data-tab]")) {
    btn.setAttribute("aria-selected", String(btn.dataset.tab === name));
  }
  for (const panel of document.querySelectorAll("[data-tab-panel]")) {
    panel.classList.toggle("tab-off", panel.dataset.tabPanel !== name);
  }
  if (location.hash.slice(1) !== name) history.replaceState(null, "", `#${name}`);
  // Canvases in hidden tabs have no width, so draw them once they are visible.
  redrawCharts();
  if (scroll) {
    const top = els.tabs.getBoundingClientRect().top + window.scrollY - 12;
    if (window.scrollY > top) window.scrollTo({ top, behavior: "smooth" });
  }
}

function categoryAccent(category) {
  const { items } = categoryBreakdown(computeTotals().categoryTotals);
  const idx = items.findIndex((c) => c.category === category);
  return idx === -1 ? CATEGORY_COLORS[0] : categoryColor(idx);
}

function openCategory(category, month = "all") {
  if (!drawerState.category) drawerState.returnFocus = document.activeElement;
  drawerState.category = category;
  drawerState.month = state.months.includes(month) ? month : "all";
  els.drawer.hidden = false;
  document.body.classList.add("drawer-open");
  renderDrawer();
  requestAnimationFrame(() => els.drawer.classList.add("is-open"));
  els.drawerClose.focus({ preventScroll: true });
}

function closeDrawer() {
  if (!drawerState.category) return;
  drawerState.category = null;
  els.drawer.classList.remove("is-open");
  document.body.classList.remove("drawer-open");
  setTimeout(() => {
    if (!drawerState.category) els.drawer.hidden = true;
  }, 220);
  drawerState.returnFocus?.focus?.({ preventScroll: true });
}

function renderDrawer() {
  const { category, month } = drawerState;
  const row = state.rows.find((r) => r.category === category) || {};
  const scopeTotal =
    month === "all" ? state.months.reduce((s, m) => s + (row[m] || 0), 0) : row[month] || 0;
  const txns = transactionsFor(category, month);
  const charges = txns.filter((t) => t.amount > 0);
  const accent = categoryAccent(category);

  els.drawerTitle.innerHTML = `<span class="drawer-swatch" style="background:${accent}"></span>${escapeHtml(category)}`;
  els.drawerScope.textContent =
    month === "all" ? `All loaded months · ${state.months.length} months` : month;

  els.drawerMonths.innerHTML = ["all", ...[...state.months].reverse()]
    .map((m) => {
      const label = m === "all" ? "All months" : `${m} · ${money(row[m] || 0)}`;
      return `<option value="${escapeAttr(m)}"${m === month ? " selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");

  const largest = charges.reduce((best, t) => (!best || t.amount > best.amount ? t : best), null);
  const stats = `
    <div class="drawer-stats">
      <div><p class="stat-label">Spent</p><p class="drawer-stat-value">${money(scopeTotal)}</p></div>
      <div><p class="stat-label">Payments</p><p class="drawer-stat-value">${txns.length || "—"}</p></div>
      <div><p class="stat-label">Average</p><p class="drawer-stat-value">${charges.length ? money(charges.reduce((s, t) => s + t.amount, 0) / charges.length) : "—"}</p></div>
      <div><p class="stat-label">Largest</p><p class="drawer-stat-value">${largest ? money(largest.amount) : "—"}</p></div>
    </div>`;

  let byMonth = "";
  if (month === "all" && state.months.length > 1) {
    const max = Math.max(1, ...state.months.map((m) => Math.abs(row[m] || 0)));
    byMonth = `
      <section class="drawer-section">
        <h3>By month</h3>
        <div class="drawer-months-bars">
          ${state.months
            .map((m, i) => {
              const v = row[m] || 0;
              return `<button type="button" class="month-bar" data-month="${escapeAttr(m)}">
                <span class="month-bar-label">${escapeHtml(m)}</span>
                <span class="month-bar-track"><span style="width:${(Math.abs(v) / max) * 100}%;background:${monthColor(i)}"></span></span>
                <span class="month-bar-value${v === 0 ? " zero" : ""}">${money(v)}</span>
              </button>`;
            })
            .join("")}
        </div>
      </section>`;
  }

  let merchants = "";
  if (txns.length > 1) {
    const groups = new Map();
    for (const t of txns) {
      const g = groups.get(t.merchant) || { name: t.merchant, total: 0, count: 0 };
      g.total += t.amount;
      g.count += 1;
      groups.set(t.merchant, g);
    }
    const top = [...groups.values()].sort((a, b) => b.total - a.total).slice(0, 5);
    if (groups.size > 1) {
      merchants = `
        <section class="drawer-section">
          <h3>Top merchants</h3>
          <ul class="merchant-list">
            ${top
              .map(
                (g) => `<li>
                  <span class="merchant-name">${escapeHtml(g.name)}</span>
                  <span class="merchant-count">${plural(g.count, "payment")}</span>
                  <span class="merchant-total">${money(g.total)}</span>
                </li>`
              )
              .join("")}
          </ul>
        </section>`;
    }
  }

  let payments;
  if (txns.length) {
    const items = txnListHtml(txns, { groupByMonth: month === "all" });
    payments = `
      <section class="drawer-section">
        <h3>Payments <span class="muted">· newest first</span></h3>
        <ul class="txn-list">${items}</ul>
      </section>`;
  } else {
    const hasAnyDetails = state.transactions.length > 0;
    payments = `
      <section class="drawer-section">
        <p class="drawer-empty">${
          scopeTotal === 0
            ? "No spending in this category for the selected period."
            : hasAnyDetails
              ? "No payment-level details for this period. It was imported from a summary file."
              : "Only monthly totals are loaded. Import the Excel workbook (with its Payment details sheet) to see individual payments."
        }</p>
      </section>`;
  }

  els.drawerBody.innerHTML = stats + byMonth + merchants + payments;
  els.drawerBody.scrollTop = 0;
}

const isXlsx = (name = "") => /\.xlsx$/i.test(name);

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function importMatrix(matrix, label) {
  // A file replaces the months it covers, which would drop entries added by hand in those months.
  const spendMonths = new Set(matrix.months);
  const incomeMonths = new Set(matrix.income?.months || []);
  const manualTxns = state.transactions.filter((t) => t.manual && spendMonths.has(t.month));
  const manualDeposits = matrix.income ? state.deposits.filter((d) => d.manual && incomeMonths.has(d.month)) : [];
  const manualCount = manualTxns.length + manualDeposits.length;
  const keepManual =
    manualCount > 0 &&
    window.confirm(
      `This file covers months where you added ${plural(manualCount, "entry", "entries")} by hand.\n\n` +
        "OK: keep them as well (if they aren't in the file).\nCancel: use the file only."
    );
  mergeIntoState(matrix, label);
  if (keepManual) {
    for (const t of manualTxns) {
      state.transactions.push(t);
      applySpending(t, 1);
    }
    for (const d of manualDeposits) {
      state.deposits.push(d);
      applyIncome(d, 1);
    }
    sortEntries();
    persist();
  }
  render();
  const detail = matrix.transactions
    ? ` with ${plural(matrix.transactions.length, "payment")}`
    : "";
  setStatus(
    `Merged ${plural(matrix.months.length, "month")}${detail} from ${label}. Click any category to see its payments.`,
    "ok"
  );
}

async function parseFile(file) {
  const hint = { monthName: guessMonthFromName(file.name) };
  if (isXlsx(file.name)) {
    return extractMatrixFromWorkbook(await readXlsx(await file.arrayBuffer()), hint);
  }
  return extractMatrix(await file.text(), hint);
}

async function importFiles(fileList) {
  const files = [...fileList].filter(
    (f) =>
      /\.(csv|xlsx)$/i.test(f.name) || f.type.includes("csv") || f.type === "text/plain"
  );
  if (!files.length) {
    setStatus("Please choose a .xlsx or .csv file.", "err");
    return;
  }
  try {
    for (const file of files) {
      importMatrix(await parseFile(file), file.name);
    }
  } catch (err) {
    setStatus(err.message || "Could not import that file.", "err");
  }
}

function exportMergedCsv() {
  const { categoryTotals, monthTotals, grand } = computeTotals();
  const headers = [
    "Category",
    ...state.months.map((m) => `${m} (CAD)`),
    "Total (CAD)",
    "Average per month (CAD)",
    "Share of total (%)",
  ];
  const monthCount = state.months.length || 1;
  const lines = [headers.map(csvEscape).join(",")];
  for (const item of categoryTotals) {
    const cells = [
      item.category,
      ...state.months.map((m) => (item.row[m] || 0).toFixed(2)),
      item.total.toFixed(2),
      (item.total / monthCount).toFixed(2),
      grand ? ((item.total / grand) * 100).toFixed(2) : "0.00",
    ];
    lines.push(cells.map(csvEscape).join(","));
  }
  lines.push(
    [
      "TOTAL",
      ...state.months.map((m) => (monthTotals[m] || 0).toFixed(2)),
      grand.toFixed(2),
      (grand / monthCount).toFixed(2),
      "100.00",
    ]
      .map(csvEscape)
      .join(",")
  );
  if (hasIncome()) {
    const { byMonth, grand: incomeGrand } = computeIncome();
    const row = (label, valueOf, total) =>
      [label, ...state.months.map((m) => valueOf(m).toFixed(2)), total.toFixed(2), (total / monthCount).toFixed(2), ""]
        .map(csvEscape)
        .join(",");
    lines.push(row("INCOME", (m) => byMonth[m] || 0, incomeGrand));
    lines.push(row("SAVED", (m) => (byMonth[m] || 0) - (monthTotals[m] || 0), incomeGrand - grand));
  }
  const running = (label, valueOf) => {
    let sum = 0;
    const values = state.months.map((m) => (sum += valueOf(m)));
    return [label, ...values.map((v) => v.toFixed(2)), sum.toFixed(2), "", ""].map(csvEscape).join(",");
  };
  lines.push(running("SPENT SO FAR", (m) => monthTotals[m] || 0));
  if (hasIncome()) {
    const { byMonth } = computeIncome();
    lines.push(running("MONEY YOU HAVE", (m) => (byMonth[m] || 0) - (monthTotals[m] || 0)));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "spendly-spending-merged.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/* ---------- Entries added by hand ---------- */

const round2 = (n) => Math.round(n * 100) / 100;

function monthOfDate(iso) {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

function ensureMonth(month) {
  if (!state.months.includes(month)) state.months = sortMonths([...state.months, month]);
}

function sortEntries() {
  state.transactions.sort((a, b) => a.date.localeCompare(b.date));
  state.deposits.sort((a, b) => a.date.localeCompare(b.date));
}

/** Adds (sign 1) or removes (sign −1) a payment's amount from the monthly totals. */
function applySpending(t, sign) {
  ensureMonth(t.month);
  let row = state.rows.find((r) => r.category === t.category);
  if (!row) {
    row = { category: t.category };
    state.rows.push(row);
    state.categories.push(t.category);
  }
  row[t.month] = round2((row[t.month] || 0) + sign * t.amount);
}

function applyIncome(d, sign) {
  ensureMonth(d.month);
  const month = (state.income[d.month] ||= {});
  const v = round2((month[d.source] || 0) + sign * d.amount);
  if (Math.abs(v) < 0.005) delete month[d.source];
  else month[d.source] = v;
  if (!Object.keys(month).length) delete state.income[d.month];
}

/** Drops a month once nothing at all is recorded in it. */
function pruneMonth(month) {
  const used =
    state.rows.some((r) => Math.abs(r[month] || 0) >= 0.005) ||
    state.income[month] ||
    state.transactions.some((t) => t.month === month) ||
    state.deposits.some((d) => d.month === month);
  if (used) return;
  state.months = state.months.filter((m) => m !== month);
  for (const r of state.rows) delete r[month];
}

function addManualEntry({ kind, amount, category, description, date, notes }) {
  const id = `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const month = monthOfDate(date);
  if (kind === "income") {
    const d = { id, manual: true, date, month, source: category, description: description || category, amount, notes };
    state.deposits.push(d);
    applyIncome(d, 1);
  } else {
    const t = {
      id,
      manual: true,
      date,
      month,
      merchant: description || category,
      category,
      type: amount < 0 ? "Refund" : "Charge",
      amount,
      statement: null,
      adjustment: 0,
      review: "",
      notes,
    };
    state.transactions.push(t);
    applySpending(t, 1);
  }
  if (!state.sources.includes("Added by hand")) state.sources.push("Added by hand");
  sortEntries();
  persist();
  render();
  if (drawerState.category) renderDrawer();
}

function deleteManualEntry(id) {
  const t = state.transactions.find((x) => x.id === id && x.manual);
  const d = state.deposits.find((x) => x.id === id && x.manual);
  if (t) {
    applySpending(t, -1);
    state.transactions = state.transactions.filter((x) => x !== t);
  }
  if (d) {
    applyIncome(d, -1);
    state.deposits = state.deposits.filter((x) => x !== d);
  }
  const entry = t || d;
  if (!entry) return;
  pruneMonth(entry.month);
  persist();
  render();
  if (drawerState.category) renderDrawer();
}

function entryKind() {
  return els.entryForm.elements.kind.value;
}

function syncEntryKind() {
  const income = entryKind() === "income";
  const form = els.entryForm.elements;
  els.entryForm.querySelector('[data-kind-label="category"]').textContent = income ? "Source" : "Category";
  els.entryForm.querySelector('[data-kind-label="description"]').textContent = income ? "From" : "Merchant";
  form.category.placeholder = income ? "e.g. Payroll" : "e.g. Groceries";
  form.description.placeholder = income ? "e.g. Employer name" : "e.g. No Frills";
  const names = income
    ? computeIncome().sources.map((s) => s.source)
    : computeTotals().categoryTotals.map((c) => c.category);
  els.entryCategories.innerHTML = names.map((n) => `<option value="${escapeAttr(n)}"></option>`).join("");
}

function openEntry() {
  const form = els.entryForm;
  form.reset();
  const now = new Date();
  form.elements.date.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  els.entryError.hidden = true;
  syncEntryKind();
  els.entryDrawer.hidden = false;
  document.body.classList.add("entry-open");
  requestAnimationFrame(() => els.entryDrawer.classList.add("is-open"));
  setTimeout(() => form.elements.amount.focus(), 250);
}

function closeEntry() {
  if (els.entryDrawer.hidden) return;
  els.entryDrawer.classList.remove("is-open");
  document.body.classList.remove("entry-open");
  setTimeout(() => {
    if (!els.entryDrawer.classList.contains("is-open")) els.entryDrawer.hidden = true;
  }, 220);
}

function submitEntry(e) {
  e.preventDefault();
  const form = els.entryForm.elements;
  const raw = form.amount.value.trim();
  const amount = round2(toNumber(raw));
  const category = form.category.value.trim();
  const date = form.date.value;
  let error = "";
  if (!raw || !amount) error = "Enter an amount.";
  else if (!category) error = entryKind() === "income" ? "Enter where the money came from." : "Pick or type a category.";
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) error = "Pick a date.";
  els.entryError.hidden = !error;
  els.entryError.textContent = error;
  if (error) return;
  addManualEntry({
    kind: entryKind(),
    amount,
    category,
    description: form.description.value.trim(),
    date,
    notes: form.notes.value.trim(),
  });
  closeEntry();
}

/** Data only ever comes from files picked on this device and lives in its local storage. */
function loadSaved() {
  if (!loadPersisted()) state = emptyState();
  render();
}

function registerOffline() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

function wireEvents() {
  els.input.addEventListener("change", (e) => {
    importFiles(e.target.files);
    e.target.value = "";
  });

  els.reset.addEventListener("click", () => {
    if (!window.confirm("Remove all spending data from this device? You can add your workbook again anytime.")) return;
    clearPersisted();
    state = emptyState();
    closeDrawer();
    render();
  });

  els.exportBtn.addEventListener("click", exportMergedCsv);
  const refreshCompare = () => {
    if (!state.months.length) return;
    const { categoryTotals } = computeTotals();
    renderCompare(categoryTotals);
  };
  els.compareCount?.addEventListener("change", refreshCompare);
  els.compareSort?.addEventListener("change", refreshCompare);
  for (const [from, to] of rangePickers()) {
    const onChange = () => {
      monthRange = { from: from.value, to: to.value };
      renderRangePickers();
      if (!state.months.length) return;
      const { categoryTotals, monthTotals, grand } = computeTotals();
      renderCompare(categoryTotals);
      renderTable(categoryTotals, monthTotals, grand);
    };
    from.addEventListener("change", onChange);
    to.addEventListener("change", onChange);
  }

  // Files can be dropped anywhere on the page; the overlay only shows while dragging.
  const dz = els.dropzone;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
  let dragDepth = 0;
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    dz.hidden = false;
  });
  window.addEventListener("dragover", (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dz.hidden = true;
  });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dz.hidden = true;
    importFiles(e.dataTransfer.files);
  });

  els.shareMonth.addEventListener("change", () => {
    if (!state.months.length) return;
    renderCategoryBreakdown(computeTotals().categoryTotals);
  });

  els.monthChart.addEventListener("pointermove", (e) => {
    if (e.pointerType === "mouse") setMonthHover(monthAtPoint(e.clientX));
  });
  els.monthChart.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") setMonthHover(-1);
  });
  els.monthChart.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    const i = monthAtPoint(e.clientX);
    setMonthHover(i === monthChartHover ? -1 : i);
  });
  document.addEventListener("pointerdown", (e) => {
    if (monthChartHover >= 0 && e.pointerType !== "mouse" && e.target !== els.monthChart) setMonthHover(-1);
  });

  // Mouse: hover shows a slice, click opens it. Touch has no hover, so the first tap
  // selects a slice and a second tap on it (or the center) opens its payments.
  let sharePointer = "mouse";
  const sliceIndex = (hit) => (typeof hit === "number" ? hit : -1);
  els.shareChart.addEventListener("pointerdown", (e) => {
    sharePointer = e.pointerType || "mouse";
  });
  els.shareChart.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    setActiveShare(sliceIndex(sliceAtPoint(e.clientX, e.clientY)));
  });
  els.shareChart.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") setActiveShare(-1);
  });
  els.shareChart.addEventListener("click", (e) => {
    const s = shareChartState;
    if (!s) return;
    const hit = sliceAtPoint(e.clientX, e.clientY);
    const open = (i) => openCategory(s.items[i].category, els.shareMonth.value);
    if (sharePointer === "mouse") {
      if (sliceIndex(hit) >= 0) open(hit);
      return;
    }
    const selected = s.tapHint ? s.activeIndex : -1;
    if (selected >= 0 && (hit === selected || hit === "hole")) {
      open(selected);
      setActiveShare(-1);
    } else {
      const idx = sliceIndex(hit);
      setActiveShare(idx, idx >= 0);
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (shareChartState?.tapHint && e.target !== els.shareChart) setActiveShare(-1);
  });

  const openFromTarget = (target) => {
    const el = target.closest("[data-category]");
    if (!el) return false;
    let month = "all";
    if (el.closest("#rank-list")) month = els.shareMonth.value;
    else if (el.closest("#payments-list")) month = els.paymentsMonth.value;
    openCategory(el.dataset.category, month);
    return true;
  };

  els.tabs.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tab]");
    if (btn) setTab(btn.dataset.tab);
  });
  els.tabs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const step = e.key === "ArrowRight" ? 1 : -1;
    const shown = TABS.filter((t) => !els.tabs.querySelector(`[data-tab="${t}"]`).hidden);
    const next = shown[(shown.indexOf(activeTab) + step + shown.length) % shown.length];
    setTab(next);
    els.tabs.querySelector(`[data-tab="${next}"]`).focus();
  });
  window.addEventListener("hashchange", () => setTab(location.hash.slice(1), { scroll: false }));

  els.paymentsMonth.addEventListener("change", renderPayments);
  els.incomeMonth.addEventListener("change", renderIncome);
  for (const list of [els.paymentsList, els.depositsList]) {
    list.addEventListener("click", (e) => {
      const note = e.target.closest(".txn-notes");
      if (note) note.classList.toggle("is-expanded");
    });
  }
  document.addEventListener("click", (e) => {
    if (els.drawer.contains(e.target)) return;
    openFromTarget(e.target);
  });
  els.rankList.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && openFromTarget(e.target)) e.preventDefault();
  });

  els.drawer.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) {
      closeDrawer();
      return;
    }
    const note = e.target.closest(".txn-notes");
    if (note) {
      note.classList.toggle("is-expanded");
      return;
    }
    const monthBtn = e.target.closest("[data-month]");
    if (monthBtn) {
      drawerState.month = monthBtn.dataset.month;
      renderDrawer();
    }
  });
  els.drawerMonths.addEventListener("change", () => {
    drawerState.month = els.drawerMonths.value;
    renderDrawer();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!els.entryDrawer.hidden) closeEntry();
    else if (drawerState.category) closeDrawer();
  });

  els.entryOpen.addEventListener("click", openEntry);
  els.entryDrawer.addEventListener("click", (e) => {
    if (e.target.closest("[data-entry-close]")) closeEntry();
  });
  els.entryForm.addEventListener("change", (e) => {
    if (e.target.name === "kind") syncEntryKind();
  });
  els.entryForm.addEventListener("submit", submitEntry);
  // Capture phase, so deleting doesn't also open a category or toggle a note.
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest("[data-delete-entry]");
      if (!btn) return;
      e.stopPropagation();
      if (window.confirm("Delete this entry?")) deleteManualEntry(btn.dataset.deleteEntry);
    },
    true
  );
  els.rankList.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const li = e.target.closest("li");
    if (li) setActiveShare([...els.rankList.children].indexOf(li));
  });
  els.rankList.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "mouse") setActiveShare(-1);
  });

  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(redrawCharts);
  });

  document.fonts?.ready.then(redrawCharts);
}

wireEvents();
loadSaved();
registerOffline();
