/* SRASel browser mode: a (module) Web Worker that hosts Pyodide (Python compiled to WebAssembly) and runs the real SRASel stages.
 *
 * Network: the Pyodide runtime and its scientific packages (numpy, pandas, scipy, biopython, matplotlib, joblib, tqdm) are
 * downloaded from the jsDelivr CDN at the exact version in config.json. The SRASel engine (a wheel with srasel/engine.py,
 * checked against the sha256 in manifest.json) and run_pipeline.py come from this site. User data is written to Pyodide's
 * in-memory file system and is never sent anywhere.
 *
 * page -> worker : {type:"init"} | {type:"run", tables:[{name,buffer}], bams:[File], dates, genbanks:[{name,buffer}], fasta:{name,buffer}|null, genes:{name,buffer}|null, params} | {type:"get", path}
 *   the reference is either genbanks (one or more files) or fasta + genes (the runner makes the GenBank with `make-genbank`, as `srasel run --fasta --genes` does)
 *   params = {nperm, seed, freq_delta, make_report, patient?, alias?}: the options of `srasel run` that the page offers (passed on to run_pipeline.run_from_tables)
 * worker -> page : {type:"status"|"ready"|"plan"|"stage"|"line"|"progress"|"time"|"result"|"fail"|"file"}
 */
let pyodide = null;
let cfg = null;
const post = (type, data, transfer) => self.postMessage(Object.assign({ type }, data || {}), transfer || []);
const heapMB = () => { try { return Math.round(pyodide._module.HEAPU8.length / 1048576); } catch (e) { return null; } };
const secs = (t0) => +((performance.now() - t0) / 1000).toFixed(1);

async function sha256hex(buf) {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

async function init() {
  const t0 = performance.now();
  cfg = await getJSON("config.json");
  post("status", { text: `Downloading the Python runtime (Pyodide ${cfg.pyodide}) from cdn.jsdelivr.net …` });
  const { loadPyodide } = await import(cfg.index_url + "pyodide.mjs");     // Pyodide 314 does not support classic workers
  pyodide = await loadPyodide({ indexURL: cfg.index_url });
  post("status", { text: `Python runtime ready (${secs(t0)} s). Loading ${cfg.packages.join(", ")} …` });
  const t1 = performance.now();
  await pyodide.loadPackage(cfg.packages, { messageCallback: (m) => post("status", { text: m }), errorCallback: (m) => post("status", { text: m }) });
  post("status", { text: `Scientific packages loaded (${secs(t1)} s). Installing the SRASel engine from this site …` });

  const man = await getJSON("manifest.json");
  const wr = await fetch(man.wheel, { cache: "no-cache" });
  if (!wr.ok) throw new Error(`${man.wheel}: HTTP ${wr.status}`);
  const wheel = await wr.arrayBuffer();
  if ((await sha256hex(wheel)) !== man.sha256) throw new Error("The SRASel engine wheel does not match manifest.json (sha256). Reload the page.");
  pyodide.unpackArchive(new Uint8Array(wheel), "wheel");
  const code = await (await fetch("run_pipeline.py", { cache: "no-cache" })).text();
  pyodide.FS.writeFile("/run_pipeline.py", code);
  const t2 = performance.now();
  post("status", { text: "Importing the engine (first import compiles matplotlib's font cache; this can take several seconds) …" });
  const ver = await pyodide.runPythonAsync(`
import sys, json
sys.path.insert(0, "/")
import run_pipeline, srasel, srasel.engine, numpy, pandas, scipy, Bio
json.dumps(dict(python=sys.version.split()[0], srasel=srasel.__version__, numpy=numpy.__version__, pandas=pandas.__version__,
                scipy=scipy.__version__, biopython=Bio.__version__))
`);
  post("ready", { versions: JSON.parse(ver), pyodide: pyodide.version, seconds: secs(t0), importSeconds: secs(t2), heapMB: heapMB() });
}

function resetDir(path) {
  try {
    for (const e of pyodide.FS.readdir(path)) {
      if (e === "." || e === "..") continue;
      const p = path + "/" + e;
      if (pyodide.FS.isDir(pyodide.FS.stat(p).mode)) { resetDir(p); pyodide.FS.rmdir(p); } else pyodide.FS.unlink(p);
    }
  } catch (e) { /* the directory did not exist */ }
}

// tqdm progress bars arrive as carriage-return lines such as "Analizando P1:  42%|####   | 120/285 [00:03<00:04, 38.9var/s]".
const PROGRESS = /\d+%\||\bit\/s\b|\bs\/it\b|\/s\]/;
let lastProgress = 0;

let bamMounted = false;
function unmountBams() {
  if (!bamMounted) return;
  try { pyodide.FS.unmount("/bam"); } catch (e) { /* already gone */ }
  bamMounted = false;
}

async function run(msg) {
  resetDir("/in");
  unmountBams();
  const bams = msg.bams || [];
  if (bams.length) {
    // BAM files are NOT copied into memory: WORKERFS lets Python read the File objects of the page directly.
    post("status", { text: `Loading pysam (${(cfg.bam_packages || ["pysam"]).join(", ")}) for the BAM files …` });
    await pyodide.loadPackage(cfg.bam_packages || ["pysam"], { messageCallback: (m) => post("status", { text: m }), errorCallback: (m) => post("status", { text: m }) });
    try { pyodide.FS.mkdirTree("/bam"); } catch (e) { /* exists */ }
    pyodide.FS.mount(pyodide.FS.filesystems.WORKERFS, { files: bams }, "/bam");
    bamMounted = true;
  }
  pyodide.FS.mkdirTree("/in/rc");
  for (const t of msg.tables) pyodide.FS.writeFile("/in/rc/" + t.name.replace(/[\\/]/g, "_"), new Uint8Array(t.buffer));
  pyodide.FS.writeFile("/in/dates.tsv", msg.dates);
  msg.genbanks.forEach((g, i) => pyodide.FS.writeFile(`/in/ref${String(i + 1).padStart(3, "0")}.gb`, new Uint8Array(g.buffer)));      // zero-padded: the order of the list is the order of the files
  if (msg.fasta && msg.genes) {
    pyodide.FS.writeFile("/in/sequence.fa", new Uint8Array(msg.fasta.buffer));
    const ext = (/\.(gff3?|tsv|txt)$/i.exec(msg.genes.name) || [".tsv"])[0].toLowerCase();      // the extension tells the engine a GFF3 from a table
    pyodide.FS.writeFile("/in/genes" + ext, new Uint8Array(msg.genes.buffer));
  }
  // segmented virus: one FASTA / one gene list per segment, written in the order of the lists; the Python side joins them (srasel.segments)
  const safeName = (n) => n.replace(/[\\/]/g, "_");
  (msg.segFastas || []).forEach((f, i) => pyodide.FS.writeFile(`/in/seg_fasta_${String(i + 1).padStart(3, "0")}__${safeName(f.name)}`, new Uint8Array(f.buffer)));
  (msg.segGenes || []).forEach((f, i) => pyodide.FS.writeFile(`/in/seg_genes_${String(i + 1).padStart(3, "0")}__${safeName(f.name)}`, new Uint8Array(f.buffer)));
  pyodide.globals.set("emit", (kind, text) => {
    if (kind === "stage") post("stage", { text });
    else if (kind === "time") post("time", { text });
    else if (kind === "plan") post("plan", { text });
    else if (PROGRESS.test(text)) {                       // keep the page responsive: at most ~7 progress lines per second
      const now = performance.now();
      if (now - lastProgress > 150) { lastProgress = now; post("progress", { text }); }
    } else post("line", { stream: kind, text });
  });
  pyodide.globals.set("params_json", JSON.stringify(msg.params));
  const t0 = performance.now();
  const out = await pyodide.runPythonAsync(`
import json
from run_pipeline import run_in_fs, StageError
try:
    _res = json.dumps(dict(ok=True, summary=json.loads(run_in_fs("/in", "/results", on_event=emit, **json.loads(params_json)))))
except StageError as e:
    _res = json.dumps(dict(ok=False, stage=e.stage, message=e.detail))
_res
`);
  const res = JSON.parse(out);
  unmountBams();
  resetDir("/in");                                          // the inputs are no longer needed
  res.seconds = secs(t0);
  res.heapMB = heapMB();
  if (!res.ok) { post("fail", res); return; }
  const read = (rel) => pyodide.FS.readFile("/results/" + rel);
  const inline = {};
  for (const rel of Object.keys(res.summary.files)) {
    if (/06_selection_analysis\/[^/]+_(variant_stats|selected_ranked|per_position_summary)\.tsv$/.test(rel) || rel === "reference/REFERENCE_REPORT.txt") {
      inline[rel] = new TextDecoder().decode(read(rel));
    }
  }
  res.inline = inline;
  res.report = res.summary.files["report.html"] ? new TextDecoder().decode(read("report.html")) : null;
  res.zipBytes = pyodide.FS.stat("/results.zip").size;
  post("result", res);
}

self.onmessage = async (ev) => {
  const msg = ev.data;
  try {
    if (msg.type === "init") await init();
    else if (msg.type === "run") await run(msg);
    else if (msg.type === "get") {
      const data = msg.path === "__zip__" ? pyodide.FS.readFile("/results.zip") : pyodide.FS.readFile("/results/" + msg.path);
      const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      post("file", { path: msg.path, buffer: buf }, [buf]);
    }
  } catch (err) {
    try { unmountBams(); } catch (e2) { /* ignore */ }
    const text = String((err && err.message) || err);
    // A Python exception that is not a stage failure, or a WebAssembly memory error: the runtime may be unusable.
    post("fail", { ok: false, stage: msg.type === "run" ? "runtime" : msg.type, message: text, fatal: true,
                   memory: /memory|out of bounds|allocation|RangeError/i.test(text) });
  }
};
