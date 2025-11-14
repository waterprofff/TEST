/* price-v2.js
 * Генерация таблицы прайса из Google Sheets.
 * HTML не содержит товаров и цен, только шапку таблицы.
 */

const CSV_DELIMITER = ",";
const ENABLE_PROMOS = true;           // выключить акции: false
const DISCOUNT_MODE = "current";      // 'current' | 'baseOnly' | 'promoOnly'
const fmtMoney = n => (Number(n) || 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 });
const bust = url => url + (url.includes("?") ? "&" : "?") + "cb=" + Date.now();

/* ===== CSV + даты + промо ===== */
function parseCsv(text, delimiter) {
  const rows = []; let row = []; let val = ""; let q = false;
  const pushVal = () => { row.push(val); val=""; };
  const pushRow = () => { rows.push(row); row=[]; };
  for (let i=0;i<text.length;i++){
    const ch=text[i];
    if(q){
      if(ch==='"'){ if(text[i+1]==='"'){ val+='"'; i++; } else { q=false; } }
      else val+=ch;
    }else{
      if(ch==='"') q=true;
      else if(ch===delimiter) pushVal();
      else if(ch==='\n'){ pushVal(); pushRow(); }
      else if(ch!=='\r') val+=ch;
    }
  }
  if(val.length||row.length){ pushVal(); pushRow(); }
  const [head,...data]=rows; if(!head) return [];
  const names=head.map(h=>String(h||"").trim());
  return data
    .filter(r=>r.length && r.some(c=>String(c).trim()))
    .map(r => Object.fromEntries(names.map((h,i)=>[h, r[i]!=null? String(r[i]).trim() : ""])));
}

function parseRuDate(s) {
  if (!s) return null;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return new Date(+yyyy, +mm - 1, +dd);
}
function isPromoActive(item, today = new Date()) {
  if (!ENABLE_PROMOS) return false;
  const s = parseRuDate(item.promo_start);
  const e = parseRuDate(item.promo_end);
  if (!s || !e) return false;
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const s0 = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const e0 = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  return t0 >= s0 && t0 <= e0;
}
function toNumber(x) {
  const s = String(x ?? "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, "")
    .replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
function computePrices(item) {
  const base = toNumber(item.price);
  let promoActive = isPromoActive(item);
  let promo = null;
  if (promoActive) {
    if (item.promo_price) {
      const v = toNumber(item.promo_price);
      if (Number.isFinite(v) && v>0) promo = v;
    }
    if (promo == null && item.promo_discount) {
      const d = toNumber(item.promo_discount);
      if (Number.isFinite(d) && d>0) promo = Math.round(base * (1 - d/100));
    }
    if (promo == null) promoActive = false;
  }
  return { base, promoActive, promo };
}

/* ===== Загрузка CSV ===== */
async function loadCsv(url) {
  const u = bust(url);
  const res = await fetch(u, { cache: "no-store", redirect: "follow" });
  if (!res.ok) throw new Error(`CSV HTTP ${res.status}`);
  const text = await res.text();
  if (!text || text.length < 10) throw new Error("CSV пустой или слишком короткий");
  return parseCsv(text, CSV_DELIMITER);
}

/* ===== Рисуем таблицу с нуля ===== */
function buildCategoryRow(categoryName) {
  const tr = document.createElement("tr");
  tr.className = "subcat";
  const td = document.createElement("td");
  td.colSpan = 9;
  td.textContent = categoryName;
  tr.appendChild(td);
  return tr;
}

function buildItemRow(item) {
  const { base, promoActive, promo } = computePrices(item);
  const tr = document.createElement("tr");

  const cells = [
    item.article || "",
    item.name || "",
    item.description || "",
    item.pack || "",
    item.pallet || "",
    fmtMoney(base),
    promoActive && promo!=null ? fmtMoney(promo) : "",
    item.image_url
      ? `<img loading="lazy" src="${item.image_url}" alt="" style="max-width:90px;max-height:90px;border-radius:4px;">`
      : "",
    item.product_url
      ? `<a class="urla" href="${item.product_url}" target="_blank" rel="noopener">перейти</a>`
      : ""
  ];

  cells.forEach((html, idx) => {
    const td = document.createElement("td");
    if (idx === 5) td.className = "price";
    if (idx === 6) td.className = "promo";
    td.innerHTML = html;
    tr.appendChild(td);
  });

  // сохраняем данные для "Пересчитать / Сброс"
  tr.dataset.article = String(item.article || "");
  tr.dataset.base = String(base);
  tr.dataset.promo = promo!=null ? String(promo) : "";
  tr.dataset.promoActive = String(!!(promoActive && promo!=null));

  return tr;
}

function renderTable(tbody, items) {
  tbody.innerHTML = "";
  // группируем по category
  const groups = {};
  for (const item of items) {
    const cat = item.category || "";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  }

  const categories = Object.keys(groups).sort((a, b) => {
    const ca = groups[a][0], cb = groups[b][0];
    const sa = parseInt(ca.category_sort || "0", 10) || 0;
    const sb = parseInt(cb.category_sort || "0", 10) || 0;
    return sa - sb || a.localeCompare(b, "ru");
  });

  categories.forEach(cat => {
    if (cat) tbody.appendChild(buildCategoryRow(cat));
    const arr = groups[cat].slice().sort((a,b) => {
      const sa = parseInt(a.sort || "0", 10) || 0;
      const sb = parseInt(b.sort || "0", 10) || 0;
      return sa - sb;
    });
    arr.forEach(item => tbody.appendChild(buildItemRow(item)));
  });
}

/* ===== Пересчитать/Сброс ===== */
function applyDiscount(tbody, percent) {
  const p = Math.max(0, Math.min(99, Number(percent) || 0));
  tbody.querySelectorAll("tr").forEach(tr => {
    if (tr.classList.contains("subcat")) return;
    const tdPrice = tr.querySelector("td.price");
    const tdPromo = tr.querySelector("td.promo");
    if (!tdPrice) return;

    let visibleBase;
    if (tdPromo && tdPromo.textContent.trim()) {
      visibleBase = toNumber(tdPromo.textContent);
    } else {
      visibleBase = toNumber(tdPrice.textContent);
    }
    const discounted = Math.round(visibleBase * (1 - p/100));

    if (tdPromo && tdPromo.textContent.trim()) {
      tdPromo.textContent = fmtMoney(discounted);
      tdPrice.classList.add("old");
    } else {
      tdPrice.textContent = fmtMoney(discounted);
      if (tdPromo) tdPromo.textContent = "";
      tdPrice.classList.remove("old");
    }
  });
}

function resetFromItems(tbody, items) {
  const map = new Map(items.map(it => [String(it.article || ""), it]));
  tbody.querySelectorAll("tr").forEach(tr => {
    if (tr.classList.contains("subcat")) return;
    const art = tr.dataset.article || "";
    const item = map.get(art);
    if (!item) return;

    const { base, promoActive, promo } = computePrices(item);
    const tdPrice = tr.querySelector("td.price");
    const tdPromo = tr.querySelector("td.promo");

    if (tdPrice) tdPrice.textContent = fmtMoney(base);
    if (tdPromo) {
      if (promoActive && promo!=null) {
        tdPromo.textContent = fmtMoney(promo);
        tdPrice && tdPrice.classList.add("old");
      } else {
        tdPromo.textContent = "";
        tdPrice && tdPrice.classList.remove("old");
      }
    }
  });
}

/* ===== MAIN ===== */
(async function main() {
  try {
    const tbody = document.getElementById("price-body");
    if (!tbody) return;
    const csvUrl = tbody.dataset.csvUrl;
    if (!csvUrl) throw new Error("Не указан data-csv-url у #price-body");
    const list = (tbody.dataset.list || "").toLowerCase(); // byt / prom

    const raw = await loadCsv(csvUrl);

    const items = raw
      .filter(x => list ? (x.list || "").toLowerCase() === list : true)
      .map(x => ({
        list: x.list ?? "",
        category: x.category ?? "",
        category_sort: x.category_sort ?? "",
        sort: x.sort ?? "",
        article: x.article ?? "",
        name: x.name ?? "",
        description: x.description ?? "",
        pack: x.pack ?? "",
        pallet: x.pallet ?? "",
        price: x.price ?? "",
        promo_price: x.promo_price ?? "",
        promo_discount: x.promo_discount ?? "",
        promo_start: x.promo_start ?? "",
        promo_end: x.promo_end ?? "",
        image_url: x.image_url ?? "",
        product_url: x.product_url ?? ""
      }));

    renderTable(tbody, items);

    const input = document.getElementById("discount");
    const btnApply = document.getElementById("applyDiscount");
    const btnReset = document.getElementById("resetDiscount");

    if (btnApply && input) btnApply.addEventListener("click", () => applyDiscount(tbody, input.value));
    if (btnReset) btnReset.addEventListener("click", () => {
      resetFromItems(tbody, items);
      if (input) input.value = "";
    });

  } catch (e) {
    console.error("[price-v2]", e);
  }
})();
