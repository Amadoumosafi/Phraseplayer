import { put, get, del, list } from "./idb.js";

const $ = (id) => document.getElementById(id);
const el = (sel, root = document) => root.querySelector(sel);
const tpl = (id) => el(`#${id}`).content.firstElementChild.cloneNode(true);

// UI
const newSpeechBtn = $("newSpeechBtn");
const libNewBtn = $("libNewBtn");
const speechList = $("speechList");
const editor = $("editor");
const libraryView = $("libraryView");
const libraryGrid = $("library");
const libEmpty = $("libEmpty");
const backToLibBtn = $("backToLibBtn");
const renameBtnTop = $("renameBtnTop");

const speechTitle = $("speechTitle");
const audioEl = $("audio");
const audioInput = $("audioInput");
const transcriptTA = $("transcript");
const saveTranscriptBtn = $("saveTranscriptBtn");
const autoSplitBtn = $("autoSplitBtn");
const clearTimesBtn = $("clearTimesBtn");
const sentenceList = $("sentenceList");

const playPauseBtn = $("playPauseBtn");
const prevBtn = $("prevBtn");
const nextBtn = $("nextBtn");

const markStartBtn = $("markStartBtn");
const markEndBtn = $("markEndBtn");
const jumpStartBtn = $("jumpStartBtn");
const jumpEndBtn = $("jumpEndBtn");

const repeatCountInput = $("repeatCount");
const autoAdvanceChk = $("autoAdvance");
const loopSentenceChk = $("loopSentence");

const exportBtn = $("exportBtn");
const importJsonInput = $("importJson");

// Sync (Next-only)
const syncStartBtn = $("syncStartBtn");
const syncNextBtn = $("syncNextBtn");
const syncUndoBtn = $("syncUndoBtn");
const syncFinishBtn = $("syncFinishBtn");

let state = {
  currentId: null,
  currentIndex: 0,
  repeatLeft: 0,
  syncActive: false,
  lastBoundaryIdx: null
};

function toTimeStr(t) { return (t==null || isNaN(t)) ? "–" : t.toFixed(2)+"s"; }
function sentenceLabel(s) { return `[${toTimeStr(s.start)}, ${toTimeStr(s.end)}]`; }
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
  libEmpty.classList.toggle("hidden", items.length > 0);

  for (const sp of items.sort((a,b)=>a.title.localeCompare(b.title))) {
    const tile = tpl("tileTpl");
    el(".tileTitle", tile).textContent = sp.title || "Sans titre";
    el(".hint", tile).textContent = sp.audioName ? sp.audioName : "Aucun audio";
    el(".openTile", tile).onclick = () => loadSpeech(sp.id);
    el(".renameTile", tile).onclick = async () => {
      const title = prompt("Nouveau titre:", sp.title || "");
      if (!title) return;
      sp.title = title.trim();
      await put("speeches", sp);
      if (state.currentId === sp.id) speechTitle.textContent = sp.title;
      await refreshList();
      await renderLibrary();
    };
    el(".deleteTile", tile).onclick = async () => {
      if (!confirm(`Supprimer "${sp.title}" ?`)) return;
      await del("speeches", sp.id);
      await del("audio", sp.id);
      if (state.currentId === sp.id) {
        state.currentId = null;
        editor.classList.add("hidden");
        libraryView.classList.remove("hidden");
      }
      await refreshList();
      await renderLibrary();
    };
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
async function refreshList() {
  const items = await list("speeches");
  speechList.innerHTML = "";
  for (const sp of items.sort((a,b)=>a.title.localeCompare(b.title))) {
    const li = document.createElement("li");
    li.className = "speechItem";
    const load = document.createElement("button");
    load.className = "loadBtn";
    load.textContent = sp.title || "Sans titre";
    load.onclick = () => loadSpeech(sp.id);
    const ren = document.createElement("button");
    ren.className = "renameBtn";
    ren.title = "Renommer";
    ren.textContent = "✎";
    ren.onclick = async () => {
      const title = prompt("Nouveau titre:", sp.title || "");
      if (!title) return;
      sp.title = title.trim();
      await put("speeches", sp);
      if (state.currentId === sp.id) speechTitle.textContent = sp.title;
      await refreshList();
      await renderLibrary();
    };
    const delBtn = document.createElement("button");
    delBtn.className = "deleteBtn";
    delBtn.title = "Supprimer";
    delBtn.textContent = "🗑";
    delBtn.onclick = async () => {
      if (!confirm(`Supprimer "${sp.title}" ?`)) return;
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

// ---------- Chargement Speech ----------
async function loadSpeech(id) {
  const sp = await get("speeches", id);
  if (!sp) return;

  state.currentId = id;
  state.currentIndex = 0;
  state.syncActive = false;
  await updateCache();

  speechTitle.textContent = sp.title || "New Speech";
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
    audioEl.onloadedmetadata = () => { sp.duration = audioEl.duration || 0; put("speeches", sp); };
  } else {
    audioEl.removeAttribute("src");
  }
}

renameBtnTop.onclick = async () => {
  if (!state.currentId) return;
  const sp = await get("speeches", state.currentId);
  const title = prompt("Nouveau titre:", sp.title || "");
  if (!title) return;
  sp.title = title.trim();
  await put("speeches", sp);
  speechTitle.textContent = sp.title;
  await refreshList();
  await renderLibrary();
};

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
function renderSentences(sp) {
  sentenceList.innerHTML = "";
  sp.sentences.forEach((s, i) => {
    const li = document.createElement("li");
    li.className = "sentenceItem";
    const row = document.createElement("div"); row.className = "row";
    const idx = document.createElement("span"); idx.className = "index"; idx.textContent = (i+1).toString().padStart(2,"0");
    const go = document.createElement("button"); go.className = "goBtn"; go.textContent = "▶";
    go.onclick = () => playSentence(i, true);
    const rep = document.createElement("button"); rep.className = "repeatBtn"; rep.textContent = "⟲";
    rep.onclick = () => { state.repeatLeft = Math.max(1, parseInt(repeatCountInput.value || "1", 10)); playSentence(i, true); };
    const times = document.createElement("span"); times.className = "times"; times.textContent = sentenceLabel(s);
    row.append(idx, go, rep, times);
    const text = document.createElement("div"); text.className = "text"; text.textContent = s.text;
    li.append(row, text);
    sentenceList.appendChild(li);
  });
  highlightActive();
}

function highlightActive() {
  [...sentenceList.children].forEach((li, idx) => {
    li.classList.toggle("active", idx === state.currentIndex);
    const s = getCurrentSpeechSync().sentences[idx];
    el(".times", li).textContent = sentenceLabel(s);
  });
}

function clamp(t, min, max) { return Math.max(min, Math.min(max, t)); }
async function playSentence(index, restart) {
  if (index == null) index = state.currentIndex;
  state.currentIndex = clamp(index, 0, (getCurrentSpeechSync()?.sentences.length || 1)-1);
  await updateCache();
  const sp = getCurrentSpeechSync(); const s = sp.sentences[state.currentIndex]; if (!s) return;
  if (s.start == null || s.end == null || s.end <= s.start) {
    const now = audioEl.currentTime || 0; s.start = now; s.end = now + 1.5; await put("speeches", sp); await updateCache();
  }
  if (restart) { audioEl.currentTime = s.start ?? 0; audioEl.play(); }
  highlightActive();
}

prevBtn.onclick = () => playSentence(state.currentIndex - 1, true);
nextBtn.onclick = () => playSentence(state.currentIndex + 1, true);

playPauseBtn.onclick = () => {
  if (audioEl.paused) audioEl.play(); else audioEl.pause();
  playPauseBtn.textContent = audioEl.paused ? "Play" : "Pause";
};

markStartBtn.onclick = async () => {
  await updateCache();
  const sp = getCurrentSpeechSync(); const s = sp.sentences[state.currentIndex];
  s.start = audioEl.currentTime; if (s.end != null && s.end <= s.start) s.end = s.start + 0.1;
  await put("speeches", sp); renderSentences(sp); highlightActive();
};

markEndBtn.onclick = async () => {
  await updateCache();
  const sp = getCurrentSpeechSync(); const s = sp.sentences[state.currentIndex];
  s.end = audioEl.currentTime; if (s.start != null && s.end <= s.start) s.start = Math.max(0, s.end - 0.1);
  await put("speeches", sp); renderSentences(sp); highlightActive();
};

jumpStartBtn.onclick = () => { const sp = getCurrentSpeechSync(); const s = sp?.sentences[state.currentIndex]; if (s?.start!=null) audioEl.currentTime = s.start; };
jumpEndBtn.onclick = () => { const sp = getCurrentSpeechSync(); const s = sp?.sentences[state.currentIndex]; if (s?.end!=null) audioEl.currentTime = Math.max(0, s.end - 0.05); };

// ---------- Boucles / auto-advance ----------
audioEl.addEventListener("timeupdate", async () => {
  const sp = getCurrentSpeechSync(); if (!sp) return;
  const s = sp.sentences[state.currentIndex]; if (!s) return;
  const ct = audioEl.currentTime ?? 0; const start = s.start ?? 0; const end = s.end ?? (start + 1);
  if (ct >= end) {
    if (loopSentenceChk.checked) { audioEl.currentTime = start; audioEl.play(); return; }
    if (state.repeatLeft > 1) { state.repeatLeft -= 1; audioEl.currentTime = start; audioEl.play(); return; }
    if (autoAdvanceChk.checked) { state.repeatLeft = Math.max(1, parseInt(repeatCountInput.value || "1", 10)); playSentence(state.currentIndex + 1, true); return; }
    audioEl.pause(); playPauseBtn.textContent = "Play";
  }
});

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
  a.download = (sp.title.replace(/[^\w\-]+/g, "_") || "speech") + ".json";
  a.click();
};

importJsonInput.onchange = async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  const text = await file.text(); let data;
  try { data = JSON.parse(text); } catch { alert("Invalid JSON"); return; }
  if (!data?.speech) { alert("Missing 'speech' field"); return; }
  const sp = data.speech; if (!sp.id) sp.id = crypto.randomUUID();
  await put("speeches", sp);
  if (data.audio) { const blob = dataURLToBlob(data.audio); await put("audio", { id: sp.id, blob }); }
  await refreshList(); await renderLibrary(); await loadSpeech(sp.id);
};

// Utils
function blobToDataURL(blob) { return new Promise((resolve)=>{ const r=new FileReader(); r.onload=()=>resolve(r.result); r.readAsDataURL(blob); }); }
function dataURLToBlob(dataURL) {
  const [meta, b64] = dataURL.split(","); const mime = (meta.match(/data:(.*?);base64/)||[])[1] || "application/octet-stream";
  const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ---------- Mode Start Synchronization / Next-only ----------
function updateSyncButtons() {
  syncStartBtn.classList.toggle("hidden", state.syncActive);
  syncNextBtn.classList.toggle("hidden", !state.syncActive);
  syncUndoBtn.classList.toggle("hidden", !state.syncActive);
  syncFinishBtn.classList.toggle("hidden", !state.syncActive);
}

syncStartBtn.onclick = async () => {
  if (!state.currentId) return;
  await updateCache();
  const sp = getCurrentSpeechSync(); if (!sp || !sp.sentences.length) { alert("Ajoute et enregistre d'abord le transcript."); return; }

  // Démarre à la phrase courante (0 par défaut) et pose son start si absent
  const s = sp.sentences[state.currentIndex];
  if (s.start == null) s.start = audioEl.currentTime || 0;
  await put("speeches", sp); renderSentences(sp);

  audioEl.play();
  state.syncActive = true;
  state.lastBoundaryIdx = null;
  updateSyncButtons();
};

syncNextBtn.onclick = async () => {
  if (!state.syncActive) return;
  await updateCache();
  const sp = getCurrentSpeechSync(); if (!sp) return;

  const i = state.currentIndex;
  const s = sp.sentences[i]; if (!s) return;
  const now = audioEl.currentTime || 0;

  // Clôture phrase courante et ouvre la suivante
  s.end = Math.max((s.start ?? now), now);
  const n = sp.sentences[i+1];
  if (n) n.start = now;

  await put("speeches", sp);
  renderSentences(sp);
  state.lastBoundaryIdx = i;

  if (n) { state.currentIndex = i+1; highlightActive(); }
};

syncUndoBtn.onclick = async () => {
  await updateCache();
  const sp = getCurrentSpeechSync(); if (!sp) return;
  const i = state.lastBoundaryIdx; if (i==null) return;
  const cur = sp.sentences[i]; const next = sp.sentences[i+1];
  if (cur) cur.end = null; if (next) next.start = null;
  state.currentIndex = i; state.lastBoundaryIdx = null;
  await put("speeches", sp); renderSentences(sp); highlightActive();
};

syncFinishBtn.onclick = async () => {
  await updateCache();
  const sp = getCurrentSpeechSync(); if (!sp) return;
  const i = state.currentIndex; const s = sp.sentences[i]; if (!s) return;

  const end = isFinite(audioEl.duration) && audioEl.duration > 0 ? audioEl.duration : (audioEl.currentTime || 0);
  s.end = Math.max((s.start ?? 0), end);

  await put("speeches", sp); renderSentences(sp);
  state.syncActive = false; state.lastBoundaryIdx = null;
  updateSyncButtons();
};

// ---------- Boot ----------
(async function boot() {
  await refreshList();
  showLibrary(); // démarrer sur la bibliothèque
})();
