# BAM counter without bam-readcount (`srasel.bamcount`)

Step 2 of SRASel turns each BAM into a per-position table. `srasel run` does it with `bam-readcount -q 20 -b 20 -w 0` and that is still the
reference method. `src/srasel/bamcount.py` reproduces that table with **pysam only**, for the places where `samtools` and `bam-readcount` cannot run:
Browser Mode (WebAssembly) and installs without conda.

* Command line: `srasel count-bam sample.bam --fasta reference.fna --out sample_RG_readcount.txt` (needs `pip install -e '.[pysam]'` from the repository folder).
* Browser Mode: load BAM files instead of tables; they are read in place (not copied into memory, not uploaded).
* `srasel run` does **not** use it. It is an alternative, not a replacement.

Full validation (versions, commands, edge cases, 39 real BAMs, downstream, Pyodide): `validation/B_bam/BAM_READCOUNT_COMPARISON.md`.

## What it does (rules of bam-readcount 1.0.1, found by comparison; each one has an edge case in `tests/regression/test_bamcount_edge.py`)
* Reads with flag 0x4, 0x100, 0x200 or 0x400 never enter the pileup: not counted, their positions are not printed, they take no buffer node.
  Supplementary reads (0x800) are counted. Reads with MAPQ < 20 are not counted but the positions they cover are printed (depth 0).
* A base counts if its base quality is ≥ 20. No overlap correction, no orphan filter; strand = read strand. A read without stored qualities
  (QUAL `*`, 0xFF) counts as quality 255 (bam-readcount reads the raw byte). A `=` in SEQ is counted in the `=` entry (SRASel adds it to the reference base).
  IUPAC codes in reads count as N.
* Insertion = `+SEQ` at the anchor base; deletion = `-SEQ` at the first deleted position (the read adds to the depth there; the other deleted positions are
  printed with what other reads give); both need the anchor base to pass the quality filter. `M P I` is an insertion (htslib looks through the padding);
  an insertion at the very start of a read or after a soft clip has no anchor and is not reported. No left-alignment: indels stay where the CIGAR puts them.
* Positions spanned by `N` (reference skip) are printed with depth 0.
* The reference base and the deleted bases are printed **as in the FASTA** (a soft-masked `acg` stays lower case). The `reference.fna` that SRASel writes is upper case.
* **Buffer cap.** The pileup keeps at most 8000 nodes: a read that starts at the current pileup position (= the start of the previous read kept) is dropped
  when more than 8000 nodes are allocated (live reads + 1 spare). With amplicon data this really happens: `KEMP-11b` loses up to 2,732 bases at 501
  positions (0.8 M of 52 M counted bases), `KEMP-15b` up to 1,027 at 669 positions. The counter reproduces the rule (`MAX_BUFFER`).
* Means (MAPQ, base quality) are printed as single-precision numbers with two decimals, like `bam-readcount`.
* The BAM must be coordinate-sorted. bamcount stops with an explanation on an unsorted BAM (bam-readcount silently stops counting at the first
  out-of-order read; `srasel run` sorts first), on a truncated or corrupt BAM (bam-readcount prints a partial table and exits 0), on a file that is not a BAM,
  and when a contig of the BAM is missing from the FASTA or has another length. No partial table is ever written.

Written by the counter: reference base, depth, counts per base (`=`, A, C, G, T, N), strand split, mean MAPQ, mean base quality, and the indel entries.
Written as 0.00: the other `bam-readcount` columns. In bam-readcount 1.0.1 only two of them carry values, `avg_se_mapping_quality` and
`avg_num_mismatches_as_fraction` (the position-in-read, q2, clipping and 3′-distance columns are 0.00 in its own output on all data tested).
SRASel does not read them (`engine.parse_readcount_line` uses the reference base, the depth, the base counts and the indel entries), so the file is **not a
byte-for-byte copy** of `bam-readcount`'s output, but everything SRASel reads is identical.

## Evidence (2026-11-10; details and reproduction in validation/B_bam/)
1. **Edge-case battery** (34 synthetic BAMs: coverage 0/1/40, contig ends, MAPQ 0/19/20/21/255, base quality 0/19/20/21, N/IUPAC/`=` bases, indels of 1/3/10,
   adjacent indels, S/H/N/=/X/P CIGARs, all flags, overlapping mates, homopolymer indels, 3 contigs, read groups, missing qualities, lower-case/IUPAC
   reference, > 8000 reads at one start with and without masked reads, unsorted, unindexed, empty, truncated, corrupt, wrong reference): the 23 valid cases equal
   `bam-readcount` and an independent expectation computed from the read specifications (not from the BAM); the damaged / unsorted / mismatched ones are refused.
2. **39 real BAMs, counted fresh by both programs** (SARS-CoV-2 Freiburg 9 + Kemp 2, norovirus P5 7 + P20 7 + P15 + P17, HIV-1 9 (bwa to HXB2, bwa to the patient
   consensus, original stampy BAMs), influenza A/H3N2 3 (8 segments, NovaSeq); 595 MB, 16.8 M records, 506,931 positions): every printed position, reference
   base, depth, per-base count, strand split, mean MAPQ/base quality and indel entry identical, 39 of 39. Only the two columns above differ.
3. **Whole analysis** (Freiburg, norovirus P5; 2000 permutations, seed 1): matrices, annotated tables, all step-6 tables and the report data are identical
   whether the counts come from `bam-readcount` or from bamcount.
4. **Pyodide** (pysam 0.23.0, htslib 1.21): the same tables as native bamcount (byte-identical) on the edge cases and on real BAMs.
5. Earlier: 47 real SARS-CoV-2 BAMs against stored tables (`tests/regression/compare_counter_real.py`); synthetic phiX through the browser runner (`test_browser_bams.py`).

## Limits (not tested)
* Long reads (ONT/PacBio), CRAM, BAMs with CSI-only indexes of very long contigs, reads with SEQ `*` on primary alignments (bam-readcount reads past the
  record there: undefined behaviour, not reproduced; bamcount counts nothing for them).
* The two filled statistics columns (`avg_se_mapping_quality`, `avg_num_mismatches_as_fraction`) are not reproduced.
* The 8000 rule and the other rules reproduce the installed `bam-readcount` 1.0.1 (bioconda build hd576cc4_2); another build could differ.
* Speed: about 10 s per 235,000 reads natively (0.8–1.7× the time of bam-readcount on the 39 real BAMs); in WebAssembly slower (measured values in BROWSER_MODE.md).
