# SRASel in Docker

**Status: written, never built.** The development machine has no Docker, so `Dockerfile` has not been built or run. The steps below are what it is
meant to do; the first build is the test. If something fails, the likely places are the `mambaorg/micromamba` tag, the `bioconda` packages for your CPU
(`bam-readcount` has no Apple-Silicon build on bioconda; use `--platform linux/amd64` there) and file permissions of the mounted folder.

What the image contains: Python 3.12, `samtools`, `bam-readcount`, `minimap2` (conda-forge / bioconda, `docker/conda-tools.yml`) and the `srasel` package
installed with `pip install '.[web,pysam]'`. Nothing from your data is in the image.

## Build
```bash
docker build -t srasel .
docker run --rm srasel doctor           # should list samtools, bam-readcount and minimap2 as found
```

## Command line
Mount the folder with your BAM files on `/data`; relative paths then work inside it, and the results are written there.
```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/data srasel run \
    --samples samples.tsv --ref NC_045512.2 --email you@example.org --out srasel_out --threads 8 --seed 1
```
`--user` makes the files you get owned by you instead of by the container user. The paths inside `samples.tsv` must be as seen **inside** the container
(`/data/...`), or relative to `/data`.

## Local web interface
```bash
docker run --rm --user "$(id -u):$(id -g)" -p 127.0.0.1:8765:8765 -v "$HOME":/data srasel \
    web --host 0.0.0.0 --i-understand-the-risk --no-browser --allowed-root /data --workdir /data/srasel_web_runs
```
Open the link it prints, replacing `0.0.0.0` by `127.0.0.1`. Three things to know:
* `--host 0.0.0.0` is needed inside the container, and `srasel web` only accepts it with `--i-understand-the-risk`. What keeps it private is `-p 127.0.0.1:8765:8765`:
  the port is published **only on your own computer**. Never publish it as `-p 8765:8765` (that exposes it on your network).
* Keep the same port number on both sides (`8765:8765`): the web checks the `Host` header and refuses other ports.
* The file browser only sees what you mount (`-v "$HOME":/data` here). Paths in the web form are the ones inside the container (`/data/...`).

## Slurm / clusters
Most clusters use Apptainer/Singularity instead of Docker: `apptainer build srasel.sif docker-daemon://srasel:latest`, then
`apptainer exec --bind $PWD:/data srasel.sif srasel run ...`. Not tested.
