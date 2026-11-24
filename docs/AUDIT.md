# Audit of `srasel.py` (SRASel 2.0, single file, 6 448 lines) – what the code really does

Verified by reading the code and by running it (see `tests/`). `legacy/srasel_2.0_original.py` is the file as received
(`legacy/SHA256`); the first commit of this repository contains it untouched.

## Real execution order (`srasel run`, function `main_run` → `pipeline`)
1. `load_samples`: `--samples` (TSV: bam, patient, date[, fragment]) or `--bams` + `--dates`. Sample ids are `<patient>-<n>` (`1a/1b` = same-day replicates). Dates are parsed in any format, the whole file decides dd/mm vs mm/dd.
2. `prepare_bams`: **BAMs must be coordinate-sorted and indexed**; `run` links each BAM into `out/work/bams`, reuses `.bai/.csi` if present, indexes with `samtools index` if not, and sorts a *copy* (`samtools sort`) if the header is not `SO:coordinate`. The user's BAMs are never modified.
3. `build_reference`: GenBank (`--ref`, `--ref-file`, `--virus` via NCBI), FASTA + gene list (`--fasta --genes`) or consensus with annotation transferred by minimap2 (`--consensus`) → `reference/` (`reference.fna`, `contigs.tsv`, `cds_model.tsv`, `features.tsv`).
4. `check_bams`: contig names, lengths and `M5` md5 against the reference; read–reference mismatch rate (`samtools stats`, abort > `ERR_FAIL`); reads per contig.
5. **Step 2** counts: `bam-readcount -q 20 -b 20 -w 0 -f reference.fna sample.bam` → `processing/02_rc/<id>_RG_readcount.txt` (threads over samples).
6. **Step 3** `integrity` (≥ 97 % of reference positions, ≥ 3 dates, same-day tokens) → `03_integrity_checked/<patient>/`.
7. **Step 4** `build-tables` (position × time matrix, global coordinates = contig offset + position, base-by-base check of the reference base).
8. **Step 5** `annotate` (gene / CDS / codon / amino acid from the reading model).
9. **Step 6** `selection` (zero-filled frequencies, slope β, Δf, permutation p-value, tags `pos`/`neg`, covariation, plots).
10. **Step 7** `report` (self-contained HTML; the template is embedded in the file) and `RESUMEN.md`.

Stages 3–7 are launched by `run` as sub-processes `python srasel.py <stage> …` (`SELF`), each stage reads its options from `sys.argv`.

## Questions asked in the brief
* **Picard `AddOrReplaceReadGroups` – is it needed?** No. `srasel.py` never calls Picard and never reads `@RG`/`SM` tags: the sample name comes from the `--samples` table, and bam-readcount is run without `-p`. The only trace is a naming convention: counts files are called `<id>_RG_readcount.txt` and `integrity` strips that suffix (`parse_sample_id`). `run` writes that name itself. The CESGA scripts in the old repository still use Picard only to produce those file names.
* **Sorted/indexed BAM?** Yes, see 2. Unsorted BAM → sorted copy with a warning; missing index → created.
* **bam-readcount equivalence:** the counts are bam-readcount's. `tests/regression/test_counts_oracle.py` shows that an independent CIGAR walker over the BAM reproduces bam-readcount `-q20 -b20 -w0` exactly on the synthetic BAMs (duplicates, secondary, QC-fail, unmapped skipped; MAPQ ≥ 20 and base Q ≥ 20 inclusive; overlapping mates both counted; no orphan filter; insertions at the anchor base, deletions at the first deleted base).
* **Parallelism:** step 2 uses a thread pool (one bam-readcount process per sample); step 6 uses joblib/loky.

## Defects found (details and evidence in `CHANGES_PACKAGING.md`)
| # | Defect | Effect | Status |
|---|---|---|---|
| 1 | `plt.cm.get_cmap` removed in matplotlib ≥ 3.9 | `selection` crashes in the plotting step on a current environment | fixed (same colormap) |
| 2 | With pandas ≥ 3, missing text values become `NaN` instead of `None` | `per_position_summary.tsv` wrote `[NaN]` instead of `[null]` (invalid JSON for browsers) | fixed (normalised to `null`) |
| 3 | `PERM_SEED` / `ZERO_FILL` are module globals read by loky workers: they reach the workers only when the file runs as `__main__` | importing the module (package, `python -m`) silently ignored `--seed` (p-values changed with `--jobs`) and `--legacy-no-zero-fill` | fixed; test `test_selection_parallel.py` |
| 4 | No way to resume; an interrupted bam-readcount leaves a truncated table that a re-run would silently reuse | wasted time / wrong inputs | `run --resume` with completion markers |

Known and left as they were (scientific decisions of the authors, see `legacy/OBSERVACIONES_ORIGINAL.md` B): samples under the minimum coverage are flagged but still analysed (#10); contigs are validated only in the first BAM against the reference (#11).

## Duplicated code / performance (not changed, no value for the goal)
Heavy imports at start-up (`scipy`, `matplotlib`) – `srasel --help` avoids them; the report HTML template (≈ 1 500 lines) lives inside the file; one PDF per labelled variant may dominate `selection` with hundreds of labels (hypothesis in the original notes, not measured).

## Pyodide
See `docs/BROWSER_MODE.md`.
