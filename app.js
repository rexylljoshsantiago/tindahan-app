/* ---------------- State ---------------- */
let products = [];
let sales = [];
let customers = [];
let cart = []; // {productId, name, price, qty}
let payMethod = 'cash';
let currentCustomerId = null;
let currentVoidSaleId = null;
let dataReady = false;
// When a PIN is set, this holds the AES key derived from it — set only after
// a correct unlock, cleared on lock/reload. If a PIN protects the store,
// nothing in loadData()/save*() ever touches plaintext without it.
let encryptionKey = null;

const peso = n => '₱' + Number(n||0).toLocaleString('en-PH', {minimumFractionDigits: (Number(n)%1===0?0:2), maximumFractionDigits:2});
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const todayStr = () => new Date().toISOString().slice(0,10);
// All money math is run through this — plain JS floats drift (e.g. 0.1+0.2 !== 0.3),
// and over enough charge/payment cycles that shows up as a balance like ₱79.999999999.
const round2 = n => Math.round((Number(n)||0) * 100 + (n>=0?1:-1)*Number.EPSILON) / 100;

/* ---------------- Storage ---------------- */
async function loadData(){
  try{
    const [p, s, c] = await Promise.all([
      safeGet('products'), safeGet('sales'), safeGet('customers')
    ]);
    products = p ? JSON.parse(await maybeDecrypt(p.value)) : seedProducts();
    sales = s ? JSON.parse(await maybeDecrypt(s.value)) : [];
    customers = c ? JSON.parse(await maybeDecrypt(c.value)) : seedCustomers();
    let migrated = false;
    products.forEach(pr=>{
      if(!pr.category){ pr.category = 'Others'; migrated = true; }
      else if(CATEGORY_RENAME[pr.category]){ pr.category = CATEGORY_RENAME[pr.category]; migrated = true; }
    });
    if(!p || migrated) await saveProducts();
    if(!s) await saveSales();
    if(!c) await saveCustomers();
  }catch(e){
    console.error('Load error', e);
    throw e; // let the caller (unlock flow / initApp) decide how to handle this —
              // for a locked store, a decrypt failure here means "wrong PIN", not
              // "corrupted data", and those need very different responses.
  }
  dataReady = true;
  restoreCart();
  document.getElementById('topbarSub').textContent = 'Ready — track stock, sales, and utang';
  renderAll();
}
async function safeGet(key){
  try{
    const raw = localStorage.getItem('tindahan_'+key);
    return raw !== null ? { value: raw } : null;
  }catch(e){ return null; }
}
async function saveProducts(){ try{ localStorage.setItem('tindahan_products', await maybeEncrypt(JSON.stringify(products))); }catch(e){ showToast('Could not save products'); throw e; } }
async function saveSales(){ try{ localStorage.setItem('tindahan_sales', await maybeEncrypt(JSON.stringify(sales))); }catch(e){ showToast('Could not save sales'); } }
async function saveCustomers(){ try{ localStorage.setItem('tindahan_customers', await maybeEncrypt(JSON.stringify(customers))); }catch(e){ showToast('Could not save customers'); } }
async function maybeEncrypt(text){ return encryptionKey ? await encryptText(encryptionKey, text) : text; }
async function maybeDecrypt(raw){ return encryptionKey ? await decryptText(encryptionKey, raw) : raw; }

const CATEGORIES = ['Beverages','Snacks','Canned Foods','Noodles & Instant','Rice & Staples','Condiments','Household Supplies','Personal Care','Candy & Sweets','Others'];
const CATEGORY_COLORS = {
  'Beverages':'#2B6777','Snacks':'#C98A1F','Canned Foods':'#A81F1F','Noodles & Instant':'#D62828',
  'Rice & Staples':'#7A6A3F','Condiments':'#B4762B','Household Supplies':'#4E6E58','Personal Care':'#7D5BA6',
  'Candy & Sweets':'#C24C7A','Others':'#8B8271'
};
const CATEGORY_RENAME = {'Drinks':'Beverages','Canned Goods':'Canned Foods','Household':'Household Supplies'};
function catColor(cat){ return CATEGORY_COLORS[cat] || CATEGORY_COLORS['Others']; }

function seedProducts(){
  return [];
}
function seedCustomers(){
  return [];
}

/* ---------------- Nav ---------------- */
function goTo(view){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById('view-'+view).classList.add('active');
  document.querySelectorAll('.navbtn').forEach(b=>b.classList.remove('active'));
  const nb = document.querySelector('.navbtn[data-view="'+view+'"]');
  if(nb) nb.classList.add('active');
  document.getElementById('cartBar').style.display = (view==='sales' && cart.length) ? 'flex' : 'none';
  if(view==='dashboard') renderDashboard();
  if(view==='inventory') renderInventory();
  if(view==='sales') renderPos();
  if(view==='utang') renderCustomers();
  if(view==='history') renderHistory();
  if(view==='settings') renderSettings();
}

let toastTimer = null;
function showToast(msg, duration=1800){
  const t = document.getElementById('toast');
  clearTimeout(toastTimer);
  t.innerHTML = esc(msg);
  t.classList.add('show');
  toastTimer = setTimeout(()=>t.classList.remove('show'), duration);
}
function showActionToast(msg, actionLabel, onAction, duration=5000){
  const t = document.getElementById('toast');
  clearTimeout(toastTimer);
  t.innerHTML = `<span>${esc(msg)}</span><button type="button" class="toast-action">${esc(actionLabel)}</button>`;
  t.classList.add('show');
  t.querySelector('.toast-action').onclick = (e)=>{
    e.stopPropagation();
    clearTimeout(toastTimer);
    t.classList.remove('show');
    onAction();
  };
  toastTimer = setTimeout(()=>t.classList.remove('show'), duration);
}

function renderAll(){ renderDashboard(); renderInventory(); renderPos(); renderCustomers(); }

/* ---------------- Dashboard ---------------- */
function renderOnboarding(){
  const el = document.getElementById('onboardingCard');
  const isEmpty = !products.length && !customers.length && !sales.length;
  if(!isEmpty){ el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = `
    <div class="card" style="background:var(--wall-tint); border-color:var(--wall);">
      <div style="font-weight:800; font-size:15px;">Welcome to your store 👋</div>
      <div style="font-size:13px; color:var(--ink-soft); margin-top:5px; margin-bottom:12px;">Start by adding what you sell. You can track stock, ring up sales, and keep tabs on utang once you've got a few products in.</div>
      <button class="btn btn-primary btn-block" onclick="goTo('inventory'); openProductModal();">+ Add Your First Product</button>
    </div>`;
}
function renderBackupReminder(){
  const el = document.getElementById('backupReminderCard');
  const hasData = products.length || sales.length || customers.length;
  if(!hasData){ el.style.display = 'none'; return; }
  const last = localStorage.getItem('tindahan_last_backup');
  const salesSince = parseInt(localStorage.getItem('tindahan_sales_since_backup')||'0', 10);
  let daysSince = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
  // Trip on whichever comes first — a week of calendar time, or enough
  // transactions that losing them would actually hurt. A store doing 20
  // sales a day shouldn't wait a full week to be reminded.
  const dueByTime = daysSince === null || daysSince >= 7;
  const dueByActivity = salesSince >= 15;
  if(!dueByTime && !dueByActivity){ el.style.display = 'none'; return; }
  el.style.display = 'block';
  let msg;
  if(!last) msg = `You haven't backed up your data yet — takes about 10 seconds.`;
  else if(dueByActivity && !dueByTime) msg = `${salesSince} sales since your last backup — worth another one.`;
  else msg = `Last backup was ${daysSince} day${daysSince===1?'':'s'} ago — worth another one.`;
  el.innerHTML = `
    <div class="card" style="display:flex; align-items:center; justify-content:space-between; gap:10px; border-color:var(--gold);">
      <div style="font-size:13px; color:var(--ink-soft); flex:1;">${esc(msg)}</div>
      <button class="btn btn-ghost btn-sm" style="flex:none;" onclick="goTo('settings')">Back Up</button>
    </div>`;
}
function renderDashboard(){
  renderOnboarding();
  renderBackupReminder();
  const today = todayStr();
  const todaySales = sales.filter(s=>s.date===today);
  const todayTotal = round2(todaySales.filter(s=>!s.voided).reduce((a,s)=>a+s.total,0));
  const totalUtang = round2(customers.reduce((a,c)=>a+c.balance,0));
  const lowStock = products.filter(p=>p.stock<=p.low);

  document.getElementById('statToday').textContent = peso(todayTotal);
  document.getElementById('statUtang').textContent = peso(totalUtang);
  document.getElementById('statLow').textContent = lowStock.length;
  document.getElementById('statProducts').textContent = products.length;
  document.getElementById('statProductsLine').textContent = products.length + ' product' + (products.length===1?'':'s') + ' in stock';

  const lsCard = document.getElementById('lowStockCard');
  if(!lowStock.length){
    lsCard.innerHTML = '<div class="empty">Stock levels look good 👍</div>';
  }else{
    lsCard.innerHTML = lowStock.slice(0,6).map(p=>`
      <div class="alert-row">
        <span>${esc(p.name)}</span>
        <span class="pill ${p.stock===0?'out':''}">${p.stock===0?'Out of stock':p.stock+' left'}</span>
      </div>`).join('');
  }

  const rsCard = document.getElementById('recentSalesCard');
  const recent = [...sales].filter(s=>!s.voided).sort((a,b)=>b.ts-a.ts).slice(0,5);
  if(!recent.length){
    rsCard.innerHTML = '<div class="empty">No sales recorded yet</div>';
  }else{
    rsCard.innerHTML = recent.map(s=>`
      <div class="alert-row">
        <span>${new Date(s.ts).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})} · ${s.items.length} item${s.items.length>1?'s':''} ${s.method==='utang'?'· utang':''}</span>
        <span class="num" style="font-weight:800;">${peso(s.total)}</span>
      </div>`).join('');
  }
}

/* ---------------- Sales History ---------------- */
let historyFilter = 'today';
const HISTORY_FILTERS = [
  {id:'today', label:'Today'},
  {id:'week', label:'This Week'},
  {id:'month', label:'This Month'},
  {id:'all', label:'All Time'},
];
function setHistoryFilter(id){ historyFilter = id; renderHistory(); }
function historyMatchesFilter(sale){
  const now = new Date();
  const d = new Date(sale.ts);
  if(historyFilter==='today') return sale.date===todayStr();
  if(historyFilter==='week'){
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate()-7);
    return d >= weekAgo;
  }
  if(historyFilter==='month'){
    return d.getFullYear()===now.getFullYear() && d.getMonth()===now.getMonth();
  }
  return true; // all
}
function renderHistory(){
  const chipsEl = document.getElementById('historyFilterChips');
  chipsEl.innerHTML = HISTORY_FILTERS.map(f=>
    `<button class="chip ${f.id===historyFilter?'active':''}" onclick="setHistoryFilter('${f.id}')">${f.label}</button>`
  ).join('');

  const q = (document.getElementById('historySearch').value||'').toLowerCase();
  let list = [...sales].filter(historyMatchesFilter);
  if(q){
    list = list.filter(s => s.items.some(i => i.name.toLowerCase().includes(q)));
  }
  list.sort((a,b)=>b.ts-a.ts);

  const total = round2(list.filter(s=>!s.voided).reduce((a,s)=>a+s.total,0));
  document.getElementById('historySummaryCard').innerHTML = `
    <div class="alert-row">
      <span>${list.length} sale${list.length===1?'':'s'}</span>
      <span class="num" style="font-weight:800;">${peso(total)}</span>
    </div>`;

  const listEl = document.getElementById('historyList');
  if(!list.length){
    listEl.innerHTML = '<div class="empty">No sales found</div>';
    return;
  }
  // Group by date for readability
  const groups = {};
  list.forEach(s=>{ (groups[s.date] = groups[s.date] || []).push(s); });
  const dateKeys = Object.keys(groups).sort((a,b)=>b.localeCompare(a));

  listEl.innerHTML = dateKeys.map(dateKey=>{
    const dayLabel = new Date(dateKey+'T00:00:00').toLocaleDateString('en-PH',{weekday:'short', month:'short', day:'numeric'});
    const rows = groups[dateKey].map(s=>{
      const itemsSummary = s.items.map(i=>`${esc(i.name)} ×${i.qty}`).join(', ');
      return `
      <div class="alert-row" style="align-items:flex-start; ${s.voided?'opacity:.5;':''}">
        <div style="max-width:66%;">
          <div>${new Date(s.ts).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})} ${s.method==='utang'?'<span class="pill" style="margin-left:4px;">Utang</span>':''} ${s.voided?'<span class="pill out" style="margin-left:4px;">Voided</span>':''}</div>
          <div style="font-size:12px; color:var(--ink-soft); margin-top:2px; ${s.voided?'text-decoration:line-through;':''}">${itemsSummary}</div>
        </div>
        <div style="text-align:right;">
          <div class="num" style="font-weight:800; white-space:nowrap; ${s.voided?'text-decoration:line-through;':''}">${peso(s.total)}</div>
          ${!s.voided?`<span class="void-link" onclick="voidSaleConfirm('${s.id}')">Void</span>`:''}
        </div>
      </div>`;
    }).join('');
    return `<div style="font-size:11.5px; font-weight:800; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.04em; margin:14px 3px 4px;">${dayLabel}</div>${rows}`;
  }).join('');
}
function voidSaleConfirm(saleId){
  const s = sales.find(x=>x.id===saleId);
  if(!s || s.voided) return;
  currentVoidSaleId = saleId;
  const cust = s.customerId ? customers.find(c=>c.id===s.customerId) : null;
  let msg = `This puts ${s.items.reduce((a,i)=>a+i.qty,0)} item(s) back in stock and removes ${peso(s.total)} from today's sales total.`;
  if(s.method==='utang' && cust){
    msg += ` It also reduces ${esc(cust.name)}'s utang balance by ${peso(s.total)}.`;
  }
  document.getElementById('voidSaleBody').textContent = msg;
  openModal('modalVoidSale');
}
async function voidSale(){
  const s = sales.find(x=>x.id===currentVoidSaleId);
  if(!s || s.voided) { closeModal('modalVoidSale'); return; }
  s.voided = true;
  s.voidedAt = Date.now();
  let restockedAll = true;
  s.items.forEach(i=>{
    if(i.productId){
      const p = products.find(x=>x.id===i.productId);
      if(p) p.stock += i.qty; else restockedAll = false;
    } else restockedAll = false;
  });
  await saveProducts();
  if(s.method==='utang' && s.customerId){
    const c = customers.find(x=>x.id===s.customerId);
    if(c){
      c.balance = round2(Math.max(0, c.balance - s.total));
      const chargeEntry = c.history.find(h=>h.saleId===s.id && h.type==='charge');
      if(chargeEntry){
        chargeEntry.voided = true;
      } else {
        // Older data without a linked saleId — fall back to a visible reversal line
        c.history.push({id:uid(), ts:Date.now(), type:'payment', amount:s.total, note:'Sale voided — stock returned'});
      }
      await saveCustomers();
    }
  }
  await saveSales();
  closeModal('modalVoidSale');
  renderHistory(); renderDashboard(); renderInventory(); renderPos(); renderCustomers();
  showToast(restockedAll ? 'Sale voided and stock restored' : 'Sale voided (some items no longer exist to restock)');
}

/* ---------------- Inventory ---------------- */
function stockClass(p){
  if(p.stock<=0) return 'stock-out';
  if(p.stock<=p.low) return 'stock-low';
  return 'stock-ok';
}
function stockLabel(p){
  if(p.stock<=0) return 'Out of stock';
  if(p.stock<=p.low) return 'Low · '+p.stock+' '+p.unit;
  return p.stock+' '+p.unit+' in stock';
}
let invCategory = 'All';
let invSort = 'name';
function toggleInvSort(){
  invSort = invSort==='name' ? 'low' : 'name';
  document.getElementById('invSortToggle').textContent = 'Sort: ' + (invSort==='name' ? 'Name' : 'Low Stock First');
  renderInventory();
}
function renderInvChips(){
  const present = CATEGORIES.filter(c=>products.some(p=>(p.category||'Others')===c));
  const chips = ['All', ...present];
  if(!chips.includes(invCategory)) invCategory = 'All';
  const el = document.getElementById('invCategoryChips');
  el.innerHTML = chips.map(c=>`
    <button class="chip ${c===invCategory?'active':''}" onclick="setInvCategory('${c.replace(/'/g,"\\'")}')">${esc(c)}</button>`).join('');
}
function setInvCategory(c){ invCategory = c; renderInventory(); }
function renderInventory(){
  renderInvChips();
  const q = (document.getElementById('invSearch').value||'').toLowerCase();
  const list = products.filter(p=>{
    const matchesQ = p.name.toLowerCase().includes(q);
    const matchesCat = invCategory==='All' || (p.category||'Others')===invCategory;
    return matchesQ && matchesCat;
  });
  if(invSort==='low'){
    list.sort((a,b)=> (a.stock-a.low) - (b.stock-b.low));
  }else{
    list.sort((a,b)=> a.name.localeCompare(b.name));
  }
  const clearRow = document.getElementById('invClearAllRow');
  if(clearRow) clearRow.style.display = products.length ? 'block' : 'none';
  const el = document.getElementById('inventoryList');
  if(!list.length){ el.innerHTML = '<div class="empty">No products found</div>'; return; }
  el.innerHTML = list.map(p=>`
    <div class="prod-item" onclick="openProductModal('${p.id}')">
      <div class="prod-main">
        ${p.image
          ? `<img class="prod-thumb" src="${p.image}" alt="">`
          : `<div class="prod-thumb-ph">${esc(p.name.charAt(0).toUpperCase())}</div>`}
        <div class="prod-text">
          <div class="prod-name">${esc(p.name)} <span class="cat-tag" style="background:${catColor(p.category)}22; color:${catColor(p.category)};">${esc(p.category||'Others')}</span></div>
          <div class="prod-stock ${stockClass(p)}">${stockLabel(p)}</div>
        </div>
      </div>
      <div class="prod-price num">${peso(p.price)}</div>
    </div>`).join('');
}

let pmPendingImage = null; // data URL of a newly picked photo, or null if unchanged
let pmImageCleared = false; // true if user explicitly removed the photo

function openProductModal(id){
  document.getElementById('pmId').value = id||'';
  pmPendingImage = null;
  pmImageCleared = false;
  document.getElementById('pmImageInput').value = '';
  const catSel = document.getElementById('pmCategory');
  catSel.innerHTML = CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join('');
  if(id){
    const p = products.find(x=>x.id===id);
    document.getElementById('pmTitle').textContent = 'Edit Product';
    document.getElementById('pmName').value = p.name;
    document.getElementById('pmPrice').value = p.price;
    document.getElementById('pmStock').value = p.stock;
    document.getElementById('pmUnit').value = p.unit;
    document.getElementById('pmLow').value = p.low;
    catSel.value = p.category || 'Others';
    document.getElementById('pmDeleteBtn').style.display = 'block';
    setPhotoPickerPreview(p.image || null);
  }else{
    document.getElementById('pmTitle').textContent = 'Add Product';
    document.getElementById('pmName').value = '';
    document.getElementById('pmPrice').value = '';
    document.getElementById('pmStock').value = '';
    document.getElementById('pmUnit').value = 'pcs';
    document.getElementById('pmLow').value = 5;
    catSel.value = 'Others';
    document.getElementById('pmDeleteBtn').style.display = 'none';
    setPhotoPickerPreview(null);
  }
  openModal('modalProduct');
}
function setPhotoPickerPreview(dataUrl){
  const img = document.getElementById('pmPhotoPreview');
  const ph = document.getElementById('pmPhotoPlaceholder');
  const removeBtn = document.getElementById('pmRemovePhotoBtn');
  if(dataUrl){
    img.src = dataUrl;
    img.style.display = 'block';
    ph.style.display = 'none';
    removeBtn.style.display = 'block';
  }else{
    img.src = '';
    img.style.display = 'none';
    ph.style.display = 'flex';
    removeBtn.style.display = 'none';
  }
}
function handleProductImageSelect(event){
  const file = event.target.files && event.target.files[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){ showToast('Please choose an image file'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      // Resize/compress so we don't blow through localStorage's small quota
      const maxDim = 480;
      let w = img.width, h = img.height;
      if(w > h && w > maxDim){ h = Math.round(h * maxDim/w); w = maxDim; }
      else if(h > maxDim){ w = Math.round(w * maxDim/h); h = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      pmPendingImage = dataUrl;
      pmImageCleared = false;
      setPhotoPickerPreview(dataUrl);
    };
    img.onerror = () => showToast('Could not read that image');
    img.src = e.target.result;
  };
  reader.onerror = () => showToast('Could not read that image');
  reader.readAsDataURL(file);
}
function removeProductPhoto(event){
  event.stopPropagation();
  pmPendingImage = null;
  pmImageCleared = true;
  document.getElementById('pmImageInput').value = '';
  setPhotoPickerPreview(null);
}
async function saveProduct(){
  const id = document.getElementById('pmId').value;
  const name = document.getElementById('pmName').value.trim();
  const price = round2(parseFloat(document.getElementById('pmPrice').value));
  const stock = parseInt(document.getElementById('pmStock').value);
  const unit = document.getElementById('pmUnit').value.trim() || 'pcs';
  const low = parseInt(document.getElementById('pmLow').value) || 0;
  const category = document.getElementById('pmCategory').value || 'Others';
  if(!name || isNaN(price) || isNaN(stock)){ showToast('Fill in name, price, and stock'); return; }
  let targetProduct;
  if(id){
    targetProduct = products.find(x=>x.id===id);
    let image = targetProduct.image || null;
    if(pmPendingImage !== null) image = pmPendingImage;
    else if(pmImageCleared) image = null;
    Object.assign(targetProduct, {name, price, stock, unit, low, category, image});
  }else{
    const image = pmPendingImage || null;
    targetProduct = {id:uid(), name, price, stock, unit, low, category, image};
    products.push(targetProduct);
  }
  try{
    await saveProducts();
  }catch(e){
    if(targetProduct.image){
      targetProduct.image = null;
      try{
        await saveProducts();
        showToast('Storage full — saved product without photo');
        closeModal('modalProduct');
        renderInventory(); renderDashboard(); renderPos();
        return;
      }catch(e2){ /* fall through to failure toast below */ }
    }
    showToast('Could not save — storage may be full');
    return;
  }
  closeModal('modalProduct');
  renderInventory(); renderDashboard(); renderPos();
  showToast('Product saved');
}
async function deleteProductConfirm(){
  const id = document.getElementById('pmId').value;
  if(!id) return;
  const idx = products.findIndex(x=>x.id===id);
  if(idx===-1) return;
  const removed = products[idx];
  products.splice(idx, 1);
  await saveProducts();
  closeModal('modalProduct');
  renderInventory(); renderDashboard(); renderPos();
  showActionToast(`${removed.name} removed`, 'UNDO', async ()=>{
    products.splice(idx, 0, removed);
    await saveProducts();
    renderInventory(); renderDashboard(); renderPos();
    showToast('Product restored');
  });
}
function clearAllProductsConfirm(){
  if(!products.length) return;
  document.getElementById('modalClearProducts').classList.remove('hidden');
}
async function clearAllProducts(){
  const removed = products;
  products = [];
  await saveProducts();
  closeModal('modalClearProducts');
  renderInventory(); renderDashboard(); renderPos();
  showActionToast(`${removed.length} product${removed.length===1?'':'s'} cleared`, 'UNDO', async ()=>{
    products = removed;
    await saveProducts();
    renderInventory(); renderDashboard(); renderPos();
    showToast('Products restored');
  });
}

/* ---------------- POS / Sales ---------------- */
let posCategory = 'All';
function renderPosChips(){
  const present = CATEGORIES.filter(c=>products.some(p=>(p.category||'Others')===c));
  const chips = ['All', ...present];
  if(!chips.includes(posCategory)) posCategory = 'All';
  const el = document.getElementById('posCategoryChips');
  el.innerHTML = chips.map(c=>`
    <button class="chip ${c===posCategory?'active':''}" onclick="setPosCategory('${c.replace(/'/g,"\\'")}')">${esc(c)}</button>`).join('');
}
function setPosCategory(c){ posCategory = c; renderPos(); }
function renderPos(){
  renderPosChips();
  const q = (document.getElementById('posSearch').value||'').toLowerCase();
  const list = products.filter(p=>{
    const matchesQ = p.name.toLowerCase().includes(q);
    const matchesCat = posCategory==='All' || (p.category||'Others')===posCategory;
    return matchesQ && matchesCat;
  });
  const grid = document.getElementById('posGrid');
  if(!list.length){ grid.innerHTML = '<div class="empty" style="grid-column:1/-1;">No products found</div>'; return; }
  grid.innerHTML = list.map(p=>`
    <button class="pos-card" style="border-left-color:${catColor(p.category)};" ${p.stock<=0?'disabled':''} onclick="addToCart('${p.id}')">
      ${p.image
        ? `<img class="pos-card-img" src="${p.image}" alt="">`
        : `<div class="pos-card-img-ph">${esc(p.name.charAt(0).toUpperCase())}</div>`}
      <div class="pn">${esc(p.name)}</div>
      <div class="pp num">${peso(p.price)}</div>
      <div class="ps">${p.stock<=0?'Out of stock':p.stock+' '+p.unit+' avail.'}</div>
    </button>`).join('');
  updateCartBar();
}
function addToCart(id){
  const p = products.find(x=>x.id===id);
  if(!p || p.stock<=0) return;
  const line = cart.find(l=>l.productId===id);
  const currentQty = line ? line.qty : 0;
  if(currentQty >= p.stock){ showToast('Not enough stock'); return; }
  if(line){ line.qty++; }
  else{ cart.push({productId:id, name:p.name, price:p.price, qty:1}); }
  updateCartBar();
  showToast(p.name+' added');
}
function updateCartBar(){
  const bar = document.getElementById('cartBar');
  const count = cart.reduce((a,l)=>a+l.qty,0);
  const total = round2(cart.reduce((a,l)=>a+l.qty*l.price,0));
  document.getElementById('cartCount').textContent = count+' item'+(count===1?'':'s');
  document.getElementById('cartTotal').textContent = peso(total);
  bar.style.display = (cart.length && document.getElementById('view-sales').classList.contains('active')) ? 'flex' : 'none';
  saveCart();
}
function saveCart(){
  try{ localStorage.setItem('tindahan_cart', JSON.stringify(cart)); }catch(e){ /* best-effort */ }
}
let cartAdjustNotice = null;
function restoreCart(){
  try{
    const raw = localStorage.getItem('tindahan_cart');
    if(!raw) return;
    let saved = JSON.parse(raw);
    if(!Array.isArray(saved) || !saved.length) return;
    // Re-validate against current stock — time may have passed since the
    // tab closed, and a product could've been sold, edited, or deleted.
    const cleaned = [];
    let adjusted = false;
    saved.forEach(line=>{
      const p = products.find(x=>x.id===line.productId);
      if(!p || p.stock<=0){ adjusted = true; return; }
      const qty = Math.min(line.qty, p.stock);
      if(qty !== line.qty) adjusted = true;
      cleaned.push({productId:p.id, name:p.name, price:p.price, qty});
    });
    if(cleaned.length){
      cart = cleaned;
      if(adjusted){
        // A toast alone can be missed — this stays visible in the cart
        // itself until the sale completes or the cart is cleared, so a
        // shortchanged sale can't sail through unnoticed.
        cartAdjustNotice = 'Some items were removed or reduced because stock changed while this cart was waiting. Please double-check quantities before completing the sale.';
      }
      showToast(adjusted ? 'Restored your in-progress cart — please review it' : 'Restored your in-progress cart');
    }
  }catch(e){ /* corrupted cart data — just skip it */ }
}
function openCartModal(){
  if(!cart.length){ showToast('Cart is empty'); return; }
  renderCartLines();
  payMethod = 'cash';
  setPayMethod('cash');
  openModal('modalCart');
}
function renderCartLines(){
  const banner = document.getElementById('cartAdjustBanner');
  if(cartAdjustNotice){ banner.textContent = cartAdjustNotice; banner.style.display = 'block'; }
  else{ banner.style.display = 'none'; }
  const el = document.getElementById('cartLines');
  el.innerHTML = cart.map(l=>`
    <div class="cart-line">
      <div><div style="font-weight:700; font-size:14px;">${esc(l.name)}</div><div class="num" style="font-size:12px; color:var(--ink-soft);">${peso(l.price)} each</div></div>
      <div class="qty-ctrl">
        <button class="qty-btn" onclick="changeQty('${l.productId}',-1)">–</button>
        <span class="qty-val">${l.qty}</span>
        <button class="qty-btn" onclick="changeQty('${l.productId}',1)">+</button>
      </div>
    </div>`).join('');
  const total = round2(cart.reduce((a,l)=>a+l.qty*l.price,0));
  document.getElementById('cartModalTotal').textContent = peso(total);
}
function changeQty(id, delta){
  const l = cart.find(x=>x.productId===id);
  const p = products.find(x=>x.id===id);
  if(!l) return;
  l.qty += delta;
  if(l.qty<=0){ cart = cart.filter(x=>x.productId!==id); }
  else if(p && l.qty>p.stock){ l.qty=p.stock; showToast('Not enough stock'); }
  if(!cart.length) cartAdjustNotice = null;
  renderCartLines();
  updateCartBar();
  if(!cart.length) closeModal('modalCart');
}
function setPayMethod(method){
  payMethod = method;
  document.getElementById('payCashBtn').className = 'btn ' + (method==='cash'?'btn-primary':'btn-outline');
  document.getElementById('payUtangBtn').className = 'btn ' + (method==='utang'?'btn-primary':'btn-outline');
  const picker = document.getElementById('utangCustomerPicker');
  if(method==='utang'){
    picker.style.display = 'block';
    const sel = document.getElementById('utangCustomerSelect');
    sel.innerHTML = customers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('') || '<option value="">No customers yet — add one first</option>';
  }else{
    picker.style.display = 'none';
  }
}
function validateCheckout(){
  if(!cart.length){ showToast('Your cart is empty'); return false; }

  // Re-check every line against current product data (stock may have
  // changed, or a product may have been deleted, since it was added to cart)
  for(const line of cart){
    const p = products.find(x=>x.id===line.productId);
    if(!p){
      cart = cart.filter(x=>x.productId!==line.productId);
      showToast(`"${line.name}" no longer exists — removed from cart`);
      renderCartLines(); updateCartBar();
      return false;
    }
    if(line.qty <= 0){
      cart = cart.filter(x=>x.productId!==line.productId);
      showToast(`"${line.name}" had an invalid quantity — removed`);
      renderCartLines(); updateCartBar();
      return false;
    }
    if(line.qty > p.stock){
      if(p.stock <= 0){
        cart = cart.filter(x=>x.productId!==line.productId);
        showToast(`"${p.name}" is now out of stock — removed from cart`);
      }else{
        line.qty = p.stock;
        showToast(`Only ${p.stock} of "${p.name}" left — quantity adjusted`);
      }
      renderCartLines(); updateCartBar();
      return false;
    }
  }

  if(payMethod==='utang'){
    const custId = document.getElementById('utangCustomerSelect').value;
    if(!custId){ showToast('Select a customer to charge this to'); return false; }
    const cust = customers.find(x=>x.id===custId);
    if(!cust){ showToast('That customer no longer exists'); return false; }
  }

  return true;
}
function confirmCheckout(){
  if(!validateCheckout()) return;

  const total = round2(cart.reduce((a,l)=>a+l.qty*l.price,0));
  let payLine = '💵 Cash';
  if(payMethod==='utang'){
    const custId = document.getElementById('utangCustomerSelect').value;
    const cust = customers.find(x=>x.id===custId);
    payLine = `📒 Utang — ${esc(cust ? cust.name : '')}`;
  }

  const itemsHtml = cart.map(l => `
    <div class="alert-row">
      <span>${esc(l.name)} <span class="num" style="color:var(--ink-soft);">×${l.qty}</span></span>
      <span class="num">${peso(l.qty*l.price)}</span>
    </div>`).join('');

  document.getElementById('confirmSaleBody').innerHTML = `
    ${itemsHtml}
    <div class="alert-row" style="border-top:1.5px solid var(--line); margin-top:4px; padding-top:10px;">
      <span style="font-weight:800;">Total</span><span class="num" style="font-weight:800;">${peso(total)}</span>
    </div>
    <div class="alert-row"><span>Payment</span><span>${payLine}</span></div>
  `;
  openModal('modalConfirmSale');
}
async function finalizeCheckout(){
  const btn = document.getElementById('confirmSaleBtn');
  if(btn.classList.contains('btn-loading')) return; // guard against double-tap
  btn.classList.add('btn-loading');
  btn.disabled = true;

  if(!validateCheckout()){
    btn.classList.remove('btn-loading');
    btn.disabled = false;
    closeModal('modalConfirmSale');
    return;
  }
  let custId = null;
  if(payMethod==='utang'){
    custId = document.getElementById('utangCustomerSelect').value;
  }
  const total = round2(cart.reduce((a,l)=>a+l.qty*l.price,0));
  // deduct stock
  cart.forEach(l=>{
    const p = products.find(x=>x.id===l.productId);
    if(p) p.stock = Math.max(0, p.stock - l.qty);
  });
  const sale = {id:uid(), ts:Date.now(), date:todayStr(), items:cart.map(l=>({productId:l.productId, name:l.name, qty:l.qty, price:l.price})), total, method:payMethod, customerId:custId, voided:false};
  sales.push(sale);
  await saveProducts();
  await saveSales();
  localStorage.setItem('tindahan_sales_since_backup', String(parseInt(localStorage.getItem('tindahan_sales_since_backup')||'0',10) + 1));

  if(payMethod==='utang' && custId){
    const c = customers.find(x=>x.id===custId);
    c.balance = round2(c.balance + total);
    c.history.push({id:uid(), ts:Date.now(), type:'charge', amount:total, note:'Purchase: '+cart.map(l=>l.name).join(', '), saleId: sale.id});
    await saveCustomers();
  }

  btn.classList.remove('btn-loading');
  btn.disabled = false;
  closeModal('modalConfirmSale');
  showReceipt(sale, custId);
  cart = [];
  cartAdjustNotice = null;
  updateCartBar();
  closeModal('modalCart');
  renderPos(); renderDashboard(); renderCustomers();
}
function showReceipt(sale, custId){
  const cust = custId ? customers.find(c=>c.id===custId) : null;
  const body = document.getElementById('receiptBody');
  body.innerHTML = `
    <div class="receipt-head">
      <div class="rn">${esc(document.getElementById('storeNameLabel').textContent)}</div>
      <div class="rd">${new Date(sale.ts).toLocaleString('en-PH',{dateStyle:'medium', timeStyle:'short'})}</div>
    </div>
    <div class="receipt-divider"></div>
    ${sale.items.map(i=>`<div class="receipt-line"><span class="rl-name">${esc(i.name)} ×${i.qty}</span><span class="num">${peso(i.price*i.qty)}</span></div>`).join('')}
    <div class="receipt-divider"></div>
    <div class="receipt-total"><span>Total</span><span class="num">${peso(sale.total)}</span></div>
    <div class="receipt-line" style="margin-top:6px;"><span>Payment</span><span>${sale.method==='cash'?'Cash':'Utang'+(cust?' — '+esc(cust.name):'')}</span></div>
  `;
  openModal('modalReceipt');
}
function closeReceipt(){ closeModal('modalReceipt'); }

/* ---------------- Utang / Customers ---------------- */
function renderCustomers(){
  const q = (document.getElementById('custSearch').value||'').toLowerCase();
  const list = customers.filter(c=>c.name.toLowerCase().includes(q));
  const el = document.getElementById('customerList');
  if(!list.length){ el.innerHTML = '<div class="empty">No customers found</div>'; return; }
  el.innerHTML = list.map(c=>`
    <div class="cust-item" onclick="openCustomerDetail('${c.id}')">
      <div class="cust-row">
        <div class="cust-avatar">${esc(c.name.charAt(0).toUpperCase())}</div>
        <div class="cust-info">
          <div class="cust-name">${esc(c.name)}</div>
          <div class="cust-meta">${esc(c.note||'')}</div>
        </div>
      </div>
      <div class="cust-bal num ${c.balance>0?'owe':'zero'}">${peso(c.balance)}</div>
    </div>`).join('');
}
function openCustomerModal(){
  document.getElementById('cmName').value = '';
  document.getElementById('cmNote').value = '';
  openModal('modalCustomer');
}
async function saveCustomer(){
  const name = document.getElementById('cmName').value.trim();
  if(!name){ showToast('Enter a name'); return; }
  const note = document.getElementById('cmNote').value.trim();
  customers.push({id:uid(), name, note, balance:0, history:[]});
  await saveCustomers();
  closeModal('modalCustomer');
  renderCustomers();
  showToast('Customer added');
}
function openCustomerDetail(id){
  currentCustomerId = id;
  const c = customers.find(x=>x.id===id);
  document.getElementById('cdName').textContent = c.name;
  document.getElementById('cdMeta').textContent = c.note || '';
  const balEl = document.getElementById('cdBalance');
  balEl.textContent = peso(c.balance);
  balEl.style.color = c.balance>0 ? 'var(--coral-deep)' : 'var(--green-ok)';
  renderLedgerHistory(c);
  goTo('customer-detail');
}
function renderLedgerHistory(c){
  const el = document.getElementById('ledgerHistory');
  if(!c.history.length){ el.innerHTML = '<div class="empty">No transactions yet</div>'; return; }
  const rows = [...c.history].sort((a,b)=>b.ts-a.ts);
  el.innerHTML = rows.map(h=>`
    <div class="ledger-row" style="${h.voided?'opacity:.5;':''}">
      <div>
        <div>${new Date(h.ts).toLocaleDateString('en-PH',{month:'short', day:'numeric'})} ${h.voided?'<span class="pill out">Voided</span>':''}</div>
        ${h.note?`<div class="ld-note" style="${h.voided?'text-decoration:line-through;':''}">${esc(h.note)}</div>`:''}
      </div>
      <div class="ledger-amt num ${h.type}" style="${h.voided?'text-decoration:line-through;':''}">${h.type==='charge'?'+':'−'}${peso(h.amount)}</div>
    </div>`).join('');
}
function openLedgerModal(type){
  document.getElementById('lmTitle').textContent = type==='charge' ? 'Add Utang' : 'Record Payment';
  document.getElementById('lmAmount').value = '';
  document.getElementById('lmNote').value = '';
  document.getElementById('modalLedger').dataset.type = type;
  openModal('modalLedger');
}
async function saveLedgerEntry(){
  const type = document.getElementById('modalLedger').dataset.type;
  const amount = parseFloat(document.getElementById('lmAmount').value);
  const note = document.getElementById('lmNote').value.trim();
  if(!amount || amount<=0){ showToast('Enter a valid amount'); return; }
  const c = customers.find(x=>x.id===currentCustomerId);
  if(type==='charge'){ c.balance = round2(c.balance + amount); }
  else{ c.balance = round2(Math.max(0, c.balance - amount)); }
  c.history.push({id:uid(), ts:Date.now(), type, amount, note});
  await saveCustomers();
  closeModal('modalLedger');
  openCustomerDetail(c.id);
  renderCustomers(); renderDashboard();
  showToast(type==='charge' ? 'Utang added' : 'Payment recorded');
}
function removeCustomerConfirm(){
  const c = customers.find(x=>x.id===currentCustomerId);
  if(!c) return;
  document.getElementById('rcName').textContent = c.name;
  const warnEl = document.getElementById('rcWarning');
  if(c.balance > 0){
    warnEl.textContent = `${c.name} still owes ${peso(c.balance)}. Removing them erases that balance too.`;
    warnEl.style.display = 'block';
  } else {
    warnEl.style.display = 'none';
  }
  openModal('modalRemoveCustomer');
}
async function removeCustomer(){
  const idx = customers.findIndex(x=>x.id===currentCustomerId);
  if(idx===-1) return;
  const removed = customers[idx];
  customers.splice(idx, 1);
  await saveCustomers();
  closeModal('modalRemoveCustomer');
  goTo('utang');
  renderCustomers(); renderDashboard();
  showActionToast(`${removed.name} removed`, 'UNDO', async ()=>{
    customers.splice(idx, 0, removed);
    await saveCustomers();
    renderCustomers(); renderDashboard();
    showToast('Customer restored');
  });
}

/* ---------------- Settings: Backup & Restore ---------------- */
function backupFilename(){
  const d = new Date();
  const stamp = d.toISOString().slice(0,10);
  return `tindahan-backup-${stamp}.json`;
}
function downloadBlob(content, filename, type){
  const blob = new Blob([content], {type});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 2000);
}
function exportBackup(){
  const payload = {
    app: 'tindahan', backupVersion: 1, exportedAt: new Date().toISOString(),
    products, sales, customers
  };
  downloadBlob(JSON.stringify(payload, null, 2), backupFilename(), 'application/json');
  localStorage.setItem('tindahan_last_backup', new Date().toISOString());
  localStorage.setItem('tindahan_sales_since_backup', '0');
  renderBackupReminder();
  showToast('Backup downloaded');
}
function csvEscape(v){
  const s = String(v==null?'':v);
  return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
function exportProductsCsv(){
  if(!products.length){ showToast('No products to export'); return; }
  const header = ['Name','Category','Price','Stock','Unit','Low Stock Threshold'];
  const rows = products.map(p=>[p.name,p.category||'Others',p.price,p.stock,p.unit,p.low]);
  const csv = [header, ...rows].map(r=>r.map(csvEscape).join(',')).join('\r\n');
  downloadBlob(csv, `tindahan-products-${new Date().toISOString().slice(0,10)}.csv`, 'text/csv');
  showToast('Products exported');
}
let pendingImport = null;
function handleImportFile(event){
  const file = event.target.files && event.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    let data;
    try{ data = JSON.parse(e.target.result); }
    catch(err){ showToast('That file isn\'t valid JSON'); event.target.value=''; return; }
    if(!data || !Array.isArray(data.products) || !Array.isArray(data.sales) || !Array.isArray(data.customers)){
      showToast('That doesn\'t look like a Tindahan backup file'); event.target.value=''; return;
    }
    pendingImport = data;
    document.getElementById('importSummary').textContent =
      `This backup has ${data.products.length} product(s), ${data.customers.length} customer(s), and ${data.sales.length} sale(s)`
      + (data.exportedAt ? `, saved on ${new Date(data.exportedAt).toLocaleDateString('en-PH',{dateStyle:'medium'})}.` : '.');
    document.querySelector('input[name=importMode][value=merge]').checked = true;
    document.getElementById('importWarning').style.display = 'none';
    document.querySelectorAll('input[name=importMode]').forEach(r=>{
      r.onchange = ()=>{
        const mode = document.querySelector('input[name=importMode]:checked').value;
        document.getElementById('importWarning').style.display = mode==='replace' ? 'block' : 'none';
      };
    });
    openModal('modalImportConfirm');
  };
  reader.onerror = () => showToast('Could not read that file');
  reader.readAsText(file);
}
function cancelImport(){
  pendingImport = null;
  document.getElementById('importFileInput').value = '';
  closeModal('modalImportConfirm');
}
async function confirmImport(){
  if(!pendingImport) return;
  const mode = document.querySelector('input[name=importMode]:checked').value;
  let possibleDupes = [];
  if(mode==='replace'){
    products = pendingImport.products;
    sales = pendingImport.sales;
    customers = pendingImport.customers;
  }else{
    // Merge: add everything from the backup on top of what's here. IDs that
    // collide get a fresh id so nothing on this device gets silently
    // overwritten. But a same-named product/customer with a *different* id
    // (e.g. added separately on two phones) is a much more likely case in
    // practice, and that one is invisible unless we go looking for it — so
    // check by name too, and tell the owner what to go double-check by hand.
    // The app deliberately does NOT auto-merge these — reconciling two
    // different utang balances for "the same" customer is a judgment call,
    // not something to guess at silently.
    const existingProductIds = new Set(products.map(p=>p.id));
    const existingCustomerIds = new Set(customers.map(c=>c.id));
    const existingSaleIds = new Set(sales.map(s=>s.id));
    const existingProductNames = new Set(products.map(p=>p.name.trim().toLowerCase()));
    const existingCustomerNames = new Set(customers.map(c=>c.name.trim().toLowerCase()));
    pendingImport.products.forEach(p=>{
      if(existingProductNames.has(p.name.trim().toLowerCase())) possibleDupes.push(`Product "${p.name}"`);
      products.push(existingProductIds.has(p.id) ? {...p, id:uid()} : p);
    });
    pendingImport.customers.forEach(c=>{
      if(existingCustomerNames.has(c.name.trim().toLowerCase())) possibleDupes.push(`Customer "${c.name}"`);
      customers.push(existingCustomerIds.has(c.id) ? {...c, id:uid()} : c);
    });
    pendingImport.sales.forEach(s=>{
      sales.push(existingSaleIds.has(s.id) ? {...s, id:uid()} : s);
    });
  }
  await saveProducts(); await saveSales(); await saveCustomers();
  pendingImport = null;
  document.getElementById('importFileInput').value = '';
  closeModal('modalImportConfirm');
  renderAll(); renderSettings();
  if(possibleDupes.length){
    showToast(`Merged in — but check for duplicates: ${possibleDupes.slice(0,3).join(', ')}${possibleDupes.length>3?` +${possibleDupes.length-3} more`:''}`, 7000);
  }else{
    showToast(mode==='replace' ? 'Backup restored' : 'Backup merged in');
  }
}
function renderSettings(){
  // Storage usage — localStorage quotas vary by browser but ~5MB is a safe
  // conservative assumption to warn against, since there is no reliable
  // cross-browser API to ask "how much do I actually have left".
  const bytesUsed = ['tindahan_products','tindahan_sales','tindahan_customers'].reduce((sum,key)=>{
    const raw = localStorage.getItem(key);
    return sum + (raw ? raw.length : 0);
  }, 0);
  const assumedQuota = 5 * 1024 * 1024;
  const pct = Math.min(100, (bytesUsed/assumedQuota)*100);
  const fill = document.getElementById('storageBarFill');
  fill.style.width = pct+'%';
  fill.className = 'storage-bar-fill' + (pct>90?' danger':pct>70?' warn':'');
  const kb = (bytesUsed/1024).toFixed(1);
  document.getElementById('storageUsageText').textContent =
    pct>90 ? `Using ~${kb} KB — getting close to this device's storage limit. Export a backup and consider removing old product photos.`
    : `Using ~${kb} KB of local storage on this device (product photos are the biggest factor).`;

  const hasPin = !!localStorage.getItem('tindahan_pin_salt');
  document.getElementById('pinSetBtn').style.display = hasPin ? 'none' : 'block';
  document.getElementById('pinRemoveBtn').style.display = hasPin ? 'block' : 'none';
  document.getElementById('pinDescription').textContent = hasPin
    ? "A PIN is protecting this app, and your data is encrypted on this device using it. If you forget it, there's no way to recover the data — not even by reinstalling. Keep backups if that risk worries you."
    : "Add a 4-digit PIN so a quick glance at your phone doesn't show your sales and customers' utang. This is a simple screen lock, not encryption — it keeps casual eyes out, not a determined one.";
}

/* ---------------- App Lock (PIN) — the PIN is the encryption key ---------------- */
// There's no separate stored PIN hash. Correctly decrypting your data with
// AES-GCM IS the proof the PIN was right — that's what "authenticated
// encryption" means. The upside: devtools/localStorage inspection shows only
// ciphertext, not your products/sales/customers, even while locked or if the
// device is lost. The cost: there is no recovery path if the PIN is
// forgotten. Not by re-installing, not by me. Say this plainly in the UI.
function bytesToB64(bytes){ let s=''; bytes.forEach(b=>s+=String.fromCharCode(b)); return btoa(s); }
function b64ToBytes(b64){ return Uint8Array.from(atob(b64), c=>c.charCodeAt(0)); }
async function deriveKey(pin, existingSaltB64){
  const salt = existingSaltB64 ? b64ToBytes(existingSaltB64) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {name:'PBKDF2', salt, iterations:150000, hash:'SHA-256'},
    keyMaterial, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']
  );
  return {key, saltB64: bytesToB64(salt)};
}
async function encryptText(key, text){
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({name:'AES-GCM', iv}, key, new TextEncoder().encode(text));
  return bytesToB64(iv) + '.' + bytesToB64(new Uint8Array(ct));
}
async function decryptText(key, payload){
  const [ivB64, ctB64] = payload.split('.');
  const pt = await crypto.subtle.decrypt({name:'AES-GCM', iv:b64ToBytes(ivB64)}, key, b64ToBytes(ctB64));
  return new TextDecoder().decode(pt);
}

/* ---- Lockout after repeated wrong attempts (survives reload — stored, not just in-memory) ---- */
function lockState(){
  return {
    fails: parseInt(localStorage.getItem('tindahan_lock_fails')||'0',10),
    until: parseInt(localStorage.getItem('tindahan_lock_until')||'0',10)
  };
}
function msLockedOutFor(){ return Math.max(0, lockState().until - Date.now()); }
function registerFailedAttempt(){
  const fails = lockState().fails + 1;
  localStorage.setItem('tindahan_lock_fails', String(fails));
  if(fails >= 5){
    const delaySec = Math.min(30 * Math.pow(2, fails-5), 3600); // 30s, 60s, 120s… capped at 1hr
    localStorage.setItem('tindahan_lock_until', String(Date.now() + delaySec*1000));
  }
}
function resetLockFails(){
  localStorage.removeItem('tindahan_lock_fails');
  localStorage.removeItem('tindahan_lock_until');
}

function openSetPinModal(){
  document.getElementById('spPin1').value = '';
  document.getElementById('spPin2').value = '';
  document.getElementById('spError').style.display = 'none';
  openModal('modalSetPin');
}
async function saveNewPin(){
  const p1 = document.getElementById('spPin1').value;
  const p2 = document.getElementById('spPin2').value;
  const errEl = document.getElementById('spError');
  if(!/^\d{4}$/.test(p1)){ errEl.textContent = 'PIN must be exactly 4 digits'; errEl.style.display='block'; return; }
  if(p1 !== p2){ errEl.textContent = "PINs don't match"; errEl.style.display='block'; return; }
  const {key, saltB64} = await deriveKey(p1);
  encryptionKey = key;
  localStorage.setItem('tindahan_pin_salt', saltB64);
  await saveProducts(); await saveSales(); await saveCustomers();
  closeModal('modalSetPin');
  renderSettings();
  showToast('PIN set — your data is now encrypted on this device');
}
function openRemovePinModal(){
  document.getElementById('rpPin').value = '';
  document.getElementById('rpError').style.display = 'none';
  openModal('modalRemovePin');
}
async function confirmRemovePin(){
  const pin = document.getElementById('rpPin').value;
  const errEl = document.getElementById('rpError');
  const salt = localStorage.getItem('tindahan_pin_salt');
  try{
    const {key} = await deriveKey(pin, salt);
    const raw = localStorage.getItem('tindahan_products');
    if(raw) await decryptText(key, raw); // throws if the PIN is wrong
    encryptionKey = null;
    localStorage.removeItem('tindahan_pin_salt');
    await saveProducts(); await saveSales(); await saveCustomers(); // re-save as plaintext
    closeModal('modalRemovePin');
    renderSettings();
    showToast('PIN removed — data is stored unencrypted on this device again');
  }catch(e){
    errEl.textContent = 'Incorrect PIN'; errEl.style.display='block';
  }
}
async function attemptUnlock(){
  const input = document.getElementById('lockPinInput');
  const errEl = document.getElementById('lockError');
  const btn = document.getElementById('lockUnlockBtn');
  const remainingMs = msLockedOutFor();
  if(remainingMs > 0){
    const secs = Math.ceil(remainingMs/1000);
    errEl.textContent = `Too many wrong attempts. Try again in ${secs>=60 ? Math.ceil(secs/60)+' min' : secs+' sec'}.`;
    errEl.style.display = 'block';
    return;
  }
  btn.disabled = true;
  const salt = localStorage.getItem('tindahan_pin_salt');
  try{
    const {key} = await deriveKey(input.value, salt);
    encryptionKey = key;
    await loadData();
    resetLockFails();
    document.getElementById('lockScreen').classList.add('hidden');
    errEl.style.display = 'none';
    input.value = '';
  }catch(e){
    encryptionKey = null;
    registerFailedAttempt();
    const remaining = msLockedOutFor();
    errEl.textContent = remaining > 0
      ? `Wrong PIN. Locked for ${Math.ceil(remaining/1000)}s after too many attempts.`
      : 'Wrong PIN, try again';
    errEl.style.display = 'block';
    input.value = '';
    input.focus();
  }
  btn.disabled = false;
}
async function initApp(){
  // Migrate away from the old (pre-encryption) PIN scheme, which only ever
  // hid the screen and never actually protected the underlying data.
  if(localStorage.getItem('tindahan_pin') && !localStorage.getItem('tindahan_pin_salt')){
    localStorage.removeItem('tindahan_pin');
  }
  const salt = localStorage.getItem('tindahan_pin_salt');
  if(salt){
    document.getElementById('lockScreen').classList.remove('hidden');
    setTimeout(()=>document.getElementById('lockPinInput').focus(), 50);
    return; // loadData() runs only after attemptUnlock() succeeds
  }
  try{
    await loadData();
  }catch(e){
    console.error('Load error, falling back to empty store', e);
    products = seedProducts(); sales = []; customers = seedCustomers();
    dataReady = true; renderAll();
    showToast('Could not read saved data — starting fresh');
  }
}

/* ---------------- Modal helpers ---------------- */
function openModal(id){
  document.getElementById(id).classList.remove('hidden');
  const el = document.getElementById(id);
  const focusable = el.querySelector('input, select, textarea, button');
  if(focusable) setTimeout(()=>focusable.focus(), 30);
}
function closeModal(id){ document.getElementById(id).classList.add('hidden'); }

/* ---------------- Modal swipe-to-dismiss ---------------- */
// The little bar at the top of each modal (.modal-handle) is a drag grip —
// wire it up so dragging it down far enough closes the sheet, matching how
// it looks. Only the handle itself captures the drag so scrolling the
// modal's content still works normally.
function initModalSwipeToDismiss(){
  document.querySelectorAll('.modal-overlay').forEach(overlay=>{
    const modal = overlay.querySelector('.modal');
    const handle = overlay.querySelector('.modal-handle');
    if(!modal || !handle) return;

    const DISMISS_THRESHOLD = 90; // px of downward drag needed to close
    let startY = 0, deltaY = 0, dragging = false;

    function getY(e){ return e.touches ? e.touches[0].clientY : e.clientY; }

    function onStart(e){
      dragging = true;
      startY = getY(e);
      deltaY = 0;
      modal.style.transition = 'none';
    }
    function onMove(e){
      if(!dragging) return;
      deltaY = Math.max(0, getY(e) - startY); // only allow dragging downward
      modal.style.transform = `translateY(${deltaY}px)`;
      if(e.cancelable) e.preventDefault();
    }
    function onEnd(){
      if(!dragging) return;
      dragging = false;
      modal.style.transition = 'transform 0.2s ease';
      if(deltaY > DISMISS_THRESHOLD){
        modal.style.transform = 'translateY(100%)';
        setTimeout(()=>{
          overlay.classList.add('hidden');
          modal.style.transition = '';
          modal.style.transform = '';
        }, 180);
      }else{
        modal.style.transform = '';
      }
    }

    handle.addEventListener('touchstart', onStart, {passive:true});
    handle.addEventListener('touchmove', onMove, {passive:false});
    handle.addEventListener('touchend', onEnd);
    handle.addEventListener('mousedown', onStart);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
  });
}
initModalSwipeToDismiss();
document.addEventListener('keydown', (e)=>{
  if(e.key !== 'Escape') return;
  document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m=>m.classList.add('hidden'));
});
function esc(s){ return String(s).replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

initApp();

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW registration failed', e));
  });
}
