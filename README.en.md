<div align="center">

<img src="docs/assets/aha-tutor-mascot.png" width="200" height="200" alt="Aha's mascot Qiao: a friendly light bulb teacher with glasses and chalk">

# Aha · AI tutor (开窍)

[简体中文](README.md) · **English**

**A private tutor for DeepSeek Harness: say what you want to understand, and it gets to know you, builds a course around you, and teaches it on a handwriting chalkboard while it speaks.**

[![CI](https://github.com/BaronCyrus/dsh-aha-tutor/actions/workflows/ci.yml/badge.svg)](https://github.com/BaronCyrus/dsh-aha-tutor/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/dsh-aha-tutor?logo=npm&label=npm)](https://www.npmjs.com/package/dsh-aha-tutor)
[![Total npm downloads](https://img.shields.io/npm/d18m/dsh-aha-tutor?logo=npm&label=total%20downloads)](https://www.npmjs.com/package/dsh-aha-tutor)
[![MIT](https://img.shields.io/badge/license-MIT-111111.svg)](LICENSE)

[What it does](#what-it-does) · [Install](#install) · [Quick start](#quick-start) · [Voices](#voices) · [Privacy](#privacy-and-data) · [FAQ](#faq) · [Support](#support-the-author)

</div>

<p align="center"><img src="docs/assets/aha-tutor-hero.png" alt="A laptop showing a chalkboard with formulas and a wave, with a glowing light bulb tutor beside it" width="860"></p>

## What it does

| Feature | What you get |
| --- | --- |
| **A course made for you** | Say what you want to learn or drop in a textbook. The tutor can look the subject up on the web first, then asks a few multiple-choice questions about your background, goal, time and the course size you want, then writes a unit → chapter → lesson blueprint while you watch. Edit it by hand, have a lesson split or deepened, or ask for changes and review them before they apply; a running course can still grow. Confirming prepares the hands-on projects and the first unit's practice; later lectures get theirs when you reach them |
| **Handwriting chalkboard lessons** | Narration (voice + captions) while the board fills up in a handwriting font with points, formulas, diagrams, charts and, when it helps, a small animation; each item is written as its sentence is spoken and highlighted while it is discussed; curves given by a formula are computed point by point, with sliders for their parameters; the lesson's pages sit on one canvas you can drag and zoom while the view follows the teacher, and a side panel shows the lesson's goals and a transcript; pause, rewind and change speed any time |
| **Quick checks that adapt** | At key moments the lesson stops for a question and asks how sure you are. Lucky guesses, hesitation and confident mistakes count differently; a lesson with a calculation asks you to write out your working and corrects it on the board. A revisit lesson is added automatically for concepts that did not stick |
| **Raise your hand, hear it again** | Ask anything mid-lesson, typed or spoken (recognized on your computer by DSH's Voice input), and the tutor answers on the board, then picks up where it left off; or have a step re-explained with an analogy, a drawing, an example, more simply or in more depth. Think a step is wrong? Ask the teacher to check it: a real mistake is corrected at the board and fixed in the lesson, and a step that is right is explained |
| **Practice, flashcards, reviews** | Every lesson has practice, with figures where they help, open answers graded by the model and keyboard answering; think a question or its grading is wrong, and the teacher checks it, fixes a wrong question, grades your answer again and corrects your mastery; a round ends with stars, how your mastery moved and a next step. Flashcards and concepts come back on a spaced-repetition schedule, and the study plan leaves time for them |
| **Your materials become courses** | PDF, Word, PowerPoint, Markdown, web links and images (images need a vision model). Lessons and cheat sheets cite pages; long readings can be digested into structure, claims and a glossary |
| **Cheat sheets, notes, quizzes** | Printable cheat sheets organized by theme (columns, font size and highlighting adjustable), plus notes, flashcard decks and quizzes |
| **Explainer shorts and exports** | A two-minute whiteboard explainer from a topic or a link; any lesson exports to a video with the handwriting, captions and a watermark, or its board to a PDF (one board page per page, handwriting and formulas included) or a PNG picture per page |
| **Hands-on projects** | Code projects get a folder with starter files and a DSH session where a coding agent helps you build; submit it back for a rubric-based review |
| **Study plan and learner profile** | Lessons are scheduled around your weekly time, study days and deadlines, with warnings when a deadline is at risk; a month calendar ticks what you finish, takes ticks by hand and replans the days ahead; the tutor remembers your background and weak spots, which you can view, edit or clear |
| **In conversations too** | A new conversation preset, "开窍 · AI 私人老师", lets the tutor explain on the whiteboard, run interactive quizzes, design a course or make a cheat sheet right from a DSH chat |

Two sample courses ship with the plugin (harmonic motion and Bayesian thinking, in Chinese) so you can try the chalkboard classroom without spending tokens.

## Install

You need the **DeepSeek Harness** desktop app (0.2.x, from 0.2.1) with at least one working model. See the [DSH instructions](https://github.com/deepseek-ai/deepseek-harness#run) if you do not have it yet.

1. Open **Plugins** in the desktop app, click **Add plugin** and enter `dsh-aha-tutor` as the package, with the official registry as the source. Within 24 hours of a new release DSH's pnpm holds new versions back; enter an exact version such as `dsh-aha-tutor@1.5.0` then.
2. **Quit and reopen** the desktop app. Refreshing the page does not load the plugin's host side.
3. Open **Aha · AI tutor** in the left sidebar (shown as 「开窍 · AI 私人老师」 in Chinese).

Offline: download `dsh-aha-tutor-<version>.tgz` from [GitHub Releases](https://github.com/BaronCyrus/dsh-aha-tutor/releases/latest) and enter its absolute path instead. For your own profiles, `dsh plugin --profile <name> add dsh-aha-tutor@<version>` works; the desktop profile is managed by the app's Plugins page only.

## Quick start

1. Type what you want to learn on the home page (or attach a handout) and press **Start**.
2. Answer a few questions and choose a pace, then **Design my course**. Edit the blueprint or ask for changes.
3. **Confirm and build the course**, then **Continue learning**.

For a single question, use "Explain a concept", "Solve with me" or "Show me visually" on the home page; no course needed.

## Voices

| Option | Notes |
| --- | --- |
| **System voice (default, free)** | macOS / Windows voices, selectable in settings; you are told when no voice matches the course language |
| **Cloud voice (optional)** | OpenAI-compatible APIs (including SiliconFlow and others), Volcengine (Doubao), MiniMax and Azure Speech. Keys live in DSH's credential store, are used host-side only and never reach the browser; synthesized audio is cached locally so replays cost nothing |

Only cloud voices can be recorded into exported videos; with a system voice the video has captions and no sound. Board animations appear in videos as a still frame.

## Models

Aha uses your DSH default model. In **Aha → Settings** you can pick separate models for "course design & teaching" and "grading & questions". The plugin never switches to another paid model on its own and never generates in bulk in the background: the course structure is made when you confirm it, and each lesson's board when you open it (plus the next one), as is the practice for later lectures. Follow the terms of subscription-based models you use.

## Privacy and data

- Courses, progress, materials, profile and plan stay on this computer under `$DSH_HOME/aha-tutor/` (default `~/.dsh/aha-tutor/`, on Windows `C:\Users\<you>\.dsh\aha-tutor\`).
- Project folders live under `~/AhaTutor/projects/`; files you changed are never overwritten.
- Models receive only what the current task needs: your request, the course outline, relevant passages from your materials and a short learner profile.
- Web import fetches public addresses only, never localhost or private networks; every address a name resolves to is checked again when connecting.
- Model-drawn diagrams pass an allow-list sanitizer; animations run in a sandbox without network access.

See [SECURITY.md](SECURITY.md).

## FAQ

**No sound?** Open **Aha → Settings → Narration** and press **Test**. Install a system voice for your language, or use a cloud voice.

**A generation failed or looks weak?** Retry, or choose a stronger model for "course design & teaching".

**No text from a PDF?** Scanned PDFs have no text layer; upload page photos as images with a vision model.

**Using the tutor in a chat?** Choose the "开窍 · AI 私人老师" preset when starting a session.

## Development

```bash
pnpm install --frozen-lockfile
pnpm run check
```

Runs every test, builds the host and browser bundles and packs a tarball into `.artifacts/`. For local iteration, add the repository's absolute path in the DSH Plugins page (installs as `link:`); host changes need a DSH restart. See [AGENTS.md](AGENTS.md).

## License

[MIT](LICENSE) © BaronCyrus. Third-party licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Aha Tutor (开窍) is an independent open-source project, not affiliated with DeepSeek or any other learning product.

## Support the author

Aha Tutor is free and open source, and tips are entirely optional. If it helped something finally click for you, a tip keeps Qiao growing.

<table align="center">
  <tr>
    <td align="center"><img src="docs/assets/sponsor-wechat.png" width="200" alt="WeChat tip code"><br><b>WeChat</b></td>
    <td align="center"><img src="docs/assets/sponsor-alipay.png" width="200" alt="Alipay payment code"><br><b>Alipay</b></td>
  </tr>
</table>
