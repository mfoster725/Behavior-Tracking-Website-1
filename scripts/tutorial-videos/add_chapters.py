#!/usr/bin/env python3
"""
Embed chapter markers into a finished tutorial .mp4, one chapter per `step()`
in its recorder script, using the real timestamps that script printed while
recording (a `STEP @ 12.3s: <label>` line per step, from harness.js's
`step()`, plus one `MARK @ 0.0s: <title>` line for the intro).

Requires the recorder script's stdout captured to a log file, e.g.:
  node scripts/tutorial-videos/18-reports-attendance.js | \
      tee scripts/tutorial-videos/18-reports-attendance.log

Usage:
  python scripts/tutorial-videos/add_chapters.py \
      --log scripts/tutorial-videos/18-reports-attendance.log \
      --video docs/tutorials/reports-attendance.mp4

By default this overwrites the video in place (chapters are container
metadata — muxed with -c copy, so this is fast and lossless). Pass --out to
write elsewhere instead.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

LINE_RE = re.compile(r'^(?:MARK|STEP) @ (\d+(?:\.\d+)?)s:\s*(.+)$')


def find_bin(name, env_var):
    override = os.environ.get(env_var)
    if override and os.path.isfile(override):
        return override
    found = shutil.which(name)
    if found:
        return found
    packages_dir = os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Microsoft', 'WinGet', 'Packages')
    if os.path.isdir(packages_dir):
        for entry in os.listdir(packages_dir):
            if entry.lower().startswith('gyan.ffmpeg'):
                for root, _dirs, files in os.walk(os.path.join(packages_dir, entry)):
                    exe = f'{name}.exe'
                    if exe in files:
                        return os.path.join(root, exe)
    sys.exit(f"Could not find {name} on PATH. Install ffmpeg (winget install Gyan.FFmpeg) "
              f"or set {env_var} to the full path of {name}.exe.")


def parse_log(path):
    """Returns a de-duplicated, ordered list of (start_seconds, title)."""
    entries = []
    with open(path, encoding='utf-8') as f:
        for raw in f:
            m = LINE_RE.match(raw.strip())
            if not m:
                continue
            start = float(m.group(1))
            title = m.group(2).strip()
            entries.append((start, title))
    if not entries:
        sys.exit(f"No 'MARK @ Xs:' / 'STEP @ Xs:' lines found in {path} — "
                  f"was the recorder script's stdout captured there?")
    # A re-recorded run's log may have been appended to rather than
    # overwritten; keep only the entries from the LAST run (the last time
    # the elapsed clock resets back near zero).
    last_start_idx = 0
    for i in range(1, len(entries)):
        if entries[i][0] < entries[i - 1][0] - 1.0:
            last_start_idx = i
    return entries[last_start_idx:]


def probe_duration(ffprobe, path):
    out = subprocess.run(
        [ffprobe, '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=noprint_wrappers=1:nokey=1', path],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def build_chapters_file(entries, video_duration, workdir):
    path = os.path.join(workdir, 'chapters.txt')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(';FFMETADATA1\n')
        for i, (start, title) in enumerate(entries):
            end = entries[i + 1][0] if i + 1 < len(entries) else video_duration
            if end <= start:
                continue
            f.write('[CHAPTER]\n')
            f.write('TIMEBASE=1/1000\n')
            f.write(f'START={int(start * 1000)}\n')
            f.write(f'END={int(end * 1000)}\n')
            f.write(f'title={title}\n')
    return path


def mux_chapters(ffmpeg, video_path, chapters_path, out_path):
    subprocess.run(
        [ffmpeg, '-y', '-i', video_path, '-i', chapters_path,
         '-map_metadata', '1', '-map_chapters', '1',
         '-c', 'copy', out_path],
        check=True, capture_output=True, text=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--log', required=True, help='Recorder script stdout log (has STEP @ Xs: lines).')
    parser.add_argument('--video', required=True, help='Finished (voiced) .mp4 to add chapters to.')
    parser.add_argument('--out', help='Output path. Defaults to overwriting --video in place.')
    args = parser.parse_args()

    ffmpeg = find_bin('ffmpeg', 'FFMPEG_BIN')
    ffprobe = find_bin('ffprobe', 'FFPROBE_BIN')

    entries = parse_log(args.log)
    video_duration = probe_duration(ffprobe, args.video)

    with tempfile.TemporaryDirectory(prefix='tutorial-chapters-') as workdir:
        chapters_path = build_chapters_file(entries, video_duration, workdir)
        tmp_out = os.path.join(workdir, 'out.mp4')
        mux_chapters(ffmpeg, args.video, chapters_path, tmp_out)
        out_path = args.out or args.video
        shutil.copyfile(tmp_out, out_path)

    print(f"Wrote {len(entries)} chapters to {out_path}:")
    for start, title in entries:
        m, s = divmod(int(start), 60)
        print(f"  {m}:{s:02d}  {title}")


if __name__ == '__main__':
    main()
