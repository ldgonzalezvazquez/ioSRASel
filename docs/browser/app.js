/* SRASel browser mode: page logic. All data stays in this tab; the analysis runs in worker.js (Pyodide).
 * Three screens on one page (sidebar tabs + stepper): 1 Input data -> 2 Run analysis -> 3 Results. No reloads.
 * Nothing on the page is estimated: every number shown is counted or measured (files, samples, dates, stage times, counts reported by the engine). */
"use strict";
(function () {
  const $ = (id) => document.getElementById(id);
  const state = { tables: [], bams: [], dates: "", genbanks: [], refKind: "genbank", fasta: null, genes: null, segFastas: [], segGenes: [], drafts: new Map(), seq: 0, worker: null, ready: false, running: false, startedAt: 0, timer: 0,
                  result: null, cfg: null, runParams: null, fatal: "", flash: null, rows: [], stageTitle: "",
                  runState: "ready", accepted: false, resultsSeen: false, counted: 0, nBams: 0, fileCheck: new WeakMap(), sub: "summary", reportTab: "summary", tbl: null };

  // ---- theme ------------------------------------------------------------------------------------------------
  (function theme() {
    const root = document.documentElement;
    try { const t = localStorage.getItem("srasel-theme"); if (t) root.setAttribute("data-theme", t); } catch (e) { /* storage blocked */ }
    $("theme-btn").addEventListener("click", () => {
      const cur = root.getAttribute("data-theme");
      const dark = cur ? cur === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
      const next = dark ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("srasel-theme", next); } catch (e) { /* storage blocked */ }
    });
  })();

  const mb = (n) => (n / 1048576).toFixed(n < 1048576 ? 2 : 1);
  const show = (el, on) => { el.hidden = !on; };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const segOn = () => $("seg-on").checked;     // the "Segmented virus" switch: only shows the one-file-per-segment inputs; adds no engine option
  function pill(text, cls) { const p = $("rt-pill"); p.textContent = text; p.className = "rt" + (cls ? " " + cls : ""); }
  function fmtDur(s) { s = Math.max(0, Math.round(s)); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`; }

  const NO_PROGRESS = /\d+\s*%|\bit\/s\b|\bs\/it\b|\/s\]|\bETA\b/;      // lines that look like progress meters

  // ---- screens: sidebar tabs (role=tablist; arrows, Home, End; 2 and 3 are disabled until reachable) + the stepper at the top -------------------
  const VIEWS = ["data", "run", "results"];
  let view = "data";
  function enableTab(name, on) { $("tab-" + name).disabled = !on; }
  // the check marks and the stepper say what is done: data = accepted by "Continue"; run = an analysis finished; results = opened at least once
  function updateChrome() {
    const done = { data: state.accepted || state.runState !== "ready", run: state.runState === "done", results: state.resultsSeen };
    VIEWS.forEach((v) => {
      $("tab-" + v).dataset.done = String(!!done[v]);
      const li = $("st-" + v), cur = v === view;
      li.className = cur ? "current" : done[v] ? "done" : "";
      if (cur) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
      const dot = li.querySelector(".dot");
      if (done[v] && !cur) dot.innerHTML = '<svg class="i" aria-hidden="true"><use href="#i-check"/></svg>'; else dot.textContent = String(VIEWS.indexOf(v) + 1);
    });
  }
  function showTab(name, focusPanel) {
    view = name; document.body.dataset.view = name;
    VIEWS.forEach((v) => {
      const on = v === name, tab = $("tab-" + v);
      tab.setAttribute("aria-selected", String(on)); tab.tabIndex = on ? 0 : -1;
      show($("panel-" + v), on);
    });
    if (name === "run") renderRunView();
    if (name === "results") state.resultsSeen = true;
    updateChrome();
    if (focusPanel) $("panel-" + name).focus({ preventScroll: false });
    window.scrollTo(0, 0);
  }
  VIEWS.forEach((v) => {
    $("tab-" + v).addEventListener("click", () => showTab(v));
    $("tab-" + v).addEventListener("keydown", (e) => {
      const ok = VIEWS.filter((x) => !$("tab-" + x).disabled), i = ok.indexOf(v);
      let to = null;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") to = ok[(i + 1) % ok.length];
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") to = ok[(i + ok.length - 1) % ok.length];
      else if (e.key === "Home") to = ok[0];
      else if (e.key === "End") to = ok[ok.length - 1];
      if (to) { e.preventDefault(); showTab(to); $("tab-" + to).focus(); }
    });
  });
  $("nav-examples").addEventListener("click", () => { showTab("data"); const b = $("btn-demo"); b.scrollIntoView({ block: "center" }); b.focus(); });
  $("nav-about").addEventListener("click", () => { const d = $("about"); if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", ""); });
  $("about-close").addEventListener("click", () => { const d = $("about"); if (typeof d.close === "function") d.close(); else d.removeAttribute("open"); });

  // ---- help tooltips: text always in the DOM (aria-describedby); shown on hover and keyboard focus; Escape hides; kept inside the window ---------------
  document.querySelectorAll(".helpwrap").forEach((w) => {
    const tip = w.querySelector(".tip");
    const place = () => {
      w.classList.remove("tip-off"); w.style.setProperty("--tip-x", "0px");
      const r = tip.getBoundingClientRect(), over = r.right - (window.innerWidth - 12), under = 12 - r.left;
      if (over > 0) w.style.setProperty("--tip-x", `${-over}px`); else if (under > 0) w.style.setProperty("--tip-x", `${under}px`);
    };
    w.addEventListener("mouseenter", place); w.addEventListener("focusin", place);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".helpwrap").forEach((w) => w.classList.add("tip-off")); });

  // ---- runtime (worker) -------------------------------------------------------------------------------------
  function startWorker() {
    if (state.worker) state.worker.terminate();
    state.ready = false; state.fatal = "";
    refresh();
    pill("Python runtime: loading…");
    const w = new Worker("worker.js", { type: "module" });
    state.worker = w;
    w.onmessage = (ev) => onWorker(ev.data);
    w.onerror = (ev) => { pill("Python runtime: failed", "bad"); state.fatal = "The Python runtime could not start: " + String(ev.message || "worker error"); refresh(); };
    w.postMessage({ type: "init" });
  }

  function onWorker(m) {
    switch (m.type) {
      case "status": if (state.running) appendLog("[runtime] " + m.text); else $("rt-pill").title = m.text; break;
      case "ready":
        state.ready = true; state.versions = m.versions;
        if (state.flash && state.flash.untilReady) state.flash = null;
        pill(`Python ${m.versions.python} ready`);
        $("rt-pill").title = "";
        $("versions").textContent = "";
        $("versions").append(`Pyodide ${m.pyodide} · Python ${m.versions.python} · numpy ${m.versions.numpy} · pandas ${m.versions.pandas} · scipy ${m.versions.scipy} · biopython ${m.versions.biopython} · SRASel engine ${m.versions.srasel} · runtime ready in ${m.seconds} s · `);
        [["../ways/#m-cli", "Command line"], ["../ways/#m-local", "Local web interface"], ["../ways/", "The three ways of running SRASel"]].forEach(([h, t], i) => {
          if (i) $("versions").append(" · ");
          const a = document.createElement("a"); a.href = h; a.textContent = t; a.target = "_blank"; a.rel = "noopener"; $("versions").append(a);
        });
        refresh();
        break;
      case "plan": onPlan(m.text); break;
      case "stage": markStage(m.text); break;
      case "time": stageTime(m.text); break;
      case "line": onLine(m); break;
      case "progress": onProgress(m.text); break;              // tqdm bars: only the counts (k of N) reach the running row; the bar, its percentage and its rate are dropped, and nothing goes to the log
      case "result": onResult(m); break;
      case "fail": onFail(m); break;
      case "file": onFile(m); break;
    }
  }

  // ---- inputs -----------------------------------------------------------------------------------------------
  async function readFiles(list) {
    const out = [];
    for (const f of list) out.push({ name: f.name, buffer: await f.arrayBuffer() });
    return out;
  }
  function sampleOf(name) {
    return name.replace(/\.bam$/i, "").replace(/\.gz$/i, "").replace(/(_RG_readcount\.txt|_readcount\.txt|\.readcounts\.tsv|\.readcount\.txt|\.txt|\.tsv)$/i, "");
  }
  const safeName = (x) => x.trim().replace(/[^A-Za-z0-9_.]+/g, "_").replace(/^_+|_+$/g, "");        // engine.safe()
  // The patient of a sample, in the order `srasel run --bams --dates [--patient]` uses: 3rd column of the dates file, then <patient>-<n> in the name, then --patient.
  const patientFor = (sample, dateRow) => {
    if (dateRow && dateRow.patient) return safeName(dateRow.patient);
    const m = /^(.*)-(\d+)([a-z]?)$/.exec(sample);
    if (m) return safeName(m[1]);
    const own = $("p-patient").value.trim();
    return own ? safeName(own) : null;
  };

  // Dates as the engine reads them (read_dates_file + parse_dates), only to show each sample's date before the run. The engine stays the
  // authority: it re-reads the very same text. A row that this function cannot read is shown in red; the engine then stops with its own message.
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, ene: 1, abr: 4, ago: 8, dic: 12 };
  function readDatesText(text) {
    const rows = [];
    const all = text.split("\n");
    for (let li = 0; li < all.length; li++) {
      const ln = all[li].replace(/\r$/, "");
      if (!ln.trim() || ln.trimStart().startsWith("#")) continue;
      let f = ln.split("\t");
      if (f.length < 2) {
        if (/[,;]/.test(ln)) f = ln.split(/\s*[,;]\s*/);
        else { const t = ln.trim().split(/\s+/); f = t.length > 2 ? [t[0], t[1], t.slice(2).join(" ")] : t; }
      }
      f = f.map((x) => x.trim());
      rows.push(f.length < 2 ? { name: f[0], raw: "", err: "line without a date", ln: li } : { name: f[0].replace(/\.bam$/i, ""), raw: f[1], patient: f[2] || "", ln: li });
    }
    if (rows.length && rows[0].raw !== undefined && !rows[0].err && !/\d/.test(rows[0].raw)) rows.shift();          // optional header row
    const ok = rows.filter((r) => !r.err);
    const toks = ok.map((r) => ({ r, t: (r.raw.split(/[T ](?=\d{1,2}:\d{2})/)[0].match(/[A-Za-zñÑ]+|\d+/g)) || [] }));
    const rel = toks.map(({ t }) => t.length === 1 && /^\d+$/.test(t[0]) && t[0].length !== 8);
    let glob = "";
    if (rel.some(Boolean) && !rel.every(Boolean)) glob = "integers and dates are mixed";
    const nums = toks.filter(({ t }) => t.length === 3 && t.every((x) => /^\d+$/.test(x)) && t[0].length !== 4).map(({ t }) => [+t[0], +t[1]]);
    const a12 = nums.some(([a]) => a > 12), b12 = nums.some(([, b]) => b > 12);
    if (!glob && a12 && b12) glob = "day/month and month/day are mixed";
    const dayfirst = !b12;
    toks.forEach(({ r, t }, i) => {
      if (glob) { r.err = glob; return; }
      if (rel.every(Boolean) && rel.length) { r.shown = "day " + parseInt(t[0], 10); return; }
      let y, m, d;
      try {
        if (t.length === 1 && t[0].length === 8 && /^\d+$/.test(t[0])) { y = +t[0].slice(0, 4); m = +t[0].slice(4, 6); d = +t[0].slice(6); }
        else if (t.length === 3 && t.some((x) => /^[A-Za-zñÑ]/.test(x))) {
          const mo = t.map((x) => (/^[A-Za-zñÑ]/.test(x) ? MONTHS[x.slice(0, 3).toLowerCase()] : undefined)).find((x) => x !== undefined);
          const n = t.filter((x) => /^\d+$/.test(x)).map(Number).sort((p, q) => (p > 31) - (q > 31));
          if (mo === undefined || n.length < 2) throw new Error("fmt");
          d = n[0]; y = n[1]; m = mo;
        } else if (t.length === 3 && t.every((x) => /^\d+$/.test(x)) && t[0].length === 4) { y = +t[0]; m = +t[1]; d = +t[2]; }
        else if (t.length === 3 && t.every((x) => /^\d+$/.test(x))) { const a = +t[0], b = +t[1]; y = +t[2]; if (dayfirst) { d = a; m = b; } else { d = b; m = a; } }
        else throw new Error("fmt");
      } catch (e) { r.err = "unrecognised format"; return; }
      if (y < 100) y += y < 70 ? 2000 : 1900;
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) { r.err = "not a calendar date"; return; }
      r.shown = dt.toISOString().slice(0, 10);
    });
    return rows;
  }

  // Everything the Data tab derives from the inputs: the sample rows, and why Run is (not) possible.
  function analyse() {
    const dateRows = readDatesText($("t-dates").value);
    const exact = new Map(), lower = new Map();
    dateRows.forEach((r) => { if (!exact.has(r.name)) exact.set(r.name, r); if (!lower.has(r.name.toLowerCase())) lower.set(r.name.toLowerCase(), r); });
    const samples = [...state.bams.map((f) => ({ sample: sampleOf(f.name), kind: "BAM", key: "BAM:" + f.name })), ...state.tables.map((t) => ({ sample: sampleOf(t.name), kind: "table", key: "table:" + t.name }))];
    const seen = new Map(), dup = [];
    samples.forEach((s) => {
      s.date = exact.get(s.sample) || lower.get(s.sample.toLowerCase()) || null;
      s.patient = patientFor(s.sample, s.date);
      if (seen.has(s.sample)) dup.push(s.sample); else seen.set(s.sample, s);
    });
    const problem = (s) => (!s.date || s.date.err ? 0 : 1);                  // samples with no date or an unreadable date come first, so they are never scrolled out of sight
    samples.sort((a, b) => problem(a) - problem(b) || a.sample.localeCompare(b.sample, "en", { numeric: true }));
    const used = new Set(samples.map((s) => s.date).filter(Boolean));
    for (const k of [...state.drafts.keys()]) if (!seen.has(k)) state.drafts.delete(k);            // a typed patient is only kept for samples that are still selected
    return { samples, dup: [...new Set(dup)], missing: samples.filter((s) => !s.date).map((s) => s.sample), bad: samples.filter((s) => s.date && s.date.err),
             noPatient: samples.filter((s) => s.date && !s.patient).map((s) => s.sample),
             unused: dateRows.filter((r) => !used.has(r)).map((r) => r.name), nDates: dateRows.length };
  }

  // The table edits the dates text (the single source of truth) and is redrawn from it: an edit of a patient or a date rewrites that sample's line of
  // #t-dates; any change of #t-dates (typed, pasted, a file) redraws the table. Programmatic writes to the text raise no "input" event, so there is no loop.
  const cleanCell = (x) => String(x).replace(/[\t\r\n]+/g, " ").trim();
  function editSample(key, field, value) {
    const s = analyse().samples.find((x) => x.key === key);              // fresh analysis: line numbers move when another line was removed
    if (!s) return;
    const ta = $("t-dates"), lines = ta.value.split("\n"), cur = s.date, v = cleanCell(value);
    const defPat = patientFor(s.sample, null);                           // the patient that the name or the Options give without a third column
    const line = (name, date, pat) => `${name}\t${date}${pat ? "\t" + pat : ""}`;
    let changed = false;
    if (field === "date") {
      if (cur && v) { lines[cur.ln] = line(cur.name, v, cur.patient); changed = true; }
      else if (cur) {                                                    // an emptied date: the line goes; its patient and its place wait as a draft
        state.drafts.set(s.sample, { pat: cur.patient || "", ln: cur.ln });
        lines.splice(cur.ln, 1); changed = true;
      } else if (v) {                                                    // a date for a sample without a line: back to the place it had, or at the end
        const d = state.drafts.get(s.sample) || { pat: "" };
        const nl = line(s.sample, v, d.pat && d.pat !== defPat ? d.pat : "");
        if (d.ln != null && d.ln <= lines.length) lines.splice(d.ln, 0, nl);
        else { if (lines.length && lines[lines.length - 1] === "") lines.pop(); lines.push(nl, ""); }
        changed = true; state.drafts.delete(s.sample);
      }
    } else if (cur && cur.raw) {                                         // a patient edit rewrites the third column of the sample's line
      lines[cur.ln] = line(cur.name, cur.raw, v && v !== defPat ? v : ""); changed = true;
    } else {                                                             // no date yet: the patient waits until the sample has one
      const d = state.drafts.get(s.sample) || {};
      if (v || d.ln != null) state.drafts.set(s.sample, { pat: v, ln: d.ln }); else state.drafts.delete(s.sample);
    }
    if (changed) { ta.value = lines.join("\n"); $("dates-src").textContent = "edited in the table"; }
    state.flash = null; refresh({ keep: true });
  }
  function removeSample(key, fromList) {
    const kind = key.slice(0, key.indexOf(":")), name = key.slice(key.indexOf(":") + 1);
    if (kind === "BAM") state.bams = state.bams.filter((f) => f.name !== name); else state.tables = state.tables.filter((f) => f.name !== name);
    state.flash = null; renderLists();
    if (fromList) {                                                         // removed from the file list: focus stays in that list
      const bs = $(fromList.list).querySelectorAll("button"), nx = bs[Math.min(fromList.index, bs.length - 1)];
      if (nx) { nx.focus(); return; }
    }
    const nx = $("samples-body").querySelector("input"); if (nx) nx.focus(); else $("btn-demo").focus();
  }
  function makeRow(s) {
    const tr = document.createElement("tr"), id = ++state.seq;
    tr.dataset.key = s.key;
    const nm = document.createElement("td"); nm.className = "c-name"; nm.textContent = s.sample; nm.title = s.key.slice(s.key.indexOf(":") + 1);
    const mk = (cls, label, ph, max) => { const i = document.createElement("input"); i.type = "text"; i.maxLength = max; i.spellcheck = false; i.autocomplete = "off"; i.placeholder = ph; i.setAttribute("aria-label", `${label} of ${s.sample}`); i.className = cls; return i; };
    const pat = mk("in-pat", "Patient", "Patient", 40), date = mk("in-date", "Date", "dd/mm/yyyy", 32);
    const stat = document.createElement("span"); stat.className = "dstat"; stat.id = "ds-" + id; date.setAttribute("aria-describedby", stat.id);
    const tdp = document.createElement("td"); tdp.className = "c-pat"; tdp.append(pat);
    const tdd = document.createElement("td"); tdd.className = "c-date"; const dc = document.createElement("div"); dc.className = "dcell"; dc.append(date, stat); tdd.append(dc);
    const kd = document.createElement("td"); kd.className = "muted"; kd.textContent = s.kind;
    const tx = document.createElement("td"); tx.className = "c-x";
    const rm = document.createElement("button"); rm.type = "button"; rm.className = "btn sm"; rm.textContent = "×"; rm.title = "Remove this sample"; rm.setAttribute("aria-label", "Remove " + s.sample);
    rm.addEventListener("click", () => removeSample(s.key)); tx.append(rm);
    pat.addEventListener("input", () => editSample(s.key, "patient", pat.value));
    date.addEventListener("input", () => editSample(s.key, "date", date.value));
    tr.append(nm, tdp, tdd, kd, tx);
    tr._in = { pat, date, stat };
    return tr;
  }
  function paintRow(tr, s) {                                          // from the text: values (unless the cell is being typed in) and how the date was read
    const { pat, date, stat } = tr._in;
    const pv = s.date ? s.patient || "" : ((state.drafts.get(s.sample) || {}).pat || s.patient || "");
    const dv = s.date ? s.date.raw : "";
    if (document.activeElement !== pat && pat.value !== pv) pat.value = pv;
    if (document.activeElement !== date && date.value !== dv) date.value = dv;
    pat.classList.toggle("missing", !pv); date.classList.toggle("missing", !s.date);
    if (pat.value.trim() === "" && pv === "") pat.title = "Name the file <patient>-<n>, type the patient here, or fill in Patient name under Options"; else pat.removeAttribute("title");
    if (s.date && s.date.err) date.setAttribute("aria-invalid", "true"); else date.removeAttribute("aria-invalid");
    let txt = "", cls = "dstat";
    if (!s.date) { txt = "no date"; cls += " bad"; }
    else if (s.date.err) { txt = `unreadable (${s.date.err})`; cls += " bad"; }
    else txt = "→ " + s.date.shown;
    stat.textContent = txt; stat.className = cls;
  }

  function renderSamples(a, keep) {
    const body = $("samples-body");
    show($("samples-wrap"), a.samples.length > 0); show($("samples-empty"), a.samples.length === 0);
    const have = new Map(Array.from(body.children).map((tr) => [tr.dataset.key, tr]));
    const want = new Set(a.samples.map((s) => s.key));
    for (const [k, tr] of have) if (!want.has(k)) { tr.remove(); have.delete(k); }
    // while a cell is being typed in (or after one of its own edits) the rows keep their place; otherwise samples with no/unreadable date come first
    let order = a.samples;
    if (keep || body.contains(document.activeElement)) {
      const at = new Map(Array.from(body.children).map((tr, i) => [tr.dataset.key, i]));
      order = a.samples.slice().sort((x, y) => (at.has(x.key) ? at.get(x.key) : 1e9) - (at.has(y.key) ? at.get(y.key) : 1e9));
    }
    order.forEach((s, i) => {
      let tr = have.get(s.key);
      if (!tr) { tr = makeRow(s); have.set(s.key, tr); }
      if (body.children[i] !== tr) body.insertBefore(tr, body.children[i] || null);
      paintRow(tr, s);
    });
    const note = $("samples-note"); note.textContent = "";
    const patients = new Set(a.samples.map((s) => s.patient).filter(Boolean));
    const bits = [];
    if (a.samples.length) bits.push(`${plural(a.samples.length, "sample", "samples")}, ${plural(patients.size, "patient", "patients")}`);
    if (a.samples.length && a.unused.length) bits.push(`${plural(a.unused.length, "line", "lines")} of the dates file without a file (ignored): ${a.unused.slice(0, 5).join(", ")}${a.unused.length > 5 ? ", …" : ""}`);
    if (bits.length) { const p = document.createElement("p"); p.className = "hint"; p.textContent = bits.join(". ") + "."; note.append(p); }
    const none = a.samples.filter((s) => !s.patient && !(state.drafts.get(s.sample) || {}).pat);
    show($("s-patient"), none.length > 0); show($("samples-tools"), none.length > 0);
    $("fill-patient-lbl").textContent = none.length === 1 ? "Patient name for the file without one" : `Patient name for the ${none.length} files without one`;
  }

  function renderLists() {
    const fl = (ul, items, drop, move) => {                    // one line per file, with a Remove button; an ordered list (segmented virus) also shows the position and ↑ ↓
      const seg = !!move && segOn();
      ul.textContent = "";
      items.forEach((x, i) => {
        const li = document.createElement("li"), s = document.createElement("span"), b = document.createElement("button");
        s.className = "fl"; s.textContent = `${x.name} · ${mb(x.buffer.byteLength)} MB`;
        b.type = "button"; b.className = "btn sm"; b.textContent = "Remove"; b.setAttribute("aria-label", "Remove " + x.name);
        b.addEventListener("click", () => { drop(i); state.flash = null; renderLists(); });
        if (seg) { const n = document.createElement("span"); n.className = "no"; n.setAttribute("aria-hidden", "true"); n.textContent = (i + 1) + "."; li.append(n); }
        li.append(s);
        if (seg && items.length > 1) {
          for (const [d, label, txt] of [[-1, "up", "↑"], [1, "down", "↓"]]) {
            const m = document.createElement("button");
            m.type = "button"; m.className = "btn sm mv"; m.textContent = txt; m.setAttribute("aria-label", `Move ${x.name} ${label}`); m.disabled = i + d < 0 || i + d >= items.length;
            m.addEventListener("click", () => { move(i, d); state.flash = null; renderLists(); });
            li.append(m);
          }
        }
        li.append(b); ul.append(li);
      });
    };
    const swap = (arr) => (i, d) => { [arr[i], arr[i + d]] = [arr[i + d], arr[i]]; };
    fl($("gb-list"), state.genbanks, (i) => state.genbanks.splice(i, 1), swap(state.genbanks));
    fl($("fasta-list"), state.fasta ? [state.fasta] : [], () => { state.fasta = null; });
    fl($("genes-list"), state.genes ? [state.genes] : [], () => { state.genes = null; });
    fl($("fasta-seg-list"), state.segFastas, (i) => state.segFastas.splice(i, 1), swap(state.segFastas));
    fl($("genes-seg-list"), state.segGenes, (i) => state.segGenes.splice(i, 1), swap(state.segGenes));
    refresh();
  }

  const ico = (name, cls) => { const sp = document.createElement("span"); sp.className = "ico" + (cls ? " " + cls : ""); sp.innerHTML = `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`; return sp; };
  // Checks of the file itself, cached per file: empty file; a BAM or a .gz table must start with the gzip/BGZF magic bytes (read from the first two bytes only).
  function fileProblem(kind, f) {
    const size = kind === "BAM" ? f.size : f.buffer.byteLength;
    if (size === 0) return "the file is empty";
    if (kind !== "BAM" && !/\.gz$/i.test(f.name)) return "";
    let c = state.fileCheck.get(f);
    if (c !== undefined) return c;
    if (kind === "BAM") {
      state.fileCheck.set(f, "");                                           // not a problem until the first bytes have been read
      f.slice(0, 2).arrayBuffer().then((b) => {
        const u = new Uint8Array(b), bad = !(u[0] === 0x1f && u[1] === 0x8b);
        state.fileCheck.set(f, bad ? "this is not a BAM file (it does not start with the BGZF header)" : "");
        if (bad) refresh({ keep: true });
      }).catch(() => { /* unreadable: the run reports it */ });
      return "";
    }
    const u = new Uint8Array(f.buffer, 0, Math.min(2, f.buffer.byteLength));
    c = u[0] === 0x1f && u[1] === 0x8b ? "" : "the name ends in .gz but the content is not gzip data";
    state.fileCheck.set(f, c);
    return c;
  }
  // The two lists of loaded files: a validation icon (from the same checks as the Samples table), the size and a Remove button for each.
  function renderFileLists(a, hasDates) {
    const byKey = new Map(a.samples.map((s) => [s.key, s]));
    const dupSet = new Set(a.dup);
    const draw = (ul, kind, items) => {
      ul.textContent = "";
      const rows = items.map((f) => {
        const key = (kind === "BAM" ? "BAM:" : "table:") + f.name, s = byKey.get(key), why = fileProblem(kind, f);
        let cls = "ok", text = "", rank = 3;
        if (why) { cls = "err"; text = why; rank = 0; }
        else if (s && dupSet.has(s.sample)) { cls = "err"; text = "given twice"; rank = 0; }
        else if (!hasDates) { cls = "wait"; text = "date not given yet"; rank = 2; }
        else if (s && !s.date) { cls = "err"; text = "no date"; rank = 0; }
        else if (s && s.date.err) { cls = "warn"; text = `date unreadable (${s.date.err})`; rank = 1; }
        else if (s && !s.patient) { cls = "err"; text = "no patient"; rank = 0; }
        else if (s) { text = `${s.date.shown} · patient ${s.patient}`; }
        return { f, key, cls, text, rank, size: kind === "BAM" ? f.size : f.buffer.byteLength };
      }).sort((x, y) => x.rank - y.rank || x.f.name.localeCompare(y.f.name, "en", { numeric: true }));
      rows.forEach((r, i) => {
        const li = document.createElement("li"), fn = document.createElement("span"), sm = document.createElement("small"), st = document.createElement("span"), rm = document.createElement("button");
        fn.className = "fn"; fn.append(document.createTextNode(r.f.name)); sm.textContent = `${mb(r.size)} MB`; fn.append(sm);
        st.className = "fs " + r.cls; st.textContent = r.text;
        rm.type = "button"; rm.className = "btn sm"; rm.textContent = "Remove"; rm.setAttribute("aria-label", "Remove " + r.f.name);
        rm.addEventListener("click", () => removeSample(r.key, { list: ul.id, index: i }));
        li.append(ico(r.cls === "ok" ? "check" : r.cls === "err" ? "x" : r.cls === "warn" ? "alert" : "circle", r.cls), fn, st, rm); ul.append(li);
      });
    };
    draw($("bams-list"), "BAM", state.bams);
    draw($("tables-list"), "table", state.tables);
    const bits = [];
    if (state.bams.length) bits.push(`${plural(state.bams.length, "BAM file", "BAM files")}, ${mb(state.bams.reduce((x, y) => x + y.size, 0))} MB in total (read in place, not copied into memory)`);
    if (state.tables.length) bits.push(`${plural(state.tables.length, "table", "tables")}, ${mb(state.tables.reduce((x, y) => x + y.buffer.byteLength, 0))} MB in total`);
    $("files-total").textContent = bits.join(" · ");
  }

  const aliasList = () => $("p-alias").value.split("\n").map((x) => x.trim()).filter(Boolean);
  const ALIAS_RE = /^[A-Za-z0-9_.|:-]{1,120}=[A-Za-z0-9_.|:-]{1,120}$/;

  // Everything the Input data screen reports comes from here: the single reason line next to "Continue" (the first thing that stops you), the validation
  // summary with every error (red) and warning (amber), and whether "Continue" and "Run analysis" are possible. Nothing is checked twice.
  function refresh(opts) {
    const a = analyse();
    renderSamples(a, opts && opts.keep);
    const own = $("p-patient").value.trim(), nal = aliasList().length;
    $("opts-sum").textContent = [...(own ? [`patient ${own}`] : []), ...(nal ? [plural(nal, "alias", "aliases")] : []), ...($("p-noreport").checked ? ["no report"] : [])].map((x) => x.replace(/ /g, "\u00a0")).join(" · ");
    const hasReads = state.tables.length + state.bams.length > 0, hasDates = $("t-dates").value.trim().length > 0;
    renderFileLists(a, hasDates);
    const fg = state.refKind === "fasta_genes", sg = segOn();
    const hasGb = fg ? (sg ? !!(state.segFastas.length && state.segGenes.length) : !!(state.fasta && state.genes)) : state.genbanks.length > 0;
    const list = (x) => x.slice(0, 6).join(", ") + (x.length > 6 ? ", …" : "");
    const missing = hasReads && hasDates && a.missing.length > 0;
    const noPat = hasReads && hasDates && !missing && a.noPatient.length > 0;
    const badAlias = aliasList().find((x) => !ALIAS_RE.test(x));
    const badFiles = [...state.bams.map((f) => [f.name, fileProblem("BAM", f)]), ...state.tables.map((t) => [t.name, fileProblem("table", t)])].filter((x) => x[1]);
    const errs = [], warns = [], todo = [];
    if (state.fatal) errs.push(state.fatal);
    if (a.dup.length) errs.push(`${list(a.dup)} ${a.dup.length === 1 ? "is" : "are"} given twice (BAM and table, or two files). Give each sample once.`);
    if (missing) errs.push(`${plural(a.missing.length, "sample has", "samples have")} no date: ${list(a.missing)}. Type the date in the table, or add the line to the dates text (the name without .bam / _RG_readcount.txt must match its first column); or remove the sample.`);
    else if (noPat) errs.push(`${plural(a.noPatient.length, "sample has", "samples have")} no patient: ${list(a.noPatient)}. Type the patient in the table, name the files <patient>-<n>, add it as a third column of the dates text, or fill in Patient name under Additional options.`);
    // a date the dates reader cannot read stops the run at the dates step, so it also stops the way here (the same check that colours the cell); valid inputs are not affected
    if (a.bad.length) errs.push(`The date of ${a.bad[0].sample} (“${a.bad[0].date.raw}”) cannot be read (${a.bad[0].date.err})${a.bad.length > 1 ? `; ${a.bad.length - 1} more sample${a.bad.length > 2 ? "s have" : " has"} an unreadable date` : ""}. Correct it in the table or in the dates text.`);
    if (badAlias) errs.push(`The alias “${badAlias}” is not BAM_NAME=REFERENCE_NAME (Additional options, Contig aliases).`);
    badFiles.forEach(([n, why]) => errs.push(`${n}: ${why}.`));
    if (!(parseInt($("p-nperm").value, 10) >= 10) || !(parseInt($("p-seed").value, 10) >= 0) || !(parseFloat($("p-delta").value) > 0)) errs.push("Check the parameters: permutations ≥ 10, seed ≥ 0, minimum |Δf| > 0.");
    if (!hasReads) todo.push("Choose BAM files or bam-readcount tables.");
    if (!hasDates) todo.push("Add the dates (a file or pasted text).");
    if (!hasGb) todo.push(!fg ? "Choose the GenBank reference." : sg ? (!state.segFastas.length && !state.segGenes.length ? "Choose the FASTA file(s) and the gene list(s) of the segments." : !state.segFastas.length ? "Choose the FASTA file(s) of the segments." : "Choose the gene list(s) of the segments.")
      : state.fasta ? "Choose the gene list." : state.genes ? "Choose the FASTA of the reference." : "Choose the FASTA and the gene list.");
    if (state.running) todo.push("An analysis is running (see Run analysis).");
    else if (!state.ready && !state.fatal) todo.push("Waiting for the Python runtime to load.");
    if (sg && !fg && state.genbanks.length === 1) warns.push("Segmented virus with one GenBank file: that is right only if the file holds the records of every segment. If one is missing, the check before counting stops and lists the segments it did not find.");
    const tbl = state.tables.reduce((x, y) => x + y.buffer.byteLength, 0), bam = state.bams.reduce((x, y) => x + y.size, 0);
    if (tbl > 50 * 1048576) warns.push(`The tables total ${mb(tbl)} MB; browser mode was tested with inputs up to about 34 MB, so memory may run out. The command line has no such limit.`);
    if (bam > 150 * 1048576) warns.push(`The BAM files total ${mb(bam)} MB; browser mode was tested with up to 116 MB, so time or memory may run out. Counting in WebAssembly is slower than the command line.`);
    // lines of the dates text without a file are harmless (ignored): amber in the validation summary, but not worth the single reason line next to the button
    const unusedWarn = hasReads && a.unused.length ? `${plural(a.unused.length, "line", "lines")} of the dates file without a file (ignored): ${a.unused.slice(0, 5).join(", ")}${a.unused.length > 5 ? ", …" : ""}.` : "";
    // Run is off while anything is missing or a run is in progress; the engine's own refusal rules (a sample without a date) are applied here too
    const off = errs.length > 0 || todo.length > 0;
    let text = "", cls = "info";
    if (errs.length) { text = errs[0]; cls = "err"; }
    else if (state.flash) { text = state.flash.text; cls = state.flash.cls; }
    else if (todo.length) text = todo[0];
    else if (warns.length) { text = warns[0]; cls = "warn"; }
    const msg = $("form-msg"); msg.textContent = text; msg.className = "msg" + (text ? " " + cls : "");
    // the validation summary
    const valid = a.samples.filter((s) => s.date && !s.date.err).length, patients = new Set(a.samples.map((s) => s.patient).filter(Boolean));
    const setV = (id, t, c) => { const e = $(id); e.textContent = t; e.className = c || ""; };
    setV("v-bams", String(state.bams.length)); setV("v-tables", String(state.tables.length));
    setV("v-dates", `${valid} of ${a.samples.length}`, a.samples.length && valid === a.samples.length ? "good" : a.samples.length && hasDates ? "bad" : "");
    setV("v-patients", String(patients.size));
    const nGb = state.genbanks.length;
    const sgp = sg ? "Segmented · " : "";
    if (!fg) setV("v-ref", nGb ? sgp + `${plural(nGb, "GenBank file", "GenBank files")}` : "not chosen", nGb ? "good" : "");
    else if (sg) setV("v-ref", state.segFastas.length && state.segGenes.length ? sgp + `${plural(state.segFastas.length, "FASTA file", "FASTA files")} + ${plural(state.segGenes.length, "gene list", "gene lists")}` : state.segFastas.length ? "FASTA chosen, gene list missing" : state.segGenes.length ? "gene list chosen, FASTA missing" : "not chosen", state.segFastas.length && state.segGenes.length ? "good" : state.segFastas.length || state.segGenes.length ? "bad" : "");
    else setV("v-ref", state.fasta && state.genes ? "FASTA + gene list" : state.fasta ? "FASTA chosen, gene list missing" : state.genes ? "gene list chosen, FASTA missing" : "not chosen", state.fasta && state.genes ? "good" : state.fasta || state.genes ? "warn" : "");
    const ul = $("val-issues"); ul.textContent = "";
    const add = (c, icn, t) => { const li = document.createElement("li"), sp = document.createElement("span"); li.className = c; sp.className = "tx"; sp.textContent = t; li.append(ico(icn), sp); ul.append(li); };
    errs.forEach((t) => add("err", "x", t)); warns.concat(unusedWarn ? [unusedWarn] : []).forEach((t) => add("warn", "alert", t)); todo.forEach((t) => add("wait", "circle", t));
    if (!errs.length && !warns.length && !unusedWarn && !todo.length) add("ok", "check", "All checks passed. You can continue.");
    $("btn-continue").disabled = off; $("btn-run").disabled = off;
    state.lastOff = off; state.lastMsg = text;
    if (off && state.runState === "ready" && view === "data") state.accepted = false;
    enableTab("run", state.runState !== "ready" || (state.accepted && !off));
    updateChrome();
    if (view === "run" && state.runState === "ready") renderRunSummary();
    return a;
  }
  function flash(text, cls, untilReady) { state.flash = text ? { text, cls: cls || "info", untilReady: !!untilReady } : null; refresh(); }

  const touched = () => { state.flash = null; renderLists(); };
  // Choosing again ADDS to what is loaded (as the drop zone, the folder chooser and the GenBank chooser do); a file with the same name is replaced. Remove takes files out.
  $("f-tables").addEventListener("change", async (e) => {
    const add = await readFiles(e.target.files); e.target.value = "";
    const names = new Set(add.map((x) => x.name));
    state.tables = state.tables.filter((x) => !names.has(x.name)).concat(add); touched();
  });
  $("f-bams").addEventListener("change", (e) => {
    const add = Array.from(e.target.files); e.target.value = "";
    const names = new Set(add.map((x) => x.name));
    state.bams = state.bams.filter((x) => !names.has(x.name)).concat(add); touched();
  });
  // A whole folder: keep the .bam files (index files and anything else are ignored), without subfolder prefixes.
  $("f-bamdir").addEventListener("change", (e) => {
    const found = Array.from(e.target.files).filter((f) => /\.bam$/i.test(f.name));
    const have = new Set(state.bams.map((f) => f.name));
    state.bams = state.bams.concat(found.filter((f) => !have.has(f.name)));
    touched();
    if (!found.length) flash("No .bam file was found in that folder.", "warn");
  });
  // GenBank files are ADDED to the list (a segmented virus needs one per segment, chosen one by one or together); a file with the same name is replaced.
  $("f-gb").addEventListener("change", async (e) => {
    const add = await readFiles(e.target.files); e.target.value = "";
    const names = new Set(add.map((x) => x.name));
    state.genbanks = state.genbanks.filter((x) => !names.has(x.name)).concat(add); touched();
  });
  $("f-fasta").addEventListener("change", async (e) => { const r = await readFiles(e.target.files); e.target.value = ""; if (r.length) { state.fasta = r[0]; touched(); } });
  $("f-genes").addEventListener("change", async (e) => { const r = await readFiles(e.target.files); e.target.value = ""; if (r.length) { state.genes = r[0]; touched(); } });
  // segmented virus: FASTA and gene-list files ARE ADDED to their lists (one per segment); the page sends them in the order of the list and the runner joins them
  const addByName = (list, add) => { const names = new Set(add.map((x) => x.name)); return list.filter((x) => !names.has(x.name)).concat(add); };
  $("f-fasta-seg").addEventListener("change", async (e) => { const add = await readFiles(e.target.files); e.target.value = ""; if (add.length) { state.segFastas = addByName(state.segFastas, add); touched(); } });
  $("f-genes-seg").addEventListener("change", async (e) => { const add = await readFiles(e.target.files); e.target.value = ""; if (add.length) { state.segGenes = addByName(state.segGenes, add); touched(); } });
  $("seg-on").addEventListener("change", () => {
    const on = segOn();
    document.documentElement.classList.toggle("seg-mode", on);
    $("seg-note").hidden = !on;
    state.flash = null; renderLists();
  });
  function setRefKind(k) {
    state.refKind = k;
    document.querySelectorAll('input[name="rkind"]').forEach((r) => { r.checked = r.value === k; });
    show($("r-genbank"), k === "genbank"); show($("r-fasta_genes"), k === "fasta_genes");
    state.flash = null; refresh();
  }
  document.querySelectorAll('input[name="rkind"]').forEach((r) => r.addEventListener("change", () => { if (r.checked && !r.disabled) setRefKind(r.value); }));
  // the example gene list (SARS-CoV-2, positions of NC_045512.2): built here, nothing is read from the network
  const GENES_EXAMPLE = ["contig\tgene\tstart\tend\tstrand\tproduct",
    "NC_045512.2\tORF1ab\t266\t13468\t+\tORF1ab polyprotein",
    "NC_045512.2\tORF1ab\t13468\t21555\t+\tORF1ab polyprotein",
    "NC_045512.2\tS\t21563\t25384\t+\tsurface glycoprotein"].join("\n") + "\n";
  $("fg-example").textContent = GENES_EXAMPLE;
  $("fg-example-dl").addEventListener("click", () => saveBlob(new Blob([GENES_EXAMPLE], { type: "text/tab-separated-values" }), "genes_example.tsv"));
  $("f-dates").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (f) { $("t-dates").value = await f.text(); $("dates-src").textContent = f.name + " (you can edit the text)"; touched(); }
  });
  // Drag and drop: files and folders (where the browser gives folder entries). .bam files become BAM inputs, .txt/.tsv/.gz files bam-readcount tables;
  // anything else is listed as ignored (references and dates have their own choosers below).
  function readDir(dir) {                                              // all entries of a dropped folder (readEntries returns them in batches)
    return new Promise((resolve) => {
      const out = [], rd = dir.createReader();
      const more = () => rd.readEntries((es) => { if (!es.length) resolve(out); else { out.push(...es); more(); } }, () => resolve(out));
      more();
    });
  }
  async function entryFiles(entry, out) {
    if (entry.isFile) { await new Promise((res) => entry.file((f) => { out.push(f); res(); }, () => res())); }
    else if (entry.isDirectory) { for (const e of await readDir(entry)) await entryFiles(e, out); }
  }
  async function droppedFiles(dt) {
    const out = [], items = dt.items ? Array.from(dt.items).filter((i) => i.kind === "file") : [];
    if (items.length) {
      const entries = items.map((i) => (typeof i.webkitGetAsEntry === "function" ? i.webkitGetAsEntry() : null));
      for (let k = 0; k < items.length; k++) {
        if (entries[k]) await entryFiles(entries[k], out);
        else { const f = items[k].getAsFile(); if (f) out.push(f); }
      }
    } else out.push(...Array.from(dt.files || []));
    return out;
  }
  async function addDropped(files) {
    const bams = files.filter((f) => /\.bam$/i.test(f.name)), tables = files.filter((f) => /\.(txt|tsv|gz)$/i.test(f.name)), ignored = files.filter((f) => !bams.includes(f) && !tables.includes(f));
    const hidden = ignored.filter((f) => /\.(bai|csi)$/i.test(f.name) || f.name.startsWith("."));           // index files and hidden files are not worth mentioning
    const shown = ignored.filter((f) => !hidden.includes(f));
    const haveB = new Set(state.bams.map((f) => f.name)), newB = bams.filter((f, i) => !haveB.has(f.name) && bams.findIndex((g) => g.name === f.name) === i);
    state.bams = state.bams.concat(newB);
    const haveT = new Set(state.tables.map((f) => f.name)), wantT = tables.filter((f, i) => !haveT.has(f.name) && tables.findIndex((g) => g.name === f.name) === i);
    state.tables = state.tables.concat(await readFiles(wantT));
    const bits = [];
    if (newB.length || wantT.length) bits.push(`Added ${[newB.length ? plural(newB.length, "BAM file", "BAM files") : "", wantT.length ? plural(wantT.length, "table", "tables") : ""].filter(Boolean).join(" and ")}.`);
    if (bams.length - newB.length + tables.length - wantT.length > 0) bits.push("Files already in the list were not added again.");
    if (shown.length) bits.push(`${plural(shown.length, "file was", "files were")} ignored (only .bam files and bam-readcount tables are read here; references and dates have their own choosers): ${shown.slice(0, 4).map((f) => f.name).join(", ")}${shown.length > 4 ? ", …" : ""}.`);
    if (!bits.length) bits.push("No .bam file or table was found in what you dropped.");
    const n = $("drop-note"); n.textContent = bits.join(" "); n.className = "msg" + (shown.length || !(newB.length || wantT.length) ? " warn" : "");
    state.flash = null; renderLists();
  }
  const dz = $("dropzone");
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
  dz.addEventListener("dragleave", (e) => { if (!dz.contains(e.relatedTarget)) dz.classList.remove("over"); });
  dz.addEventListener("drop", async (e) => { e.preventDefault(); dz.classList.remove("over"); try { await addDropped(await droppedFiles(e.dataTransfer)); } catch (err) { $("drop-note").textContent = "The dropped files could not be read: " + err.message; $("drop-note").className = "msg err"; } });
  window.addEventListener("dragover", (e) => { if (e.target && !dz.contains(e.target)) e.preventDefault(); });          // a miss must not make the browser open the file
  window.addEventListener("drop", (e) => { if (e.target && !dz.contains(e.target)) e.preventDefault(); });

  $("t-dates").addEventListener("input", () => { $("dates-src").textContent = "edited text"; state.flash = null; refresh(); });
  $("fill-patient-btn").addEventListener("click", () => {                 // one patient for every sample that has none: the same as Patient name under Options
    const v = $("fill-patient").value.trim(); if (!v) return;
    $("p-patient").value = v; $("fill-patient").value = ""; state.flash = null; refresh();
  });
  ["p-nperm", "p-seed", "p-delta", "p-patient", "p-alias", "p-noreport"].forEach((id) => $(id).addEventListener("input", refresh));
  $("btn-clear").addEventListener("click", () => {
    state.tables = []; state.bams = []; state.genbanks = []; state.fasta = null; state.genes = null; state.segFastas = []; state.segGenes = []; state.drafts.clear(); $("t-dates").value = ""; $("dates-src").textContent = "or paste it below, or type each date in the table";
    setRefKind("genbank"); $("fill-patient").value = "";
    $("p-patient").value = ""; $("p-alias").value = ""; $("p-noreport").checked = false;
    ["f-tables", "f-bams", "f-bamdir", "f-dates", "f-gb", "f-fasta", "f-genes", "f-fasta-seg", "f-genes-seg"].forEach((id) => { $(id).value = ""; });
    $("drop-note").textContent = ""; $("drop-note").className = "msg";
    state.accepted = false; state.flash = null; renderLists();
  });

  $("btn-demo").addEventListener("click", async () => {
    flash("Loading the simulated demo (10 count tables, dates and a GenBank reference) from this site …");
    try {
      const man = await (await fetch("demo/manifest.json", { cache: "no-cache" })).json();
      const get = async (n) => { const r = await fetch("demo/" + n); if (!r.ok) throw new Error(`demo/${n}: HTTP ${r.status}`); return r.arrayBuffer(); };
      state.tables = await Promise.all(man.tables.map(async (n) => ({ name: n, buffer: await get(n) })));
      state.bams = [];
      state.genbanks = await Promise.all(man.genbank.map(async (n) => ({ name: n, buffer: await get(n) })));
      state.fasta = null; state.genes = null; state.segFastas = []; state.segGenes = []; state.drafts.clear(); setRefKind("genbank");
      $("t-dates").value = new TextDecoder().decode(await get(man.dates));
      $("dates-src").textContent = man.dates;
      $("p-nperm").value = man.nperm; $("p-seed").value = man.seed; $("p-delta").value = 0.03;
      renderLists();
      flash(`Demo loaded: ${man.title}. Next: press Continue to Run analysis, then Run analysis (about a minute).`);
    } catch (err) { flash("The demo could not be loaded: " + err.message, "err"); }
  });

  // ---- run --------------------------------------------------------------------------------------------------
  function appendLog(line) {
    const log = $("log"); log.append(line + "\n");
    log.scrollTop = log.scrollHeight;
  }
  // The stage list. Titles come from the runner's "plan" event (the real stages of this run, in order); each row shows its measured time. The class
  // names wait / run / done / fail / notrun are the state of the row; the words shown are Pending / Running / Completed / Failed / Not run.
  const SI = { wait: "circle", run: "spin", done: "check", fail: "x", notrun: "circle" };
  const SI_CLS = { wait: "wait", run: "run", done: "ok", fail: "err", notrun: "wait" };
  function paintIcon(row, cls) { row.si.className = "si " + SI_CLS[cls]; row.si.innerHTML = `<svg class="i${cls === "run" ? " spin" : ""}" aria-hidden="true"><use href="#i-${SI[cls]}"/></svg>`; }
  function setRow(row, cls, text) { row.li.className = cls; row.st.textContent = text; paintIcon(row, cls); }
  function addRow(title, cls, text) {
    const li = document.createElement("li"), si = document.createElement("span"), tc = document.createElement("span"), t = document.createElement("span"), d = document.createElement("span"), st = document.createElement("span");
    t.className = "t"; t.textContent = title; d.className = "d"; st.className = "st"; tc.append(t, d);
    li.append(si, tc, st); $("stages").append(li);
    const row = { title, li, si, st, d, t0: 0 }; setRow(row, cls, text); state.rows.push(row); return row;
  }
  function onPlan(text) {
    $("stages").textContent = ""; state.rows = [];
    try { JSON.parse(text).forEach((t) => addRow(t, "wait", "Pending")); } catch (e) { /* no plan: rows are added as stages start */ }
    renderOverall();
  }
  const runningRow = () => state.rows.find((r) => r.li.className === "run");
  const isCounting = (row) => row.title.startsWith("Step 2");               // the runner's counting stage ("Step 2 · per-position count from BAM …")
  const fmtSecs = (sec) => (sec < 10 ? sec.toFixed(1) + " s" : fmtDur(sec));
  function finishRow(row, cls) {
    setRow(row, cls, (cls === "done" ? "Completed · " : "Failed · ") + fmtSecs((performance.now() - row.t0) / 1000));
    if (!(isCounting(row) && cls === "done")) row.d.textContent = "";           // the final count of the counting stage stays; a bar that stopped mid-way would be stale
    renderOverall();
  }
  function markStage(title) {
    const prev = runningRow(); if (prev) finishRow(prev, "done");
    let row = state.rows.find((r) => r.title === title && r.li.className === "wait") || addRow(title, "wait", "");
    row.t0 = performance.now(); setRow(row, "run", "Running");
    if (isCounting(row)) { state.counted = 0; row.d.textContent = `0 of ${state.nBams} samples counted`; }
    state.stageTitle = title;
    $("status").textContent = title;
    appendLog("== " + title);
    renderOverall();
  }
  function stageTime(text) {
    appendLog("   [" + text + "]");
    if (text.startsWith("total:")) { const r = runningRow(); if (r) finishRow(r, "done"); }
  }
  // "Step k of N" and a bar of N cells: only the number of stages is known, so nothing finer (no percentage, no estimate) is drawn.
  function renderOverall() {
    const rows = state.rows, n = rows.length, bar = $("overall"); bar.textContent = "";
    rows.forEach((r) => { const sp = document.createElement("span"); sp.className = r.li.className === "wait" ? "" : r.li.className; bar.append(sp); });
    const at = rows.findIndex((r) => r.li.className === "run"), done = rows.filter((r) => r.li.className === "done").length, failAt = rows.findIndex((r) => r.li.className === "fail");
    let t = "Starting …";
    if (n) {
      if (state.runState === "done") t = `All ${n} steps completed`;
      else if (state.runState === "failed") t = failAt >= 0 ? `Stopped at step ${failAt + 1} of ${n}` : `Stopped after ${done} of ${n} steps`;
      else if (at >= 0) t = `Step ${at + 1} of ${n}`;
      else if (done) t = `Step ${Math.min(done + 1, n)} of ${n}`;
    }
    $("step-of").textContent = t;
  }
  function tick() {                                           // elapsed time is measured, not estimated
    const now = performance.now();
    $("elapsed").textContent = `Elapsed ${fmtDur((now - state.startedAt) / 1000)}`;
    const r = runningRow(); if (r) r.st.textContent = "Running · " + fmtDur((now - r.t0) / 1000);
  }
  // Real finer information from the engine: the counting stage prints one line per sample, and the engine's tqdm bars report "k/N" counts.
  // Only these counts are shown (as text on the running row); the bar, its percentage, its rate and its remaining time are dropped and never logged.
  const COUNTED = /^.+: \d+ positions from \d+ reads \(/;
  const BAR = /^\s*(.+?):\s+\d+%\|[^|]*\|\s*(\d+)\/(\d+)\s*\[(.*)\]\s*$/;
  const UNITS = { var: "variants", pos: "positions", chunk: "chunks" };
  const nf = (x) => Number(x).toLocaleString("en");
  function onLine(m) {
    appendLog((m.stream === "err" ? "! " : "  ") + m.text);
    if (!NO_PROGRESS.test(m.text)) $("live").textContent = m.text;
    const r = runningRow();
    if (r && isCounting(r) && COUNTED.test(m.text)) { state.counted++; r.d.textContent = `${state.counted} of ${state.nBams} samples counted`; }
  }
  function onProgress(text) {
    const m = BAR.exec(text), r = runningRow();
    if (!m || !r || +m[3] === 0) return;
    const u = /([A-Za-z]+)\/s\s*$/.exec(m[4]) || /s\/([A-Za-z]+)\s*$/.exec(m[4]);
    r.d.textContent = `${m[1]}: ${nf(m[2])} of ${nf(m[3])}${u ? " " + (UNITS[u[1]] || u[1]) : ""}`;
  }

  // The Run analysis screen has two faces: "ready" (summary of the inputs and parameters, the Run button) and the progress / finished / stopped face.
  function renderRunView() {
    const ready = state.runState === "ready", st = state.runState;
    show($("run-pre"), ready); show($("run-prog"), !ready);
    show($("run-end"), st === "done" || st === "failed"); show($("btn-cancel"), st === "running");
    $("run-title").textContent = ready ? "Run analysis" : st === "running" ? "Running analysis" : st === "done" ? "Analysis finished" : "Analysis stopped";
    $("run-sub").textContent = ready ? "Check the inputs and the parameters, then start. The analysis runs in this browser tab."
      : st === "running" ? "The stages below are the real ones of this run, with their measured times. Do not close the tab." : st === "done" ? "All stages completed." : "A stage stopped the analysis; the message is below.";
    if (ready) renderRunSummary();
  }
  function kv(dl, pairs) {
    dl.textContent = "";
    pairs.forEach(([k, v, cls]) => { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = k; dd.textContent = v; if (cls) dd.className = cls; dl.append(dt, dd); });
  }
  function renderRunSummary() {
    const a = analyse(), valid = a.samples.filter((s) => s.date && !s.date.err).length, patients = new Set(a.samples.map((s) => s.patient).filter(Boolean));
    const fg = state.refKind === "fasta_genes", sg = segOn(), names = (fg ? (sg ? [...state.segFastas, ...state.segGenes] : [state.fasta, state.genes]) : state.genbanks).filter(Boolean).map((x) => x.name);
    const bam = state.bams.reduce((x, y) => x + y.size, 0), tbl = state.tables.reduce((x, y) => x + y.buffer.byteLength, 0);
    kv($("run-inputs"), [["BAM files", `${state.bams.length}${state.bams.length ? ` · ${mb(bam)} MB` : ""}`], ["bam-readcount tables", `${state.tables.length}${state.tables.length ? ` · ${mb(tbl)} MB` : ""}`],
      ["Samples", String(a.samples.length)], ["Samples with a valid date", `${valid} of ${a.samples.length}`], ["Patients", String(patients.size)],
      ["Reference", (sg ? "Segmented virus · " : "") + (fg ? "FASTA + gene list: " : "GenBank: ") + (names.length ? names.join(", ") : "not chosen")]]);
    const np = parseInt($("p-nperm").value, 10), own = $("p-patient").value.trim(), nal = aliasList().length;
    kv($("run-params"), [["Permutations", $("p-nperm").value], ["p resolution (1/(nperm+1))", np >= 0 ? (1 / (np + 1)).toPrecision(3) : "—"], ["Seed", $("p-seed").value], ["Minimum |Δf|", $("p-delta").value],
      ["Patient name", own || "from the file names or the dates file"], ["Contig aliases", nal ? String(nal) : "none"], ["HTML report", $("p-noreport").checked ? "skipped" : "built"]]);
    $("run-box-text").textContent = state.lastOff ? (state.lastMsg || "Run is not possible yet.") : "The stages are listed as soon as the run starts, each with its measured time.";
  }
  function continueToRun() {
    if (state.runState === "done" || state.runState === "failed") state.runState = "ready";       // a new run; the earlier results stay available until it starts
    state.accepted = true; enableTab("run", true); showTab("run", true);
  }
  $("btn-continue").addEventListener("click", continueToRun);
  $("btn-back-pre").addEventListener("click", () => showTab("data", true));

  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (view !== "run") { if (!$("btn-continue").disabled) continueToRun(); return; }          // Enter in a field of the first screen only moves on
    if ($("btn-run").disabled) return;
    const params = { nperm: parseInt($("p-nperm").value, 10), seed: parseInt($("p-seed").value, 10), freq_delta: parseFloat($("p-delta").value), make_report: !$("p-noreport").checked };
    if ($("p-patient").value.trim()) params.patient = $("p-patient").value.trim();
    if (aliasList().length) params.alias = aliasList();
    if (!(params.nperm >= 10) || !(params.seed >= 0) || !(params.freq_delta > 0)) {
      showTab("data", true);
      flash("Check the parameters: permutations ≥ 10, seed ≥ 0, minimum |Δf| > 0.", "err");
      return;
    }
    const a = analyse();                                        // the command line stops here too: a sample without a date is never dropped silently
    if (a.missing.length || a.dup.length) { showTab("data", true); refresh(); return; }
    state.flash = null;
    const byPatient = new Map();
    a.samples.forEach((s) => { if (s.patient) { if (!byPatient.has(s.patient)) byPatient.set(s.patient, new Set()); if (s.date && s.date.shown) byPatient.get(s.patient).add(s.date.shown); } });
    state.runInfo = { samples: a.samples.length, patients: byPatient.size, byPatient };
    state.nBams = state.bams.length; state.counted = 0;
    state.running = true; state.runState = "running"; state.result = null; state.resultsSeen = false; state.runParams = { nperm: params.nperm, seed: params.seed, freq_delta: params.freq_delta };
    $("report-frame").srcdoc = ""; state.reportLoaded = false;
    enableTab("results", false); enableTab("run", true);
    $("stages").textContent = ""; $("log").textContent = ""; $("live").textContent = ""; $("overall").textContent = ""; state.rows = [];
    show($("done"), false); show($("error"), false); show($("err-actions"), false); show($("err-card"), false);
    state.stageTitle = ""; state.startedAt = performance.now(); state.timer = setInterval(tick, 1000);
    $("status").textContent = "Starting …"; $("elapsed").textContent = "Elapsed 0 s";
    refresh(); renderRunView(); renderOverall(); updateChrome();
    $("panel-run").focus({ preventScroll: false });
    // Copies, so the inputs can be reused for another run (the originals stay in the page).
    const tables = state.tables.map((t) => ({ name: t.name, buffer: t.buffer.slice(0) }));
    const fg = state.refKind === "fasta_genes", copy = (t) => ({ name: t.name, buffer: t.buffer.slice(0) });
    const sg = fg && segOn();                                    // segmented virus: the per-segment files go in the order of their lists; the Python side joins them
    const genbanks = fg ? [] : state.genbanks.map(copy), fasta = fg && !sg ? copy(state.fasta) : null, genes = fg && !sg ? copy(state.genes) : null;
    const segFastas = sg ? state.segFastas.map(copy) : [], segGenes = sg ? state.segGenes.map(copy) : [];
    state.worker.postMessage({ type: "run", tables, bams: state.bams, dates: $("t-dates").value, genbanks, fasta, genes, segFastas, segGenes, params },
                             [...tables.map((t) => t.buffer), ...genbanks.map((t) => t.buffer), ...(fasta ? [fasta.buffer, genes.buffer] : []), ...segFastas.map((t) => t.buffer), ...segGenes.map((t) => t.buffer)]);
  });

  $("btn-cancel").addEventListener("click", () => {            // terminating the worker is safe: nothing is shared with the page except messages
    clearInterval(state.timer); state.running = false; state.runState = "ready";
    show($("btn-cancel"), false);
    showTab("data", true);
    startWorker();
    flash("Run cancelled. The Python runtime is restarting.", "info", true);
  });
  $("btn-back").addEventListener("click", () => { state.runState = "ready"; showTab("data", true); refresh(); });
  $("btn-back-done").addEventListener("click", () => showTab("data", true));
  $("btn-show").addEventListener("click", () => showTab("results", true));

  function endRun() { clearInterval(state.timer); state.running = false; show($("btn-cancel"), false); refresh(); }

  function showError(what, detail) {
    const box = $("error"); box.textContent = "";
    const h = document.createElement("span"); h.className = "what"; h.textContent = what; box.append(h, document.createTextNode(detail));
    show(box, true); show($("err-actions"), true); show($("err-card"), true);
  }

  function onFail(m) {
    if (m.stage === "get") { $("res-meta").textContent = "The download failed: " + m.message; return; }
    if (!state.running) {                                      // the runtime itself failed to start (before any run)
      pill("Python runtime: failed", "bad"); state.fatal = "The Python runtime failed: " + m.message; refresh(); return;
    }
    state.runState = "failed";
    endRun();
    const r = runningRow();
    if (r) finishRow(r, "fail");
    state.rows.forEach((x) => { if (x.li.className === "wait") setRow(x, "notrun", "Not run"); });
    renderOverall();
    $("status").textContent = "The run stopped."; $("live").textContent = "";
    $("elapsed").textContent = `Elapsed ${fmtDur((performance.now() - state.startedAt) / 1000)}`;
    if (m.memory) {
      showError("The browser ran out of memory", `${m.message}\n\nThe Python runtime has been restarted. Try fewer permutations or fewer/smaller tables, or use the command line.`);
    } else if (m.stage === "runtime" || m.stage === "init") {
      showError("The Python runtime failed", m.message);
    } else {
      showError(`Stage “${m.stage}” stopped`, m.message);
    }
    if (m.fatal && m.stage === "runtime") startWorker();      // a failed start (stage "init") is not retried automatically
    renderRunView(); updateChrome();
    $("btn-back").focus();
  }

  function onResult(m) {
    state.runState = "done";
    endRun();
    const done = runningRow(); if (done) finishRow(done, "done");
    renderOverall();
    $("status").textContent = `Analysis finished in ${m.seconds} s.`;
    $("elapsed").textContent = "";
    $("live").textContent = "";
    $("done-text").textContent = `Finished in ${m.seconds} s: ${plural(Object.keys(m.summary.files).length, "file", "files")}, ${mb(m.zipBytes)} MB zipped.`;
    state.result = m;
    show($("done"), true);
    enableTab("results", true);
    renderResults(m);
    renderRunView(); updateChrome();
    $("btn-show").focus();
  }

  // New analysis: back to the input data; the results are dropped only after the user confirms (the same question on the Run screen and on the Results screen).
  function discardResults() {
    state.result = null; state.runState = "ready"; state.accepted = false; state.resultsSeen = false; state.reportLoaded = false; state.tbl = null;
    $("report-frame").srcdoc = "";
    $("tbl").textContent = ""; $("files").textContent = ""; $("kpis").textContent = ""; $("sum-table").querySelector("tbody").textContent = "";
    enableTab("results", false); enableTab("run", false);
    show($("not-analysed"), false);
    showTab("data", true); refresh();
  }
  function wireDiscard(btn, box, wrap, yes, no) {
    $(btn).addEventListener("click", () => { show($(wrap), false); show($(box), true); $(no).focus(); });
    $(no).addEventListener("click", () => { show($(box), false); show($(wrap), true); $(btn).focus(); });
    $(yes).addEventListener("click", () => { show($(box), false); show($(wrap), true); discardResults(); });
  }
  wireDiscard("btn-new", "new-confirm", "newbox", "btn-new-yes", "btn-new-no");
  wireDiscard("btn-new-run", "new-confirm-run", "newbox-run", "btn-new-run-yes", "btn-new-run-no");

  // ---- results: sub-tabs ------------------------------------------------------------------------------------------
  // The five tabs of the report (Overview = its Summary, Variants, Trajectories, Genes, Quality) and its About tab are shown from the report itself, in the
  // sandboxed iframe, and chosen from the sub-tabs here; Tables and Files are the page's own. With "Skip the HTML report" only Overview, Tables and Files remain.
  const REPORT_TABS = ["summary", "variants", "traj", "genes", "quality", "about"];
  const SUBS = ["summary", "variants", "traj", "genes", "quality", "about", "tables", "files"];
  // The report has an embedding contract (see the comment at the top of its body). A srcdoc iframe has no URL hash of its own and a sandboxed srcdoc cannot
  // call history.replaceState, so this page uses the contract's postMessage form: once the report has loaded (and whenever it announces `ready`) the page sends
  // {type:"srasel-report", tab, embed:true, theme}; the report hides its own title and tab bar, opens that tab and takes the theme. The report answers with
  // {event:"tab", tab}: those events keep the sub-tabs of this page in step when the report changes tab by itself. The downloaded report is never modified.
  // If a report does not answer a tab change within 600 ms (an older report) the copy is reloaded: the page degrades, it does not break.
  const hostTheme = () => { const t = document.documentElement.getAttribute("data-theme"); return t || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); };
  const toReport = (msg) => { try { $("report-frame").contentWindow.postMessage(Object.assign({ type: "srasel-report" }, msg), "*"); } catch (e) { /* no report loaded */ } };
  function sendHost() { state.hostSent = true; toReport({ tab: state.reportTab, embed: true, theme: hostTheme() }); }
  function loadReport(id) { state.reportTab = id; state.reportLoaded = true; state.hostSent = false; $("report-frame").srcdoc = state.result.report; }
  $("report-frame").addEventListener("load", () => { if (state.reportLoaded) sendHost(); });
  function gotoReportTab(id) {
    if (!state.reportLoaded) { loadReport(id); return; }
    if (state.reportTab === id) return;
    state.reportTab = id; state.ack = false;
    toReport({ tab: id, embed: true });
    clearTimeout(state.ackTimer);
    state.ackTimer = setTimeout(() => { if (!state.ack) loadReport(id); }, 600);
  }
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== $("report-frame").contentWindow || !m || m.type !== "srasel-report") return;
    if (m.event === "ready") { sendHost(); return; }
    if (m.event !== "tab" || !state.hostSent) return;                                // before our first message the report shows its own default tab: not news
    if (m.tab === state.reportTab) { state.ack = true; return; }
    if (REPORT_TABS.includes(m.tab)) { state.reportTab = m.tab; state.ack = true; showSub(m.tab); }          // the report changed tab by itself: mirror it outside
  });
  new MutationObserver(() => toReport({ theme: hostTheme() })).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  function showSub(id, focus) {
    const m = state.result, hasReport = !!(m && m.report);
    if (!hasReport && REPORT_TABS.includes(id) && id !== "summary") id = "summary";
    state.sub = id;
    document.querySelectorAll("#subtabs [role=tab]").forEach((b) => { const on = b.dataset.r === id; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    show($("rp-overview"), id === "summary"); show($("rp-tables"), id === "tables"); show($("rp-files"), id === "files");
    const rep = hasReport && REPORT_TABS.includes(id);
    show($("report-host"), rep);
    if (rep) { $("report-host").setAttribute("aria-labelledby", "rtab-" + id); gotoReportTab(id); }
  }
  document.querySelectorAll("#subtabs [role=tab]").forEach((b) => {
    b.addEventListener("click", () => showSub(b.dataset.r));
    b.addEventListener("keydown", (e) => {
      const vis = SUBS.filter((x) => !$("rtab-" + x).hidden), i = vis.indexOf(b.dataset.r);
      let to = null;
      if (e.key === "ArrowRight") to = vis[(i + 1) % vis.length]; else if (e.key === "ArrowLeft") to = vis[(i + vis.length - 1) % vis.length];
      else if (e.key === "Home") to = vis[0]; else if (e.key === "End") to = vis[vis.length - 1];
      if (to) { e.preventDefault(); showSub(to, true); }
    });
  });

  // ---- results: download menu (split button) ----------------------------------------------------------------------
  function menu(open) {
    const more = $("dl-more"); more.setAttribute("aria-expanded", String(open)); show($("dl-menu"), open);
    if (open) { const first = $("dl-menu").querySelector("button:not(:disabled)"); if (first) first.focus(); }
  }
  $("dl-more").addEventListener("click", () => menu($("dl-menu").hidden));
  $("dl-menu").addEventListener("click", () => menu(false));
  $("dl-menu").addEventListener("keydown", (e) => {
    const items = [...$("dl-menu").querySelectorAll("button:not(:disabled)")], i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { e.preventDefault(); menu(false); $("dl-more").focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i + items.length - 1) % items.length].focus(); }
    else if (e.key === "Tab") menu(false);
  });
  document.addEventListener("click", (e) => { if (!$("dl-menu").hidden && !e.target.closest(".dlsplit")) menu(false); });

  // ---- results: what the page itself knows -------------------------------------------------------------------------
  function renderResults(m) {
    const nfiles = Object.keys(m.summary.files).length, rp = state.runParams;
    $("res-meta").textContent = `Finished in ${m.seconds} s · ${plural(nfiles, "file", "files")}, ${mb(m.zipBytes)} MB zipped · WebAssembly memory ${m.heapMB} MB · ` +
      `permutations ${rp.nperm} (p resolution 1/(nperm+1) = ${(1 / (rp.nperm + 1)).toPrecision(3)}), seed ${rp.seed}, minimum |Δf| (freq-delta) ${rp.freq_delta}` +
      (m.report ? "" : " · no HTML report (skipped)");
    $("btn-report-dl").disabled = !m.report;
    renderPatients(m); renderKpis(m); renderNotAnalysed(m);
    REPORT_TABS.filter((x) => x !== "summary").forEach((x) => { $("rtab-" + x).hidden = !m.report; });        // "Skip the HTML report" leaves no report to show
    state.reportLoaded = false;
    // the Tables sub-tab
    const sel = $("tbl-pick"); sel.textContent = "";
    Object.keys(m.inline).sort().forEach((rel) => { const o = document.createElement("option"); o.value = rel; o.textContent = rel; sel.append(o); });
    if (sel.options.length) loadTable(sel.value);
    // the Files sub-tab
    const ul = $("files"); ul.textContent = "";
    Object.keys(m.summary.files).sort().forEach((rel) => {
      const li = document.createElement("li"), name = document.createElement("span"), sz = document.createElement("span");
      name.textContent = rel; sz.className = "sz"; sz.textContent = `${(m.summary.files[rel] / 1024).toFixed(m.summary.files[rel] < 10240 ? 1 : 0)} KB`;
      const b = document.createElement("button"); b.type = "button"; b.className = "btn sm"; b.textContent = "Download"; b.setAttribute("aria-label", "Download " + rel);
      b.addEventListener("click", () => requestFile(rel));
      li.append(name, sz, b); ul.append(li);
    });
    $("files-count").textContent = `(${nfiles})`;
    showSub("summary");
  }
  function renderKpis(m) {
    const P = Object.entries(m.summary.patients), box = $("kpis"); box.textContent = "";
    const positions = P.reduce((n, [p]) => { const pps = m.inline[SEL + p + "_per_position_summary.tsv"]; return pps == null ? n : n + Math.max(0, tsvRows(pps).length - 1); }, 0);
    const tile = (n, label) => { const d = document.createElement("div"), b = document.createElement("b"), s = document.createElement("span"); d.className = "kpi"; b.textContent = n; s.textContent = label; d.append(b, s); box.append(d); };
    tile(nf(state.runInfo.samples), "Samples");
    tile(`${P.length} of ${state.runInfo.patients}`, "Patients analysed");
    tile(nf(P.reduce((n, [, v]) => n + v.n_variants, 0)), "Tested trajectories");
    tile(nf(P.reduce((n, [, v]) => n + v.n_labelled, 0)), `Tagged alleles, at ${nf(positions)} positions`);
  }
  // Patients that were in the inputs but have no result. The page knows their dates; why a patient with 3 or more dates has no result is not known to it.
  function renderNotAnalysed(m) {
    const box = $("not-analysed"), ul = $("not-analysed-list"); ul.textContent = "";
    const lost = [...state.runInfo.byPatient].filter(([p]) => !(p in m.summary.patients)).sort((x, y) => x[0].localeCompare(y[0], "en", { numeric: true }));
    lost.forEach(([p, dates]) => {
      const li = document.createElement("li");
      li.textContent = dates.size < 3 ? `${p}: ${plural(dates.size, "date", "dates")}; at least 3 are needed to fit a slope.`
        : `${p}: ${plural(dates.size, "date", "dates")}, but no result (no variant passed the filters, or the patient did not pass the integrity checks; see the technical log).`;
      ul.append(li);
    });
    show(box, lost.length > 0);
  }

  const SEL = "processing/06_selection_analysis/";
  const tsvRows = (text) => (text || "").split("\n").filter((l) => l.length).map((l) => l.split("\t"));
  function datesOf(text) {                                    // largest n_days of the tested trajectories (null if none)
    const rows = tsvRows(text); if (rows.length < 2) return null;
    const i = rows[0].indexOf("n_days"); if (i < 0) return null;
    let best = null;
    for (let r = 1; r < rows.length; r++) { const v = parseInt(rows[r][i], 10); if (Number.isFinite(v) && (best == null || v > best)) best = v; }
    return best;
  }
  function datesBadge(n) {                                    // plain amber text under the number of dates (no badge)
    const b = document.createElement("span"); b.className = "dn warn";
    if (n != null && n <= 3) { b.title = "No variant can reach p < 0.05 with 3 dates"; b.textContent = "No tag possible with 3 dates"; return b; }
    if (n === 4) { b.title = "With 4 dates the smallest possible p is about 0.04: flags are borderline and seed-dependent"; b.textContent = "Borderline: 4 dates, tags depend on the seed"; return b; }
    return null;
  }
  function renderPatients(m) {
    const tb = $("sum-table").querySelector("tbody"); tb.textContent = "";
    for (const [p, v] of Object.entries(m.summary.patients)) {
      const inl = (suffix) => m.inline[SEL + p + suffix];
      const dates = datesOf(inl("_variant_stats.tsv"));
      const pps = inl("_per_position_summary.tsv");
      const tr = document.createElement("tr");
      const th = document.createElement("th"); th.scope = "row"; th.textContent = p; tr.append(th);
      const d = document.createElement("td"); d.textContent = dates == null ? "—" : String(dates);
      const b = datesBadge(dates); if (b) d.append(b);
      tr.append(d);
      const t = document.createElement("td"); t.textContent = String(v.n_variants); tr.append(t);
      const g = document.createElement("td");
      const pos = pps == null ? "?" : String(Math.max(0, tsvRows(pps).length - 1));
      g.textContent = `${v.n_labelled} allele(s) at ${pos} position(s)`; tr.append(g);
      tb.append(tr);
    }
  }

  const HIDDEN = new Set(["score", "variant_suffix", "annot_detail", "why_ambiguous_pos", "covarying", "covarying_count", "covarying_with",
    "day", "k", "n", "beta_up", "p_up", "score_up", "beta_dn", "p_dn", "score_dn", "codons", "aa_labels", "betas"]);
  const COLS = {
    pos: ["Position (global)", "Global 1-based coordinate (contigs concatenated). Use contig and contig position for display."],
    contig: ["Contig", "Name of the reference sequence."],
    contig_pos: ["Position in contig", "Reference coordinate within the contig."],
    gene: ["Genes (all)", "All annotated genes covering this position."],
    aa_gene: ["Gene", "Gene used for the amino-acid label (first annotation of the position)."],
    aa_idx: ["Codon", "Codon number in that gene; ND if non-coding."],
    var: ["Allele", "Base, or inserted (+) / deleted (−) sequence. Both alleles of a site are listed."],
    codon: ["Codon (this allele)", "Codon of this allele in mRNA sense, built from the mean frequency of the neighbouring bases. Not the consensus codon at any given date."],
    aa_change: ["Amino acid", "“25N”: the rising allele encodes N at codon 25. “I25”: the falling allele encodes I. Not REF→ALT. Inferred from mean neighbour frequencies."],
    ambiguous: ["AA ambiguous", "Codon could not be resolved (neighbour not fixed, indel, non-coding, or several changing sites in the codon)."],
    other_frames: ["Other frames", "Effect of the same allele in the other overlapping reading frames."],
    beta: ["Slope (%/day)", "Depth-weighted linear change of allele frequency per day, shown as percentage points per day. Descriptive; not a selection measure."],
    delta_f: ["Fitted change", "Slope × follow-up, as a fraction of reads. It is a linear fit and can exceed ±1."],
    pval: ["Permutation p", "Share of date relabelings with an equal or steeper slope; the smallest possible value depends on nperm and on the number of dates."],
    tag: ["Direction flag (p<0.05)", "Rising or Falling when permutation p<0.05 (|Δf| is already above the threshold). A sustained frequency change."],
    depth: ["Mean depth", "Mean reads at the position across dates (not allele reads)."],
    n_days: ["Dates", "Covered dates in this trajectory. With 3 dates no tag is possible; with 4 dates tags are borderline."],
    days_from_t0: ["Days to first date with ≥10 reads", "Days from the first sample to the first date with at least 10 reads of this allele. Not an emergence date: it depends on depth and on the first sample."],
    date: ["First date with ≥10 reads", "Calendar date of that sample. Not the emergence or acquisition date."],
    label: ["Amino-acid label", "Falling-allele amino acid, codon number, rising-allele amino acid (I25N). Reads falling → rising, not REF → ALT."],
    synonymous: ["Synonymous", "True or False only when both labels are unambiguous."],
    n_sel: ["Tagged alleles", "Number of tagged alleles at this position."]
  };
  const PERCENT_COLS = new Set(["beta", "beta_up", "beta_dn"]);
  const OBS = "Observed change";
  const OBS_TIP = "Frequency at the last date minus the first date (k/n from the per-date lists of this row). It is an observation, unlike the fitted change.";
  function observedChange(cols, row) {
    const iD = cols.indexOf("day"), iK = cols.indexOf("k"), iN = cols.indexOf("n");
    if (iD < 0 || iK < 0 || iN < 0) return null;
    try {
      const d = JSON.parse(row[iD]), k = JSON.parse(row[iK]), n = JSON.parse(row[iN]);
      if (!Array.isArray(d) || d.length < 2 || d.length !== k.length || d.length !== n.length) return null;
      let a = 0, b = 0;
      for (let i = 1; i < d.length; i++) { if (d[i] < d[a]) a = i; if (d[i] > d[b]) b = i; }
      if (!(n[a] > 0) || !(n[b] > 0)) return null;
      return k[b] / n[b] - k[a] / n[a];
    } catch (e) { return null; }
  }
  function fmtCell(col, v) {
    if (v === "" || v == null) return "";
    if (col === "tag") return v === "pos" ? "Rising" : v === "neg" ? "Falling" : v;
    const x = Number(v);
    if (PERCENT_COLS.has(col) && Number.isFinite(x)) return (x * 100).toPrecision(3);
    if (col === "pval" && Number.isFinite(x)) return x.toPrecision(3);
    if (col === "delta_f" && Number.isFinite(x)) return x.toFixed(3);
    return v;
  }
  function cellEl(tag, text, title, raw) {
    const c = document.createElement(tag); c.textContent = text;
    if (title) c.title = title;
    if (raw) { const r = document.createElement("span"); r.className = "raw"; r.textContent = raw; c.append(r); }
    return c;
  }

  // The Tables sub-tab: the per-patient tables the engine wrote that the page holds in memory. The whole table is loaded; the page shows 100 rows at a time,
  // can sort by a column and filter by text. Display only: the file that is downloaded is the engine's own, with the exact values.
  const TBL_PAGE = 100;
  const sortKey = (col, raw, shownText) => {
    if (col.numeric) { const x = Number(raw); return raw !== "" && raw != null && Number.isFinite(x) ? x : null; }
    return shownText === "" ? null : shownText.toLowerCase();
  };
  function loadTable(rel) {
    const text = state.result.inline[rel] || "", lines = text.split("\n").filter((l) => l.length), tsv = rel.endsWith(".tsv");
    const guide = $("tbl-guide"); guide.textContent = "";
    const name = rel.split("/").pop();
    const kind = /selected_ranked/.test(name) ? " This file lists tagged rows only (the file name is kept from the engine); rows are ordered by signed score: rising tags first, then falling tags from weakest to strongest."
      : /variant_stats/.test(name) ? " One row per tested allele trajectory, in the engine's order." : "";
    const t = state.tbl = { rel, tsv, text, cols: [], rows: [], view: [], sort: -1, desc: false, page: 0, q: "" };
    $("tbl-q").value = "";
    $("tbl-note").textContent = tsv ? `${rel}: ${nf(lines.length - 1)} rows.` + kind : rel;
    if (tsv) {
      const names = lines[0].split("\t"), internal = $("tbl-internal").checked;
      const shown = names.map((c, i) => i).filter((i) => internal || !HIDDEN.has(names[i]));
      const hasObs = ["day", "k", "n", "delta_f"].every((c) => names.includes(c)), after = names.indexOf("delta_f");
      for (const i of shown) {
        const c = names[i], meta = COLS[c];
        t.cols.push({ i, name: c, label: meta ? meta[0] : c, title: meta ? meta[1] : c, raw: meta ? c : null, numeric: !/^(var|tag|gene|aa_gene|contig|codon|aa_change|ambiguous|other_frames|annot_detail|label|date|synonymous|vars|tags|pvals|aa_labels|codons|betas|day|k|n)$/.test(c) });
        if (meta) { const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = `${meta[0]} (${c})`; dd.textContent = meta[1]; guide.append(dt, dd); }
        if (hasObs && i === after) {
          t.cols.push({ i: -1, name: "observed", label: OBS, title: OBS_TIP, raw: "computed", numeric: true });
          const dt = document.createElement("dt"), dd = document.createElement("dd"); dt.textContent = OBS + " (computed)"; dd.textContent = OBS_TIP; guide.append(dt, dd);
        }
      }
      t.rows = lines.slice(1).map((l) => {
        const f = l.split("\t"), cells = [], keys = [];
        for (const c of t.cols) {
          if (c.i < 0) { const o = observedChange(names, f); cells.push(o == null ? "" : o.toFixed(3)); keys.push(o == null ? null : o); }
          else { const sh = fmtCell(c.name, f[c.i]) || ""; cells.push(sh); keys.push(sortKey(c, f[c.i], sh)); }
        }
        return { cells, keys, hay: cells.join("\t").toLowerCase() };
      });
    }
    applyTable();
  }
  function applyTable() {
    const t = state.tbl; if (!t) return;
    let v = t.rows;
    if (t.q) { const q = t.q.toLowerCase(); v = v.filter((r) => r.hay.includes(q)); }
    if (t.sort >= 0) {
      const k = t.sort, dir = t.desc ? -1 : 1;
      v = v.slice().sort((a, b) => {
        const x = a.keys[k], y = b.keys[k];
        if (x === null && y === null) return 0;
        if (x === null) return 1; if (y === null) return -1;                           // empty cells always last
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true })) * dir;
      });
    }
    t.view = v; t.page = Math.min(t.page, Math.max(0, Math.ceil(v.length / TBL_PAGE) - 1));
    renderTable();
  }
  function renderTable() {
    const t = state.tbl, tbl = $("tbl"); tbl.textContent = "";
    show($("tbl-pager"), t.tsv); $("tbl-q").disabled = !t.tsv;
    if (!t.tsv) { const tb = document.createElement("tbody"), tr = document.createElement("tr"), td = document.createElement("td"); td.className = "t"; td.textContent = t.text; tr.append(td); tb.append(tr); tbl.append(tb); return; }
    const thead = document.createElement("thead"), hr = document.createElement("tr");
    t.cols.forEach((c, j) => {
      const th = document.createElement("th"); th.scope = "col"; th.title = c.title;
      th.setAttribute("aria-sort", t.sort === j ? (t.desc ? "descending" : "ascending") : "none");
      const b = document.createElement("button"); b.type = "button"; b.className = "sortbtn"; b.textContent = c.label; b.setAttribute("aria-label", `Sort by ${c.label}`);
      b.addEventListener("click", () => { if (t.sort === j) { if (t.desc) t.sort = -1; else t.desc = true; } else { t.sort = j; t.desc = false; } applyTable(); const nb = $("tbl").querySelectorAll("th .sortbtn")[j]; if (nb) nb.focus(); });
      th.append(b);
      if (c.raw) { const r = document.createElement("span"); r.className = "raw"; r.textContent = c.raw; th.append(r); }
      hr.append(th);
    });
    thead.append(hr); tbl.append(thead);
    const tb = document.createElement("tbody"), from = t.page * TBL_PAGE;
    t.view.slice(from, from + TBL_PAGE).forEach((r) => { const tr = document.createElement("tr"); r.cells.forEach((x) => { const td = document.createElement("td"); td.textContent = x; tr.append(td); }); tb.append(tr); });
    tbl.append(tb);
    const total = t.view.length, pages = Math.max(1, Math.ceil(total / TBL_PAGE));
    $("tbl-page").textContent = total ? `Rows ${nf(from + 1)}–${nf(Math.min(total, from + TBL_PAGE))} of ${nf(total)}${t.q ? ` (filtered from ${nf(t.rows.length)})` : ""} · page ${t.page + 1} of ${pages}` : (t.q ? `No row matches “${t.q}”.` : "No rows.");
    $("tbl-prev").disabled = t.page <= 0; $("tbl-next").disabled = t.page >= pages - 1;
    $("tbl-wrap").scrollTop = 0;
  }
  $("tbl-prev").addEventListener("click", () => { if (state.tbl && state.tbl.page > 0) { state.tbl.page--; renderTable(); } });
  $("tbl-next").addEventListener("click", () => { if (state.tbl) { state.tbl.page++; renderTable(); } });
  $("tbl-q").addEventListener("input", (e) => { if (state.tbl) { state.tbl.q = e.target.value.trim(); state.tbl.page = 0; applyTable(); } });
  $("tbl-internal").addEventListener("change", () => { if ($("tbl-pick").value) loadTable($("tbl-pick").value); });
  $("tbl-pick").addEventListener("change", (e) => loadTable(e.target.value));
  $("btn-tbl-dl").addEventListener("click", () => { const rel = $("tbl-pick").value; if (rel) saveBlob(new Blob([state.result.inline[rel]], { type: "text/plain" }), rel.split("/").pop()); });
  $("btn-report-dl").addEventListener("click", () => { if (state.result && state.result.report) saveBlob(new Blob([state.result.report], { type: "text/html" }), "report.html"); });
  // The engine's SUMMARY.md is written by `srasel run` only; Browser Mode builds a short one from what this page knows (the zip is not changed).
  function buildSummary() {
    const r = state.runParams, m = state.result, L = ["# SRASel analysis summary (Browser mode)", ""];
    L.push(`* Samples: ${state.runInfo.samples} · patients: ${state.runInfo.patients}`);
    L.push(`* Parameters: p<0.05 by permutation (${r.nperm} permutations, p resolution 1/(nperm+1) = ${(1 / (r.nperm + 1)).toPrecision(3)}), minimum |Δf| ${r.freq_delta}, seed ${r.seed}`);
    L.push(`* Finished in ${m.seconds} s in the browser (Pyodide ${state.cfg ? state.cfg.pyodide : "?"}, SRASel engine ${state.versions ? state.versions.srasel : "?"})`, "");
    L.push("## Result per patient", "", "| Patient | Dates | Tested trajectories | Tagged (p<0.05 and |Δf|≥threshold) |", "|---|---|---|---|");
    for (const [p, v] of Object.entries(m.summary.patients)) {
      const d = datesOf(m.inline[SEL + p + "_variant_stats.tsv"]), pps = m.inline[SEL + p + "_per_position_summary.tsv"];
      L.push(`| ${p} | ${d == null ? "—" : d} | ${v.n_variants} | ${v.n_labelled} allele(s) at ${pps == null ? "?" : Math.max(0, tsvRows(pps).length - 1)} position(s) |`);
    }
    L.push("", "With 3 dates no variant can reach p < 0.05; with 4 dates the smallest possible p is about 0.04.",
      "Both alleles of a biallelic site are listed: count positions, not alleles.");
    return L.join("\n") + "\n";
  }
  $("btn-summary-dl").addEventListener("click", () => {
    if (!state.result) return;
    if (state.result.summary.files["SUMMARY.md"]) requestFile("SUMMARY.md");
    else saveBlob(new Blob([buildSummary()], { type: "text/markdown" }), "SUMMARY.md");
  });
  $("btn-zip").addEventListener("click", () => requestFile("__zip__"));

  function requestFile(rel) { state.worker.postMessage({ type: "get", path: rel }); }
  function onFile(m) { saveBlob(new Blob([m.buffer]), m.path === "__zip__" ? "srasel_results.zip" : m.path.split("/").pop()); }
  function saveBlob(blob, name) {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ---- start --------------------------------------------------------------------------------------------------
  fetch("config.json", { cache: "no-cache" }).then((r) => r.json()).then((c) => {
    state.cfg = c; document.querySelectorAll("[data-pyodide]").forEach((s) => { s.textContent = c.pyodide; });
  }).catch(() => {});
  refresh();
  if (typeof WebAssembly !== "object" || typeof Worker !== "function") {
    pill("This browser lacks WebAssembly or Web Workers", "bad");
    state.fatal = "SRASel browser mode needs WebAssembly and Web Workers. Use a current Chrome, Firefox, Edge or Safari, or the command line.";
    refresh();
  } else {
    startWorker();
  }
})();
