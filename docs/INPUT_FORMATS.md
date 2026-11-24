# Input formats: what SRASel accepts and what it does not

Everything in this page was checked by running the program on each case (list at the end). Exit code `2` means "stopped because of your input": the message says what is wrong and what to do.

## 1. What you need, in one table

| You need | For | Where it goes |
|---|---|---|
| **One BAM per sample** (`.bam`) | the reads | `--bams folder/` or `--samples` |
| **A date per BAM** | the time axis | `--dates dates.tsv` or the 3rd column of `--samples` |
| **A reference with its genes** | amino-acid effects and gene names | one of the five ways in section 5 |
| **≥ 3 dates per patient** (5 or more recommended) | the statistics | see section 7 |

A patient with fewer than 3 dates is listed as *not analysed* (the other patients are). Nothing else is required: no read groups, no index, no quality-control step.

## 2. BAM files

**Accepted**
* `.bam` files (any aligner: `bwa mem`, `minimap2 -ax sr`, `bowtie2`…), paired-end or single-end Illumina short reads. One BAM per sample, in one folder (subfolders are searched) or listed in a table.
* Unsorted or unindexed BAMs: `srasel run` sorts and indexes **copies** in `OUT/work/bams`; your files are never changed. The online page needs no `.bai` but the BAM must be coordinate-sorted.
* Several `--bams` arguments (folders and/or `.bam` files).
* BAMs aligned to your own consensus, as long as you give that consensus **annotated** (section 5).

**What is counted** (`bam-readcount -q 20 -b 20 -w 0`, reproduced by the online counter): reads with mapping quality ≥ 20 and bases with quality ≥ 20. Reads flagged unmapped, secondary, QC-fail or duplicate are not counted (SRASel does not mark duplicates itself); supplementary reads are counted.

**Not accepted**
| Input | What happens |
|---|---|
| SAM, CRAM, FASTQ | not read. A `.sam` in the folder is ignored and its row in the dates file is reported as "does not match any BAM". Convert to BAM first (section 10). |
| A damaged or truncated BAM, or a text file named `.bam` | stops: `the BAM … is damaged or truncated` |
| BAMs aligned to another sequence than the reference you give | stops before counting: `The contigs of your BAMs are not in the reference: …` (lists both sets of names) |
| The same BAM twice | stops: `The same BAM appears twice` |
| Two BAMs with the same file name in different subfolders | stops: `There are several BAMs named …` |
| A `--bams` path that does not exist | stops: `--bams: "<path>" does not exist` |
| A reference without any gene (a GenBank with no CDS) | stops: `The reference has no genes` |
| A sample with fewer than 97 % of the reference positions covered | warned (`⚠ … Only N positions`) and left out of the analysis |
| Long reads (Nanopore, PacBio), spliced alignments | **not tested**; no promise of correct results |
| Amplicon data with primers still in the reads | accepted, but trim the primers first (for example `ivar trim`); SRASel does not do it |

## 3. Sample names, patients and replicates

* A BAM called `<patient>-<n>.bam` (`P1-3.bam`, `007-A-1a.bam`) needs no patient column: the patient is what comes before the **last** `-`. The part after it must be a number, optionally followed by one lowercase letter (`3`, `3a`, `3b`).
* Any other name (`sampleA.bam`, `S2_t1.bam`, `P1-day7.bam`) needs the **patient** in the 3rd column of the dates file, or in the `--samples` table, or `--patient NAME` when all samples are from one patient. Without it: `Cannot tell which patient "S2_t1" belongs to`.
* Names are matched ignoring upper/lower case: `p1-1` in the dates file finds `P1-1.bam`.
* **The ids in the results are rebuilt**: `<patient>-<n>` in date order (`PX-1`, `PX-2`…), whatever the file names were.
* Patient names keep only letters, digits, `_` and `.`; anything else becomes `_` (`A-B` → `A_B`, `Paciente Ñ 1` → `Paciente_1`).
* **Replicates**: two BAMs of the same patient on the **same date** are one time point: they are pooled (ids `P1-1a`, `P1-1b`). This depends only on the date, not on the names: `P1-1.bam` and `P1-2.bam` with the same date also become replicates. Replicates with different dates stop the run.

## 4. Dates

**The dates file** (`--dates`): one line per BAM, `name<TAB>date[<TAB>patient]`, name without `.bam`.
* Separators: tab (recommended), also comma, semicolon or spaces.
* Blank lines and lines starting with `#` are skipped; a first line without a digit in its date column is taken as a header.
* A BAM with no row → stops (`1 BAM without a date: …`). A row with no BAM → a warning, the row is ignored.
* **`--samples` table** (alternative): tab-separated `bam<TAB>patient<TAB>date` (a 4th column `fragment` only with `--fragments`); the BAM is a full path; a header and `#` lines are skipped; any other unusable row stops the run.

**Date formats that were read correctly**
| Written as | Example |
|---|---|
| day/month/year | `23/03/2020`, `23/03/20`, `23.3.20`, `6.4.2020` |
| year-month-day | `2020-03-23`, `2020/03/23`, `20200323` |
| with a time | `2020-03-23 10:15`, `2020-04-06T09:30:00` |
| month name | `23-Mar-2020`, `30 March 2020`, `March 23, 2020` |
| days since the first sample | `0`, `7`, `14` (whole numbers; the first sample may be any of them) |

**What to watch**
* **Day/month or month/day**: decided from the whole file. If any value has a day above 12, the order is clear. If not, it assumes day/month and warns (`Ambiguous dates … e.g. 01/02/2020`). Use `2020-02-01` if in doubt.
* **A bare number is a number of days, never a year**: `2020`, `2021`, `2022` are read as day 2020, 2021, 2022 and no error is raised. Write full dates.
* Days and dates cannot be mixed in one file, and days must be whole numbers (`7.5` stops with `Relative days and dates are mixed`).
* Not accepted: month without day (`2020-03`), words (`Monday`), an empty date, an impossible day (`31/02/2024`): each stops with `Cannot parse the date "…"`.
* Only the **differences** between dates matter for the statistics.

## 5. Reference

One of these (in this priority order when several are given):

| Option | You give | Needs | Online page |
|---|---|---|---|
| `--ref ACC[,ACC…]` | NCBI accession(s), one per segment | internet + `--email` | no |
| `--ref-file a.gb [b.gb …]` | your annotated GenBank(s), offline | — | yes |
| `--fasta f.fa --genes list` | a sequence and a gene list (section 6) | — | yes |
| `--consensus c.fa --consensus-source ACC\|file.gb …` | **your consensus** and an annotated genome of a related virus; the genes are transferred | `minimap2` | no: load `consensus_annotated.gb` instead |
| `--virus "name"` | a virus name; SRASel picks the RefSeq record that fits the BAMs | internet + `--email` | no |
| *(none)* | nothing; the contig names in the BAM header are used if they are NCBI accessions | internet | no |

**The rule that matters: the reference must be the sequence your BAMs were aligned to.** SRASel compares, before counting, the contig names, lengths and (if the header has it) the md5 of every contig. A contig is paired with the reference when its name matches, or matches without the version (`NC_001422` ≈ `NC_001422.1`), or you give `--alias NAME_IN_BAM=NAME_IN_REFERENCE`, or it is the only contig of that length. A different virus, another numbering or another length stops the run before any counting.
* **Segmented viruses**: the reference must contain **every** segment of the BAM header (a missing one stops the run), and every BAM must have the same segments in the same order. Give one GenBank per segment, or one file with several records (same results), or `--ref ACC1,ACC2,…`; for FASTA + genes give **one FASTA with all the segments and one gene list** whose `contig` column names the segment; for `--consensus` give one FASTA with one record per segment and one annotated source per segment (paired automatically by alignment, any order). Segments are matched to the BAM by name (or `--alias`, or unique length). The order in which you give them only changes the internal global numbering (`pos`, names of the per-position PDFs) and, by Monte-Carlo noise, the permutation p-values (slopes, Δf, amino acids and labels were unchanged in the LCMV test); keep the BAM-header order (`samtools view -H x.bam | grep '^@SQ'`). The local web page and the online page have a **Segmented virus** switch: with it on, *FASTA and gene list* takes one FASTA and one gene list per segment and joins them in the order of the list (`srasel.segments`; identical to joining them with `cat`); the command line takes one of each. The table and the example just below give the commands.
* **BAMs aligned to a consensus** (contigs named like `PB2`, `PB1`…): RefSeq GenBanks (`NC_007366.1`…) are the wrong reference. Use the annotated consensus (`reference/references.gb` written by `srasel run --consensus`, shipped as `consensus_annotated.gb` in the examples), or `--consensus` with a related annotated genome.
* **A GenBank is a sequence plus where its genes are.** SRASel needs the genes for the amino-acid change, the codon and the gene filter. A GenBank in which no record has a CDS stops at the reference step: `The reference has no genes`; a file that is not GenBank (for example a FASTA renamed `.gb`) stops with `Biopython said: No records found`.
* Spliced genes, overlapping genes and ribosomal slips come from the GenBank `join(…)` locations; nothing needs to be told to SRASel.

### Segmented viruses: how to give the reference

The example is for 3 segments `seg1`, `seg2`, `seg3`, in BAM-header order.

| You have… | Command line | Local web page | Online page |
|---|---|---|---|
| One GenBank file per segment (the usual case) | `--ref-file seg1.gb seg2.gb seg3.gb` (one option, files separated by spaces) | **Segmented virus** on, **GenBank file(s)**, add the files; ↑ ↓ put them in order | the same |
| One GenBank file with all the segments (several `LOCUS … //` records) | `--ref-file all.gb`; to make it: `cat seg1.gb seg2.gb seg3.gb > all.gb` (same results as three files) | the same, one file | the same |
| NCBI accessions | `--ref ACC1,ACC2,ACC3` (commas, no spaces; needs internet and `--email`) | **NCBI accession / virus name** | not available: download the `.gb` files once |
| A FASTA and a gene list | **one** FASTA with all the segments (`cat seg1.fa seg2.fa seg3.fa > all.fa`) and **one** gene list with the segment name in the `contig` column: `--fasta all.fa --genes genes.tsv` | **Segmented virus** on, **FASTA and gene list**: one FASTA and one list per segment, or one of each; the page joins them in the order of the lists | the same |
| Your own consensus | `--consensus all_consensus.fa` (one record per segment, named as the contigs of your BAMs) and `--consensus-source` with the annotated GenBank file(s) or accessions of a related virus, one per segment (paired by alignment, any order). Writes `reference/references.gb` and `reference/transfer_report.tsv`. Needs `minimap2` | **Own consensus** | not available: load the annotated consensus as GenBank |
| A virus name | `--virus "Influenza A virus"`: SRASel looks for the RefSeq group whose segment lengths equal those of your BAM header and asks which one if none does (with `--yes` it stops; it never guesses) | **NCBI accession / virus name** | not available |

A *fragment* is not a segment: `--fragments` is for samples split into several BAMs (one per genome fragment), not for a segmented virus. A segment without genes is still analysed, but its variants have no gene, codon or amino acid.

Example, two segments with a FASTA and a gene list. `all.fa` contains `>NC_004294.1` and `>NC_004291.1`; `genes.tsv` (tab-separated, **one header line**, then the genes of **all** segments):

```
contig	gene	start	end	strand	type	product
NC_004294.1	GP	78	1574	+	CDS	envelope glycoprotein
NC_004294.1	NP	1639	3315	-	CDS	nucleoprotein
NC_004291.1	L	33	6665	+	CDS	L protein
```

```bash
srasel run --bams examples/simulated/lcmv_segmented/bams --dates examples/simulated/lcmv_segmented/dates.tsv \
           --fasta all.fa --genes genes.tsv --out results_lcmv --seed 1 --yes
```

If you already have one gene list per segment, join them keeping a single header line (`cat list1.tsv > genes.tsv; tail -n +2 list2.tsv >> genes.tsv`). A GFF3 can hold all the segments too. Evidence: [validation/redesign/MORE_DATASETS.md](../validation/redesign/MORE_DATASETS.md).

## 6. Gene list (`--genes`, with `--fasta`)

A tab-separated table with a header, or a GFF3 (`.gff`, `.gff3`):

```
contig	gene	start	end	strand	type	product	codon_start	transl_table
NC_001422.1	A	3981	5386	+	CDS	protein A	1	1
```
Required: `contig` (the **same name** your BAMs use), `gene`, `start`, `end` (1-based, both included, start < end), `strand` (`+`/`-`, also `1`/`-1`, `plus`/`minus`). Optional: `type` (`CDS` default, or `mat_peptide`), `product`, `codon_start` (1–3), `transl_table`. A gene in several pieces (introns): several rows with the same contig + gene + type, in reading order. Genes are identified **by name**: two different CDS must have different names. A gene list cannot say that a gene has a ribosomal slip: the `slippage` column of `cds_model.tsv` is then `False`, and mature peptides (for example HA1/HA2) appear only if you list them with `type` = `mat_peptide` (checked on influenza: with those rows the variants of the report are identical to the GenBank run). SRASel warns when a length is not a multiple of 3 or a stop codon is inside (nothing is corrected). For a segmented virus the list covers **all** segments (one table, one header line, `contig` = the segment) and goes with one FASTA that holds all of them. More: `srasel make-genbank -h`.

## 7. How much data per patient

| Dates (distinct) | What you can expect |
|---|---|
| fewer than 3 | the patient is **not analysed** (listed in `SUMMARY.md`) |
| 3 | statistics are computed, but nothing can be labelled |
| 4 | only very clean trajectories can be; the label depends on the random permutations |
| 5 or more | recommended |

An allele enters the statistics when it is supported by ≥ 100 reads on some date and is seen on ≥ 3 dates. Replicates of one date count as one date. Each sample needs ≥ 97 % of the reference positions covered (section 2).

## 8. What each interface accepts

| | `srasel run` | local web (`srasel web`) | online page |
|---|---|---|---|
| BAM files | yes | yes (read in place from the folders you allow with `--allowed-root`; BAMs cannot be uploaded to the server, only small text files such as dates, GenBank and FASTA) | yes (chosen in the tab; **not uploaded**) |
| bam-readcount tables instead of BAMs | stage commands only | no | yes (`<patient>-<n>_RG_readcount.txt`, `.txt`/`.tsv`/`.gz`) |
| Dates | file or `--samples` | file, table with editable cells, or pasted | file or pasted; editable table |
| GenBank file(s) | yes | yes | yes |
| FASTA + gene list | yes | yes | yes |
| Own consensus (+ annotated genome) | yes (`minimap2`) | yes (`minimap2`) | **no** (no `minimap2` in the browser) |
| NCBI accession / virus name / BAM header | yes (internet) | yes (internet) | **no** (nothing leaves your computer except the Python runtime) |
| One BAM per genome fragment (`--fragments`) | yes | yes | no |
| Size | no limit set | up to 2000 samples | warning above 50 MB of tables or 150 MB of BAMs; one analysis at a time; tested with Chrome |

Both web pages stop in the same way as the command line (same engine, same messages).

## 9. Where to find ready-made inputs

`examples/simulated/` and `examples/real/` each hold BAMs, a dates file and the matching reference, with the expected counts in `expected_output/`. Three of the real ones have several patients in one run (`hiv1_three_patients`, `norovirus_P15_P17`, `sars2_freiburg_kemp`): use them as a template for your own `bams/` folder and `dates.tsv`.

## 10. From FASTQ to the BAM files SRASel needs

SRASel starts from **aligned reads** (one BAM per sample). If you only have FASTQ files, align them to the reference you will give SRASel. With the tools installed by `environment.yml` (short Illumina reads, paired-end):

```bash
# 1) the reference: a GenBank file you already have, or one downloaded from NCBI (needs internet)
srasel prepare-reference --refs my_reference.gb --outdir reference            # or: --refs NC_045512.2 --email you@example.org
# 2) align each sample to reference/reference.fna and sort it
mkdir -p bams
minimap2 -ax sr reference/reference.fna sample1_R1.fastq.gz sample1_R2.fastq.gz | samtools sort -o bams/P1-1.bam -
samtools index bams/P1-1.bam
```

Repeat step 2 for every sample (name them `<patient>-<n>.bam`, or give the patient in the dates file). Single-end reads: one FASTQ. Then run SRASel with the same reference you aligned to:

```bash
srasel run --bams bams --dates dates.tsv --ref-file my_reference.gb --out srasel_out --seed 1
```

* The reads must be aligned to the **same sequence** SRASel uses as reference (contig name, length and checksum are compared before counting). Any aligner is fine (`bwa mem`, `bowtie2`, …) if the BAM header names that sequence.
* For amplicon data (ARTIC, …) trim the primers first (for example `ivar trim`); SRASel does not do it.
* This recipe (minimap2 `-ax sr`) was run on public short reads and checked with `srasel run --check-only`. **Long-read data (Nanopore, PacBio) were not tested with SRASel.**

## How this was checked

Each row marked "stops" or "ignored" above was produced by running `srasel run --check-only` on a small copy of the phiX example with that one input changed (23 cases: baseline, no index, two-column dates, comma-separated dates, missing and extra rows, five date formats, bad dates, wrong reference, text file as BAM, truncated BAM, a FASTA as GenBank, duplicate BAM, `.sam`, 2-patient files, renamed contigs with and without `--alias`). Date formats and sample-id rules were checked by calling the parser on 20 date lists and 11 naming cases. The scripts are `validation/C_software/scripts/input_formats_probe.py` and `input_formats_dates_ids.py`; the automated checks are in `tests/unit/test_input_validation.py` and `tests/regression/test_robustness.py`. Not tested: Windows paths, CRAM, long reads, files above a few hundred MB per BAM in the online page.
