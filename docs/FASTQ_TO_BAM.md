# From FASTQ to the BAM files SRASel needs

SRASel starts from **aligned reads** (one BAM per sample). If you only have FASTQ files, align them to the reference you will give SRASel. With the tools
installed by `environment.yml` (short Illumina reads, paired-end):

```bash
# 1) the reference: a GenBank file you already have, or one downloaded from NCBI (needs internet)
srasel prepare-reference --refs my_reference.gb --outdir reference            # or: --refs NC_045512.2 --email you@example.org
# 2) align each sample to reference/reference.fna and sort it
mkdir -p bams
minimap2 -ax sr reference/reference.fna sample1_R1.fastq.gz sample1_R2.fastq.gz | samtools sort -o bams/P1-1.bam -
samtools index bams/P1-1.bam
```

Repeat step 2 for every sample (name them `<patient>-<n>.bam`, e.g. `P1-1.bam`, `P1-2.bam`, or give the patient in the dates file). Single-end reads: one FASTQ.
Then run SRASel with the same reference you aligned to:

```bash
srasel run --bams bams --dates dates.tsv --ref-file my_reference.gb --out srasel_out --seed 1
```

Notes
* The reads must be aligned to the **same sequence** SRASel uses as reference (contig name, length and checksum are compared before counting). Any aligner is fine (`bwa mem`, `bowtie2`, …) if the BAM header names that sequence.
* For amplicon data (ARTIC, …) trim the primers first (for example `ivar trim`); SRASel does not do it.
* This recipe (minimap2 `-ax sr`) was run on public short reads and checked with `srasel run --check-only`. **Long-read data (Nanopore, PacBio) were not tested with SRASel.**
