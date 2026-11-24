# Local Web Mode

`srasel web` is a browser front end for `srasel run` on your own computer. The page builds the command line, starts
`python -m srasel run ...` as a job, shows the real log, and lets you browse tables, the HTML report and downloads. It
adds no scientific code: the job is the same engine as the command line, so the results are identical (see "What was tested").

## Install and start

```
pip install -e '.[web]'                      # adds fastapi + uvicorn
export PATH=$HOME/miniconda3/envs/srasel-real/bin:$PATH   # samtools, bam-readcount (and minimap2 for --consensus)
srasel doctor                                # checks the external programs
srasel web --allowed-root /data/my_bams      # prints a one-time link; use --no-browser to open it yourself
```

Options: `--port` (default 8765, `0` = free port; if the port is taken, `srasel web` says so and stops before printing a link), `--workdir` (default `~/srasel_web_runs`, one folder per job),
`--allowed-root DIR` (repeatable; default: your home folder), `--no-browser`.

## The page

**The local page has the look and the flow of the online page** (`docs/browser/`, Browser Mode); the owner asked for it (2026-11-17 and, for the new shell, 2026-11-20). What is shared and what differs:

* **One stylesheet.** `src/srasel/web/static/site.css` is a byte-for-byte copy of `docs/assets/site.css` (the master; a unit test fails with
  "run: cp docs/assets/site.css src/srasel/web/static/site.css" if they differ). `app.css` only holds what the online page does not have: the file-browser dialog, the
  "Past analyses" panel, editable table cells and file pickers, the amber "cancelled" state, the descriptions in the download menu. There are no inline style attributes and no `innerHTML`
  (the CSP forbids the first, a unit test the second).
* **Shell.** A navy sidebar with **Input data · Run analysis · Results** (ARIA tablist, arrow keys; the later steps are disabled until they are reachable; a check mark says what is done) and, at the
  bottom, **Past analyses** (local only), **Documentation** (a short note on where the documents are), **Examples** and **About**. **Examples** opens the folder browser in the repository's `examples/`
  folder; it is disabled, with the reason as its tooltip, when that folder does not exist inside an `--allowed-root`. At the top: the stepper (1 Input data, 2 Run analysis, 3 Results), the tools status
  ("samtools · bam-readcount ready") and Theme. On a phone the sidebar becomes a strip at the top.
* **1 Input data** has four cards and ends with **Continue to Run analysis**, which starts nothing: it is disabled while anything is missing or wrong, and the reason is the line beside it (the validation card
  lists every problem in red, every warning in amber and what is still to do in grey).
  *A · Input files*: **Choose BAM files** and **Choose BAM folder** (the server-side file browser, limited to `--allowed-root`; Shift+click selects a range; the folder is searched recursively,
  `GET /api/bams/scan`), **Add manually** (type or paste full BAM paths, one per line; each is checked by `POST /api/bams/check`) and **Load samples table** (`bam`, `patient`, `date`[, `fragment`]).
  **BAM files cannot be dropped on the page**: the server reads them where they are and has no way to receive them, so the page says so instead of showing a drop zone that would not work (the online page
  receives dropped files in the browser; here that is impossible by design). *Clear* empties the inputs.
  *B · Reference & metadata*: the reference options in the online order, all of them real controls: **GenBank file(s)** (one per segment, passed in the order of the list), **FASTA and gene list**
  (two pickers, a collapsed format box with an example and a "Download an example" button), **Own consensus** (consensus FASTA + annotated GenBank file(s), accession(s) or a virus name for the genes; needs minimap2),
  **NCBI accession / virus name** (with an optional contact e-mail; needs internet) and **From the BAM headers** (the engine downloads the records named in the BAM headers or stops and says why). A **Segmented virus** switch above the options shows a note and the per-segment inputs: the lists of files are numbered with ↑ ↓ arrows, and *FASTA and gene list* takes one FASTA and one gene list per segment (or one of each with all of them). The server joins them in the order of the lists (`srasel.segments`, written to `<job>/inputs/all_segments.fa` and `all_segments_genes.tsv|gff3`, with `joined_from.txt` listing the order) and runs `srasel run --fasta ONE --genes ONE` as always; nothing else changes. The request has `reference.segmented` (informational) and, for this case, `fasta_files` / `genes_files` instead of `fasta` / `genes`. Under the
  options, the hint "Which reference do I need?" (the same words as the online page). *Dates*: **Choose dates file** (its text appears in the box, editable), the paste box (read with the engine's own
  `read_dates_file`), and each date cell of the table is editable; dates are joined to the BAM names also when the files are added afterwards. *Samples*: Sample · Patient · Date · (Fragment) · Input, patient and date
  editable, each row can be removed, **Add row** opens the manual box, **Apply** fills one patient name into every row that has none. Next to each date the way the engine read it ("→ 2020-03-23", "day 7") or why not;
  below the table the count and the notes about replicates and patients with fewer than 3 dates. Rows with no date or an unreadable date are listed first.
  *C · Analysis parameters*: Permutations, Seed, Minimum |Δf| and Threads, each with a "?" that shows its definition (hover or keyboard focus; the same words as online for the first three). **Additional options** (collapsed):
  **Skip the HTML report** and **Advanced** (one BAM per genome fragment with the Fragment column and an optional fragments table or GenBank; contig aliases).
  *D · Validation summary*: BAM files, samples with a valid date, patients, reference, and the list of problems.
* **2 Run analysis** first shows what will be run: a summary of the inputs and of the parameters (with the p resolution 1/(nperm+1)), then **Run analysis** (the big button), **Check inputs** (`--check-only`: it
  verifies that the contigs of the BAMs match the reference and stops before counting; it is a real job with three stages) and **Back to input data**. While the analysis runs the same screen shows
  **Step k of N** with one segmented cell per stage, the stage list from the titles the engine prints (`[1] Samples and BAMs`, `[2] Reference`, `[3] …`, `Step 2 · …`, `Steps 3-5 · …`, `Step 6 · …`, `Step 7 · …`;
  `GET /api/jobs/ID` returns them as `plan`), each as Pending / Running / Completed / Failed / Cancelled / Not run with the **measured** time (`stage_times`: the server notes when each title first appears in the
  log), the total elapsed time and **Cancel** (asks first, stops the whole process group). The only finer progress that exists is real and is the only one shown: Step 2 prints one line per counted sample, so its
  row says "k of N samples counted" (`counted` and `to_count` in the job status; N is left out when samples have several fragment BAMs, where the number of BAMs is not the number of samples). Steps 3-5, 6 and 7 print
  nothing until they end (their output is captured), so while one runs the row says that the engine prints nothing and shows only the elapsed time; there is no percentage, no remaining time and no progress bar element.
  When it ends: **Show results** (the page stays on this screen until you click), **Back to input data**, **New analysis** (back to the inputs, nothing is discarded: the analysis stays in Past analyses); after a check,
  **Run analysis** and **Back to input data**. A failed run shows the engine's `[ERROR]` block and, when the problem is a known one, a plain sentence "What this means" (for instance for contig names that do not match the reference);
  a cancelled run is shown in amber (it was your action) and an interrupted one (the server stopped) in red, each with its INCOMPLETE note and the files it left. A failed, cancelled or interrupted analysis (not a check) also offers
  **Resume this analysis**: it runs the same command again in the same folder with `--resume`, exactly as on the command line (counts and stages finished with the same inputs and parameters are reused, the log says so, the
  rest is redone; reused samples count in "k of N"). The earlier log is kept as `run.before-resume-N.log`; the page shows the new one. The **Technical log** (collapsed) has the log and the command that was run.
* **3 Results** has a header with the one-line metadata (analysis id, time, files, the run's own settings), **New analysis** and a **Download results (.zip)** split button, then the sub-tabs of the online page:
  **Overview** (four numbers; a "Patients not analysed" box built from the engine's `SUMMARY.md` and showing each reason as written there, e.g. "S3: 2 date(s) (>= 3 needed)"; the Per patient table; "How to read
  these results"; and the report's own Summary below), **Variants**, **Trajectories**, **Genes**, **Quality**, **About** (the report's tabs: the page shows the report in a sandboxed iframe and drives its tab through the
  report host contract, `#tab=<id>&embed=1`, see `docs/CHANGES_PACKAGING.md`), **Tables** (every table of the analysis; the results per patient first; sticky header, click a header to sort, a filter box and a **Rows per page** choice of 25 / 50 / 100 (default) / 200, all
  done by the server, which accepts a page size of 1 to 500 and refuses anything else; the displayed values are rounded for reading and **the downloaded file has the exact values**) and **Files** (every file of the analysis with its own Download and the text of `SUMMARY.md`; the figure PDFs are listed first under a **Figures (PDF)** heading, a chip shows only them, and a filter box narrows the list).
  There is no separate Plots box any more: the engine writes its static figures **as PDF only** (one genome figure per patient and one figure per tagged position); there are no PNG or SVG files, and the interactive figures are in the report. The report's own
  buttons (SVG, PNG, TSV) work inside the iframe: its `sandbox` is `allow-scripts allow-downloads`, which only lets the report save a file and gives it no origin and no other right.
  **Downloads:** the primary button and "Results (.zip)" in the menu give the report, `SUMMARY.md`, the tables of steps 4 to 6, the reference and the logs, **without** the raw bam-readcount tables
  (`out/processing/02_rc`) and their integrity copies (`out/processing/03_integrity_checked`), which are most of the size (634 MB on disk for Freiburg + Kemp, 10 MB zipped without them, 31 MB with them);
  "Everything (.zip)" is the whole analysis folder. The menu also has "Report (.html)" and "Summary (.md)". Opening a finished analysis from Past analyses lands on Results; any other lands on Run analysis. After a reload of the page the last analysis and screen come back, unless you click, touch or press a key first: the restore then stops, so it never overrides what you are doing (the analysis stays in Past analyses).

Intentionally different from the online page: the server-side file browser instead of the browser's file pickers (BAMs are never uploaded and cannot be dropped), typed paths, editable cells, the reference
options that need NCBI or minimap2, threads, fragments, Check inputs, Resume, Past analyses, Examples that opens a folder browser (there is no demo button: the examples are real BAM files), a confirmation before Cancel
(a local run can take hours), server-side tables, and tool versions instead of runtime versions in About.

Parameters (`--nperm`, `--freq-delta`, `--seed`, `--threads`, `--email`, `--alias`, `--no-report`, `--check-only`)
start from the real defaults of `srasel run`, read from its parser (never copied by hand). `GET /api/status` advertises the accepted ranges: `nperm` 100 to 100000, `seed` 0 to 2147483647, `jobs` 1 to the CPU count and
`freq_delta` as `{"gt": 0, "le": 1}` (0 is refused; the page itself steps and stops at 0.001 like the online page). The job always receives the samples as explicit rows (`samples`), i.e. `srasel run --samples`;
the API still accepts a BAM folder plus dates file (`bams` + `dates_file`) and a samples file (`samples_file`).

### Read-only endpoints behind "choose your data"

| Endpoint | What it does | Limits |
|---|---|---|
| `GET /api/bams/scan?path=DIR` | `.bam` files of DIR (subfolders too) with guessed patient, size, relative path | DIR resolved (symlinks followed) inside `--allowed-root`; `..`, NUL/control characters, leading `-` refused; links pointing outside are not listed; at most 2000 files (`truncated: true`), 50 000 directory entries visited |
| `POST /api/dates/read` `{file}` or `{text}` | rows (BAM name, date as written, optional patient) read with the engine's `read_dates_file` | file inside the allowed folders or an upload ref, text file ≤ 512 KB (pasted ≤ 256 KB), ≤ 2000 lines |
| `POST /api/dates/check` `{dates:[…]}` | interprets dates with the engine's `parse_dates`: per row `ok`/`shown`/`error`, plus `set_error` and `warnings` | ≤ 2000 strings of ≤ 32 characters in the same character set the job accepts; the engine output is captured under a lock |
| `POST /api/samples/read` `{file}` | rows of a samples table, each BAM resolved inside the allowed folders | same file rules as above; a BAM outside the allowed folders, missing or not `.bam` refuses the whole table |
| `POST /api/bams/check` `{paths:[…]}` | one verdict per typed BAM path ("Add manually"): `ok`, `name`, `size`, guessed `patient`, or `error` | 1 to 200 absolute paths of at most 4096 characters; resolved (symlinks followed) inside `--allowed-root`; `..`, NUL/control characters, leading `-` refused; must exist and end in `.bam`; nothing is opened or read |
| `POST /api/jobs/ID/resume` | runs the stored command of a failed, cancelled or interrupted analysis again with `--resume` (HTTP 202; `409` if it is running, finished, a check, or its stored command is not the one this server built; `429` at the job limit) | the request carries nothing but the id (a body is ignored); the command is re-checked (`python -m srasel run … --out <job>/out`); a `srasel run` that the server lost after a hard kill and that is still alive blocks it |
| `GET /api/jobs/ID/zip?scope=results\|all` | a finished or stopped analysis as one streamed zip. `scope=results` (the default) = the report, summary, tables of steps 4 to 6, reference and logs, without `out/processing/02_rc` and `out/processing/03_integrity_checked` (`srasel_<id8>.zip`); `scope=all` = the whole job folder (`srasel_<id8>_everything.zip`) | only what "All files" lists: regular files inside the job folder, never `out/work`, symlinks or `.tmp`; any other `scope` is refused with 400; refused (409) while the job runs |
None of the first five starts a job or writes anything but a temporary file for pasted dates (deleted at once). Every response is plain data; the page
inserts file names, patients and dates with `textContent` only (no `innerHTML` anywhere in `app.js`; a unit test checks it).

A job folder contains `out/` (the `--out` of the run: `SUMMARY.md`, `report.html`, `processing/...`), `run.log`
(stdout + stderr), `samples.tsv` and `job.json`. If a job fails or is cancelled, `out/INCOMPLETE.txt` says at which stage.

## What the page shows (and does not)

* The log exactly as printed, the stage titles copied from it, `[ERROR]` blocks as printed, warnings (`⚠`, `[AVISO]`).
* Elapsed time is the measured wall-clock time. There is no progress percentage and no time estimate: the run time depends
  on the number of variants and the page does not invent it.
* Results: summary, the HTML report (sandboxed iframe), sortable/filterable tables, every file as a download. The engine's static figures are PDF files (listed under Files); the interactive
  figures are in the report. No PNG or SVG files are written by the engine.

## Security model

* Binds to `127.0.0.1`. Another address is refused unless `--i-understand-the-risk` is given (not recommended: plain HTTP).
  Even then, the Host check only accepts `127.0.0.1`, `localhost`, `[::1]` and the address given with `--host`: with `--host 0.0.0.0`
  a request to the machine's LAN address is refused with 403 (measured 2026-11-10), so the interface is still only usable locally.
* One-time token in the start link, exchanged for an `HttpOnly; SameSite=Strict` session cookie (named with the port, so two
  instances do not overwrite each other). A second client cannot reuse the link. Sessions live in memory only.
* `Host` must be `127.0.0.1`, `localhost` or `[::1]` with the server port (anti DNS rebinding). Non-GET requests need a
  matching `Origin`; a GET with a foreign `Origin` is refused.
* Files: only inside `--allowed-root`, after resolving symlinks; `..`, NUL/control characters and leading `-` are refused.
  Symlinks that point outside the allowed folders are hidden in the browser and refused in jobs; for a BAM folder every `.bam`
  found is checked one by one.
* The job command is a Python list (`shell=False`), built from a strict whitelist (pydantic `extra="forbid"`, regexes for
  names, bounded numbers). Nothing from the browser is ever a free command-line fragment.
* Uploads: only small text files (extensions `.tsv .txt .csv .gb .gbk .gbff .fa .fasta .fna .fas .gff .gff3`), at most 20 MB,
  binary content (NUL bytes) refused, stored under a random id with a sanitized name. BAMs are never uploaded: they are read in place.
* Downloads/tables/images only inside the job folder (symlinks resolved), always `Content-Disposition: attachment` for downloads,
  `nosniff`. JSON request bodies are limited to 4 MB while streaming.
* CSP: the app only loads its own scripts/styles (no CDN, nothing from the internet). The report is shown in an iframe with
  `sandbox="allow-scripts allow-downloads"` and a response CSP (`sandbox allow-scripts allow-downloads; connect-src 'none'`), so it cannot reach the application or the network
  (`allow-downloads` lets its own SVG/PNG/TSV buttons save a file and nothing else; there is no `allow-same-origin`).
* Cancel signals the whole process group (SIGTERM, then SIGKILL after 8 s, then a final sweep of the group); the group is never
  signalled once the leader has exited (the pid could be reused). Stopping the server cancels the running jobs.
* At most 2 jobs run at the same time; `--threads` is limited to the CPU count, `--nperm` to 100-100000.

## Limits

* Everything is served over plain HTTP on the loopback interface. Browsers share cookies between ports of the same host, so do not
  open untrusted web servers on other `127.0.0.1` ports while a session is open. Stop the server when you are done.
* If the server is killed hard (SIGKILL), its jobs keep running in their own session; on the next start they are listed as "interrupted".
* The start link works once. If you lose the session, restart `srasel web`.
* Tables larger than 64 MB are not shown in the page (download them). Uploaded files are not deleted automatically.
* `srasel run` itself talks to NCBI when you choose a virus name or accession; with own GenBank/FASTA everything is offline.
* Not tested on Windows; process-group handling is POSIX only.

## What was tested

* `.venv/bin/python -m pytest tests/unit -q` (with samtools/bam-readcount on `PATH`): Web tests are in
  `tests/unit/test_web_api.py`, `test_web_security.py`, `test_web_hardening.py`, `test_web_inputs.py` (the folder scan, dates and samples endpoints, positive and negative cases), `test_web_static_texts.py` (three steps, tab 3 only through "Show results", no disclaimer sentences, gene-list format box, no `innerHTML`, ids used by the audit driver) (command construction against the real parser,
  stage titles against the engine source, Host/Origin/cookie/token, path traversal, symlinks, uploads, limits, cancel of a process
  group with a child that ignores SIGTERM) and one real run of the synthetic phiX fixture through the HTTP API.
* Real run through a live `srasel web` (phiX fixture, `--nperm 200 --seed 1 --threads 1`): the job output equals
  `tests/regression/golden/phix` with `compare_dirs(...).strict_ok == True` (40 files byte-identical).
* A wrong GenBank produced a real `[ERROR]` block that the page shows; a real cancel during stage 6 left no orphan process.
* The page was driven in headless Chrome (form, server-side file browser, job log, results, sandboxed report): no console errors or CSP violations.

## Audit 2026-11-10 (validation/C_software)

Live server, real HTTP, real data (`sars2_freiburg`, 9 BAMs, seed 1, 2000 permutations, `--threads 4`), driven through the page in headless Chrome 128
(`validation/C_software/scripts/web_audit.mjs`) and probed with `web_security_probe.py` (216 requests). Results are in `validation/C_software/SOFTWARE_AUDIT.md`.
The job's tables, matrices and report data are byte-identical to `srasel run` on the command line (34/34 files; `SUMMARY.md` differs only by the output path).
Fixed in that audit: a deeply nested JSON body gave HTTP 500 (now 400); a consensus could not use a local GenBank as gene source (now it can);
a second `srasel web` on a busy port printed a useless link; `INCOMPLETE.txt` said "was was cancelled".

## Page redesign 2026-11-13 (flow "folder, dates, reference")

Re-checked with the new page (headless Chrome through the real UI, `web_audit.mjs` updated to the new ids): Freiburg (9 BAMs, seed 1, 2000 permutations,
4 threads) run from a chosen folder + dates file + GenBank. Compared with `srasel run` on the command line (same options): all tables and matrices
byte-identical (44 files; only `SUMMARY.md`, `commands.log` and `report.html`, which hold the output folder name, and the PDF plots, which hold their creation time,
differ). The norovirus P20 consensus run with a local GenBank source, started from the page: 45 files identical to the command line, 1156 variants, 587 tagged. A wrong GenBank
shows the engine's `[ERROR]` block; cancel during step 6 leaves no process; stop and restart keep the three analyses. `web_security_probe.py` now also covers the four
new endpoints (263 requests, 0 unexpected). File names with HTML or shell characters appear as literal text in the table and no dialog opens.

## Three-step page 2026-11-13 (owner's requests)

Tabs 1 Data → 2 Run → 3 Results; past analyses in a header popover; FASTA + gene list made explicit; the e-mail only under "Download from NCBI";
the sentences on multiple testing and "not proof of selection" (and the "(uncorrected)" label) removed from this page. Checked through the real page
in headless Chrome (`web_audit.mjs`, updated for the new ids): Freiburg (9 BAMs, seed 1, 2000 permutations, 4 threads, GenBank) — while running tab 2
is shown and tab 3 is disabled; when finished the page stays on tab 2 with "Analysis finished in 43 s" and "Show results"; tab 3 opens only with that
button. Output against `srasel run` on the command line (`browser/check_outputs.py`): 63 of 64 files byte-identical, `SUMMARY.md` differs only by the output
path (PDFs not compared, report.html compared after masking the path). Wrong GenBank: `[ERROR]` block on tab 2, "Back to data", 11 files listed, tab 3
disabled. Cancel during step 6: no process left. Stop/restart: the three analyses are listed again. Past analyses: finished → tab 3, failed and cancelled → tab 2.
FASTA + gene list chosen with the two pickers (FASTA and a 6-row table, ORF1ab in two pieces, S, E, M, N, written from `NC_045512.2.gb`): the job received
`--fasta` and `--genes` and finished (48 s); the same 8 tagged alleles at 7 positions as with the GenBank, but annotation files differ because the list has fewer
genes (no ORF3a, ORF6, ORF7a/b, ORF8, ORF10). `web_security_probe.py`: 263 requests, 0 unexpected.

## Page identical to the online page 2026-11-17 (owner's request)

The local page was rebuilt on the online page's markup and stylesheet (see "The page"). Added: `POST /api/bams/check`, `GET /api/jobs/ID/zip`, the stage plan and the measured
stage times in the job status, several annotated GenBank files for an own consensus (one per segment, e.g. influenza). Checked through the real page in headless Chrome with
`web_audit.mjs` and `web_security_probe.py` (both updated for the new ids and endpoints); results of that run are in the report of the change.


## Option parity with the command line 2026-11-17 (owner's request)

Every option of `srasel run` is reachable from this page or listed, with the reason, in [OPTIONS_PARITY.md](OPTIONS_PARITY.md); `tests/unit/test_options_parity.py` fails when a new option of
the engine is not classified there, and for every option the page offers it builds the command the job would run and reads it back with the real `srasel run` parser (the parsed value must be the value asked for).
Added: **Resume this analysis** (`POST /api/jobs/ID/resume`, tests in `tests/unit/test_web_resume.py`, probes in `web_security_probe.py`). The real runs that prove each control work like the command line are in section 9 of
`validation/C_software/SOFTWARE_AUDIT.md`.

## Redesign phase 3 (2026-11-20): shell and flow of the online page

The local page was rebuilt on the online page's new shell (sidebar, stepper, cards A to D, run box, results sub-tabs). Changes outside the page: `GET /api/jobs/ID/zip` takes `scope=results|all` (default results);
`/api/status` advertises the Δf range as `{"gt": 0, "le": 1}` and the `examples` folders inside the allowed roots; `GET /api/jobs/ID` adds `counted` and `to_count` (Step 2) and the job params record `fragmented`;
the report response and the iframe allow downloads (see above). Verified through the real page in headless Chrome (`validation/redesign/screenshots_after_local.mjs`): Freiburg + Kemp from a chosen folder, dates file and
GenBank (FRB 52 / 8, KEMP 86 / 9; `validation/redesign/compare_outputs.py` against the command-line baseline: PASS, tables byte-identical, report data identical), the simulated phiX analysis (S3 listed under "Patients not analysed"),
the influenza consensus flow (FLU 17 / 4), the RefSeq GenBank error with its hint, Check inputs, Cancel then Resume (the resumed output also PASS), both zips, a report download button inside the iframe, keyboard use, a 390 px phone and the dark theme.
Browser tests: `tests/unit/test_local_ui_chrome.py` drives the page against a real server with a recorded engine.

### Follow-up 2026-11-21 (acceptance audit)

Rows per page restored in Tables (server-validated 1 to 500); figure PDFs grouped under "Figures (PDF)" with a chip in Files; the restore after a reload no longer overrides a user action; tooltips are placed by CSS classes (left-aligned, right-aligned near the right edge, bottom sheet on a narrow window) instead of a script-set style, so the page sets no style from script at all.
