// 英語ノート: 英文タブ・解説タブ・同期タブ
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const STATUS = { new: "未学習", learning: "学習中", mastered: "覚えた" };

  const db = { sentence: [], note: [] };
  const ui = { shuffle: false, order: null, showJa: true, open: new Set(), editing: null, playing: false, playId: null, editNote: null };

  let toastT;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 3500) }
  const download = (name, text, type) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000) };
  const readFile = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(f) });

  // ---------- タブ ----------
  function showTab(name) {
    for (const b of document.querySelectorAll("#tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === name));
    for (const s of document.querySelectorAll(".tab")) s.hidden = s.id !== "tab-" + name;
    if (name === "sync") Sync.render();
    if (name !== "sent") stop();
    localStorage.setItem("tab", name);
  }
  $("#tabs").onclick = e => { const b = e.target.closest("button[data-tab]"); if (b) showTab(b.dataset.tab) };
  $("#syncStatus").onclick = () => showTab("sync");

  // ---------- 英文 ----------
  const groupsOf = s => (s.groups || []);
  const splitGroups = t => [...new Set(String(t || "").split(/[、,]/).map(x => x.trim()).filter(Boolean))];
  const norm = t => t.toLowerCase().replace(/\s+/g, " ").trim();

  function addSentences(rows) { // rows: [{text, ja, groups}]。同じ英文は足りない項目だけ足す
    const have = new Map(db.sentence.map(s => [norm(s.text), s])), put = [];
    let added = 0, merged = 0;
    for (const r of rows) {
      const text = String(r.text || "").replace(/\s+/g, " ").trim().slice(0, 500);
      if (!text) continue;
      const ex = have.get(norm(text));
      if (ex) {
        let ch = false;
        if (!ex.ja && r.ja) { ex.ja = r.ja; ch = true }
        const g = [...new Set([...groupsOf(ex), ...(r.groups || [])])];
        if (g.length !== groupsOf(ex).length) { ex.groups = g; ch = true }
        if (ch) { put.push(ex); merged++ }
        continue;
      }
      const s = { id: uid(), text, ja: String(r.ja || "").slice(0, 500), groups: r.groups || [], status: "new", count: 0, created: Date.now() };
      db.sentence.push(s); have.set(norm(text), s); put.push(s); added++;
    }
    if (put.length) Store.put(put, "sentences");
    return { added, merged };
  }

  function parseCsv(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++ } else q = false } else cell += c }
      else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = "" }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = "" }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row) }
    return rows.filter(r => r.some(x => x.trim()));
  }

  function filtered() {
    const q = $("#fq").value.trim().toLowerCase(), g = $("#fgroup").value, st = $("#fstatus").value;
    let a = db.sentence.filter(s => (!q || s.text.toLowerCase().includes(q) || (s.ja || "").toLowerCase().includes(q)) &&
      (!g || (g === "\u0000none" ? !groupsOf(s).length : groupsOf(s).includes(g))) && (!st || s.status === st));
    if (ui.shuffle) {
      if (!ui.order) ui.order = new Map(db.sentence.map(s => [s.id, Math.random()]));
      a.sort((x, y) => (ui.order.get(x.id) ?? 0) - (ui.order.get(y.id) ?? 0));
    }
    return a;
  }

  function renderGroups() {
    const sel = $("#fgroup"), cur = sel.value, set = new Map();
    for (const s of db.sentence) for (const g of groupsOf(s)) set.set(g, (set.get(g) || 0) + 1);
    sel.innerHTML = '<option value="">グループ: すべて</option><option value="\u0000none">グループなし</option>' +
      [...set].sort((a, b) => a[0].localeCompare(b[0], "ja")).map(([g, n]) => `<option value="${esc(g)}">${esc(g)} (${n})</option>`).join("");
    sel.value = [...sel.options].some(o => o.value === cur) ? cur : "";
  }

  function itemHtml(s) {
    if (ui.editing === s.id) return `<div class="item edit" data-id="${s.id}">
      <textarea class="eText" rows="2" maxlength="500">${esc(s.text)}</textarea>
      <input class="eJa" type="text" maxlength="500" placeholder="和訳" value="${esc(s.ja)}">
      <input class="eGrp" type="text" maxlength="80" placeholder="グループ(「、」で複数)" value="${esc(groupsOf(s).join("、"))}">
      <div class="row"><button class="pri" data-a="save">保存</button><button data-a="cancel">やめる</button></div></div>`;
    return `<div class="item st-${s.status}${ui.playId === s.id ? " playing" : ""}" data-id="${s.id}">
      <div class="en" data-a="play" title="クリックで聞く">${esc(s.text)}</div>
      ${ui.showJa && s.ja ? `<div class="ja">${esc(s.ja)}</div>` : ""}
      <div class="meta">
        <select data-a="status" aria-label="状態">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${s.status === k ? " selected" : ""}>${v}</option>`).join("")}</select>
        ${groupsOf(s).map(g => `<span class="tag">${esc(g)}</span>`).join("")}
        <span class="grow"></span>
        <button class="sm" data-a="edit">編集</button><button class="sm danger" data-a="del">削除</button>
      </div></div>`;
  }

  function renderList() {
    renderGroups();
    const a = filtered();
    $("#list").innerHTML = a.length ? a.map(itemHtml).join("") : '<div class="card sub">英文がありません。「＋ 英文」から追加してください。</div>';
    $("#info").textContent = `${a.length} / ${db.sentence.length} 文`;
    $("#btnShuffle").setAttribute("aria-pressed", String(ui.shuffle));
  }

  $("#list").addEventListener("click", e => {
    const el = e.target.closest("[data-a]"), item = e.target.closest(".item"); if (!el || !item) return;
    const s = db.sentence.find(x => x.id === item.dataset.id); if (!s) return;
    const a = el.dataset.a;
    if (a === "play") { stop(); playOne(s) }
    else if (a === "edit") { ui.editing = s.id; renderList() }
    else if (a === "cancel") { ui.editing = null; renderList() }
    else if (a === "save") {
      const t = item.querySelector(".eText").value.replace(/\s+/g, " ").trim();
      if (!t) return toast("英文が空です");
      s.text = t; s.ja = item.querySelector(".eJa").value.trim(); s.groups = splitGroups(item.querySelector(".eGrp").value);
      ui.editing = null; Store.put(s, "sentences"); renderList();
    } else if (a === "del") {
      if (!confirm("この英文を削除しますか?")) return;
      db.sentence.splice(db.sentence.indexOf(s), 1); Store.del([s.id], "sentences"); renderList();
    }
  });
  $("#list").addEventListener("change", e => {
    if (e.target.dataset.a !== "status") return;
    const s = db.sentence.find(x => x.id === e.target.closest(".item").dataset.id);
    if (s) { s.status = e.target.value; Store.put(s, "sentences"); renderList() }
  });
  for (const id of ["#fq", "#fgroup", "#fstatus"]) $(id).addEventListener("input", renderList);
  $("#btnShuffle").onclick = () => { ui.order = null; ui.shuffle = true; renderList() };
  $("#btnShuffle").ondblclick = () => { ui.shuffle = false; ui.order = null; renderList() };
  $("#btnShuffle").title = "ランダムな順に並べ替えます(押すたびに並べ直す。ダブルクリックで元の順)";
  $("#btnJaToggle").onclick = e => { ui.showJa = !ui.showJa; e.target.setAttribute("aria-pressed", String(ui.showJa)); renderList() };

  $("#btnAddSent").onclick = e => {
    const f = $("#addSent"); f.hidden = !f.hidden; e.target.setAttribute("aria-expanded", String(!f.hidden));
    if (!f.hidden) $("#addText").focus();
  };
  $("#addCancel").onclick = () => { $("#addSent").hidden = true; $("#btnAddSent").setAttribute("aria-expanded", "false") };
  $("#addOk").onclick = () => {
    const lines = $("#addText").value.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    if (!lines.length) return toast("英文を入力してください");
    const groups = splitGroups($("#addGroup").value), ja = lines.length === 1 ? $("#addJa").value.trim() : "";
    const r = addSentences(lines.map(text => ({ text, ja, groups })));
    $("#addText").value = ""; $("#addJa").value = "";
    renderList(); toast(`英文を ${r.added} 件追加しました${r.merged ? `(${r.merged} 件は既存に足しました)` : ""}`);
  };
  $("#file").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    const text = await readFile(f), g0 = splitGroups($("#addGroup").value);
    const rows = /\.csv$/i.test(f.name)
      ? parseCsv(text).map(r => ({ text: r[0], ja: r[1] || "", groups: [...new Set([...g0, ...splitGroups(r[2])])] }))
      : text.split(/\r?\n/).map(x => ({ text: x, ja: "", groups: g0 }));
    const r = addSentences(rows); renderList();
    toast(`${f.name}: 英文を ${r.added} 件追加しました${r.merged ? `(${r.merged} 件は既存に足しました)` : ""}`);
  };
  $("#btnTxt").onclick = () => { const a = filtered(); if (!a.length) return toast("英文がありません"); download("sentences.txt", a.map(s => s.text).join("\n") + "\n", "text/plain") };

  // バックアップ
  $("#btnExport").onclick = () => download("eng-note-backup.json", JSON.stringify({ sentences: db.sentence, notes: db.note }, null, 1), "application/json");
  $("#btnImport").onclick = () => $("#fileJson").click();
  $("#fileJson").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    try {
      const j = JSON.parse(await readFile(f));
      const r = addSentences((Array.isArray(j.sentences) ? j.sentences : []).filter(x => x && typeof x.text === "string").map(x => ({ text: x.text, ja: x.ja || x.analysis?.translation || "", groups: Array.isArray(x.groups) ? x.groups.filter(g => typeof g === "string") : [] })));
      let n = 0; const have = new Set(db.note.map(x => x.id));
      for (const x of Array.isArray(j.notes) ? j.notes : []) {
        if (!x || typeof x.text !== "string" || have.has(x.id)) continue;
        const o = { id: typeof x.id === "string" && x.id ? x.id : uid(), text: x.text, body: String(x.body || ""), groups: x.groups || [], created: x.created || Date.now(), updated: x.updated || Date.now() };
        db.note.push(o); Store.put(o, "notes"); n++;
      }
      renderList(); renderNotes(); toast(`読み込みました(英文 ${r.added} 件・解説 ${n} 件を追加)`);
    } catch { toast("読み込めませんでした(バックアップの .json を選んでください)") }
  };

  // ---------- 音声 ----------
  const rep = $("#pRep"); rep.innerHTML = Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">${i + 1}回</option>`).join("");
  for (const k of ["pGap", "pRep", "pRate"]) { const v = localStorage.getItem(k); if (v) $("#" + k).value = v; $("#" + k).addEventListener("change", e => localStorage.setItem(k, e.target.value)) }
  let voice = null;
  const pickVoice = () => { const vs = speechSynthesis.getVoices(); voice = vs.find(v => /^en-US/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || null };
  if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let token = 0;

  function speak(text) {
    return new Promise(res => {
      const u = new SpeechSynthesisUtterance(text); u.lang = "en-US"; if (voice) u.voice = voice;
      u.rate = Number($("#pRate").value) || 1; const t0 = performance.now();
      u.onend = () => res(performance.now() - t0); u.onerror = () => res(performance.now() - t0);
      speechSynthesis.speak(u);
    });
  }
  async function playOne(s, my = ++token) {
    if (!("speechSynthesis" in window)) return toast("この端末は読み上げに対応していません");
    ui.playing = true; ui.playId = s.id; renderList(); $("#btnStop").hidden = false;
    const n = Number($("#pRep").value) || 1, gap = Number($("#pGap").value) || 0;
    for (let i = 0; i < n && my === token; i++) {
      const ms = await speak(s.text);
      if (my !== token) break;
      if (gap) await sleep(ms * gap);
    }
    if (my === token) { s.count = (s.count || 0) + 1; Store.put(s, "sentences"); ui.playing = false; ui.playId = null; $("#btnStop").hidden = true; renderList() }
  }
  function stop() { token++; if ("speechSynthesis" in window) speechSynthesis.cancel(); if (ui.playing) { ui.playing = false; ui.playId = null; $("#btnStop").hidden = true; renderList() } }
  $("#btnStop").onclick = stop;
  $("#btnPlayAll").onclick = async () => {
    stop(); const a = filtered(), my = token;
    for (const s of a) { if (my !== token) break; await playOne(s, my); await sleep(200) }
  };

  // ---------- 解説(Markdown) ----------
  const sortedNotes = () => db.note.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  function renderNotes() {
    const q = $("#nq").value.trim().toLowerCase();
    const a = sortedNotes().filter(n => !q || n.text.toLowerCase().includes(q) || (n.body || "").toLowerCase().includes(q));
    $("#nInfo").textContent = `${a.length} / ${db.note.length} 件`;
    $("#noteList").innerHTML = a.length ? a.map(n => `<div class="item note" data-id="${n.id}">
      <div class="nt" data-a="toggle"><b>${esc(n.text)}</b>${groupsOf(n).map(g => `<span class="tag">${esc(g)}</span>`).join("")}<button class="sm" data-a="edit">編集</button></div>
      ${ui.open.has(n.id) ? `<div class="body md">${Md.render(n.body)}</div>` : ""}</div>`).join("")
      : '<div class="card sub">解説がありません。「＋ 解説を追加」から、Markdown を貼り付けて追加します。</div>';
  }
  $("#nq").addEventListener("input", renderNotes);
  $("#noteList").addEventListener("click", e => {
    const item = e.target.closest(".note"); if (!item || e.target.closest(".body")) return;
    const id = item.dataset.id;
    if (e.target.closest('[data-a="edit"]')) return openNote(db.note.find(n => n.id === id));
    ui.open.has(id) ? ui.open.delete(id) : ui.open.add(id); renderNotes();
  });
  const dlg = $("#noteDlg"), prev = () => { $("#nPrev").innerHTML = Md.render($("#nBody").value) };
  $("#nBody").addEventListener("input", prev); $("#nPrev").classList.add("md");
  function openNote(n) {
    ui.editNote = n || null;
    $("#noteDlgTitle").textContent = n ? "解説を編集" : "解説を追加";
    $("#nTitle").value = n ? n.text : ""; $("#nBody").value = n ? n.body || "" : ""; $("#nGroup").value = n ? groupsOf(n).join("、") : "";
    $("#nDel").hidden = !n; prev(); dlg.showModal();
  }
  $("#btnAddNote").onclick = () => openNote(null);
  $("#nCancel").onclick = () => dlg.close();
  $("#nOk").onclick = () => {
    const body = $("#nBody").value; let title = $("#nTitle").value.trim();
    if (!title) title = (body.match(/^#{1,6}\s+(.+)$/m) || [])[1] || body.trim().split("\n")[0].slice(0, 60);
    if (!title) return toast("タイトルか本文を入力してください");
    const now = Date.now(), groups = splitGroups($("#nGroup").value);
    let n = ui.editNote;
    if (n) Object.assign(n, { text: title.slice(0, 120), body, groups, updated: now });
    else { n = { id: uid(), text: title.slice(0, 120), body, groups, created: now, updated: now }; db.note.push(n) }
    Store.put(n, "notes"); ui.open.add(n.id); dlg.close(); renderNotes();
  };
  $("#nDel").onclick = () => {
    if (!ui.editNote || !confirm("この解説を削除しますか?")) return;
    db.note.splice(db.note.indexOf(ui.editNote), 1); Store.del([ui.editNote.id], "notes"); dlg.close(); renderNotes();
  };
  $("#btnMdFile").onclick = () => $("#fileMd").click();
  $("#fileMd").onchange = async e => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    openNote(null); $("#nBody").value = await readFile(f); $("#nTitle").value = f.name.replace(/\.(md|markdown|txt)$/i, ""); prev();
  };

  // ---------- 起動 ----------
  async function init() {
    try { [db.sentence, db.note] = await Promise.all([Store.all("sentences"), Store.all("notes")]) }
    catch (e) { toast("保存先(IndexedDB)を開けませんでした: " + e.message) }
    const byCreated = (a, b) => (a.created || 0) - (b.created || 0);
    const sortAll = () => { db.sentence.sort(byCreated); db.note.sort(byCreated) };
    sortAll();
    const refresh = () => { renderList(); renderNotes() };
    await Sync.init({ table: k => db[k], refresh, sortAll, toast });
    refresh();
    showTab(Sync.wantsJoin ? "sync" : (localStorage.getItem("tab") || "sent"));
  }
  init();
})();
