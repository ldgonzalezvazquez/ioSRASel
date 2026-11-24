# SRASel statistics and HTML report: scientific audit

Scope: `src/srasel/engine.py` (selection stage `main_selection` / `process` / `analyse_variant`, report stage `main_report` / `load_patient` / `diversity_tables` / `REPORT_TEMPLATE`).
Method: code reading plus re-analysis of the golden outputs in `tests/regression/golden/{phix,lcmv}` (run with `--seed 1 --nperm 200`, see `tests/regression/runner.py:17-18`) and one report generated from the golden phiX processing folder.
No code was changed. Line numbers refer to `engine.py` as of 2026-11-03. Template (JS) lines are given as engine.py lines.

---

## 1. The statistical model in one paragraph

For every patient (series) SRASel pools the bam-readcount counts of all samples that share a time-point number (replicates `1a`/`1b` are summed: `process_line`, 2143-2176). Each `(pos, var)` (a base A/C/G/T/N, or one exact insertion `+SEQ` / deletion `-SEQ`) becomes a trajectory of `(day, k, n)`, where `k` = reads supporting the allele and `n` = total depth at the position on that day. A trajectory is kept only if **k ≥ 100 on at least one day** (`depth_any=100`, hard-coded at 3288/3298, filter at 2231/2275). With zero-fill (default) days where the position was covered but the allele not seen are added with `k = 0` (`zero_fill`, 2447). The slope β of frequency `f = k/n` against day is fitted by **weighted least squares with weights n** (`beta_only`, 2434). Trajectories with fewer than 3 covered days are dropped, and so are those with `|Δf| < --freq-delta` where `Δf = β·(day_max − day_min)` (2619-2628). The remaining ones get a **two-sided permutation p-value**: the day labels are shuffled among the observations (each `(k, n)` pair stays together) `--nperm` times and `p = (#{|β*| ≥ |β|} + 1)/(nperm + 1)` (`pval_perm`, 2466). `tag = pos` if `p < 0.05` and β > 0, `neg` if `p < 0.05` and β < 0 (2633). The 0.05 is hard-coded; there is no multiple-testing correction.

The engine itself says it (RESUMEN.md text, 6412): *a tag marks a directional frequency change, it does not prove selection (drift, hitchhiking and reversion also produce it).*

---

## 2. Variable dictionary

### 2.1 `<P>_long.tsv` (input to the statistics)

| Column | Definition | Notes |
|---|---|---|
| `pos` | Global 1-based coordinate (contigs concatenated with offsets; see `contig`/`contig_pos` elsewhere) | |
| `var` | Allele: `A C G T N`, `+SEQ` (insertion), `-SEQ` (deletion) | Each distinct indel sequence is its own allele. |
| `day` | Days since the first sample of the patient (relative, integer) | From the cell code in `04_position_time_matrices`. |
| `k` | Reads supporting `var` that day (replicates summed) | `0` only for zero-filled days. |
| `n` | Total depth at the position that day (replicates summed) | Same `n` for every allele of a position/day. No minimum per day: n = 33 occurs in golden P1. |

Only `(pos,var)` pairs with `max(k) ≥ 100` are written (verified: min of per-pair `max(k)` = 100 in all four golden files). This includes the reference allele of almost every well-covered position, which is why `long` has thousands of pairs while `variant_stats` has a handful.

### 2.2 `<P>_variant_stats.tsv` (one row per tested trajectory)

Rows exist only for trajectories that passed: `max k ≥ 100`, `≥ 3` covered days, `|Δf| ≥ --freq-delta`.

| Column | Exact definition (code) | Units / sign | What it does NOT mean |
|---|---|---|---|
| `gene` | All CDS names covering `pos` (comma-joined, e.g. `phiX174p01,phiX174p02`) | | Not the frame used for `aa_change` (that is `aa_gene`). |
| `aa_gene` | CDS of the *first* annotation of the position (GenBank order) | | Overlapping frames are in `other_frames`. |
| `aa_idx` | Codon number in `aa_gene` (1-based); `ND` if non-coding | | |
| `pos`, `contig`, `contig_pos` | Global coordinate; contig name and coordinate within contig | | Use `contig:contig_pos` for display on segmented/multi-contig genomes. |
| `var` | Allele (see 2.1) | | Not "ALT vs REF": both the rising and the falling allele of a site are tested (mirror alleles). |
| `beta` (β) | WLS slope of `f=k/n` on `day`, weights `w=n`: `β = Σw(t−t̄w)(f−f̄w) / Σw(t−t̄w)²` (`beta_only`, 2434) | frequency fraction per day; `+` = rising | Not a selection coefficient *s* (not logistic, not per generation). Depends on follow-up length and sampling. Zero-filled days enter with f = 0. Pooled replicate days get double weight. |
| `pval` | Two-sided permutation p: `(#{|β*| ≥ |β|}+1)/(nperm+1)`, days permuted among observations (2466) | 1/(nperm+1) … 1 | Not corrected for multiple tests. Discrete; floor set by both nperm **and** the number of dates (section 3). Mirror alleles can get different p from Monte Carlo noise (section 5, B2). |
| `score` | `sign(β)·|β|·(−log10 p)` (2635) | per day × log10 units | Ad-hoc ranking key, not a statistic; not comparable across series of different duration (β is per day). |
| `tag` | `pos` if p < 0.05 and β > 0; `neg` if p < 0.05 and β < 0; empty otherwise (2633) | | Not "under selection". The 0.05 is hard-coded; `--freq-delta` acts earlier as a pre-filter. |
| `delta_f` (Δf) | `β·(day_max − day_min)` of that trajectory (2626) | frequency fraction; signed | **Fitted** total change, not observed; can exceed ±1 (linear extrapolation). Not "max − min". |
| `codon` | Codon of this allele in mRNA sense: base forced to `var` at `pos`, the two other codon bases = top allele of each neighbour by **mean frequency over days** if that mean ≥ `--thr-clear` (0.95), else `N` (`infer_codon_aa_for_recta`, 2494) | | Not the consensus codon at any given date. Reverse-complemented for minus-strand CDS. |
| `aa_change` | Amino acid encoded by `codon`, written **`idx`+AA if β > 0** (e.g. `25N`: the rising allele encodes N) and **AA+`idx` if β < 0** (e.g. `I25`: the falling allele encodes I); `amb` when ambiguous; `(indel)` marks indels (`_format_aa_change`, 2655) | | **Not REF→ALT notation.** `I25` does not mean "Ile is the reference". |
| `ambiguous` | True if a neighbour is not "clear", the allele is an indel or N, the position is non-coding, or ≥ 2 positions of the same codon are tagged (re-annotation pass 3329-3372) | | Not an error flag about the statistics; only about the amino-acid label. |
| `other_frames` | Same allele's effect in the other overlapping CDS readings: `gene:aa_change[amb]` joined by `;` | | |
| `annot_detail` | Debug string of the codon inference (neighbour top base, its mean frequency, `pos_selected`, multi-selection reason) | | `|f1-f_pos_top|` is printed but **never used** (`--eps-tie` has no effect; 3601-3604). |
| `depth` | Mean of `n` over the trajectory's days | reads | Position depth, not allele reads. |
| `n_days` | Number of covered days in the trajectory (incl. zero-filled) | | Not "days the allele was seen". Drives the attainable p (section 3). |
| `day`, `k`, `n` | JSON lists of the trajectory | | |

### 2.3 `<P>_selected_ranked.tsv` (tagged rows only)

Same columns as 2.2 minus the lists, plus:

| Column | Definition | Caveat |
|---|---|---|
| order of rows | `sort_values("score", ascending=False)` (3376): **signed** score, so all `pos` rows first (strongest first), then `neg` rows from weakest to strongest | The docs (1937) say "sorted by descending absolute score": wrong (A3). |
| `variant_suffix` | Text after the first `-` of `var` (the deleted sequence for deletions, empty otherwise) | Legacy; meaningless for display. |
| `days_from_t0` | First day (relative) with **k ≥ `--first-k-min`** (default 10 reads, absolute count) (3410-3446) | Not an emergence date: depends on depth (10 reads of 10 000 = 0.1 %), and is left-censored by the first sample (golden: all 0). |
| `date` | `t0 + days_from_t0`, t0 = earliest date of the patient in `--times` | Calendar date of the sample above, nothing more. String `"No time file provided"` when `--times` is absent (mixed-type column). |
| `covarying`, `covarying_count`, `covarying_with` | Tagged pairs with `|β1 − β2| ≤ --covar-threshold` (0.01/day) **and** `|start1 − start2| ≤ --covar-max-day-diff` (1 day) (1943-2068) | "Start" is `min(day)` of the zero-filled list = first *sampled* day, not first appearance, so Δday is effectively always 0 (A1). `--covar-min-days` and `--covar-min-range` are accepted but unused (A2). Not linkage, not haplotype evidence. |

### 2.4 `<P>_per_position_summary.tsv` (positions with ≥ 1 tagged allele)

| Column | Definition |
|---|---|
| `label` | Falling-allele AA + `aa_idx` + rising-allele AA (`I25N`) when exactly one `pos` and one `neg` allele; `25N` / `I25` if only one is tagged; `amb` variants when several alleles of the same sign are tagged (2719-2873). **Reads as "falling → rising", not REF → ALT.** |
| `synonymous` | `True`/`False` only when both labels are unambiguous; empty otherwise. |
| `n_sel`, `vars`, `tags`, `betas`, `pvals`, `codons`, `aa_labels`, `ambiguous`, `annot_detail` | JSON lists over the tagged alleles of the position. |
| `why_ambiguous_pos` | `annot_detail` of the ambiguous ones. |
| `beta_up/p_up/score_up`, `beta_dn/p_dn/score_dn` | Best (highest score) `pos` and `neg` allele; empty when several alleles share a sign. |

### 2.5 How the parameters enter

| Option (default; `run` value) | Where | Effect |
|---|---|---|
| `--nperm` (2000) | `pval_perm` | p resolution `1/(nperm+1)` (2000 → 5.0e-4; golden 200 → 4.98e-3). |
| `--seed` (`selection`: none; `run`: 1) | 2630 | Per-trajectory generator `[seed, pos, crc32(var)]`: reproducible and independent of `--jobs`, but mirror alleles use different streams. |
| `--freq-delta` (0.03) | 2627 | Pre-filter on `|Δf|` before the test. Variants below it are absent from all outputs and from the report. |
| `--thr-clear` (0.95) | 2564 | Minimum mean frequency for a neighbour base to be used in the codon. Annotation only. |
| `--eps-tie` (0.05) | — | No effect (printed in `annot_detail` only). |
| `--first-k-min` (10) | 3431 | Reads needed for `days_from_t0`. Annotation only. |
| `--legacy-no-zero-fill` | 2235/2286 | Drops k = 0 days (1.x behaviour; biases alleles that start from 0). |
| `depth_any` = 100 (not an option) | 3288/3298 | Allele must reach 100 supporting reads on some day. Series with < ~100× coverage give no statistics at all. |
| hard-coded 0.05 | 2633 | Tag threshold, strict `<`. |

---

## 3. What p can and cannot be (number of dates)

The permutation null has at most `n_days!` distinct relabelings, and the identity is always one of them, so the **exact** p is ≥ `1/n_days!`; when days are evenly spaced and depths similar, the reversal gives `−β` and the floor is `2/n_days!`. The Monte Carlo estimate fluctuates around the exact value with SD ≈ √(p(1−p)/nperm).

| Dates in the series | Smallest exact p (monotone trajectory, equal depth) | Consequence at the fixed 0.05 |
|---|---|---|
| 3 | 1/3 (2/6) | **Can never be tagged.** |
| 4 | 1/12 (2/24); 1/24 = 0.042 with unequal depths | Tag is decided by Monte Carlo noise around 0.042 (see B2). |
| 5 | 1/60 (2/120) = 0.017 | Feasible, but no room for multiple-testing correction. |
| 6 | 1/360 = 0.0028 | |

Computed with `beta_only` by full enumeration (`itertools.permutations`). Golden examples (exact vs reported p, nperm = 200):

| Series | Allele | β (/day) | p reported | p exact | tag |
|---|---|---|---|---|---|
| phiX P1 (5 dates) | 1236 C | +0.0287 | 0.0547 | 0.0333 | – |
| phiX P1 | 1236 G (mirror) | −0.0286 | 0.0299 | 0.0333 | neg |
| phiX P2 (4 dates) | 1236 C | +0.0388 | 0.0448 | 0.0417 | pos |
| phiX P2 | 1236 G (mirror) | −0.0388 | 0.0547 | 0.0417 | – |
| phiX P2 | 2432 C / T | ±0.0394 | 0.0547 / 0.0448 | 0.0417 / 0.0417 | – / neg |
| LCMV P2 (4 dates) | 7662 A / G | ∓0.038 | 0.0448 / 0.0547 | 0.0417 / 0.0417 | neg / – |

Multiple testing: with m tested trajectories, Bonferroni would need `p ≤ 0.05/m`; with 5 dates the exact floor (≈ 0.008–0.017) already exceeds 0.05/m for m ≥ 3–6. Any FDR/Bonferroni step a dashboard adds must be shown together with this floor, otherwise "nothing survives correction" will be misread as "nothing happened".

---

## 4. HTML report (`srasel report`)

Generated from golden phiX (`--ref-dir tests/regression/golden/phix/reference --processing <copy with gunzipped 04/06> --nperm 200`): runs fine; note that the golden `04_position_time_matrices` are stored `.gz`, so the report silently omits depth and diversity unless they are decompressed.

### 4.1 Tabs

| Tab | Shows | Source |
|---|---|---|
| Resumen | Lead counts; bar per series (positions passing current thresholds / positions with a statistic, tick = positions tagged by SRASel); sampling timeline coloured by mean depth; genome histogram of passing variants (up/down) with CDS track; top 12 passing variants ranked by `|Δf observed|·(−log10 p)` | `variant_stats`, matrices |
| Selección | Volcano: x = Δf estimated (clipped, shaded outside [−1,1]), y = −log10 p, dashed threshold lines, dotted "test floor"; series table; strip of Δf or β of passing variants per series; 2×2 table tagged vs passing | `variant_stats` |
| Dinámica temporal | Observed frequencies by real day (point size = depth), polyline, dashed WLS line (slope = β from Python, intercept recomputed with weights n), depth bars (red if n < 100) | `variant_stats` lists |
| Diversidad | Per-sample mean depth and mean H; pairwise divergence heat map; H along the genome × time (absolute or change vs first sample) | `04_position_time_matrices` |
| Variantes | Sortable table (Efecto = `aa_change`, Gen = `aa_gene`, β ‰/day, p, Δf estimated, mean depth, tag) | `variant_stats` |
| Referencia de mapeo / Validación (temporal) / Simulación | Only with `--config` comparisons, `--notes`, `--truth/--neutral` | |
| Métodos y procedencia | Command line, folders, pipeline sketch, versions | |

Diversity definitions (`read_matrix` 5211, `diversity_tables` 5242): per position, frequencies over A,C,G,T only; alleles with f < `--min-maf` (0.01) set to 0 and the rest renormalised; positions with A+C+G+T < `--min-depth` (100) excluded. `H = 1 − Σf²`. Divergence(i,j) = mean over positions covered in both of `½Σ|f_i − f_j|`. Genome bins: ~60 windows, a bin is shown only if ≥ 30 % of its positions pass the depth filter. Sample "depth" = mean depth over covered (non-NA) positions only.

### 4.2 JavaScript re-computations vs Python

| Quantity | JS | Python | Equal? |
|---|---|---|---|
| "passes" | `p ≤ α && |Δf| ≥ δ` (3901) | tag: `p < 0.05`; Δf is a pre-filter | Same at defaults, except when `p == 0.05` exactly (possible for nperm = 199, 999, 1999…: e.g. 50/1000): JS passes, Python does not tag (A6). |
| β | not recomputed (Dyn uses `v.beta`); old `trajectory()` recomputes the same WLS | `beta_only` | Yes. |
| Δf estimated | from TSV | `β·(tmax−tmin)` | Yes (rounded to 5 decimals). |
| Δf observed | last − first observed frequency (incl. zero-filled days) | not computed | Report-only; label it as such. |
| score | `|β|·nlp(p)`, nlp clamps p at PMIN/2 | `|β|·(−log10 p)` | Yes while report `--nperm` ≥ real nperm. |
| p floor | `PMIN = 1/defaults.nperm` (3893), label "p mínimo = 1/nperm" | `1/(nperm+1)` and ≥ 1/n_days! | Off by one, and wrong when `--nperm` is not passed (B1). Ignores the date-count floor. |
| "by chance" | `α × (#positions with a statistic)` (resText, 4239) | — | Indicative only, see 4.3. |

### 4.3 Where the report can mislead

1. **Wrong nperm (B1).** `run` calls `report` without `--nperm` (6397-6398), so every report produced by `srasel run` / the web UI assumes 2000 permutations regardless of what was used: the "suelo del test: p mínimo = 1/2000" line, the α slider range and the ovTop note ("con 2000 permutaciones … 1/2000", 4464) are wrong for any other `--nperm` (golden: 200).
2. **Hard-coded thresholds in text.** "p<0,05 y |Δf|≥0,03" at 4378 and 4574 is fixed text; with `--freq-delta 0.05` the report still says 0.03.
3. **"By chance" count.** `α × positions tested` treats positions as independent and p as uniform. Neither holds: the tested set is pre-selected on |Δf| (correlated with β), mirror alleles of a position are dependent, linked positions co-move, and p is discrete with a date-dependent floor (for 3–4 dates the true chance count at α = 0.05 is ~0, not α·m). The text says "orientativo" and "no es una FDR"; keep that wording.
4. **δ slider below `--freq-delta`.** The slider goes to 0, but variants below the run's `--freq-delta` were never tested and are not in the data; lowering δ cannot reveal them. Not stated in the UI.
5. **Mirror alleles.** Each biallelic site appears twice (rising and falling allele, identical |β|), so "variants" ≈ 2 × "positions"; one may be tagged and the other not (B2). The position counts deduplicate; variant counts do not.
6. **Replicates.** Selection pools `1a`+`1b` (double weight on that day); the Diversity tab treats them as separate samples on the same day.
7. **Depth filters.** `--min-depth`/`--min-maf` only affect the Diversity tab and the "Marcadas" flag; the statistics use no per-day depth minimum and no MAF filter (an allele at 0.5 % enters if it reaches 100 reads some day). The Methods text lists them next to the p parameters, which suggests otherwise.
8. **"Marcadas" samples** use `depth < 300×` or < 50 % of the genome covered at ≥ min-depth (3979), while the timeline and depth bars warn at 100×. Two different thresholds, neither applied by the statistics.
9. **Amino-acid notation.** "Efecto" shows `25N` / `I25` (rising / falling allele's amino acid), which readers parse as REF/ALT. Not explained in the report.
10. **Δf estimated vs observed.** The Variantes table header says just "Δf" (estimated, may exceed ±1).
11. **Report vs TSV naming.** Report "Gen" = `aa_gene` (first frame), TSV `gene` lists all overlapping CDS; report has no `ambiguous`, `n_days`, `covarying` or `days_from_t0`.
12. Dead code: `tabRes`/`tabSel` (4635 ff.) are not reachable (aliased to new tabs); they contain the inaccurate phrase "coherencia de la trayectoria" (no such criterion exists). Harmless now; do not resurrect.

---

## 5. Suspected scientific bugs

| ID | Status | Where | Evidence / reproduction | Impact |
|---|---|---|---|---|
| B1 | CONFIRMED | engine.py 6397-6398 (`pipeline`) | `report` is launched with `--freq-delta` but not `--nperm`; `main_report` default is 2000 (5429). Golden runs use `--nperm 200`; the report then draws the floor at 1/2000 and states it in text. | Report mislabels p resolution for every non-default run (also via web UI). |
| B2 | CONFIRMED (method) | `pval_perm` 2466 + per-variant RNG 2630 | For series with ≤ 5 dates, `n_days! ≤ nperm`; Monte Carlo sampling of a tiny permutation space gives different p to mirror alleles with identical |β|, and flips tags across 0.05 (table in section 3; phiX P1 1236 C/G, phiX P2 1236 and 2432, LCMV P2 7662). Reproduce: enumerate `itertools.permutations(day)` with `beta_only`. | Tags at 4–5 dates partly reflect the seed. Exact enumeration when `n_days! ≤ nperm` (or a shared stream per position) would remove it; this changes results, so it needs owner approval. |
| B3 | CONFIRMED (design limit) | 2619, 2633 | Trajectories with 3 dates are tested but can never reach p < 0.05 (exact p ≥ 1/3). | Users with 3 samples get "no tagged variants" by construction; must be warned. |
| A1 | CONFIRMED | 1999-2003, 2042 | `first_day = min(day list)`; with zero-fill the list starts at the first sampled day. Synthetic check: a variant first seen on day 21 is paired with one present from day 0 with `Δday=0`. All golden `covarying_with` entries show `Δday=0`. | The temporal criterion of covariation is void; covariation = `|Δβ| ≤ 0.01/day` only, which for typical β (0.02–0.04/day) pairs most same-direction sweeps. |
| A2 | CONFIRMED | 1947-1948 | `min_days`, `min_range` parameters of `_compute_covariation_annotations_selected` are never read; `--covar-min-days`/`--covar-min-range` have no effect. | Help text promises a filter that does not exist. |
| A3 | CONFIRMED (docs) | 1922, 1926, 1937 | `build_final_report_text` says rows need "total depth ≥ 100" (code: allele reads k ≥ 100), "Δf ≥" (code: |Δf|), "sorted by descending absolute score" (code: signed score, 3376). | Methods text printed by the engine misdescribes the filters. |
| A4 | CONFIRMED (text) | 4378, 4464, 4574 | Hard-coded "0,03", "2000", "1/2000" in live report text. | Wrong when other parameters are used. |
| A5 | CONFIRMED (minor) | 3893 | `PMIN = 1/nperm` instead of `1/(nperm+1)`; also ignores the `1/n_days!` floor. | Cosmetic, but the "test floor" line is not where the points actually pile up for short series. |
| A6 | CONFIRMED (edge) | 3901 vs 2633 | JS `p ≤ α`, Python `p < 0.05`. For `--nperm 999`, p = 50/1000 = 0.05 passes in the report but is untagged. | "Passes but not tagged" rows appear at default thresholds. |
| H1 | HYPOTHESIS | 2143-2176 | Replicate pooling sums depths, giving the replicated day double WLS weight and making the permutation non-exchangeable in weight (the heavy observation moves with its day). Golden P1 day 0: n ≈ 458 vs ≈ 225 elsewhere. Probably minor; not quantified. | Slight bias of β toward the replicated date. |
| H2 | HYPOTHESIS | 2626 | Δf pre-filter uses the same β that is tested; the reported p is not conditional on the selection step, so "by chance" counts based on α·m are biased upward or downward depending on the |Δf| distribution. | Interpretation only. |

No error was found in `beta_only`, `zero_fill`, the WLS line drawn by the report, the A/C/G/T column mapping in `read_matrix` (5224, code order A C T G → A C G T), or strand handling of codons.

---

## 6. Guidance for dashboard integrators

### 6.1 Fields to show (per variant)

| Field | Label | Tooltip (short, careful) |
|---|---|---|
| `contig:contig_pos` (+ `pos`) | Position | Reference coordinate (contig and position). |
| `var` | Allele | Base, or inserted (+) / deleted (−) sequence. |
| `aa_gene`, `aa_change`, `other_frames` | Gene · AA | "25N": the rising allele encodes N at codon 25; "I25": the falling allele encodes I. Not REF→ALT. Inferred from mean neighbour frequencies. |
| `ambiguous` | AA ambiguous | Codon could not be resolved (neighbour not fixed, indel, non-coding, or several changing sites in the codon). |
| `beta` | Slope (per day) | Weighted (by depth) linear change of allele frequency per day. Display as %/day. |
| `delta_f` | Fitted change | Slope × follow-up. Fraction of reads; can exceed ±1 because it is a linear fit. |
| observed change (compute: last − first `k/n`) | Observed change | Frequency at last date minus first date. |
| `pval` | Permutation p (uncorrected) | Share of day relabelings giving an equal or steeper slope. Not corrected for multiple testing. Smallest possible value depends on permutations and on the number of dates. |
| `tag` | Direction flag | "Rising" / "Falling" = p < 0.05. Indicates a sustained frequency change, not proof of selection. |
| `n_days` | Dates | Covered dates in this trajectory. |
| `depth` | Mean depth | Mean reads at the position across dates. |
| `days_from_t0`, `date` | First date with ≥ 10 reads | Not the emergence date; depends on depth and first sample. |

Hide by default: `score` (internal ranking key), `variant_suffix`, `annot_detail` (debug; offer as "details"), `covarying*` (until A1/A2 are resolved; if shown, call it "similar slope", never "linked" or "co-evolving").

### 6.2 Defaults

Same as the engine: α = 0.05 (and say "p < 0.05"), |Δf| ≥ the run's `--freq-delta`, nperm and seed read from the run, not assumed. Never let the Δf control go below the run's `--freq-delta` without saying those variants were not tested. Sort by p then |observed change|, or by the engine's order, but say which.

### 6.3 Warnings that must always be visible

1. "Flags mark a sustained change in allele frequency over time. They do not prove selection: drift, linkage (hitchhiking), reversion and sampling artefacts produce the same pattern."
2. "p-values are not corrected for multiple testing."
3. Number of dates per series, with: 3 dates → "No variant can reach p < 0.05 with 3 dates"; 4 dates → "With 4 dates the smallest possible p is ≈ 0.04; flags are borderline and seed-dependent".
4. "p resolution: 1/(nperm+1) = …" using the real nperm.
5. "Variants need ≥ 100 supporting reads on at least one date to be tested" (low-coverage series may give no results).
6. Both alleles of a biallelic site are listed (one rising, one falling); count positions, not alleles, when summarising.

### 6.4 Never present

* "Selected", "under positive selection", "adaptive", "fitness", "selection coefficient" for `tag`, `beta` or `score`.
* `delta_f` as an observed change, or values outside [−1, 1] as frequencies.
* "Expected false positives" / FDR derived from α × tests as if exact.
* `covarying` as linkage, haplotype or epistasis.
* `days_from_t0`/`date` as emergence or acquisition date.
* Progress percentages for the selection stage: the engine exposes no measurable progress (permutation time depends on the unknown number of trajectories passing the filters); show stage names and elapsed time only.
* Diversity/divergence as an effective population size or mutation rate; they include residual sequencing error above `--min-maf`.
