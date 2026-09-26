# Tutorial video thumbnails

One JPG per tutorial key (matching the keys in `static/tutorials.js`'s
`TUTORIAL_VIDEOS`), served as a plain static file at
`/static/tutorial-thumbs/<key>.jpg` and referenced by `tutorialThumbnailUrl()`.

Each one is a hand-picked frame from partway through that video — never the
opening/login view, always a moment that actually shows the feature (a filled
grid, an open modal with real data, a chart with real numbers) — extracted
with ffmpeg and scaled to 640x360:

```powershell
ffmpeg -y -ss <seconds> -i docs/tutorials/<video>.mp4 -frames:v 1 -update 1 -q:v 3 frame.jpg
ffmpeg -y -i frame.jpg -vf "scale=640:360" -q:v 5 static/tutorial-thumbs/<key>.jpg
```

If a video gets re-recorded and its content shifts, re-pick a timestamp by eye
(read the matching `docs/tutorials/narration-*.md` for what's on screen when)
rather than reusing the old one blindly — a re-recorded video's timing can
drift from the narration table (see that file's own notes on re-timing).
