# Results: files, columns and how to read them

This page is the detail behind the "Interpreting results" section of the [README](../README.md#interpreting-results). The column definitions were checked against the output files of a real run (`examples/real/sars2_freiburg`, `--seed 1`).

## The results folder

| File or folder | What it is |
|---|---|
| `report.html` | the interactive report (one self-contained file) |
| `SUMMARY.md` | settings, the checks per sample, and the number of variants tested and labelled for each patient (and which patients were not analysed, and why) |
| `reference/` | the reference as SRASel understood it: `reference.fna`, `REFERENCE_REPORT.txt`, `cds_model.tsv` (how each gene is read), `features.tsv`; for a consensus also `transfer_report.tsv` |
| `processing/06_selection_analysis/` | the statistics: per patient `<P>_variant_stats.tsv`, `<P>_selected_ranked.tsv`, `<P>_per_position_summary.tsv`, `<P>_long.tsv`, and PDF figures (`<P>_genome_selection.pdf` and one `<P>_plots/pos<N>_ALL.pdf` per labelled position) |
| `processing/05_annotated_tables/` | per patient, every allele with its gene, codon and amino-acid change (`<P>_genes.tsv`) |
| `processing/04_position_time_matrices/` | per patient, the counts of every allele on every date (`<P>.tsv`; each cell is `day/depth/allele counts/indels`) |
| `processing/02_rc/`, `processing/03_integrity_checked/` | the raw counts (large) |
| `commands.log` | every external command that was run; attach it when you report a problem |

All `.tsv` files are plain tables that open in Excel, R or Python.

## What is tested, and what the label means

For every patient SRASel pools the counts of the samples that share a date (replicates are summed). Each `(position, allele)` becomes a trajectory of `(day, k, n)`: `k` = reads with the allele, `n` = depth at that position that day. An allele is **a base (A, C, G, T, N) or one exact insertion (`+SEQ`) or deletion (`-SEQ`)**.

1. A trajectory is kept only if it has **at least 100 reads of the allele on some date** (a fixed value, not an option), at least 3 covered dates, and **|Δf| ≥ `--freq-delta`** (0.03). Days where the position was covered but the allele was not seen enter with frequency 0.
2. The frequency `f = k / n` is regressed on the day by **weighted least squares** (weights = depth). The slope is **β** (change of frequency per day); **Δf = β × (last day − first day)** is the *fitted* change over the follow-up.
3. The **p-value** is a two-sided permutation p: the dates are shuffled among the observations `--nperm` times (default 2000), and `p = (number of shuffles with |β*| ≥ |β| + 1) / (nperm + 1)`.
4. **The label:** `pos` if `p < 0.05` and β > 0, `neg` if `p < 0.05` and β < 0. The 0.05 is fixed.
5. **There is no correction for multiple testing.** A label means "a directional change in frequency worth a closer look"; some labels are expected by chance.

## Columns of `<P>_variant_stats.tsv` (one row per tested allele)

| Column | Meaning |
|---|---|
| `gene` | every CDS that covers the position (comma-joined, for overlapping genes) |
| `aa_gene`, `aa_idx` | the gene used for the amino-acid change (the first annotation of the position) and the codon number in it (`ND` if non-coding) |
| `pos`, `contig`, `contig_pos` | global position (all contigs concatenated), contig name, position inside the contig; use `contig` + `contig_pos` for segmented viruses |
| `var` | the allele |
| `beta` | the weighted slope, frequency per day; positive = goes up. Descriptive |
| `pval` | the permutation p-value (not corrected); smallest possible value depends on `--nperm` and on the number of dates |
| `score` | `sign(β) × \|β\| × (−log10 p)`, only a ranking key |
| `tag` | `pos` or `neg` when labelled, empty otherwise |
| `delta_f` | the fitted change β × follow-up; it can be larger than 1 in absolute value (a line extrapolated), it is not the difference between the last and first sample |
| `codon` | the codon of this allele, in the sense of the mRNA: the two other bases of the codon are taken from the neighbouring positions (the most frequent base, if its mean frequency over the dates is at least 0.95, otherwise `N`) |
| `aa_change` | the amino acid of that codon, written `<idx><AA>` when the allele goes up (`25N`: the rising allele encodes N) and `<AA><idx>` when it goes down (`I25`: the falling allele encodes I); `amb` when ambiguous; `(indel)` for indels. **This is not REF-to-ALT notation** |
| `ambiguous` | true if the amino acid could not be resolved (an indel, a non-coding position, a neighbouring base that is not fixed, or several labelled positions in one codon) |
| `other_frames` | the effect of the same allele in the other overlapping reading frames, `gene:aa_change` joined by `;` |
| `annot_detail` | debug text of the codon inference |
| `depth` | mean depth at the position over the dates of the trajectory |
| `n_days` | number of covered dates in the trajectory (including zero-filled ones) |
| `day`, `k`, `n` | JSON lists: the days since the first sample, the reads with the allele, the depth |

Both alleles of a biallelic site are tested (one rising, one falling, with the same |β|), so the number of variants is about twice the number of positions, and one of the two can be labelled and not the other when p is close to 0.05.

## `<P>_selected_ranked.tsv` (the labelled alleles only)

The same columns as above (without `day`, `k`, `n`) plus `variant_suffix` (the deleted sequence of a deletion), `date` (the calendar date of `days_from_t0`), `days_from_t0` (the first day with at least 10 reads of the allele; not an emergence date: it depends on depth and on the first sample) and `covarying`, `covarying_count`, `covarying_with` (labelled alleles with a similar slope, `|β1 − β2| ≤ 0.01` per day, whose start days differ by at most 1 day; it means "similar slope", not linkage). The rows are sorted by the **signed** score: all `pos` rows first, strongest first, then the `neg` rows from the weakest to the strongest.

## `<P>_per_position_summary.tsv` (positions with at least one labelled allele)

| Column | Meaning |
|---|---|
| `pos`, `contig`, `contig_pos`, `aa_idx` | as above |
| `label` | the amino-acid change of the position, written falling-allele amino acid + `aa_idx` + rising-allele amino acid (`D137E`) when exactly one rising and one falling allele are labelled; `25N` or `I25` when only one is; `amb` when several alleles of the same sign are labelled. It reads "falling to rising", not REF to ALT |
| `synonymous` | `True` or `False` when both amino acids are unambiguous, empty otherwise |
| `n_sel`, `vars`, `tags`, `betas`, `pvals`, `codons`, `aa_labels`, `ambiguous`, `annot_detail`, `why_ambiguous_pos` | JSON lists over the labelled alleles of the position |
| `beta_up`, `p_up`, `score_up`, `beta_dn`, `p_dn`, `score_dn` | the best rising and falling allele (empty when several alleles share a sign) |

`<P>_long.tsv` (`pos`, `var`, `day`, `k`, `n`) is the input of the statistics: every allele with at least 100 reads on some date, on every date.

## How the p-value depends on the number of dates

The permutation test can only produce as many different slopes as there are orderings of the dates, so the **smallest possible p depends on the number of different dates** (replicates count once), however large `--nperm` is.

| Different dates | Smallest p of a perfectly monotone trajectory (equal depths) | Consequence at p < 0.05 |
|---|---|---|
| fewer than 3 | not tested | the patient is not analysed (listed in `SUMMARY.md`; other patients are) |
| 3 | 1/3 | **nothing can be labelled** |
| 4 | 1/12, about 0.04 with unequal depths | only very clean trajectories; whether the label appears depends on the random shuffles (and so on `--seed`) |
| 5 | 1/60 = 0.017 | feasible |
| 6 | 1/360 = 0.0028 | |

So: 3 dates give statistics but no labels; 4 dates are borderline; **5 or more are recommended**. Mirror alleles of one site can get different labels at 4 or 5 dates by Monte Carlo noise. With many alleles tested and no correction for multiple testing, the number of dates also limits how much a correction could ever leave: with 5 dates the floor (0.008 to 0.017) is already above 0.05 divided by 3 to 6 tests. The p-value is also an estimate: with another `--seed` the labels of alleles with p close to 0.05 can change (1 to 3 % of the labels in the examples).

## Quality warnings

* A sample needs at least **97 % of the reference positions covered** or it is warned about and left out; **at least 3 dates** per patient.
* An allele is tested only if **100 reads** support it on some date: a series with a coverage far below 100x gives few or no statistics.
* The report's **Quality** tab lists samples whose mean coverage is **below 100x** and samples that cover fewer than 90 % of the positions of their series (relative to the best sample).
* The checks before counting warn about a high rate of differences between the reads and the reference (normal for HIV-1 or norovirus against a public genome): read amino-acid changes with care.
* With `--consensus`, amino-acid numbers are those of **your consensus's** proteins, not of the public reference.

## Glossary

| Term | Meaning |
|---|---|
| **Allele** | one of the possible bases at a position (A, C, G, T, N), or an insertion or a deletion |
| **Frequency** | the fraction of the reads at a position that carry an allele, on a date |
| **β (slope)** | the depth-weighted straight-line change of an allele's frequency per day |
| **Δf** | the fitted total change over the follow-up (β × days); positive = goes up |
| **p** | the share of random shufflings of the dates that give a slope at least as steep; not corrected for the many alleles tested |
| **Label (`tag`)** | `pos` or `neg`: p < 0.05 and \|Δf\| ≥ 0.03; a flag for a closer look |
| **Depth / coverage** | the number of reads that cover a position |
| **Replicates** | two BAMs of the same patient on the same date; their reads are added as one time point |
| **Contig / segment** | one sequence of the reference; a segmented virus has one per segment |
| **CDS** | the part of a gene that is translated into protein |
| **Series** | in the report, the results of one patient |
