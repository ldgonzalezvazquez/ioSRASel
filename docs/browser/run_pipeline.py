"""SRASel browser mode: the pipeline from bam-readcount tables, orchestrated in-process.

This module contains NO scientific code. It calls the real stage functions of `srasel.engine`
(`engine.COMMANDS[...]`) with the same arguments and in the same order as `engine.pipeline()` uses for
`srasel run` (steps 3-7; step 0 = reference from a GenBank file, or from a FASTA + gene list as `srasel run --fasta --genes`):

    [make-genbank     --fasta F --genes G -o reference_input.gb]      (only with a FASTA and a gene list, as engine.build_reference)
    prepare-reference --refs <gb...> --outdir reference
    integrity         --ref-dir reference
    build-tables      <patient dir> --ref-dir reference            (per patient)
    annotate          --tsv-dir ... --ref-dir reference --out-dir ...
    selection         <*_genes.tsv> --outdir ... --times dates.tsv --nperm N --jobs 1 --seed S
                      --freq-delta D --thr-clear 0.95 --first-k-min 10
    report            --ref-dir reference --processing processing -o report.html --freq-delta D --nperm N

Differences with `engine.pipeline()` (only how the stages are launched):
  * stages run in the current process (sys.argv is set, SystemExit raised by `fail()` is caught) instead
    of `[python, engine.py, stage, ...]` subprocesses; Pyodide cannot start processes;
  * --jobs is always 1 (no multiprocessing in WebAssembly; joblib then runs sequentially in-process);
  * step 2 (samtools / bam-readcount, BAM -> table) is NOT done: the input is the table that
    `bam-readcount -q 20 -b 20 -w 0` writes, one file per sample, `<sample>_RG_readcount.txt`.

Works with plain CPython and with Pyodide. Command line (native check):

    python browser/run_pipeline.py --tables DIR --dates dates.tsv --gb ref.gb [--gb ref2.gb] --out OUT \
           [--nperm 200] [--seed 1] [--freq-delta 0.03] [--no-report] [--patient NAME] [--alias BAM=REF]
    (the reference can also be --fasta F --genes G instead of --gb)
"""
from __future__ import annotations

import contextlib
import gzip
import io
import json
import os
import re
import shutil
import sys
import tempfile
import time
import traceback
import types
import zipfile
from pathlib import Path

DEFAULTS = dict(nperm=2000, seed=1, freq_delta=0.03)       # = `srasel run` defaults
THR_CLEAR, FIRST_K_MIN = "0.95", "10"                       # literal arguments of engine.pipeline()


class StageError(RuntimeError):
    """A stage stopped (engine `fail()` -> SystemExit, or an exception). `.stage` names it, `.detail` explains."""

    def __init__(self, stage: str, detail: str):
        super().__init__(f"{stage}: {detail}")
        self.stage, self.detail = stage, detail


class _LineSink(io.TextIOBase):
    """Text sink: every complete line (split on \\n or \\r) goes to `emit(stream, line)` and to `keep`."""

    def __init__(self, stream, emit, keep):
        self.stream, self.emit, self.keep, self.buf = stream, emit, keep, ""

    def writable(self):
        return True

    def isatty(self):
        return False

    def _line(self, text):
        if text.strip():
            self.keep.append((self.stream, text))
            self.emit(self.stream, text)

    def write(self, s):
        self.buf += s
        *done, self.buf = re.split(r"[\r\n]", self.buf)
        for text in done:
            self._line(text)
        return len(s)

    def flush(self):
        self._line(self.buf)
        self.buf = ""


def _engine():
    from srasel import engine
    return engine


def sample_name(filename: str) -> str:
    """Name chosen by the user -> `<sample>_RG_readcount.txt`, which is what the integrity stage looks for."""
    n = os.path.basename(filename)
    for suf in ("_RG_readcount.txt", "_readcount.txt", ".readcounts.tsv", ".readcount.txt", ".txt", ".tsv"):
        if n.endswith(suf):
            n = n[: -len(suf)]
            break
    return n + "_RG_readcount.txt"


def assign_sample_ids(eng, entries, patient=None):
    """{sample name: sample id} exactly as `srasel run --bams F --dates D [--patient NAME]` decides it: the engine's own `load_samples` is run on
    empty placeholder files named after the samples, so the patient (3rd column of the dates file, else <patient>-<n> in the name, else
    --patient), the numbering of the dates (<patient>-1, -2, ... by date, replicates P1-3a, P1-3b) and every message come from the engine.
    entries = [(sample name, date, patient column or '')]."""
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        (td / "bams").mkdir()
        lines = []
        for k, d, pc in entries:
            (td / "bams" / f"{k}.bam").write_bytes(b"")
            lines.append(f"{k}\t{d.isoformat()}" + (f"\t{pc}" if pc else ""))
        (td / "dates.tsv").write_text("\n".join(lines) + "\n", encoding="utf-8")
        rows = eng.load_samples(types.SimpleNamespace(samples=None, bams=[str(td / "bams")], dates=str(td / "dates.tsv"), patient=patient))
    return {eng.stem_of(r["bam"].name): r["sid"] for r in rows}


def write_dates(dates_text: str, dest: Path, samples=None, patient=None, rename=None) -> int:
    """dates file (any layout `srasel run --dates` accepts) -> `<sample id>\\t<dd/mm/yy>` like engine.pipeline() writes it.
    Uses the engine's own parser (`read_dates_file`, `parse_dates`). Returns the number of dates.

    `samples` (the sample names of the given tables/BAMs): names are matched like `srasel run --bams` does (`load_samples`: the name
    without .bam, exact or ignoring case); a sample without a date stops the run, as on the command line ("BAM without a date"). Before (found
    by the audit, validation/C_software), a case difference dropped the sample silently. With `samples`, the sample ids are then assigned by the
    engine (assign_sample_ids: patient from the 3rd column of the dates file, from the name <patient>-<n>, or `patient`; ids renumbered by date) and
    the file is written with those ids; `rename` (a dict, filled in) receives {sample name: sample id}."""
    eng = _engine()
    tmp = dest.with_suffix(".input")
    tmp.write_text(dates_text, encoding="utf-8")
    try:
        rows = eng.read_dates_file(tmp)
        ds = eng.parse_dates([r[1] for r in rows], "dates file")
    finally:
        tmp.unlink()
    out = []
    if samples is None:
        out = [(r[0], d, "") for r, d in zip(rows, ds)]
    else:
        by_lower = {s.lower(): s for s in samples}
        used = set()
        for r, d in zip(rows, ds):
            k = eng.stem_of(r[0])
            k = k if k in samples else by_lower.get(k.lower())
            if k is None:
                eng.warn(f"dates file: “{r[0]}” does not match any table or BAM (ignored).")
                continue
            used.add(k)
            out.append((k, d, r[2] if len(r) >= 3 and r[2] else ""))
        missing = sorted(set(samples) - used)
        if missing:
            eng.fail(f"{len(missing)} sample(s) without a date in the dates file: {', '.join(missing[:6])}{'…' if len(missing) > 6 else ''}",
                     "each sample needs its date; the name (without .bam / _RG_readcount.txt) must match the first column of the dates file.",
                     "add those rows, or remove the files you do not want to analyze")
        ids = assign_sample_ids(eng, out, patient)
        if rename is not None:
            rename.update(ids)
        out = [(ids[k], d, "") for k, d, _ in out]
    # same text as engine.pipeline(): engine.format_dmy when the engine has it (4-digit year outside 2000-2068), else dd/mm/yy
    fmt = getattr(eng, "format_dmy", None) or (lambda d: f"{d.day:02d}/{d.month:02d}/{d.year % 100:02d}")
    with open(dest, "w") as fo:
        for k, d, _ in out:
            fo.write(f"{k}\t{fmt(d)}\n")
    return len(out)


def parse_alias(alias):
    """['BAM=REF', ...] -> {BAM: REF}, as `srasel run --alias` (repeatable) reads it; a malformed entry stops the run with an explanation."""
    out = {}
    for x in alias or []:
        k, sep, v = str(x).partition("=")
        if not sep or not k.strip() or not v.strip():
            raise StageError("inputs", f"the alias “{x}” is not BAM_NAME=REFERENCE_NAME (the name of the sequence in your BAM files, an equals sign, "
                                       "its name in the reference)")
        out[k.strip()] = v.strip()
    return out


def run_from_tables(tables, dates_text, genbanks, nperm=DEFAULTS["nperm"], seed=DEFAULTS["seed"],
                    freq_delta=DEFAULTS["freq_delta"], workdir="srasel_work", on_event=None, make_report=True,
                    keep_inputs=False, bams=None, patient=None, alias=None, fasta=None, genes=None, genes_name="genes.tsv"):
    """Run the pipeline on bam-readcount tables and/or BAM files.

    bams        {sample name: path of a BAM}  counted here with srasel.bamcount (pysam) instead of bam-readcount, after the
                                              reference is prepared; see docs/BAM_COUNTER.md

    patient     str                   `--patient`: patient of every sample whose name is not <patient>-<n> and that has no patient in the dates file
    alias       ['BAM=REF', ...]      `--alias`: name of a sequence in the BAM files = name in the reference (repeatable)

    tables      {file name: bytes}  one per sample (a `.gz` suffix = gzip-compressed, decompressed here)
    dates_text  str                 sample <TAB> date (any common date format)
    genbanks    [bytes | str]       one GenBank file per reference (several records in a file = segmented virus)
    fasta, genes  bytes | str         instead of genbanks: the sequence and the gene list (TSV table or GFF3, see `srasel make-genbank -h`);
                                      the GenBank is made with the engine's make-genbank, as `srasel run --fasta --genes` does.
                                      genes_name: file name of the gene list (its extension .gff/.gff3 tells a GFF3 from a table)
    on_event    callable(kind, text), kind in:
                  "stage"  a stage starts (text = title)         "out" / "err"  a line the engine printed
                  "time"   a stage ended (text = "<stage>: <s> s")
                  "plan"   once, before the first stage: JSON list of the stage titles that will run, in order
    Returns {relative path: bytes} of everything produced (as in the output folder of `srasel run`, plus commands.log).
    Raises StageError when a stage stops: the message is the engine's own explanation.
    """
    eng = _engine()
    emit = on_event or (lambda kind, text: None)
    alias_map = parse_alias(alias)
    log, t_start = [], time.time()
    root = Path(workdir).resolve()
    if root.exists() and any(root.iterdir()):
        raise StageError("inputs", f"the work folder {root} is not empty (choose a new one)")
    (root / "processing" / "02_rc").mkdir(parents=True)
    (root / "reference_input").mkdir()

    # Stage titles, defined once: the same text is announced in the "plan" event (so a page can list the stages before they run) and in "stage".
    titles = dict(ref="Step 0 · reference from the FASTA and the gene list" if (fasta is not None or genes is not None) else "Step 0 · reference from the GenBank file",
                  count="Step 2 · per-position count from BAM (pysam; same rules as bam-readcount -q20 -b20)",
                  tables="Steps 3-5 · integrity, position × time matrices and annotation",
                  sel=f"Step 6 · SRASel selection ({nperm} permutations, seed {seed}, 1 job)",
                  report="Step 7 · HTML report")

    def stage(title):
        log.append(("stage", title))
        emit("stage", title)

    def call(name, args):
        """One engine stage in-process. The stage reads sys.argv exactly as it does from the command line."""
        args = [str(a) for a in args]
        fn = eng.COMMANDS[name][0]
        log.append(("cmd", f"$ srasel {name} " + " ".join(args)))
        mark = len(log)                                           # lines printed from here on belong to this stage
        out, err = _LineSink("out", emit, log), _LineSink("err", emit, log)
        saved_argv, t0 = sys.argv, time.time()
        sys.argv = [f"srasel.py {name}"] + args
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                try:
                    fn()
                finally:
                    out.flush()
                    err.flush()
        except SystemExit as ex:                                  # engine.fail() -> exit code 2
            if ex.code not in (None, 0):
                why = ex.code if isinstance(ex.code, str) else "\n".join(l.strip() for s, l in log[mark:] if s == "err")
                raise StageError(name, why or f"exit code {ex.code}") from None
        except Exception as ex:                                   # a bug or an environment limit: keep the traceback
            raise StageError(name, f"{type(ex).__name__}: {ex}\n{traceback.format_exc(limit=8)}") from ex
        finally:
            sys.argv = saved_argv
        log.append(("time", f"{name}: {time.time() - t0:.2f} s"))
        emit("time", f"{name}: {time.time() - t0:.2f} s")

    prev = os.getcwd()
    os.chdir(root)
    try:
        # ---- inputs ---------------------------------------------------------------------------------------
        seen = {}
        for fname, data in tables.items():
            data = bytes(data)
            if fname.lower().endswith(".gz"):
                data, fname = gzip.decompress(data), fname[:-3]
            dest = sample_name(fname)
            if dest in seen:
                raise StageError("inputs", f"{fname} and {seen[dest]} map to the same sample name {dest}")
            seen[dest] = fname
            (root / "processing" / "02_rc" / dest).write_bytes(data)
        bams = dict(bams or {})
        for sample in bams:
            if sample_name(sample) in seen:
                raise StageError("inputs", f"{sample} was given both as a table and as a BAM")
        if not seen and not bams:
            raise StageError("inputs", "no bam-readcount tables or BAM files were given")
        fasta_file = genes_file = None
        if fasta is not None or genes is not None:
            if genbanks:
                raise StageError("inputs", "give either GenBank file(s) or a FASTA with a gene list, not both")
            if fasta is None or genes is None:                    # the message of engine.build_reference
                raise StageError("inputs", "To annotate from a list, both the FASTA and the gene list are needed (you gave only one of the two). "
                                 "What to do: pass the sequence and the gene list or GFF3, or a GenBank file")
            ext = Path(genes_name).suffix.lower()
            fasta_file = root / "reference_input" / "sequence.fa"
            genes_file = root / "reference_input" / ("genes" + (ext if ext in (".gff", ".gff3", ".tsv", ".txt") else ".tsv"))
            fasta_file.write_bytes(fasta.encode() if isinstance(fasta, str) else bytes(fasta))
            genes_file.write_bytes(genes.encode() if isinstance(genes, str) else bytes(genes))
        elif not genbanks:
            raise StageError("inputs", "no GenBank reference was given")
        gbs = []
        for i, g in enumerate(genbanks or [], 1):
            p = root / "reference_input" / f"reference{i}.gb"
            p.write_bytes(g.encode() if isinstance(g, str) else bytes(g))
            gbs.append(p)
        if fasta_file is not None:
            gbs = [root / "reference_input.gb"]
        # the stages that will run, in order (JSON list of titles); a page shows them as "waiting" until each one starts
        emit("plan", json.dumps([titles["ref"]] + ([titles["count"]] if bams else []) + [titles["tables"], titles["sel"]]
                                + ([titles["report"]] if make_report else [])))
        out, err = _LineSink("out", emit, log), _LineSink("err", emit, log)
        mark = len(log)
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                try:
                    ids = {}
                    n_dates = write_dates(dates_text, root / "dates.tsv", patient=patient, rename=ids,
                                          samples={k[: -len("_RG_readcount.txt")] for k in seen} | {sample_name(b)[: -len("_RG_readcount.txt")] for b in bams})
                finally:
                    out.flush()
                    err.flush()
        except SystemExit as ex:                                   # engine.fail() inside the date parser
            why = ex.code if isinstance(ex.code, str) else "\n".join(l.strip() for s, l in log[mark:] if s == "err")
            raise StageError("dates", why or "the dates file could not be read") from None
        # the sample ids the engine gave (<patient>-<n> by date; identical to the file names when those already follow that rule)
        if any(k != v for k, v in ids.items()):
            rc = root / "processing" / "02_rc"
            moves = {sample_name(k): sample_name(v) for k, v in ids.items() if k != v and (rc / sample_name(k)).exists()}
            for old_name in moves:                                 # two steps, so that names can be swapped (P1-2 -> P1-1 and P1-1 -> P1-2)
                (rc / old_name).rename(rc / (old_name + ".moving"))
            for old_name, new_name in moves.items():
                (rc / (old_name + ".moving")).rename(rc / new_name)
            bams = {ids.get(k, k): v for k, v in bams.items()}
        what = "FASTA + gene list" if fasta_file is not None else f"{len(gbs)} GenBank file(s)"
        emit("out", f"{len(seen)} bam-readcount table(s), {len(bams)} BAM file(s), {n_dates} date(s), {what}")

        ref = root / "reference"
        pr = Path("processing")

        # ---- step 0: reference from the user's GenBank (as in `srasel run --ref-file`) or from FASTA + gene list (as `--fasta --genes`) ----
        stage(titles["ref"])
        if fasta_file is not None:
            call("make-genbank", ["--fasta", fasta_file, "--genes", genes_file, "-o", gbs[0]])       # prints its warnings (length, internal stop) to the log
        call("prepare-reference", ["--refs", *gbs, "--outdir", ref])

        # ---- step 2 (BAM input only): per-position counts with pysam instead of bam-readcount ----------------
        if bams:
            from srasel import bamcount
            stage(titles["count"])
            refs = bamcount.read_fasta(ref / "reference.fna")
            for sample, bam_path in sorted(bams.items()):
                t0 = time.time()
                try:
                    n, used = bamcount.bam_to_readcount(bam_path, refs, root / "processing" / "02_rc" / sample_name(sample),
                                                        order=list(refs), alias=alias_map)
                except ValueError as ex:
                    raise StageError("count", str(ex)) from None
                except Exception as ex:                               # pysam could not read it (not a BAM, truncated, ...)
                    raise StageError("count", f"{sample}: {type(ex).__name__}: {ex}. What to do: check that it is a complete BAM "
                                     "file aligned to the reference you loaded.") from ex
                emit("out", f"{sample}: {n} positions from {used} reads ({time.time() - t0:.0f} s)")

        # ---- steps 3-5: integrity, position x time matrices, annotation (as engine.pipeline) ----------------
        stage(titles["tables"])
        call("integrity", ["--ref-dir", ref])
        (pr / "04_position_time_matrices").mkdir(exist_ok=True)
        (pr / "05_annotated_tables").mkdir(exist_ok=True)
        (pr / "06_selection_analysis").mkdir(exist_ok=True)
        pats = [d for d in sorted((pr / "03_integrity_checked").iterdir()) if d.is_dir()]
        if not pats:
            raise StageError("integrity", "no patient passes the integrity control; see the messages above "
                             "(sample names must be <patient>-<n>, coverage >= 97 % of the reference, >= 3 dates)")
        for d in pats:
            call("build-tables", [d, "--ref-dir", ref, *[x for k, v in alias_map.items() for x in ("--alias", f"{k}={v}")]])
            shutil.move(str(d / f"{d.name}.tsv"), str(pr / "04_position_time_matrices" / f"{d.name}.tsv"))
        call("annotate", ["--tsv-dir", "processing/04_position_time_matrices", "--ref-dir", ref,
                          "--out-dir", "processing/05_annotated_tables"])
        emit("out", f"{len(pats)} patient(s) ready for the analysis")

        # ---- step 6: selection, one process (--jobs 1) --------------------------------------------------------
        stage(titles["sel"])
        files = sorted(str(p) for p in (pr / "05_annotated_tables").glob("*_genes.tsv"))
        call("selection", [*files, "--outdir", "processing/06_selection_analysis", "--times", "dates.tsv", "--nperm", nperm,
                           "--jobs", 1, "--seed", seed, "--freq-delta", freq_delta, "--thr-clear", THR_CLEAR,
                           "--first-k-min", FIRST_K_MIN])

        if not list((pr / "06_selection_analysis").glob("*_variant_stats.tsv")):
            raise StageError("selection", "no variant passed the analysis filters, so there is nothing to report. A variant needs >= 100 reads "
                             "supporting it on at least one day, to be seen on at least 3 different days, and a frequency change of at least the threshold (default 0.03). "
                             "What to do: check that each patient has >= 3 dates and that the BAMs are the right ones for the reference; "
                             "very short or low-coverage example files usually end here.")

        # ---- step 7: report -----------------------------------------------------------------------------------
        if make_report:
            stage(titles["report"])
            call("report", ["--ref-dir", ref, "--processing", pr, "-o", root / "report.html", "--freq-delta", freq_delta, "--nperm", nperm])

        total = time.time() - t_start
        log.append(("time", f"total: {total:.2f} s"))
        emit("time", f"total: {total:.2f} s")
        (root / "commands.log").write_text("\n".join(f"[{k}] {t}" if k in ("err", "stage") else t for k, t in log) + "\n")
        outputs = {}
        for p in sorted(root.rglob("*")):
            if not p.is_file():
                continue
            rel = p.relative_to(root).as_posix()
            if not keep_inputs and (rel.startswith("processing/02_rc/") or rel.startswith("reference_input/")):
                continue
            outputs[rel] = p.read_bytes()
        return outputs
    finally:
        os.chdir(prev)


# ---- helpers for the web worker and the tests ---------------------------------------------------------------------
def summarise(outputs: dict) -> dict:
    """JSON-able summary: per patient, rows of *_variant_stats.tsv and rows with a label (`tag`); file sizes."""
    import csv
    pats = {}
    for rel, data in outputs.items():
        if rel.startswith("processing/06_selection_analysis/") and rel.endswith("_variant_stats.tsv"):
            name = rel.rsplit("/", 1)[1][: -len("_variant_stats.tsv")]
            rows = list(csv.DictReader(io.StringIO(data.decode("utf-8")), delimiter="\t"))
            pats[name] = dict(n_variants=len(rows), n_labelled=sum(1 for r in rows if r.get("tag")))
    return dict(patients=pats, files={k: len(v) for k, v in outputs.items()})


def make_zip(outputs: dict) -> bytes:
    """All result files in one .zip, paths as in the output folder of `srasel run`."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for rel, data in sorted(outputs.items()):
            z.writestr(zipfile.ZipInfo(rel, (2000, 1, 1, 0, 0, 0)), data, zipfile.ZIP_DEFLATED)
    return buf.getvalue()


def run_in_fs(indir="/in", outdir="/results", on_event=None, bamdir="/bam", **params) -> str:
    """Entry point for the worker and the node test. Reads <indir>/rc/* (tables), <bamdir>/*.bam (BAM files, optional),
    <indir>/dates.tsv and <indir>/ref*.gb, runs the pipeline, writes the files below <outdir>/ and the archive <outdir>.zip.
    Returns the summary as JSON text."""
    base = Path(indir)
    tables = {p.name: p.read_bytes() for p in sorted((base / "rc").iterdir()) if p.is_file()} if (base / "rc").is_dir() else {}
    bams = {p.name[:-4]: str(p) for p in sorted(Path(bamdir).glob("*.bam"))} if Path(bamdir).is_dir() else {}
    params["bams"] = bams
    gbs = [p.read_bytes() for p in sorted(base.glob("ref*.gb"))]
    genes = sorted(base.glob("genes.*"))
    if (base / "sequence.fa").is_file() and genes:               # FASTA + gene list instead of GenBank file(s)
        params.update(fasta=(base / "sequence.fa").read_bytes(), genes=genes[0].read_bytes(), genes_name=genes[0].name)
    seg_fa, seg_genes = sorted(base.glob("seg_fasta_*")), sorted(base.glob("seg_genes_*"))
    if seg_fa or seg_genes:                                      # segmented virus: one FASTA / one gene list PER SEGMENT, joined into the one of each the engine takes
        if not (seg_fa and seg_genes):
            raise StageError("inputs", "For a segmented virus give at least one FASTA and at least one gene list.")
        from srasel.segments import SegmentError, merge_fastas, merge_gene_lists     # the same module the local web page uses (it is inside the wheel)
        shown = lambda q: q.name.split("__", 1)[-1]               # the page writes seg_fasta_001__<original name>
        try:
            fa_text = merge_fastas([(shown(q), q.read_text(encoding="utf-8-sig")) for q in seg_fa])
            genes_text, kind = merge_gene_lists([(shown(q), q.read_text(encoding="utf-8-sig")) for q in seg_genes])
        except (SegmentError, UnicodeDecodeError) as e:
            raise StageError("inputs", str(e))
        params.update(fasta=fa_text.encode(), genes=genes_text.encode(), genes_name="all_segments_genes." + ("gff3" if kind == "gff3" else "tsv"))
    work = Path(params.pop("workdir", "/work"))
    if work.exists():
        shutil.rmtree(work)
    outputs = run_from_tables(tables, (base / "dates.tsv").read_text(encoding="utf-8-sig"), gbs, workdir=work, on_event=on_event, **params)
    shutil.rmtree(work, ignore_errors=True)                       # the results are in memory now
    out = Path(outdir)
    if out.exists():
        shutil.rmtree(out)
    for rel, data in outputs.items():
        q = out / rel
        q.parent.mkdir(parents=True, exist_ok=True)
        q.write_bytes(data)
    Path(str(out) + ".zip").write_bytes(make_zip(outputs))
    return json.dumps(summarise(outputs))


def peak_rss_mb():
    """Peak resident memory of this process in MB (CPython on Linux/macOS), None where `resource` is missing."""
    try:
        import resource
        v = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return round(v / (1048576 if sys.platform == "darwin" else 1024), 1)
    except Exception:
        return None


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tables", type=Path, help="folder with the *_readcount.txt[.gz] tables")
    ap.add_argument("--bams", type=Path, help="folder with BAM files, counted with pysam (name = sample)")
    ap.add_argument("--dates", required=True, type=Path)
    ap.add_argument("--gb", type=Path, action="append", default=[], help="GenBank reference (repeat for several files)")
    ap.add_argument("--fasta", type=Path, help="FASTA of the reference, with --genes instead of --gb (as `srasel run --fasta --genes`)")
    ap.add_argument("--genes", type=Path, help="gene list (TSV table or GFF3) for --fasta")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--nperm", type=int, default=DEFAULTS["nperm"])
    ap.add_argument("--seed", type=int, default=DEFAULTS["seed"])
    ap.add_argument("--freq-delta", type=float, default=DEFAULTS["freq_delta"])
    ap.add_argument("--no-report", action="store_true")
    ap.add_argument("--patient", help="patient of every sample whose name is not <patient>-<n> (as `srasel run --patient`)")
    ap.add_argument("--alias", action="append", default=[], metavar="BAM=REF", help="name of a sequence in the BAM files = name in the reference (repeatable)")
    ap.add_argument("--metrics", type=Path, help="write per-step seconds and peak RSS (JSON)")
    a = ap.parse_args(argv)
    tables = {p.name: p.read_bytes() for p in sorted(a.tables.iterdir()) if p.is_file() and "readcount" in p.name} if a.tables else {}
    bams = {p.stem: str(p.resolve()) for p in sorted(a.bams.glob("*.bam"))} if a.bams else {}
    if not tables and not bams:
        ap.error("give --tables and/or --bams")
    if bool(a.fasta) != bool(a.genes):
        ap.error("--fasta and --genes go together")
    if not a.gb and not a.fasta:
        ap.error("give --gb, or --fasta with --genes")
    if a.gb and a.fasta:
        ap.error("give --gb or --fasta with --genes, not both")
    metrics, t0 = [], time.time()

    def on_event(kind, text):
        if kind == "stage":
            print(f"== {text}", flush=True)
        elif kind == "time":
            metrics.append(dict(step=text.split(":")[0], seconds=float(text.split(":")[1].split()[0]), peak_rss_mb=peak_rss_mb()))
            print(f"   [{text}]", flush=True)
        elif os.environ.get("VERBOSE"):
            print(f"   [{kind}] {text}", flush=True)

    try:
        outputs = run_from_tables(tables, a.dates.read_text(encoding="utf-8-sig"), [p.read_bytes() for p in a.gb], a.nperm, a.seed,
                                  a.freq_delta, workdir=a.out, on_event=on_event, make_report=not a.no_report, keep_inputs=True, bams=bams,
                                  patient=a.patient, alias=a.alias, fasta=a.fasta.read_bytes() if a.fasta else None,
                                  genes=a.genes.read_bytes() if a.genes else None, genes_name=a.genes.name if a.genes else "genes.tsv")
    except StageError as e:
        print(f"STAGE FAILED ({e.stage}): {e.detail}", file=sys.stderr)
        return 1
    print(f"{len(outputs)} files in {a.out}")
    if a.metrics:
        a.metrics.write_text(json.dumps(dict(runtime=f"CPython {sys.version.split()[0]}", nperm=a.nperm, seed=a.seed, steps=metrics,
                                             total_seconds=round(time.time() - t0, 2), peak_rss_mb=peak_rss_mb()), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
