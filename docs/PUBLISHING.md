# Publishing the repository and the GitHub Pages site

**Nothing is published by this repository's tooling.** These are the steps for the owner, in order.

## Before the first push
1. Replace the placeholder `<USER>` (README, `docs/index.html` if present) by the GitHub account or organisation that will host the repository.
2. Decide the copyright holder in `LICENSE` (it currently names the owner of the original SRASel repository) and the authors in `CITATION.cff` (it lists a generic placeholder).
3. Confirm you may redistribute the data in `examples/real/` (public ENA records, down-sampled; see its README) and the GenBank files (NCBI records).
4. Read `validation/RELEASE_CHECKLIST.md` and decide on each open item.

## Create the repository
```bash
git init -b main && git add . && git commit -m "SRASel 2.1.0rc1"
git remote add origin https://github.com/<USER>/<REPO>.git
git push -u origin main
```
The first push runs `.github/workflows/ci.yml` (never run before): check the result of the three jobs.

## GitHub Pages (Browser Mode and landing page)
1. On GitHub: **Settings → Pages → Build and deployment → Source: “Deploy from a branch”**.
2. Branch **main**, folder **/docs**, **Save**. After a minute the site is at `https://<USER>.github.io/<REPO>/`.
3. Open it and check: the three cards, the “Open the browser runner” button, and the demo analysis. The page loads Pyodide from `cdn.jsdelivr.net` (≈ 48 MB the first time).

`docs/.nojekyll` is present so that files are served as they are. All links in the site are relative, so the same files work at `/` and under `/<REPO>/` (both were tested with a static server).

## After changing the engine
The browser page runs a wheel built from `src/srasel/{__init__,engine,bamcount}.py`. If you change them, rebuild it and commit the result:
```bash
python browser/build.py
```
A unit test fails when the wheel does not match the sources.
