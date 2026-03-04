// ===== PWA =====
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(()=>{});
}

// ===== Utils =====
const SPLITS = [
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
const DB_VER = 1;
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
    const st = tx.objectStore(store);
    const req = st.get(key);
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
    const st = tx.objectStore(store);
    const req = st.getAll();
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
  return x?.value || { unit:"kg" };
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
  return r?.value || { date, splitId:"chest", items: [] };
}
async function saveWorkout(w){
  await idbPut(STORES.workouts, { key: Keys.workout(w.date), value: w });
}

async function getHistory(exId){
  const r = await idbGet(STORES.historyByEx, Keys.history(exId));
  return r?.value || []; // newest first
}
async function pushHistory(exId, entry){
  const arr = await getHistory(exId);
  arr.unshift(entry);
  const trimmed = arr.slice(0, 30);
  await idbPut(STORES.historyByEx, { key: Keys.history(exId), value: trimmed });
}

// ===== Initial seed =====
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
}

// ===== UI State =====
let state = {
  splitId: "chest",
  unit: "kg",
  date: todayISO(),
  workout: null,
  masters: []
};

const el = (id)=>document.getElementById(id);
const cards = el("cards");

function setSplit(splitId){
  state.splitId = splitId;
  document.querySelectorAll(".segbtn[data-split]").forEach(b=>{
    b.classList.toggle("active", b.dataset.split === splitId);
  });
  if (state.workout){
    state.workout.splitId = splitId;
    autosave();
    render();
  }
}

function unitButtonsReflect(){
  const dlg = el("dlgSettings");
  dlg.querySelectorAll(".segbtn[data-unit]").forEach(b=>{
    b.classList.toggle("active", b.dataset.unit === state.unit);
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
      exerciseName: master?.name || "(不明)",
      equipmentNo: item.equipmentNo || master?.equipmentNo || "",
      setup: item.setup || master?.setup || "",
      sets: item.sets
    };
    await pushHistory(item.exId, entry);
  }
}

function makeEmptySets(n){
  const arr = [];
  for (let i=0;i<n;i++){
    arr.push({ wKg:null, reps:null, weak:false });
  }
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

  const item = {
    id: uid(),
    exId,
    equipmentNo,
    setup,
    comment,
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
  if (n == null){ item.sets[idx].wKg = null; }
  else{
    item.sets[idx].wKg = state.unit === "kg" ? n : lbToKg(n);
  }
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

// ===== Rendering =====
function fmtWeight(kg){
  if (kg == null) return "";
  return state.unit === "kg" ? String(kg) : String(kgToLb(kg));
}
function unitLabel(){ return state.unit; }

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

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `
      <span class="chip"><strong>単位</strong> ${unitLabel()}</span>
      <span class="chip"><strong>セット</strong> ${item.sets.length}</span>
    `;
    card.appendChild(meta);

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
          <input inputmode="decimal" placeholder="重量(${unitLabel()})" value="${escapeAttr(fmtWeight(s.wKg))}">
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

async function refreshMasters(){
  state.masters = await getAllMasters();
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
    const setsCount = clamp(t.sets || last?.sets?.length || 4, 1, 12);

    const item = {
      id: uid(),
      exId: t.exId,
      equipmentNo,
      setup,
      comment,
      sets: makeEmptySets(setsCount)
    };
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
  const tpl = { splitId: state.splitId, items };
  await saveTemplate(tpl);
  alert("テンプレを上書きしました");
}

// ===== History =====
async function openHistory(){
  const body = el("historyBody");
  body.innerHTML = "";

  const todayExIds = new Set(state.workout?.items.map(x=>x.exId) || []);
  const ordered = [...state.masters].sort((a,b)=>{
    const A = todayExIds.has(a.id) ? 0 : 1;
    const B = todayExIds.has(b.id) ? 0 : 1;
    if (A!==B) return A-B;
    return a.name.localeCompare(b.name,"ja");
  });

  for (const m of ordered){
    const hist = await getHistory(m.id);
    const last = hist[0];
    const div = document.createElement("div");
    div.className = "pickitem";
    div.innerHTML = `
      <div class="name">${escapeHtml(m.name)}</div>
      <div class="sub">${last ? `${escapeHtml(last.date)} / ${escapeHtml(SPLITS.find(s=>s.id===last.splitId)?.name || "")}` : "履歴なし"}</div>
      ${last ? renderHistoryDetail(last) : ""}
    `;
    body.appendChild(div);
  }

  el("dlgHistory").showModal();
}

function renderHistoryDetail(last){
  const sample = (last.sets || []).slice(0,3).map(s=>{
    const w = s.wKg == null ? "-" : (state.unit==="kg" ? s.wKg : kgToLb(s.wKg));
    const r = s.reps ?? "-";
    return `${w}${unitLabel()} x ${r}${s.weak ? "△" : ""}`;
  }).join(" / ");
  const eq = last.equipmentNo ? `機材 <strong>${escapeHtml(last.equipmentNo)}</strong>` : "";
  const st = last.setup ? ` ・ 設定 <strong>${escapeHtml(last.setup)}</strong>` : "";
  return `<div class="sub">${eq}${st}</div><div class="sub">${escapeHtml(sample)}</div>`;
}

// ===== Backup (JSON export/import) =====
async function exportJSON(){
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: (await idbGet(STORES.settings, Keys.settings))?.value || { unit:"kg" },
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

  if (!data || data.version !== 1){
    alert("形式が違うみたい。正しいバックアップJSONを選んでね。");
    return;
  }
  if (!confirm("読み込むと、端末内データをバックアップ内容で上書きします。続行しますか？")) return;

  await setSettings(data.settings || { unit:"kg" });

  for (const m of (data.masters || [])){
    await upsertMaster(m);
  }
  for (const t of (data.templates || [])){
    await saveTemplate(t);
  }
  for (const w of (data.workouts || [])){
    await saveWorkout(w);
  }
  for (const h of (data.histories || [])){
    if (!h?.key) continue;
    await idbPut(STORES.historyByEx, { key: h.key, value: h.value || [] });
  }

  await init();
  alert("復元しました");
}

// ===== HTML escape =====
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}
function escapeAttr(s){ return escapeHtml(s).replace(/"/g,"&quot;"); }

// ===== Wire up =====
async function init(){
  await ensureSeed();

  const settings = await getSettings();
  state.unit = settings.unit || "kg";
  unitButtonsReflect();

  await refreshMasters();

  const dateInput = el("workDate");
  dateInput.value = state.date;
  state.workout = await getWorkout(state.date);

  setSplit(state.workout.splitId || state.splitId);

  render();
}

document.addEventListener("DOMContentLoaded", async ()=>{
  document.querySelectorAll(".segbtn[data-split]").forEach(b=>{
    b.onclick = ()=> setSplit(b.dataset.split);
  });

  el("workDate").addEventListener("change", async (e)=>{
    state.date = e.target.value || todayISO();
    state.workout = await getWorkout(state.date);
    setSplit(state.workout.splitId || state.splitId);
    render();
  });

  el("btnAddExercise").onclick = openPicker;

  el("btnLoadTemplate").onclick = loadTemplate;
  el("btnSaveTemplate").onclick = saveTemplateFromToday;

  el("btnMaster").onclick = openMaster;
  el("btnNewMaster").onclick = ()=>openMasterEdit(null);

  el("btnHistory").onclick = openHistory;

  el("btnSettings").onclick = ()=>{
    unitButtonsReflect();
    el("dlgSettings").showModal();
  };
  document.querySelectorAll("#dlgSettings .segbtn[data-unit]").forEach(b=>{
    b.onclick = async ()=>{
      state.unit = b.dataset.unit;
      document.querySelectorAll("#dlgSettings .segbtn[data-unit]").forEach(x=>x.classList.toggle("active", x===b));
      await setSettings({ unit: state.unit });
      render();
    };
  });
  el("btnExport").onclick = exportJSON;
  el("fileImport").addEventListener("change", async (e)=>{
    const f = e.target.files?.[0];
    if (f) await importJSON(f);
    e.target.value = "";
  });

  await init();
});
