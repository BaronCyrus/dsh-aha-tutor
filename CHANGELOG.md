# Changelog

All notable changes to this plugin are recorded here. Versions follow [SemVer](https://semver.org/); GitHub Release notes for each version live in `docs/releases/`.

## 1.11.0 - 2026-10-29

### Changed

- **Library flashcards and quizzes cover the whole material**: they were written from about 18,000 or 16,000 characters picked from the materials, always 24 cards or 10 questions. A long material is now read in parts of about 20,000 characters, three at a time, each part writing its own cards or questions: two to four cards per key point, at most 300 a deck, each question kept once; a quiz of 5 to 30 questions by length (a short handout 5–10), shared out over the parts. Cards are written without thinking, quizzes with it. **Study tools** and **Library** show how many parts are read and how many cards or questions are written, with Cancel. A part that could not be read is named on the deck or quiz; a model that refuses (sign-in, quota) stops the whole job at once. A large deck is studied in rounds of at most 40 cards, and the page shows the total.
- **The focus counts for flashcards, quizzes and notes**: the **Focus** box of Study tools only reached cheat sheets. Every part of a deck or quiz now covers only what falls within it, and parts outside it are skipped; notes are written from the passages on it. What is made with a focus is named after it, and a focus nothing matches says so.

### Fixed

- **Unit flashcards and quizzes keep their last lessons**: a unit deck or quiz the model wrote longer than it may be was cut at its end, dropping the cards or questions of the unit's last lessons; it is now thinned out evenly.
- **Library at phone width**: a long topic under a material pushed the page sideways; topics are clipped, with the whole topic on hover.

## 1.10.0 - 2026-10-29

### Added

- **Flashcards for each unit**: every unit has **Unit flashcards** beside **Unit quiz**, in the outline and in the practice tab. A unit's deck is written the first time it is opened, from its lessons and concepts and from the course materials' pages on them: two to four cards per concept, at most 60. The deck keeps its review schedule, and the button shows how many of its cards are due. Course packs carry the unit decks.
- **Flashcard review**: at the top of the practice tab, beside **Start review**, it brings the due cards of every unit together, oldest first.
- **New set of questions**: the end of a unit quiz offers **New set of questions**, which writes the quiz again; **Retry** still repeats the same questions. A new set's questions get new ids, so answers to the old set are never graded again against them. Leaving while the new set is written and coming back waits for it instead of showing the old one.

### Changed

- **Unit quizzes as long as the unit**: a unit quiz always had 10 questions. It now has at least one per concept of the unit and more for the central ones, usually 10 to 30, the model choosing inside that range, and it follows the course materials' pages on the unit: their exercises, notation and units. While it is written, the page counts the questions done.
- **One tab for practice, quizzes and flashcards**: the practice tab is now 「练习、测验与闪卡」 (Practice, quizzes & flashcards), and the Flashcards tab, which only held a button, is gone; links to it open the practice tab. The whole-course deck of earlier versions (30 cards from the outline and 6,000 characters of the materials) is no longer written. A deck already made joins **Flashcard review** with its schedule kept, its unseen cards included.
- **Uploads up to 200 MB**: the limit was 60 MB, too small for a textbook full of pictures. 200 MB is DSH's own budget for attachments and fits both upload routes; the host no longer keeps a second copy of the file while reading it.

### Fixed

- **Navigation**: a course's flashcards and cheat sheets highlighted **Study tools** instead of **My courses**.
- **Narrow pages**: the course title no longer pushes the course page sideways at phone width.

## 1.9.0 - 2026-10-27

### Added

- **Text size**: **Settings → Text size** offers Standard, Large and Extra large, and all of the plugin's text grows at once, in the board tab beside a conversation too. DSH's own font size (Settings → General → Font size) scales it as well. The board and the mind map keep their own zoom, and exports and printouts their own sizes; cards in a conversation keep DSH's text size.
- **Fold the navigation yourself**: **Collapse** at the foot of the navigation folds it to icons, and **»** opens it again; the choice is kept in the browser. A folded icon names itself beside it on hover or keyboard focus. The names no longer disappear by themselves in a medium window. In a lesson, instant answers and explainer shorts the navigation keeps to its icons to leave the board room, and other pages show it as you left it; so does a page narrower than 640px. There, **»** opens it over the page until a page is picked, the shade is clicked or Escape is pressed.

### Changed

- **Larger text by default**: body text is 15px (14px before) and hints 13.5px (12.5px). A question's prompt is 16px and its options 15px in the text colour; both were DSH's 13px caption grey. Flashcards are 22px.

### Fixed

- **Flashcards**: their text was meant to be 18px but showed at 14px, and a long answer spilled out of the card; the card now grows with its longer side.
- **The board beside a conversation** wore the course page's tab style: all its text was grey and the transcript never wrapped.
- **Cheat sheets**: their entries ignored the sheet's font size and printed in grey.
- **Narrow pages**: course cards no longer push the page sideways on a phone-width window.

## 1.8.0 - 2026-10-26

### Added

- **Scanned pages and pictures are read**: a PDF page without text of its own (a scan, a photo, a full-page figure), a Word document made mostly of pictures, a slide that is only a picture, and an uploaded photo have their text read by a model chosen in Aha settings that can see images (marked 🖼; DeepSeek-V4.1-Flash can): the quick route first, else the teaching route, never another model. Pages are read three at a time; the upload shows how many are done and can be cancelled, and up to 200 pages or pictures of a file are read. The text keeps its page or slide, so courses, study tools, the library search and citations use it like any other. Pages that failed (and why), pages left over and pages a model without vision could not read are named under the material. A scan without a model that sees images is refused with a note on which model to pick, instead of "no text". A photo whose text was read works in the study tools too, and stays a picture for models that see images. Black-and-white scans (CCITT, JBIG2) and JPEG 2000 pages decode with pdf.js's own WebAssembly decoders.

### Fixed

- **DSH 0.2.1-rc.3 refused the tutor preset**: the plugin card said 加载失败 (`tool-fs-search … sampleOverCapGlobResults missing required value`), because rc.3 requires that setting and gives it no default. The preset now sets it as DSH's own presets do; DSH 0.2.1-rc.2 still loads it.
- **A correction no longer stalls the lesson**: after **See the correction** on a written-out working, the classroom started the correction's first step twice in one go; Chromium dropped the second narration and held the system voice, so the lesson sat at "playing" until Pause and Play. The step now starts once, a sentence spoken right after a cancel waits for the next task, and a system voice that does not start (tried twice) or never reports an end is let go instead of holding the lesson; one that stalls twice in a row is turned off with a note.
- **Multi-select questions take several answers**: a practice or quiz question with several right options could show 多选 and take one answer. The quiz prompt never gave the question format, and a question the model wrote as a single choice with several answers kept only the first. Practice and quiz prompts now give the format; such a question, one whose kind is named like "multi-select", or one whose prompt says to pick several becomes multi-select, answers like "A, C" are understood, and a multi-select question says **Select all that apply**.

## 1.7.0 - 2026-10-22

### Added

- **How each lesson is taught**: every lesson of a new blueprint has a depth, one of building intuition, making the idea precise, deriving it, applying it and going further, shown beside the lesson on the course page and in the blueprint editor, where it can be changed. The teacher teaches the lesson that way. The sample courses show theirs.
- **Your name in class**: the profile asks what the tutor should call you, and a lesson's opening says it once.
- **A handout for every lesson**: **Handout** above a lesson (and **Handout of this lesson** when it ends) turns what its board taught into one printable page: what the lesson was about, the key points each with a line you could repeat to a friend, a worked example step by step, common mistakes with their fix, a glossary and three questions to check yourself. It is made on request (without the model thinking first) and kept; **Print** opens the answers.
- **Add materials to a course**: **Add materials** in a course's ⋯ menu, or in the outline editor, takes materials from the library or uploaded there, with an optional note on how to use them. The teacher reads them and proposes changes to the outline, such as new lessons where they fit or lessons taken deeper, shown like any other proposal; applying it keeps the progress of lessons left alone and attaches the materials, so later lessons cite them. A course can use up to 12 materials (8 before).
- **Search the library**: typing above the library filters it by title and topic; Enter searches the text of every material at once and lists the best passages with their material, page or slide and the matching words marked, and choosing one shows its material. It runs on this computer without the model; the index is kept until the library changes.
- **A tour of the classroom**: the first classroom opened in a browser starts with a six-step tour (the board, the controls, raising a hand, explaining differently, challenging a step and the side panel), each part lit up in turn with a card saying what it does. The lesson starts when the tour ends; it can be skipped, stepped with the arrow keys, and seen again from **?** above the classroom. The narrow conversation board has none.
- **Hold V to ask**: in a lesson, instant answers or an explainer short, hold V while you speak and let go, or tap V, speak and tap it again. The lesson pauses, the question box opens if the side panel was folded, and the question is recorded through DSH's Voice input like the microphone button; the words land in the box to check before asking. After a spoken question is sent, or Escape in the box, the keyboard is back with the lesson (space, arrows and V). The board beside a DSH conversation leaves V alone, so typing there never records. The tooltips of Raise hand and the microphone name the key, and the tour mentions it.
- **The blueprint grows as a mind map**: while the teacher writes a blueprint, the outline is drawn as a map that grows to the right (course, units, lectures, lessons) and follows the newest lesson until you drag or zoom it; **Back to the newest** resumes. The editor shows a new blueprint as the map, with each lesson's depth and minutes, and switches to the list for editing; choosing a lesson on the map opens it in the list.

### Changed

- Printing a cheat sheet or a handout prints only it, across as many pages as it needs, instead of one clipped page beside the hidden app.
- **Something wrong with this question?** also grades the earlier answers to a question it fixes: another round of practice, a review or the lesson's own check. Each recorded answer now keeps which question it answered and how, and when a check fixes the question, each earlier answer takes its grade against the fixed one, with mastery and the review schedule recomputed as for the answer checked. Under a wrong question a grade can go up or down; under an unclear one it only goes up, since the earlier answer may have been right under the other reading. Short and written-out answers go to the grader again, the latest three. The check says how many earlier answers it graded again. Answers recorded before this version, and those older than the latest 50, keep their grades.

### Fixed

- A microphone that finished opening after its question box had closed (the learner left the page meanwhile) stayed on; it is now closed at once.

## 1.6.0 - 2026-10-22

### Added

- **Is this step wrong?**: a learner who thinks the teacher made a mistake can say so, from the classroom controls (the step on screen) or from any line of the transcript (an earlier step). An optional note, typed or spoken, says what looks wrong. The teacher model checks the step with thinking on (recomputing numbers, re-deriving formulas, checking facts, units and answer keys), which takes a few seconds to half a minute, then answers at the board. A real mistake is boxed and corrected there, and the lesson itself is fixed where it is kept: the wrong ops, later steps that carried the mistake forward, the narration and check answers. Each fixed op shows **✎ Corrected**, with the original on hover, also in PDF and PNG exports. A step that is right is explained, aimed at the learner's doubt. Either answer stays with the lesson and in the transcript, and neither changes mastery. It works in lessons (answers to raised hands included), instant answers, explainer shorts and the conversation board.
- **Something wrong with this question?**: after a practice, unit-quiz, library-quiz or review question is graded, the learner can ask the teacher to check it, with an optional note, typed or spoken. The teacher model checks the question, its answer key and the grading with thinking on, and the answer appears under the question: a verdict, then a few sentences aimed at the learner's doubt. A question that is wrong is fixed where it is kept (prompt, options, answer, explanation and hints; a review question from a lesson check fixes that check), and it shows **✎ Corrected**, with the original on hover. A question that depends on an unstated convention gets the convention written in, and an answer that is right under another reasonable reading counts as right. A short or written-out answer graded wrongly is graded again. The answer is then graded again against the fixed question, and mastery and the review schedule are recomputed as if it had been graded right the first time: the concept goes back to before that answer, takes the new score, then takes every later answer again in order, and a misconception the misgrade left is dropped. The round's stars, accuracy and streaks follow. The learner can go on while the check runs; a line at the top of the page reports what it found.
- **Exact function plots**: a new board element draws curves from formulas the app computes point by point, so a sine wave or a parabola is never drawn wrong. It takes y = f(x), parametric and polar curves; labelled points (on a curve from their x alone), dashed guides such as asymptotes, shaded areas and tangents; and textbook axes through the origin with arrows, ticks in π for angles and an optional equal scale. Up to four parameters become sliders under the plot; moving one pauses the lesson. Exports and videos show the plot at its default values. Practice and quiz items can use a plot as their figure. Formulas are read in calculator syntax by the plugin's own parser and evaluated over numbers only, never run as code.

### Changed

- The first lesson of the harmonic-motion sample shows its wave as a plot with sliders for the amplitude and the angular frequency.

### Fixed

- **A cloud voice that stops answering is noticed in seconds.** A voice service that took a request and then sent nothing held the first step of a lesson for the full 45-second limit before the note about the missing voice appeared. Now a service that sends nothing for 10 seconds, or stops sending half way, counts as not responding: the note says so and the lesson goes on silently. A long step gets more time to start, up to the old 45 seconds, since Volcengine, MiniMax and many local servers answer only once the whole text is synthesized, and a slow service that is still sending is waited for as before. **Test** in Settings gives up just as quickly.
- **A changed cloud voice is heard at once.** After another voice, model, service or address was chosen in Settings, **Test** and every sentence heard before in the same page still played the old voice until the page was reloaded, because the browser kept audio by its words alone. Audio is now kept per voice, so going back to a voice still finds its audio. **Test** waits for a field just left to be saved. Other open views of the plugin pick up changed settings, the system voice included, without being reopened: the side-panel board, the cards in a conversation, and the plugin in another window or tab of the same browser.
- **Replaying a cloud voice no longer pays for it twice.** Synthesized audio was meant to be kept on this computer so that hearing a lesson again calls the service no more, but the folder for it was never created, so every replay was synthesized and paid for again. The folder is now made with the first audio.
- **The microphone's note fits a narrow window.** Beside the microphone, a note (how to set up Voice input, a refused or missing microphone) was cut off on the left in a narrow window. It now narrows and moves inward to stay on the page.
- **Voice questions use the microphone chosen in DSH.** The microphone followed the system default instead of the input device chosen in the details of DSH's Voice input. It now records from that device, and the button's tooltip names it. When the chosen one is unplugged, the plugin says so instead of switching to another microphone, as DSH does. DSH's speech service does not report the device; the plugin reads the choice where DSH's Voice input keeps it in the browser, and falls back to the system default if it cannot.

## 1.5.0 - 2026-10-21

### Added

- **The board is a canvas**: a lesson's pages sit top to bottom on one canvas that pans (drag, scroll wheel or trackpad) and zooms (Ctrl/⌘ with the wheel, a pinch, or the − and + buttons) from 5 % to 300 %. Double-click a page to fit it, and **All** shows every page. During a lesson the view follows the writing; moving it yourself stops that until **Back to the teacher**. **Settings → Board view → Pages** brings back one page at a time with page numbers. Exports are unchanged.
- **Voice questions**: the ask box in a lesson and the instant-answer box have a microphone. Click it, say the question, click again to stop, and the words are filled into the box to check before asking; a lesson pauses while you speak. Recognition is DSH's experimental Voice input (local SenseVoice, in the language set there), so nothing leaves the computer and the plugin keeps no audio. Until Voice input is enabled in DSH's Plugins page and its model is prepared, the microphone is greyed out and says how to set it up. A recording is at most two minutes.

## 1.4.0 - 2026-10-20

### Added

- **Web research before a course**: a new course can start by looking the subject up with DSH's web search (on by default, off when materials are attached, switchable on the home page). A few searches are made, and what comes back informs the questions and the blueprint. The course page lists the sources under **Sources**. When DSH cannot search, for example without a DeepSeek key, the course is designed as before and the questionnaire says why.
- **Plan calendar with ticks**: the plan page shows a month calendar; past days keep what was planned and what came of it. Finishing a lesson or a review ticks it on its own, and today's or an earlier day's items can be ticked or unticked by hand, here and on the home page. A lesson ticked by hand counts as done, and the days ahead are planned again; time already studied today comes off today's list instead of pulling the next lesson in.
- **Live lesson preparation**: when preparing a lesson takes more than three seconds, the board shows what the teacher is doing instead of a spinner: thinking the lesson through (for a model that thinks first, with how much it has thought), then writing step N with that step's heading appearing as it is written, how many steps are ready and the seconds so far. When the lesson catches up with the writing, it shows the step being written.
- **Board export as PDF and pictures**: **Export board** in a lesson or a short now offers a PDF with one board page per page, a PNG picture per page (several pages come as a ZIP) and the Markdown text as before. The pages are drawn from the board itself, so they keep the handwriting font, formulas, highlights, marks and the questions asked in class, in the board look chosen in Settings.

### Changed

- **Lessons start in a second or two.** Lesson boards (prefetched ones too), re-explanations, instant answers and explainer shorts no longer wait for the model to think first: they ask for no reasoning where the model can turn it off (DeepSeek, for one) and for the model's lightest effort otherwise (low for Claude 5.5, minimal for GPT-5). With DeepSeek-V4.1-Flash, three lessons started 1–2 seconds after they were opened instead of 25–77 seconds, and their boards kept the same shape: hook, figures, a worked example, a written-working check and a recap.

### Fixed

- **The cloud voice works.** With **Cloud voice** chosen, opening a lesson left the plugin page blank, and it stayed blank on every return because the plugin reopens the last screen; **Test** in Settings did nothing. Lessons now play with the cloud voice, **Test** shows what went wrong (a missing key, for one), and a voice that fails to start lets the lesson go on silently instead of breaking the page.
- **A lesson says why it has no voice.** When the cloud voice fails (no key saved, a rejected key, a wrong address or region, a refused request, a timeout) or the system voice cannot speak, a note above the controls gives the reason and the lesson goes on silently, instead of going quiet without a word and asking the service again at every step. A failure that may pass, such as a lost connection or a busy service, turns the voice off only when the next step fails too. **Retry** turns the voice back on and tells the step again, **Settings** opens the voice settings, and the sound button shows the lesson as muted until then. In Settings, a failed **Test** or key change is reported under its button instead of at the top of the page, where a narrow window hid it, and removing a key that fails now says so.
- **Long formulas fit their board column.** A display formula wider than its column was cut off at the column's edge, the rest hidden behind a scroll bar macOS does not show (the overall equation of photosynthesis ended at "C₆H"). It now shrinks onto one line when that keeps at least 70 % of its size, and otherwise breaks after its =, + and → like a teacher carrying on below; only a piece that cannot break, such as a bracket or a matrix, shrinks further. A formula on several lines is written one line at a time. PDF and PNG pages follow the same rule at their own column width.
- While a formula is written, the pencil follows the writing instead of waiting at the formula's end, which for a long formula was over the other column.
- An equation number such as (1) follows its formula instead of covering the formula's last characters, on the board and in exports.
- **Formulas are read as what they show.** Narration (system and cloud voices) and exported videos turned formulas into text that kept the LaTeX names the plugin did not know, such as "P(A mid B)", "xrightarrow光" or "frac6.63×10⁻³⁴…"; about one formula in nine that the model wrote in testing was affected. Every command now reads as what it shows: a condition over an arrow or an equals sign follows it in brackets ("→(光、叶绿体)", "=(点燃)"), marks stay on their letters (D̄, v⃗), the rows of a derivation, a system or a matrix are separated by semicolons, and a command the plugin does not know is left out instead of read out.
- A board could stop in the middle of a step when the model's reasoning used up the output limit (DeepSeek at low effort once thought 40,000 characters before a lesson). A low effort now gets 16k tokens of room for its reasoning instead of 8k.
- On a narrow board, the small "preparing" notice stays on one line instead of breaking after a few characters.
- **Instant answers and shorts fit narrow windows.** In one column (a phone, or DSH at 1024 px with its sidebar open), the follow-up box squeezed an answer's classroom until its controls disappeared, and a short sat in a 16:9 frame that showed little more than its title. Both pages now scroll as a whole: the classroom keeps its full height, with the board at about 60% of the screen and the captions, controls and transcript under it, then the follow-up box and the history. Opening an item from the history, asking a follow-up or making a short scrolls up to the classroom. In wide windows a short now fills the space under its form, as a lesson does.
- **Formulas render as KaTeX meant them again.** The plugin bundled KaTeX 0.16 while DSH 0.2.1 styles formulas with KaTeX 0.18.7's stylesheet, which renamed its layout classes, so superscripts and subscripts were drawn at full size and stacked symbols such as ≠ came apart. The bundled KaTeX is now 0.18.7, and a test keeps the two in step.
- **A crash no longer blanks the plugin.** Anything that went wrong while showing a screen left the whole plugin page blank, and because the plugin reopens the last screen, it stayed blank after a reload, with no way to reach Settings. The screen now shows a short notice with **Retry** and **Back to home** while the navigation keeps working, and the next visit starts at home instead of reopening it. The board tab and the cards in a conversation show the notice with **Retry** in place of the part that failed, instead of DSH swapping them out until it reloads.
- Dashed lines in board figures (guide lines, heights) stay dashed after they are drawn instead of turning solid.
- A highlight may contain a single "=", so `==乘积 = 0==` is highlighted instead of showing its marks.
- **Explain differently works while the board is still being written.** Choosing a style before a new lesson's board was saved showed "Nothing to re-explain yet"; it now re-explains the step on screen from the steps already written. The same goes for instant answers and explainer shorts, where re-explaining, raising a hand or a correction during the writing failed with "Not found". A raised hand and a correction now see the board written so far, a lesson being regenerated is asked about its new steps rather than the old saved ones, and a follow-up in instant help is asked about its own answer rather than the previous one.
- **Every error shows in your language.** Messages that reached the Chinese interface in English ("出了点问题：…" followed by English) now have their own Chinese and English wording: empty inputs, files that cannot be imported, course packs, cloud voice settings and keys, missing items, a lost connection to DSH and others. Messages that only a bug could cause share one line. A test checks that every error the host can send has both.

## 1.3.0 - 2026-10-19

### Added

- **Show your working**: a lesson with a calculation or derivation asks once for the whole working, typed with a live math preview. The grader finds the first line that goes wrong, and the teacher corrects it on the board, starting from that line. The correction stays with the lesson and appears in the transcript.
- **Course size and a visible build**: the questionnaire asks how big the course should be (let the teacher decide, short 3–8, standard 10–20 or full 25–45 lessons). While the blueprint is written you see the steps and the outline growing unit by unit.
- **Blueprint editing**: split a lesson in two or take it deeper with one click; deleting a unit, a chapter or a started lesson asks first; and **Edit outline** in a course's ⋯ menu reopens the editor after the course has started, with **Ask for one more unit**. Progress on lessons that stay is kept.
- **Practice**: items can carry a figure (drawn through the SVG allow-list), a round ends with stars, accuracy, the best streak, how each concept moved and one next step, the current streak shows while you answer, and the keyboard works (1–4 to choose, Enter to submit or continue, H for a hint).
- **Course page**: concepts show five stages (not started, weak, learning, proficient, mastered), and a **Next step** card suggests due reviews first, then the weakest concept, then the next lesson.

### Fixed

- **Reasoning models no longer cut lessons and shorts short.** At its default effort a reasoning model (DeepSeek through DSH or a relay, among others) could spend the whole output limit thinking, so a short stopped after two steps ("came back too short") or came back empty (`EMPTY_RESPONSE`). Boards, shorts, re-explanations and quick answers now ask for a low reasoning effort, every call leaves room for its reasoning within the model's limit, and an answer lost to reasoning is retried with more room. Model errors in the classroom and on checks now show in your language.

### Changed

- **AI changes to a blueprint are proposals**: the editor lists the lessons added, removed, renamed and changed, and nothing changes until you apply them.
- Mastery meters stay empty until there is evidence; an untouched concept no longer lights a segment. **Start review** on a course page reviews that course only.
- Plans and today's list name a course by its emoji and main title (the part before a colon), with the full title on hover.

## 1.2.0 - 2026-10-19

### Added

- **Handwriting board font**: the board writes in LXGW WenKai GB (Chinese) and Caveat (Latin), bundled as OFL subsets (GB 2312 and CJK punctuation, about 1.8 MB) and fetched slice by slice through a new `/api/aha-tutor/font` route, with the system stack as the fallback; the slices a board needs are fetched before the pencil reaches them, and exported videos use the same font. Settings → board font switches between handwriting and the app's standard font.
- **The board follows the narration sentence by sentence**: new lessons tag each board item with the sentence it belongs to, so it is written when that sentence is spoken and highlighted while it is being talked about. Older boards keep their pacing. Exported videos follow the same timing.
- **Side panel in the classroom**: the lesson's goals with progress (new lessons tag each step with the goal it serves), a transcript of what has been said with your questions and re-explanations (click a line to go back to it), and the ask box. It folds away, and drops below the board on narrow screens.

### Fixed

- **Web import** no longer reaches this computer or the local network through other spellings of an address (`localhost.`, `[::ffff:127.0.0.1]`, IPv6 link-local, shared and reserved ranges, `*.internal`) or through a public name that resolves to a private address: every resolved address is checked when the connection is made, each redirect hop is checked again, and the page size is capped while it downloads. Import errors are translated.
- **Leaving a screen no longer cancels its generation.** Blueprints, course confirmation, lesson boards, practice, cheat sheets and digests keep running in the background and are picked up when you come back; long waits show a cancel button instead. A cancelled job reads as cancelled, not failed.
- **Long documents are read in full.** A digest reads the whole document part by part and combines the notes (failed parts are retried once, and any still missing are named in the digest with a "Digest again" button); the summary used for course design samples the whole document instead of its first pages.
- **Captions** show the sentence being spoken, with formulas typeset; narration speaks formulas as readable text instead of raw TeX.
- **Raised-hand answers and re-explanations** appear on the board while they are written, stay with the lesson (replayed where they were asked when you come back), and show up in the side panel's transcript. The saved position now counts the lesson's own steps.
- **Confirming a course is quicker**: it prepares the projects and the first unit's practice; a later lecture gets practice for all its lessons when one of them is first opened or practised, with room for every lesson. The blueprint step shows how many lessons have been written so far.
- **Sample course**: the first lesson of the Bayes sample writes the set {2, 4, 6} as a formula instead of showing stray backslashes.

## 1.1.0 - 2026-10-19

### Added

- **About the author** page at the bottom of the navigation: author, a short note, links to the GitHub repository and issues, and the WeChat and Alipay tip codes (bundled as data URLs, so the page works offline).

### Changed

- The English label of 「我的画像」 is now "My profile", so it no longer reads like the new About page.

## 1.0.0 - 2026-10-18

First release.

### Added

- **Craft a course**: start from a sentence or uploaded materials; an intake of multiple-choice questions about background, goal, depth and time; an editable unit → chapter → lesson blueprint that can also be revised by request; confirming generates practice sets and hands-on projects for the whole course.
- **Whiteboard classroom**: lessons are step scripts (headings, text, KaTeX math, lists, sanitized SVG diagrams, data charts, tables, code, notes, marks and sandboxed animations) played with handwriting reveal synchronized to narration and captions; play and pause (Space), step back and forward (← →), speed, resume from the saved position, a pencil that follows the handwriting and a Markdown export of the board.
- **Adaptive checks**: in-lesson checks with a confidence prompt; a Bayesian knowledge-tracing mastery model that weighs confidence, hints and hesitation; remedial lessons inserted after a lesson for concepts below threshold; challenge suggestions for strong learners.
- **Ask and re-explain**: questions mid-lesson are answered on the board right after the current step, then the lesson resumes; re-explain a step by analogy, drawing, example, simpler or deeper.
- **Practice and review**: per-lesson practice with objective auto-grading and model-graded open answers against key points; flashcards and concepts on an SM-2 spaced-repetition schedule; a study planner that respects weekly time, study days and deadlines and flags deadline risk.
- **Materials**: PDF (pdf.js, with CJK radical repair), Word (.docx), PowerPoint (.pptx), Markdown and text (UTF-8, with a GB18030 fallback), public web pages (Readability, with private-address refusal) and images for vision models; BM25 retrieval with CJK bigrams; page citations; reading digests.
- **Studio**: explain a concept, solve with me, show me visually, topic cheat sheets (columns, font size, highlighting, print), notes, flashcard decks, quizzes and two-minute explainer shorts from a topic or a link.
- **Video export**: any lesson or short renders to a 1280×720 WebM video in the board's theme, with handwriting, captions (no line starts with closing punctuation), a watermark and, with a cloud voice, narration audio. Animations carry an SVG poster frame that stands in for them in videos.
- **Projects**: each project gets a folder with its brief and starter files under `~/AhaTutor/projects/` that opens as a DSH workspace session; existing files are never overwritten. Submissions (notes plus the folder's text files) get a rubric review.
- **Learner profile**: background, goals, preferences and weak spots remembered across courses, with view, edit and clear.
- **Conversation preset** "开窍 · AI 私人老师" with tools `aha_whiteboard`, `aha_quiz`, `aha_course`, `aha_cheatsheet` and `aha_learner`, rendered as cards in the chat; boards open in the right sidebar.
- **Voices**: browser speech by default with per-language voice choice; optional cloud TTS from OpenAI-compatible APIs, Volcengine (Doubao), MiniMax and Azure Speech, with keys in DSH's credential store and a local audio cache.
- **Models**: DSH's default model, with separate overrides for "course design & teaching" and "grading & questions"; vision detection for image materials.
- **Course packs**: export and import `.aha-course.json` packs; two bundled sample courses (harmonic motion, Bayesian thinking).
- **In-plugin update**: checks the registry and installs an exact version with DSH's bundled pnpm in the owning profile; versions inside pnpm's release-age window are reported as pending; `link:` installs are left alone.
- Chinese and English interface; light and dark themes; macOS and Windows support.
