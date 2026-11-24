# Command line reference

`srasel -h` lists the commands, `srasel <command> -h` prints the built-in help of each one. Everything below was read from that help.

## Commands

| Command | What it does |
|---|---|
| `srasel run` | the whole analysis from BAM files (steps 0 to 7); the recommended entry point |
| `srasel web` | the local web page ([WEB.md](WEB.md)) |
| `srasel doctor` | checks that `samtools`, `bam-readcount` and `minimap2` are found on the `PATH` |
| `srasel prepare-reference` | step 0: the reference (FASTA, genes, reading model) from NCBI accessions or from your own GenBank |
| `srasel transfer-annotation` | step 0b: copy the annotation of a related genome onto your own consensus (needs `minimap2`) |
| `srasel make-genbank` | FASTA + gene list (TSV or GFF3) to an annotated GenBank file |
| `srasel integrity` | step 3: coverage, dates and sample names of the bam-readcount tables |
| `srasel build-tables` | step 4: the position x time matrix of one patient |
| `srasel annotate` | step 5: gene, codon and amino acid of every position |
| `srasel selection` | step 6: slopes, permutation p-values and labels (see the known problem below) |
| `srasel report` | step 7: the self-contained interactive `report.html` |
| `srasel count-bam` | counts a BAM with pysam in the `bam-readcount` table format ([BAM_COUNTER.md](BAM_COUNTER.md)); needs `pip install -e '.[pysam]'` |

Run the stage commands only if you want to repeat or inspect one step; `srasel run` calls them for you in this order.

## Pipeline stages (what `srasel run` does)

1. **Samples:** `--samples` (TSV: bam, patient, date, optional fragment) or `--bams` + `--dates`. Sample ids are `<patient>-<n>` in date order (`1a`/`1b` = replicates of one date). The dates file is read in any format; the whole file decides day/month versus month/day.
2. **BAM preparation:** each BAM is linked into `OUT/work/bams`; an index is created if it is missing, and a sorted **copy** is made if the BAM is not coordinate-sorted. Your BAMs are never modified.
3. **Reference:** GenBank (`--ref`, `--ref-file`, `--virus`), FASTA + gene list (`--fasta --genes`) or a consensus with the annotation transferred by `minimap2` (`--consensus`). Written to `OUT/reference/` (`reference.fna`, `contigs.tsv`, `cds_model.tsv`, `features.tsv`, `REFERENCE_REPORT.txt`).
4. **Checks before counting** (`[3]` in the log): contig names, lengths and `M5` checksums against the reference; the rate of differences between reads and reference (`samtools stats`); reads per contig. A problem stops the run with exit code 2. `--check-only` stops here.
5. **Step 2, counting:** `bam-readcount -q 20 -b 20 -w 0` per sample, in parallel over samples (`--threads`), into `processing/02_rc/<id>_RG_readcount.txt`.
6. **Step 3, integrity:** at least 97 % of the reference positions covered, at least 3 dates, replicates grouped; into `processing/03_integrity_checked/<patient>/`.
7. **Step 4, matrices:** the position x time matrix of each patient (`processing/04_position_time_matrices/`).
8. **Step 5, annotation:** gene, codon and amino acid from the reading model (`processing/05_annotated_tables/`).
9. **Step 6, selection:** zero-filled frequencies, weighted slope, Δf, permutation p-value, labels, figures (`processing/06_selection_analysis/`).
10. **Step 7, report:** `report.html`, and `SUMMARY.md` at the end of the run.

Stages 3 to 7 run as sub-processes of the engine file itself; the web pages show the stage titles printed in the log (`Step N · …`). The detailed audit of this order is in [validation/A_scientific/earlier/AUDIT.md](../validation/A_scientific/earlier/AUDIT.md).

## `srasel run`: every option

Give either `--samples`, or `--bams` + `--dates`. Give at most one reference option (when several are given, the order of priority is the order of the second table).

**Your data**

| Option | What it does |
|---|---|
| `--samples FILE` | tab-separated table `bam <TAB> patient <TAB> date` (a 4th column `fragment` only with `--fragments`) |
| `--bams FOLDER_OR_FILES…` | folder(s) with the BAM files (subfolders are searched) or `.bam` files; can be repeated |
| `--dates FILE` | with `--bams`: one row per BAM, `BAM name without .bam <TAB> date [<TAB> patient]`; any date format ([INPUT_FORMATS.md](INPUT_FORMATS.md#4-dates)) |
| `--patient NAME` | with `--bams`: the patient name, when all BAMs are the same patient and are not named `<patient>-<n>` |

**Reference** (see [INPUT_FORMATS.md](INPUT_FORMATS.md#5-reference) for the rules; the reference must be the sequence your BAMs were aligned to)

| Option | What it does |
|---|---|
| `--ref ACC[,ACC…]` | NCBI accession(s), comma-separated, one per segment. Needs internet and `--email` |
| `--ref-file FILE.gb [FILE2.gb…]` | your own annotated GenBank file(s); works offline. One file per segment, or one file with all the records |
| `--fasta REF.fa --genes LIST` | your sequence without a GenBank plus a gene list (TSV or GFF3); offline. One FASTA and one list for the whole genome (join segments with `cat`) |
| `--consensus CONS.fa` | the BAMs were aligned to your own consensus; use with `--consensus-source`. Needs `minimap2` |
| `--consensus-source ACC_or_FILE.gb…` | annotated record(s) of a related virus from which the genes are copied onto the consensus; one per segment |
| `--virus "NAME"` | searches NCBI for the RefSeq record(s) that fit your BAMs (same contigs and lengths); asks you if several fit. Needs internet and `--email` |
| *(none of the above)* | the contig names of the BAM header are used if they are NCBI accessions. Needs internet |
| `--fragments TABLE` | when each sample is several BAMs (one per genome fragment); needs `--samples` with a 4th column `fragment`. Rare |
| `--alias BAM_NAME=REF_NAME` | a contig is called differently in the BAM and in the reference; can be repeated |
| `--email YOU@EXAMPLE.ORG` | contact e-mail that NCBI asks for on downloads (or the variable `NCBI_EMAIL`) |

**Analysis and execution**

| Option | Default | What it does |
|---|---|---|
| `--out FOLDER` | `srasel_out` | where the results go. A folder that already holds an analysis is refused (use `--resume` or another name) |
| `--nperm N` | 2000 | permutations of the p-value test; the smallest p is about 1/(N+1) |
| `--freq-delta X` | 0.03 | smallest \|Δf\| (fitted change over the follow-up) that is tested and labelled |
| `--seed N` | 1 | seed of the permutations: the same input always gives the same p-values |
| `--threads N` | half of the cores | CPU cores to use; does not change the results |
| `--check-only` | off | run only the checks (BAMs against reference, dates) and stop |
| `--no-report` | off | skip step 7 (the HTML report) |
| `--resume` | off | continue in the same `--out`: every count and finished stage with the same inputs and parameters is reused |
| `--yes` | off | never ask a question (if in doubt it stops); use it in scripts |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | all went well |
| `2` | something in your input or options is wrong (the message says what and what to do) |
| `130` | interrupted with Ctrl+C |
| `1` | a file-system problem |

## Reproducibility, threads and resume

* `--seed` (default 1) fixes the permutation p-values: each variant gets its own random generator derived from the seed, its position and its allele. The p-values therefore do not depend on `--threads` (checked with 1 and 4). Change the seed to see how much labels with p close to 0.05 move.
* `--threads` only decides how many samples are counted at the same time and how many cores the permutation step uses.
* `--resume` reuses a finished step only when its inputs and parameters are unchanged: they are fingerprinted (BAM path, size and modification time, the reference, the dates, `--alias`, `--nperm`, `--seed`, `--freq-delta`, and the versions of the program, `samtools` and `bam-readcount`). Whatever changed is redone, together with the stages after it. The same applies after a `Ctrl+C`, a time limit or a power cut.
* The shipped golden outputs were identical byte by byte across two sets of library versions (see [CHANGES_PACKAGING.md](CHANGES_PACKAGING.md#numerical-stack)).

## Example commands

```bash
# BAMs in a folder named P1-1.bam, P1-2.bam…; dates in dates.tsv; your GenBank file; 8 cores
srasel run --bams bams/ --dates dates.tsv --ref-file reference.gb --out results --threads 8 --seed 1

# download the reference from NCBI by accession (needs internet)
srasel run --bams bams/ --dates dates.tsv --ref NC_045512.2 --email you@example.org --out results

# reads aligned to your own consensus; the genes are copied from a related virus
srasel run --bams bams/ --dates dates.tsv --consensus consensus.fa --consensus-source NC_007366.1 --out results

# only check that everything fits
srasel run --bams bams/ --dates dates.tsv --ref-file reference.gb --out check --check-only

# continue an interrupted run
srasel run --bams bams/ --dates dates.tsv --ref-file reference.gb --out results --resume
```

## Known problem: `srasel selection` alone

The single step `srasel selection`, run by hand with its default `-j -1` ("all cores"), stops with `too many values to unpack (expected 4)`. With `-j 1` or `-j 2` (or more) it works (`-j 0` also fails, with a different error: `ZeroDivisionError`). `srasel run`, the local web page and the online page always pass an explicit number of cores and are not affected. If you run `srasel selection` yourself, add `-j 4` or `-j 1`. Details: [validation/VALIDATION_REPORT.md](../validation/VALIDATION_REPORT.md) §7.

## Docker (untested: no Docker on the dev machine)

The `Dockerfile` has been written but never built or run: the development machine has no Docker. The steps below are what it is meant to do; the first build is the test. If something fails, the likely places are the `mambaorg/micromamba` tag, the `bioconda` packages for your CPU (`bam-readcount` has no Apple-Silicon build on bioconda; use `--platform linux/amd64`) and the file permissions of the mounted folder.

The image is meant to contain Python 3.12, `samtools`, `bam-readcount`, `minimap2` (`docker/conda-tools.yml`) and the `srasel` package installed with `pip install '.[web,pysam]'`. No data is in the image.

```bash
docker build -t srasel .
docker run --rm srasel doctor           # should list samtools, bam-readcount and minimap2 as found
```

Command line: mount the folder with your BAM files on `/data`; relative paths then work inside it and the results are written there. The paths inside a samples table must be as seen inside the container (`/data/...`) or relative to `/data`.

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/data srasel run \
    --samples samples.tsv --ref NC_045512.2 --email you@example.org --out srasel_out --threads 8 --seed 1
```

Local web page:

```bash
docker run --rm --user "$(id -u):$(id -g)" -p 127.0.0.1:8765:8765 -v "$HOME":/data srasel \
    web --host 0.0.0.0 --i-understand-the-risk --no-browser --allowed-root /data --workdir /data/srasel_web_runs
```

Open the link it prints, replacing `0.0.0.0` by `127.0.0.1`. `--host 0.0.0.0` is needed inside the container and `srasel web` accepts it only with `--i-understand-the-risk`; what keeps the page private is `-p 127.0.0.1:8765:8765`, which publishes the port only on your own computer (never publish it as `-p 8765:8765`). Keep the same port number on both sides (the page checks the `Host` header). The file browser only sees what you mount; paths in the web form are the ones inside the container.

Clusters usually offer Apptainer/Singularity instead: `apptainer build srasel.sif docker-daemon://srasel:latest`, then `apptainer exec --bind $PWD:/data srasel.sif srasel run …`. Not tested.
