# The two web pages: online page and local page

SRASel has two web interfaces. They look the same (a left menu with **Input data · Run analysis · Results**) and run the **same analysis code** as `srasel run`.

| | **Online page** | **Local page** (`srasel web`) |
|---|---|---|
| Address | `https://<USER>.github.io/SRASel/` (it opens the app directly) | printed by `srasel web`, `http://127.0.0.1:8765/?token=…` |
| Install | nothing: a recent Chrome | the `srasel` conda environment ([README](../README.md#3-installation)) |
| Input | BAM files **or** bam-readcount tables | BAM files |
| Reference | GenBank file(s) · FASTA + gene list | GenBank file(s) · FASTA + gene list · own consensus · NCBI accession / virus name · from the BAM headers |
| Where it runs | inside your browser tab (WebAssembly) | on your computer, full speed, all cores |
| Do my files leave my computer? | **No.** | **No.** |
| Status | experimental | tested |

On every data set tested the local page gives tables byte-identical to the command line, and the online page gives identical tables and labels (the `score` column can differ in its last printed digit, relative difference about 1e-16, because of WebAssembly arithmetic). `srasel run` is the reference for everything below.

## Online page

Open `https://<USER>.github.io/SRASel/` (`<USER>` is the GitHub account that hosts the repository). The older page that explains the three ways to use SRASel is at `https://<USER>.github.io/SRASel/ways/`.

**Try the demo.** The menu entry **Try the demo** (and the **Load demo** button on *Input data*) loads a **simulated** phiX174 example: 2 fictional patients (P1, P2), 10 samples, already-counted tables. It is not one of the folders of `examples/`. Then **Continue to Run analysis** and **Run analysis**; it takes about a minute.

**Inputs.** BAM files or a whole BAM folder (drag them onto the page, or use **Choose BAM files** / **Choose BAM folder**), or bam-readcount tables instead of BAMs (`<sample>_RG_readcount.txt`, optionally `.gz`: the output of `bam-readcount -q 20 -b 20 -w 0`, which `srasel run` leaves in `processing/02_rc/`; they are faster). BAM files and tables can be mixed, never for the same sample. BAMs must be coordinate-sorted; an index is not needed. Then:

* **Reference**: **GenBank file(s)** or **FASTA and gene list** (format explained in the page and in [INPUT_FORMATS.md](INPUT_FORMATS.md#6-gene-list---genes-with---fasta)). **Own consensus**, **NCBI accession / virus name** and **From the BAM headers** are shown greyed out with the reason: they need `minimap2` or the internet, which a browser tab cannot use for your data. For reads aligned to your own consensus load the annotated consensus (`reference/references.gb` written by `srasel run --consensus`; the two consensus examples ship it as `consensus_annotated.gb`), not the GenBank of a related genome.
* **Dates**: a dates file or pasted text, any format `srasel run` accepts ([INPUT_FORMATS.md](INPUT_FORMATS.md#4-dates)). The **Samples** table shows every sample with its patient and date, all editable; next to each date the page shows how it was read (`→ 2020-03-23` or `day 7`). Rows with a missing or unreadable date come first and block the next step.
* **Analysis parameters**: **Permutations** (`--nperm`, 10 to 100000, default 2000), **Seed**, **Minimum |Δf|**. Under *Additional options*: **Patient name**, **Contig aliases** and **Skip the HTML report**.
* **Validation summary** lists in red what must be fixed, in amber warnings, in grey what is missing. **Continue to Run analysis** starts nothing; the line next to it says why it is greyed out.

**Run analysis** shows the real steps of the pipeline with their measured time and *k of N samples counted*; there is no percentage or time estimate because the program cannot know them in advance. **Cancel** stops it.

**Results** has **Overview · Variants · Trajectories · Genes · Quality · About** (the tabs of the report, see [RESULTS.md](RESULTS.md)), **Tables** and **Files**, and **Download results (.zip)** (report, summary, tables, reference). The online page builds a short summary itself because `SUMMARY.md` is written by `srasel run` only.

**What is computed in the tab.** The real SRASel stages run in the browser with [Pyodide](https://pyodide.org) (Python compiled to WebAssembly) inside a Web Worker. BAM files are read in place and counted with pysam by the same rules as `bam-readcount` ([BAM_COUNTER.md](BAM_COUNTER.md)); the stages then run in the order of [CLI.md](CLI.md#pipeline-stages-what-srasel-run-does) from step 3 on. The page ships a small wheel with four modules of the package (`__init__`, `engine`, `bamcount`, `segments`; about 139 KB, its sha256 is in `docs/browser/manifest.json` and is checked before installing); the CLI and the local page are not in it.

**Privacy and network.** Your files are never uploaded: tables, dates and the reference live in the tab's memory. The only requests are the page's own files and the download of the Pyodide runtime and its libraries from `cdn.jsdelivr.net` (Pyodide 314.0.7, versions pinned in `docs/browser/config.json`): about 50 MB the first time (54.9 MB measured, including pysam when BAM files are used), cached by the browser afterwards. The page needs internet each time it loads; once loaded, further analyses in the same tab work with the network cut.

### Limits of the online page

* Tested up to about 34 MB of tables or 116 MB of BAM files; the page warns above 50 MB of tables or 150 MB of BAMs. It needs a lot of memory (4 patients and 34 BAMs used 2.2 GB) and runs one analysis at a time, in a single process.
* It is slower than the command line (roughly 1.5 to 2 times the time and 3 to 4 times the memory of the same analysis in CPython in the measurements; for example 8 BAMs of SARS-CoV-2, 116 MB, 2000 permutations: 224 s in Chrome, peak WebAssembly memory 464 MB).
* Tested in Chrome 128 (full) and Firefox 130; Safari and Edge were not tested.
* The report is shown in a sandboxed frame (`sandbox="allow-scripts allow-downloads"`); it cannot reach the page or the network.
* Not offered, with the reasons, in the table below.

## Local page

```bash
conda activate srasel
srasel web --allowed-root /path/to/the/folder/with/your/data
```

It prints a link and opens your browser. **The link works once**: if you lose the page, stop the program (Ctrl+C) and start it again. If the port is busy `srasel web` says so and stops before printing a link.

| Option of `srasel web` | What it does |
|---|---|
| `--allowed-root DIR` | folder (and subfolders) the file browser and the jobs may read; repeatable; **default: your whole home folder** |
| `--port N` | port, default 8765 (`0` = a free one) |
| `--workdir DIR` | where each analysis gets its folder, default `~/srasel_web_runs` |
| `--no-browser` | only print the link |
| `--host H`, `--i-understand-the-risk` | another address than `127.0.0.1` is refused unless the second flag is given (plain HTTP; not recommended) |

**Input data.** *A · Input files*: **Choose BAM files** or **Choose BAM folder** open a file browser on your computer (restricted to the allowed folders; Shift+click for a range; a folder is searched recursively); **Add manually** takes full paths, one per line; **Load samples table** loads a `bam / patient / date` table. BAM files cannot be dropped on this page: the server reads them where they are. *B · Reference & metadata*: pick one reference option, then the dates; the **Samples** table is editable and **Apply** puts one patient name into every row that has none. *C · Analysis parameters*: **Permutations** (100 to 100000), **Seed**, **Minimum |Δf|** and **Threads**; *Additional options* hold **Skip the HTML report** and *Advanced* (one BAM per genome fragment, contig aliases).

**Run analysis.** **Check inputs** runs only the checks and stops before counting (`--check-only`): a good first step with new data. While running you see the real steps, *k of N samples counted* and **Cancel** (it asks first). A failed run shows the engine's message and often a plain sentence about what it means; a failed, cancelled or interrupted analysis offers **Resume this analysis**, which runs the same command again in the same folder with `--resume`.

**Results** has the same sub-tabs as the online page. **Tables** shows every table with search, sorting and paging (the downloaded file always has the exact values). **Files** lists every file with a download button; the PDF figures come first. **Download results (.zip)** holds the report, `SUMMARY.md`, the tables of steps 4 to 6, the reference and the logs; **Everything (.zip)** also holds the raw count tables (much bigger). **Past analyses** (left menu) keeps every earlier analysis so you can reopen it. **Examples** opens the folder browser in the repository's `examples/` folder (enabled when that folder is inside an allowed folder): choose the `bams/` folder of **one** example, then its `dates.tsv` and its GenBank file.

### Limits and security of the local page

* It listens only on `127.0.0.1` and checks the `Host` and `Origin` headers; the start link carries a one-time token exchanged for a session cookie. Everything is plain HTTP on the loopback interface, so stop the server when you are done and do not open untrusted web servers on other `127.0.0.1` ports while a session is open.
* Files are used only inside `--allowed-root` (symlinks resolved; `..` and control characters refused). BAMs are never uploaded; only small text files (dates, GenBank, FASTA, gene lists; at most 20 MB) can be uploaded.
* The job command is built from a strict whitelist as an argument list, never as a shell string. At most 2 jobs run at the same time; `--threads` is limited to the number of cores.
* The report runs in a sandboxed frame with its own content-security policy: it cannot reach the application or the network.
* If the server is killed hard, its jobs keep running and are listed as "interrupted" at the next start. Tables above 64 MB are not shown in the page (download them). Uploaded files are not deleted automatically.
* `srasel run` itself talks to NCBI when you choose a virus name, an accession or the BAM headers; with your own GenBank or FASTA everything is offline.
* Tested on macOS and Chrome; not tested on Windows (process-group handling is POSIX only).

## Segmented viruses in the web pages

Turn on **Segmented virus** (a switch above the reference options) when your virus has several segments (influenza, LCMV, rotavirus…). It shows a note on what to give for each option, numbers the file lists and adds **↑ ↓** arrows to put the segments in order. *FASTA and gene list* then accepts **one FASTA and one gene list per segment**, or one of each with all the segments; the page joins them in the order of the lists into the single FASTA and gene list that `srasel run --fasta --genes` takes, exactly as `cat` would, and stops with the name of the file if a sequence name appears twice, a gene list lacks a required column, or a table and a GFF3 are mixed. For GenBank files, accessions and consensus the switch only changes what the page shows: the command it runs is the same. The command line takes one FASTA and one list (join them with `cat`); the rules are in [INPUT_FORMATS.md](INPUT_FORMATS.md#5-reference).

## Every option of `srasel run` in the two pages

Where the three agree the result is the same: the local page runs `srasel run` itself and the online page calls the engine's own stage functions. `tests/unit/test_options_parity.py` reads this table: every option of the real parser must appear here, and for every option the local page offers, the command the page would run is read back by the real parser and must contain the value that was asked for.

| `srasel run` | Local page | Online page | Note |
|---|---|---|---|
| `--samples` | **Load samples table**, or add rows by hand; the page always runs the job with `--samples` | not available | Online, name the files `<patient>-<n>` or give the patient as a third column of the dates file |
| `--bams` | **Choose BAM files**, **Choose BAM folder**, **Add manually** | **Choose BAM files**, **Choose BAM folder**, drag and drop | Online the BAMs are read in the tab and counted with pysam instead of `bam-readcount` |
| `--dates` | **Choose dates file**, the paste box, or type each date in the table | the same | Same formats and same reader as the command line; a third column gives the patient |
| `--patient` | the Patient column; **Apply** fills one name into every row that has none | the Patient column; **Apply** or **Patient name** under *Additional options* | only for files not named `<patient>-<n>` and with no patient in the dates file |
| `--virus`, `--ref` | **NCBI accession / virus name** | not available (shown disabled) | needs internet; use `srasel run` or `srasel web` |
| `--ref-file` | **GenBank file(s)** (one per segment) | **GenBank file(s)** | segmented virus: one file per segment, in BAM header order |
| `--fragments` | *Additional options* → *Advanced*: **Each sample is several BAM files** | not available | |
| `--fasta`, `--genes` | **FASTA and gene list** | **FASTA and gene list** | online the runner calls `make-genbank` then `prepare-reference`, as the engine does |
| `--consensus`, `--consensus-source` | **Own consensus** (FASTA + GenBank file(s), accession(s) or a virus name) | not available (shown disabled) | needs `minimap2`; online, load the annotated consensus as the GenBank file |
| `--alias` | *Advanced* → **Contig aliases** | **Contig aliases** under *Additional options* | `BAM_NAME=REFERENCE_NAME`, one per line |
| `--out` | not needed | not needed | each analysis has its own folder (local) or comes as one zip (online) |
| `--email` | under **NCBI accession / virus name** | not available | only used for NCBI downloads |
| `--threads` | **Threads** | not applicable | the online page runs one process; threads do not change the results |
| `--nperm` | **Permutations** (100 to 100000) | **Permutations** (10 to 100000) | |
| `--freq-delta` | **Minimum \|Δf\|** | **Minimum \|Δf\|** | |
| `--seed` | **Seed** | **Seed** | |
| `--check-only` | **Check inputs** next to *Run analysis* | not available | the checks use `samtools` |
| `--no-report` | **Skip the HTML report** | **Skip the HTML report** | the tables are the same |
| `--resume` | **Resume this analysis** | not available | nothing is kept between runs in a tab |
| `--yes` | always passed | not needed | analyses started from a page never ask anything |

**Why the online page cannot offer some options.** NCBI downloads (`--virus`, `--ref`, `--email`, *From the BAM headers*): the page sends nothing of your data over the network. Gene transfer to a consensus (`--consensus`, `--consensus-source`): it needs `minimap2`, a native program. `--samples` and `--fragments`: a browser has no file paths. `--check-only`: the checks use `samtools`; the online page stops with the engine's explanation if a BAM does not fit the reference. `--threads`, `--resume`: one process, nothing kept between runs.

**Known differences that are not options.** Online with BAM input the counts are made with pysam, not `bam-readcount`: identical except for two unused statistics columns of `processing/03_integrity_checked/*.readcounts.tsv` and, rarely, the last digit of `score` ([BAM_COUNTER.md](BAM_COUNTER.md)). The online page does not run the `samtools` checks of step `[3]`. The local page has no demo button: use **Examples**.
