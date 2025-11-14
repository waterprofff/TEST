/* price-byt-inplace.js
 * НИЧЕГО не перестраиваем. Обновляем только содержимое ячеек
 * по текущей верстке (всё оформление, классы и вложенности остаются).
 *
 * Где менять ссылку на CSV:
 *   const CSV_URL = ".../pub?output=csv"
 *
 * Как включить/выключить логику акций:
 *   const ENABLE_PROMOS = true/false
 *
 * Куда писать новые поля:
 *   см. блок "APPLY_TO_ROW" — там показано, куда кладём image_url, product_url и т.д.
 */

const CSV_URL = "https://docs.google.com/spreadsheets/d/14WyLMRfoAQaJ5ShXM0QFjd2K_iLueFMejbhQns66gcw/export?format=csv&gid=1862196171"; // ← ваш общий URL
const LIST_FILTER = "byt";        // эта страница — бытовой прайс
const ENABLE_PROMOS = true;       // выключить акции: false
const CSV_DELIMITER = ",";        // CSV Google Sheets
const DISCOUNT_MODE = "current";  // 'current' | 'baseOnly' | 'promoOnly'
const fmtMoney = n => (Number(n)||0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const bust = url => url + (url.includes("?") ? "&" : "?") + "cb=" + Date.now();

/* --- CSV парсер (бережно к кавычкам) --- */
function parseCsv(text, delimiter) {
  const rows = []; let row = []; let val = ""; let q = false;
  const pushVal = () => { row.push(val); val=""; };
  const pushRow = () => { rows.push(row); row=[]; };
  for (let i=0;i<text.length;i++){
    const ch=text[i];
    if(q){
      if(ch==='"'){ if(text[i+1]==='"'){ val+='"'; i++; } else { q=false; } }
      else val+=ch;
    } else {
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
    .map(r=>Object.fromEntries(names.map((h,i)=>[h, r[i]!=null? String(r[i]).trim() : ""])));
}

/* --- Акции --- */
function parseRuDate(s){ if(!s) return null;
  const m=/^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s.trim()); if(!m) return null;
  const [,dd,mm,yyyy]=m; return new Date(+yyyy, +mm-1, +dd);
}
function isPromoActive(item, today=new Date()){
  if(!ENABLE_PROMOS) return false;
  const s=parseRuDate(item.promo_start), e=parseRuDate(item.promo_end);
  if(!s||!e) return false;
  const t0=new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const s0=new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const e0=new Date(e.getFullYear(), e.getMonth(), e.getDate());
  return t0>=s0 && t0<=e0;
}
function computePrices(item){
  const base = Number(item.price)||0;
  let promoActive = isPromoActive(item);
  let promo = null;
  if(promoActive){
    if(item.promo_price!==""){
      const v=Number(item.promo_price); if(!Number.isNaN(v)) promo=v;
    }
    if(promo==null && item.promo_discount!==""){
      const d=Number(item.promo_discount); if(!Number.isNaN(d)) promo=Math.round(base*(1-d/100));
    }
    if(promo==null) promoActive=false;
  }
  return { base, promoActive, promo };
}

/* --- Загрузка CSV --- */
async function loadCsv(url){
  const res = await fetch(bust(url), { cache: "no-store", redirect: "follow" });
  if(!res.ok) throw new Error(`CSV HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  if (!text || text.length < 10) throw new Error("CSV пустой или слишком короткий.");
  return parseCsv(text, CSV_DELIMITER);
}

/* --- Мапа колонок по заголовкам таблицы (не ломаем верстку) --- */
function mapColumns(table){
  const ths = Array.from(table.querySelectorAll("thead th"));
  const texts = ths.map(th=>th.textContent.replace(/\s+/g," ").trim().toLowerCase());
  return {
    // индексы известных колонок; если чего-то нет — вернет -1
    article: texts.findIndex(t=>/артикул/.test(t)),
    name: texts.findIndex(t=>/наимен/.test(t)),
    description: texts.findIndex(t=>/описан/.test(t)),
    pack: texts.findIndex(t=>/упак/.test(t)),
    pallet: texts.findIndex(t=>/палет|палета/.test(t)),
    price: texts.findIndex(t=>/цена/.test(t)),
    promo: texts.findIndex(t=>/акци/.test(t)),
    image: texts.findIndex(t=>/фото|image/.test(t)),
    link: texts.findIndex(t=>/карточ|перейти|product|ссылка/.test(t)),
  };
}

/* --- Присвоение значений в СУЩЕСТВУЮЩУЮ строку (не меняем структуру ячеек) --- */
function APPLY_TO_ROW(tr, item, columns){
  const { base, promoActive, promo } = computePrices(item);
  const tds = tr.children;

  // вспом: получить td по индексу, если такой столбец есть
  const tdAt = idx => (idx>=0 && idx < tds.length) ? tds[idx] : null;

  // артикул
  const tdArticle = tdAt(columns.article);
  if(tdArticle && item.article) tdArticle.textContent = item.article;

  // наименование/описание — заполняем только если пришло в CSV (не ломаем оригинальные подписи)
  const tdName = tdAt(columns.name);
  if(tdName && item.name) tdName.textContent = item.name;

  const tdDesc = tdAt(columns.description);
  if(tdDesc && item.description) tdDesc.textContent = item.description;

  // упаковка/палета
  const tdPack = tdAt(columns.pack);
  if(tdPack && item.pack) tdPack.textContent = item.pack;

  const tdPallet = tdAt(columns.pallet);
  if(tdPallet && item.pallet) tdPallet.textContent = item.pallet;

  // базовая цена
  const tdPrice = tdAt(columns.price);
  if(tdPrice) tdPrice.textContent = fmtMoney(base);

  // АКЦИЯ
  const tdPromo = tdAt(columns.promo);
  if(tdPromo){
    if(promoActive && promo!=null){
      tdPromo.textContent = fmtMoney(promo);
      tdPromo.classList.add("promo");    // стили акции у вас уже есть
      tdPrice && tdPrice.classList.add("old");
    }else{
      tdPromo.textContent = "";          // нет акции
      tdPromo.classList.remove("promo");
      tdPrice && tdPrice.classList.remove("old");
    }
  }

  // Фото
  const tdImg = tdAt(columns.image);
  if(tdImg && item.image_url){
    const img = tdImg.querySelector("img") || document.createElement("img");
    img.loading = "lazy";
    img.src = item.image_url;
    img.alt = img.alt || "";
    // оставляем ваши инлайновые стили/классы как есть
    if(!img.parentElement) tdImg.appendChild(img);
  }

  // Ссылка «перейти»
  const tdLink = tdAt(columns.link);
  if(tdLink && item.product_url){
    const a = tdLink.querySelector("a") || document.createElement("a");
    a.className = a.className || "urla";
    a.target = "_blank"; a.rel = "noopener";
    a.href = item.product_url;
    a.textContent = a.textContent || "перейти";
    if(!a.parentElement) tdLink.appendChild(a);
  }

  // Для кнопок «Пересчитать/Сброс» сохраним исходные значения в data-атрибутах
  tr.dataset.base = String(base);
  tr.dataset.promo = (promo!=null? String(promo) : "");
  tr.dataset.promoActive = String(!!(promoActive && promo!=null));
}

/* --- Массовое применение скидки --- */
function applyDiscount(percent){
  const p = Math.max(0, Math.min(99, Number(percent)||0));
  const table = document.querySelector("table.price"); if(!table) return;
  const cols = mapColumns(table);
  table.querySelectorAll("tbody tr").forEach(tr=>{
    if(tr.classList.contains("subcat")) return; // категории пропускаем
    const base = Number(tr.dataset.base||0);
    const promoActive = tr.dataset.promoActive==='true';
    const promo = tr.dataset.promo ? Number(tr.dataset.promo) : null;
    let target = base;
    // DISCOUNT_MODE = 'current': если есть акция — считаем от неё, иначе от базовой
    if(DISCOUNT_MODE==='current') target = (promoActive && promo!=null) ? promo : base;
    if(DISCOUNT_MODE==='promoOnly') target = (promoActive && promo!=null) ? promo : base;
    if(DISCOUNT_MODE==='baseOnly') target = base;

    const discounted = Math.round(target*(1 - p/100));
    const tds = tr.children;
    const tdPrice = (cols.price>=0)? tds[cols.price] : null;
    const tdPromo = (cols.promo>=0)? tds[cols.promo] : null;

    if(promoActive && promo!=null && tdPromo){
      tdPromo.textContent = fmtMoney(discounted);
      tdPromo.classList.add("promo");
      tdPrice && tdPrice.classList.add("old");
    } else if(tdPrice) {
      tdPrice.textContent = fmtMoney(discounted);
      if(tdPromo){ tdPromo.textContent = ""; tdPromo.classList.remove("promo"); }
      tdPrice.classList.remove("old");
    }
  });
}

/* --- Сброс к значениям из CSV --- */
function resetTable(originalMap){
  const table = document.querySelector("table.price"); if(!table) return;
  const cols = mapColumns(table);
  table.querySelectorAll("tbody tr").forEach(tr=>{
    if(tr.classList.contains("subcat")) return;
    const tds = tr.children;
    const artIdx = cols.article;
    if(artIdx < 0 || artIdx >= tds.length) return;
    const article = tds[artIdx]?.textContent.trim();
    if(!article) return;
    const item = originalMap.get(article);
    if(item) APPLY_TO_ROW(tr, item, cols);
  });
  const inp = document.getElementById("discount"); if(inp) inp.value="";
}

/* --- Главный поток --- */
(async function main(){
  try{
    const table = document.querySelector("table.price");
    if(!table){ console.warn("Таблица .price не найдена"); return; }
    const cols = mapColumns(table);
    if(cols.article<0){ console.error("Не найден столбец 'Артикул'"); return; }

    const raw = await loadCsv(CSV_URL);
    // берём только бытовые позиции
    const items = raw
      .filter(x => (x.list||"").toLowerCase() === LIST_FILTER)
      .map(x => ({
        article: x.article ?? "", name: x.name ?? "", description: x.description ?? "",
        pack: x.pack ?? "", pallet: x.pallet ?? "",
        price: x.price ?? "", promo_price: x.promo_price ?? "", promo_discount: x.promo_discount ?? "",
        promo_start: x.promo_start ?? "", promo_end: x.promo_end ?? "",
        image_url: x.image_url ?? "", product_url: x.product_url ?? ""
      }));

    // положим в Map по артикулу
    const byArticle = new Map(items.map(it => [String(it.article), it]));

    // пройдёмся по существующим строкам и только ОБНОВИМ содержимое
    table.querySelectorAll("tbody tr").forEach(tr=>{
      if(tr.classList.contains("subcat")) return; // категории не трогаем
      const tds = tr.children;
      const artCell = tds[cols.article];
      if(!artCell) return;
      const article = artCell.textContent.trim();
      if(!article) return;
      const item = byArticle.get(article);
      if(item) APPLY_TO_ROW(tr, item, cols);
    });

    // кнопки: Пересчитать/Сброс
    const btnApply = document.getElementById('applyDiscount');
    const btnReset = document.getElementById('resetDiscount');
    const input = document.getElementById('discount');
    if(btnApply && input) btnApply.addEventListener('click', ()=>applyDiscount(input.value));
    if(btnReset) btnReset.addEventListener('click', ()=>resetTable(byArticle));

    // Автообновление раз в 10 минут (можно выключить)
    setInterval(async()=>{
      try{
        const fresh = await loadCsv(CSV_URL);
        const freshItems = fresh
          .filter(x => (x.list||"").toLowerCase() === LIST_FILTER)
          .map(x => ({
            article: x.article ?? "", name: x.name ?? "", description: x.description ?? "",
            pack: x.pack ?? "", pallet: x.pallet ?? "",
            price: x.price ?? "", promo_price: x.promo_price ?? "", promo_discount: x.promo_discount ?? "",
            promo_start: x.promo_start ?? "", promo_end: x.promo_end ?? "",
            image_url: x.image_url ?? "", product_url: x.product_url ?? ""
          }));
        const freshMap = new Map(freshItems.map(it => [String(it.article), it]));
        resetTable(freshMap);
      }catch(e){ console.warn("Автообновление не удалось:", e); }
    }, 10*60*1000);

  }catch(e){ console.error(e); }
})();
