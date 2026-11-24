# Browser Mode (experimental)

Static page (`docs/index.html`, `docs/browser/`) that runs the **real SRASel stages** in the visitor's browser with
[Pyodide](https://pyodide.org) (CPython compiled to WebAssembly), inside a Web Worker. Nothing is uploaded: tables, dates and the
reference are written to Pyodide's in-memory file system. The only network traffic is the download of the Pyodide runtime and
its libraries from the jsDelivr CDN (`cdn.jsdelivr.net`, exact version pinned in `docs/browser/config.json`) and of the page's own files.

**Input is BAM files and/or bam-readcount tables.** BAM files are counted in the browser with pysam (`srasel.bamcount`, see [BAM_COUNTER.md](BAM_COUNTER.md)),
because `samtools` and `bam-readcount` cannot run in a browser. Tables: one per sample (`<sample>_RG_readcount.txt`, optionally `.gz`; the output of
`bam-readcount -q 20 -b 20 -w 0`, which `srasel run` leaves in `processing/02_rc/`) are faster. A dates file (any format `srasel run --dates` accepts),
and the reference: one or more GenBank files (`.gb`) **or** a FASTA with a gene list (`--fasta`/`--genes`). Options: permutations, seed, minimum \|Δf\|, **Patient name** (`--patient`), **Contig aliases** (`--alias BAM_NAME=REF_NAME`, one per line) and **Skip the HTML report** (`--no-report`), all under "Options".
Not available in the browser: NCBI downloads (`--virus`, `--ref`, `--email`), `--consensus` and `--consensus-source`, `--samples`, `--fragments`, `--check-only`, `--threads`, `--resume`
(each with its reason in the page's collapsed "Not available in the browser" box under Notes, and in [OPTIONS_PARITY.md](OPTIONS_PARITY.md)).
For reads aligned to your own consensus, load the annotated GenBank of that consensus (the `reference/references.gb` that `srasel run --consensus …` writes; the two consensus examples in `examples/real/` ship it as `consensus_annotated.gb`), not the GenBank of a related genome: its contig names differ from the BAMs'.

Network use was checked by reading the code: every `fetch` in `app.js` / `worker.js` is a relative (same-site) URL, and the only other request is the
`import()` of `pyodide.mjs` and Pyodide's own package download from the CDN. (A Resource Timing check of the worker through puppeteer was attempted and is not available for module workers; page-level requests in Chrome were all to the local test server.)

## The page: sidebar, stepper and three screens (redesigned 2026-11-18)

One page, no reloads. A dark sidebar (logo, the three screens as `role=tablist` buttons that show a check when done, and at the bottom **Documentation** (a relative link to this file), **Examples** (goes to the demo loader of the first screen) and **About** (a dialog with the runtime versions and the links to the other modes)), and above the content a stepper **1 Input data — 2 Run analysis — 3 Results** (done / current / not yet). Arrow keys, Home and End move between the enabled screens; screens 2 and 3 stay disabled until reachable. White cards on a light grey-blue canvas, system fonts, 6 px radii, no shadows or gradients; dark mode follows the system and the Theme button. On a phone-width window the sidebar becomes a top bar. Every number the page shows is counted or measured; nothing is estimated (no percentage, no time left).

| Screen | What it holds |
|---|---|
| **1 Input data** | **A · Input files**: a drop zone (files and folders; `.bam` files become BAM inputs, `.txt`/`.tsv`/`.gz` files bam-readcount tables, anything else is reported as ignored) plus the three choosers (BAM files, BAM folder, bam-readcount tables; BAM files and tables can be mixed, never the same sample twice; choosing again adds to the list). One line per loaded file with a validation icon (empty file; a BAM must start with the BGZF header; a `.gz` table must be gzip; no date; given twice; no patient; the date it was read as and the patient), its size and **Remove**. **B · Reference & metadata**: the reference chooser (below), the dates (file or pasted text) and the editable **Samples** table. **C · Analysis parameters**: permutations, seed and minimum \|Δf\| with the real defaults and a help tooltip each (a focusable button linked with `aria-describedby`; shown on hover and keyboard focus, Escape hides it), and a collapsed **Additional options** (patient name, contig aliases, skip the HTML report). **D · Validation summary**: BAM files, tables, samples with a valid date, patients detected, reference status, and every error (red) and warning (amber) found by the same checks that decide the button. **Continue to Run analysis** stays disabled, with the first reason next to it, until the inputs are valid; it does not start anything. "Load demo", "Clear" and "Notes" (collapsed: the experimental warning, how BAM files are counted, the offline note and the options that are not available here). The Samples table: a patient or a date typed in a cell rewrites that sample's line of the dates text (`name<TAB>date[<TAB>patient]`), and any change of the text redraws the table; the text is the single source of truth the runner reads. A sample without a date is flagged, an unreadable date is flagged with the reason and **blocks Continue** (read with a copy of the engine's rules; the engine still reads the original text) and **×** drops a sample. |
| **2 Run analysis** | Before the run: a card with the inputs, a card with the parameters chosen (including the p resolution 1/(nperm+1)), **Run analysis** and **Back to input data**. While it runs: **Step k of N** with a bar of N cells, the stage list taken from the runner's `plan` (Pending / Running / Completed / Failed / Not run, each with its measured time), elapsed time, **Cancel** (terminates the worker and starts a new runtime), and a collapsed **Technical log**. On the running row, real counts only: in the counting stage "k of N samples counted" (one engine line per BAM), and in the engine's own progress bars the latest "k of N" text (for example `Analyzing P1: 1,200 of 2,828 variants`); the bar itself, its percentage and rate are dropped and never reach the log. When it ends: **Analysis finished** with **Show results**, **Back to input data** and **New analysis** (asks first), or, on a stage error, the engine's own explanation (`Stage “…” stopped`, with "Because" and "What to do") and **Back to input data**. |
| **3 Results** | A header with the metadata line (time, files, MB zipped, WebAssembly memory, and the run's own settings: permutations, p resolution, seed, minimum \|Δf\|), **New analysis** (asks first, then drops the results; the inputs stay) and **Download results (.zip)** with a menu for **Report (.html)** and **Summary (.md)**. Sub-tabs that map to the real outputs: **Overview** (counts of samples, patients analysed, tested trajectories and tagged alleles; the **Per patient** table with the 3-date and 4-date warnings; **Patients not analysed** when a patient of the inputs has no result, with its number of dates; then the report's Summary), **Variants**, **Trajectories**, **Genes**, **Quality** and **About** (the tabs of the report itself, shown in the sandboxed iframe: `sandbox="allow-scripts"`, `srcdoc`, it cannot reach the page or the network), **Tables** (the per-patient tables the page holds in memory: sticky header, sortable columns, a filter box, 100 rows per page, the engine's column wording; the downloaded table has the exact values) and **Files** (every file, each with its own download). With "Skip the HTML report" only Overview (without the report), Tables and Files remain. |

The page drives the report through its embedding contract (written at the top of the report's body). A sandboxed `srcdoc` iframe has no URL hash of its own (and cannot call `history.replaceState`), so the page uses the contract's `postMessage` form: when the report has loaded, and whenever it announces `ready`, the page sends `{type:"srasel-report", tab, embed:true, theme}`; the report then hides its own title and tab bar, opens that tab and takes the page's theme (the page sends the theme again when the Theme button is used). The report answers with `{event:"tab", tab}`, which keeps the page's sub-tabs in step when the report changes tab by itself. If an older report does not answer a tab change within 600 ms the page reloads its copy and tells it the tab again, so the page degrades instead of breaking. The report is shown exactly as it was written and the downloaded `report.html` is never modified.

**Reference chooser** (same look as the Data tab of the local page: one radio row per way, a one-line summary, the fields of the chosen one below):

| Choice | Online | What it does |
|---|---|---|
| **GenBank file(s)** (default) | enabled | One or more `.gb` files; each choice adds to the list (Remove per file), segmented virus: one file per segment, in BAM header order (with **Segmented virus** on, each line is numbered and has ↑ ↓ to reorder). As `srasel run --ref-file` |
| **FASTA and gene list** | enabled | A FASTA and a gene table (TSV with a header, or GFF3; the **Format** box explains the columns, as `srasel make-genbank -h`). The runner calls the engine stage `make-genbank --fasta F --genes G -o reference_input.gb` (its warnings go to the log), then `prepare-reference`, as `engine.build_reference` does for `--fasta/--genes` |
| **Own consensus (needs minimap2)** | disabled, with its reason | minimap2 does not run in a browser; use `srasel run` or `srasel web` |
| **NCBI accession / virus name** | disabled, with its reason | no NCBI downloads from this page; use `srasel run` or `srasel web` |
| **From the BAM headers (needs internet)** | disabled, with its reason | it downloads from NCBI; use `srasel run` or `srasel web` |

Under the radios, in both pages, the same four-line hint "Which reference do I need?" (GenBank = a sequence plus where its genes are; use the one your BAMs were aligned to; for your own consensus give its annotated GenBank `consensus_annotated.gb`, or a FASTA + gene list, or on the command line / local web the consensus plus a related annotated genome) and, online only, a tip that `consensus_annotated.gb` is what `srasel run --consensus` writes to `reference/references.gb`.
**Segmented virus** (a switch above the reference options): it only changes what the page shows and accepts. A note says what to give for a segmented genome; the file lists are numbered with ↑ ↓; and *FASTA and gene list* then takes **one FASTA and one gene list per segment** (or one of each with all the segments). The worker writes them as `/in/seg_fasta_NNN__<name>` and `/in/seg_genes_NNN__<name>` in the order of the lists, and `run_pipeline.run_in_fs` joins them with `srasel.segments` (inside the wheel; the same module the local web page uses) into the single FASTA and gene list the engine takes, so the engine runs exactly as `srasel run --fasta --genes` does. A mistake in these files (a sequence name twice, a missing column, a table mixed with a GFF3) is reported with the name of the file. Consensus and NCBI options stay disabled here.

A contig mismatch ("The contigs of your BAMs are not in the reference") now lists every contig of the loaded reference (up to 12; before only 5), so a segmented virus whose segments were not all loaded is visible at once. A typical cause is loading the RefSeq GenBank files (contigs `NC_…`) for BAMs that were aligned to a consensus (contigs `PB2`, `PB1`, …): load `consensus_annotated.gb` instead.

The list of stages comes from the runner: `run_pipeline.py` emits one `plan` event (JSON list of the stage titles that will run) before the first stage, and the page
marks each title as the matching `stage` event arrives. No progress percentages or time estimates exist anywhere; only measured seconds.
`SUMMARY.md` is written by `srasel run` only, so Browser Mode builds a short one in the page from what it knows (settings, per-patient counts, the cautions); the zip itself is unchanged.
Style: system fonts, a navy sidebar, one blue accent, 1px borders, no shadows, gradients or badges; the colours, type and spacing are tokens on `:root` in `docs/assets/site.css` (the master stylesheet; the local page carries a byte copy); dark mode follows the system and the Theme toggle (`:root[data-theme=…]`).
Memory/size warning: shown only for tables above 50 MB (tested up to about 34 MB) or BAM files above 150 MB (tested up to 116 MB).

## What runs

`browser/run_pipeline.py` contains **no scientific code**. It sets `sys.argv`, calls `engine.COMMANDS[stage][0]()` in-process and catches the
`SystemExit` that `engine.fail()` raises, with the same arguments and order as `engine.pipeline()` (steps 3-7; step 0 from the user's GenBank,
as `srasel run --ref-file`):

| Stage | Arguments (as in `engine.pipeline()`) |
|---|---|
| `prepare-reference` | `--refs <gb...> --outdir reference` |
| `integrity` | `--ref-dir reference` (reads `processing/02_rc`, `dates.tsv`) |
| `build-tables` | `<processing/03_integrity_checked/PATIENT> --ref-dir reference`, once per patient |
| `annotate` | `--tsv-dir processing/04_position_time_matrices --ref-dir reference --out-dir processing/05_annotated_tables` |
| `selection` | `<*_genes.tsv> --outdir processing/06_selection_analysis --times dates.tsv --nperm N --jobs 1 --seed S --freq-delta D --thr-clear 0.95 --first-k-min 10` |
| `report` | `--ref-dir reference --processing processing -o report.html --freq-delta D --nperm N` |

Only the way stages are launched differs (in-process instead of `[python, engine.py, stage, ...]` subprocesses; `--jobs 1`). The dates file
is read with the engine's own `read_dates_file` / `parse_dates`. The page shows the engine's own output lines and the
stage timings measured in the tab; there are no percentages or time estimates.

### Compatibility of `engine.py` with Pyodide (checked by running it)

| Item | Result |
|---|---|
| Imports (`Bio`, `Bio.Entrez`, `joblib`, `scipy.ndimage`, `tqdm.auto`, `pandas`, `matplotlib` + `Agg`, `urllib`, `subprocess`, `concurrent.futures`) | all import in Pyodide 314.0.7 (Python 3.14.2; numpy 2.4.6, pandas 3.0.2, scipy 1.18.0, biopython 1.87, matplotlib 3.10.8, joblib 1.5.3, tqdm 4.67.3) |
| `joblib.Parallel(n_jobs=1, backend="loky")` | runs sequentially in-process with `--jobs 1`; no worker processes are started |
| `cloudpickle.register_pickle_by_value` at import | `cloudpickle` is not installed; the fallback `joblib.externals.cloudpickle` is used, no error |
| `subprocess` (samtools, bam-readcount, minimap2), `ThreadPoolExecutor` | only in `run`, `transfer-annotation` and the counting step: never reached by the stages above |
| `Entrez` / `urllib` (NCBI) | only when a reference is an accession; with a `.gb` file no request is made |
| `tqdm` | writes `\r` progress lines (with a percentage) to stderr; the page discards them: only measured elapsed time is shown, no progress percentages |
| matplotlib | Agg backend, PDF plots written to the in-memory file system |

**No change to `engine.py` is needed.** (Diff proposal: none.)

## Verification

Reference: `tests/regression/golden/{phix,lcmv}` (40 tracked files each). Tables of the golden runs are stored as hashes only, so they were regenerated with
`tests/fixtures/make_bams.py` + `srasel run ... --nperm 200 --seed 1 --threads 1` (native samtools/bam-readcount); their sha256 equal those of the golden MANIFEST.
Those tables were fed to `browser/run_pipeline.py`:

| Run | Result |
|---|---|
| CPython 3.12.2 (numpy 2.5.4, pandas 3.1.0), phix and lcmv, `--nperm 200` | `compare_dirs` vs golden: 40/40 byte-identical (strict) for both |
| Pyodide under node 24, phix (10 tables, 19 MB) and lcmv (segmented, two GenBank files, 34 MiB, tables gzipped), `--nperm 200` | vs the CPython run: all files byte-identical (phix 43, lcmv 44 compared); vs golden: 40/40 strict for both |
| Same, `--nperm 2000` (CPython vs Pyodide) | all files byte-identical (phix 43, lcmv 44) |
| Real Chrome 128 (headless, puppeteer-core), static site served from a local http server, Pyodide from the jsDelivr CDN: "Load demo", "Run" (called "Run analysis" in the older one-tab page), zip downloaded through the page's button | zip contents vs CPython run: 32 files byte-identical; vs golden 30/30 strict (the 10 input tables are not in the zip) |

Not byte-comparable by construction and therefore handled explicitly by `browser/check_outputs.py`: the PDF plots (matplotlib writes `/CreationDate` and its own
version in `/Producer`; two CPython runs already differ) and `report.html`, which embeds the output path and the provenance (Python/numpy/pandas/Biopython versions and date).
For `report.html` those fields are masked and every other byte is identical.

Measurements (seconds and memory per step, real values only, with the machine) are in `browser/measurements.json`. Summary on an Intel Core i7-9750H Mac (16 GB) while another
heavy process was running (timings are indicative): Pyodide boot to "ready" 19 s under node (10 s of it is the first import of the engine and matplotlib) and 15-19 s in Chrome from the CDN (fresh profile); the phix demo (200 permutations) takes about
13 s in Pyodide against 8 s in CPython; with 2000 permutations 14 s vs 7 s (phix) and 17 s vs 9 s (lcmv). Peak resident memory of the node process: 807-910 MB in Pyodide
against 210-285 MB for CPython; the WebAssembly heap grew to 269 MB (322 MB for lcmv, 2000 permutations). Largest input tested: 34 MiB of tables.
Nothing larger was tested; beyond that, memory failures are possible (the page then reports "The browser ran out of memory" and restarts the runtime).

### Reproduce

```bash
cd browser && npm install && node fetch_pyodide.mjs            # Pyodide 314.0.7 + wheels mirrored in browser/node_modules/.srasel-cache (git-ignored)
.venv/bin/python tests/fixtures/make_bams.py --case phix --outdir <scratch>/fx
PATH=<env with samtools, bam-readcount>/bin:$PATH .venv/bin/python -m srasel run --samples <scratch>/fx/samples.tsv \
    --ref-file tests/fixtures/NC_001422.1.gb --out <scratch>/native --seed 1 --nperm 200 --threads 1 --no-report
python browser/run_pipeline.py --tables <scratch>/native/processing/02_rc --dates <scratch>/native/dates.tsv \
    --gb tests/fixtures/NC_001422.1.gb --out <scratch>/cpy --nperm 200 --seed 1                      # CPython
node browser/test_node_e2e.mjs --tables <scratch>/native/processing/02_rc --dates <scratch>/native/dates.tsv \
    --gb tests/fixtures/NC_001422.1.gb --out <scratch>/pyo --nperm 200 --seed 1 --metrics m.json      # Pyodide
.venv/bin/python -I browser/check_outputs.py <scratch>/cpy <scratch>/pyo --golden tests/regression/golden/phix
node browser/test_browser.mjs --out <scratch>/chrome --error-case                                   # real Chrome (path with --chrome)
```

## Building the site

`.venv/bin/python browser/build.py [--demo-tables DIR]` (nothing is uploaded or deployed) writes into `docs/browser/`:
`srasel-<version>-py3-none-any.whl` (only `srasel/__init__.py` and `srasel/engine.py`, taken unchanged from `src/`; 118 KB), `manifest.json` (sha256, checked by the worker
before installing), `run_pipeline.py` (copy), `config.json` (Pyodide version, CDN url, packages) and, with `--demo-tables`, `demo/` (10 gzipped tables, `dates.tsv`, `reference.gbk`;
0.9 MB; each table is verified against the sha256 of `tests/regression/golden/phix/MANIFEST.tsv`). **Rebuild after any change in `src/srasel/engine.py`**, or the site keeps serving the old engine.
Pyodide 314 only supports module workers, so `worker.js` is loaded with `{type: "module"}` and imports `pyodide.mjs` from the CDN.

Layout: `docs/index.html` (three ways to run), `docs/assets/site.css`, `docs/browser/{index.html,app.js,worker.js}`. Every link and fetch is relative, so the site works at `/` and under a project path such as `/SRASel/` (checked in the audit and by `tests/unit/test_browser_page.py`). Static files only; `docs/.nojekyll` is created for GitHub Pages.
`.gitignore` already covers `node_modules/` (which holds the Pyodide mirror and the test dependencies); it does not need new entries.

## BAM files in the browser (added 2026-11-09)

You can pick the BAM files one by one or **a whole folder** (second file box; every `.bam` inside is used, `.bai` and other files are ignored). Folder selection is a standard browser feature (`webkitdirectory`); tested in Chrome only.
If the analysis ends with no variant passing the filters (typical of tiny or low-coverage example BAMs), the page now says so (`Stage “selection” stopped`) instead of failing later in the report.

How: the page passes the `File` objects to the worker and Pyodide mounts them with WORKERFS, so a BAM is **read in place and not copied into memory**
(nothing is uploaded). `pysam` (0.23.0, htslib 1.21, Pyodide package) is loaded only when BAM files are given. After the reference is prepared (step 0), each BAM is
counted by `srasel.bamcount` into the same `<sample>_RG_readcount.txt` table that `bam-readcount` would give, and steps 3-7 run unchanged. No index (`.bai`) is needed.
The header is checked against the reference (name and length) and a BAM aligned to something else stops the run with an explanation.

Measured (Kemp, SARS-CoV-2, 8 BAMs, 116 MB, ~1.75 million reads, 2000 permutations, seed 1; this Mac, Intel, 12 cores):

| Where | Total | Notes |
|---|---|---|
| CPython, native (`browser/run_pipeline.py --bams`) | 304 s (while other jobs were running) | |
| Pyodide under node (`test_node_e2e.mjs --bams`) | 196 s | counting + steps 3-7; peak RSS 1.3 GB, WebAssembly heap 557 MB |
| Chrome 128, real page, BAMs chosen through the file input | 224 s | Pyodide and pysam from the jsDelivr CDN; WebAssembly memory 464 MB; no external hosts besides the CDN, no console errors |

* Results are the same as with `bam-readcount` tables: matrix (step 4), annotated table (step 5) and all selection tables (step 6) are byte-identical between native
  CPython with `bam-readcount`, native CPython with the pysam counter, Pyodide under node and Chrome, with **one exception**: in `variant_stats.tsv` the column `score`
  differs in the last printed digit (e.g. `-3.0853177233508364e-05` vs `-3.085317723350836e-05`) in 2 of 92 rows between native CPython and WebAssembly (floating-point
  rounding of the numeric libraries); labels, p-values, slopes and rankings are identical. Node-Pyodide and Chrome are identical to each other.
* The counter is identical to `bam-readcount` on 47 real BAMs (see [BAM_COUNTER.md](BAM_COUNTER.md)); this run is the end-to-end proof for one of those sets.

Limits (not measured): large BAMs (this is 15 MB each; a 1 GB BAM would take of the order of minutes per sample natively and more in WebAssembly, and has never been tried),
low-memory devices, Firefox and Safari, long-read data. If you have many or large BAMs, use the command line or the local web interface.

## Known limits

* Slower and more memory-hungry than CPython (roughly 1.5-2x time, 3-4x memory in the measurements above); single process only.
* Tested end to end in Chrome 128 and Firefox 130 (headless, macOS, 2026-11-10/11). Safari and Edge were **not** tested.
* The first visit downloads about 41 MB of Pyodide packages (numpy, pandas, scipy, biopython, matplotlib...) from the CDN; the browser caches them afterwards. Offline use is not supported: once the runtime is loaded, further analyses in the same tab work with the network cut (measured), but reloading the page needs the CDN again (`pyodide.mjs` cannot be fetched).
* The report is shown in an `<iframe sandbox="allow-scripts allow-downloads">` (`allow-downloads` only lets the report's own SVG/PNG/TSV buttons save a file; no origin, no other right); it can also be downloaded as a file.
* The report text is produced by the engine and may quote a permutation floor or threshold that is not the setting of this run; the metadata line of the Results screen states the real settings.

## Audit 2026-11-10/11 (validation/C_software)

Static site served by `python -m http.server` both at `/` and under a GitHub-Pages-like sub-path `/SRASel/`; the browser was forced through a proxy that
logged every remote host and refused all of them except `cdn.jsdelivr.net`, which was answered locally from the Pyodide mirror (production `config.json`
unchanged). Script: `validation/C_software/scripts/browser_audit.mjs`; results in `validation/C_software/SOFTWARE_AUDIT.md`.

* Chrome 128 and Firefox 130: demo, bam-readcount tables (Freiburg) and BAM files (Freiburg, 9 BAMs; norovirus P5, 7 BAMs) all finish. Matrices, annotated tables,
  all step-6 tables and the report data equal `srasel run` (byte-identical; one `score` value of P5 differs in the 16th significant digit); with BAM input the
  copies in `03_integrity_checked/` differ only in the two statistics columns the pysam counter does not fill (see BAM_COUNTER.md).
* Network: the page and its worker contact only the site itself and `cdn.jsdelivr.net` (23 files, 54.9 MB with pysam). During an analysis the only remote
  request is the pysam wheel, the first time BAM files are used. No user data leaves the tab.
* Sub-path `/SRASel/`: no absolute-path problem; all links resolve.
* A sample without a date now stops before the run (as `srasel run` does); dates are matched to tables/BAMs ignoring case, as `srasel run --bams` does.
  Before, a sample was dropped silently in both cases.


## Options parity with `srasel run` (2026-11-17, owner's request)

The runner now decides the samples the way `srasel run --bams … --dates … [--patient]` does: it calls the engine's own `load_samples` on empty placeholder files named after the samples, so the patient
(third column of the dates file, else `<patient>-<n>` in the name, else **Patient name**), the sample ids (`<patient>-<n>` numbered by date, replicates `P1-3a`/`P1-3b`) and every message come from the engine
(`assign_sample_ids` in `browser/run_pipeline.py`). Before, the page needed file names in the `<patient>-<n>` form and ignored a patient column, so the simulated examples (`S1_t1_repa.bam`, patient in the dates file) could not run.
`--alias` is applied when a BAM is counted: `srasel.bamcount.match_header` pairs a BAM contig with a reference contig by the engine's rule (`engine.resolve_contig` then the length rule of `engine.match_contigs`: alias, exact name,
name without version, unique length); `tests/unit/test_browser_runner_options.py` compares it with the engine on eleven header layouts. The alias is also passed to `build-tables` like `engine.pipeline()` does.
`--no-report` skips step 7; the Results tab then shows no report and disables **Report (.html)**.
What is not offered, and why, is in [OPTIONS_PARITY.md](OPTIONS_PARITY.md). Real runs through this page compared with `srasel run`: section 9 of `validation/C_software/SOFTWARE_AUDIT.md`.
