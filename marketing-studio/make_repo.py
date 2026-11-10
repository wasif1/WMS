#!/usr/bin/env python3
"""Export Marketing Studio into its own brand-new git repository.

    python make_repo.py ~/projects/marketing-studio              # create the folder + local repo
    python make_repo.py ~/projects/marketing-studio --github my-marketing-studio [--public]
    python make_repo.py ~/projects/marketing-studio --remote git@github.com:you/repo.git --push

Only tracked source files are copied (no outputs, assets, brands or projects of yours), and the new
repo starts with a clean single commit. --github needs the GitHub CLI (`gh auth login` once);
the repo is private unless you pass --public.
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKIP = {"make_repo.py"}


def run(cmd, cwd=None, check=True):
    r = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True)
    if check and r.returncode:
        sys.exit(f"Command failed: {' '.join(cmd)}\n{r.stderr.strip() or r.stdout.strip()}")
    return r


def tracked_files():
    r = run(["git", "ls-files", "--", "."], cwd=HERE, check=False)
    if r.returncode == 0 and r.stdout.strip():
        return [Path(p) for p in r.stdout.splitlines()]
    # not inside git (e.g. downloaded zip): copy everything that is not user data
    out = []
    for p in HERE.rglob("*"):
        rel = p.relative_to(HERE)
        if p.is_file() and not (rel.parts[0] in {"outputs", "assets", "brands", "projects", ".venv"} and rel.name != ".gitkeep") \
                and "__pycache__" not in rel.parts:
            out.append(rel)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("dest", help="new folder to create (must not exist or be empty)")
    ap.add_argument("--github", metavar="NAME", help="also create this repo on GitHub with the gh CLI and push")
    ap.add_argument("--public", action="store_true", help="make the GitHub repo public (default private)")
    ap.add_argument("--remote", help="existing empty remote URL to add as origin")
    ap.add_argument("--push", action="store_true", help="push to --remote after committing")
    ap.add_argument("--branch", default="main")
    a = ap.parse_args()

    dest = Path(a.dest).expanduser().resolve()
    if dest.exists() and any(dest.iterdir()):
        sys.exit(f"{dest} already exists and is not empty. Choose a new folder.")
    if HERE in dest.parents or dest == HERE:
        sys.exit("Choose a folder outside marketing-studio/")
    if not shutil.which("git"):
        sys.exit("git is not installed")
    for rel in tracked_files():
        if rel.name in SKIP and len(rel.parts) == 1:
            continue
        (dest / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(HERE / rel, dest / rel)
    for d in ("assets", "brands", "outputs", "projects", "fonts"):
        (dest / d).mkdir(exist_ok=True)
        (dest / d / ".gitkeep").touch()
    run(["git", "init", "-q", "-b", a.branch], cwd=dest)
    run(["git", "add", "-A"], cwd=dest)
    run(["git", "-c", "user.name=Marketing Studio", "-c", "user.email=noreply@localhost",
         "commit", "-q", "-m", "Initial commit: Marketing Studio"], cwd=dest)
    print(f"Created repo at {dest}")
    if a.github:
        if not shutil.which("gh"):
            sys.exit("GitHub CLI not found. Install it from https://cli.github.com, run `gh auth login`, then re-run, "
                     "or create an empty repo on github.com and use --remote URL --push.")
        vis = "--public" if a.public else "--private"
        run(["gh", "repo", "create", a.github, vis, "--source", ".", "--remote", "origin", "--push"], cwd=dest)
        print(f"Created and pushed GitHub repo {a.github} ({'public' if a.public else 'private'})")
    elif a.remote:
        run(["git", "remote", "add", "origin", a.remote], cwd=dest)
        if a.push:
            run(["git", "push", "-u", "origin", a.branch], cwd=dest)
            print("Pushed to", a.remote)
        else:
            print(f"Remote added. Push with: cd {dest} && git push -u origin {a.branch}")
    else:
        print(f"Next: cd {dest} && python studio.py serve\n"
              f"To publish: create an empty repo on GitHub, then\n"
              f"  cd {dest} && git remote add origin <url> && git push -u origin {a.branch}")


if __name__ == "__main__":
    main()
