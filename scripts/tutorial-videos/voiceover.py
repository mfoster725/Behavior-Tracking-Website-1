#!/usr/bin/env python3
"""
Add a synthesized voiceover to a silent staff-tutorial recording, using its
timestamped narration script (docs/tutorials/narration-*.md).

Requires:
  - ffmpeg / ffprobe on PATH (or point FFMPEG_BIN / FFPROBE_BIN at the .exe)
  - the `edge-tts` Python package (pip install edge-tts) — free Microsoft
    neural voices, no API key, needs internet access at generation time.

Usage:
  python scripts/tutorial-videos/voiceover.py --one period-entry
  python scripts/tutorial-videos/voiceover.py --all
  python scripts/tutorial-videos/voiceover.py \
      --narration docs/tutorials/narration-01-period-entry.md \
      --video docs/tutorials/point-card-period-entry.mp4

By default this overwrites the video in place (that's the point — the silent
.mp4 becomes the voiced one). Pass --out to write elsewhere instead.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TUTORIALS_DIR = os.path.join(REPO_ROOT, 'docs', 'tutorials')

# Maps the short --one name to (narration file, video file), matching the
# table in docs/tutorials/README.md.
VIDEOS = {
    'period-entry': ('narration-01-period-entry.md', 'point-card-period-entry.mp4'),
    'daily-entry': ('narration-02-daily-entry.md', 'point-card-daily-entry.mp4'),
    'past-point-cards': ('narration-03-past-point-cards.md', 'past-point-cards.mp4'),
    'reports-navigation': ('narration-04-reports-navigation.md', 'reports-navigation.mp4'),
    'report-sections': ('narration-05-report-sections.md', 'report-sections.mp4'),
    'bills': ('narration-06-bills.md', 'bills.mp4'),
    'schedules': ('narration-07-schedules.md', 'schedules.mp4'),
    'bank-account-bonuses': ('narration-08-bank-account-bonuses.md', 'bank-account-bonuses.mp4'),
    'bank-account-balances': ('narration-09-bank-account-balances.md', 'bank-account-balances.mp4'),
    'marketplace-shopping': ('narration-10-marketplace-shopping.md', 'marketplace-shopping.mp4'),
    'marketplace-fulfilling': ('narration-11-marketplace-fulfilling.md', 'marketplace-fulfilling.mp4'),
    'marketplace-managing': ('narration-12-marketplace-managing.md', 'marketplace-managing.mp4'),
    'users-accounts': ('narration-13-users-accounts.md', 'users-accounts.mp4'),
    'users-student-plans': ('narration-14-users-student-plans.md', 'users-student-plans.mp4'),
    'admin-accounts-billing': ('narration-15-admin-accounts-billing.md', 'admin-accounts-billing.mp4'),
    'admin-importing-data': ('narration-16-admin-importing-data.md', 'admin-importing-data.mp4'),
    'admin-calendar-economy': ('narration-17-admin-calendar-economy.md', 'admin-calendar-economy.mp4'),
    'reports-attendance': ('narration-18-reports-attendance.md', 'reports-attendance.mp4'),
    'reports-star-percent': ('narration-19-reports-star-percent.md', 'reports-star-percent.mp4'),
    'reports-plan-thresholds': ('narration-20-reports-plan-thresholds.md', 'reports-plan-thresholds.mp4'),
}

DEFAULT_VOICE = 'en-US-AndrewNeural'

ROW_RE = re.compile(
    r'^\|\s*(\d{1,2}:\d{2})\s*\|\s*(.+?)\s*\|\s*$'
)


def find_bin(name, env_var):
    override = os.environ.get(env_var)
    if override and os.path.isfile(override):
        return override
    found = shutil.which(name)
    if found:
        return found
    # Fall back to the common winget install location on this machine.
    packages_dir = os.path.join(
        os.environ.get('LOCALAPPDATA', ''), 'Microsoft', 'WinGet', 'Packages'
    )
    if os.path.isdir(packages_dir):
        for entry in os.listdir(packages_dir):
            if entry.lower().startswith('gyan.ffmpeg'):
                for root, _dirs, files in os.walk(os.path.join(packages_dir, entry)):
                    exe = f'{name}.exe'
                    if exe in files:
                        return os.path.join(root, exe)
    sys.exit(f"Could not find {name} on PATH. Install ffmpeg (winget install Gyan.FFmpeg) "
              f"or set {env_var} to the full path of {name}.exe.")


FFMPEG = None
FFPROBE = None


def parse_timestamp(ts):
    minutes, seconds = ts.split(':')
    return int(minutes) * 60 + int(seconds)


def parse_narration(path):
    """Returns a list of (start_seconds, text) from the narration table."""
    lines = []
    with open(path, encoding='utf-8') as f:
        for raw in f:
            m = ROW_RE.match(raw.strip())
            if not m:
                continue
            ts, text = m.group(1), m.group(2)
            if ts.lower() in ('~time', 'time') or set(text) <= {'-', ' '}:
                continue
            # Skip separator rows like |---|---|
            if re.match(r'^-+$', ts):
                continue
            lines.append((parse_timestamp(ts), text))
    if not lines:
        sys.exit(f"No narration rows found in {path} — expected a '| ~Time | Say this |' table.")
    return lines


def probe_duration(path):
    out = subprocess.run(
        [FFPROBE, '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=noprint_wrappers=1:nokey=1', path],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def synthesize_line(text, voice, rate, out_path):
    cmd = [sys.executable, '-m', 'edge_tts', '--voice', voice, '--text', text,
           '--write-media', out_path]
    if rate:
        cmd[3:3] = ['--rate', rate]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0 or not os.path.isfile(out_path):
        sys.exit(f"edge-tts failed for line {text!r}:\n{result.stderr}")


MIN_GAP = 0.5  # seconds of silence enforced between consecutive lines


def build_voiceover(narration_lines, voice, rate, video_duration, workdir):
    """Synthesizes each line and schedules it so no two lines' audio ever overlaps.

    Each line's target timestamp (from the narration table) is a minimum start
    time, not a fixed one: if the previous line's speech is still running when
    the next line's caption would normally start, the next line is pushed back
    until the previous one finishes. TTS reads text at a fairly fixed rate, so
    lines that were paced for a human reader can run long — sliding the start
    time keeps the audio intelligible instead of two lines talking over each
    other. Timing can drift a little from the on-screen captions as a result;
    a wide overall drift is reported so the narration script's timestamps (or
    the recording's hold times) can be adjusted.
    """
    clips = []
    for i, (target_start, text) in enumerate(narration_lines):
        clip_path = os.path.join(workdir, f'line_{i:02d}.mp3')
        synthesize_line(text, voice, rate, clip_path)
        duration = probe_duration(clip_path)
        clips.append((target_start, duration, clip_path, text))

    scheduled = []
    cursor = 0.0
    for target_start, duration, clip_path, text in clips:
        actual_start = max(target_start, cursor)
        drift = actual_start - target_start
        if drift > 1.0:
            print(f"  warning: line targeted for {target_start}s starts {drift:.1f}s late "
                  f"({actual_start:.1f}s) because the previous line ran long — {text!r}",
                  file=sys.stderr)
        scheduled.append((actual_start, clip_path))
        cursor = actual_start + duration + MIN_GAP

    last_start, _last_clip = scheduled[-1]
    last_duration = clips[-1][1]
    narration_end = last_start + last_duration
    if narration_end > video_duration + 1.0:
        print(f"  note: narration runs {narration_end:.1f}s, {narration_end - video_duration:.1f}s "
              f"longer than the {video_duration:.1f}s recording — the final frame will be frozen "
              f"to cover it. For tighter sync, lengthen the pauses in the matching Playwright "
              f"script and re-record, or trim the narration text.", file=sys.stderr)

    delayed = [(int(start * 1000), path) for start, path in scheduled]
    return delayed, narration_end


TRAILING_PAD = 0.6  # seconds of silence/hold after the last spoken line


def mux(video_path, delayed_clips, total_duration, video_duration, workdir, out_path):
    mixed_audio = os.path.join(workdir, 'mixed.wav')

    inputs = []
    filter_parts = []
    labels = []
    for i, (delay_ms, clip_path) in enumerate(delayed_clips):
        inputs += ['-i', clip_path]
        filter_parts.append(f'[{i}]adelay={delay_ms}:all=1[a{i}]')
        labels.append(f'[a{i}]')
    n = len(delayed_clips)
    filter_parts.append(f'{"".join(labels)}amix=inputs={n}:duration=longest:normalize=0[mix]')
    filter_parts.append('[mix]apad[aout]')
    filter_complex = ';'.join(filter_parts)

    subprocess.run(
        [FFMPEG, '-y', *inputs, '-filter_complex', filter_complex,
         '-map', '[aout]', '-t', str(total_duration), mixed_audio],
        check=True,
    )

    if total_duration > video_duration:
        # Narration outlasts the recording — freeze the last frame to cover the gap
        # instead of cutting speech off or speeding it up unnaturally.
        extra = total_duration - video_duration
        subprocess.run(
            [FFMPEG, '-y', '-i', video_path, '-i', mixed_audio,
             '-filter_complex', f'[0:v]tpad=stop_mode=clone:stop_duration={extra}[v]',
             '-map', '[v]', '-map', '1:a:0',
             '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
             '-t', str(total_duration), out_path],
            check=True,
        )
    else:
        subprocess.run(
            [FFMPEG, '-y', '-i', video_path, '-i', mixed_audio,
             '-map', '0:v:0', '-map', '1:a:0',
             '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
             '-shortest', out_path],
            check=True,
        )


def process(narration_path, video_path, out_path, voice, rate):
    print(f"Voicing {os.path.basename(video_path)} from {os.path.basename(narration_path)} "
          f"(voice={voice})")
    narration_lines = parse_narration(narration_path)
    video_duration = probe_duration(video_path)

    with tempfile.TemporaryDirectory(prefix='tutorial-voiceover-') as workdir:
        delayed_clips, narration_end = build_voiceover(narration_lines, voice, rate, video_duration, workdir)
        total_duration = max(video_duration, narration_end + TRAILING_PAD)
        tmp_out = os.path.join(workdir, 'out.mp4')
        mux(video_path, delayed_clips, total_duration, video_duration, workdir, tmp_out)
        os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
        shutil.copyfile(tmp_out, out_path)
    print(f"  -> wrote {out_path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--one', choices=sorted(VIDEOS), help='Voice a single known tutorial by short name.')
    group.add_argument('--all', action='store_true', help='Voice all known tutorials.')
    group.add_argument('--narration', help='Path to a narration .md file (use with --video).')
    parser.add_argument('--video', help='Path to the matching silent .mp4 (use with --narration).')
    parser.add_argument('--out', help='Output path. Defaults to overwriting --video in place.')
    parser.add_argument('--voice', default=DEFAULT_VOICE,
                         help=f'edge-tts voice name (default: {DEFAULT_VOICE}). '
                              f'List options with: python -m edge_tts --list-voices')
    parser.add_argument('--rate', default=None,
                         help='edge-tts speaking-rate adjustment, e.g. "-10%%" to slow down.')
    args = parser.parse_args()

    global FFMPEG, FFPROBE
    FFMPEG = find_bin('ffmpeg', 'FFMPEG_BIN')
    FFPROBE = find_bin('ffprobe', 'FFPROBE_BIN')

    if args.narration and not args.video:
        parser.error('--narration requires --video')
    if args.video and not args.narration:
        parser.error('--video requires --narration')

    jobs = []
    if args.one:
        narration_file, video_file = VIDEOS[args.one]
        jobs.append((os.path.join(TUTORIALS_DIR, narration_file),
                      os.path.join(TUTORIALS_DIR, video_file)))
    elif args.all:
        for narration_file, video_file in VIDEOS.values():
            jobs.append((os.path.join(TUTORIALS_DIR, narration_file),
                          os.path.join(TUTORIALS_DIR, video_file)))
    else:
        jobs.append((args.narration, args.video))

    if args.out and len(jobs) > 1:
        parser.error('--out only makes sense with a single video (--one or --narration/--video)')

    for narration_path, video_path in jobs:
        out_path = args.out or video_path
        process(narration_path, video_path, out_path, args.voice, args.rate)


if __name__ == '__main__':
    main()
