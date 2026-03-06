// ===== PWA =====
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}

// ===== Utils =====
const DEFAULT_SPLITS = [
  { id:"chest", name:"胸" },
  { id:"back",  name:"背中" },
  { id:"legs",  name:"足" }
];

const KG_PER_LB = 0.45359237;
function todayISO(){
  const d = new Date();
  const z = new Date(d.getTime() - d.getTimezoneOffset()*60000);
  return z.toISOString().slice(0,10);
}
function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }

function round1(n){ return Math.round(n*10)/10; }
function kgToLb(kg){ return round1(kg / KG_PER_LB); }
function lbToKg(lb){ return round1(lb * KG_PER_LB); }

function parseNum(s){
  if (s == null) return null;
  const t = String(s).trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ===== IndexedDB tiny wrapper =====
const DB_NAME = "workout_pwa_db";
const DB_VER = 3;
const STORES = {
  settings: "settings",
  masters: "masters",
  templates: "templates",
  workouts: "workouts",
  historyByEx: "historyByEx"
};

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of Object.values(STORES)){
        if (!db.objectStoreNames.contains(s)){
          db.createObjectStore(s, { keyPath:"key" });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet(store, key){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(store,"readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = ()=> resolve(req.result || null);
    req.onerror = ()=> reject(req.error);
  });
}
async function idbPut(store, obj){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(store,"readwrite");
    tx.oncomplete = ()=> resolve(true);
    tx.onerror = ()=> reject(tx.error);
    tx.objectStore(store).put(obj);
  });
}
async function idbDel(store, key){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(store,"readwrite");
    tx.oncomplete = ()=> resolve(true);
    tx.onerror = ()=> reject(tx.error);
    tx.objectStore(store).delete(key);
  });
}
async function idbAll(store){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(store,"readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = ()=> resolve(req.result || []);
    req.onerror = ()=> reject(req.error);
  });
}

// ===== Data layer =====
const Keys = {
  settings: "settings",
  template(splitId){ return `template:${splitId}`; },
  workout(date){ return `workout:${date}`; },
  master(id){ return `master:${id}`; },
  history(exId){ return `hist:${exId}`; }
};

async function getSettings(){
  const x = await idbGet(STORES.settings, Keys.settings);
  return x?.value || { unitDisplay:"kg", splits: DEFAULT_SPLITS, manufacturers: [] };
}
async function setSettings(value){
  await idbPut(STORES.settings, { key: Keys.settings, value });
}

async function getAllMasters(){
  const rows = await idbAll(STORES.masters);
  return rows.map(r=>r.value).sort((a,b)=>a.name.localeCompare(b.name,"ja"));
}
async function getMaster(id){
  const r = await idbGet(STORES.masters, Keys.master(id));
  return r?.value || null;
}
async function upsertMaster(m){
  await idbPut(STORES.masters, { key: Keys.master(m.id), value: m });
}
async function deleteMaster(id){
  await idbDel(STORES.masters, Keys.master(id));
}

async function getTemplate(splitId){
  const r = await idbGet(STORES.templates, Keys.template(splitId));
  return r?.value || { splitId, items: [] };
}
async function saveTemplate(tpl){
  await idbPut(STORES.templates, { key: Keys.template(tpl.splitId), value: tpl });
}

async function getWorkout(date){
  const r = await idbGet(STORES.workouts, Keys.workout(date));
  return r?.value || { date, splitId:null, items: [] };
}
async function saveWorkout(w){
  await idbPut(STORES.workouts, { key: Keys.workout(w.date), value: w });
}

async function getHistory(exId){
  const r = await idbGet(STORES.historyByEx, Keys.history(exId));
  return r?.value || [];
}
async function pushHistory(exId, entry){
  const arr = await getHistory(exId);
  arr.unshift(entry);
  await idbPut(STORES.historyByEx, { key: Keys.history(exId), value: arr.slice(0,30) });
}

// ===== Seed =====
async function ensureSeed(){
  const masters = await getAllMasters();
  if (masters.length === 0){
    const seed = [
      { id: uid(), name:"ベンチプレス", equipmentNo:"", setup:"", defaultComment:"" },
      { id: uid(), name:"インクラインDBプレス", equipmentNo:"", setup:"", defaultComment:"" },
      { id: uid(), name:"ラットプルダウン", equipmentNo:"", setup:"", defaultComment:"" },
      { id: uid(), name:"レッグプレス", equipmentNo:"", setup:"", defaultComment:"" }
    ];
    for (const m of seed) await upsertMaster(m);

    const all = await getAllMasters();
    const byName = (n)=>all.find(x=>x.name===n)?.id;

    await saveTemplate({ splitId:"chest", items: [
      { exId: byName("ベンチプレス"), sets: 4 },
      { exId: byName("インクラインDBプレス"), sets: 3 }
    ].filter(x=>x.exId)});

    await saveTemplate({ splitId:"back", items: [
      { exId: byName("ラットプルダウン"), sets: 4 }
    ].filter(x=>x.exId)});

    await saveTemplate({ splitId:"legs", items: [
      { exId: byName("レッグプレス"), sets: 4 }
    ].filter(x=>x.exId)});
  }

  const s = await getSettings();
  if (!Array.isArray(s.splits) || s.splits.length === 0){
    s.splits = DEFAULT_SPLITS;
    await setSettings(s);
  }
}

// ===== UI State =====
let state = {
  splits: DEFAULT_SPLITS,
  manufacturers: [],
  splitId: "chest",
  unitDisplay: "kg",
  date: todayISO(),
  workout: null,
  masters: []
};

const el = (id)=>document.getElementById(id);
const cards = el("cards");

function currentSplitName(){
  return state.splits.find(s=>s.id===state.splitId)?.name || "";
}

function renderSplitTabs(){
  const host = el("splitTabs");
  if (!host) return;
  host.innerHTML = "";
  for (const s of state.splits){
    const b = document.createElement("button");
    b.className = "segbtn" + (s.id === state.splitId ? " active" : "");
    b.textContent = s.name;
    b.onclick = ()=> setSplit(s.id);
    host.appendChild(b);
  }
}

function setSplit(splitId){
  state.splitId = splitId;
  if (state.workout){
    state.workout.splitId = splitId;
    autosave();
  }
  renderSplitTabs();
  await loadDate(state.date);
}


function unitButtonsReflect(){
  const dlg = el("dlgSettings");
  dlg.querySelectorAll(".segbtn[data-unit]").forEach(b=>{
    b.classList.toggle("active", b.dataset.unit === state.unitDisplay);
  });
}

async function autosave(){
  if (!state.workout) return;
  await saveWorkout(state.workout);

  for (const item of state.workout.items){
    const master = state.masters.find(m=>m.id===item.exId);
    const entry = {
      date: state.workout.date,
      splitId: state.workout.splitId,
      splitName: currentSplitName(),
      exerciseName: master?.name || "(不明)",
      equipmentNo: item.equipmentNo || master?.equipmentNo || "",
      setup: item.setup || master?.setup || "",
      unit: item.unit || state.unitDisplay,
      manufacturer: item.manufacturer || "",
      sets: item.sets
    };
    await pushHistory(item.exId, entry);
  }
}

function makeEmptySets(n){
  const arr = [];
  for (let i=0;i<n;i++) arr.push({ wKg:null, reps:null, weak:false });
  return arr;
}

async function addExerciseById(exId){
  const master = state.masters.find(m=>m.id===exId);
  const hist = await getHistory(exId);
  const last = hist[0] || null;

  const equipmentNo = last?.equipmentNo || master?.equipmentNo || "";
  const setup = last?.setup || master?.setup || "";
  const comment = master?.defaultComment || "";
  const setsCount = clamp(last?.sets?.length || 4, 1, 10);
  const unit = last?.unit || state.unitDisplay;

  const item = {
    id: uid(),
    exId,
    manufacturer: last?.manufacturer || "",
    equipmentNo,
    setup,
    comment,
    unit,
    sets: makeEmptySets(setsCount)
  };

  if (last?.sets?.length){
    for (let i=0;i<Math.min(item.sets.length, last.sets.length);i++){
      item.sets[i].wKg = last.sets[i].wKg ?? null;
      item.sets[i].reps = last.sets[i].reps ?? null;
      item.sets[i].weak = false;
    }
  }

  state.workout.items.push(item);
  await autosave();
  render();
}

function removeExercise(itemId){
  state.workout.items = state.workout.items.filter(x=>x.id!==itemId);
  autosave().then(render);
}

function adjustSetCount(itemId, delta){
  const item = state.workout.items.find(x=>x.id===itemId);
  if (!item) return;
  const next = clamp(item.sets.length + delta, 1, 12);
  while (item.sets.length < next) item.sets.push({ wKg:null, reps:null, weak:false });
  while (item.sets.length > next) item.sets.pop();
  autosave().then(render);
}

function setWeight(itemId, idx, val){
  const item = state.workout.items.find(x=>x.id===itemId);
  if (!item) return;
  const n = parseNum(val);
  if (n == null) item.sets[idx].wKg = null;
  else item.sets[idx].wKg = (item.unit === "kg") ? n : lbToKg(n);
  autosave();
}
function setReps(itemId, idx, val){
  const item = state.workout.items.find(x=>x.id===itemId);
  if (!item) return;
  const n = parseNum(val);
  item.sets[idx].reps = n == null ? null : Math.round(n);
  autosave();
}
function toggleWeak(itemId, idx){
  const item = state.workout.items.find(x=>x.id===itemId);
  if (!item) return;
  item.sets[idx].weak = !item.sets[idx].weak;
  autosave().then(render);
}
function setItemText(itemId, key, val){
  const item = state.workout.items.find(x=>x.id===itemId);
  if (!item) return;
  item[key] = String(val || "");
  autosave();
}
function setItemUnit(itemId, unit){
  const item = state.workout.items.find(x=>x.id===itemId);
  if (!item) return;
  item.unit = unit;
  autosave().then(render);
}

function fmtWeightForItem(item, kg){
  if (kg == null) return "";
  return item.unit === "kg" ? String(kg) : String(kgToLb(kg));
}

function render(){
  if (!state.workout) return;
  const items = state.workout.items;

  cards.innerHTML = "";
  if (items.length === 0){
    cards.innerHTML = `<div class="hint">「＋ 種目追加」または「テンプレ読込」から始めよう</div>`;
    return;
  }

  for (const item of items){
    const master = state.masters.find(m=>m.id===item.exId);
    const name = master?.name || "(種目不明)";
    const eqNo = item.equipmentNo || master?.equipmentNo || "";
    const setup = item.setup || master?.setup || "";

    const card = document.createElement("div");
    card.className = "card";

    const head = document.createElement("div");
    head.className = "cardhead";
    head.innerHTML = `
      <div>
        <div class="cardtitle">${escapeHtml(name)}</div>
        <div class="sub">
          ${eqNo ? `機材 <strong>${escapeHtml(eqNo)}</strong>` : `機材 <span class="muted">-</span>`}
          ${setup ? ` ・ 設定 <strong>${escapeHtml(setup)}</strong>` : ``}
        </div>
      </div>
      <div class="actions">
        <button class="iconbtn" data-act="minus" title="セット減">－</button>
        <button class="iconbtn" data-act="plus" title="セット増">＋</button>
        <button class="iconbtn" data-act="del" title="削除">🗑</button>
      </div>
    `;

    head.querySelector('[data-act="minus"]').onclick = ()=>adjustSetCount(item.id, -1);
    head.querySelector('[data-act="plus"]').onclick  = ()=>adjustSetCount(item.id, +1);
    head.querySelector('[data-act="del"]').onclick   = ()=>removeExercise(item.id);
    card.appendChild(head);

    const unitRow = document.createElement("div");
    unitRow.className = "row";
    unitRow.style.marginTop = "10px";
    unitRow.innerHTML = `
      <div class="field" style="margin:0;">
        <label class="hint">この種目の単位</label>
        <div class="seg small">
          <button class="segbtn ${item.unit==="kg"?"active":""}" type="button" data-u="kg">kg</button>
          <button class="segbtn ${item.unit==="lb"?"active":""}" type="button" data-u="lb">lb</button>
        </div>
      </div>
      <div class="chip"><strong>セット</strong> ${item.sets.length}</div>
    `;
    unitRow.querySelectorAll("button").forEach(b=>{
      b.onclick = ()=> setItemUnit(item.id, b.dataset.u);
    });
    card.appendChild(unitRow);

    const makerRow = document.createElement("div");
    makerRow.className = "row";
    makerRow.style.marginTop = "10px";
    const makerOptions = [""].concat(state.manufacturers);
    makerRow.innerHTML = `
      <div class="field" style="margin:0; flex:1; min-width:220px;">
        <label class="hint">メーカー</label>
        <select class="sel">
          ${makerOptions.map(m=>`<option value="${escapeAttr(m)}" ${((item.manufacturer||"")===m)?"selected":""}>${escapeHtml(m===""?"(未選択)":m)}</option>`).join("")}
        </select>
      </div>
    `;
    const sel = makerRow.querySelector("select");
    sel.onchange = (e)=>setItemText(item.id, "manufacturer", e.target.value);
    card.appendChild(makerRow);

    const editRow = document.createElement("div");
    editRow.className = "row";
    editRow.style.marginTop = "10px";
    editRow.innerHTML = `
      <div class="field" style="flex:1; min-width:160px; margin:0;">
        <label class="hint">機材番号（編集可）</label>
        <input value="${escapeAttr(item.equipmentNo || "")}" placeholder="例：M-12">
      </div>
      <div class="field" style="flex:2; min-width:200px; margin:0;">
        <label class="hint">椅子/背中など（編集可）</label>
        <input value="${escapeAttr(item.setup || "")}" placeholder="例：椅子5 / 背中3">
      </div>
    `;
    const eqInput = editRow.querySelectorAll("input")[0];
    const stInput = editRow.querySelectorAll("input")[1];
    eqInput.oninput = (e)=>setItemText(item.id, "equipmentNo", e.target.value);
    stInput.oninput = (e)=>setItemText(item.id, "setup", e.target.value);
    card.appendChild(editRow);

    const sets = document.createElement("div");
    sets.className = "sets";
    item.sets.forEach((s, idx)=>{
      const row = document.createElement("div");
      row.className = "setrow";
      const weakOn = s.weak ? "on" : "";
      row.innerHTML = `
        <div class="mini">
          <span class="num">${idx+1}</span>
          <input inputmode="decimal" placeholder="重量(${escapeHtml(item.unit)})" value="${escapeAttr(fmtWeightForItem(item, s.wKg))}">
        </div>
        <div class="mini">
          <input inputmode="numeric" placeholder="回数" value="${escapeAttr(s.reps ?? "")}">
        </div>
        <div class="flag">
          <button class="badge ${weakOn}" type="button">△</button>
        </div>
      `;
      const w = row.querySelectorAll("input")[0];
      const r = row.querySelectorAll("input")[1];
      const b = row.querySelector("button");
      w.oninput = (e)=>setWeight(item.id, idx, e.target.value);
      r.oninput = (e)=>setReps(item.id, idx, e.target.value);
      b.onclick = ()=>toggleWeak(item.id, idx);
      sets.appendChild(row);
    });
    card.appendChild(sets);

    const c = document.createElement("div");
    c.className = "field";
    c.innerHTML = `
      <label class="hint">コメント（種目ごと）</label>
      <textarea rows="2" placeholder="例：今日は肘痛み注意">${escapeHtml(item.comment || "")}</textarea>
    `;
    c.querySelector("textarea").oninput = (e)=>setItemText(item.id, "comment", e.target.value);
    card.appendChild(c);

    cards.appendChild(card);
  }
}

// ===== Picker =====
function openPicker(){
  const dlg = el("dlgPicker");
  const list = el("pickList");
  const search = el("pickSearch");
  search.value = "";
  const renderList = ()=>{
    const q = search.value.trim().toLowerCase();
    list.innerHTML = "";
    const filtered = state.masters.filter(m => m.name.toLowerCase().includes(q));
    if (filtered.length === 0){
      list.innerHTML = `<div class="hint">見つかりません。種目マスタで追加できます。</div>`;
      return;
    }
    for (const m of filtered){
      const div = document.createElement("div");
      div.className = "pickitem";
      div.innerHTML = `
        <div class="name">${escapeHtml(m.name)}</div>
        <div class="sub">
          ${m.equipmentNo ? `機材 <strong>${escapeHtml(m.equipmentNo)}</strong>` : ``}
          ${m.setup ? ` ・ 設定 <strong>${escapeHtml(m.setup)}</strong>` : ``}
        </div>
        <button class="btn" type="button">追加</button>
      `;
      div.querySelector("button").onclick = async ()=>{
        dlg.close();
        await addExerciseById(m.id);
      };
      list.appendChild(div);
    }
  };
  search.oninput = renderList;
  renderList();
  dlg.showModal();
}

// ===== Master =====
async function refreshMasters(){
  state.masters = await getAllMasters();
}
async function openMaster(){
  await refreshMasters();
  renderMasterList();
  el("dlgMaster").showModal();
}
function renderMasterList(){
  const list = el("masterList");
  list.innerHTML = "";
  for (const m of state.masters){
    const div = document.createElement("div");
    div.className = "pickitem";
    div.innerHTML = `
      <div class="name">${escapeHtml(m.name)}</div>
      <div class="sub">
        ${m.equipmentNo ? `機材 <strong>${escapeHtml(m.equipmentNo)}</strong>` : ``}
        ${m.setup ? ` ・ 設定 <strong>${escapeHtml(m.setup)}</strong>` : ``}
      </div>
      <button class="btn ghost" type="button">編集</button>
    `;
    div.querySelector("button").onclick = ()=>openMasterEdit(m.id);
    list.appendChild(div);
  }
}

let editingMasterId = null;
async function openMasterEdit(id){
  editingMasterId = id || null;
  const dlg = el("dlgMasterEdit");
  const isNew = !id;
  el("masterEditTitle").textContent = isNew ? "種目追加" : "種目編集";

  let m = isNew ? { id: uid(), name:"", equipmentNo:"", setup:"", defaultComment:"" } : await getMaster(id);
  if (!m) m = { id: uid(), name:"", equipmentNo:"", setup:"", defaultComment:"" };

  el("meName").value = m.name;
  el("meEqNo").value = m.equipmentNo || "";
  el("meSetup").value = m.setup || "";
  el("meComment").value = m.defaultComment || "";

  el("btnMasterDelete").style.display = isNew ? "none" : "inline-flex";

  el("btnMasterSave").onclick = async ()=>{
    const name = el("meName").value.trim();
    if (!name){ alert("種目名を入力してね"); return; }
    m.name = name;
    m.equipmentNo = el("meEqNo").value.trim();
    m.setup = el("meSetup").value.trim();
    m.defaultComment = el("meComment").value.trim();
    await upsertMaster(m);
    await refreshMasters();
    renderMasterList();
    dlg.close();
    render();
  };

  el("btnMasterDelete").onclick = async ()=>{
    if (!confirm("この種目を削除しますか？")) return;
    await deleteMaster(m.id);
    await refreshMasters();
    if (state.workout){
      state.workout.items = state.workout.items.filter(x=>x.exId!==m.id);
      await autosave();
    }
    renderMasterList();
    dlg.close();
    render();
  };

  dlg.showModal();
}

// ===== Splits manager =====
function renderSplitsManager(){
  const host = el("splitsList");
  if (!host) return;
  host.innerHTML = "";
  state.splits.forEach((s, idx)=>{
    const div = document.createElement("div");
    div.className = "pickitem";
    div.innerHTML = `
      <div class="name">${escapeHtml(s.name)}</div>
      <div class="sub">ID: ${escapeHtml(s.id)}</div>
      <div class="row" style="margin-top:10px;">
        <button class="btn ghost" type="button" data-act="up">↑</button>
        <button class="btn ghost" type="button" data-act="down">↓</button>
        <button class="btn ghost" type="button" data-act="rename">名前変更</button>
        <button class="btn danger" type="button" data-act="del">削除</button>
      </div>
    `;
    div.querySelector('[data-act="up"]').onclick = ()=>moveSplit(idx, -1);
    div.querySelector('[data-act="down"]').onclick = ()=>moveSplit(idx, +1);
    div.querySelector('[data-act="rename"]').onclick = ()=>renameSplit(idx);
    div.querySelector('[data-act="del"]').onclick = ()=>deleteSplit(idx);
    host.appendChild(div);
  });
}

function makeSplitIdFromName(name){
  const base = name.trim().toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9\-_]/g,"");
  const seed = base || "part";
  let id = seed;
  let i = 2;
  while (state.splits.some(s=>s.id===id)){
    id = `${seed}-${i++}`;
  }
  return id;
}

async function persistSettings(){
  const settings = await getSettings();
  settings.splits = state.splits;
  settings.manufacturers = state.manufacturers;
  settings.unitDisplay = state.unitDisplay;
  await setSettings(settings);
  renderSplitTabs();
}

async function moveSplit(idx, delta){
  const j = idx + delta;
  if (j < 0 || j >= state.splits.length) return;
  const a = [...state.splits];
  const [x] = a.splice(idx,1);
  a.splice(j,0,x);
  state.splits = a;
  await persistSettings();
  renderSplitsManager();
  renderMakersManager();
}

async function renameSplit(idx){
  const cur = state.splits[idx];
  const name = prompt("部位名を入力", cur.name);
  if (!name) return;
  state.splits[idx] = { ...cur, name: name.trim() };
  await persistSettings();
  renderSplitsManager();
  render();
}

async function deleteSplit(idx){
  if (state.splits.length <= 1){
    alert("最低1つは必要です");
    return;
  }
  const s = state.splits[idx];
  if (!confirm(`部位「${s.name}」を削除しますか？\n（テンプレは残りますが、選べなくなります）`)) return;
  state.splits = state.splits.filter((_,i)=>i!==idx);
  if (!state.splits.some(x=>x.id===state.splitId)){
    setSplit(state.splits[0].id);
  }
  await persistSettings();
  renderSplitsManager();
}

async function addSplit(){
  const name = el("newSplitName").value.trim();
  if (!name){ alert("部位名を入力してね"); return; }
  const id = makeSplitIdFromName(name);
  state.splits.push({ id, name });
  el("newSplitName").value = "";
  await persistSettings();
  renderSplitsManager();
}


// ===== Manufacturers manager =====
function renderMakersManager(){
  const host = el("makersList");
  if (!host) return;
  host.innerHTML = "";
  state.manufacturers.forEach((name, idx)=>{
    const div = document.createElement("div");
    div.className = "pickitem";
    div.innerHTML = `
      <div class="name">${escapeHtml(name)}</div>
      <div class="row" style="margin-top:10px;">
        <button class="btn ghost" type="button" data-act="up">↑</button>
        <button class="btn ghost" type="button" data-act="down">↓</button>
        <button class="btn ghost" type="button" data-act="rename">名前変更</button>
        <button class="btn danger" type="button" data-act="del">削除</button>
      </div>
    `;
    div.querySelector('[data-act="up"]').onclick = ()=>moveMaker(idx, -1);
    div.querySelector('[data-act="down"]').onclick = ()=>moveMaker(idx, +1);
    div.querySelector('[data-act="rename"]').onclick = ()=>renameMaker(idx);
    div.querySelector('[data-act="del"]').onclick = ()=>deleteMaker(idx);
    host.appendChild(div);
  });
}

async function moveMaker(idx, delta){
  const j = idx + delta;
  if (j < 0 || j >= state.manufacturers.length) return;
  const a = [...state.manufacturers];
  const [x] = a.splice(idx,1);
  a.splice(j,0,x);
  state.manufacturers = a;
  await persistSettings();
  renderMakersManager();
}

async function renameMaker(idx){
  const cur = state.manufacturers[idx];
  const name = prompt("メーカー名を入力", cur);
  if (!name) return;
  state.manufacturers[idx] = name.trim();
  await persistSettings();
  renderMakersManager();
  render();
}

async function deleteMaker(idx){
  const cur = state.manufacturers[idx];
  if (!confirm(`メーカー「${cur}」を削除しますか？`)) return;
  state.manufacturers = state.manufacturers.filter((_,i)=>i!==idx);
  if (state.workout){
    for (const it of state.workout.items){
      if ((it.manufacturer||"") === cur) it.manufacturer = "";
    }
    await autosave();
  }
  await persistSettings();
  renderMakersManager();
  render();
}

async function addMaker(){
  const name = el("newMakerName").value.trim();
  if (!name){ alert("メーカー名を入力してね"); return; }
  if (state.manufacturers.includes(name)){
    alert("同じメーカー名が既にあります");
    return;
  }
  state.manufacturers.push(name);
  el("newMakerName").value = "";
  await persistSettings();
  renderMakersManager();
}

// ===== Template =====
async function loadTemplate(){
  const tpl = await getTemplate(state.splitId);
  if (!state.workout) return;

  const replace = state.workout.items.length > 0
    ? confirm("テンプレで今日のメニューを置き換えますか？\nOK=置き換え / キャンセル=追加")
    : true;

  if (replace) state.workout.items = [];

  for (const t of tpl.items){
    const master = state.masters.find(m=>m.id===t.exId);
    if (!master) continue;
    const hist = await getHistory(t.exId);
    const last = hist[0] || null;
    const equipmentNo = last?.equipmentNo || master.equipmentNo || "";
    const setup = last?.setup || master.setup || "";
    const comment = master.defaultComment || "";
    const unit = last?.unit || state.unitDisplay;
    const setsCount = clamp(t.sets || last?.sets?.length || 4, 1, 12);

    const item = { id: uid(), exId: t.exId, manufacturer: last?.manufacturer || "", equipmentNo, setup, comment, unit, sets: makeEmptySets(setsCount) };
    if (last?.sets?.length){
      for (let i=0;i<Math.min(item.sets.length, last.sets.length);i++){
        item.sets[i].wKg = last.sets[i].wKg ?? null;
        item.sets[i].reps = last.sets[i].reps ?? null;
      }
    }
    state.workout.items.push(item);
  }

  await autosave();
  render();
}

async function saveTemplateFromToday(){
  if (!state.workout) return;
  const items = state.workout.items.map(x=>({ exId: x.exId, sets: x.sets.length }));
  await saveTemplate({ splitId: state.splitId, items });
  alert("テンプレを上書きしました");
}


// ===== Calendar =====
let calCursor = null; // first day of month (Date)
let calHasDates = new Set(); // yyyy-mm-dd that have records

function ymd(d){
  const z = new Date(d.getTime() - d.getTimezoneOffset()*60000);
  return z.toISOString().slice(0,10);
}
function ym(d){
  const z = new Date(d.getTime() - d.getTimezoneOffset()*60000);
  return z.toISOString().slice(0,7);
}

async function refreshHasDates(){
  const workouts = (await idbAll(STORES.workouts)).map(r=>r.value);
  const s = new Set();
  for (const w of workouts){
    if (!w?.date) continue;
    if (Array.isArray(w.items) && w.items.length > 0){
      s.add(w.date);
    }
  }
  calHasDates = s;
}

function renderCalendar(){
  const title = el("calTitle");
  const grid = el("calGrid");
  if (!title || !grid || !calCursor) return;

  title.textContent = ym(calCursor);
  grid.innerHTML = "";

  const year = calCursor.getFullYear();
  const month = calCursor.getMonth();
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const start = new Date(year, month, 1 - startDow);

  const today = todayISO();
  const selected = state.date;

  for (let i=0;i<42;i++){
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const s = ymd(d);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "calday";
    if (d.getMonth() !== month) btn.classList.add("off");
    if (s === today) btn.classList.add("today");
    if (calHasDates.has(s)) btn.classList.add("has");
    if (s === selected) btn.classList.add("sel");
    btn.textContent = String(d.getDate());
    btn.onclick = async ()=>{
      const dlg = el("dlgCalendar");
      if (dlg) dlg.close();
      await loadDate(s);
    };
    grid.appendChild(btn);
  }
}

async function openCalendar(){
  await refreshHasDates();
  const d = state.date ? new Date(state.date + "T00:00:00") : new Date();
  calCursor = new Date(d.getFullYear(), d.getMonth(), 1);
  renderCalendar();
  el("dlgCalendar").showModal();
}

function moveCalendar(deltaMonths){
  if (!calCursor) return;
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + deltaMonths, 1);
  renderCalendar();
}

// ===== Backup =====
async function exportJSON(){
  const payload = {
    version: 3,
    exportedAt: new Date().toISOString(),
    settings: (await idbGet(STORES.settings, Keys.settings))?.value || { unitDisplay:"kg", splits: DEFAULT_SPLITS, manufacturers: [] },
    masters: (await idbAll(STORES.masters)).map(r=>r.value),
    templates: (await idbAll(STORES.templates)).map(r=>r.value),
    workouts: (await idbAll(STORES.workouts)).map(r=>r.value),
    histories: (await idbAll(STORES.historyByEx)).map(r=>({ key:r.key, value:r.value }))
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `workout_backup_${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importJSON(file){
  const text = await file.text();
  const data = JSON.parse(text);

  if (!data || (data.version !== 1 && data.version !== 2 && data.version !== 3)){
    alert("形式が違うみたい。正しいバックアップJSONを選んでね。");
    return;
  }
  if (!confirm("読み込むと、端末内データをバックアップ内容で上書きします。続行しますか？")) return;

  const settings = data.settings || { unitDisplay:"kg", splits: DEFAULT_SPLITS, manufacturers: [] };
  if (data.version === 1){
    if (settings.unit && !settings.unitDisplay) settings.unitDisplay = settings.unit;
    if (!settings.splits) settings.splits = DEFAULT_SPLITS;
    if (!settings.manufacturers) settings.manufacturers = [];
  }
  await setSettings(settings);

  for (const m of (data.masters || [])) await upsertMaster(m);
  for (const t of (data.templates || [])) await saveTemplate(t);
  for (const w of (data.workouts || [])){
    if (Array.isArray(w.items)){
      w.items = w.items.map(it => ({ manufacturer: it.manufacturer || "", unit: settings.unitDisplay || "kg", ...it }));
    }
    await saveWorkout(w);
  }
  for (const h of (data.histories || [])){
    if (!h?.key) continue;
    await idbPut(STORES.historyByEx, { key: h.key, value: h.value || [] });
  }

  await init();
  alert("復元しました");
}


// ===== CSV Export =====
function csvEscape(v){
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)){
    return '"' + s.replace(/"/g,'""') + '"';
  }
  return s;
}

async function exportCSV(){
  const settings = (await idbGet(STORES.settings, Keys.settings))?.value || { unitDisplay:"kg", splits: DEFAULT_SPLITS, manufacturers: [] };
  const splitNameById = new Map((settings.splits||DEFAULT_SPLITS).map(x=>[x.id,x.name]));
  const masters = new Map((await idbAll(STORES.masters)).map(r=>[r.value.id, r.value]));
  const workouts = (await idbAll(STORES.workouts)).map(r=>r.value).sort((a,b)=>(a.date||"").localeCompare(b.date||""));
  const header = [
    "date","split","exercise","exercise_id","set_no",
    "unit","weight_input","weight_kg","reps","weak",
    "manufacturer","equipment_no","setup","comment"
  ];
  const lines = [header.map(csvEscape).join(",")];

  for (const w of workouts){
    const date = w.date || "";
    const splitId = w.splitId || "";
    const splitName = splitNameById.get(splitId) || splitId;
    const items = Array.isArray(w.items) ? w.items : [];
    for (const it of items){
      const m = masters.get(it.exId) || {};
      const exName = m.name || "(不明)";
      const unit = it.unit || settings.unitDisplay || "kg";
      const mk = it.manufacturer || "";
      const eq = it.equipmentNo || m.equipmentNo || "";
      const setup = it.setup || m.setup || "";
      const comment = it.comment || m.defaultComment || "";
      const sets = Array.isArray(it.sets) ? it.sets : [];
      sets.forEach((s, idx)=>{
        const wKg = s.wKg ?? "";
        const wInput = (s.wKg == null) ? "" : (unit==="kg" ? s.wKg : kgToLb(s.wKg));
        const reps = s.reps ?? "";
        const weak = s.weak ? "1" : "0";
        const row = [
          date, splitName, exName, it.exId || "", String(idx+1),
          unit, wInput, wKg, reps, weak,
          mk, eq, setup, comment
        ];
        lines.push(row.map(csvEscape).join(","));
      });
    }
  }

  const bom = "\ufeff"; // Excel対策
  const blob = new Blob([bom + lines.join("\n")], { type:"text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `workout_daily_${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ===== Escape =====
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,"&quot;"); }

// ===== Wire =====
async function init(){
  await ensureSeed();

  const settings = await getSettings();
  state.unitDisplay = settings.unitDisplay || "kg";
  state.splits = Array.isArray(settings.splits) && settings.splits.length ? settings.splits : DEFAULT_SPLITS;
  state.manufacturers = Array.isArray(settings.manufacturers) ? settings.manufacturers : [];

  unitButtonsReflect();
  renderSplitTabs();
  renderSplitsManager();

  await refreshMasters();

  const dateInput = el("workDate");
  dateInput.value = state.date;
  state.workout = await getWorkout(state.date);

  const firstSplit = state.splits[0]?.id || "chest";
  if (!state.workout.splitId || !state.splits.some(s=>s.id===state.workout.splitId)){
    state.workout.splitId = firstSplit;
  }
  setSplit(state.workout.splitId);

  state.workout.items = (state.workout.items || []).map(it => ({ manufacturer: it.manufacturer || "", unit: state.unitDisplay, ...it }));
  await saveWorkout(state.workout);

  render();
}


async function loadDate(dateStr){
  state.date = dateStr || todayISO();
  const dateInput = el("workDate");
  if (dateInput) dateInput.value = state.date;

  state.workout = await getWorkout(state.date);
  const firstSplit = state.splits[0]?.id || "chest";
  if (!state.workout.splitId || !state.splits.some(s=>s.id===state.workout.splitId)){
    state.workout.splitId = firstSplit;
  }
  setSplit(state.workout.splitId);
  state.workout.items = (state.workout.items || []).map(it => ({ manufacturer: it.manufacturer || "", unit: state.unitDisplay, ...it }));
  await saveWorkout(state.workout);
  render();
}

document.addEventListener("DOMContentLoaded", async ()=>{
  el("workDate").addEventListener("change", async (e)=>{ await loadDate(e.target.value); });

  el("btnAddExercise").onclick = openPicker;

  const btnCal = el("btnCalendar");
  if (btnCal) btnCal.onclick = openCalendar;
  const btnPrev = el("btnCalPrev");
  const btnNext = el("btnCalNext");
  if (btnPrev) btnPrev.onclick = ()=>moveCalendar(-1);
  if (btnNext) btnNext.onclick = ()=>moveCalendar(1);
  el("btnLoadTemplate").onclick = loadTemplate;
  el("btnSaveTemplate").onclick = saveTemplateFromToday;

  el("btnMaster").onclick = openMaster;
  el("btnNewMaster").onclick = ()=>openMasterEdit(null);

  el("btnSettings").onclick = ()=>{
    unitButtonsReflect();
    renderSplitsManager();
    renderMakersManager();
    el("dlgSettings").showModal();
  };

  document.querySelectorAll("#dlgSettings .segbtn[data-unit]").forEach(b=>{
    b.onclick = async ()=>{
      state.unitDisplay = b.dataset.unit;
      document.querySelectorAll("#dlgSettings .segbtn[data-unit]").forEach(x=>x.classList.toggle("active", x===b));
      await persistSettings();
      render();
    };
  });

  el("btnExport").onclick = exportJSON;
  const btnCsv = el("btnExportCsv");
  if (btnCsv) btnCsv.onclick = exportCSV;
  el("fileImport").addEventListener("change", async (e)=>{
    const f = e.target.files?.[0];
    if (f) await importJSON(f);
    e.target.value = "";
  });

  el("btnAddSplit").onclick = addSplit;

  const btnAddMaker = el("btnAddMaker");
  if (btnAddMaker) btnAddMaker.onclick = addMaker;

  await init();
});
