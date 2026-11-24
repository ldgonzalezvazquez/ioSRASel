# Scientific-equivalence review: packaged SRASel vs `srasel_2.0_original.py`

Date: 2026-11-03. Reviewer: final independent check (read-only; this file is the only one written).
Question: do `src/srasel/engine.py` + CLI + local web + Browser Mode preserve the scientific behaviour of
`legacy/srasel_2.0_original.py` (sha256 `d040a6b0…ab1a7f`, matches `legacy/SHA256`)?

**Verdict: equivalent, with the listed exceptions** (section 6). Every table produced by the analysis (counts, matrices,
annotation, statistics, tags) is identical to the original on the synthetic fixtures. The deliberate, documented differences are
(1) the `codons`/`aa_labels` JSON cells of `*_per_position_summary.tsv` (`null` instead of `NaN` under pandas 3, matching the original under pandas 2),
(2) the HTML report of `run` now knows the real `--nperm`, and (3) the new `--resume`, whose fingerprint does not include the engine/tool versions.
The scientific issues of the audit (B2, B3, A1–A6, H1) are inherited unchanged and need an author decision.

Scratch outputs of every check were kept outside the repository (a temporary folder of the review session) and are not part of it; the commands that reproduce them are given in each section.
Environment: macOS x86_64, `.venv` Python 3.12.2 (numpy 2.5.4, pandas 3.1.0, scipy 1.18.1, matplotlib 3.11.2, joblib 1.6.0, cloudpickle 3.1.2, biopython 1.88),
samtools / bam-readcount from conda env `srasel-real`, node v24.18.0.

---

## 1. Every hunk of `diff -u legacy/srasel_2.0_original.py src/srasel/engine.py` (179 diff lines, 8 hunks)

| # | engine.py | Change | Class | Can it change a result? | Evidence |
|---|---|---|---|---|---|
| 1 | 79-87 | `cloudpickle.register_pickle_by_value(engine)` when imported as a module | packaging-only (restores legacy semantics) | No numeric code changed. It only makes loky ship the functions by value, as happens when the file runs as `__main__`. Without it, `python -m srasel selection --jobs >1` silently loses `--seed` / `--legacy-no-zero-fill` in workers. | §2.2: package `--jobs 1` and `--jobs 2` TSVs = legacy `--jobs 1`/`2` TSVs with `--legacy-no-zero-fill`; `test_selection_parallel.py` passed |
| 2 | 2746-2748 | `codons_l`/`aa_labels_l`: `None if pd.isna(x)` | display / serialisation | Only the JSON text of two columns of `*_per_position_summary.tsv`. That file is written once (line 3547) and **not read back** by `report` or any other stage (grep). Under pandas 2 the original already wrote `null`; under pandas 3 it writes `NaN` (invalid JSON). | §2.1: the only data difference between the legacy copy and the package is `[NaN]` vs `[null]` in `P1_per_position_summary.tsv` (pos 937, indel); package = golden |
| 3 | 3230 | `matplotlib.colormaps["tab20"]` instead of `plt.cm.get_cmap` | display only | Same colormap object; PDF gene bar only. | The legacy copy differs from the original by exactly this line; its PDFs equal the package's up to the pre-existing nondeterminism in §2.2 |
| 4 | 6291-6318 | `_fingerprint`, `_file_id`, `_content_id`, `stage_reusable`, `stage_done` | new feature (`--resume`) | Not called by any scientific code. | — |
| 5 | 6331-6353 | per-sample `rc` markers; skip when reusable | new feature | Without `--resume` the same `bam-readcount -q 20 -b 20 -w 0` call runs; marker files are added under `processing/.resume/`. | §2.1: `commands.log` identical modulo paths/progress bars; 02_rc hashes = golden |
| 6 | 6359-6390 | stages 3-5 and 6 wrapped in reuse checks | new feature | Without `--resume`: identical command list and order (only indentation changed). | same |
| 7 | 6398 | `run` passes `--nperm` to `report` | display (report only) | Changes the report: `defaults.nperm` and the `cmd` text. No table changes. This is a **visible difference vs the original** (original report always assumed 2000). | §2.1: masked HTML diff has exactly these 2 hunks; legacy `report --nperm 200` = package report byte-for-byte after masking the output folder name |
| 8 | 6444-6446 | `--resume` argument | new feature | — | — |

`docs/CHANGES_PACKAGING.md` lists all five substantive edits (1-3, 4-6+8 as "--resume", 7); the list is **complete**. Corrections to its claims:
* Edit 2 "No (restores the original text)": correct w.r.t. the original under pandas 2 and the golden files; versus the original run under pandas 3 it is a visible (text) difference. Fine as stated, worth one more word.
* Edit 4 "No": true for the scenarios tested (`test_resume.py`, §3), but the fingerprint omits the engine and tool versions (§3), so reuse across a software update can return stale results.
* Edit 5 "Display only": correct; note that it changes the HTML relative to the original's `run`.
* `docs/BROWSER_MODE.md` "What runs" table and the `run_pipeline.py` docstring show `report ... --freq-delta D` without `--nperm`, but the code passes `--nperm` (line 236). Docs only.

---

## 2. Independent equivalence runs (not previously done)

### 2.1 Full `run` on the lcmv fixture: original (+colormap one-liner) vs package, report included
* `legacy_copy.py` = original with **only** line 3219 replaced (`diff` shows one line). Fixture: `make_bams.py --case lcmv --seed 7`.
* Both: `run --samples … --ref-file NC_004294.1.gb NC_004291.1.gb --seed 1 --nperm 200 --threads 2 --yes` (report on), one as `python legacy_copy.py run`, one as `python -m srasel run`.

| Output | Result |
|---|---|
| All 40 entries of `tests/regression/golden/lcmv/MANIFEST.tsv` (incl. hash-only 02_rc) | package 40/40 sha256 equal; legacy copy 39/40, the only miss is `P1_per_position_summary.tsv` (`[NaN]` vs `[null]`, hunk 2) |
| Every other file (`diff -rq`, 67 files + 12 resume markers) | identical except `RESUMEN.md` (output path only), `commands.log` (paths, tqdm progress lines, report `--nperm`), `informe.html`, the summary above, and `processing/.resume/` (package only) |
| `informe.html` (output-folder name masked) | 2 differences only: `"nperm":2000` → `200` and ` --nperm 200` in `cmd` (hunk 7). No timestamp. `legacy_copy.py report … --nperm 200` on the legacy processing folder = package report, **byte-identical** after masking |
| PDFs | identical in this run (both finished in the same second; see 2.2 for timestamps) |

### 2.2 `selection --legacy-no-zero-fill` on golden phix annotated tables
Golden `05_annotated_tables/*_genes.tsv.gz` (gunzipped) + golden `dates.tsv`; `--nperm 200 --seed 1 --freq-delta 0.03 --thr-clear 0.95 --first-k-min 10`, `--jobs 1` and `--jobs 2`, legacy copy vs `python -m srasel selection`.
* All TSVs identical across the four runs (legacy j1, legacy j2, package j1, package j2), except the `NaN`/`null` cells of hunk 2 (legacy vs package).
* PDFs: differ by `CreationDate`, and two (`P1_/P2_genome_selection.pdf`) also by drawing order: decompressing the streams shows two overlapping gene bars painted in swapped order. This also happens **between two legacy runs** (legacy j1 vs j2), so it is pre-existing: `spans_rows` is built by iterating a Python `set` of gene names (hash-randomised per process) and `sort_values("min")` is not stable for ties. Colours per gene are the same. Display-only, inherited.

### 2.3 Regression tests re-run
`pytest tests/regression/test_golden.py test_resume.py test_selection_parallel.py`: **15 passed, 2 skipped** (192 s). The 2 skips are the tests that run the unpatched original, which needs `plt.cm.get_cmap` (absent in matplotlib 3.11); §2.1 covers that gap.

---

## 3. `--resume`: fingerprint review and stale-reuse attempts

What the fingerprints contain: rc = (resolved BAM path, size, mtime_ns) per BAM/fragment + sha256 of the FASTA actually given to bam-readcount (so alias-renamed FASTA is covered) + parsed `--fragments` map; stages 3-5 = all rc fingerprints + `dates.tsv` text + sha256 of `contigs.tsv`, `reference.fna`, `cds_model.tsv`, `features.tsv` + the final alias map; stage 6 = fp(3-5) + nperm, seed, freq-delta and the two literals. Markers are deleted before a stage reruns and written atomically after it ends, so an interrupted stage is never reused.

Covered: `--alias` (final map), `--fragments` contents, `--email` / `--virus` / `--ref` / downloads (only through the reference **content**, which is what matters), dates, BAM changes that alter size or mtime, nperm/seed/freq-delta. `--threads` is deliberately excluded; justified (package j1 = j2 in §2.2 and in `test_selection_parallel.py`).

Gaps (by code reading; none produces a wrong result on the fixtures):
1. **Engine version / code not fingerprinted**, nor samtools/bam-readcount versions. After an SRASel update that changes a stage (e.g. if the authors fix B2 or A1), `run --resume` on an old folder reuses the old 03-06 outputs and the new report presents them. Suggested fix (needs the owners): add sha256 of `engine.py` and tool `--version` strings to every fingerprint.
2. `references.gb` is not hashed directly, although `annotate` reads it (`load_model`); its derived `cds_model.tsv`, `features.tsv`, `reference.fna` are. A GenBank edit that changes annotation without changing these three files would be missed. Low risk.
3. BAM identity is (path, size, mtime_ns): an in-place replacement preserving both (e.g. `touch -r`, some sync tools) is not detected. Low risk.
4. Reuse of 3-5 checks only that `05_annotated_tables/*_genes.tsv` exists; a deleted `04_position_time_matrices` is not detected and the report then silently omits depth/diversity.

Stale-reuse test run: phix, run A with 10 samples into folder X, then run B into the same X with `--resume` and one sample removed (`P1_day28`), vs a clean run B in a new folder and vs the legacy copy doing A then B in one folder. Result: rc of the 9 remaining samples reused; stages 3-6 rerun; the stale `02_rc/P1-5_RG_readcount.txt` is picked up by the `integrity` glob and copied to `03_integrity_checked/P1/` in **both** the package and the legacy dirty folders, but all matrices, annotated tables and statistics equal the clean run (the `.time` file built from `dates.tsv` governs which samples enter). Package-dirty = legacy-dirty for every non-PDF file. So: no wrong reuse constructed; the "dirty output folder" behaviour is inherited from the original.

---

## 4. Browser Mode and "same engine in the three modes"

| Check | Command | Result |
|---|---|---|
| phix tables regenerated natively | `python -m srasel run … NC_001422.1.gb --seed 1 --nperm 200 --threads 1 --no-report` | 10/10 `02_rc` sha256 = golden MANIFEST |
| CPython browser pipeline, phix | `browser/run_pipeline.py --tables … --nperm 200 --seed 1` | vs golden 40/40 strict |
| Pyodide (node), phix | `node browser/test_node_e2e.mjs … --nperm 200 --seed 1` (Pyodide 314.0.7, Python 3.14.2, local mirror) | CPython vs Pyodide 43/43 byte-identical (PDFs excluded, report masked); vs golden 40/40 strict |
| CPython + Pyodide, lcmv (2 GenBank, `--gzip` inputs) | same, tables from §2.1 package run | 44/44 identical; vs golden 40/40 strict |
| Native `run` (§2.1) vs Pyodide lcmv | `check_outputs.py` | all common files identical except `informe.html`, whose only difference is `"processing":["…/out_pkg_lcmv/processing"]` vs `["processing"]` (path text) |
| Wheel = source | unzip `docs/browser/srasel-2.1.0.dev0-py3-none-any.whl` | contains only `srasel/__init__.py` + `srasel/engine.py`; engine sha256 `631c5c3c…1c01` = `src/srasel/engine.py` = `manifest.json` `sources`; wheel sha256 `cfbcb09c…3831` = manifest; `docs/browser/run_pipeline.py` = `browser/run_pipeline.py`. **Wheel is current.** `worker.js` checks the wheel sha256 against the manifest before installing |
| Local web | read `src/srasel/web/jobs.py` | job = `[sys.executable, "-m", "srasel", "run", …]` argument list, i.e. the same CLI/engine path as §2.1 |
| CLI | `cli.py` → `engine.COMMANDS[cmd][0]()`; `run` spawns stages as `python engine.py <stage>` (`SELF`) | same engine file |

Not re-run: real Chrome (`test_browser.mjs`), `--nperm 2000` browser runs, memory/timing figures in `browser/measurements.json` (those are performance numbers, not equality claims).

---

## 5. Audit section 5 (`STATS_AND_REPORT_AUDIT.md`): what the package inherits

Re-checked here: B1 (fixed in `run`, hunk 7; the standalone `srasel report` still defaults to `--nperm 2000`), B2 (golden mirror-allele splits found again: phiX P1 1236 C/G, phiX P2 1236 C/G and 2432 C/T, LCMV P2 7662 A/G: identical |β|, one tagged, one not, p = 0.0447 vs 0.0547), A1 (all 100 `Δday` values in golden `*_selected_ranked.tsv` are 0; code takes `min(day)` of the zero-filled list), A2 (`min_days`/`min_range` appear only in the signature and call sites). B3, A3-A6 and H1/H2 were not re-derived; I agree with them from reading the cited lines.

| ID | Inherited unchanged? | Decision needed | Consequence of each option |
|---|---|---|---|
| B2 Monte Carlo p for ≤5 dates | yes | (a) keep; (b) exact enumeration when `n_days! ≤ nperm`; (c) one shared permutation stream per position | (a) results = 2.0; tags at 4-5 dates stay seed-dependent and mirrors can disagree; must be documented. (b) deterministic, exact p; changes p and tags vs 2.0 (e.g. phiX P1 1236 C: 0.0547 → 0.0333, becomes tagged; P2 1236 G 0.0547 → 0.0417, becomes tagged); golden must be regenerated. (c) mirrors consistent, still noisy; p values change. |
| B3 3-date series never taggable | yes | (a) keep + warn; (b) require ≥4 (or 5) dates to test | (a) unchanged numbers, needs a visible warning in run/report/web. (b) fewer tested rows; counts in reports change. |
| A1 covariation Δday always 0 | yes | (a) fix (first day with f>0); (b) drop the temporal criterion from docs/help | (a) changes `covarying*` columns of `selected_ranked` (annotation only; tags and p unaffected); fewer partners. (b) no numeric change. |
| A2 `--covar-min-days/-range` ignored | yes | implement or remove | implement: `covarying*` columns change; remove: help/argparse change only. |
| A3/A4/A5 texts (≥100 reads is allele count k; signed-score sort; hard-coded 0.03/2000; PMIN = 1/nperm) | yes | fix wording / pass real values | Text/report only; no table changes. |
| A6 JS `p ≤ α` vs Python `p < 0.05` | yes | align on one | JS→`<`: report display only. Python→`≤`: tags change only when p is exactly 0.05 (nperm 199, 999, 1999…). |
| H1 replicate pooling doubles weight | yes (hypothesis) | quantify first | Averaging replicates would change β and p for patients with replicates. |
| Pre-existing (new here) PDF bar order nondeterministic | yes | optional `sorted()` | Display only. |

---

## 6. Verdict and coverage

**Equivalent with listed exceptions:** (i) `null` vs `NaN` text in `*_per_position_summary.tsv` under pandas 3 (package = original under pandas 2 = golden); (ii) `run` report uses the real `--nperm` (original showed 2000); (iii) `--resume` may reuse results across an engine/tool update (version not fingerprinted). None changes counts, filters, model, coordinates, annotation or tags of a normal run.

### Verified (by me, in this review)
| What | How | Result |
|---|---|---|
| Diff classification | `diff -u` legacy vs engine | 8 hunks, all classified (§1); no scientific code changed |
| Legacy hash | `shasum -a 256` | = `legacy/SHA256` |
| Full `run` legacy(+cmap) vs package, lcmv, report on | §2.1 | identical except (i), (ii) |
| No-zero-fill selection, jobs 1/2, phix golden tables | §2.2 | TSVs identical except (i) |
| Golden/resume/parallel tests | pytest | 15 passed, 2 skipped (original needs old matplotlib) |
| Resume dirty-folder scenario | §3 | no stale reuse; behaviour = original |
| Browser CPython + Pyodide, phix and lcmv | §4 | identical to each other and to golden |
| Wheel/manifest/web command | §4 | same engine, wheel current |

### Not verified
* Platforms: only macOS x86_64 (Intel). Not Linux, Apple Silicon, **Windows** (paths, symlinks in `work/bams`, loky).
* Real datasets: only the deterministic synthetic fixtures (phiX, LCMV); no real BAMs, no fragmented (`--fragments`) run, no `--consensus`, no `--fasta/--genes`.
* Network paths `--virus`, `--ref` (NCBI download) and `--email`: not run.
* Browsers: no real browser run here (Chrome result in `BROWSER_MODE.md` is the author's); Firefox and Safari never tested.
* Other numeric stacks: original under pandas 2 not re-run (no such env present); byte-identity across versions rests on `CHANGES_PACKAGING.md`.
* Local web UI end to end (only its command construction was read).
* `--nperm 2000` equivalence (all runs here used 200).

### Residual risks
1. `--resume` across software updates (engine/tool versions not in fingerprint); `references.gb` not directly hashed; BAM identity by size+mtime.
2. Re-using an output folder keeps stale files in `02_rc`/`03_integrity_checked` (original behaviour; harmless in the tested case, untested when a stale sample also appears in `dates.tsv`).
3. Inherited scientific decisions B2/B3/A1/A2/A6 (section 5).
4. Byte-identity depends on the numeric stack; platforms beyond the one tested may differ in last digits (not observed, not tested).

---
**Update 2026-11-04.** After this review, A1 (covariation Δday always 0) was fixed with the owner's approval (a regression introduced by the 2.0 zero-fill; see `CHANGES_PACKAGING.md`, edit 6). Only the `covarying*` columns of `*_selected_ranked.tsv` differ from the original; golden outputs are unchanged. The verdict above applies to everything else.
