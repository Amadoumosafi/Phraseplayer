/* app.js — PhrasePlayer (version complète avec synchro Start/Next/Finish iOS-safe)
   - Bibliothèque (liste de speeches) + renommage/suppression
   - Import d’audio local (m4a/mp3)
   - Transcript (Auto-split, Save)
   - Lecture phrase par phrase (Prev/Next, Repeat, Loop, Auto-advance)
   - Synchronisation Next-only : Start Synchronization → Next (continue) → Finish
   - Sauvegarde locale via idb.js (fallback mémoire si iOS privé selon idb.js)
*/

import { put, get, del, list } from "./idb.js";

// ---------- Helpers DOM ----------
const $  = (id) => document.getElementById(id);
const el = (sel, root = document) => root.querySelector(sel);

// ---------- Sélecteurs UI ----------
const newSpeechBtn   = $("newSpeechBtn");
const libNewBtn      = $("libNewBtn");
const speechList     = $("speechList");
const editor         = $("editor");
const libraryView    = $("libraryView");
const libraryGrid    = $("library");
const libEmpty       = $("libEmpty");
const backToLibBtn   = $("backToLibBtn");
const renameBtnTop   = $("renameBtnTop");

const speechTitle    = $("speechTitle");
const audioEl        = $("audio");
const audioInput     = $("audioInput");
const transcriptTA   = $("transcript");
const saveTranscriptBtn = $("saveTranscriptBtn");
const autoSplitBtn   = $("autoSplitBtn");
const clearTimesBtn  = $("clearTimesBtn");
const sentenceList   = $("sentenceList");

const playPauseBtn   = $("playPauseBtn");
const prevBtn        = $("prevBtn");
const nextBtn        = $("nextBtn");

const markStartBtn   = $("markStartBtn");
const markEndBtn     = $("markEndBtn");
const jumpStartBtn   = $("jumpStartBtn");
const jumpEndBtn     = $("jumpEndBtn");

const repeatCountInput = $("repeatCount");
const autoAdvanceChk   = $("autoAdvance");
const loopSentenceChk  = $("loopSentence");

const exportBtn      = $("exportBtn");
const importJsonInput = $("importJson");

// Sync buttons
const syncStartBtn   = $("syncStartBtn");
const syncNextBtn    = $("syncNextBtn");
const syncUndoBtn    = $("syncUndoBtn");
const syncFinishBtn  = $("syncFinishBtn");

// ---------- État ----------
const state = {
  currentId: null,
  currentIndex: 0,
  repeatLeft: 0,
  syncActive: false,
  lastBoundaryIdx: null, // pour Undo
  _timeupdateAttached: false,
};

// ---------- Accès au speech courant ----------
function getCurrentSpeechSync() { return window._spCache; }
async function updateCache() {
  if (!state.currentId) return null;
  window._spCache = await get("speeches", state.currentId);
  return window._spCache;
}

// ---------- Bibliothèque ----------
async function renderLibrary() {
  const items = await list("speeches");
  libraryGrid.innerHTML = "";
  libEmpty.classList.toggle("hidden", (items.length > 0));

  for (const sp of items.sort((a,b)=> (spTitle(a)).localeCompare(spTitle(b)))) {
    const tile = document.createElement("div");
    tile.className = "cardTile";
    const title = document.createElement("div");
    title.className = "tileTitle";
    title.textContent = spTitle(sp);
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = sp.audioName ? sp.audioName : "Aucun audio";
    const row = document.createElement("div");
    row.className = "tileRow";

    const openBtn = document.createElement("button");
    openBtn.textContent = "Ouvrir";
    openBtn.onclick = () => loadSpeech(sp.id);

    const renBtn = document.createElement("button");
    renBtn.textContent = "Renommer";
    renBtn.onclick = async () => {
      const t = prompt("Nouveau titre:", spTitle(sp));
      if (!t) return;
      sp.title = t.trim();
      await put("speeches", sp);
      if (state.currentId === sp.id) speechTitle.textContent = spTitle(sp);
      await refreshList();
      await renderLibrary();
    };

    const delBtn = document.createElement("button");
    delBtn.textContent = "Supprimer";
    delBtn.onclick = async () => {
      if (!confirm(`Supprimer "${spTitle(sp)}" ?`)) return;
      await del("speeches", sp.id);
      await del("audio", sp.id);
      if (state.currentId === sp.id) {
        state.currentId = null;
        showLibrary();
      }
      await refreshList();
      await renderLibrary();
    };

    row.append(openBtn, renBtn, delBtn);
    tile.append(title, hint, row);
    libraryGrid.appendChild(tile);
  }
}

function showLibrary() {
  editor.classList.add("hidden");
  libraryView.classList.remove("hidden");
  renderLibrary();
}
backToLibBtn.onclick = showLibrary;

// ---------- Liste latérale ----------
function spTitle(sp) { return sp?.title || "New Speech"; }
async function refreshList() {
  const items = await list("speeches");
  speechList.innerHTML = "";
  for (const sp of items.sort((a,b)=> (spTitle(a)).localeCompare(spTitle(b)))) {
    const li  = document.createElement("li");
    li.className = "speechItem";
    const load = document.createElement("button");
    load.className = "loadBtn";
    load.textContent = spTitle(sp);
    load.onclick = () => loadSpeech(sp.id);

    const ren = document.createElement("button");
    ren.className = "renameBtn";
    ren.title = "Renommer";
    ren.textContent = "✎";
    ren.onclick = async () => {
      const t = prompt("Nouveau titre:", spTitle(sp));
      if (!t) return;
      sp.title = t.trim();
      await put("speeches", sp);
      if (state.currentId === sp.id) speechTitle.textContent = spTitle(sp);
      await refreshList();
      await renderLibrary();
    };

    const delBtn = document.createElement("button");
    delBtn.className = "deleteBtn";
    delBtn.title = "Supprimer";
    delBtn.textContent = "🗑";
    delBtn.onclick = async () => {
      if (!confirm(`Supprimer "${spTitle(sp)}" ?`)) return;
      await del("speeches", sp.id);
      await del("audio", sp.id);
      if (state.currentId === sp.id) {
        state.currentId = null;
        showLibrary();
      }
      await refreshList();
      await renderLibrary();
    };

    li.append(load, ren, delBtn);
    speechList.appendChild(li);
  }
}

// ---------- Création / Chargement ----------
function makeBlankSpeech() {
  return { id: crypto.randomUUID(), title: "New Speech", sentences: [], audioName: null, duration: 0 };
}
async function createSpeech() {
  const sp = makeBlankSpeech();
  await put("speeches", sp);
  await refreshList();
  await renderLibrary();
  await loadSpeech(sp.id);
}
newSpeechBtn.onclick = createSpeech;
libNewBtn.onclick = createSpeech;

async function loadSpeech(id) {
  const sp = await get("speeches", id);
  if (!sp) return;

  state.currentId = id;
  state.currentIndex = 0;
  state.syncActive = false;
  state.lastBoundaryIdx = null;

  await updateCache();
  speechTitle.textContent = spTitle(sp);
  transcriptTA.value = sp.sentences.map(s => s.text).join("\n");
  await loadAudioFromDB(sp);
  renderSentences(getCurrentSpeechSync());

  libraryView.classList.add("hidden");
  editor.classList.remove("hidden");
  updateSyncButtons();
}

async function loadAudioFromDB(sp) {
  const rec = await get("audio", sp.id);
  if (rec && rec.blob) {
    const url = URL.createObjectURL(rec.blob);
    audioEl.src = url;
    audioEl.onloadedmetadata = () => {
      sp.duration = audioEl.duration || 0;
      put("speeches", sp);
    };
  } else {
    audioEl.removeAttribute("src");
  }
}

renameBtnTop.onclick = async () => {
  if (!state.currentId) return;
  const sp = await get("speeches", state.currentId);
  const t = prompt("Nouveau titre:", spTitle(sp));
  if (!t) return;
  sp.title = t.trim();
  await put("speeches", sp);
  speechTitle.textContent = spTitle(sp);
  await refreshList();
  await renderLibrary();
};

// ---------- Audio import ----------
audioInput.onchange = async (e) => {
  const file = e.target.files?.[0];
  if (!file || !state.currentId) return;
  const blob = new Blob([await file.arrayBuffer()], { type: file.type || "audio/mpeg" });
  const sp = await get("speeches", state.currentId);
  sp.audioName = file.name;
  await put("audio", { id: sp.id, blob });
  await put("speeches", sp);
  await loadAudioFromDB(sp);
  await renderLibrary();
};

// ---------- Transcript ----------
saveTranscriptBtn.onclick = async () => {
  if (!state.currentId) return;
  const sp = await get("speeches", state.currentId);
  const lines = transcriptTA.value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const newSentences = lines.map(text => {
    const old = sp.sentences.find(s => s.text === text);
    return old ? old : { text, start: null, end: null };
  });
  sp.sentences = newSentences;
  await put("speeches", sp);
  await updateCache();
  renderSentences(getCurrentSpeechSync());
};

autoSplitBtn.onclick = () => {
  const raw = transcriptTA.value;
  const parts = raw.replace(/\n+/g, " ").match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
  transcriptTA.value = parts.map(s => s.trim()).filter(Boolean).join("\n");
};

clearTimesBtn.onclick = async () => {
  if (!state.currentId) return;
  const sp = await get("speeches", state.currentId);
  sp.sentences = sp.sentences.map(s => ({ ...s, start: null, end: null }));
  await put("speeches", sp);
  await updateCache();
  renderSentences(getCurrentSpeechSync());
};

// ---------- Sentences list / lecture ----------
function toTimeStr(t){ return (t==null||isNaN(t)) ? "–" : t.toFixed(2)+"s"; }
function sentenceLabel(s){ return `[${toTimeStr(s.start)}, ${toTimeStr(s.end)}]`; }

function renderSentences(sp) {
  sentenceList.innerHTML = "";
  sp.sentences.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = "sentenceItem";

    const row = document.createElement("div");
    row.className = "row";
    const idx = document.createElement("span");
    idx.className = "index";
    idx.textContent = (i+1).toString().padStart(2,"0");

    const go = document.createElement("button");
    go.className = "goBtn";
    go.textContent = "▶";
    go.onclick = () => playSentence(i, true);

    const rep = document.createElement("button");
    rep.className = "repeatBtn";
    rep.textContent = "⟲";
    rep.onclick = () => {
      state.repeatLeft = Math.max(1, parseInt(repeatCountInput.value || "1", 10));
      playSentence(i, true);
    };

    const times = document.createElement("span");
    times.className = "times";
    times.textContent = sentenceLabel(s);

    row.append(idx, go, rep, times);
    const text = document.createElement("div");
    text.className = "text";
    text.textContent = s.text;
    li.append(row, text);
    sentenceList.appendChild(li);
  });
  highlightActive();
}

function highlightActive() {
  const sp = getCurrentSpeechSync();
  [...sentenceList.children].forEach((li, idx) => {
    li.classList.toggle("active", idx === state.currentIndex);
    const s = sp.sentences[idx];
    const times = li.querySelector(".times");
    if (times) times.textContent = sentenceLabel(s);
  });
}

function clamp(t,min,max){ return Math.max(min, Math.min(max, t)); }

async function ensureTimesFor(index) {
  await updateCache();
  const sp = getCurrentSpeechSync(); if (!sp) return;
  const s = sp.sentences[index]; if (!s) return;
  const now = audioEl.currentTime || 0;
  if (s.start == null) s.start = Math.max(0, now);
  if (s.end == null || s.end <= s.start) s.end = s.start + 1.5;
  await put("speeches", sp);
}

async function playSentence(index, restart) {
  if (index == null) index = state.currentIndex;
  const sp = await updateCache(); if (!sp) return;
  state.currentIndex = clamp(index, 0, (sp.sentences.length || 1) - 1);
  const s = sp.sentences[state.currentIndex]; if (!s) return;

  // S’il manque des bornes, fabrique une fenêtre sûre
  if (s.start == null || s.end == null || s.end <= s.start) {
    const now = audioEl.currentTime || 0;
    s.start = now;
    s.end = now + 1.5;
    await put("speeches", sp);
  }
  if (restart) {
    audioEl.currentTime = s.start ?? 0;
    audioEl.play().catch(()=>{});
    playPauseBtn.textContent = "Pause";
  }
  highlightActive();
}

prevBtn.onclick = () => playSentence(state.currentIndex - 1, true);
nextBtn.onclick = () => playSentence(state.currentIndex + 1, true);

playPauseBtn.onclick = async () => {
  await ensureTimesFor(state.currentIndex);
  const sp = getCurrentSpeechSync();
  const s = sp?.sentences[state.currentIndex];
  if (s?.start != null) audioEl.currentTime = s.start;

  if (audioEl.paused) {
    audioEl.playsInline = true;
    audioEl.muted = false;
    audioEl.play().catch(()=>{});
    playPauseBtn.textContent = "Pause";
  } else {
    audioEl.pause();
    playPauseBtn.textContent = "Play";
  }
};

markStartBtn.onclick = async () => {
  const sp = await updateCache(); if (!sp) return;
  const s = sp.sentences[state.currentIndex]; if (!s) return;
  s.start = audioEl.currentTime;
  if (s.end != null && s.end <= s.start) s.end = s.start + 0.1;
  await put("speeches", sp);
  renderSentences(sp);
};

markEndBtn.onclick = async () => {
  const sp = await updateCache(); if (!sp) return;
  const s = sp.sentences[state.currentIndex]; if (!s) return;
  s.end = audioEl.currentTime;
  if (s.start != null && s.end <= s.start) s.start = Math.max(0, s.end - 0.1);
  await put("speeches", sp);
  renderSentences(sp);
};

jumpStartBtn.onclick = async () => {
  const sp = getCurrentSpeechSync(); const s = sp?.sentences[state.currentIndex];
  if (s?.start != null) audioEl.currentTime = s.start;
};
jumpEndBtn.onclick = async () => {
  const sp = getCurrentSpeechSync(); const s = sp?.sentences[state.currentIndex];
  if (s?.end != null) audioEl.currentTime = Math.max(0, s.end - 0.05);
};

// ---------- Lecture: boucle / auto-advance ----------
function safeWindow(s){
  const start = s.start ?? 0;
  let end = s.end ?? (start + 1);
  if (!(end > start)) end = start + 1;
  return {start, end};
}
if (!state._timeupdateAttached) {
  audioEl.addEventListener("timeupdate", () => {
    // Pendant la synchro, ne JAMAIS auto-pause
    if (state.syncActive) return;

    const sp = getCurrentSpeechSync(); if (!sp) return;
    const s = sp.sentences[state.currentIndex]; if (!s) return;

    const ct = audioEl.currentTime ?? 0;
    const {start, end} = safeWindow(s);

    if (ct >= end) {
      if (loopSentenceChk.checked) {
        audioEl.currentTime = start;
        audioEl.play().catch(()=>{});
        return;
      }
      if (state.repeatLeft > 1) {
        state.repeatLeft -= 1;
        audioEl.currentTime = start;
        audioEl.play().catch(()=>{});
        return;
      }
      if (autoAdvanceChk.checked) {
        state.repeatLeft = Math.max(1, parseInt(repeatCountInput.value || "1", 10));
        playSentence(state.currentIndex + 1, true);
        return;
      }
      audioEl.pause();
      playPauseBtn.textContent = "Play";
    }
  });
  state._timeupdateAttached = true;
}

// ---------- Export / Import ----------
exportBtn.onclick = async () => {
  if (!state.currentId) return;
  const sp = await get("speeches", state.currentId);
  const audioRec = await get("audio", state.currentId);
  const data = { speech: sp, audio: null };
  if (audioRec?.blob) data.audio = await blobToDataURL(audioRec.blob);

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (spTitle(sp).replace(/[^\w\-]+/g, "_") || "speech") + ".json";
  a.click();
};

importJsonInput.onchange = async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  const text = await file.text(); let data;
  try { data = JSON.parse(text); } catch { alert("Invalid JSON"); return; }
  if (!data?.speech) { alert("Missing 'speech' field"); return; }
  const sp = data.speech; if (!sp.id) sp.id = crypto.randomUUID();
  await put("speeches", sp);
  if (data.audio) {
    const blob = dataURLToBlob(data.audio);
    await put("audio", { id: sp.id, blob });
  }
  await refreshList();
  await renderLibrary();
  await loadSpeech(sp.id);
};

// ---------- Utils ----------
function blobToDataURL(blob) {
  return new Promise((resolve)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.readAsDataURL(blob); });
}
function dataURLToBlob(dataURL){
  const [meta,b64] = dataURL.split(",");
  const mime = (meta.match(/data:(.*?);base64/)||[])[1] || "application/octet-stream";
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ---------- Mode Synchronisation (Start / Next / Undo / Finish) ----------
function updateSyncButtons() {
  syncStartBtn.classList.toggle("hidden", state.syncActive);
  syncNextBtn.classList.toggle("hidden", !state.syncActive);
  syncUndoBtn.classList.toggle("hidden", !state.syncActive);
  syncFinishBtn.classList.toggle("hidden", !state.syncActive);
}

syncStartBtn.onclick = async () => {
  if (!state.currentId) return;
  const sp = await updateCache(); if (!sp) return;
  if (!sp.sentences.length) { alert("Ajoute et enregistre le transcript d’abord."); return; }

  // Init phrase courante
  const s = sp.sentences[state.currentIndex];
  const now = audioEl.currentTime || 0;
  if (s.start == null) s.start = now;
  // fenêtre sûre minimale pour éviter coupure automatique
  if (s.end == null || s.end <= s.start) s.end = s.start + 2;

  await put("speeches", sp);
  renderSentences(sp);

  state.syncActive = true;
  state.lastBoundaryIdx = null;

  audioEl.playsInline = true;
  audioEl.muted = false;
  audioEl.play().catch(()=>{});
  playPauseBtn.textContent = "Pause";
  updateSyncButtons();
};

syncNextBtn.onclick = async () => {
  if (!state.syncActive) return;
  const sp = await updateCache(); if (!sp) return;

  const i = state.currentIndex;
  const cur = sp.sentences[i];
  const now = audioEl.currentTime || 0;

  // fermer la phrase courante
  if (cur) cur.end = Math.max(cur.start ?? 0, now - 0.01);

  // passer à la suivante et ouvrir son start
  if (i + 1 < sp.sentences.length) {
    state.currentIndex = i + 1;
    const nxt = sp.sentences[state.currentIndex];
    if (nxt.start == null) nxt.start = now;
    if (nxt.end == null || nxt.end <= nxt.start) nxt.end = nxt.start + 2;
  }

  state.lastBoundaryIdx = i;
  await put("speeches", sp);
  renderSentences(sp);

  // continuer la lecture
  audioEl.play().catch(()=>{});
  highlightActive();
};

syncUndoBtn.onclick = async () => {
  const sp = await updateCache(); if (!sp) return;
  const i = state.lastBoundaryIdx; if (i == null) return;

  const cur = sp.sentences[i];
  const nxt = sp.sentences[i+1];

  if (cur) cur.end = null;
  if (nxt) nxt.start = null;

  state.currentIndex = i;
  state.lastBoundaryIdx = null;

  await put("speeches", sp);
  renderSentences(sp);
  highlightActive();
};

syncFinishBtn.onclick = async () => {
  const sp = await updateCache(); if (!sp) return;
  const cur = sp.sentences[state.currentIndex];
  const end = isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : (audioEl.currentTime || 0);

  if (cur) {
    if (cur.end == null || cur.end <= (cur.start ?? 0)) cur.end = end;
  }
  await put("speeches", sp);
  renderSentences(sp);

  state.syncActive = false;
  state.lastBoundaryIdx = null;
  playPauseBtn.textContent = "Play";
  updateSyncButtons();
};

// ---------- Boot ----------
(async function boot(){
  await refreshList();
  showLibrary(); // commence par la bibliothèque
})();
