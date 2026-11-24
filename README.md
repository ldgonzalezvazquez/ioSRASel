# SRASel

**Find viral variants that change in a consistent direction inside one patient over time.**

You give SRASel sequencing data (BAM files) from **the same patient on several dates**. It reports which positions of the virus genome rise or fall in frequency along the follow-up — in which gene, at which codon, and what amino-acid change that means. It works for any virus (DNA or RNA, segmented or not) because gene names come from the reference GenBank annotation.

> A label from SRASel marks a **directional change in frequency**. It does **not** by itself prove biological selection.

**Live site:** [https://ldgonzalezvazquez.github.io/ioSRASel/](https://ldgonzalezvazquez.github.io/ioSRASel/)

---

## What you need

For each patient:

1. **BAM files** — aligned reads, one sample per date (at least **3 different dates**; 5 or more is better).
2. **Sampling dates** — a small dates file or table that links each sample to its date.
3. **A reference with genes** — usually a GenBank (`.gb`) file for the genome your BAMs were aligned to.

Your files stay on your computer (or inside your browser tab). Nothing is uploaded to a SRASel server.

---

## Three ways to run it

The same analysis engine is available in three ways. Pick the one that fits your data. All three are described on the [site landing page](https://ldgonzalezvazquez.github.io/ioSRASel/).

| | **1 · Online (browser)** | **2 · Local web interface** | **3 · Command line** |
|---|---|---|---|
| **Best for** | trying SRASel, or a small analysis, with nothing installed | preferring buttons to typing, with real data on your machine | many samples, clusters, scripts, reproducible runs |
| **Install** | nothing (a recent web browser; Chrome recommended) | conda + SRASel on your computer | conda + SRASel on your computer |
| **Input** | BAM files **or** bam-readcount tables | BAM files | BAM files |
| **Do my files leave my computer?** | **No** — they are read inside your browser tab | **No** | **No** |
| **Speed** | slower; can hit browser memory limits | full speed | full speed (recommended for large jobs) |
| **Status** | experimental | tested | recommended for real studies |

### 1 · Run in the browser (experimental)

Open the site and choose **Open the browser runner**. Nothing to install; the first visit downloads a Python runtime into the tab (~50 MB). After that, your BAM files or bam-readcount tables, dates file, and GenBank reference are processed locally in the browser.

Good for demos and small data sets. Large inputs or many permutations can be slow or fail for lack of memory — use way 2 or 3 then.

### 2 · Local web interface (`srasel web`)

A graphical page served only on your own machine. It reads BAM files where they are and runs the full pipeline with the native tools. Install and start steps are on the [landing page](https://ldgonzalezvazquez.github.io/ioSRASel/) under **Run with Local Python: web interface**.

### 3 · Command line (`srasel run`)

The reference way for real data: BAM files in, results out, several cores, resumable, suitable for clusters. Install and example commands are on the [landing page](https://ldgonzalezvazquez.github.io/ioSRASel/) under **Command line**.

Results typically include tables, plots, `report.html`, and `SUMMARY.md`.

---

## Which one should I use?

- Real data, many samples, long jobs → **command line**.
- You prefer buttons but have the BAM files on your computer → **local web interface**.
- You only want to try the analysis, or you have a small data set and nothing installed → **browser**.

All three run the same scientific engine.

---

## About this repository

This public repository hosts the **GitHub Pages** site (folder `docs/` on branch `main`): the landing page and the experimental browser runner. It does not contain API keys or secrets.

For full installable source, packaging, and development history, see the related private repository `ioSRASelDEV` (same account), when you have access.
