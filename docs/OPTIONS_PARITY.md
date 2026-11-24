# Options: command line, local web page, online page

`srasel run` has 23 options. This table says where each one lives in the two web interfaces and what is different. It is checked by
`tests/unit/test_options_parity.py`: every option of the real parser must be listed here and in the test, and for every option the local web page
offers, the command the page would run is read back by the real `srasel run` parser and must contain the value that was asked for.
If you add an option to `srasel run`, that test fails until the option is classified.

Where the three agree, the result is the same: the local page runs `srasel run` itself, and the online page runs the same engine code
(`browser/run_pipeline.py` calls the engine's own stage functions). Every control below was exercised by a real run and compared with the command line
(see section 9 of `validation/C_software/SOFTWARE_AUDIT.md`).

| `srasel run` | Local web page (`srasel web`) | Online page (Browser Mode) | Note |
|---|---|---|---|
| `--samples` | Samples table: **Load samples table**, or add rows by hand; the page always runs the job with `--samples` | not available | Online, name the files `<patient>-<n>` or give the patient as a third column of the dates file |
| `--bams` | **Choose BAM files**, **Choose BAM folder**, **Add manually** (typed paths) | **Choose BAM files**, **Choose BAM folder** | Online the BAMs are read in the tab (never uploaded) and counted with pysam instead of bam-readcount |
| `--dates` | **Choose dates file**, the paste box, or type each date in the table | **Choose dates file**, the paste box, or type each date (and patient) in the Samples table | Same formats and the same reader as the command line (the engine's `read_dates_file` and `parse_dates`); a third column gives the patient. Online the dates text is the single source of truth: a table edit rewrites that sample's line, an edit of the text redraws the table |
| `--patient` | The patient column of the table; **Apply** under the table fills one name into every row that has none | The Patient column of the table (a third column of the dates text); **Apply** under the table or **Patient name** under Additional options fill one name into every sample that has none | Only for files not named `<patient>-<n>` and with no patient in the dates file; same rule as the engine |
| `--virus`, `--ref` | Reference: **NCBI accession / virus name** (virus name or accession) | not available (**NCBI accession / virus name** is shown disabled) | Needs internet; online use `srasel run` or `srasel web` |
| `--ref-file` | Reference: **GenBank file(s)** (one per segment) | **Choose GenBank file(s)** | Segmented virus: one file per segment, in BAM header order. Online each choice adds to the list (with a Remove button), so the files can be chosen one by one |
| `--fragments` | Additional options → Advanced: **Each sample is several BAM files**, Fragment column, fragments table or GenBank | not available | |
| `--fasta`, `--genes` | Reference: **FASTA and gene list** | Reference: **FASTA and gene list** (**Choose FASTA**, **Choose gene list**) | Online the runner calls the engine's `make-genbank --fasta F --genes G -o reference_input.gb`, then `prepare-reference`, exactly as `engine.build_reference` does; the warnings of `make-genbank` are in the log and the GenBank that was made is in the zip |
| `--consensus`, `--consensus-source` | Reference: **Own consensus** (FASTA plus GenBank file(s), accession(s) or a virus name) | not available (**Own consensus (needs minimap2)** is shown disabled) | Needs minimap2. Online, load the annotated consensus (`consensus_annotated.gb`, written to `reference/references.gb` by `srasel run --consensus`) as the GenBank file, or give a FASTA and a gene list |
| `--alias` | Additional options → Advanced: **Contig aliases** | **Contig aliases** under Additional options | `BAM_NAME=REFERENCE_NAME`, one per line. Online the same pairing rule as the engine (alias, name, name without version, unique length) |
| `--out` | not needed | not needed | Each analysis has its own folder (local) or comes as one zip (online) |
| `--email` | Under **NCBI accession / virus name** | not available | Only used for NCBI downloads |
| `--threads` | Analysis parameters: **Threads** | not applicable | The online page runs one process; the engine says threads do not change the results |
| `--nperm` | Analysis parameters: **Permutations** (100 to 100000) | Analysis parameters: **Permutations** (10 to 100000) | Defaults read from the real parser (local) or equal to it (online; a test checks) |
| `--freq-delta` | Analysis parameters: **Minimum \|Δf\|** | Analysis parameters: **Minimum \|Δf\|** | |
| `--seed` | Analysis parameters: **Seed** | Analysis parameters: **Seed** | |
| `--check-only` | **Check inputs** on the Run analysis screen, next to Run analysis | not available | The checks use samtools; online use the command line or the local page |
| `--no-report` | Additional options: **Skip the HTML report** | Additional options: **Skip the HTML report** | Results then have no report; the tables are the same |
| `--resume` | **Resume this analysis** after a failed, cancelled or interrupted analysis | not available | The local page re-runs the same job folder with `--resume`: counts and stages finished with the same inputs and parameters are reused, the log says so |
| `--yes` | always passed | not needed | Analyses started from the page never ask anything |

## What cannot exist in each interface, and why

**Online page (Browser Mode)**

* **NCBI download** (`--virus`, `--ref`, `--email`, and the reference choice **From the BAM headers**): the page makes no network request with your data; the only download is the Python runtime. The reference choices **Own consensus**, **NCBI accession / virus name** and **From the BAM headers** are shown disabled, each with its reason and where to use it (`srasel run` or `srasel web`).
* **Gene transfer to a consensus** (`--consensus`, `--consensus-source`): it needs `minimap2`, a native program. The annotated consensus that
  `srasel run --consensus` writes (`reference/references.gb`) works as a normal GenBank file, and a FASTA with a gene list is accepted too.
* **A samples table** (`--samples`) and **fragments** (`--fragments`): a browser has no file paths; one BAM per fragment is only in the command line and the local page.
* **`--check-only`**: the checks (md5 of the contigs, differences between reads and reference, reads per contig) use samtools. The online page counts with
  pysam and stops with the engine's explanation if a BAM does not fit the reference.
* **`--threads`**: WebAssembly runs one process. Results do not depend on the number of threads.
* **`--resume`**: nothing is kept between runs in a tab; closing it discards everything.
* **`--out`, `--yes`**: no output folder, and nothing is asked.

**Local web page (`srasel web`)**

* **`--out`**: every analysis has its own folder inside the server's work folder. The page never accepts a path to write to.
* **`--yes`**: the job is not interactive, so it always runs with `--yes` (when the engine would ask, it stops and says why).
* **`--patient` on its own**: the page always sends the samples as explicit rows (`--samples`) with the patient of each row, which is the same thing;
  the API still accepts `bams` + `dates_file` + `patient`, which builds the command-line form.
* Files outside the allowed folders (`--allowed-root`) cannot be used.

## Known differences that are not options

* Online with BAM input the counts are made with pysam, not bam-readcount. They are identical except for two unused statistics columns of
  `processing/03_integrity_checked/*.readcounts.tsv` and, in rare cases, the last digit of `score` (see `docs/BAM_COUNTER.md`).
* The online page writes no `SUMMARY.md` of the engine; it builds a short one from what it knows.
* Online the integrity step shows the engine's messages, but the pre-count checks of `srasel run` step `[3]` (samtools) are not run.
