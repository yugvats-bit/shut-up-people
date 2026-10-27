# Shut up people — Ho gaya tera

A voice interrupter. Every time someone starts talking, it cuts in with the next line:

1. **Ho gaya tera** — हो गया तेरा
2. **Bas kar yaar** — बस कर यार
3. **Someone take this human away from me**

It says **one line per interruption**. After each line it waits until you go quiet, then fires the next line only when you start talking again. After the third line it loops.

## Try it

Open `index.html` in Chrome or Edge (or serve the folder), click **[ START LISTENING ]**, allow the mic, and wear headphones so it doesn't hear itself.

## Make it sound human: use your own recordings

The computer voice is a fallback. For a real human delivery, record the three lines and add them to an `audio/` folder with these names:

```
audio/01.mp3   Ho gaya tera
audio/02.mp3   Bas kar yaar
audio/03.mp3   Someone take this human away from me
```

Any line with a recording plays the recording; the rest use the browser's voice. Without recordings it picks the most natural voice installed (Edge's "Natural" voices sound best).

## Tuning

At the top of `app.js`:

| Setting | Default | What it does |
| --- | --- | --- |
| `VOICE_MS` | 350 | How long someone must talk before it cuts in |
| `QUIET_MS` | 900 | How long they must be quiet before it listens again |
| `REACT_MS` | 350–700 | Pause before it answers, like a person would |
| `rate` (per line) | 0.82–0.88 | Speaking speed of the computer voice |
