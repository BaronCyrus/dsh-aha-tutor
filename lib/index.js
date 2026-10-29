import { $ as buildIndex, A as shortPrompt, At as normalizePractice, B as EMPTY_PROFILE, Bt as uniqueCards, C as questionnairePrompt, Ct as nextLesson, D as researchQueriesPrompt, Dt as normalizeHandout, E as reexplainPrompt, Et as normalizeCheatsheet, F as fieldCounter, Ft as safeRelativePath, G as passagesFor, Gt as assertId, H as masteryFor, Ht as unitConcepts, I as generateJson, It as shareRange, J as readProgress, K as readMaterials, Kt as newId, L as generateSteps, Lt as takeEvenly, M as verifyItemPrompt, Mt as normalizeQuestionnaire, N as verifyStepPrompt, Nt as outlineForPrompt, O as revisePrompt, Ot as normalizeItem, P as TutorError, Pt as partCardRange, Q as recommendNext, R as generateText, Rt as text, S as projectsPrompt, St as materialQuizRange, T as recognizePrompt, Tt as normalizeCards, U as materialImages, Ut as unitQuizRange, V as emptyProgress, Vt as unitCardRange, W as materialsSummary, Wt as plotToText, X as createConceptState, Y as applyEvidence, Z as masteryPercent, _ as materialBriefPrompt, _t as findLesson, a as assistPrompt, at as snippetOf, b as profilePrompt, bt as intakeSummary, c as cheatsheetPrompt, ct as BOARD_LIMITS, d as digestPartPrompt, dt as normalizeBoard, et as documentParts, f as digestPrompt, ft as normalizeOp, g as lessonPrompt, gt as courseProgress, h as handoutPrompt, ht as conceptIndex, i as askPrompt, it as search, j as summaryPrompt, jt as normalizeProject, k as reworkPrompt, kt as normalizeLesson, l as correctionPrompt, lt as boardToPlainText, m as gradePrompt, mt as blueprintOutline, n as publishRuntime, nt as materialParts, o as blueprintPrompt, ot as spreadPassages, p as flashcardsPrompt, pt as LIMITS, q as readProfile, r as RECOGNIZE_EMPTY, rt as passageRange, s as challengePrompt, st as extractJson, tt as formatPassages, u as detectLanguage, ut as estimateSpeechMs, v as materialsRevisePrompt, vt as flattenLessons, w as quizPrompt, wt as normalizeBlueprint, x as projectReviewPrompt, xt as lessonAfter, y as practicePrompt, yt as insertLesson, z as streamCounter, zt as thinEvenly } from "./runtime-DL1sWVKI.js";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { credentialKey } from "@deepseek-ai/dsh-credentials";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import zlib, { deflateSync } from "node:zlib";
import { lookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { pipeline } from "node:stream";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
//#region src/core/coursepack.js
const COURSEPACK_FORMAT = "aha-tutor.coursepack";
function exportCoursePack({ course, progress, boards = {}, practice = {}, sheets = {}, cards = [], unitCards = {} }, { includeProgress = false, app = {} } = {}) {
	return {
		format: COURSEPACK_FORMAT,
		version: 1,
		exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
		app: {
			name: app.name ?? "dsh-aha-tutor",
			version: app.version ?? null
		},
		course: {
			title: course.title,
			subtitle: course.subtitle,
			emoji: course.emoji,
			summary: course.summary,
			level: course.level,
			language: course.language,
			goal: course.goal,
			units: course.units,
			projects: course.projects
		},
		boards,
		practice,
		sheets,
		cards,
		unitCards,
		progress: includeProgress ? progress ?? null : null
	};
}
function parseCoursePack(input) {
	let pack = input;
	if (typeof input === "string") {
		if (input.length > 8388608) throw packError("pack-too-large", "course pack is too large");
		try {
			pack = JSON.parse(input);
		} catch {
			throw packError("bad-pack", "course pack is not valid JSON");
		}
	}
	if (pack?.format !== "aha-tutor.coursepack") throw packError("bad-pack", "not a course pack");
	if (!Number.isInteger(pack.version) || pack.version > 1) throw packError("pack-too-new", "course pack was made by a newer version of the plugin");
	return pack;
}
function packError(code, message) {
	return Object.assign(new Error(message), { code });
}
function importCoursePack(input, { now = /* @__PURE__ */ new Date() } = {}) {
	const pack = parseCoursePack(input);
	const blueprint = normalizeBlueprint(stripIds(pack.course), { language: pack.course?.language });
	const lessonIdMap = mapLessonIds(pack.course, blueprint);
	const unitIdMap = mapUnitIds(pack.course, blueprint);
	const conceptIdMap = mapConceptIds(pack.course, blueprint);
	const course = {
		id: newId("crs"),
		schemaVersion: 1,
		...blueprint,
		goal: text(pack.course?.goal, 1e3),
		status: "ready",
		origin: {
			kind: "pack",
			importedAt: now.toISOString(),
			app: text(pack.app?.name, 60)
		},
		createdAt: now.toISOString(),
		updatedAt: now.toISOString()
	};
	const conceptIds = [...conceptIdMap.values()];
	const remapConcepts = (ids) => (Array.isArray(ids) ? ids : []).map((id) => conceptIdMap.get(id)).filter(Boolean);
	const boards = {};
	for (const [oldId, board] of Object.entries(pack.boards ?? {})) {
		const newLessonId = lessonIdMap.get(oldId);
		if (!newLessonId) continue;
		try {
			boards[newLessonId] = normalizeBoard({
				...board,
				steps: (board.steps ?? []).map((step) => step.check ? {
					...step,
					check: {
						...step.check,
						conceptIds: remapConcepts(step.check.conceptIds)
					}
				} : step)
			}, { conceptIds });
		} catch {}
	}
	const practice = {};
	for (const [oldId, set] of Object.entries(pack.practice ?? {})) {
		const newLessonId = lessonIdMap.get(oldId);
		if (!newLessonId) continue;
		const normalized = normalizePractice({ items: (set?.items ?? []).map((item) => ({
			...item,
			conceptIds: remapConcepts(item.conceptIds)
		})) }, conceptIds);
		if (normalized.items.length) practice[newLessonId] = normalized;
	}
	const sheets = {};
	for (const [oldId, sheet] of Object.entries(pack.sheets ?? {})) {
		const newUnitId = unitIdMap.get(oldId);
		if (!newUnitId) continue;
		try {
			sheets[newUnitId] = normalizeCheatsheet(sheet);
		} catch {}
	}
	const cards = normalizeCards(pack.cards ?? []);
	const unitCards = {};
	for (const [oldId, deck] of Object.entries(pack.unitCards ?? {})) {
		const newUnitId = unitIdMap.get(oldId);
		const unitDeck = newUnitId ? normalizeCards(deck) : [];
		if (unitDeck.length) unitCards[newUnitId] = unitDeck;
	}
	return {
		course,
		boards,
		practice,
		sheets,
		cards,
		unitCards,
		progress: pack.progress ? remapProgress(pack.progress, lessonIdMap, conceptIdMap) : null
	};
}
function stripIds(course) {
	return {
		...course,
		units: (course?.units ?? []).map((unit) => ({
			...unit,
			id: void 0,
			lectures: (unit.lectures ?? []).map((lecture) => ({
				...lecture,
				id: void 0,
				lessons: (lecture.lessons ?? []).map((lesson) => ({
					...lesson,
					id: void 0,
					concepts: (lesson.concepts ?? []).map((concept) => ({
						...concept,
						id: void 0
					}))
				}))
			}))
		})),
		projects: (course?.projects ?? []).map((project) => ({
			...project,
			id: void 0
		}))
	};
}
function zipLessons(original, normalized) {
	const pairs = [];
	const flat = (course) => (course?.units ?? []).flatMap((unit) => (unit.lectures ?? []).flatMap((lecture) => lecture.lessons ?? []));
	const before = flat(original).filter((lesson) => text(lesson?.title, 120));
	flat(normalized).forEach((lesson, index) => {
		const source = before[index];
		if (source && text(source.title, 120) === lesson.title) pairs.push([source, lesson]);
	});
	return pairs;
}
function mapLessonIds(original, normalized) {
	const map = /* @__PURE__ */ new Map();
	for (const [source, lesson] of zipLessons(original, normalized)) if (typeof source.id === "string") map.set(source.id, lesson.id);
	return map;
}
function mapConceptIds(original, normalized) {
	const map = /* @__PURE__ */ new Map();
	for (const [source, lesson] of zipLessons(original, normalized)) (source.concepts ?? []).forEach((concept, index) => {
		if (typeof concept?.id === "string" && lesson.concepts[index]) map.set(concept.id, lesson.concepts[index].id);
	});
	return map;
}
function mapUnitIds(original, normalized) {
	const map = /* @__PURE__ */ new Map();
	const before = (original?.units ?? []).filter((unit) => text(unit?.title, 120));
	normalized.units.forEach((unit, index) => {
		const source = before[index];
		if (source && typeof source.id === "string" && text(source.title, 120) === unit.title) map.set(source.id, unit.id);
	});
	return map;
}
function remapProgress(progress, lessonIdMap, conceptIdMap) {
	const lessons = {};
	for (const [id, value] of Object.entries(progress.lessons ?? {})) {
		const mapped = lessonIdMap.get(id);
		if (mapped && value && typeof value === "object") lessons[mapped] = {
			status: [
				"new",
				"learning",
				"done"
			].includes(value.status) ? value.status : "new",
			stepIndex: Number(value.stepIndex) || 0,
			completedAt: value.completedAt ?? null
		};
	}
	const concepts = {};
	for (const [id, value] of Object.entries(progress.concepts ?? {})) {
		const mapped = conceptIdMap.get(id);
		if (mapped && value && typeof value === "object") concepts[mapped] = {
			...value,
			id: mapped,
			history: []
		};
	}
	return {
		lessons,
		concepts,
		cards: {},
		projects: {},
		events: []
	};
}
//#endregion
//#region src/core/srs.js
const GRADES$1 = Object.freeze([
	"again",
	"hard",
	"good",
	"easy"
]);
const GRADE_QUALITY = Object.freeze({
	again: 1,
	hard: 3,
	good: 4,
	easy: 5
});
const DAY_MS$1 = 1440 * 60 * 1e3;
const MIN_EASE = 1.3;
const MAX_INTERVAL_DAYS = 365;
function createCard(id, now = Date.now()) {
	return {
		id,
		ease: 2.5,
		intervalDays: 0,
		reps: 0,
		lapses: 0,
		dueAt: new Date(now).toISOString(),
		lastReviewedAt: null
	};
}
function review(card, grade, now = Date.now()) {
	if (!GRADES$1.includes(grade)) throw new TypeError(`grade must be one of ${GRADES$1.join(", ")}`);
	const quality = GRADE_QUALITY[grade];
	const next = { ...card };
	next.ease = Math.max(MIN_EASE, round2$1(card.ease + .1 - (5 - quality) * (.08 + (5 - quality) * .02)));
	if (grade === "again") {
		next.reps = 0;
		next.lapses = card.lapses + 1;
		next.intervalDays = 0;
		next.dueAt = new Date(now + 600 * 1e3).toISOString();
	} else {
		next.reps = card.reps + 1;
		let interval;
		if (next.reps === 1) interval = grade === "easy" ? 3 : 1;
		else if (next.reps === 2) interval = grade === "hard" ? 3 : 6;
		else interval = Math.round(card.intervalDays * next.ease);
		if (grade === "hard") interval = Math.max(1, Math.round(interval * .8));
		if (grade === "easy" && next.reps > 1) interval = Math.round(interval * 1.3);
		next.intervalDays = Math.min(MAX_INTERVAL_DAYS, Math.max(1, interval));
		next.dueAt = new Date(now + next.intervalDays * DAY_MS$1).toISOString();
	}
	next.lastReviewedAt = new Date(now).toISOString();
	return next;
}
function isDue(card, now = Date.now()) {
	return Date.parse(card?.dueAt ?? 0) <= now;
}
function deckStatus(deck, now = Date.now()) {
	const cards = Array.isArray(deck?.cards) ? deck.cards : [];
	const states = deck?.srs ?? {};
	const due = cards.filter((card) => states[card.id] && isDue(states[card.id], now)).length;
	return {
		total: cards.length,
		due,
		fresh: cards.filter((card) => !states[card.id]).length
	};
}
function gradeFromScore(score, confidence) {
	if (score < .5) return "again";
	if (score < .8 || confidence === "guess") return "hard";
	if (score >= .95 && confidence === "sure") return "easy";
	return "good";
}
function round2$1(value) {
	return Math.round(value * 100) / 100;
}
//#endregion
//#region src/host/courses.js
const TIMELINES = [
	"intensive",
	"balanced",
	"relaxed"
];
const SIZES = [
	"auto",
	"short",
	"standard",
	"full"
];
function outlineStream(api) {
	let soFar = "";
	const counter = streamCounter("\"estMinutes\"", (count) => {
		api.progress(count, 0, "blueprint");
		try {
			api.preview(blueprintOutline(extractJson(soFar)));
		} catch {}
	});
	return (delta) => {
		soFar += String(delta ?? "");
		counter(delta);
	};
}
function createCourses({ store, llm, jobs, research, now = () => /* @__PURE__ */ new Date() }) {
	const stamp = () => now().toISOString();
	async function readCourse(courseId) {
		const course = await store.readJson(store.paths.course(assertId(courseId, "crs")), null);
		if (!course) throw new TutorError("not-found", "Course not found");
		return course;
	}
	const saveCourse = (course) => store.writeJson(store.paths.course(course.id), {
		...course,
		updatedAt: stamp()
	});
	async function summary(courseId) {
		const course = await store.readJson(store.paths.course(courseId), null);
		if (!course) return null;
		const progress = await readProgress(store, courseId);
		const stats = course.units ? courseProgress(course, progress) : {
			total: 0,
			done: 0,
			percent: 0,
			minutesLeft: 0
		};
		const next = course.units ? nextLesson(course, progress) : null;
		return {
			id: course.id,
			title: course.title || course.goal,
			subtitle: course.subtitle ?? "",
			emoji: course.emoji ?? "📘",
			status: course.status,
			language: course.language,
			level: course.level ?? "",
			progress: stats,
			next: next ? {
				lessonId: next.lesson.id,
				title: next.lesson.title,
				unit: next.unit.title
			} : null,
			updatedAt: course.updatedAt,
			createdAt: course.createdAt,
			archived: course.archived === true,
			origin: course.origin?.kind ?? "crafted"
		};
	}
	async function list() {
		const ids = await store.listIds(store.paths.courses(), "crs");
		return (await Promise.all(ids.map((id) => summary(id).catch(() => null)))).filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
	}
	async function get({ courseId }) {
		const course = await readCourse(courseId);
		const [progress, intake, proposal] = await Promise.all([
			readProgress(store, courseId),
			store.readJson(store.paths.intake(courseId), null),
			store.readJson(store.paths.proposal(courseId), null)
		]);
		const boards = new Set(await store.listIds(store.paths.boardsDir(courseId), "les"));
		const practice = new Set(await store.listIds(store.paths.practiceDir(courseId), "les"));
		const sheets = new Set(await store.listIds(store.paths.sheetsDir(courseId), "unt"));
		return {
			course,
			progress,
			intake,
			proposal,
			jobs: {
				questions: jobs.running(`questions:${courseId}`),
				blueprint: jobs.running(`blueprint:${courseId}`),
				confirm: jobs.running(`confirm:${courseId}`)
			},
			ready: {
				boards: [...boards],
				practice: [...practice],
				sheets: [...sheets],
				cards: await cardsReady(course)
			}
		};
	}
	async function cardsReady(course) {
		const at = now().getTime();
		const units = {};
		let review = 0;
		for (const unitId of await store.listIds(store.paths.unitCardsDir(course.id), "unt")) {
			if (!course.units?.some((unit) => unit.id === unitId)) continue;
			const status = deckStatus(await store.readJson(store.paths.unitCards(course.id, unitId), null), at);
			if (!status.total) continue;
			units[unitId] = status;
			review += status.due;
		}
		const old = deckStatus(await store.readJson(store.paths.cards(course.id), null), at);
		return {
			units,
			review: review + old.due + old.fresh,
			decks: Object.keys(units).length + (old.total ? 1 : 0)
		};
	}
	function startCraft({ goal, materialIds = [], quick = false, language, web = false }) {
		const cleanGoal = text(goal, 2e3);
		if (!cleanGoal && !materialIds.length) throw new TutorError("empty-goal", "Tell me what you want to learn");
		const ids = materialIds.filter((id) => /^mat_[a-z0-9]+$/u.test(id)).slice(0, 8);
		const courseId = newId("crs");
		return jobs.start("craft/start", async (api) => {
			api.progress(0, quick ? 1 : 2, "questions");
			const materials = await readMaterials(store, ids);
			const draft = {
				id: courseId,
				schemaVersion: 1,
				status: "intake",
				goal: cleanGoal || materials.map((item) => item.meta.brief?.suggestedGoal || item.meta.title).join("; "),
				language: language || detectLanguage(`${cleanGoal} ${materials.map((item) => item.meta.title).join(" ")}`),
				materialIds: ids,
				createdAt: stamp()
			};
			await saveCourse(draft);
			let found = null;
			if (web && research) {
				api.progress(0, quick ? 1 : 2, "research");
				found = await research.run({
					goal: draft.goal,
					language: draft.language,
					signal: api.signal
				});
				api.progress(0, quick ? 1 : 2, "questions");
			}
			if (quick) {
				if (found) await store.writeJson(store.paths.intake(courseId), {
					questionnaire: null,
					answers: {},
					research: found,
					at: stamp()
				});
				return {
					courseId,
					questionnaire: null,
					research: found
				};
			}
			const profile = await readProfile(store);
			const questionnaire = await generateJson(llm, {
				purpose: "teach",
				prompt: questionnairePrompt({
					goal: draft.goal,
					language: draft.language,
					materialsSummary: materialsSummary(materials),
					profile,
					sources: found?.sources
				}),
				maxTokens: 3e3,
				signal: api.signal,
				normalize: (raw) => {
					const value = normalizeQuestionnaire(raw);
					if (!value.questions.length) throw new Error("no questions");
					return value;
				}
			});
			await store.writeJson(store.paths.intake(courseId), {
				questionnaire,
				answers: {},
				...found ? { research: found } : {},
				at: stamp()
			});
			api.progress(1, 2, "questions");
			return {
				courseId,
				questionnaire,
				research: found
			};
		}, {
			key: `questions:${courseId}`,
			meta: { courseId }
		});
	}
	function submitIntake({ courseId, answers = {}, timeline = "balanced", size = "auto", weeklyMinutes, deadline }) {
		assertId(courseId, "crs");
		return jobs.start("craft/blueprint", async (api) => {
			const course = await readCourse(courseId);
			const intake = await store.readJson(store.paths.intake(courseId), null) ?? {
				questionnaire: null,
				answers: {}
			};
			const cleanAnswers = sanitizeAnswers(intake.questionnaire, answers);
			await store.writeJson(store.paths.intake(courseId), {
				...intake,
				answers: cleanAnswers,
				at: stamp()
			});
			if (course.materialIds?.length) api.progress(0, 0, "materials");
			const materials = await readMaterials(store, course.materialIds ?? []);
			const profile = await readProfile(store);
			const settings = {
				timeline: TIMELINES.includes(timeline) ? timeline : "balanced",
				size: SIZES.includes(size) ? size : "auto",
				weeklyMinutes: clampMinutes(weeklyMinutes),
				deadline: /^\d{4}-\d{2}-\d{2}$/u.test(String(deadline ?? "")) ? deadline : null
			};
			api.progress(0, 0, "blueprint");
			const blueprint = await generateJson(llm, {
				purpose: "teach",
				prompt: blueprintPrompt({
					goal: course.goal,
					language: course.language,
					intake: intakeSummary(intake.questionnaire, cleanAnswers),
					materialsSummary: materialsSummary(materials),
					profile,
					timeline: settings.timeline,
					size: settings.size,
					weeklyMinutes: settings.weeklyMinutes,
					sources: intake.research?.sources
				}),
				images: llm.supportsImages?.("teach") ? await materialImages(store, materials) : void 0,
				maxTokens: 16e3,
				signal: api.signal,
				onText: outlineStream(api),
				normalize: (raw) => attachProjectUnits(raw, normalizeBlueprint(raw, { language: course.language }))
			});
			const sources = intake.research?.sources ?? [];
			const next = {
				...course,
				...blueprint,
				language: course.language,
				status: "blueprint",
				settings,
				...sources.length ? { sources } : {}
			};
			await saveCourse(next);
			return { course: next };
		}, {
			key: `blueprint:${courseId}`,
			meta: { courseId }
		});
	}
	function revise({ courseId, instruction }) {
		const request = text(instruction, 1500);
		if (!request) throw new TutorError("empty-change", "Describe the change you want");
		return jobs.start("craft/revise", async (api) => {
			const course = await readCourse(courseId);
			if (!course.units) throw new TutorError("no-blueprint", "There is no blueprint to revise yet");
			const current = {
				title: course.title,
				subtitle: course.subtitle,
				emoji: course.emoji,
				summary: course.summary,
				level: course.level,
				units: course.units,
				projects: course.projects
			};
			api.progress(0, 0, "blueprint");
			const revised = await generateJson(llm, {
				purpose: "teach",
				prompt: revisePrompt({
					blueprint: current,
					instruction: request,
					language: course.language
				}),
				maxTokens: 16e3,
				signal: api.signal,
				onText: streamCounter("\"estMinutes\"", (count) => api.progress(count, 0, "blueprint")),
				normalize: (raw) => attachProjectUnits(raw, normalizeBlueprint(raw, { language: course.language }))
			});
			const proposal = {
				instruction: request,
				at: stamp(),
				blueprint: revised
			};
			await store.writeJson(store.paths.proposal(courseId), proposal);
			return {
				course,
				proposal
			};
		}, {
			key: `blueprint:${courseId}`,
			meta: { courseId }
		});
	}
	function addMaterials({ courseId, materialIds = [], instruction }) {
		const wanted = [...new Set(materialIds)].filter((id) => /^mat_[a-z0-9]+$/u.test(id)).slice(0, 12);
		if (!wanted.length) throw new TutorError("no-materials", "Choose at least one material");
		const request = text(instruction, 600);
		return jobs.start("craft/revise", async (api) => {
			const course = await readCourse(courseId);
			if (!course.units) throw new TutorError("no-blueprint", "There is no blueprint to revise yet");
			const known = course.materialIds ?? [];
			const added = (await readMaterials(store, wanted.filter((id) => !known.includes(id)))).slice(0, Math.max(0, 12 - known.length));
			if (!added.length) throw new TutorError(wanted.every((id) => known.includes(id)) ? "materials-known" : known.length >= 12 ? "materials-full" : "not-found", "These materials cannot be added");
			const current = {
				title: course.title,
				subtitle: course.subtitle,
				emoji: course.emoji,
				summary: course.summary,
				level: course.level,
				units: course.units,
				projects: course.projects
			};
			const share = Math.floor(9e3 / added.length);
			const passages = added.filter((item) => item.chunks.length).map((item) => formatPassages(spreadPassages(item.chunks, {
				maxChars: share,
				samples: 8
			}), item.meta.title)).join("\n\n");
			api.progress(0, 0, "blueprint");
			const revised = await generateJson(llm, {
				purpose: "teach",
				prompt: materialsRevisePrompt({
					blueprint: current,
					materials: materialsSummary(added),
					passages,
					instruction: request,
					language: course.language
				}),
				images: llm.supportsImages?.("teach") ? await materialImages(store, added) : void 0,
				maxTokens: 16e3,
				signal: api.signal,
				onText: streamCounter("\"estMinutes\"", (count) => api.progress(count, 0, "blueprint")),
				normalize: (raw) => attachProjectUnits(raw, normalizeBlueprint(raw, { language: course.language }))
			});
			const proposal = {
				instruction: request,
				materials: added.map((item) => ({
					id: item.meta.id,
					title: item.meta.title
				})),
				at: stamp(),
				blueprint: revised
			};
			await store.writeJson(store.paths.proposal(courseId), proposal);
			return {
				course,
				proposal
			};
		}, {
			key: `blueprint:${courseId}`,
			meta: { courseId }
		});
	}
	async function applyProposal({ courseId }) {
		const course = await readCourse(courseId);
		const proposal = await store.readJson(store.paths.proposal(courseId), null);
		if (!proposal?.blueprint?.units) throw new TutorError("no-proposal", "There is no proposed change");
		const materialIds = [.../* @__PURE__ */ new Set([...course.materialIds ?? [], ...(proposal.materials ?? []).map((item) => item.id)])].slice(0, 12);
		const next = {
			...course,
			...proposal.blueprint,
			language: course.language,
			status: course.status === "ready" ? "ready" : "blueprint",
			...materialIds.length ? { materialIds } : {}
		};
		await saveCourse(next);
		await store.removeDir(store.paths.proposal(courseId));
		return { course: next };
	}
	async function discardProposal({ courseId }) {
		assertId(courseId, "crs");
		await store.removeDir(store.paths.proposal(courseId));
		return { ok: true };
	}
	function reworkLesson({ courseId, lesson: raw, unitTitle, lectureTitle, mode }) {
		const split = mode === "split";
		const lesson = normalizeLesson(raw);
		if (!lesson) throw new TutorError("invalid", "Unknown lesson");
		return jobs.start("craft/rework", async (api) => {
			const course = await readCourse(courseId);
			return { lessons: await generateJson(llm, {
				purpose: "teach",
				prompt: reworkPrompt({
					outline: outlineForPrompt(course, { maxChars: 4e3 }),
					unitTitle: text(unitTitle, 120),
					lectureTitle: text(lectureTitle, 120),
					lesson: {
						title: lesson.title,
						summary: lesson.summary,
						objectives: lesson.objectives,
						concepts: lesson.concepts.map((concept) => concept.name),
						estMinutes: lesson.estMinutes
					},
					mode: split ? "split" : "deepen",
					language: course.language
				}),
				maxTokens: 3e3,
				signal: api.signal,
				normalize: (value) => {
					const list = (Array.isArray(value?.lessons) ? value.lessons : [value]).map((entry) => normalizeLesson({
						...entry,
						id: void 0
					})).filter(Boolean).slice(0, split ? 3 : 1);
					if (split ? list.length < 2 : !list.length) throw new Error("no usable lessons");
					return list;
				}
			}) };
		}, {
			key: `rework:${courseId}:${lesson.id}`,
			meta: { courseId }
		});
	}
	async function saveBlueprint({ courseId, blueprint }) {
		const course = await readCourse(courseId);
		const normalized = normalizeBlueprint({
			...blueprint,
			projects: blueprint?.projects ?? course.projects
		}, { language: course.language });
		normalized.projects = normalized.projects.map((project) => ({
			...project,
			unitId: normalized.units.some((unit) => unit.id === project.unitId) ? project.unitId : normalized.units[normalized.units.length - 1].id
		}));
		const next = {
			...course,
			...normalized,
			language: course.language
		};
		await saveCourse(next);
		return { course: next };
	}
	async function writeLecturePractice({ course, lecture, lessons = lecture.lessons, materials, signal }) {
		const query = lessons.map((lesson) => `${lesson.title} ${lesson.objectives.join(" ")}`).join(" ");
		const sources = materials ?? await readMaterials(store, course.materialIds ?? []);
		const sets = await generateJson(llm, {
			purpose: "teach",
			prompt: practicePrompt({
				course,
				lecture,
				lessons,
				language: course.language,
				passages: passagesFor(sources, query, 5e3)
			}),
			maxTokens: Math.min(16e3, 3e3 + lessons.length * 2600),
			signal,
			normalize: (raw) => raw?.lessons ?? raw
		});
		const written = {};
		for (const lesson of lessons) {
			const set = normalizePractice(sets?.[lesson.id] ?? sets?.[lesson.title] ?? (lessons.length === 1 ? Object.values(sets ?? {})[0] : void 0) ?? { items: [] }, lesson.concepts.map((concept) => concept.id));
			if (!set.items.length) continue;
			written[lesson.id] = {
				lessonId: lesson.id,
				...set,
				createdAt: stamp()
			};
			await store.writeJson(store.paths.practice(course.id, lesson.id), written[lesson.id]);
		}
		return written;
	}
	function confirm({ courseId }) {
		return jobs.start("craft/confirm", async (api) => {
			const course = await readCourse(courseId);
			if (!course.units) throw new TutorError("no-blueprint", "Generate a blueprint first");
			const lectures = course.units.slice(0, 1).flatMap((unit) => unit.lectures.map((lecture) => ({
				unit,
				lecture
			})));
			const total = lectures.length + (course.projects?.length ? 1 : 0);
			let done = 0;
			const warnings = [];
			const materials = await readMaterials(store, course.materialIds ?? []);
			api.progress(done, total, "projects");
			if (course.projects?.length) {
				try {
					const expanded = await generateJson(llm, {
						purpose: "teach",
						prompt: projectsPrompt({
							course: {
								...course,
								outline: outlineForPrompt(course)
							},
							projects: course.projects,
							language: course.language
						}),
						maxTokens: 14e3,
						signal: api.signal,
						normalize: (raw) => Array.isArray(raw?.projects) ? raw.projects : []
					});
					course.projects = course.projects.map((project) => {
						const detail = expanded.find((item) => item?.id === project.id) ?? expanded.find((item) => text(item?.title, 120) === project.title);
						return detail ? normalizeProject({
							...project,
							...detail,
							id: project.id,
							unitId: project.unitId
						}) ?? project : project;
					});
				} catch (error) {
					if (api.signal.aborted) throw error;
					warnings.push("projects");
				}
				done += 1;
				api.progress(done, total, "practice");
			}
			const queue = [...lectures];
			const worker = async () => {
				while (queue.length) {
					api.signal.throwIfAborted();
					const { lecture } = queue.shift();
					try {
						await writeLecturePractice({
							course,
							lecture,
							materials,
							signal: api.signal
						});
					} catch (error) {
						if (api.signal.aborted) throw error;
						warnings.push(lecture.id);
					}
					done += 1;
					api.progress(done, total, "practice");
				}
			};
			await Promise.all([worker(), worker()]);
			const next = {
				...course,
				status: "ready",
				confirmedAt: stamp()
			};
			await saveCourse(next);
			if (!await store.exists(store.paths.progress(course.id))) await store.writeJson(store.paths.progress(course.id), emptyProgress(course.id));
			return {
				course: next,
				warnings
			};
		}, {
			key: `confirm:${courseId}`,
			meta: { courseId }
		});
	}
	async function update({ courseId, title, archived, settings }) {
		const course = await readCourse(courseId);
		const next = { ...course };
		if (title !== void 0) next.title = text(title, 120) || course.title;
		if (archived !== void 0) next.archived = archived === true;
		if (settings && typeof settings === "object") next.settings = {
			...course.settings,
			...settings.weeklyMinutes !== void 0 ? { weeklyMinutes: clampMinutes(settings.weeklyMinutes) } : {},
			...settings.deadline !== void 0 ? { deadline: /^\d{4}-\d{2}-\d{2}$/u.test(String(settings.deadline)) ? settings.deadline : null } : {}
		};
		await saveCourse(next);
		return summary(courseId);
	}
	async function remove({ courseId }) {
		assertId(courseId, "crs");
		await store.removeDir(store.paths.courseDir(courseId));
		return { removed: courseId };
	}
	async function exportPack({ courseId, includeProgress = false, appVersion }) {
		const course = await readCourse(courseId);
		const progress = await readProgress(store, courseId);
		const boards = {};
		const practice = {};
		const sheets = {};
		for (const { lesson } of flattenLessons(course)) {
			const board = await store.readJson(store.paths.board(courseId, lesson.id), null);
			if (board) boards[lesson.id] = board;
			const set = await store.readJson(store.paths.practice(courseId, lesson.id), null);
			if (set) practice[lesson.id] = set;
		}
		for (const unit of course.units ?? []) {
			const sheet = await store.readJson(store.paths.sheet(courseId, unit.id), null);
			if (sheet) sheets[unit.id] = sheet;
		}
		const cards = (await store.readJson(store.paths.cards(courseId), null))?.cards ?? [];
		const unitCards = {};
		for (const unit of course.units ?? []) {
			const deck = await store.readJson(store.paths.unitCards(courseId, unit.id), null);
			if (deck?.cards?.length) unitCards[unit.id] = deck.cards;
		}
		const pack = exportCoursePack({
			course,
			progress,
			boards,
			practice,
			sheets,
			cards,
			unitCards
		}, {
			includeProgress: includeProgress === true,
			app: { version: appVersion }
		});
		return {
			fileName: `${safeFileName(course.title)}.aha-course.json`,
			json: JSON.stringify(pack)
		};
	}
	async function importPack({ json }) {
		let imported;
		try {
			imported = importCoursePack(json);
		} catch (error) {
			const known = [
				"bad-pack",
				"pack-too-large",
				"pack-too-new"
			].includes(error?.code);
			throw new TutorError(known ? error.code : "bad-pack", known ? error.message : "not a course pack");
		}
		const { course } = imported;
		await saveCourse(course);
		for (const [lessonId, board] of Object.entries(imported.boards)) await store.writeJson(store.paths.board(course.id, lessonId), board);
		for (const [lessonId, set] of Object.entries(imported.practice)) await store.writeJson(store.paths.practice(course.id, lessonId), {
			lessonId,
			...set
		});
		for (const [unitId, sheet] of Object.entries(imported.sheets)) await store.writeJson(store.paths.sheet(course.id, unitId), sheet);
		if (imported.cards.length) await store.writeJson(store.paths.cards(course.id), {
			cards: imported.cards,
			srs: {}
		});
		for (const [unitId, cards] of Object.entries(imported.unitCards)) await store.writeJson(store.paths.unitCards(course.id, unitId), {
			unitId,
			cards,
			srs: {},
			createdAt: stamp()
		});
		await store.writeJson(store.paths.progress(course.id), {
			...emptyProgress(course.id),
			...imported.progress ?? {},
			courseId: course.id
		});
		return summary(course.id);
	}
	return Object.freeze({
		list,
		get,
		summary,
		readCourse,
		saveCourse,
		startCraft,
		submitIntake,
		revise,
		addMaterials,
		applyProposal,
		discardProposal,
		reworkLesson,
		saveBlueprint,
		writeLecturePractice,
		confirm,
		update,
		remove,
		exportPack,
		importPack
	});
}
function sanitizeAnswers(questionnaire, answers) {
	const clean = {};
	for (const question of questionnaire?.questions ?? []) {
		const answer = answers?.[question.id];
		if (!answer || typeof answer !== "object") continue;
		const valid = new Set(question.options.map((option) => option.id));
		const choice = (Array.isArray(answer.choice) ? answer.choice : []).filter((id) => valid.has(id)).slice(0, question.multi ? 5 : 1);
		const other = text(answer.other, 300);
		if (choice.length || other) clean[question.id] = {
			choice,
			other
		};
	}
	return clean;
}
function clampMinutes(value) {
	const number = Math.round(Number(value));
	return Number.isFinite(number) && number > 0 ? Math.min(3e3, Math.max(30, number)) : null;
}
function attachProjectUnits(raw, blueprint) {
	const rawProjects = Array.isArray(raw?.projects) ? raw.projects : [];
	blueprint.projects = blueprint.projects.map((project) => {
		if (project.unitId && blueprint.units.some((unit) => unit.id === project.unitId)) return project;
		const source = rawProjects.find((item) => text(item?.title, 120) === project.title);
		const index = Math.round(Number(source?.unitIndex));
		const unit = blueprint.units[Number.isFinite(index) ? Math.min(blueprint.units.length - 1, Math.max(0, index)) : blueprint.units.length - 1];
		return {
			...project,
			unitId: unit.id
		};
	});
	return blueprint;
}
function safeFileName(value) {
	const cleaned = String(value ?? "course").replace(/[<>:"/\\|?*\u0000-\u001f]/gu, " ").replace(/\s+/gu, " ").trim().replace(/[. ]+$/u, "").slice(0, 60);
	return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(cleaned) || !cleaned ? "course" : cleaned;
}
//#endregion
//#region src/core/board-fonts.js
const BOARD_FONT_FILES = Object.freeze([
	Object.freeze({
		family: "Aha Hand Latin",
		file: "caveat-latin-d0b7b931.woff2",
		bytes: 48836,
		unicodeRange: "U+0,U+D,U+20-7E,U+A0-FF,U+131,U+152-153,U+20AC,U+2122"
	}),
	Object.freeze({
		family: "Aha Hand",
		file: "wenkai-gb-0-88f1a875.woff2",
		bytes: 93632,
		unicodeRange: "U+20-7E,U+A0-AC,U+AE-FF,U+101,U+113,U+11B,U+12B,U+14D,U+16B,U+1CE,U+1D0,U+1D2,U+1D4,U+1D6,U+1D8,U+1DA,U+1DC,U+2C7,U+2C9,U+391-3A1,U+3A3-3A9,U+3B1-3C1,U+3C3-3C9,U+401,U+410-44F,U+451,U+2010-2016,U+2018-2022,U+2025-2027,U+2030-2037,U+2039-203F,U+2042,U+2044,U+2047-2049,U+2051-2052,U+205A,U+205D,U+2100-2101,U+2103,U+2105-2106,U+2109-210A,U+210E-210F,U+2113,U+2116-2117,U+211E,U+2120-2122,U+2126-2127,U+2129-212B,U+212E,U+2132,U+2135,U+213B,U+2141-2144,U+214B,U+214D-214E,U+2150-218B,U+2190-2199,U+21B6-21B9,U+21C4-21C6,U+21CB-21D0,U+21D2,U+21D4,U+21E6-21EA,U+21F5,U+2200-220D,U+220F,U+2211-2213,U+2215-2216,U+2219-2220,U+2223-2230,U+2234-2237,U+223C-223E,U+2242-2243,U+2245,U+2248,U+224B-224C,U+2251-2253,U+225C,U+2260-2262,U+2264-226B,U+226E-226F,U+2272-2273,U+2276-2277,U+2282-228B,U+2295-2299,U+229C-229E,U+22A0,U+22A2-22A5,U+22BF-22C5,U+22DA-22DB,U+22EE-22F1,U+2312,U+2460-249F,U+2500-25AB,U+25B1-25B3,U+25B6-25B7,U+25BC-25BD,U+25C0-25C1,U+25C6-25C7,U+25C9-25CC,U+25CE-25D3,U+25E2-25E6,U+25EF,U+25FB-25FC,U+2605-2606,U+2640,U+2642,U+3000-302D,U+3030,U+3033-303F,U+3041-3093,U+30A1-30F6,U+30FB,U+3105-3129,U+3220-3229,U+FF01-FF5E,U+FFE0-FFE1,U+FFE3,U+FFE5"
	}),
	Object.freeze({
		family: "Aha Hand",
		file: "wenkai-gb-1-78a38e72.woff2",
		bytes: 315108,
		unicodeRange: "U+4E01,U+4E0D,U+4E11,U+4E19,U+4E1B-4E1C,U+4E22,U+4E2A,U+4E30,U+4E32,U+4E39,U+4E4E-4E4F,U+4E56,U+4E58,U+4E8C,U+4E92,U+4EA4-4EA5,U+4EA7-4EA8,U+4EC7,U+4ECE,U+4ED3,U+4ED8,U+4EE3,U+4EF6-4EF7,U+4EFD,U+4EFF,U+4F0E-4F10,U+4F19-4F1A,U+4F20,U+4F2F-4F30,U+4F34,U+4F43,U+4F46,U+4F4E,U+4F55,U+4F5B,U+4F70,U+4F73,U+4F88,U+4F97,U+4F9B,U+4FA7,U+4FAF,U+4FBF,U+4FC3-4FC4,U+4FD8,U+4FDD,U+4FED,U+4FEF,U+4FFA,U+500D,U+5012,U+5019,U+5021,U+5047,U+5065,U+507F,U+5085,U+508D,U+50A3,U+50A8,U+50AC,U+50B2,U+50F5,U+513F,U+5145,U+5149,U+5151,U+515A,U+515C,U+516B-516C,U+5171,U+5173,U+5175,U+5178,U+517C,U+5180,U+5188,U+518C,U+51A0,U+51AC,U+51AF-51B0,U+51B2,U+51BB,U+51CB,U+51CF,U+51D1,U+51E0-51E1,U+51E4,U+51F0,U+51F3,U+51F9-51FB,U+51FD,U+5200-5201,U+5206,U+5212,U+521A-521B,U+521D,U+522B,U+522E,U+5230,U+523A,U+523D,U+5241-5242,U+5250-5251,U+5265,U+526A,U+526F,U+5272,U+529E-52A0,U+52A8,U+52C3,U+52FE,U+5305-5306,U+5316-5317,U+5319,U+5320,U+532A,U+5349-534A,U+534E,U+5351,U+5355,U+535A,U+535C,U+535E,U+5373,U+5382,U+5384,U+5395,U+539A,U+53A8,U+53C2,U+53C9-53CA,U+53CD,U+53D1,U+53D8,U+53E0,U+53E4,U+53ED-53EE,U+53F7,U+53FC,U+5403-5404,U+5408-540A,U+540E,U+5420,U+5426-5429,U+542B,U+5435,U+5439,U+543C,U+5446,U+5448,U+544A,U+5475,U+547C,U+548C,U+5490,U+5495,U+54C0,U+54C4,U+54C6,U+54C8,U+54CE,U+54D7,U+54E5,U+54FA,U+54FC,U+5507,U+5509,U+5524,U+552C,U+5531,U+554A,U+5561,U+5589-558A,U+5598,U+559D,U+5609,U+560E,U+5632,U+563F,U+5676,U+568E,U+56DE,U+56E4,U+56F1,U+56FA,U+56FD,U+572D,U+5730,U+573A,U+573E,U+574A,U+574F,U+575A,U+575D,U+575F,U+5782,U+579B,U+57A2,U+57AB,U+57C2-57C3,U+57CE,U+57E0,U+57FA,U+5806,U+5815,U+5821,U+5824,U+5835,U+58A9,U+58C1,U+58D5,U+58F6,U+5904,U+5907,U+590D,U+591A,U+591F,U+5927,U+592B,U+592F,U+5939-593A,U+5949,U+594B,U+5954,U+5956,U+5960,U+5965,U+5978,U+597D,U+5987,U+5992-5993,U+59A8,U+59D1,U+59DC,U+59EC,U+5A25,U+5A5A,U+5AC1,U+5AC9,U+5AE1,U+5B58,U+5B63-5B64,U+5B69,U+5B75,U+5B89,U+5B8F,U+5B98,U+5B9A,U+5B9D,U+5BA0,U+5BA6,U+5BAB,U+5BB3,U+5BB6,U+5BBE,U+5BC2,U+5BC4,U+5BCC,U+5BD2,U+5BDF,U+5BE1,U+5BF8-5BF9,U+5BFC,U+5C01,U+5C06,U+5C14,U+5C16,U+5C18,U+5C1D,U+5C3A,U+5C42,U+5C94,U+5C97,U+5C9B,U+5CB8,U+5CE8,U+5CF0,U+5D07,U+5D14,U+5D29,U+5DDD,U+5DE2,U+5DE5,U+5DE9,U+5DEE,U+5DF1,U+5DF4,U+5E01,U+5E03,U+5E06,U+5E1B,U+5E1D,U+5E26,U+5E2E,U+5E38,U+5E45,U+5E4C,U+5E62,U+5E72,U+5E76,U+5E7B,U+5E7F,U+5E87,U+5E8A,U+5E95,U+5E97,U+5E9A,U+5E9C,U+5E9F,U+5EA6,U+5EFA,U+5F0A,U+5F13,U+5F17-5F18,U+5F1B,U+5F1F,U+5F27,U+5F39,U+5F52-5F53,U+5F69-5F6A,U+5F6C,U+5F7B-5F7C,U+5F85,U+5F88,U+5F8A,U+5F97,U+5FB7,U+5FBD,U+5FC5,U+5FCC,U+5FF1,U+5FFD,U+5FFF-6000,U+6016,U+6020,U+6025,U+602A,U+604D,U+6052,U+6062,U+6068-6069,U+606B,U+606D,U+6076,U+608D,U+6094,U+60A3,U+60B2,U+60B8,U+60BC,U+60D1,U+60E0,U+60E6,U+60E8-60E9,U+60EB,U+60ED-60F0,U+60F6,U+6101,U+611F,U+6124,U+6148,U+614C,U+6167,U+618B,U+61A8,U+61BE,U+61C2,U+61CA,U+6208,U+6210,U+6216,U+6233-6234,U+6237,U+623F,U+6241,U+624D,U+6252-6253,U+626E-626F,U+6273,U+6276,U+627C,U+627F-6280,U+6284,U+628A,U+6296,U+629A,U+62A4-62A5,U+62B1,U+62B5,U+62BD,U+62C2,U+62C5-62C6,U+62CC,U+62D0,U+62D4,U+62DC,U+62E3,U+62E8,U+62F1,U+6301-6302,U+6309,U+6321,U+6324-6325,U+6328,U+632B,U+634C-634D,U+6355,U+6361-6363,U+6376,U+6382,U+6387,U+6389,U+63A3,U+63AA,U+63B8,U+63BA,U+63D2,U+63E3,U+6400-6401,U+640F-6410,U+6413,U+641E,U+642C-642D,U+643D,U+6446,U+6448,U+6467,U+6491,U+64A4,U+64AD-64AE,U+64BC,U+64CD,U+64E6,U+6539,U+653B,U+653E,U+6545,U+654C,U+6556,U+655D-655E,U+6562,U+6566,U+6577,U+658C,U+6591,U+6597,U+65A5,U+65A7,U+65AD,U+65B9,U+65E2,U+65E6,U+65F1,U+6602,U+660C,U+660F,U+6625,U+6643,U+6666,U+6668,U+6697,U+66B4,U+66F4,U+66F9,U+670D,U+671D,U+672C,U+6735,U+673A,U+6746,U+6750-6751,U+675C,U+6760,U+676D,U+676F,U+677F,U+6781,U+6784,U+679C,U+67AB,U+67B6-67B7,U+67C4,U+67CF,U+67D1,U+67DC,U+67E5,U+67EC,U+67F4,U+6807,U+680B,U+6838-6839,U+683C,U+6842,U+6848,U+6853,U+6863,U+6868,U+6886,U+6897,U+68C0,U+68CD,U+68D2,U+68D8,U+68FA,U+6912,U+693D,U+693F,U+695A,U+6982,U+699C,U+69D0,U+69DB,U+69FD,U+6A0A,U+6A2A,U+6A59,U+6A71,U+6B21-6B22,U+6B4C,U+6B64-6B65,U+6B79,U+6B7C,U+6B86,U+6B8B,U+6BB5,U+6BBF,U+6BC1,U+6BD2,U+6BD4-6BD6,U+6BD9,U+6BEB,U+6C1B,U+6C1F,U+6C26,U+6C28,U+6C2E,U+6C47,U+6C49,U+6C57,U+6C5E-6C60,U+6C72,U+6C7E,U+6C89,U+6C9F,U+6CA7,U+6CAA,U+6CB3,U+6CB8,U+6CBD,U+6CCA,U+6CD5,U+6CDB,U+6CE2,U+6CF5,U+6D1E,U+6D2A,U+6D31,U+6D3B,U+6D46-6D47,U+6D4B,U+6D4E,U+6D51,U+6D69,U+6D6E,U+6D77,U+6DA3-6DA4,U+6DA7,U+6DAA,U+6DB5,U+6DB8,U+6DC0,U+6DE1,U+6DEC,U+6DEE,U+6DF3,U+6DF7,U+6E10,U+6E21,U+6E24,U+6E2F,U+6E56,U+6E85,U+6E89,U+6EC1,U+6EC7,U+6ED1,U+6EDA,U+6EE8,U+6EF4,U+6F6E,U+6F84,U+6F88,U+6FB3,U+6FC0,U+6FD2,U+704C,U+706B,U+706F-7070,U+707F,U+708A,U+7092,U+70B3,U+70B9,U+70BD,U+70D8,U+70E6,U+70E9,U+70FD,U+710A,U+7115,U+7119-711A,U+7126,U+714C,U+714E,U+71AC,U+7206,U+7231,U+7236,U+7238-7239,U+7248,U+728A,U+72AF,U+72C4,U+72C8,U+72D0,U+72D7,U+72E0,U+72EC,U+7316,U+731C,U+7334,U+733E,U+73AF,U+73BB,U+73D0,U+73ED,U+745A,U+7470,U+74DC,U+74E3,U+74F7,U+7518,U+752B,U+752D,U+7532,U+7535,U+7538,U+753B,U+7545,U+756A,U+7574,U+7578,U+7586,U+7599,U+75A4,U+75AE-75AF,U+75B5,U+75BE,U+75C5,U+75D5,U+75D8,U+75EA,U+75F4,U+75F9,U+7601,U+7629-762A,U+764C,U+7678,U+767B,U+767D-767E,U+7684,U+7687,U+768B,U+7691,U+76CE,U+76D1-76D2,U+76D6-76D7,U+76EF,U+76FE,U+7763,U+776C,U+7779,U+7785,U+77AA,U+77D7,U+77ED-77EE,U+77FE,U+7840,U+7845,U+7877,U+7889,U+788D,U+7891,U+7898,U+789F,U+78A7,U+78B1,U+78B4,U+78C1,U+78C5,U+78CB,U+78FA,U+7901,U+796D,U+7977-7978,U+798F,U+79BE,U+79C6,U+79C9,U+79E4,U+79EF-79F0,U+79FD,U+7A0B,U+7A17,U+7A20,U+7A3B-7A3D,U+7A3F,U+7A7F,U+7A97,U+7A9C,U+7AEF,U+7AFF,U+7B06,U+7B14,U+7B1B,U+7B26,U+7B28,U+7B2C,U+7B3A,U+7B49,U+7B4F,U+7B54,U+7B56,U+7B79,U+7B80,U+7B8D,U+7B94-7B95,U+7BA1,U+7BAD,U+7BD9,U+7BE1,U+7C07,U+7C27,U+7C3F,U+7C4D,U+7C89,U+7C97,U+7CAA,U+7CB9,U+7CCA,U+7CD5,U+7CD9,U+7E41,U+7EA2,U+7EA7,U+7EAA,U+7EAF,U+7EB2,U+7EB7,U+7EBA,U+7ECA,U+7ED1,U+7ED8-7ED9,U+7EE7,U+7EE9,U+7EF0,U+7EF7-7EF8,U+7F04,U+7F09,U+7F0E,U+7F13-7F14,U+7F16,U+7F1A,U+7F1D,U+7F20,U+7F38,U+7F50,U+7F55,U+7F5A,U+7F62,U+7F94,U+7FB9,U+7FC5,U+7FDF-7FE0,U+7FF0-7FF1,U+7FFB,U+800C,U+8015,U+8017,U+8019,U+8033,U+803B,U+803D,U+803F,U+806A,U+808C,U+809A-809B,U+809D,U+80A0-80A1,U+80A4-80A5,U+80A9-80AA,U+80AE,U+80BA,U+80C6,U+80CC,U+80DE,U+80E1,U+80F3,U+80F6,U+80FA,U+8106,U+810A,U+8116,U+812F,U+8150-8151,U+8179,U+8180,U+818A,U+818F,U+8198,U+81C2,U+81E3,U+81ED,U+822A,U+822C,U+8230-8231,U+8235-8236,U+8239,U+8270,U+827E,U+82AC-82AD,U+82B1,U+82B3,U+82CD,U+82DE-82DF,U+82EF,U+8303,U+8327-8328,U+832C,U+8336,U+8349,U+8350,U+8352,U+835A,U+8361,U+8364,U+8377,U+83B7,U+83C7,U+83CF,U+83DC,U+83E0,U+83F2,U+845B,U+8463,U+846B,U+8471,U+8482,U+848B,U+84D6,U+84DF,U+8521,U+853C-853D,U+8549,U+8584,U+85CF,U+85E9,U+864E,U+866B,U+8679,U+868C,U+8695,U+86CA-86CB,U+86D4,U+86E4,U+86FE,U+8702,U+8749,U+8757,U+8774,U+8776,U+8822,U+8861,U+8865,U+8868,U+886C,U+8884,U+888B,U+88AB,U+88B1,U+88C1,U+88F9,U+8902,U+8910,U+8912,U+8986,U+89C1-89C2,U+89C4,U+89E6,U+8BA1-8BA3,U+8BA5,U+8BB0,U+8BB2-8BB3,U+8BB9,U+8BBD,U+8BBF,U+8BCD,U+8BDA,U+8BDD-8BDE,U+8BE1,U+8BE5,U+8BE7,U+8BF2,U+8BFB,U+8BFD,U+8C03,U+8C0D-8C0E,U+8C17,U+8C24,U+8C37,U+8C41,U+8C46,U+8C62,U+8C6A,U+8C79-8C7A,U+8C89,U+8D1D,U+8D1F,U+8D21-8D22,U+8D25,U+8D27,U+8D29,U+8D2C-8D2D,U+8D2F-8D31,U+8D35,U+8D37,U+8D39-8D3A,U+8D3E-8D3F,U+8D4B-8D4C,U+8D50,U+8D63-8D64,U+8D6B,U+8D74,U+8D76,U+8D81,U+8D85,U+8DCB-8DCC,U+8DDF,U+8DEA,U+8DF5,U+8DFA,U+8E0C,U+8E29,U+8E48,U+8E66,U+8E6C-8E6D,U+8E72,U+8E7F,U+8E87,U+8EAC,U+8EB2,U+8F66,U+8F68,U+8F70,U+8F85,U+8F88-8F8A,U+8F90-8F91,U+8F9C,U+8F9E-8F9F,U+8FA8-8FA9,U+8FAB,U+8FB0,U+8FB9,U+8FBE,U+8FC7,U+8FD4,U+8FD8,U+8FDF,U+8FEA,U+8FED,U+8FF8-8FF9,U+9012,U+9017,U+901B,U+901E,U+9022,U+902E,U+903C,U+9041,U+904D,U+904F,U+9053,U+907F,U+9093,U+90A6,U+90AF,U+90CA,U+90DD,U+90E8,U+90ED,U+90F4,U+90F8,U+90FD,U+9102,U+9119,U+915A,U+9163,U+916C,U+9171,U+9187,U+918B,U+91C7,U+91DC,U+9274,U+9489,U+9492-9493,U+9499,U+949D-949E,U+94A1-94A2,U+94A9,U+94B5,U+94BE,U+94C2,U+94EC,U+94F2,U+9504-9505,U+950B,U+9519,U+9524,U+952D-952E,U+953B,U+9540,U+9550-9551,U+957F,U+95ED,U+95EF,U+95F4,U+95FA,U+9600-9602,U+9610,U+961C,U+961F,U+9632,U+963F,U+9644-9645,U+9648,U+964D,U+965B,U+9661,U+9664,U+9694,U+9698,U+96C6-96C7,U+96CC,U+96CF,U+96D5,U+96F9,U+970D,U+9738,U+975B,U+975E,U+9769,U+9776,U+978D,U+97AD,U+97E9,U+9876,U+987E-987F,U+9881,U+988A,U+989D,U+98A0,U+98A4,U+98CE,U+98DE,U+9910,U+9965,U+996D,U+996F,U+9971,U+9975,U+997C,U+997F,U+9986,U+998B,U+9A70,U+9A73,U+9A7E,U+9A84,U+9A87,U+9A8B,U+9AA8,U+9AB8,U+9AD8,U+9B3C,U+9B42,U+9C8D,U+9CD6,U+9E21,U+9E3D,U+9E3F,U+9E45,U+9E64,U+9EC4,U+9ED1,U+9F0E,U+9F13,U+9F3B,U+9F7F,U+9F9A,U+9F9F"
	}),
	Object.freeze({
		family: "Aha Hand",
		file: "wenkai-gb-2-2a649892.woff2",
		bytes: 317648,
		unicodeRange: "U+4E03,U+4E09-4E0A,U+4E14,U+4E16,U+4E18,U+4E24,U+4E27,U+4E34,U+4E3D-4E3E,U+4E43,U+4E45,U+4E48,U+4E50,U+4E52-4E54,U+4E5D-4E5E,U+4E70-4E71,U+4E73,U+4E7E,U+4E86,U+4E8B,U+4E8F,U+4E95,U+4EA2,U+4EA9,U+4EAC,U+4EAE,U+4EB2,U+4EBA,U+4EC0-4EC1,U+4EC5-4EC6,U+4ECA-4ECB,U+4ECD,U+4ED1,U+4ED5,U+4EDF,U+4EE4,U+4EEC,U+4EFB,U+4F01,U+4F1E,U+4F24,U+4F26,U+4F36,U+4F38,U+4F60,U+4F69,U+4F6C,U+4F7F,U+4F8B,U+4F8D,U+4FA3,U+4FA5,U+4FA8-4FA9,U+4FB5,U+4FCA,U+4FCF-4FD0,U+4FE9,U+4FF1,U+5014,U+501F,U+5026,U+502A,U+503E,U+504F,U+5076,U+5080,U+5088,U+50BB,U+50DA,U+50E7,U+50FB,U+5112,U+5121,U+514B,U+514D,U+5162,U+5165,U+5168,U+516D,U+5170,U+5176-5177,U+5185,U+5189,U+5192,U+5195,U+5197,U+519B-519C,U+51B3,U+51B5,U+51B7,U+51C0,U+51C4,U+51C9,U+51CC,U+51DB,U+51DD,U+51ED,U+51EF,U+5203,U+5207,U+520A,U+5217-5218,U+5220,U+5224,U+5228-5229,U+5238-5239,U+523B,U+524D,U+5256,U+5267,U+5269,U+527F,U+5288,U+529B,U+529D,U+52A3,U+52AA-52AB,U+52B1-52B3,U+52BF,U+52C9,U+52D2,U+52D8,U+52DF,U+52E4,U+52FA,U+5321,U+5339-533A,U+533F,U+5341,U+5343,U+5347,U+5356-5357,U+5361-5362,U+5364,U+536F,U+5374-5375,U+5377,U+537F,U+5386,U+5389,U+5398,U+53A9,U+53BB,U+53C1,U+53D6-53D7,U+53DB,U+53E3,U+53E5-53E6,U+53EB,U+53EF,U+53F2,U+540D,U+540F,U+5415,U+5417,U+541B,U+541D,U+542D,U+542F,U+5450,U+5455,U+545B,U+5462,U+5478,U+547B,U+547D,U+5480,U+5486,U+548E,U+5496,U+5499,U+54AF,U+54B3,U+54C1,U+54E6,U+54E8-54EA,U+54ED,U+552E,U+5543,U+5546,U+5564-5566,U+556A,U+556E,U+5580,U+5584,U+5587,U+55B7,U+55D3,U+55DC,U+561B,U+5668,U+566C,U+56B7,U+56BC,U+56CA,U+56DA,U+56F0,U+5703,U+5708,U+5723,U+5747,U+574E,U+5751,U+5757,U+5761,U+5764,U+576A,U+576F,U+5777,U+5783-5784,U+5792,U+57A6,U+57AE,U+57CB,U+57D4,U+57F9,U+5811,U+582A,U+585E,U+5883,U+5892-5893,U+5899,U+58A8,U+58E4,U+58EB-58EC,U+58F0,U+58F3,U+5931,U+5938,U+5947-5948,U+594E,U+5951,U+5962,U+5973-5974,U+5976,U+5982,U+5988,U+598A,U+5999,U+59AE,U+59B9,U+59BB,U+59C6,U+59CB,U+59D0,U+59E5,U+5A04,U+5A07,U+5A18,U+5A1C,U+5A1F-5A20,U+5A29,U+5A36,U+5A46,U+5A6A,U+5A76,U+5A92,U+5A9A,U+5AC2,U+5AE9,U+5B54,U+5B5F,U+5B6A,U+5B7A,U+5B7D,U+5B81,U+5B88,U+5B9E,U+5BA1-5BA2,U+5BA4,U+5BB9,U+5BBD,U+5BC6-5BC7,U+5BD0,U+5BDD-5BDE,U+5BE5,U+5BFF,U+5C04,U+5C11,U+5C1A,U+5C31,U+5C38,U+5C3C-5C3D,U+5C3F-5C41,U+5C45,U+5C48,U+5C4A,U+5C4E-5C4F,U+5C61,U+5C65,U+5C71,U+5C82,U+5CAD,U+5CBF,U+5CE6,U+5CED,U+5CFB,U+5D0E,U+5D4C,U+5DE7-5DE8,U+5DFE,U+5E02,U+5E08,U+5E15,U+5E18,U+5E3D,U+5E42,U+5E55,U+5E73-5E74,U+5E86,U+5E90,U+5E93,U+5E99,U+5E9E,U+5EB7,U+5EC9-5ECA,U+5ED3,U+5ED6,U+5F00,U+5F03-5F04,U+5F0F,U+5F25,U+5F31,U+5F3A,U+5F55,U+5F6D,U+5F84,U+5F8B,U+5F98,U+5FCD,U+5FD9,U+5FEB,U+5FF5,U+6012,U+6015,U+601C,U+602F,U+6043,U+604B,U+6050,U+6070,U+6073,U+607C,U+6084,U+60A8,U+60AF,U+60C5,U+60CA,U+60E7,U+60F9,U+6127,U+614E,U+6151,U+6155,U+6162,U+6168,U+6177,U+61D2,U+61E6,U+620E,U+6212,U+621A,U+622A,U+622E,U+6247,U+624B,U+6251,U+6254,U+625B,U+6263,U+6266,U+6269,U+626B,U+626D,U+6270,U+6279,U+6289,U+6297,U+629B,U+62A0-62A2,U+62A8,U+62AB,U+62B9,U+62BF,U+62C7-62C9,U+62CD-62CE,U+62D2,U+62D8,U+62DF,U+62E2,U+62E6-62E7,U+62EC-62ED,U+62F3,U+62F7,U+62FC,U+62FE-62FF,U+630E,U+631B,U+6320,U+632A,U+6346,U+634E-6350,U+635E,U+6367,U+636E,U+6377,U+637B,U+6388,U+6390,U+6392,U+6398,U+63A0,U+63A5,U+63A7,U+63B3,U+63C9,U+63CF,U+63E9-63EA,U+63ED,U+63FD,U+6402,U+6405,U+6414,U+6444,U+6469,U+6478-6479,U+6482,U+6485,U+6487,U+6492,U+64A9,U+64AC,U+64B5,U+64C2,U+64C5,U+64CE,U+64D2,U+6500,U+6518,U+652B,U+6536,U+654F,U+6551,U+6559,U+655B,U+6563,U+656C,U+6572,U+6599,U+65A4,U+65BD,U+65C1,U+65C5,U+65D7,U+65E5,U+65E7,U+65F6-65F7,U+6606,U+660E,U+6627,U+662F,U+664B-664C,U+6652,U+666E-666F,U+6674,U+6676,U+667E,U+6696,U+66AE,U+66DD,U+66F2,U+66FC,U+670B,U+6717,U+671F,U+6728,U+672B,U+6734,U+6740,U+6743,U+6749,U+674E,U+6765,U+6770,U+6797,U+679A,U+67AA,U+67AF,U+67D0,U+67D2-67D4,U+67E0,U+67EF,U+67F3,U+67FF,U+680F,U+6816-6817,U+6846,U+6851,U+6854,U+6865,U+6881,U+6885,U+68A2,U+68A6,U+68A8,U+68C9,U+68CB,U+68DA,U+68EE,U+68F1,U+68F5,U+695E,U+6977,U+697C,U+6994,U+69B4,U+69B7,U+6A21,U+6A47,U+6AAC,U+6B20,U+6B27,U+6B3A,U+6B3E,U+6B49,U+6B67,U+6BB4,U+6BCD,U+6BCF,U+6BD7,U+6BDB,U+6C0F,U+6C11,U+6C13-6C14,U+6C16,U+6C22,U+6C2F-6C30,U+6C42,U+6C55,U+6C5D,U+6C7D,U+6C81,U+6C88,U+6C8F,U+6C99,U+6C9B,U+6CA1,U+6CA4-6CA6,U+6CAB,U+6CAE,U+6CC5,U+6CC9,U+6CCC,U+6CDE,U+6CE1,U+6CE3,U+6CE5,U+6CEA,U+6CFC,U+6D01,U+6D12,U+6D1B,U+6D25,U+6D3D-6D3E,U+6D41,U+6D45,U+6D53,U+6D5A,U+6D66,U+6D6A,U+6D78,U+6D85,U+6D89,U+6D9D,U+6D9F,U+6DA6,U+6DA9,U+6DCB,U+6DD6,U+6DF1,U+6E05,U+6E17,U+6E20,U+6E34,U+6E3A,U+6E43,U+6E7F,U+6E83,U+6E9C,U+6EB6,U+6EBA,U+6EE1,U+6EE4-6EE6,U+6F02,U+6F06,U+6F0F,U+6F13,U+6F20,U+6F2B,U+6F58,U+6F5C,U+6F5E,U+6F66,U+6F8E,U+6F9C,U+7011,U+706D,U+7075,U+7078,U+7089,U+7094-7095,U+70AC,U+70AE-70AF,U+70BC,U+70C2,U+70C8,U+70D9,U+70E4,U+70E7,U+70EC-70ED,U+70F9,U+7136,U+715E,U+7164,U+717D,U+7194,U+71C3,U+71CE,U+722C,U+7235,U+7247,U+724C,U+725B,U+725F,U+7261-7262,U+7267,U+7272,U+7275,U+7281,U+72AC,U+72C2,U+72D9,U+72DE,U+72E1,U+72EE,U+72F8,U+72FC,U+730E,U+731B,U+732B,U+7387,U+7396,U+739B,U+73AB,U+73B2,U+73CA,U+7403,U+7405-7406,U+7409,U+7433-7436,U+743C,U+745E-745F,U+7483,U+74E2,U+74E4,U+74F6,U+751A,U+751F,U+7525,U+7533,U+7537,U+754C,U+7554,U+7559,U+7565-7566,U+7597,U+759A,U+759F,U+75A5,U+75B2,U+75BD,U+75C9-75CA,U+75DE,U+75E2,U+7624,U+7638,U+7686,U+76AE,U+76BF,U+76C6,U+76D4,U+76D8,U+76DB,U+76DF,U+76EE,U+76F2,U+76FC,U+7701,U+7709,U+770B,U+7720,U+772F,U+7736-7737,U+775B,U+7766,U+776B,U+7784,U+7792,U+77A5,U+77A7,U+77DB,U+77E2,U+77E9,U+77EB,U+77F3,U+77FF,U+7801-7802,U+780C-780D,U+7812,U+7830,U+7834,U+7837,U+783E,U+786B,U+786E,U+787C,U+788C,U+78B0,U+78BE,U+78CA,U+78D0,U+78D5,U+78E8,U+78F7,U+793A,U+793C,U+793E,U+7941,U+7948,U+795E,U+7968,U+7981,U+7984,U+79BB,U+79BD,U+79CB,U+79D1-79D2,U+79D8,U+79E6,U+79F8,U+7A0D,U+7A46,U+7A76-7A77,U+7A7A,U+7A83,U+7A8D,U+7A96,U+7A98,U+7A9F,U+7AA5,U+7ABF,U+7ACB,U+7ADE-7ADF,U+7AE3,U+7AED,U+7B3C,U+7B4B,U+7B50,U+7B5B,U+7B77,U+7B7E,U+7BA9,U+7BC7,U+7BD3,U+7BEE,U+7BF1,U+7BF7,U+7C73,U+7C7B,U+7C92,U+7C95,U+7CAE,U+7CB1,U+7CB3,U+7CBE,U+7CDC,U+7CE0,U+7CEF,U+7D27,U+7D2F,U+7EA0,U+7EAB,U+7EB1,U+7EB3,U+7EB6,U+7EBD,U+7EC3,U+7EC5,U+7ECD,U+7ECF,U+7ED2-7ED3,U+7ED5,U+7EDC-7EDE,U+7EE2,U+7EF3,U+7EF5,U+7EFF,U+7F05-7F06,U+7F15,U+7F2E,U+7F34,U+7F3A,U+7F57,U+7F8C,U+7F8E,U+7F9A,U+7FA4,U+7FD8,U+8001,U+8003,U+8010,U+802A,U+8042,U+804A-804B,U+8054,U+8058,U+805A,U+8089,U+808B,U+80AF,U+80BE,U+80D6,U+80DA,U+80DC,U+80EF,U+80FD,U+8109,U+8110-8111,U+8113,U+811A,U+8138,U+813E,U+814A,U+8154,U+816E,U+817B,U+819C,U+81A8,U+81B3,U+81FC,U+8205,U+820C-820D,U+826F,U+8272,U+8282,U+828D,U+8292,U+82A5-82A6,U+82B9,U+82D7,U+82DB,U+82E5-82E6,U+82EB,U+82F9,U+8302,U+8304-8305,U+830E,U+832B,U+8338-8339,U+8346,U+8354,U+8363,U+8386,U+8389,U+838E,U+83AB,U+83B1-83B2,U+83BD,U+83CA,U+83CC,U+83E9,U+83F1,U+840C-840D,U+841D,U+8428,U+843D,U+8461,U+8475,U+8499,U+84B2,U+84C9,U+84DD,U+84EC,U+8511,U+8513,U+852B,U+8537,U+854A,U+857E,U+85C9,U+85D0,U+85D5,U+8611,U+864F-8651,U+8671,U+8680,U+8682,U+86C6-86C7,U+86EE,U+871C,U+8721,U+878D,U+879F,U+87BA,U+8815,U+8857,U+886B,U+888D,U+88C2,U+88D9,U+88E4,U+88F3-88F4,U+88F8,U+8925,U+895F,U+89C5-89C6,U+89C8-89C9,U+89D2,U+89E3,U+8A93,U+8B66,U+8B6C,U+8BA4,U+8BA9,U+8BAB,U+8BBA,U+8BBE,U+8BC0,U+8BC4,U+8BC6,U+8BD5,U+8BD7,U+8BEB,U+8BF7,U+8BFA,U+8BFE,U+8C05,U+8C0B,U+8C1C,U+8C26,U+8C28-8C29,U+8C2C,U+8C30-8C31,U+8C34,U+8C8C,U+8D2B,U+8D38,U+8D41-8D42,U+8D4A,U+8D4F,U+8D54,U+8D56,U+8D5B,U+8D61,U+8D66,U+8D77,U+8D8B,U+8DA3,U+8DB4,U+8DD1,U+8DDD,U+8DE8,U+8DEF,U+8E1E,U+8EAB,U+8EAF,U+8F6E-8F6F,U+8F7B,U+8F7F,U+8F83,U+8F86,U+8FA3,U+8FB1,U+8FBD,U+8FC1,U+8FC4,U+8FC8,U+8FD1,U+8FDB,U+8FDE,U+8FEB,U+8FF7,U+9002,U+9006,U+901D,U+903B,U+9063,U+90A3,U+90B1,U+90B5,U+90BB,U+90CE,U+90E1,U+914B,U+914D,U+9152,U+916A,U+9175-9177,U+917F,U+919A-919B,U+91CA,U+91CC,U+91CF,U+91D1,U+948E,U+94A0,U+94A6-94A7,U+94AE,U+94B1,U+94B3,U+94C3,U+94C5-94C6,U+94DD,U+94ED,U+94F0,U+94FA,U+94FE,U+9510,U+951A,U+9523,U+9526,U+952F-9530,U+9539,U+9541,U+954A,U+954D,U+955C,U+9563,U+956D,U+9570,U+95E8,U+95EA,U+95F0,U+95F7,U+95F9,U+95FD,U+9611,U+9614,U+962E,U+9636,U+9646-9647,U+964B-964C,U+9655,U+966A,U+9675,U+9686,U+96B6,U+96BE,U+96C0,U+96F6-96F7,U+9709,U+9713,U+9716,U+9732,U+9739,U+9752,U+9756,U+9759,U+9760-9762,U+9773,U+9798,U+97A0,U+97E7,U+97ED,U+97F6,U+9877,U+9885-9888,U+9891,U+9897,U+98A7,U+98D8,U+98DF,U+9970,U+9976,U+997A,U+9981,U+9988,U+998F,U+9992,U+9996,U+9A6C,U+9A71,U+9A74,U+9A76,U+9A79,U+9A82,U+9A86,U+9A8F,U+9A91,U+9A97,U+9A9A,U+9AA1,U+9B41,U+9B44,U+9B54,U+9C81,U+9CA4,U+9CB8,U+9CC3,U+9CDE,U+9E1F,U+9E23,U+9E25,U+9E43,U+9E4A,U+9E4F,U+9E7F,U+9E93,U+9EA6,U+9EBB,U+9ECE,U+9ED4,U+9ED8,U+9F50,U+9F84,U+9F8B,U+9F99"
	}),
	Object.freeze({
		family: "Aha Hand",
		file: "wenkai-gb-3-6949c050.woff2",
		bytes: 311704,
		unicodeRange: "U+4E00,U+4E07-4E08,U+4E0B,U+4E0E,U+4E13,U+4E1A,U+4E1D,U+4E25,U+4E2B,U+4E2D,U+4E38,U+4E3A-4E3B,U+4E49,U+4E4B-4E4D,U+4E59,U+4E5F-4E61,U+4E66,U+4E88-4E89,U+4E8E,U+4E91,U+4E94,U+4E9A-4E9B,U+4EA1,U+4EA6,U+4EAB,U+4EAD,U+4EBF,U+4ED4,U+4ED6-4ED7,U+4ED9,U+4EE5,U+4EEA,U+4EF0,U+4EF2,U+4F0A,U+4F0D,U+4F11,U+4F17-4F18,U+4F1F,U+4F2A,U+4F3A,U+4F3C,U+4F4D,U+4F4F-4F51,U+4F53,U+4F59,U+4F5C,U+4F63,U+4F6F,U+4F84,U+4F9D,U+4FA0,U+4FA6,U+4FAE,U+4FD7,U+4FDE,U+4FE1,U+4FEE,U+5018,U+501A,U+503A,U+503C,U+505A,U+505C,U+5077,U+50CF,U+50F3,U+5141,U+5143-5144,U+5146,U+5148,U+5154,U+5174,U+5179,U+517B,U+517D,U+518D,U+5199,U+51A4,U+51B6,U+51C6,U+51F6,U+51F8,U+51FF,U+5211,U+5219,U+5236-5237,U+5243,U+524A,U+5254,U+52A1,U+52A9,U+52C7,U+52CB,U+52FF-5300,U+5308,U+531D,U+5323,U+533B,U+5348,U+534F,U+5352-5353,U+5360,U+5367,U+536B,U+5370-5371,U+5378,U+5385,U+538B-538C,U+539F,U+53A2,U+53A6,U+53BF,U+53C8,U+53CB-53CC,U+53D4,U+53D9,U+53EA,U+53EC,U+53F0,U+53F3,U+53F6,U+53F8-53F9,U+5401,U+540C,U+5410-5411,U+5413,U+541E-541F,U+542C,U+542E,U+5431,U+5434,U+5438,U+543B,U+543E,U+5440,U+5458,U+545C,U+5468,U+5473,U+548B,U+548F,U+5492,U+54A8,U+54AC,U+54B1,U+54B8,U+54BD,U+54C7,U+54C9,U+54CD,U+54D1,U+54DF,U+54EE,U+54F2,U+5501,U+5506,U+5510,U+552F,U+553E,U+5544,U+5578,U+557C,U+5582,U+559C,U+55A7,U+55B3,U+55BB,U+55C5,U+55E1,U+55E3,U+55FD,U+5618,U+5631,U+5634,U+5636,U+563B,U+564E,U+566A,U+568F,U+56A3,U+56DB,U+56E0,U+56E2,U+56ED,U+56F4,U+56FE,U+5706,U+571F,U+5728,U+5740,U+574D,U+5750,U+575B,U+575E,U+5760,U+5766,U+578B,U+57A3,U+57DF,U+5802,U+5830,U+584C,U+5851,U+5854,U+5858,U+586B,U+5885,U+589E-589F,U+58EE,U+58F9,U+590F,U+5915-5916,U+591C,U+5929-592A,U+592E,U+5934,U+5937,U+5944,U+594F,U+5957,U+5979,U+5984,U+5986,U+5996,U+59A5,U+59D3-59D4,U+59DA,U+59E8,U+59FB,U+59FF,U+5A01,U+5A03,U+5A31,U+5A49,U+5A74,U+5A7F,U+5AB3,U+5ACC,U+5B50,U+5B55,U+5B57,U+5B59,U+5B5C-5B5D,U+5B66,U+5B70,U+5B83,U+5B85,U+5B87,U+5B8B-5B8C,U+5B97,U+5B99,U+5B9B-5B9C,U+5BA3,U+5BAA,U+5BB0,U+5BB4-5BB5,U+5BBF,U+5BC5,U+5BD3,U+5BE8,U+5BFA-5BFB,U+5C09-5C0A,U+5C0F,U+5C24,U+5C27,U+5C39,U+5C3E,U+5C49,U+5C4B,U+5C51,U+5C55,U+5C5E,U+5C60,U+5C6F,U+5C79,U+5C7F,U+5C81,U+5CA9,U+5CB3,U+5CD9,U+5CE1,U+5CEA,U+5D16,U+5D2D,U+5DCD,U+5DDE,U+5DE1,U+5DE6,U+5DEB,U+5DF2-5DF3,U+5DF7,U+5E05,U+5E0C,U+5E10,U+5E16,U+5E1A,U+5E1C,U+5E27,U+5E2D,U+5E78,U+5E7C-5E7D,U+5E84,U+5E8F,U+5E94,U+5EA7,U+5EAD,U+5EB6,U+5EB8,U+5EF6-5EF7,U+5F02,U+5F15,U+5F20,U+5F26,U+5F2F,U+5F5D,U+5F62,U+5F64,U+5F66,U+5F70-5F71,U+5F79,U+5F80-5F81,U+5F90,U+5F92,U+5FA1,U+5FAA,U+5FAE,U+5FC3,U+5FC6,U+5FD7-5FD8,U+5FE0,U+5FE7,U+5FFB,U+6001-6002,U+600E,U+6014,U+601D,U+6027-6028,U+603B,U+6055,U+6064,U+606C,U+606F,U+607F,U+6089,U+609F-60A0,U+60A6,U+60AC,U+60CB,U+60D5,U+60DC,U+60DF,U+60F3,U+60FA,U+6108-6109,U+610F,U+611A,U+613F,U+6170,U+618E,U+61C8,U+620A,U+620C-620D,U+620F,U+6211,U+6218,U+6240,U+624E,U+6258,U+6267,U+626C,U+627E,U+6291-6293,U+6295,U+6298,U+62AC,U+62BC,U+62C4,U+62D3,U+62D6,U+62D9,U+62DB,U+62E5,U+62E9,U+62EF,U+62F4,U+62FD,U+6307,U+6311,U+6316,U+631A,U+631D-631F,U+6323,U+632F,U+633A,U+633D,U+6342,U+6345,U+6349,U+635F,U+6380,U+638C,U+638F,U+6396,U+63A2,U+63A8-63A9,U+63B7,U+63CD,U+63D0,U+63D6,U+63E1,U+63F4,U+641C,U+642A,U+643A,U+6447,U+644A,U+6454,U+6458,U+6495,U+649E,U+64B0,U+64DE,U+6512,U+652F,U+653F,U+6548,U+6570,U+6574,U+6587,U+658B,U+659C,U+659F,U+65A1,U+65A9,U+65AF-65B0,U+65CB,U+65CF,U+65E0,U+65E8-65E9,U+65EC-65ED,U+65FA,U+6613-6614,U+661F-6620,U+6628,U+662D,U+663C,U+663E,U+6653,U+6655,U+665A,U+6664,U+6670,U+667A,U+6682,U+6687,U+6691,U+66D9,U+66F0,U+66F3,U+66FE-6700,U+6708-6709,U+6714,U+671B,U+672A,U+672D,U+672F,U+6731,U+673D,U+6742,U+674F,U+6756,U+675F,U+6761,U+6768,U+677E,U+6789,U+6790,U+6795,U+679D,U+67A2-67A3,U+67DE,U+67F1,U+6805,U+6808,U+6811,U+6813,U+6821,U+682A,U+6837,U+683D,U+6843,U+6845,U+684C,U+6850,U+6869,U+6876,U+68A7,U+68AD,U+68AF-68B0,U+68B3,U+68D5,U+68E0,U+6905,U+690D-690E,U+692D,U+6930,U+6954,U+6986,U+69A8,U+6A1F,U+6A31,U+6A61,U+6A80,U+6A84,U+6B23,U+6B32,U+6B47,U+6B62-6B63,U+6B66,U+6B6A,U+6B7B,U+6B83,U+6B89-6B8A,U+6B96,U+6BB7,U+6BC5,U+6BCB,U+6BE1,U+6BEF,U+6C27,U+6C34,U+6C38,U+6C40-6C41,U+6C50,U+6C5B,U+6C61,U+6C64,U+6C6A,U+6C70,U+6C79,U+6C82-6C83,U+6CB9,U+6CBB-6CBC,U+6CBE-6CBF,U+6CC4,U+6CE8,U+6CF0,U+6CF3,U+6CFB,U+6CFD,U+6D0B,U+6D17,U+6D32,U+6D3C,U+6D4A,U+6D59,U+6D74,U+6D82,U+6D88,U+6D8C,U+6D8E,U+6D95,U+6D9B,U+6DA1,U+6DA8,U+6DAF,U+6DB2,U+6DC4,U+6DC6,U+6DCC,U+6DD1,U+6DD8,U+6DE4,U+6DEB,U+6DF9,U+6DFB,U+6E0A,U+6E0D,U+6E14,U+6E1D,U+6E23,U+6E29,U+6E2D,U+6E38,U+6E4D,U+6E58,U+6E5B,U+6E7E,U+6E90,U+6EA2,U+6EAA,U+6EAF,U+6ECB,U+6ED3-6ED4,U+6EDE,U+6EE9,U+6F14,U+6F31,U+6F33,U+6F3E,U+6F4D,U+6F6D,U+6FA1,U+7076,U+707C,U+707E,U+708E,U+7099,U+70AD,U+70B8,U+70C1,U+70C3,U+70DB,U+70DF,U+70EB,U+70EF,U+70F7,U+7109,U+7130,U+7167,U+716E,U+7184,U+718A,U+718F,U+7199,U+719F,U+71D5,U+71E5,U+722A,U+7237,U+723D,U+7259,U+7269,U+7279-727A,U+7280,U+72B6,U+72B9,U+72ED,U+72F0-72F1,U+7329-732A,U+732E,U+733F,U+736D,U+7384,U+7389,U+738B,U+73A9,U+73B0,U+73CD,U+73E0,U+7410,U+7422,U+7476,U+74E6,U+74EE,U+7504,U+751C,U+7528-7529,U+7530-7531,U+754F,U+755C,U+758F,U+7591,U+75A1,U+75AB,U+75B9,U+75BC,U+75C7-75C8,U+75D2,U+75D4,U+75DB,U+75F0,U+761F,U+7626,U+762B,U+7634,U+7663,U+7682,U+7696,U+76B1,U+76C2,U+76C5,U+76C8,U+76CA,U+76CF-76D0,U+76F4,U+76F8,U+771F,U+7728-7729,U+773A,U+773C,U+7740-7741,U+7761,U+778E,U+77A9,U+77AC,U+77B3,U+77BB,U+77E3,U+77E5,U+77FD,U+7814,U+7816,U+781A,U+7827,U+7838,U+7852,U+7855,U+785D,U+786C,U+788E,U+7897,U+78B3,U+7956,U+795D,U+795F,U+7965,U+79B9,U+79C0-79C1,U+79C3,U+79CD,U+79DF,U+79E7,U+79E9,U+79FB,U+7A00,U+7A0E,U+7A1A,U+7A33,U+7A57,U+7A74,U+7A81,U+7A84,U+7A91-7A92,U+7A9D,U+7AD6,U+7AD9,U+7AE0,U+7AE5,U+7AF9,U+7B0B,U+7B11,U+7B51-7B52,U+7B97,U+7BB1,U+7BC6,U+7C7D,U+7C98,U+7C9F,U+7CA4-7CA5,U+7CD6,U+7CDF,U+7CFB,U+7D0A,U+7D20,U+7D22,U+7D2B,U+7D6E,U+7E82,U+7EA4,U+7EA6,U+7EAC,U+7EB5,U+7EB8-7EB9,U+7EBF,U+7EC4,U+7EC6-7EC8,U+7ECE,U+7EDA,U+7EDF,U+7EE3,U+7EE5-7EE6,U+7EEA,U+7EED,U+7EF4,U+7EFC-7EFD,U+7F00,U+7F18,U+7F28-7F29,U+7F51,U+7F69-7F6A,U+7F6E,U+7F72,U+7F8A,U+7F9E,U+7FA1,U+7FBD,U+7FC1,U+7FCC,U+7FD4,U+7FFC,U+8000,U+8005,U+800D,U+8018,U+8036,U+8038,U+804C,U+8083-8084,U+8086-8087,U+8096,U+8098,U+80A2,U+80B2,U+80BF-80C1,U+80C3,U+80CE,U+80F0,U+80F8,U+8102,U+810F,U+8131,U+8146,U+814B,U+8155,U+8165,U+8170,U+817A,U+817E-817F,U+819B,U+819D,U+81C0,U+81C3,U+81C6,U+81EA,U+81F3-81F4,U+81FB,U+8200,U+8206,U+8212,U+8214,U+821C,U+821E-821F,U+8237,U+8247,U+8258,U+8273,U+827A,U+828B,U+829C-829D,U+82AF,U+82BD,U+82C7,U+82CF,U+82D1,U+82D4,U+82F1,U+8301,U+8335,U+8367,U+836B,U+836F,U+83B9,U+8404,U+840E,U+8424-8425,U+8427,U+8457,U+846C,U+849C,U+84B8,U+84C4,U+84D1,U+8517,U+851A,U+852C,U+8574,U+859B,U+85AA,U+85AF,U+85E4,U+85FB,U+8638,U+865A,U+865E,U+867D-867E,U+8681,U+868A,U+869C,U+86A4,U+86C0,U+86D9,U+86DB,U+86F0,U+86F9,U+8700,U+8712,U+8715,U+8717-8718,U+8747,U+874E,U+87F9,U+8840,U+8845,U+884C-884D,U+8854,U+8859,U+8863,U+8870,U+8877,U+8881,U+8892,U+8896,U+889C,U+88AD,U+88C5,U+88D4-88D5,U+892A,U+8944,U+897F,U+8981,U+8A00,U+8A79,U+8A89-8A8A,U+8BA8,U+8BAD-8BAF,U+8BB6,U+8BB8,U+8BBC,U+8BC1,U+8BC5,U+8BC8-8BCA,U+8BCC,U+8BD1,U+8BDB,U+8BE2-8BE3,U+8BE6,U+8BEC-8BED,U+8BEF,U+8BF1,U+8BF4-8BF5,U+8BF8,U+8C01,U+8C06,U+8C08,U+8C0A,U+8C10,U+8C13,U+8C1A,U+8C22-8C23,U+8C2D,U+8C4C,U+8C61,U+8C6B,U+8D1E,U+8D23-8D24,U+8D26,U+8D28,U+8D2A,U+8D2E,U+8D34,U+8D3C,U+8D43-8D44,U+8D4E,U+8D58,U+8D5A,U+8D5E,U+8D60,U+8D62,U+8D70,U+8D75,U+8D8A,U+8D9F,U+8DB3,U+8DBE,U+8DC3,U+8DF3,U+8E0A,U+8E0F,U+8E22,U+8E2A,U+8E44,U+8E4B,U+8E81,U+8EBA,U+8F67,U+8F69,U+8F6C,U+8F74,U+8F7D,U+8F93,U+8F95-8F97,U+8F99,U+8F9B,U+8FC2,U+8FC5,U+8FCE,U+8FD0,U+8FD9,U+8FDC-8FDD,U+8FE2,U+8FF0,U+8FFD,U+9000-9001,U+9003,U+9009-900A,U+900F-9010,U+9014,U+901A,U+901F-9020,U+9038,U+903E,U+9042,U+9047,U+9057,U+9065,U+906D-906E,U+9075,U+9080,U+9091,U+90A2,U+90AA,U+90AE,U+90B9,U+90C1,U+90D1,U+90E7,U+9149,U+914C,U+9157,U+915D-915E,U+9165,U+916E,U+9178,U+9189,U+9192,U+91C9,U+91CD-91CE,U+9488,U+949F,U+94A5,U+94A8,U+94BB,U+94C0-94C1,U+94DC,U+94E1,U+94E3,U+94F1,U+94F6,U+94F8,U+9500-9501,U+9508,U+950C,U+9511,U+9517,U+9521,U+9525,U+9528,U+9547,U+9576,U+95EE,U+95F2,U+95F8,U+95FB,U+9605,U+9609,U+960E,U+9633-9635,U+963B,U+9640,U+9650,U+9662,U+9668-9669,U+9676-9677,U+9685,U+968B,U+968F-9690,U+9699,U+969C,U+96A7,U+96C1,U+96C4-96C5,U+96CD,U+96E8,U+96EA,U+96FE,U+9700,U+9704,U+9707,U+971C,U+971E,U+9774,U+978B,U+97E6,U+97F3,U+97F5,U+9875,U+9879-987B,U+987D,U+9882,U+9884,U+9890,U+9893,U+9896,U+9898,U+989C,U+996E,U+9972,U+9985,U+9999,U+9A6D-9A6F,U+9A7B-9A7C,U+9A8C,U+9AA4,U+9AD3,U+9B03,U+9B4F,U+9C7C,U+9C9C,U+9E26,U+9E2D,U+9E2F,U+9E33,U+9E35,U+9E70,U+9ECD,U+9F20"
	}),
	Object.freeze({
		family: "Aha Hand",
		file: "wenkai-gb-4-375dc3b3.woff2",
		bytes: 257596,
		unicodeRange: "U+4E0C,U+4E10,U+4E15,U+4E1E,U+4E28,U+4E36,U+4E3F,U+4E47,U+4E5C,U+4E69,U+4E8D,U+4E93,U+4E98,U+4E9F-4EA0,U+4EB3,U+4EB5,U+4EBB,U+4EC2-4EC4,U+4EC9,U+4EDD-4EDE,U+4EE1,U+4EE8,U+4EEB,U+4EF3,U+4EF5,U+4F09,U+4F1B,U+4F22,U+4F25,U+4F27,U+4F2B,U+4F32,U+4F3D,U+4F57-4F58,U+4F5A,U+4F5D-4F5F,U+4F64-4F65,U+4F67,U+4F74,U+4F76,U+4F7B-4F7C,U+4F7E,U+4F83,U+4F89,U+4F8F,U+4F91,U+4F94,U+4FAA,U+4FAC,U+4FC5,U+4FCE,U+4FD1,U+4FDA,U+4FDC,U+4FDF,U+4FE3,U+4FE6,U+4FE8,U+4FEA,U+4FF3,U+4FF8,U+4FFE,U+500C,U+500F,U+501C,U+5025,U+5028-5029,U+502C-502E,U+5043,U+5048,U+504C,U+504E,U+5055,U+506C,U+507B,U+507E,U+50A5,U+50A7,U+50A9,U+50BA,U+50D6,U+50E6,U+50EC-50EE,U+5106-5107,U+510B,U+5140,U+5155-5156,U+516E,U+5181-5182,U+5196,U+51A2,U+51A5,U+51AB,U+51B1,U+51BC-51BD,U+51C7,U+51EB,U+51F5,U+51FC,U+5202,U+5208,U+520D-520E,U+522D,U+5233,U+523F-5240,U+524C,U+525C,U+525E,U+5261,U+527D,U+5281-5282,U+5290,U+5293,U+52A2,U+52AC-52AD,U+52BE,U+52D0,U+52D6,U+52F0,U+52F9,U+530D,U+530F-5310,U+5315,U+531A,U+5326,U+532E,U+533E,U+5345,U+535F,U+5363,U+5366,U+5369,U+536E,U+537A,U+538D,U+539D,U+53A3,U+53A5,U+53AE,U+53B6,U+53DF,U+53E8-53E9,U+53F1,U+53F5,U+53FB,U+53FD,U+5406,U+5412,U+5416,U+5421,U+5423,U+5432,U+5443,U+544B,U+5452-5454,U+5456-5457,U+5459,U+5464,U+5466,U+5471-5472,U+5476-5477,U+5482,U+5484,U+5494,U+549A-549B,U+549D,U+54A3-54A4,U+54A6-54A7,U+54A9-54AA,U+54AD,U+54B4,U+54BB,U+54BF,U+54C2,U+54CC,U+54CF-54D0,U+54D2-54D5,U+54D9-54DA,U+54DC-54DE,U+54E7,U+54F3,U+54FD,U+54FF,U+550F,U+5511,U+5514,U+551B,U+5520,U+5522-5523,U+5527,U+552A,U+5530,U+5533,U+5537,U+553C,U+553F,U+5541,U+5549,U+5550,U+5555-5556,U+555C,U+5567,U+556C-556D,U+5575-5577,U+557B,U+557E,U+5581,U+5583,U+5588,U+558B,U+558F,U+5591,U+5594,U+5599,U+559F,U+55B1,U+55B5,U+55B9,U+55BD-55BE,U+55C4,U+55C9,U+55CC-55CD,U+55D1-55D2,U+55D4,U+55D6,U+55DD,U+55DF,U+55E4-55E6,U+55E8,U+55EA-55EC,U+55EF,U+55F2-55F3,U+55F5,U+55F7,U+55FE,U+5600-5601,U+5608,U+560C,U+560F,U+561E-561F,U+5623-5624,U+5627,U+562C-562D,U+5639,U+564C-564D,U+5654,U+5657-5659,U+565C,U+5662,U+5664,U+5669,U+566B,U+5671,U+567B-567C,U+5685-5686,U+5693,U+56AF,U+56D4,U+56D7,U+56DD,U+56DF,U+56E1,U+56EB,U+56F5,U+56F9,U+56FF,U+5704,U+5709-570A,U+571C,U+5729-572A,U+572C,U+572E-572F,U+5733,U+5739,U+573B,U+5742,U+574C,U+575C,U+5768-5769,U+576B,U+576D,U+5773,U+5776,U+577B-577C,U+5785-5786,U+578C,U+5793,U+57A0-57A1,U+57A4,U+57A7,U+57A9,U+57AD,U+57B2,U+57B4,U+57B8,U+57CF,U+57D2,U+57D5,U+57D8-57DA,U+57DD,U+57E4,U+57ED,U+57EF,U+57F4,U+57F8,U+57FD,U+5800,U+5807,U+580B,U+580D,U+5819,U+581E,U+5820,U+5844,U+5865,U+586C,U+587E,U+5880-5881,U+5889,U+589A,U+58BC,U+58C5,U+58D1,U+5902,U+5914,U+5919,U+5924-5925,U+592D,U+593C,U+5941-5942,U+5955,U+5958,U+595A,U+5B34,U+5B5B,U+5B6C,U+5C22,U+5C25,U+5C2C,U+5C34,U+5C7A,U+5C88,U+5C8C-5C8D,U+5C90-5C91,U+5C96,U+5C98-5C9A,U+5C9C,U+5CA2-5CA3,U+5CAB-5CAC,U+5CB1,U+5CB5,U+5CB7,U+5CBD,U+5CC1,U+5CC4,U+5CCB,U+5CD2,U+5CE4-5CE5,U+5D02-5D03,U+5D06,U+5D1B,U+5D1E,U+5D24,U+5D26-5D27,U+5D2E,U+5D34,U+5D3D-5D3E,U+5D4A-5D4B,U+5D58,U+5D5B,U+5D5D,U+5D69,U+5D6B-5D6C,U+5D6F,U+5D74,U+5D82,U+5D99,U+5D9D,U+5DB7,U+5DC5,U+5DEF,U+5DFD,U+5E0F,U+5E11,U+5E14,U+5E19,U+5E31,U+5E37,U+5E3B-5E3C,U+5E44,U+5E54,U+5E5B,U+5E5E,U+5E61,U+5E80,U+5E8B,U+5E91,U+5E96,U+5EA0,U+5EA5,U+5EB3,U+5EB5,U+5EB9,U+5EBE,U+5ED1-5ED2,U+5EDB,U+5EE8,U+5EEA,U+5EF4,U+5EFE-5EFF,U+5F01,U+5F08,U+5F0B,U+5F11,U+5F61,U+5F73,U+5F77,U+5F82,U+5F87,U+5F89,U+5F8C,U+5F95,U+5F99,U+5F9C,U+5FA8,U+5FAD,U+5FB5,U+5FBC,U+5FD2,U+61FF,U+624C,U+626A,U+629F,U+62BB,U+62CA,U+62D7,U+62DA,U+62EE,U+62F6,U+6322,U+6339,U+6343,U+634B,U+6369,U+636D,U+6371,U+637A,U+638A,U+638E,U+63AC-63AE,U+63B4,U+63BC,U+63BE,U+63C4,U+63C6,U+63CE,U+63DE,U+63E0,U+63F2,U+63F6,U+63F8,U+63FF,U+640B-640C,U+641B,U+6420-6421,U+6426,U+6441,U+6445,U+6452,U+645E,U+646D,U+647A,U+6484,U+6496,U+6499,U+64B7-64B8,U+64BA,U+64C0,U+64D0,U+64D7,U+64E2,U+64E4,U+6509,U+6525,U+652E,U+6538,U+6BD3,U+6C10,U+6C3D,U+6C46,U+71EE,U+723B,U+72AD,U+72B0,U+72B4,U+72B7-72B8,U+72C1,U+72C3,U+72CD-72CE,U+72D2,U+72E8-72E9,U+72EF,U+72F2-72F4,U+72F7,U+72FA-72FB,U+7301,U+7303,U+730A,U+7313,U+7315,U+7317,U+731D-731E,U+7321-7322,U+7325,U+732C,U+7331,U+7338-7339,U+734D,U+7350,U+7357,U+7360,U+736C,U+736F,U+737E,U+750D,U+7519,U+755A,U+777E,U+77A2,U+77CD,U+7980,U+79BA,U+7C74,U+7F54,U+7FB8,U+8037,U+80E4,U+8114,U+81BA,U+821B,U+8279,U+827D,U+827F,U+8284,U+8288,U+828A,U+828E-828F,U+8291,U+8297-8299,U+829F,U+82A1,U+82A4,U+82A8-82AB,U+82AE,U+82B0,U+82B4,U+82B7-82B8,U+82BE,U+82C1,U+82C4,U+82C8,U+82CA-82CC,U+82CE,U+82D2-82D3,U+82D5,U+82D8,U+82DC,U+82E0-82E1,U+82E3-82E4,U+82F4,U+82F7,U+82FB,U+8306-8309,U+830C,U+830F,U+8311,U+8314-8315,U+8317,U+831A-831C,U+832D,U+832F,U+8331,U+8333-8334,U+833A,U+833C,U+8340,U+8343,U+8347,U+834F,U+8351,U+835B-835C,U+835E-8360,U+8365-8366,U+8368-836A,U+836C-836E,U+8378,U+837B-837D,U+8385,U+8392-8393,U+8398,U+839B-839C,U+839E,U+83A0,U+83A8-83AA,U+83B0,U+83B3-83B4,U+83B6,U+83B8,U+83BA,U+83BC,U+83C0-83C1,U+83C5,U+83D4,U+83D6,U+83D8,U+83DD,U+83DF,U+83E1,U+83E5,U+83EA,U+83F0,U+83F8-83F9,U+83FD,U+8401,U+8403,U+8406,U+840B,U+840F,U+8411,U+8418,U+841C,U+8426,U+8431,U+8438,U+843C,U+8446,U+8451,U+8459-845A,U+845C,U+8469,U+846D,U+8473,U+8476,U+8478,U+847A,U+8487-8489,U+848C,U+848E,U+8497,U+84A1,U+84AF,U+84B4,U+84B9-84BA,U+84BD,U+84BF,U+84C1,U+84CA,U+84CD,U+84D0,U+84D3,U+84E0,U+84E3,U+84E5-84E6,U+84F0,U+84FC,U+84FF,U+850C,U+851F,U+8538-853B,U+8543,U+8548,U+8556,U+8559,U+855E,U+8564,U+8568,U+8572,U+8579-857B,U+8585,U+8587,U+858F,U+859C,U+85A4,U+85A8,U+85AE,U+85B0,U+85B7,U+85B9,U+85C1,U+85D3,U+85DC,U+85FF,U+8605,U+8616,U+8627,U+8629,U+863C,U+8803,U+8862,U+886E,U+88A4,U+88D2,U+8A07,U+8BA0,U+8BA6-8BA7,U+8BAA,U+8BB4-8BB5,U+8BB7,U+8BC2-8BC3,U+8BCB,U+8BCE-8BCF,U+8BD2-8BD4,U+8BD6,U+8BD8-8BD9,U+8BDC,U+8BDF-8BE0,U+8BE4,U+8BE8-8BE9,U+8BEE,U+8BF0,U+8BF3,U+8BF6,U+8BF9,U+8BFC,U+8BFF-8C00,U+8C02,U+8C04,U+8C07,U+8C0C,U+8C0F,U+8C11-8C12,U+8C14-8C16,U+8C18-8C19,U+8C1B,U+8C1D,U+8C1F-8C21,U+8C25,U+8C27,U+8C2A-8C2B,U+8C2E-8C2F,U+8C32-8C33,U+8C35-8C36,U+8C73,U+8D53,U+8D5C-8D5D,U+8F94,U+9097,U+9099,U+909B,U+909D,U+90A1,U+90AC,U+90B0,U+90B3-90B4,U+90B6,U+90B8,U+90BA,U+90BE,U+90C4-90C5,U+90C7,U+90CF-90D0,U+90D3,U+90D7,U+90DB-90DC,U+90E2,U+90E6,U+90EB,U+90EF,U+90FE,U+9104,U+911E,U+9122-9123,U+912F,U+9131,U+9139,U+9143,U+9146,U+961D,U+9621-9622,U+962A,U+9631,U+963C-963D,U+9642,U+9649,U+9654,U+965F,U+9667,U+966C,U+9672,U+9674,U+9688,U+968D,U+9697,U+96B0,U+9765,U+98E7,U+9963,U+9967-996C,U+9974,U+9977,U+997D,U+9980,U+9984,U+9987,U+998A,U+998D,U+9990-9991,U+9993-9995,U+9997-9998,U+99A8,U+9B2F,U+9B32,U+9EC9,U+9F10,U+9F17,U+9F19,U+9FA0"
	}),
	Object.freeze({
		family: "Aha Hand",
		file: "wenkai-gb-5-d0359bbc.woff2",
		bytes: 278908,
		unicodeRange: "U+4E2C,U+5216,U+54AB,U+584D,U+5981,U+5983,U+598D,U+5997,U+599E,U+59A3-59A4,U+59A9-59AB,U+59AF,U+59B2,U+59BE,U+59CA,U+59D2,U+59D7-59D8,U+59DD,U+59E3,U+59F9,U+5A05-5A06,U+5A08-5A09,U+5A0C,U+5A11,U+5A13,U+5A23,U+5A32,U+5A34,U+5A3C,U+5A40,U+5A4A,U+5A55,U+5A62,U+5A67,U+5A75,U+5A77,U+5A7A,U+5A9B,U+5AAA,U+5AB2,U+5AB5,U+5AB8,U+5ABE,U+5AD2,U+5AD4,U+5AD6,U+5AD8,U+5ADC,U+5AE0,U+5AE3,U+5AE6,U+5AEB,U+5AF1,U+5B09,U+5B16-5B17,U+5B32,U+5B37,U+5B40,U+5B51,U+5B53,U+5B5A,U+5B62,U+5B65,U+5B71,U+5B73,U+5B80,U+5B84,U+5B93,U+5B95,U+5BA5,U+5BB8,U+5BE4,U+5BEE,U+5BF0,U+5C15,U+5C1C,U+5C3B,U+5C50,U+5C59,U+5C63,U+5C66,U+5C6E,U+5DDB,U+5E7A,U+5F29-5F2A,U+5F2D,U+5F3C,U+5F40,U+5F50,U+5F56-5F58,U+5FC4,U+5FC9,U+5FCF-5FD1,U+5FD6,U+5FDD,U+5FE1,U+5FE4,U+5FEA,U+5FED-5FEE,U+5FF8,U+5FFE,U+6003-6006,U+600A,U+600D,U+600F,U+6019,U+601B,U+6021,U+6026,U+6029,U+602B,U+6035,U+603C,U+603F,U+6041-6042,U+6059-605A,U+605D,U+6063,U+6067,U+606A,U+6078-607B,U+607D,U+6083,U+608C,U+6092,U+6096,U+609A-609B,U+609D,U+60AB,U+60AD,U+60B1,U+60B4,U+60BB,U+60C6,U+60D8,U+60DA,U+60DD,U+60EC,U+60F4,U+6100,U+6106,U+610D-610E,U+6115,U+6120,U+6123,U+6126,U+612B,U+614A,U+615D,U+6175,U+6194,U+619D,U+61A7,U+61A9,U+61AC,U+61B7,U+61CB,U+61D1,U+61D4,U+61F5,U+6206,U+620B,U+6215,U+6217,U+621B,U+621F,U+6221-6222,U+6224-6225,U+622C,U+623D-623E,U+6243,U+6248-6249,U+6308,U+6332,U+63B0,U+6434,U+643F,U+64D8,U+6534-6535,U+6555,U+656B,U+6590,U+6593,U+65AB,U+65BC,U+65C3-65C4,U+65C6,U+65CC,U+65CE,U+65D2,U+65D6,U+65EE-65F0,U+6600,U+6603,U+660A,U+6615,U+6619,U+661D,U+6631,U+6634-6636,U+6641,U+664F,U+6654,U+6656-6657,U+665F,U+6661,U+6677,U+6684,U+668C,U+669D,U+66A7,U+66B9,U+66BE,U+66DB-66DC,U+66E6,U+66E9,U+66F7,U+670A,U+6710,U+6715,U+6726,U+6748,U+674C,U+6753,U+675E,U+6769-676A,U+6772-6773,U+6775,U+6777,U+677C,U+6787,U+678B,U+6798,U+679E,U+67A5,U+67A7-67A8,U+67AD,U+67B0,U+67B3,U+67B5,U+67B8,U+67C1,U+67C3,U+67D8-67DA,U+67DD,U+67E2,U+67E9,U+67F0,U+67FD,U+6800,U+6809-680A,U+680C,U+680E,U+681D,U+6829,U+6832-6833,U+683E,U+6840-6841,U+6844,U+6849-684A,U+684E,U+6855,U+6860-6862,U+6864,U+6866-6867,U+686B,U+6874,U+6877,U+6883,U+688F,U+6893,U+68B5,U+68C2,U+68E3,U+68F0,U+68F9,U+68FC,U+6901,U+690B,U+6910,U+691F-6920,U+6924,U+6934,U+6939,U+6942,U+6957,U+695D,U+6960,U+6963,U+6966,U+696B,U+696E,U+6971,U+6978-6979,U+6980,U+6984,U+6987-6989,U+698D,U+6995,U+6998,U+699B,U+69A7,U+69AB,U+69AD,U+69B1,U+69BB,U+69C1,U+69CA,U+69CC,U+69CE,U+69D4,U+69DF-69E0,U+69ED,U+69F2,U+69FF,U+6A17-6A18,U+6A28,U+6A2F,U+6A35,U+6A3D-6A3E,U+6A44,U+6A50,U+6A58,U+6A5B,U+6A65,U+6A79,U+6A7C,U+6A8E,U+6A90-6A91,U+6A97,U+6AA0,U+6AA9,U+6AAB,U+6B24,U+6B37,U+6B39,U+6B43,U+6B46,U+6B59,U+6B81-6B82,U+6B84,U+6B87,U+6B8D,U+6B92-6B93,U+6B9A-6B9B,U+6BA1,U+6BAA,U+6BB3,U+6BC2,U+6BEA,U+6BF3,U+6BF5,U+6BF9,U+6BFD,U+6C05-6C07,U+6C0D,U+6C15,U+6C18-6C1A,U+6C21,U+6C24,U+6C29-6C2A,U+6C32,U+6C35,U+6C4A,U+6C54,U+6C5C,U+6C68-6C69,U+6C74,U+6C76,U+6C85-6C86,U+6C8C,U+6C90,U+6C93-6C94,U+6CA3,U+6CA9,U+6CAD,U+6CB1-6CB2,U+6CD0,U+6CD3-6CD4,U+6CD6-6CD7,U+6CE0,U+6CEB,U+6CEE-6CEF,U+6CF1,U+6CF6-6CF8,U+6CFA,U+6CFE,U+6D04,U+6D07,U+6D0C,U+6D0E,U+6D19-6D1A,U+6D27,U+6D2B,U+6D2E,U+6D33,U+6D35,U+6D39,U+6D43,U+6D48,U+6D4D,U+6D4F,U+6D52,U+6D54,U+6D5C,U+6D5E,U+6D60,U+6D63,U+6D6F,U+6D7C,U+6D91,U+6D93-6D94,U+6D9E,U+6DA0,U+6DAB,U+6DAE,U+6DBF,U+6DC5,U+6DC7,U+6DD9,U+6DDD-6DDE,U+6DE0,U+6DE6,U+6DFC,U+6E0C,U+6E0E,U+6E11,U+6E16,U+6E1A,U+6E25,U+6E2B,U+6E32,U+6E44,U+6E4E,U+6E53-6E54,U+6E5F,U+6E6B,U+6E6E,U+6E86,U+6E8F,U+6E98,U+6E9F,U+6EA5,U+6EA7,U+6EB1-6EB2,U+6EB4,U+6EB7,U+6EBB,U+6EBD,U+6EC2,U+6ECF,U+6ED5,U+6ED7,U+6EDF-6EE0,U+6EE2,U+6EF9,U+6F09,U+6F15,U+6F24,U+6F29-6F2A,U+6F2D,U+6F2F,U+6F36,U+6F46-6F47,U+6F4B,U+6F62,U+6F72,U+6F74,U+6F78,U+6F7A,U+6F7C,U+6F89,U+6F8C-6F8D,U+6FA7,U+6FB6,U+6FB9,U+6FC2,U+6FC9,U+6FD1,U+6FDE,U+6FE0-6FE1,U+6FEE-6FEF,U+701A-701B,U+7023,U+7035,U+7039,U+704F,U+705E,U+706C,U+7080,U+7085,U+7096,U+709C-709D,U+70AB,U+70B1,U+70B7,U+70BB,U+70C0,U+70CA,U+70E8,U+7110,U+7113,U+7116,U+7118,U+712F,U+7131,U+7145,U+714A,U+715C,U+7166,U+7168,U+7172-7173,U+7178,U+717A,U+7198,U+71A0,U+71A8,U+71B3,U+71B5,U+71B9,U+71D4,U+71E0,U+71E7,U+71F9,U+721D,U+7228,U+7230,U+723F,U+724D,U+7252,U+7256,U+725D,U+7266,U+726E-726F,U+727E-727F,U+7284,U+728B,U+728D,U+728F,U+7292,U+729F,U+7337,U+7352,U+738E,U+7391,U+739F,U+73A2,U+73AE,U+73B3,U+73B7,U+73BA,U+73C0,U+73C2,U+73C8-73C9,U+73CF,U+73D1,U+73D9,U+73DE,U+73E5,U+73E7,U+73E9,U+73F2,U+740A,U+740F,U+741A-741B,U+7425-7426,U+7428,U+742A,U+742C,U+742E,U+7430,U+7441,U+7455,U+7457,U+7459,U+745B-745C,U+746D,U+7477,U+747E,U+7480-7481,U+7487,U+748B,U+748E,U+7490,U+749C,U+749E,U+74A7-74A9,U+74BA,U+74D2,U+74EF,U+74F4,U+74FF,U+750F,U+7511,U+7513,U+752F,U+753E,U+757F,U+77F6,U+77F8,U+7800,U+7809,U+7811,U+7817-7818,U+781C-781D,U+782D,U+793B,U+7940,U+7946,U+7949,U+7953,U+7957,U+795A-795C,U+7960,U+7962,U+7967,U+796F,U+797A,U+7985,U+798A,U+799A,U+79A7,U+79B3,U+7E9F,U+7EA1,U+7EA3,U+7EA5,U+7EA8-7EA9,U+7EAD,U+7EB0,U+7EBE,U+7EC0-7EC2,U+7EC9,U+7ECB-7ECC,U+7ED0,U+7ED4,U+7ED7,U+7EDB,U+7EE0-7EE1,U+7EE8,U+7EEB,U+7EEE-7EEF,U+7EF1-7EF2,U+7EF6,U+7EFA-7EFB,U+7EFE,U+7F01-7F03,U+7F07-7F08,U+7F0B-7F0D,U+7F0F,U+7F11-7F12,U+7F17,U+7F19,U+7F1B-7F1C,U+7F1F,U+7F21-7F27,U+7F2A-7F2D,U+7F2F-7F33,U+7F35,U+7FBC,U+8004,U+8006,U+807F-8080,U+8093,U+809C,U+809F,U+80AB,U+80AD,U+80B1,U+80B4,U+80B7,U+80BC-80BD,U+80C2,U+80C4,U+80CD,U+80D7,U+80D9,U+80DB,U+80DD,U+80E7-80ED,U+80F1-80F2,U+80F4,U+80FC,U+810D-810E,U+8112,U+8118,U+811E,U+812C,U+8132,U+8136,U+8148,U+814C,U+8153,U+8159-815A,U+8160,U+8167,U+8169,U+816D,U+8171,U+8174,U+817C-817D,U+8182,U+8188,U+8191,U+81A3,U+81A6,U+81AA,U+81BB,U+81C1,U+81CA,U+81CC,U+81E7,U+8274,U+8662,U+8930,U+89C7,U+89CA-89CC,U+89CE-89D1,U+89F3,U+8B07,U+8C5A,U+8D32-8D33,U+8D36,U+8D3B,U+8D3D,U+8D40,U+8D45-8D49,U+8D4D,U+8D55,U+8D59,U+8E47,U+8ECE,U+8F6B,U+8F6D,U+8F71-8F73,U+8F75-8F7A,U+8F7C,U+8F7E,U+8F81-8F82,U+8F84,U+8F87,U+8F8B,U+8F8D-8F8F,U+8F98,U+8F9A,U+8FB6,U+8FD3,U+8FD5,U+8FE4-8FE6,U+8FE8-8FE9,U+8FEE,U+8FF3,U+9004-9005,U+900B,U+900D,U+9011,U+9016,U+9021,U+9026,U+902D,U+902F,U+9035-9036,U+9044,U+9050-9052,U+9058,U+905B,U+9062,U+9068,U+9074,U+907D,U+9082-9083,U+9088,U+908B,U+9095,U+95E9,U+95EB,U+95F1,U+95F3,U+95F5-95F6,U+95FC,U+95FE,U+9603-9604,U+9606,U+9608,U+960A-960D,U+960F,U+9612,U+9615-9617,U+9619-961A,U+96B3,U+97EA-97EC,U+987C,U+98D1-98D3,U+98D5,U+98D9-98DA,U+9A75,U+9A77-9A78,U+9A7A,U+9A7D,U+9A7F-9A81,U+9A85,U+9A88,U+9A8A,U+9A90,U+9A92-9A93,U+9A96,U+9A98,U+9A9B-9AA0,U+9AA2-9AA3,U+9AA5,U+9AA7,U+9B3B,U+9F51"
	}),
	Object.freeze({
		family: "Aha Hand",
		file: "wenkai-gb-6-a238b41c.woff2",
		bytes: 307604,
		unicodeRange: "U+5D47,U+6549,U+659B,U+66A8,U+74DE,U+74E0,U+752C,U+753A,U+7540,U+7548,U+754B,U+754E,U+755B,U+7572,U+7579,U+7583,U+758B,U+7592,U+7594,U+7596,U+759D,U+75A0,U+75A3,U+75AC,U+75B0-75B1,U+75B3-75B4,U+75B8,U+75C2-75C4,U+75CD,U+75D6,U+75E3-75E4,U+75E6-75E8,U+75EB,U+75F1,U+75FC,U+75FF-7600,U+7603,U+7605,U+760A,U+760C,U+7610,U+7615,U+7617-7619,U+761B,U+7620,U+7622,U+7625,U+762D,U+7630,U+7633,U+7635,U+763C,U+763E-7640,U+7643,U+764D,U+7654,U+7656,U+765C,U+765E,U+766B,U+766F,U+7688,U+768E,U+7693,U+7699,U+76A4,U+76B2,U+76B4,U+76CD,U+76E5,U+76F1,U+76F9,U+7704,U+7707-7708,U+770D,U+7719-771A,U+7722,U+7726,U+772D,U+7735,U+7738,U+7743,U+7747,U+7750-7751,U+775A,U+7762,U+7765,U+7768,U+777D,U+777F-7780,U+778C-778D,U+7791,U+779F-77A0,U+77B0,U+77B5,U+77BD,U+77BF,U+77DC,U+77E7,U+77EC,U+781F,U+7823,U+7825-7826,U+7829,U+782C,U+7839-783C,U+7847,U+784C,U+784E,U+7850,U+7856-7857,U+786A,U+786D,U+7887,U+7893,U+789A-789C,U+78A1,U+78A3,U+78A5,U+78B2,U+78B9,U+78C9,U+78D4,U+78D9,U+78EC,U+78F2,U+78F4,U+7905,U+7913,U+791E,U+7924,U+7934,U+79D5,U+79E3,U+79EB,U+79ED,U+7A02-7A03,U+7A06,U+7A14,U+7A1E,U+7A23,U+7A37,U+7A39,U+7A51,U+7A70,U+7A78-7A79,U+7A80,U+7A86,U+7A88,U+7A95,U+7AA0,U+7AA6,U+7AA8,U+7AAC-7AAD,U+7AB3,U+7AE6,U+7AFA,U+7AFD,U+7B03-7B04,U+7B08,U+7B0A,U+7B0F,U+7B15,U+7B19,U+7B1E,U+7B20,U+7B24-7B25,U+7B2A-7B2B,U+7B2E,U+7B31,U+7B33,U+7B38,U+7B3E,U+7B45,U+7B47,U+7B4C,U+7B58,U+7B5A,U+7B5D,U+7B60,U+7B62,U+7B6E,U+7B71-7B72,U+7B75,U+7B7B,U+7B85,U+7B90,U+7B9C-7B9D,U+7BA2,U+7BA6-7BA8,U+7BAA-7BAC,U+7BB4,U+7BB8,U+7BC1,U+7BCC,U+7BD1,U+7BDA,U+7BDD,U+7BE5-7BE6,U+7BEA,U+7BFC,U+7BFE,U+7C0B-7C0C,U+7C0F,U+7C16,U+7C1F,U+7C26,U+7C2A,U+7C38,U+7C40-7C41,U+7C7C,U+7C91,U+7C9C-7C9E,U+7CA2,U+7CB2,U+7CBC-7CBD,U+7CC1,U+7CC5,U+7CC7-7CC8,U+7CCC-7CCD,U+7CD7,U+7CE8,U+7CF8,U+7D77,U+7DA6,U+7DAE,U+7E3B,U+7E47,U+7E9B,U+7F36,U+7F42,U+7F44-7F45,U+7F58,U+7F5F,U+7F61,U+7F68,U+7F71,U+7F74,U+7F79,U+7F7E,U+7F81,U+7F9D,U+7F9F,U+7FA7,U+7FAF-7FB0,U+7FB2,U+7FBF,U+7FCA,U+7FCE,U+7FD5,U+7FE1,U+7FE5-7FE6,U+7FE9,U+7FEE,U+7FF3,U+800B,U+8012,U+8014,U+8016,U+801C,U+8020,U+8022,U+8025-8029,U+8031,U+8035,U+8043,U+8046,U+804D,U+8052,U+8069,U+8071,U+80E5,U+81EC,U+81FE,U+8201-8202,U+8204,U+8210,U+8221-8223,U+8228,U+822B,U+822D,U+822F,U+8233-8234,U+8238,U+823B,U+823E,U+8244,U+8249,U+824B,U+824F,U+825A,U+825F,U+8268,U+826E,U+864D,U+8654,U+866C,U+866E,U+867A-867C,U+867F,U+868B,U+868D,U+8693,U+869D,U+86A3,U+86A7-86AA,U+86AC,U+86AF-86B1,U+86B4-86B6,U+86BA,U+86C4,U+86C9,U+86CE-86D1,U+86D8,U+86DE-86DF,U+86E9,U+86ED,U+86F1-86F4,U+86F8,U+8703,U+8707-870A,U+870D,U+8713,U+871A,U+871E,U+8722-8723,U+8725,U+8729,U+872E,U+8731,U+8734,U+8737,U+873B,U+873E-873F,U+8748,U+874C,U+8753,U+8759,U+8760,U+8763-8765,U+876E,U+8770,U+877B-877E,U+8782-8783,U+8785,U+8788,U+878B,U+8793,U+8797,U+87A8,U+87AB-87AD,U+87AF,U+87B3,U+87B5,U+87BD,U+87C0,U+87C6,U+87CA-87CB,U+87D1-87D3,U+87DB,U+87E0,U+87E5,U+87EA,U+87EE,U+87FE,U+880A,U+8813,U+8816,U+881B,U+8821,U+8832,U+8839,U+883C,U+8844,U+8864,U+8869,U+8872,U+887D-887F,U+8882,U+8885,U+8888,U+88A2,U+88B7,U+88BC,U+88C6,U+88C9,U+88CE,U+88D8,U+88DF,U+88E2-88E3,U+88E5,U+88E8,U+88F0-88F1,U+88FC,U+88FE,U+890A,U+8913,U+8919-891B,U+8921,U+892B,U+8934,U+8936,U+8941,U+895E,U+8966,U+897B,U+8983,U+89D6,U+89DA,U+89DC,U+89DE,U+89E5,U+89EB,U+89EF,U+8A3E,U+8A48,U+8B26,U+8C47,U+8C49,U+8C55,U+8C78,U+8C82,U+8C85,U+8C8A,U+8C94,U+8C98,U+8D67,U+8D6D,U+8D73,U+8D84,U+8D91,U+8D94,U+8DB1,U+8DB5,U+8DB8,U+8DBA,U+8DBC,U+8DBF,U+8DC4,U+8DC6,U+8DCE-8DCF,U+8DD6-8DD7,U+8DDA-8DDB,U+8DDE,U+8DE3-8DE4,U+8DEB-8DEC,U+8DF7-8DF9,U+8DFB,U+8DFD,U+8E05,U+8E09,U+8E14,U+8E1D,U+8E1F,U+8E23,U+8E2C,U+8E2E-8E2F,U+8E31,U+8E35,U+8E39-8E3A,U+8E3D,U+8E40-8E42,U+8E49-8E4A,U+8E51-8E52,U+8E59,U+8E69,U+8E6F-8E70,U+8E74,U+8E76,U+8E7C,U+8E85,U+8E8F-8E90,U+8E94,U+8E9C,U+8E9E,U+914A,U+914E-9150,U+9161-9162,U+9164,U+9169,U+916F-9170,U+9172,U+9174,U+9179,U+917D-917E,U+9185,U+918C-918D,U+9190-9191,U+91A2-91A3,U+91AA,U+91AD-91AF,U+91B4-91B5,U+91BA,U+928E,U+92AE,U+92C8,U+933E,U+936A,U+938F,U+93CA,U+93D6,U+943E,U+946B,U+9485-9487,U+948A-948D,U+948F-9490,U+9494-9495,U+9497,U+949A-949C,U+94A3-94A4,U+94AA-94AD,U+94AF-94B0,U+94B2,U+94B4,U+94B6-94BA,U+94BC-94BD,U+94BF,U+94C4,U+94C8-94CE,U+94D0-94D2,U+94D5-94D9,U+94DB,U+94DE-94E0,U+94E2,U+94E4-94E5,U+94E7-94EB,U+94EE-94EF,U+94F3-94F5,U+94F7,U+94F9,U+94FC-94FD,U+94FF,U+9502-9503,U+9506-9507,U+9509-950A,U+950D-950F,U+9512-9516,U+9518,U+951B,U+951D-951F,U+9522,U+9529-952C,U+9531-9532,U+9534-9538,U+953A,U+953C,U+953E-953F,U+9542,U+9544-9546,U+9549,U+954C,U+954E-954F,U+9552-9554,U+9556-9559,U+955B,U+955D-955F,U+9561-9562,U+9564-956C,U+956F,U+9571-9573,U+96B9,U+96BC-96BD,U+96C9,U+96CE,U+96D2,U+96E0,U+96E9,U+96EF,U+96F3,U+9701,U+9706,U+9708,U+970E-970F,U+972A,U+972D,U+9730,U+973E,U+9753,U+977C,U+9785,U+9791-9792,U+9794,U+97A3,U+97AB,U+97AF,U+97B2,U+97B4,U+9878,U+9880,U+9883,U+9889,U+988C-988D,U+988F,U+9894,U+989A-989B,U+989E-989F,U+98A1-98A2,U+98A5-98A6,U+98E8,U+990D,U+992E,U+9954-9955,U+99A5,U+9AB0-9AB1,U+9AB6-9AB7,U+9ABA,U+9ABC,U+9AC0-9AC2,U+9AC5,U+9ACB-9ACC,U+9AD1,U+9ADF,U+9AE1,U+9AE6,U+9AEB,U+9AED,U+9AEF,U+9AF9,U+9AFB,U+9B08,U+9B0F,U+9B13,U+9B1F,U+9B23,U+9B43,U+9B45,U+9B47-9B49,U+9B4D,U+9B51,U+9C7F,U+9C82,U+9C85-9C88,U+9C8B,U+9C8E,U+9C90-9C92,U+9C94-9C95,U+9C9A-9C9B,U+9C9E-9CA3,U+9CA5-9CA9,U+9CAB,U+9CAD-9CAE,U+9CB0-9CB7,U+9CBA-9CBD,U+9CC4-9CC7,U+9CCA-9CD0,U+9CD3-9CD5,U+9CD7-9CD9,U+9CDC-9CDD,U+9CDF,U+9CE2,U+9E20,U+9E22,U+9E28-9E2C,U+9E31-9E32,U+9E36-9E3A,U+9E3E,U+9E41-9E42,U+9E44,U+9E46-9E49,U+9E4B-9E4C,U+9E4E,U+9E51,U+9E55,U+9E57-9E58,U+9E5A-9E5C,U+9E5E,U+9E63,U+9E66-9E6D,U+9E71,U+9E73,U+9E7E,U+9E82,U+9E87-9E88,U+9E8B,U+9E92,U+9E9D,U+9E9F,U+9EB4,U+9EB8,U+9EBD-9EBE,U+9ECF,U+9EDB-9EDD,U+9EDF-9EE0,U+9EE2,U+9EE5,U+9EE7,U+9EE9-9EEA,U+9EEF,U+9EF9,U+9EFB-9EFC,U+9EFE,U+9F0B,U+9F0D,U+9F22,U+9F2C,U+9F2F,U+9F37,U+9F39,U+9F3D-9F3E,U+9F44,U+9F80,U+9F83,U+9F85-9F8A,U+9F8C,U+9F9B"
	})
]);
//#endregion
//#region src/host/jobs.js
const KEEP_FINISHED_MS = 10 * 6e4;
const MAX_JOBS = 200;
function createJobs({ logger, now = Date.now } = {}) {
	const jobs = /* @__PURE__ */ new Map();
	const byKey = /* @__PURE__ */ new Map();
	function sweep() {
		const cutoff = now() - KEEP_FINISHED_MS;
		for (const [id, job] of jobs) if (job.finishedAt && job.finishedAt < cutoff) {
			jobs.delete(id);
			if (job.key && byKey.get(job.key) === id) byKey.delete(job.key);
		}
		if (jobs.size > MAX_JOBS) {
			const finished = [...jobs.values()].filter((job) => job.finishedAt).sort((a, b) => a.finishedAt - b.finishedAt);
			for (const job of finished.slice(0, jobs.size - MAX_JOBS)) jobs.delete(job.id);
		}
	}
	function start(kind, run, { key, meta } = {}) {
		sweep();
		if (key && byKey.has(key)) {
			const existing = jobs.get(byKey.get(key));
			if (existing && !existing.finishedAt && !existing.controller.signal.aborted) return snapshot(existing);
		}
		const controller = new AbortController();
		const job = {
			id: newId("job"),
			kind,
			key: key ?? null,
			meta: meta ?? {},
			status: "running",
			progress: {
				done: 0,
				total: 0,
				label: ""
			},
			partial: [],
			preview: null,
			result: void 0,
			error: void 0,
			startedAt: now(),
			finishedAt: null,
			controller
		};
		jobs.set(job.id, job);
		if (key) byKey.set(key, job.id);
		const api = {
			signal: controller.signal,
			progress(done, total, label = job.progress.label) {
				job.progress = {
					done,
					total,
					label
				};
			},
			push(item) {
				job.partial.push(item);
			},
			preview(value) {
				job.preview = value ?? null;
			}
		};
		const aborted = new Promise((_, reject) => {
			controller.signal.addEventListener("abort", () => reject(controller.signal.reason ?? /* @__PURE__ */ new Error("cancelled")), { once: true });
		});
		job.settled = Promise.race([Promise.resolve().then(() => run(api)), aborted]).then((result) => {
			job.status = "done";
			job.result = result;
		}).catch((error) => {
			job.status = controller.signal.aborted ? "cancelled" : "failed";
			job.error = controller.signal.aborted ? {
				code: "cancelled",
				message: "Cancelled"
			} : {
				code: publicCode(error),
				message: publicMessage(error)
			};
			if (job.status === "failed") logger?.warn?.("aha-tutor job %s failed: %s", kind, error?.message);
		}).finally(() => {
			job.finishedAt = now();
		});
		return snapshot(job);
	}
	function snapshot(job, { since = 0 } = {}) {
		return {
			id: job.id,
			kind: job.kind,
			meta: job.meta,
			status: job.status,
			progress: job.progress,
			partial: job.partial.slice(since),
			partialCount: job.partial.length,
			preview: job.preview ?? void 0,
			elapsedMs: (job.finishedAt ?? now()) - job.startedAt,
			result: job.status === "done" ? job.result : void 0,
			error: job.error
		};
	}
	function get(id, options) {
		const job = jobs.get(id);
		return job ? snapshot(job, options) : null;
	}
	function cancel(id) {
		const job = jobs.get(id);
		if (job && !job.finishedAt) job.controller.abort(/* @__PURE__ */ new Error("cancelled"));
		return job ? snapshot(job) : null;
	}
	function running(key) {
		const id = byKey.get(key);
		const job = id ? jobs.get(id) : void 0;
		return job && !job.finishedAt && !job.controller.signal.aborted ? snapshot(job) : null;
	}
	async function wait(id) {
		const job = jobs.get(id);
		if (!job) return null;
		await job.settled;
		return snapshot(job);
	}
	function cancelKey(key) {
		const job = running(key);
		return job ? cancel(job.id) : null;
	}
	function dispose() {
		for (const job of jobs.values()) if (!job.finishedAt) job.controller.abort(/* @__PURE__ */ new Error("plugin stopped"));
		jobs.clear();
		byKey.clear();
	}
	return Object.freeze({
		start,
		get,
		wait,
		cancel,
		cancelKey,
		running,
		dispose
	});
}
function publicMessage(error) {
	if (error?.userMessage) return String(error.userMessage);
	if (USER_ERRORS$1.includes(error?.name)) return String(error.message);
	return "Generation failed";
}
function publicCode(error) {
	if (!USER_ERRORS$1.includes(error?.name)) return "failed";
	return error.name === "TtsError" ? `tts-${error.code ?? "failed"}` : error.code ?? "failed";
}
const USER_ERRORS$1 = [
	"MaterialError",
	"TtsError",
	"TutorError"
];
//#endregion
//#region src/host/page-image.js
const MAX_PIXELS = 4e6;
const MAX_EDGE = 2400;
const OBJECT_WAIT_MS = 2e4;
const IDENTITY = [
	1,
	0,
	0,
	1,
	0,
	0
];
function multiply(m, n) {
	return [
		m[0] * n[0] + m[2] * n[1],
		m[1] * n[0] + m[3] * n[1],
		m[0] * n[2] + m[2] * n[3],
		m[1] * n[2] + m[3] * n[3],
		m[0] * n[4] + m[2] * n[5] + m[4],
		m[1] * n[4] + m[3] * n[5] + m[5]
	];
}
function invert(m) {
	const det = m[0] * m[3] - m[1] * m[2];
	if (!det) return null;
	return [
		m[3] / det,
		-m[1] / det,
		-m[2] / det,
		m[0] / det,
		(m[2] * m[5] - m[3] * m[4]) / det,
		(m[1] * m[4] - m[0] * m[5]) / det
	];
}
const apply$1 = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function grayOf(color) {
	const hex = /^#([0-9a-f]{6})$/iu.exec(String(color ?? ""))?.[1];
	if (!hex) return 0;
	const value = Number.parseInt(hex, 16);
	return Math.round(((value >> 16) * 299 + (value >> 8 & 255) * 587 + (value & 255) * 114) / 1e3);
}
function placements(OPS, operatorList) {
	const draws = [];
	let ctm = IDENTITY;
	let fill = 0;
	const stack = [];
	const push = () => stack.push({
		ctm,
		fill
	});
	const pop = () => {
		const saved = stack.pop();
		if (saved) ({ctm, fill} = saved);
	};
	const { fnArray, argsArray } = operatorList;
	for (let index = 0; index < fnArray.length; index += 1) {
		const args = argsArray[index] ?? [];
		switch (fnArray[index]) {
			case OPS.save:
				push();
				break;
			case OPS.restore:
			case OPS.paintFormXObjectEnd:
			case OPS.endGroup:
				pop();
				break;
			case OPS.transform:
				ctm = multiply(ctm, args);
				break;
			case OPS.paintFormXObjectBegin:
				push();
				if (Array.isArray(args[0])) ctm = multiply(ctm, args[0]);
				break;
			case OPS.beginGroup:
				push();
				if (Array.isArray(args[0]?.matrix)) ctm = multiply(ctm, args[0].matrix);
				break;
			case OPS.setFillRGBColor:
				fill = grayOf(args[0]);
				break;
			case OPS.paintImageXObject:
				draws.push({
					matrix: ctm,
					image: args[0]
				});
				break;
			case OPS.paintInlineImageXObject:
				draws.push({
					matrix: ctm,
					image: args[0]
				});
				break;
			case OPS.paintImageXObjectRepeat: {
				const [image, scaleX, scaleY, positions = []] = args;
				for (let at = 0; at + 1 < positions.length; at += 2) draws.push({
					matrix: multiply(ctm, [
						scaleX,
						0,
						0,
						scaleY,
						positions[at],
						positions[at + 1]
					]),
					image
				});
				break;
			}
			case OPS.paintInlineImageXObjectGroup: {
				const [image, map = []] = args;
				for (const entry of map) draws.push({
					matrix: multiply(ctm, entry.transform),
					image,
					region: {
						x: entry.x,
						y: entry.y,
						w: entry.w,
						h: entry.h
					}
				});
				break;
			}
			case OPS.paintImageMaskXObject:
				draws.push({
					matrix: ctm,
					mask: args[0],
					fill
				});
				break;
			case OPS.paintImageMaskXObjectGroup:
				for (const mask of args[0] ?? []) draws.push({
					matrix: multiply(ctm, mask.transform),
					mask,
					fill
				});
				break;
			case OPS.paintImageMaskXObjectRepeat: {
				const [mask, scaleX, skewX = 0, skewY = 0, scaleY, positions = []] = args;
				for (let at = 0; at + 1 < positions.length; at += 2) draws.push({
					matrix: multiply(ctm, [
						scaleX,
						skewX,
						skewY,
						scaleY,
						positions[at],
						positions[at + 1]
					]),
					mask,
					fill
				});
				break;
			}
			case OPS.paintSolidColorImageMask:
				draws.push({
					matrix: ctm,
					solid: fill
				});
				break;
			default: break;
		}
	}
	return draws;
}
async function resolve(page, value) {
	if (typeof value !== "string") return value ?? null;
	const objects = value.startsWith("g_") ? page.commonObjs : page.objs;
	let timer;
	try {
		return await Promise.race([new Promise((done) => {
			objects.get(value, done);
		}), new Promise((done) => {
			timer = setTimeout(() => done(null), OBJECT_WAIT_MS);
		})]);
	} finally {
		clearTimeout(timer);
	}
}
function shrink(image, { factor = 1, mask = false, region } = {}) {
	const { width, height, kind, data } = image;
	const x0 = region?.x ?? 0;
	const y0 = region?.y ?? 0;
	const w = Math.max(1, Math.min(region?.w ?? width, width - x0));
	const h = Math.max(1, Math.min(region?.h ?? height, height - y0));
	const outW = Math.max(1, Math.ceil(w / factor));
	const outH = Math.max(1, Math.ceil(h / factor));
	const gray = new Uint8Array(outW * outH);
	const alpha = new Uint8Array(outW * outH);
	let opaque = true;
	const bits = mask || kind === 1;
	const stride = bits ? width + 7 >> 3 : width * (kind === 3 ? 4 : 3);
	for (let oy = 0; oy < outH; oy += 1) {
		const yStart = y0 + oy * factor;
		const yEnd = Math.min(y0 + h, yStart + factor);
		for (let ox = 0; ox < outW; ox += 1) {
			const xStart = x0 + ox * factor;
			const xEnd = Math.min(x0 + w, xStart + factor);
			let level = 0;
			let cover = 0;
			let count = 0;
			for (let y = yStart; y < yEnd; y += 1) {
				const row = y * stride;
				for (let x = xStart; x < xEnd; x += 1) {
					count += 1;
					if (bits) {
						const set = data[row + (x >> 3)] >> 7 - (x & 7) & 1;
						if (mask) cover += set ? 0 : 255;
						else {
							level += set ? 255 : 0;
							cover += 255;
						}
					} else {
						const at = row + x * (kind === 3 ? 4 : 3);
						const value = (data[at] * 299 + data[at + 1] * 587 + data[at + 2] * 114) / 1e3;
						const opacity = kind === 3 ? data[at + 3] : 255;
						level += value * opacity;
						cover += opacity;
					}
				}
			}
			const at = oy * outW + ox;
			alpha[at] = count ? Math.round(cover / count) : 0;
			if (alpha[at] < 255) opaque = false;
			gray[at] = bits ? mask ? 0 : Math.round(level / count) : cover ? Math.round(level / cover) : 255;
		}
	}
	return {
		width: outW,
		height: outH,
		gray,
		alpha,
		opaque
	};
}
function paint(page, full, picture, { fill = null } = {}) {
	const inverse = invert(full);
	if (!inverse) return;
	const corners = [
		[0, 0],
		[1, 0],
		[0, 1],
		[1, 1]
	].map(([x, y]) => apply$1(full, x, y));
	const left = Math.max(0, Math.floor(Math.min(...corners.map((point) => point[0]))));
	const right = Math.min(page.width, Math.ceil(Math.max(...corners.map((point) => point[0]))));
	const top = Math.max(0, Math.floor(Math.min(...corners.map((point) => point[1]))));
	const bottom = Math.min(page.height, Math.ceil(Math.max(...corners.map((point) => point[1]))));
	const [ia, ib, ic, id, ie, iff] = inverse;
	if (picture && Math.abs(ib) < 1e-9 && Math.abs(ic) < 1e-9) {
		paintAligned(page, picture, {
			left,
			right,
			top,
			bottom,
			ia,
			id,
			ie,
			iff,
			fill
		});
		return;
	}
	const { width, height, gray, alpha } = picture ?? {
		width: 1,
		height: 1
	};
	for (let y = top; y < bottom; y += 1) {
		const py = y + .5;
		for (let x = left; x < right; x += 1) {
			const px = x + .5;
			const u = ia * px + ic * py + ie;
			const v = ib * px + id * py + iff;
			if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
			const at = y * page.width + x;
			if (!picture) {
				page.gray[at] = fill;
				continue;
			}
			const fx = Math.min(width - 1, Math.max(0, u * width - .5));
			const fy = Math.min(height - 1, Math.max(0, (1 - v) * height - .5));
			const x1 = Math.floor(fx);
			const y1 = Math.floor(fy);
			const x2 = Math.min(width - 1, x1 + 1);
			const y2 = Math.min(height - 1, y1 + 1);
			const tx = fx - x1;
			const ty = fy - y1;
			const w1 = (1 - tx) * (1 - ty);
			const w2 = tx * (1 - ty);
			const w3 = (1 - tx) * ty;
			const w4 = tx * ty;
			const p1 = y1 * width + x1;
			const p2 = y1 * width + x2;
			const p3 = y2 * width + x1;
			const p4 = y2 * width + x2;
			const cover = alpha[p1] * w1 + alpha[p2] * w2 + alpha[p3] * w3 + alpha[p4] * w4;
			if (!cover) continue;
			const ink = fill ?? (gray[p1] * alpha[p1] * w1 + gray[p2] * alpha[p2] * w2 + gray[p3] * alpha[p3] * w3 + gray[p4] * alpha[p4] * w4) / cover;
			const share = cover / 255;
			page.gray[at] = Math.round(page.gray[at] * (1 - share) + ink * share);
		}
	}
}
function axisSamples(from, to, scale, offset, size, flip) {
	const first = new Int32Array(to - from);
	const second = new Int32Array(to - from);
	const weight = new Float32Array(to - from);
	for (let index = 0; index < to - from; index += 1) {
		const unit = scale * (from + index + .5) + offset;
		if (unit < 0 || unit >= 1) {
			first[index] = -1;
			continue;
		}
		const position = Math.min(size - 1, Math.max(0, (flip ? 1 - unit : unit) * size - .5));
		first[index] = Math.floor(position);
		second[index] = Math.min(size - 1, first[index] + 1);
		weight[index] = position - first[index];
	}
	return {
		first,
		second,
		weight
	};
}
function paintAligned(page, picture, { left, right, top, bottom, ia, id, ie, iff, fill }) {
	const { width, height, gray, alpha, opaque } = picture;
	const columns = axisSamples(left, right, ia, ie, width, false);
	const rows = axisSamples(top, bottom, id, iff, height, true);
	for (let y = top; y < bottom; y += 1) {
		const row = y - top;
		if (rows.first[row] < 0) continue;
		const r1 = rows.first[row] * width;
		const r2 = rows.second[row] * width;
		const ty = rows.weight[row];
		const out = y * page.width;
		for (let x = left; x < right; x += 1) {
			const column = x - left;
			const c1 = columns.first[column];
			if (c1 < 0) continue;
			const c2 = columns.second[column];
			const tx = columns.weight[column];
			const p1 = r1 + c1;
			const p2 = r1 + c2;
			const p3 = r2 + c1;
			const p4 = r2 + c2;
			if (opaque && fill === null) {
				const above = gray[p1] + (gray[p2] - gray[p1]) * tx;
				const below = gray[p3] + (gray[p4] - gray[p3]) * tx;
				page.gray[out + x] = Math.round(above + (below - above) * ty);
				continue;
			}
			const w1 = (1 - tx) * (1 - ty);
			const w2 = tx * (1 - ty);
			const w3 = (1 - tx) * ty;
			const w4 = tx * ty;
			const cover = alpha[p1] * w1 + alpha[p2] * w2 + alpha[p3] * w3 + alpha[p4] * w4;
			if (!cover) continue;
			const ink = fill ?? (gray[p1] * alpha[p1] * w1 + gray[p2] * alpha[p2] * w2 + gray[p3] * alpha[p3] * w3 + gray[p4] * alpha[p4] * w4) / cover;
			const share = cover / 255;
			page.gray[out + x] = Math.round(page.gray[out + x] * (1 - share) + ink * share);
		}
	}
}
function extent(full) {
	const [x0, y0] = apply$1(full, 0, 0);
	const [x1, y1] = apply$1(full, 1, 0);
	const [x2, y2] = apply$1(full, 0, 1);
	return {
		across: Math.hypot(x1 - x0, y1 - y0),
		down: Math.hypot(x2 - x0, y2 - y0)
	};
}
async function pageImage(pdfjs, page) {
	const operatorList = await page.getOperatorList({ annotationMode: pdfjs.AnnotationMode?.DISABLE });
	const draws = placements(pdfjs.OPS, operatorList);
	if (!draws.length) return null;
	const base = page.getViewport({ scale: 1 });
	const pictures = await Promise.all(draws.map((draw) => draw.solid !== void 0 ? null : resolve(page, draw.image ?? (typeof draw.mask?.data === "string" ? draw.mask.data : draw.mask))));
	let density = 1;
	for (const [index, draw] of draws.entries()) {
		const decoded = pictures[index];
		if (!decoded?.width) continue;
		const size = extent(multiply(base.transform, draw.matrix));
		if (size.across * size.down < base.width * base.height * .05) continue;
		density = Math.max(density, Math.min((draw.region?.w ?? decoded.width) / Math.max(1, size.across), (draw.region?.h ?? decoded.height) / Math.max(1, size.down)));
	}
	const scale = Math.min(density, Math.sqrt(MAX_PIXELS / (base.width * base.height)), MAX_EDGE / Math.max(base.width, base.height));
	const viewport = page.getViewport({ scale });
	const bitmap = {
		width: Math.max(1, Math.ceil(viewport.width)),
		height: Math.max(1, Math.ceil(viewport.height))
	};
	bitmap.gray = new Uint8Array(bitmap.width * bitmap.height).fill(255);
	let painted = false;
	for (const [index, draw] of draws.entries()) {
		const full = multiply(viewport.transform, draw.matrix);
		if (draw.solid !== void 0) {
			paint(bitmap, full, null, { fill: draw.solid });
			painted = true;
			continue;
		}
		const decoded = pictures[index];
		const mask = Boolean(draw.mask);
		const image = mask ? {
			...draw.mask,
			...decoded ?? {},
			kind: 1
		} : decoded;
		if (!image?.data || !image.width || !image.height) continue;
		if (!mask && ![
			1,
			2,
			3
		].includes(image.kind)) continue;
		const size = extent(full);
		paint(bitmap, full, shrink(image, {
			factor: Math.max(1, Math.floor(Math.min((draw.region?.w ?? image.width) / Math.max(1, size.across), (draw.region?.h ?? image.height) / Math.max(1, size.down)))),
			mask,
			region: draw.region
		}), { fill: mask ? draw.fill : null });
		painted = true;
	}
	if (!painted) return null;
	return {
		mime: "image/png",
		data: encodeGrayPng(bitmap.width, bitmap.height, bitmap.gray),
		width: bitmap.width,
		height: bitmap.height
	};
}
const CRC_TABLE = (/* @__PURE__ */ new Uint32Array(256)).map((_, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 3988292384 ^ value >>> 1 : value >>> 1;
	return value >>> 0;
});
function crc32(bytes) {
	let value = 4294967295;
	for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255] ^ value >>> 8;
	return (value ^ 4294967295) >>> 0;
}
function chunk(type, body) {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(body.length, 0);
	head.write(type, 4, "latin1");
	const tail = Buffer.alloc(4);
	tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
	return Buffer.concat([
		head,
		body,
		tail
	]);
}
function encodeGrayPng(width, height, gray) {
	const raw = Buffer.alloc((width + 1) * height);
	for (let y = 0; y < height; y += 1) {
		const out = y * (width + 1);
		raw[out] = 2;
		for (let x = 0; x < width; x += 1) raw[out + 1 + x] = gray[y * width + x] - (y ? gray[(y - 1) * width + x] : 0) & 255;
	}
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 0;
	return Buffer.concat([
		Buffer.from([
			137,
			80,
			78,
			71,
			13,
			10,
			26,
			10
		]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0))
	]);
}
//#endregion
//#region src/host/web-fetch.js
const LOCAL_ADDRESS_MESSAGE = "Local network addresses are not supported";
var AddressError = class extends Error {
	constructor(message = LOCAL_ADDRESS_MESSAGE) {
		super(message);
		this.name = "AddressError";
		this.code = "bad-url";
	}
};
const V4_BLOCKED = [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4]
].map(([base, bits]) => [v4Number(base), bits]);
const V6_BLOCKED = [
	["fc00::", 7],
	["fe80::", 10],
	["fec0::", 10],
	["ff00::", 8],
	["100::", 64],
	["64:ff9b:1::", 48],
	["2001::", 32],
	["2001:2::", 48],
	["2001:10::", 28],
	["2001:20::", 28],
	["2001:db8::", 32]
].map(([base, bits]) => [v6Bytes(base), bits]);
function v4Number(address) {
	const parts = address.split(".").map(Number);
	return (parts[0] << 24 >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3] >>> 0;
}
function v4Public(address) {
	const value = v4Number(address);
	return !V4_BLOCKED.some(([base, bits]) => bits === 0 ? true : value >>> 32 - bits === base >>> 32 - bits);
}
function v6Bytes(address) {
	let text = String(address).toLowerCase();
	const zone = text.indexOf("%");
	if (zone >= 0) text = text.slice(0, zone);
	const groups = [];
	const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/u);
	if (dotted) {
		const value = v4Number(dotted[1]);
		text = `${text.slice(0, -dotted[1].length)}${(value >>> 16).toString(16)}:${(value & 65535).toString(16)}`;
	}
	const [head, tail] = text.includes("::") ? text.split("::") : [text, null];
	const left = head ? head.split(":") : [];
	const right = tail ? tail.split(":") : [];
	const fill = tail === null ? 0 : 8 - left.length - right.length;
	for (const group of [
		...left,
		...Array(Math.max(0, fill)).fill("0"),
		...right
	]) groups.push(Number.parseInt(group || "0", 16));
	const bytes = /* @__PURE__ */ new Uint8Array(16);
	groups.slice(0, 8).forEach((group, index) => {
		bytes[index * 2] = group >> 8 & 255;
		bytes[index * 2 + 1] = group & 255;
	});
	return bytes;
}
function prefixMatches(bytes, base, bits) {
	for (let bit = 0; bit < bits; bit += 8) {
		const mask = 255 << 8 - Math.min(8, bits - bit) & 255;
		if ((bytes[bit / 8] & mask) !== (base[bit / 8] & mask)) return false;
	}
	return true;
}
const embeddedV4 = (bytes, at) => `${bytes[at]}.${bytes[at + 1]}.${bytes[at + 2]}.${bytes[at + 3]}`;
function v6Public(address) {
	const bytes = v6Bytes(address);
	const zeros = (count) => bytes.subarray(0, count).every((byte) => byte === 0);
	if (zeros(12) || zeros(10) && bytes[10] === 255 && bytes[11] === 255) return v4Public(embeddedV4(bytes, 12));
	if (prefixMatches(bytes, v6Bytes("64:ff9b::"), 96)) return v4Public(embeddedV4(bytes, 12));
	if (bytes[0] === 32 && bytes[1] === 2) return v4Public(embeddedV4(bytes, 2));
	return !V6_BLOCKED.some(([base, bits]) => prefixMatches(bytes, base, bits));
}
function isPublicAddress(address) {
	const value = String(address ?? "").replace(/^\[|\]$/gu, "");
	const family = isIP(value.split("%")[0]);
	if (family === 4) return v4Public(value);
	if (family === 6) return v6Public(value);
	return false;
}
const LOCAL_NAME = /(^|\.)(localhost|local|internal|home\.arpa)$/u;
function assertPublicHostname(hostname) {
	const host = String(hostname ?? "").replace(/^\[|\]$/gu, "").replace(/\.+$/u, "").toLowerCase();
	if (!host) throw new AddressError("This is not a valid web address");
	if (isIP(host)) {
		if (!isPublicAddress(host)) throw new AddressError();
		return true;
	}
	if (LOCAL_NAME.test(host) || !host.includes(".")) throw new AddressError();
	return false;
}
function createGuardedLookup({ resolve = lookup, allowed = isPublicAddress } = {}) {
	return function guardedLookup(hostname, options, callback) {
		const done = typeof options === "function" ? options : callback;
		const wanted = typeof options === "object" && options ? options : {};
		resolve(hostname, { all: true }, (error, addresses) => {
			if (error) return done(error);
			const list = (Array.isArray(addresses) ? addresses : []).map((entry) => typeof entry === "string" ? {
				address: entry,
				family: isIP(entry)
			} : entry).filter((entry) => entry?.address);
			if (!list.length) return done(Object.assign(/* @__PURE__ */ new Error(`No address for ${hostname}`), { code: "ENOTFOUND" }));
			if (list.some((entry) => !allowed(entry.address))) return done(new AddressError());
			const family = wanted.family === 4 || wanted.family === 6 ? wanted.family : 0;
			const usable = family ? list.filter((entry) => entry.family === family) : list;
			const chosen = usable.length ? usable : list;
			if (wanted.all) return done(null, chosen.map((entry) => ({
				address: entry.address,
				family: entry.family
			})));
			return done(null, chosen[0].address, chosen[0].family);
		});
	};
}
const EMPTY_BODY_STATUS = /* @__PURE__ */ new Set([
	101,
	204,
	205,
	304
]);
function decoded(response) {
	const encoding = String(response.headers["content-encoding"] ?? "").trim().toLowerCase();
	const decoder = encoding === "gzip" || encoding === "x-gzip" ? zlib.createGunzip() : encoding === "deflate" ? zlib.createInflate() : encoding === "br" ? zlib.createBrotliDecompress() : null;
	if (!decoder) return response;
	return pipeline(response, decoder, () => void 0);
}
function toHeaders(raw) {
	const headers = new Headers();
	for (const [name, value] of Object.entries(raw ?? {})) {
		if (name === "content-encoding" || name === "content-length" || value === void 0) continue;
		for (const entry of Array.isArray(value) ? value : [value]) try {
			headers.append(name, String(entry));
		} catch {}
	}
	return headers;
}
function createGuardedFetch({ resolve, allowed = isPublicAddress, maxBytes = 64 * 1024 * 1024 } = {}) {
	const lookup = createGuardedLookup({
		resolve,
		allowed
	});
	return function guardedFetch(input, { headers = {}, signal } = {}) {
		return new Promise((fulfil, reject) => {
			let target;
			try {
				target = input instanceof URL ? input : new URL(String(input));
				if (target.protocol !== "http:" && target.protocol !== "https:") throw new AddressError("Only http and https addresses are supported");
				const literal = target.hostname.replace(/^\[|\]$/gu, "");
				if (isIP(literal) && !allowed(literal)) throw new AddressError();
			} catch (error) {
				reject(error);
				return;
			}
			const transport = target.protocol === "https:" ? https : http;
			let settled = false;
			const fail = (error) => {
				if (settled) return;
				settled = true;
				reject(error);
			};
			const request = transport.request(target, {
				method: "GET",
				agent: false,
				lookup,
				signal,
				headers: {
					...headers,
					"accept-encoding": "gzip, deflate, br"
				}
			}, (response) => {
				const status = response.statusCode ?? 0;
				if (status < 200 || status > 599) {
					response.resume();
					fail(Object.assign(/* @__PURE__ */ new Error(`Unexpected status ${status}`), { code: "EBADSTATUS" }));
					return;
				}
				if (status >= 300 && status < 400 || EMPTY_BODY_STATUS.has(status)) {
					response.resume();
					settled = true;
					fulfil(new Response(null, {
						status,
						headers: toHeaders(response.headers)
					}));
					return;
				}
				const body = decoded(response);
				const parts = [];
				let size = 0;
				body.on("data", (chunk) => {
					if (settled) return;
					size += chunk.length;
					if (size > maxBytes) {
						request.destroy();
						body.destroy?.();
						fail(Object.assign(/* @__PURE__ */ new Error("Response too large"), { code: "ETOOLARGE" }));
						return;
					}
					parts.push(chunk);
				});
				body.on("error", fail);
				body.on("end", () => {
					if (settled) return;
					settled = true;
					fulfil(new Response(Buffer.concat(parts), {
						status,
						headers: toHeaders(response.headers)
					}));
				});
			});
			request.on("error", fail);
			request.end();
		});
	};
}
createGuardedFetch();
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
const MAX_TEXT_CHARS = 2e6;
const CHUNK_CHARS = 1600;
const FETCH_TIMEOUT_MS = 2e4;
const MAX_PAGE_BYTES = 6 * 1024 * 1024;
const MIN_PAGE_TEXT = 30;
const TEXT_PER_PICTURE = 150;
const MIN_PICTURE_BYTES = 2048;
const PICTURE_TYPES = Object.freeze({
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp"
});
const pageFetch = createGuardedFetch({ maxBytes: MAX_UPLOAD_BYTES });
var MaterialError = class extends Error {
	constructor(code, message) {
		super(message);
		this.name = "MaterialError";
		this.code = code;
	}
};
const IMAGE_TYPES = Object.freeze({
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif"
});
function detectKind(name, bytes) {
	const lower = String(name ?? "").toLowerCase();
	const head = bytes?.subarray?.(0, 8) ?? Buffer.alloc(0);
	if (head.subarray(0, 5).toString("latin1") === "%PDF-" || lower.endsWith(".pdf")) return "pdf";
	if (lower.endsWith(".docx")) return "docx";
	if (lower.endsWith(".pptx")) return "pptx";
	if (/\.(md|markdown)$/u.test(lower)) return "markdown";
	if (/\.(txt|text|csv|tsv|json|tex|py|js|ts|java|c|cpp|rs|go|rb|sql|html?)$/u.test(lower)) return "text";
	const extension = lower.split(".").pop();
	if (IMAGE_TYPES[extension]) return "image";
	if (head[0] === 137 && head[1] === 80) return "image";
	if (head[0] === 255 && head[1] === 216) return "image";
	if (head.subarray(0, 2).toString("latin1") === "PK") {
		if (lower.endsWith(".doc") || lower.endsWith(".ppt")) throw new MaterialError("old-office", "Old .doc/.ppt files are not supported; save as .docx/.pptx");
	}
	throw new MaterialError("unsupported", "This file type is not supported");
}
function imageMime(name, bytes) {
	const extension = String(name ?? "").toLowerCase().split(".").pop();
	if (IMAGE_TYPES[extension]) return IMAGE_TYPES[extension];
	if (bytes?.[0] === 137) return "image/png";
	if (bytes?.[0] === 255) return "image/jpeg";
	return "image/png";
}
function decodeText(bytes) {
	let textValue = new TextDecoder("utf-8").decode(bytes);
	if ((textValue.match(/�/gu) ?? []).length > Math.max(4, textValue.length / 200)) try {
		textValue = new TextDecoder("gb18030").decode(bytes);
	} catch {}
	return textValue.replace(/^﻿/u, "").replace(/\r\n?/gu, "\n");
}
const RADICAL_SUPPLEMENT = Object.freeze({
	"⺌": "小",
	"⺍": "小",
	"⺕": "彐",
	"⺟": "母",
	"⺠": "民",
	"⺮": "竹",
	"⺶": "羊",
	"⻁": "虎",
	"⻄": "西",
	"⻅": "见",
	"⻆": "角",
	"⻈": "讠",
	"⻉": "贝",
	"⻊": "足",
	"⻋": "车",
	"⻓": "长",
	"⻔": "门",
	"⻗": "雨",
	"⻘": "青",
	"⻙": "韦",
	"⻚": "页",
	"⻛": "风",
	"⻜": "飞",
	"⻝": "食",
	"⻠": "饣",
	"⻢": "马",
	"⻣": "骨",
	"⻤": "鬼",
	"⻥": "鱼",
	"⻦": "鸟",
	"⻧": "卤",
	"⻨": "麦",
	"⻩": "黄",
	"⻪": "黾",
	"⻫": "齐",
	"⻬": "齐",
	"⻭": "齿",
	"⻮": "齿",
	"⻯": "龙",
	"⻰": "龙",
	"⻲": "龟",
	"⻳": "龟"
});
function fixCjkRadicals(value) {
	return String(value ?? "").replace(/[⼀-⿟]/gu, (char) => char.normalize("NFKC")).replace(/[⺀-⻿]/gu, (char) => RADICAL_SUPPLEMENT[char] ?? char);
}
function cleanText(value) {
	return fixCjkRadicals(value).replace(/\u0000/gu, "").replace(/[ \t ]+/gu, " ").replace(/ *\n */gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
}
function chunkText(value, where = {}) {
	const textValue = cleanText(value);
	if (!textValue) return [];
	const chunks = [];
	let rest = textValue;
	let part = 1;
	while (rest.length) {
		let cut = rest.length;
		if (rest.length > CHUNK_CHARS) {
			const window = rest.slice(0, CHUNK_CHARS);
			const paragraph = window.lastIndexOf("\n\n");
			const sentence = Math.max(window.lastIndexOf("。"), window.lastIndexOf(". "), window.lastIndexOf("！"), window.lastIndexOf("？"));
			cut = paragraph > CHUNK_CHARS * .5 ? paragraph : sentence > CHUNK_CHARS * .5 ? sentence + 1 : CHUNK_CHARS;
		}
		chunks.push({
			...where,
			part,
			text: rest.slice(0, cut).trim()
		});
		rest = rest.slice(cut).trim();
		part += 1;
	}
	return chunks.filter((chunk) => chunk.text);
}
function finish(kind, title, chunks, extra = {}) {
	let total = 0;
	const kept = [];
	for (const chunk of chunks) {
		if (total + chunk.text.length > MAX_TEXT_CHARS) break;
		total += chunk.text.length;
		kept.push({
			id: `c${kept.length + 1}`,
			...chunk
		});
	}
	return {
		kind,
		title,
		chunks: kept,
		chars: total,
		truncated: kept.length < chunks.length,
		...extra
	};
}
const visibleLength = (value) => String(value ?? "").replace(/\s+/gu, "").length;
async function readPictures(recognize, sources) {
	if (!sources.length) return {
		texts: [],
		note: null,
		available: true,
		error: null
	};
	const tried = sources.slice(0, 200);
	const results = recognize ? await recognize(tried) : null;
	if (!results) return {
		texts: [],
		note: { unread: sources.length },
		available: false,
		error: null
	};
	const error = results.find((result) => result?.error)?.error ?? null;
	const failed = tried.filter((source, index) => results[index]?.error).map((source) => source.where);
	return {
		texts: tried.map((source, index) => results[index]?.text ?? ""),
		note: {
			read: results.filter((result) => result && !result.error).length,
			failed,
			reason: error?.code ?? null,
			left: sources.length - tried.length
		},
		available: true,
		error
	};
}
function resolvePart(base, target) {
	const parts = target.startsWith("/") ? [] : base.split("/").filter(Boolean);
	for (const piece of target.split("/")) if (piece === "..") parts.pop();
	else if (piece && piece !== ".") parts.push(piece);
	return parts.join("/");
}
async function partPictures(zip, part) {
	const slash = part.lastIndexOf("/");
	const folder = part.slice(0, slash);
	const xml = await zip.file(part)?.async("string") ?? "";
	const rels = await zip.file(`${folder}/_rels/${part.slice(slash + 1)}.rels`)?.async("string") ?? "";
	const targets = /* @__PURE__ */ new Map();
	for (const [, attributes] of rels.matchAll(/<Relationship\b([^>]*)>/gu)) {
		const id = /\bId="([^"]+)"/u.exec(attributes)?.[1];
		const target = /\bTarget="([^"]+)"/u.exec(attributes)?.[1];
		if (!id || !target || !/\bType="[^"]*\/image"/u.test(attributes) || /\bTargetMode="External"/u.test(attributes)) continue;
		targets.set(id, resolvePart(folder, decodeXml(target)));
	}
	const seen = /* @__PURE__ */ new Set();
	const pictures = [];
	for (const [, id] of xml.matchAll(/\br:(?:embed|id)="([^"]+)"/gu)) {
		const path = targets.get(id);
		if (!path || seen.has(path)) continue;
		seen.add(path);
		const mime = PICTURE_TYPES[path.split(".").pop().toLowerCase()];
		const file = zip.file(path);
		if (!mime || !file) continue;
		const data = await file.async("nodebuffer");
		if (data.length >= MIN_PICTURE_BYTES && data.length <= 10485760) pictures.push({
			mime,
			data
		});
	}
	return pictures;
}
let pdfjsModule;
async function loadPdfjs() {
	pdfjsModule ??= import("pdfjs-dist/legacy/build/pdf.mjs");
	return pdfjsModule;
}
function pdfjsAssetUrls(root, { join: joinPath = join } = {}) {
	return {
		cMapUrl: `${joinPath(root, "cmaps")}/`,
		standardFontDataUrl: `${joinPath(root, "standard_fonts")}/`,
		wasmUrl: `${joinPath(root, "wasm")}/`
	};
}
function pdfjsAssets() {
	return pdfjsAssetUrls(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")));
}
async function extractPdf(bytes, { signal, recognize } = {}) {
	const pdfjs = await loadPdfjs();
	const { cMapUrl, standardFontDataUrl, wasmUrl } = pdfjsAssets();
	const task = pdfjs.getDocument({
		data: new Uint8Array(bytes),
		cMapUrl,
		cMapPacked: true,
		standardFontDataUrl,
		wasmUrl,
		maxImageSize: 1e8,
		isEvalSupported: false,
		disableFontFace: true,
		useSystemFonts: false,
		verbosity: 0
	});
	let doc;
	try {
		doc = await task.promise;
	} catch (error) {
		if (error?.name === "PasswordException") throw new MaterialError("encrypted", "This PDF is password protected");
		throw new MaterialError("unreadable", "This PDF could not be read");
	}
	try {
		let title = "";
		try {
			const meta = await doc.getMetadata();
			title = String(meta?.info?.Title ?? "").trim();
		} catch {}
		const texts = [];
		for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
			signal?.throwIfAborted();
			const page = await doc.getPage(pageNumber);
			const content = await page.getTextContent();
			let pageText = "";
			for (const item of content.items) {
				if (typeof item.str !== "string") continue;
				pageText += item.str;
				pageText += item.hasEOL ? "\n" : "";
			}
			page.cleanup();
			texts.push(pageText);
		}
		const pictured = texts.flatMap((pageText, index) => visibleLength(pageText) < MIN_PAGE_TEXT ? [index + 1] : []);
		const read = await readPictures(recognize, pictured.map((pageNumber) => ({
			where: { page: pageNumber },
			image: async () => {
				signal?.throwIfAborted();
				const page = await doc.getPage(pageNumber);
				try {
					return await pageImage(pdfjs, page);
				} finally {
					page.cleanup();
				}
			}
		})));
		if (pictured.length === doc.numPages && !read.note?.read) {
			if (!read.available) throw new MaterialError("scan-needs-vision", "This PDF is a scan; reading it needs a model that can see images");
			throw read.error ?? new MaterialError("no-text", "No text found in this PDF");
		}
		const recognized = new Map(pictured.slice(0, read.texts.length).map((pageNumber, index) => [pageNumber, read.texts[index]]));
		const chunks = texts.flatMap((pageText, index) => chunkText([pageText, recognized.get(index + 1)].filter(Boolean).join("\n\n"), { page: index + 1 }));
		if (!chunks.length) throw read.error ?? new MaterialError("no-text", "No text found in this PDF");
		return {
			title,
			pages: doc.numPages,
			chunks,
			ocr: read.note
		};
	} finally {
		await Promise.resolve(task.destroy?.()).catch(() => void 0);
	}
}
async function extractDocx(bytes, { recognize } = {}) {
	const mammoth = await import("mammoth");
	const extract = mammoth.extractRawText ?? mammoth.default?.extractRawText;
	let result;
	try {
		result = await extract({ buffer: Buffer.from(bytes) });
	} catch {
		throw new MaterialError("unreadable", "This Word document could not be read");
	}
	const own = String(result?.value ?? "");
	const sections = own.split(/\n{2,}/u);
	const chunks = [];
	let buffer = "";
	let section = 1;
	for (const paragraph of sections) {
		if ((buffer + paragraph).length > CHUNK_CHARS && buffer) {
			chunks.push(...chunkText(buffer, { section: `§${section}` }));
			section += 1;
			buffer = "";
		}
		buffer += `${paragraph}\n\n`;
	}
	if (buffer.trim()) {
		chunks.push(...chunkText(buffer, { section: `§${section}` }));
		section += 1;
	}
	const JSZip = (await import("jszip")).default;
	const pictures = await partPictures(await JSZip.loadAsync(bytes), "word/document.xml");
	let note = null;
	if (pictures.length && visibleLength(own) < TEXT_PER_PICTURE * pictures.length) {
		const read = await readPictures(recognize, pictures.map((picture, index) => ({
			where: { picture: index + 1 },
			image: async () => picture
		})));
		if (!read.note?.read && visibleLength(own) < MIN_PAGE_TEXT) {
			if (!read.available) throw new MaterialError("pictures-need-vision", "This document is pictures; reading them needs a model that can see images");
			throw read.error ?? new MaterialError("no-text", "No text found in this document");
		}
		for (const [index, pictureText] of read.texts.entries()) chunks.push(...chunkText(pictureText, { section: `§${section + index}` }));
		if (!chunks.length) throw read.error ?? new MaterialError("no-text", "No text found in this document");
		note = read.note;
	}
	if (!chunks.length) throw new MaterialError("no-text", "No text found in this document");
	return {
		chunks,
		ocr: note
	};
}
const XML_ENTITIES = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: "\"",
	apos: "'"
};
function decodeXml(value) {
	return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (_, entity) => {
		if (entity[0] === "#") return String.fromCodePoint(entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
		return XML_ENTITIES[entity.toLowerCase()] ?? "";
	});
}
function slideText(xml) {
	return xml.split(/<\/a:p>/u).map((paragraph) => {
		return [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/gu)].map((match) => decodeXml(match[1])).join("");
	}).filter((line) => line.trim()).join("\n");
}
async function extractPptx(bytes, { recognize } = {}) {
	const JSZip = (await import("jszip")).default;
	let zip;
	try {
		zip = await JSZip.loadAsync(bytes);
	} catch {
		throw new MaterialError("unreadable", "This PowerPoint file could not be read");
	}
	const slideNumber = (name) => Number(/(\d+)\.xml$/u.exec(name)?.[1] ?? 0);
	const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name)).sort((a, b) => slideNumber(a) - slideNumber(b));
	const texts = [];
	const sources = [];
	let written = 0;
	for (const name of slides) {
		const number = slideNumber(name);
		const body = slideText(await zip.file(name).async("string"));
		const notesFile = zip.file(`ppt/notesSlides/notesSlide${number}.xml`);
		const notes = notesFile ? slideText(await notesFile.async("string")) : "";
		texts.push({
			number,
			text: notes ? `${body}\n[notes] ${notes}` : body
		});
		if (visibleLength(body) < MIN_PAGE_TEXT) for (const picture of await partPictures(zip, name)) sources.push({
			where: { slide: number },
			image: async () => picture
		});
		else written += 1;
	}
	const read = await readPictures(recognize, sources);
	if (sources.length && !written && !read.note?.read) {
		if (!read.available) throw new MaterialError("pictures-need-vision", "These slides are pictures; reading them needs a model that can see images");
		throw read.error ?? new MaterialError("no-text", "No text found in these slides");
	}
	const pictured = /* @__PURE__ */ new Map();
	for (const [index, pictureText] of read.texts.entries()) {
		const { slide } = sources[index].where;
		pictured.set(slide, [pictured.get(slide), pictureText].filter(Boolean).join("\n\n"));
	}
	const chunks = texts.flatMap(({ number, text }) => chunkText([text, pictured.get(number)].filter(Boolean).join("\n\n"), { slide: number }));
	if (!chunks.length) throw read.error ?? new MaterialError("no-text", "No text found in these slides");
	return {
		slides: slides.length,
		chunks,
		ocr: read.note
	};
}
function extractPlain(bytes, kind) {
	const value = decodeText(bytes);
	const chunks = [];
	if (kind === "markdown") {
		const parts = value.split(/\n(?=#{1,3}\s)/u);
		for (const part of parts) {
			const heading = /^#{1,3}\s+(.+)/u.exec(part)?.[1]?.trim();
			chunks.push(...chunkText(part, heading ? { section: heading.slice(0, 80) } : {}));
		}
	} else chunks.push(...chunkText(value, {}));
	if (!chunks.length) throw new MaterialError("empty", "This file is empty");
	return {
		title: kind === "markdown" ? /^#\s+(.+)$/mu.exec(value)?.[1]?.trim() ?? "" : "",
		chunks
	};
}
async function ingestFile({ name, bytes, signal, recognize }) {
	if (!bytes?.length) throw new MaterialError("empty", "The file is empty");
	if (bytes.length > 209715200) throw new MaterialError("too-large", `The file is larger than 200 MB`);
	const kind = detectKind(name, bytes);
	const baseTitle = String(name ?? "").replace(/\.[^.]+$/u, "").slice(0, 120) || "Untitled";
	if (kind === "image") {
		if (bytes.length > 10485760) throw new MaterialError("image-too-large", "Images must be smaller than 10 MB");
		const mime = imageMime(name, bytes);
		const read = await readPictures(recognize, [{
			where: { picture: 1 },
			image: async () => ({
				mime,
				data: Buffer.from(bytes)
			})
		}]);
		return finish(kind, baseTitle, chunkText(read.texts[0] ?? "", {}), {
			mime,
			...read.available ? { ocr: read.note } : {}
		});
	}
	if (kind === "pdf") {
		const result = await extractPdf(bytes, {
			signal,
			recognize
		});
		return finish(kind, result.title || baseTitle, result.chunks, {
			pages: result.pages,
			ocr: result.ocr
		});
	}
	if (kind === "docx") {
		const result = await extractDocx(bytes, { recognize });
		return finish(kind, baseTitle, result.chunks, { ocr: result.ocr });
	}
	if (kind === "pptx") {
		const result = await extractPptx(bytes, { recognize });
		return finish(kind, baseTitle, result.chunks, {
			slides: result.slides,
			ocr: result.ocr
		});
	}
	const result = extractPlain(bytes, kind);
	return finish(kind, result.title || baseTitle, result.chunks);
}
function checkPublicUrl(value) {
	let url;
	try {
		url = new URL(String(value).trim());
	} catch {
		throw new MaterialError("bad-url", "This is not a valid web address");
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") throw new MaterialError("bad-url", "Only http and https addresses are supported");
	if (url.username || url.password) throw new MaterialError("bad-url", "Addresses with credentials are not supported");
	try {
		assertPublicHostname(url.hostname);
	} catch (error) {
		throw new MaterialError("bad-url", error.message);
	}
	return url;
}
async function ingestUrl(address, { fetchImpl = pageFetch, signal, recognize } = {}) {
	let url = checkPublicUrl(address);
	let response;
	for (let hop = 0; hop < 6; hop += 1) {
		const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
		try {
			response = await fetchImpl(url, {
				redirect: "manual",
				headers: {
					"User-Agent": "Mozilla/5.0 (dsh-aha-tutor)",
					Accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5"
				},
				signal: signal ? AbortSignal.any([signal, timeout]) : timeout
			});
		} catch (error) {
			if (signal?.aborted) throw signal.reason ?? error;
			if (error?.name === "AddressError") throw new MaterialError("bad-url", error.message);
			if (error?.code === "ETOOLARGE") throw new MaterialError("page-too-large", "The page is too large");
			throw new MaterialError("network", timeout.aborted ? "The page took too long to load" : "The page could not be loaded");
		}
		if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
			url = checkPublicUrl(new URL(response.headers.get("location"), url).href);
			continue;
		}
		break;
	}
	if (!response?.ok) throw new MaterialError("http", `The page returned an error (${response?.status ?? "redirect loop"})`);
	const type = String(response.headers.get("content-type") ?? "").toLowerCase();
	const bytes = Buffer.from(await response.arrayBuffer());
	if (bytes.length > MAX_PAGE_BYTES && !type.includes("pdf")) throw new MaterialError("page-too-large", "The page is too large");
	if (type.includes("application/pdf") || bytes.subarray(0, 5).toString("latin1") === "%PDF-") return {
		...await ingestFile({
			name: `${url.pathname.split("/").pop() || "page"}.pdf`,
			bytes,
			signal,
			recognize
		}),
		kind: "url",
		url: url.href
	};
	if (type.startsWith("text/plain")) {
		const result = extractPlain(bytes, "text");
		return finish("url", url.hostname, result.chunks, { url: url.href });
	}
	const html = decodeText(bytes);
	const { parseHTML } = await import("linkedom");
	const { Readability } = await import("@mozilla/readability");
	const { document } = parseHTML(html);
	let article = null;
	try {
		article = new Readability(document, { charThreshold: 200 }).parse();
	} catch {
		article = null;
	}
	const title = String(article?.title || document.querySelector("title")?.textContent || url.hostname).trim().slice(0, 160);
	const chunks = chunkText(article?.textContent || document.body?.textContent || "", { section: url.hostname });
	if (!chunks.length) throw new MaterialError("page-no-text", "No readable text on this page");
	return finish("url", title, chunks, { url: url.href });
}
const BYTES_PER_SECOND = 32e3;
const MAX_SPEECH_BYTES = 3840044;
const MAX_TEXT = 2e3;
const USABLE = /* @__PURE__ */ new Set(["ready", "standby"]);
const PREPARING = /* @__PURE__ */ new Set([
	"checking",
	"downloading",
	"cancelling"
]);
function wavSeconds(bytes) {
	const data = bytes instanceof Uint8Array ? bytes : null;
	if (!data || data.length < 46) return null;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const tag = (at) => String.fromCharCode(...data.subarray(at, at + 4));
	return tag(0) === "RIFF" && tag(8) === "WAVE" && tag(12) === "fmt " && tag(36) === "data" && view.getUint32(4, true) === data.length - 8 && view.getUint32(16, true) === 16 && view.getUint16(20, true) === 1 && view.getUint16(22, true) === 1 && view.getUint32(24, true) === 16e3 && view.getUint32(28, true) === BYTES_PER_SECOND && view.getUint16(32, true) === 2 && view.getUint16(34, true) === 16 && view.getUint32(40, true) === data.length - 44 && (data.length - 44) % 2 === 0 ? (data.length - 44) / BYTES_PER_SECOND : null;
}
function createSpeechInput({ getSpeech, logger }) {
	function status() {
		const speech = getSpeech();
		let snapshot = null;
		try {
			snapshot = speech?.snapshot?.() ?? null;
		} catch {
			snapshot = null;
		}
		const chosen = snapshot?.selection?.providerId;
		const provider = snapshot?.providers?.find((entry) => entry.id === chosen);
		if (!provider) return {
			state: "off",
			maxSeconds: 120
		};
		const phase = provider.preparation?.phase ?? "ready";
		return {
			state: USABLE.has(phase) ? "ready" : PREPARING.has(phase) ? "preparing" : phase === "failed" ? "failed" : "unprepared",
			maxSeconds: 120
		};
	}
	async function transcribe({ audio, signal }) {
		const { state } = status();
		if (state === "off") throw new TutorError("speech-off", "Voice input is not enabled in DSH");
		if (state !== "ready") throw new TutorError("speech-unprepared", "The speech recognizer is not ready yet");
		const seconds = wavSeconds(audio);
		if (seconds === null) throw new TutorError("speech-audio", "The recording could not be read");
		if (seconds > 120) throw new TutorError("speech-too-long", `Recordings are limited to 120 seconds`);
		const speech = getSpeech();
		let result;
		try {
			result = await speech.transcribe(speech.resolve({ audio: Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength) }), signal ?? new AbortController().signal);
		} catch (error) {
			if (signal?.aborted) throw error;
			logger?.debug?.("aha-tutor speech recognition failed: %s", error?.message);
			throw new TutorError("speech-failed", "Speech recognition failed");
		}
		const text = String(typeof result === "string" ? result : result?.text ?? "").replace(/\s+/gu, " ").trim().slice(0, MAX_TEXT);
		if (!text) throw new TutorError("speech-empty", "No speech was heard");
		return { text };
	}
	return Object.freeze({
		status,
		transcribe
	});
}
//#endregion
//#region src/host/http.js
const UPLOAD_PATH = "/api/aha-tutor/upload";
const TTS_PATH = "/api/aha-tutor/tts";
const FONT_PATH = "/api/aha-tutor/font";
const SPEECH_PATH = "/api/aha-tutor/speech";
async function readCapped(stream, max, signal) {
	const parts = [];
	let size = 0;
	if (!stream) return Buffer.alloc(0);
	for await (const chunk of stream) {
		signal?.throwIfAborted();
		size += chunk.byteLength;
		if (size > max) return null;
		parts.push(Buffer.from(chunk));
	}
	return Buffer.concat(parts);
}
const json = (value, status = 200) => Response.json(value, {
	status,
	headers: { "cache-control": "no-store" }
});
const failure$1 = (code, message, status) => json({
	ok: false,
	error: {
		code: `aha-tutor/${code}`,
		message,
		details: {}
	}
}, status);
function uploadRoute({ studio }) {
	return {
		path: UPLOAD_PATH,
		methods: ["POST"],
		requestBody: "streaming",
		fetch: async (request) => {
			const name = new URL(request.url).searchParams.get("name") ?? "file";
			let bytes;
			try {
				bytes = await readCapped(request.body, MAX_UPLOAD_BYTES, request.signal);
			} catch {
				return failure$1("aborted", "Upload interrupted", 400);
			}
			if (bytes === null) return failure$1("too-large", `The file is larger than 200 MB`, 413);
			try {
				return json({
					ok: true,
					value: { job: studio.upload({
						name,
						bytes
					}) }
				});
			} catch (error) {
				return failure$1(publicCode(error), error?.name === "TutorError" ? error.message : "Upload failed", 400);
			}
		}
	};
}
function speechRoute({ speechInput }) {
	return {
		path: SPEECH_PATH,
		methods: ["POST"],
		requestBody: "streaming",
		fetch: async (request) => {
			let audio;
			try {
				audio = await readCapped(request.body, MAX_SPEECH_BYTES, request.signal);
			} catch {
				return failure$1("aborted", "Upload interrupted", 400);
			}
			if (audio === null) return failure$1("speech-too-long", "The recording is too long", 413);
			try {
				return json({
					ok: true,
					value: await speechInput.transcribe({
						audio: new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength),
						signal: request.signal
					})
				});
			} catch (error) {
				const known = error?.name === "TutorError";
				return failure$1(known ? publicCode(error) : "speech-failed", known ? error.message : "Speech recognition failed", known && error.code !== "speech-failed" ? 400 : 502);
			}
		}
	};
}
function ttsRoute({ speak }) {
	return {
		path: TTS_PATH,
		methods: ["POST"],
		requestBody: "buffered",
		fetch: async (request) => {
			let body;
			try {
				body = await request.json();
			} catch {
				return failure$1("invalid", "Invalid request", 400);
			}
			try {
				const result = await speak({
					text: String(body?.text ?? "").slice(0, 4e3),
					signal: request.signal
				});
				return new Response(result.audio, {
					status: 200,
					headers: {
						"content-type": result.mime,
						"cache-control": "no-store"
					}
				});
			} catch (error) {
				const known = error?.name === "TtsError" || error?.name === "TutorError";
				return failure$1(known ? publicCode(error) : "tts-failed", known ? error.message : "Speech synthesis failed", ["auth", "no-key"].includes(error?.code) ? 401 : 502);
			}
		}
	};
}
function fontsDir() {
	return join(dirname(createRequire(import.meta.url).resolve("dsh-aha-tutor/package.json")), "assets", "fonts");
}
const FONT_FILES = new Set(BOARD_FONT_FILES.map((entry) => entry.file));
function fontRoute({ dir = fontsDir() } = {}) {
	const loaded = /* @__PURE__ */ new Map();
	return {
		path: FONT_PATH,
		methods: ["GET"],
		requestBody: "buffered",
		fetch: async (request) => {
			const name = new URL(request.url).searchParams.get("f") ?? "";
			if (!FONT_FILES.has(name)) return new Response("Not found", { status: 404 });
			try {
				if (!loaded.has(name)) loaded.set(name, await readFile(join(dir, name)));
			} catch {
				return new Response("Not found", { status: 404 });
			}
			return new Response(loaded.get(name), {
				status: 200,
				headers: {
					"content-type": "font/woff2",
					"cache-control": "public, max-age=31536000, immutable"
				}
			});
		}
	};
}
//#endregion
//#region src/core/planner.js
const DAY_MS = 1440 * 60 * 1e3;
const HORIZON_DAYS = 400;
const REVIEW_SHARE = .3;
function toDay(date) {
	const value = date instanceof Date ? date : new Date(date);
	return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
function parseDay(day) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(day));
	if (!match) throw new TypeError(`invalid day "${day}"`);
	return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
function addDays(day, count) {
	const date = parseDay(day);
	date.setDate(date.getDate() + count);
	return toDay(date);
}
function daysBetween(fromDay, toDayValue) {
	return Math.round((parseDay(toDayValue) - parseDay(fromDay)) / DAY_MS);
}
function normalizeSettings(settings = {}) {
	const studyDays = Array.isArray(settings.studyDays) && settings.studyDays.length ? [...new Set(settings.studyDays.map(Number).filter((day) => day >= 0 && day <= 6))] : [
		1,
		2,
		3,
		4,
		5,
		6,
		0
	];
	const weeklyMinutes = clampNumber(settings.weeklyMinutes, 30, 6e3, 300);
	return {
		studyDays,
		weeklyMinutes,
		dailyMinutes: Math.max(15, Math.round(weeklyMinutes / studyDays.length))
	};
}
function clampNumber(value, min, max, fallback) {
	const number = Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.min(max, Math.max(min, number));
}
function buildPlan({ today, settings, courses = [], reviews = [], exams = [], spentToday = 0 }) {
	const start = today ?? toDay(/* @__PURE__ */ new Date());
	const { studyDays, weeklyMinutes, dailyMinutes } = normalizeSettings(settings);
	const queues = courses.map((course) => ({
		id: course.id,
		title: course.title,
		emoji: course.emoji || "",
		deadline: course.deadline || null,
		priority: Number(course.priority) || 0,
		remaining: (course.lessons || []).filter((lesson) => !lesson.done).map((lesson) => ({
			id: lesson.id,
			title: lesson.title,
			minutes: clampNumber(lesson.minutes, 5, 240, 20)
		})),
		finishDay: null
	})).filter((queue) => queue.remaining.length > 0);
	const pendingReviews = [...reviews].map((item) => ({
		...item,
		minutes: clampNumber(item.minutes, 2, 60, 5),
		dueDay: item.dueDay || start
	})).sort((a, b) => a.dueDay.localeCompare(b.dueDay));
	const days = [];
	let rotation = 0;
	for (let offset = 0; offset < HORIZON_DAYS; offset += 1) {
		const day = addDays(start, offset);
		const weekday = parseDay(day).getDay();
		const items = exams.filter((exam) => exam.day === day).map((exam) => ({
			kind: "exam",
			refId: exam.id,
			courseId: exam.courseId ?? null,
			title: exam.title,
			minutes: 0
		}));
		if (studyDays.includes(weekday)) {
			const spent = offset === 0 ? Math.max(0, Number(spentToday) || 0) : 0;
			let budget = dailyMinutes - spent;
			const reviewBudget = Math.min(Math.max(0, budget), Math.round(dailyMinutes * REVIEW_SHARE));
			let reviewUsed = 0;
			while (pendingReviews.length && pendingReviews[0].dueDay <= day && reviewUsed + pendingReviews[0].minutes <= reviewBudget) {
				const review = pendingReviews.shift();
				reviewUsed += review.minutes;
				items.push({
					kind: "review",
					refId: review.id,
					courseId: review.courseId ?? null,
					title: review.title,
					courseTitle: review.courseTitle ?? "",
					courseEmoji: review.courseEmoji ?? "",
					minutes: review.minutes
				});
			}
			budget -= reviewUsed;
			const ordered = orderQueues(queues, day, rotation);
			rotation += 1;
			let placed = true;
			while (budget > 0 && placed) {
				placed = false;
				for (const queue of ordered) {
					const lesson = queue.remaining[0];
					if (!lesson) continue;
					const dayIsEmpty = !spent && !items.some((item) => item.kind === "lesson");
					if (lesson.minutes <= budget || dayIsEmpty) {
						queue.remaining.shift();
						budget -= lesson.minutes;
						items.push({
							kind: "lesson",
							refId: lesson.id,
							courseId: queue.id,
							title: lesson.title,
							courseTitle: queue.title,
							courseEmoji: queue.emoji,
							minutes: lesson.minutes
						});
						if (queue.remaining.length === 0) queue.finishDay = day;
						placed = true;
						break;
					}
				}
			}
		}
		if (items.length) days.push({
			day,
			items,
			minutes: items.reduce((sum, item) => sum + item.minutes, 0)
		});
		if (!queues.some((queue) => queue.remaining.length) && !pendingReviews.length && !exams.some((exam) => exam.day > day)) break;
	}
	const warnings = [];
	return {
		start,
		weeklyMinutes,
		dailyMinutes,
		studyDays,
		days,
		courses: queues.map((queue) => {
			const summary = {
				courseId: queue.id,
				finishDay: queue.finishDay,
				deadline: queue.deadline,
				onTrack: true
			};
			if (queue.remaining.length) {
				summary.onTrack = false;
				warnings.push({
					kind: "beyond-horizon",
					courseId: queue.id
				});
			} else if (queue.deadline && queue.finishDay && queue.finishDay > queue.deadline) {
				summary.onTrack = false;
				summary.neededWeeklyMinutes = neededWeeklyMinutes(courses.find((course) => course.id === queue.id), start, queue.deadline, studyDays);
				warnings.push({
					kind: "deadline-at-risk",
					courseId: queue.id,
					finishDay: queue.finishDay,
					deadline: queue.deadline,
					neededWeeklyMinutes: summary.neededWeeklyMinutes
				});
			}
			return summary;
		}),
		warnings
	};
}
function orderQueues(queues, day, rotation) {
	const active = queues.filter((queue) => queue.remaining.length);
	if (!active.length) return [];
	return active.map((queue, index) => ({
		queue,
		turn: (index - rotation + active.length * 1e3) % active.length
	})).sort((a, b) => {
		const da = a.queue.deadline ?? "9999-12-31";
		const db = b.queue.deadline ?? "9999-12-31";
		if (da !== db) return da.localeCompare(db);
		if (a.queue.priority !== b.queue.priority) return b.queue.priority - a.queue.priority;
		return a.turn - b.turn;
	}).map((entry) => entry.queue);
}
function neededWeeklyMinutes(course, start, deadline, studyDays) {
	const remaining = (course?.lessons || []).filter((lesson) => !lesson.done).reduce((sum, lesson) => sum + clampNumber(lesson.minutes, 5, 240, 20), 0);
	const span = Math.max(1, daysBetween(start, deadline) + 1);
	let studyDayCount = 0;
	for (let offset = 0; offset < span; offset += 1) if (studyDays.includes(parseDay(addDays(start, offset)).getDay())) studyDayCount += 1;
	if (!studyDayCount) return null;
	const perDay = remaining / studyDayCount / (1 - REVIEW_SHARE);
	return Math.ceil(perDay * studyDays.length / 10) * 10;
}
const itemKey$1 = (item) => `${item.kind}:${item.refId}`;
function mergeAgenda(saved = [], planned = []) {
	const seen = new Set(saved.map(itemKey$1));
	return [...saved, ...planned.filter((item) => !seen.has(itemKey$1(item)))];
}
function planCalendar({ today, agenda = {}, plan, done = {}, checks = [], ahead = 120 }) {
	const lessonsDone = done.lessons ?? /* @__PURE__ */ new Map();
	const reviewsDone = done.reviews ?? /* @__PURE__ */ new Map();
	const last = addDays(today, ahead);
	const days = /* @__PURE__ */ new Map();
	const put = (day, item) => {
		const list = days.get(day) ?? [];
		if (!list.some((entry) => itemKey$1(entry) === itemKey$1(item))) list.push(item);
		days.set(day, list);
	};
	for (const [day, items] of Object.entries(agenda)) if (day <= today) for (const item of items) put(day, item);
	for (const entry of plan?.days ?? []) if (entry.day >= today && entry.day <= last) for (const item of entry.items) put(entry.day, item);
	for (const { day, item } of lessonsDone.values()) if (day <= today) put(day, item);
	for (const check of checks) if (check.day <= today && check.item) put(check.day, check.item);
	const status = (item, day) => {
		if (day > today || item.kind === "exam") return false;
		if (checks.some((check) => check.refId === item.refId && check.day === day)) return "manual";
		if (item.kind === "lesson" && lessonsDone.get(item.refId)?.day === day) return "auto";
		if (item.kind === "review" && reviewsDone.get(item.refId) === day) return "auto";
		return false;
	};
	const out = [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, items]) => ({
		day,
		items: items.map((item) => ({
			...item,
			checked: status(item, day)
		}))
	}));
	return {
		today: out.find((entry) => entry.day === today)?.items ?? [],
		days: out
	};
}
//#endregion
//#region src/host/learner.js
const PROFILE_REFRESH_MS = 10 * 6e4;
function agendaItem(raw) {
	const kind = raw?.kind === "lesson" || raw?.kind === "review" ? raw.kind : null;
	const refId = text(raw?.refId, 80);
	if (!kind || !refId) return null;
	return {
		kind,
		refId,
		courseId: /^crs_[a-z0-9]{6,40}$/u.test(String(raw.courseId)) ? raw.courseId : null,
		title: text(raw.title, 160),
		courseTitle: text(raw.courseTitle, 160),
		courseEmoji: text(raw.courseEmoji, 8),
		minutes: Math.min(240, Math.max(0, Math.round(Number(raw.minutes) || 0)))
	};
}
function createLearner({ store, llm, now = () => /* @__PURE__ */ new Date(), logger }) {
	let lastRefresh = 0;
	let refreshing = null;
	async function getProfile() {
		return readProfile(store);
	}
	async function saveProfile(patch = {}) {
		const given = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== void 0));
		return store.updateJson(store.paths.profile(), { ...EMPTY_PROFILE }, (current) => cleanProfile({
			...current,
			...given,
			updatedAt: now().toISOString()
		}));
	}
	async function clearProfile() {
		await store.writeJson(store.paths.profile(), {
			...EMPTY_PROFILE,
			updatedAt: now().toISOString()
		});
		return readProfile(store);
	}
	async function removeNote({ id }) {
		return store.updateJson(store.paths.profile(), { ...EMPTY_PROFILE }, (current) => ({
			...current,
			notes: (current.notes ?? []).filter((note) => note.id !== id)
		}));
	}
	async function noteLesson({ course, lesson, states }) {
		if (refreshing || now().getTime() - lastRefresh < PROFILE_REFRESH_MS) return;
		lastRefresh = now().getTime();
		refreshing = (async () => {
			const profile = await readProfile(store);
			const events = [`Finished "${lesson.title}" in the course "${course.title}".`, ...states.map((state) => `Concept "${state.name}": mastery ${masteryPercent(state)}${state.misconceptions.length ? `, misconceptions: ${state.misconceptions.join("; ")}` : ""}${state.reexplains ? `, asked for ${state.reexplains} re-explanation(s)` : ""}`)].join("\n");
			const update = await generateJson(llm, {
				purpose: "quick",
				prompt: profilePrompt({
					profile: {
						background: profile.background,
						goals: profile.goals,
						strengths: profile.strengths,
						weaknesses: profile.weaknesses,
						preferences: profile.preferences
					},
					events,
					language: course.language
				}),
				maxTokens: 1500
			});
			await store.updateJson(store.paths.profile(), { ...EMPTY_PROFILE }, (current) => {
				const notes = [...current.notes ?? []];
				const note = text(update?.newNote, 200);
				if (note && !notes.some((item) => item.text === note)) notes.push({
					id: newId("nte"),
					text: note,
					source: "auto",
					at: now().toISOString()
				});
				return cleanProfile({
					...current,
					background: text(update?.background, 600) || current.background,
					goals: list(update?.goals) ?? current.goals,
					strengths: list(update?.strengths) ?? current.strengths,
					weaknesses: list(update?.weaknesses) ?? current.weaknesses,
					preferences: {
						...current.preferences,
						...update?.preferences?.style ? { style: text(update.preferences.style, 120) } : {}
					},
					notes: notes.slice(-30),
					updatedAt: now().toISOString()
				});
			});
		})().catch((error) => logger?.debug?.("aha-tutor profile refresh skipped: %s", error?.message)).finally(() => {
			refreshing = null;
		});
	}
	async function readPlanFile() {
		const plan = await store.readJson(store.paths.plan(), null) ?? {};
		return {
			settings: {
				weeklyMinutes: plan.settings?.weeklyMinutes ?? 300,
				studyDays: plan.settings?.studyDays ?? [
					1,
					2,
					3,
					4,
					5,
					6,
					0
				]
			},
			exams: Array.isArray(plan.exams) ? plan.exams : [],
			checks: Array.isArray(plan.checks) ? plan.checks : [],
			agenda: plan.agenda && typeof plan.agenda === "object" ? plan.agenda : {}
		};
	}
	const validDay = (value) => /^\d{4}-\d{2}-\d{2}$/u.test(String(value ?? "")) ? value : null;
	async function activeCourses() {
		const ids = await store.listIds(store.paths.courses(), "crs");
		const result = [];
		for (const id of ids) {
			const course = await store.readJson(store.paths.course(id), null);
			if (!course || course.status !== "ready" || course.archived) continue;
			result.push({
				course,
				progress: await readProgress(store, id)
			});
		}
		return result;
	}
	async function plan({ today } = {}) {
		const file = await readPlanFile();
		const day = validDay(today) ?? toDay(now());
		const active = await activeCourses();
		const tickedLessons = new Set(file.checks.filter((check) => check.kind === "lesson" && check.day <= day).map((check) => check.refId));
		const tickedToday = new Set(file.checks.filter((check) => check.day === day).map((check) => check.refId));
		const reviews = [];
		const done = {
			lessons: /* @__PURE__ */ new Map(),
			reviews: /* @__PURE__ */ new Map()
		};
		for (const { course, progress } of active) {
			const label = {
				courseId: course.id,
				courseTitle: course.title,
				courseEmoji: course.emoji ?? ""
			};
			const index = conceptIndex(course);
			for (const [conceptId, card] of Object.entries(progress.reviews ?? {})) {
				const concept = index.get(conceptId);
				if (!concept) continue;
				const id = `${course.id}:${conceptId}`;
				if (card.lastReviewedAt) done.reviews.set(id, toDay(new Date(card.lastReviewedAt)));
				if (!tickedToday.has(id)) reviews.push({
					id,
					...label,
					title: concept.name,
					dueDay: toDay(new Date(card.dueAt)),
					minutes: 5
				});
			}
			for (const { lesson } of flattenLessons(course)) {
				const record = progress.lessons?.[lesson.id];
				if (record?.status === "done" && record.completedAt) done.lessons.set(lesson.id, {
					day: toDay(new Date(record.completedAt)),
					item: {
						kind: "lesson",
						refId: lesson.id,
						title: lesson.title,
						minutes: lesson.estMinutes,
						...label
					}
				});
			}
		}
		const spent = /* @__PURE__ */ new Map();
		for (const { day: doneDay, item } of done.lessons.values()) if (doneDay === day) spent.set(item.refId, item.minutes);
		for (const item of file.agenda[day] ?? []) if (item.kind === "review" && (done.reviews.get(item.refId) === day || tickedToday.has(item.refId))) spent.set(item.refId, item.minutes);
		for (const check of file.checks) if (check.day === day && check.item) spent.set(check.refId, check.item.minutes);
		const built = buildPlan({
			today: day,
			spentToday: [...spent.values()].reduce((sum, minutes) => sum + (Number(minutes) || 0), 0),
			settings: file.settings,
			courses: active.map(({ course, progress }) => ({
				id: course.id,
				title: course.title,
				emoji: course.emoji ?? "",
				deadline: course.settings?.deadline ?? null,
				lessons: flattenLessons(course).map(({ lesson }) => ({
					id: lesson.id,
					title: lesson.title,
					minutes: lesson.estMinutes,
					done: progress.lessons?.[lesson.id]?.status === "done" || tickedLessons.has(lesson.id)
				}))
			})),
			reviews,
			exams: file.exams.map((exam) => ({
				id: exam.id,
				title: exam.title,
				day: exam.day,
				courseId: exam.courseId ?? null
			}))
		});
		const planned = (built.days.find((entry) => entry.day === day)?.items ?? []).filter((item) => item.kind !== "exam").map(agendaItem);
		const oldest = addDays(day, -180);
		const merged = mergeAgenda(file.agenda[day] ?? [], planned).slice(0, 40);
		let agenda = file.agenda;
		if (JSON.stringify(merged) !== JSON.stringify(file.agenda[day] ?? []) || Object.keys(file.agenda).some((key) => key < oldest)) agenda = (await store.updateJson(store.paths.plan(), {}, (current) => {
			const kept = Object.fromEntries(Object.entries(current.agenda ?? {}).filter(([key]) => validDay(key) && key >= oldest));
			kept[day] = mergeAgenda(kept[day] ?? [], planned).slice(0, 40);
			return {
				...current,
				agenda: kept
			};
		})).agenda;
		const calendar = planCalendar({
			today: day,
			agenda,
			plan: built,
			done,
			checks: file.checks
		});
		return {
			settings: file.settings,
			exams: file.exams,
			plan: built,
			today: calendar.today,
			calendar: calendar.days
		};
	}
	async function check({ today, day, item }) {
		const current = validDay(today) ?? toDay(now());
		const when = validDay(day);
		const entry = agendaItem(item ?? {});
		if (!when || !entry || when > current) throw new TutorError("cannot-tick", "Only today or an earlier day can be ticked");
		await store.updateJson(store.paths.plan(), {}, (current) => ({
			...current,
			checks: [...(current.checks ?? []).filter((existing) => !(existing.refId === entry.refId && existing.day === when)), {
				refId: entry.refId,
				kind: entry.kind,
				day: when,
				item: entry,
				at: now().toISOString()
			}].slice(-1e3)
		}));
		return plan({ today });
	}
	async function uncheck({ today, day, refId }) {
		await store.updateJson(store.paths.plan(), {}, (current) => ({
			...current,
			checks: (current.checks ?? []).filter((existing) => !(existing.refId === refId && existing.day === day))
		}));
		return plan({ today });
	}
	async function savePlanSettings({ weeklyMinutes, studyDays }) {
		await store.updateJson(store.paths.plan(), {}, (current) => ({
			...current,
			settings: {
				weeklyMinutes: Math.min(3e3, Math.max(30, Math.round(Number(weeklyMinutes) || 300))),
				studyDays: [...new Set((Array.isArray(studyDays) ? studyDays : []).map(Number).filter((value) => value >= 0 && value <= 6))].sort()
			}
		}));
		return plan();
	}
	async function addExam({ title, day, courseId }) {
		const name = text(title, 120);
		if (!name || !/^\d{4}-\d{2}-\d{2}$/u.test(String(day))) throw new TutorError("exam-incomplete", "Exam needs a title and a date");
		await store.updateJson(store.paths.plan(), {}, (current) => ({
			...current,
			exams: [...current.exams ?? [], {
				id: newId("exm"),
				title: name,
				day,
				courseId: /^crs_[a-z0-9]+$/u.test(String(courseId)) ? courseId : null
			}].slice(-50)
		}));
		return plan();
	}
	async function removeExam({ id }) {
		await store.updateJson(store.paths.plan(), {}, (current) => ({
			...current,
			exams: (current.exams ?? []).filter((exam) => exam.id !== id)
		}));
		return plan();
	}
	async function reviewSession({ limit = 8, courseId } = {}) {
		const at = now().getTime();
		const items = [];
		for (const { course, progress } of await activeCourses()) {
			if (courseId && course.id !== courseId) continue;
			const index = conceptIndex(course);
			const due = Object.entries(progress.reviews ?? {}).filter(([id, card]) => index.has(id) && Date.parse(card.dueAt) <= at).sort((a, b) => Date.parse(a[1].dueAt) - Date.parse(b[1].dueAt));
			for (const [conceptId] of due) {
				if (items.length >= limit) break;
				const concept = index.get(conceptId);
				const lesson = findLesson(course, concept.lessonId)?.lesson;
				const set = await store.readJson(store.paths.practice(course.id, concept.lessonId), null);
				const board = await store.readJson(store.paths.board(course.id, concept.lessonId), null);
				const candidates = [...(set?.items ?? []).map((item) => ({
					item,
					source: {
						kind: "practice",
						courseId: course.id,
						lessonId: concept.lessonId,
						itemId: item.id
					}
				})), ...(board?.steps ?? []).filter((step) => step.check).map((step) => ({
					item: step.check,
					source: {
						kind: "check",
						courseId: course.id,
						lessonId: concept.lessonId,
						stepId: step.id
					}
				}))].filter(({ item }) => item.conceptIds?.includes(conceptId) && item.kind !== "short" && item.kind !== "work");
				const pick = candidates[Math.floor(Math.random() * candidates.length)];
				if (pick) items.push({
					courseId: course.id,
					courseTitle: course.title,
					lessonId: concept.lessonId,
					lessonTitle: lesson?.title ?? "",
					conceptId,
					conceptName: concept.name,
					item: pick.item,
					source: pick.source
				});
			}
		}
		return { items };
	}
	return Object.freeze({
		getProfile,
		saveProfile,
		clearProfile,
		removeNote,
		noteLesson,
		plan,
		check,
		uncheck,
		savePlanSettings,
		addExam,
		removeExam,
		reviewSession
	});
}
function list(value) {
	if (!Array.isArray(value)) return void 0;
	return value.map((item) => text(item, 160)).filter(Boolean).slice(0, 8);
}
function cleanProfile(profile) {
	return {
		name: text(profile.name, 20).replace(/[\r\n]+/gu, " "),
		background: text(profile.background, 600),
		goals: list(profile.goals) ?? [],
		strengths: list(profile.strengths) ?? [],
		weaknesses: list(profile.weaknesses) ?? [],
		preferences: {
			style: text(profile.preferences?.style, 120),
			pace: [
				"slow",
				"normal",
				"fast"
			].includes(profile.preferences?.pace) ? profile.preferences.pace : "normal"
		},
		notes: (Array.isArray(profile.notes) ? profile.notes : []).map((note) => ({
			id: /^nte_[a-z0-9]+$/u.test(String(note?.id)) ? note.id : newId("nte"),
			text: text(note?.text, 200),
			source: note?.source === "user" ? "user" : "auto",
			at: note?.at ?? null
		})).filter((note) => note.text).slice(-30),
		updatedAt: profile.updatedAt ?? null
	};
}
//#endregion
//#region src/core/board-fix.js
const VERDICTS = Object.freeze([
	"wrong",
	"right",
	"unclear"
]);
const LAYOUT = /* @__PURE__ */ new Set([
	"col",
	"page",
	"mark"
]);
function opPlain(op) {
	switch (op?.t) {
		case "title":
		case "h":
		case "p":
		case "note": return op.text;
		case "math": return op.text || op.tex;
		case "list": return op.items.join("; ");
		case "table": return [op.head, ...op.rows].filter((row) => row.length).map((row) => row.join(" | ")).join(" / ");
		case "code": return op.code;
		case "chart": return [
			op.title,
			...op.series.map((series) => `${series.name} ${series.points.slice(0, 6).map((point) => `(${point.join(", ")})`).join(" ")}`),
			...op.data.map((item) => `${item.label} ${item.value}`)
		].filter(Boolean).join("; ");
		case "plot": return plotToText(op).replace(/\n/gu, "; ");
		case "svg":
		case "anim": return op.caption ?? "";
		default: return "";
	}
}
const withoutPlace = (op) => JSON.stringify({
	...op,
	id: void 0,
	at: void 0,
	fixed: void 0
});
function normalizeVerdict(raw, steps) {
	const verdict = VERDICTS.includes(raw?.verdict) ? raw.verdict : null;
	if (!verdict) throw new Error("the check names no verdict");
	const summary = text(raw?.summary ?? raw?.reason, 400);
	const fixes = [];
	if (verdict !== "wrong") return {
		verdict,
		summary,
		fixes
	};
	const byId = new Map(steps.map((step) => [step.id, step]));
	const done = /* @__PURE__ */ new Set();
	const keep = (key, fix) => {
		if (done.has(key) || fixes.length >= 12) return;
		done.add(key);
		fixes.push(fix);
	};
	for (const fix of (Array.isArray(raw?.fixes) ? raw.fixes : []).slice(0, 36)) {
		const step = byId.get(String(fix?.step ?? fix?.stepId ?? ""));
		if (!step) continue;
		const replacement = fix.replace ?? fix.with ?? fix.op_new;
		if (replacement && typeof replacement === "object") {
			const old = step.ops.find((op) => op.id === String(fix.op ?? fix.opId ?? ""));
			const next = normalizeOp(replacement, 0);
			if (old && next && !LAYOUT.has(old.t) && !LAYOUT.has(next.t) && withoutPlace(next) !== withoutPlace(old)) keep(`${step.id}:${old.id}`, {
				step: step.id,
				op: old.id,
				replace: next
			});
		}
		if (typeof fix.say === "string") {
			const say = text(fix.say, BOARD_LIMITS.say);
			if (say && say !== step.say) keep(`${step.id}:say`, {
				step: step.id,
				say
			});
		}
		if (fix.check && typeof fix.check === "object" && step.check) {
			const check = normalizeItem(fix.check, 0, step.check.conceptIds ?? []);
			if (check && check.kind !== "order") {
				const next = {
					...check,
					id: step.check.id,
					conceptIds: step.check.conceptIds ?? []
				};
				if (JSON.stringify(next) !== JSON.stringify(step.check)) keep(`${step.id}:check`, {
					step: step.id,
					check: next
				});
			}
		}
	}
	return {
		verdict,
		summary,
		fixes
	};
}
function applyFixes(steps, fixes, { at = (/* @__PURE__ */ new Date()).toISOString() } = {}) {
	const applied = [];
	return {
		steps: steps.map((step) => {
			const own = fixes.filter((fix) => fix.step === step.id);
			if (!own.length) return step;
			const copy = {
				...step,
				ops: [...step.ops]
			};
			for (const fix of own) {
				if (fix.replace) {
					const index = copy.ops.findIndex((op) => op.id === fix.op);
					if (index < 0) continue;
					const old = copy.ops[index];
					const note = fix.replace.fixed;
					const op = {
						...fix.replace,
						id: old.id,
						...old.at !== void 0 ? { at: old.at } : {},
						fixed: {
							was: old.fixed?.was ?? note?.was ?? text(opPlain(old), 300),
							at: note?.at ?? at
						}
					};
					copy.ops[index] = op;
					applied.push({
						step: step.id,
						op: old.id,
						replace: op
					});
				}
				if (fix.say !== void 0) {
					copy.say = fix.say;
					applied.push({
						step: step.id,
						say: fix.say
					});
				}
				if (fix.check && copy.check) {
					copy.check = {
						...fix.check,
						id: copy.check.id,
						conceptIds: copy.check.conceptIds ?? []
					};
					applied.push({
						step: step.id,
						check: copy.check
					});
				}
			}
			return copy;
		}),
		applied
	};
}
function sanitizeStep(raw) {
	const id = String(raw?.id ?? "");
	if (!/^[\w-]{1,48}$/u.test(id) || !Array.isArray(raw?.ops)) return null;
	const ops = raw.ops.slice(0, BOARD_LIMITS.opsPerStep).map((op) => {
		const clean = normalizeOp(op, 0);
		if (!clean || typeof op.id !== "string" || !/^[\w-]{1,48}$/u.test(op.id)) return null;
		return {
			...clean,
			id: op.id,
			...Number.isInteger(op.at) && op.at >= 0 && op.at < 20 ? { at: op.at } : {}
		};
	}).filter(Boolean);
	const say = text(raw.say, BOARD_LIMITS.say);
	if (!say && !ops.length) return null;
	return {
		id,
		say,
		ops
	};
}
function stepJson(step, { full = false } = {}) {
	const ops = step.ops.map(({ fixed, ...op }) => {
		if (op.t === "svg") return full ? {
			...op,
			svg: op.svg.slice(0, 16e3)
		} : {
			...op,
			svg: "…"
		};
		if (op.t === "anim") return {
			...op,
			html: full ? op.html.slice(0, 8e3) : "…",
			poster: "…"
		};
		return op;
	});
	return JSON.stringify({
		id: step.id,
		say: step.say,
		ops,
		...step.check ? { check: step.check } : {}
	});
}
function boardForCheck(steps, stepId, { maxChars = 14e3 } = {}) {
	const lines = steps.map((step) => stepJson(step));
	const center = Math.max(0, steps.findIndex((step) => step.id === stepId));
	const kept = /* @__PURE__ */ new Set([center]);
	let used = lines[center]?.length ?? 0;
	for (let distance = 1; distance < steps.length; distance += 1) for (const index of [center - distance, center + distance]) {
		if (index < 0 || index >= steps.length || used + lines[index].length > maxChars) continue;
		kept.add(index);
		used += lines[index].length;
	}
	return lines.filter((line, index) => kept.has(index)).join("\n");
}
function describeFixes(fixes, steps) {
	const byId = new Map(steps.map((step) => [step.id, step]));
	return fixes.map((fix) => {
		const step = byId.get(fix.step);
		if (fix.replace) return `${fix.step} ${fix.op}: ${opPlain(step?.ops.find((op) => op.id === fix.op))} → ${opPlain(fix.replace)}`;
		if (fix.say !== void 0) return `${fix.step} narration: ${step?.say ?? ""} → ${fix.say}`;
		return `${fix.step} check answer: ${JSON.stringify(step?.check?.answer ?? "")} → ${JSON.stringify(fix.check?.answer ?? "")}`;
	}).join("\n");
}
//#endregion
//#region src/core/evidence-log.js
const scored = (evidence) => evidence?.kind !== "reexplain" && evidence?.kind !== "self" && Number.isFinite(Number(evidence?.score));
const withoutHistory = ({ history, ...state }) => state;
function takeEvidence(state, card, evidence, at) {
	const next = applyEvidence(state, evidence, at);
	if (!scored(evidence)) return {
		state: next,
		card
	};
	return {
		state: next,
		card: review(card ?? createCard(state.id, at), gradeFromScore(Number(evidence.score), evidence.confidence), at)
	};
}
function stateBefore(state, card) {
	return {
		state: state ? withoutHistory(state) : null,
		card: card ?? null
	};
}
function logEvidence(progress, entry) {
	progress.evidenceLog = [...Array.isArray(progress.evidenceLog) ? progress.evidenceLog : [], entry].slice(-50);
}
function itemKey(source) {
	if (source?.kind === "practice") return `practice:${source.lessonId}:${source.itemId}`;
	if (source?.kind === "quiz") return `quiz:${source.unitId}:${source.itemId}`;
	if (source?.kind === "check") return `check:${source.lessonId}:${source.stepId}`;
	return null;
}
function answersTo(progress, key, except = null) {
	if (!key) return [];
	return (Array.isArray(progress?.evidenceLog) ? progress.evidenceLog : []).filter((entry) => entry.item?.key === key && entry.id !== except && scored(entry.evidence));
}
function correctEvidence(progress, id, patch, { known = (conceptId) => conceptId, at = (/* @__PURE__ */ new Date()).toISOString() } = {}) {
	const log = Array.isArray(progress.evidenceLog) ? progress.evidenceLog : [];
	const index = log.findIndex((entry) => entry.id === id);
	if (index < 0) return null;
	const entry = log[index];
	const evidence = {
		...entry.evidence,
		...patch
	};
	if (!scored(entry.evidence) || !scored(evidence)) return null;
	const later = log.slice(index + 1);
	progress.concepts ??= {};
	progress.reviews ??= {};
	const changed = [];
	for (const conceptId of entry.conceptIds ?? []) {
		const name = known(conceptId);
		if (name === null || name === void 0) continue;
		const after = later.filter((item) => item.conceptIds?.includes(conceptId));
		const history = progress.concepts[conceptId]?.history ?? [];
		const base = entry.before?.[conceptId];
		let state = {
			...base?.state ?? createConceptState(conceptId, name),
			history: history.slice(0, Math.max(0, history.length - 1 - after.length))
		};
		let card = base?.card ?? null;
		({state, card} = takeEvidence(state, card, evidence, Date.parse(entry.at)));
		for (const item of after) {
			item.before = {
				...item.before,
				[conceptId]: stateBefore(state, card)
			};
			({state, card} = takeEvidence(state, card, item.evidence, Date.parse(item.at)));
		}
		progress.concepts[conceptId] = state;
		if (card) progress.reviews[conceptId] = card;
		changed.push(conceptId);
	}
	entry.corrected = {
		score: entry.corrected?.score ?? entry.evidence.score,
		at
	};
	entry.evidence = evidence;
	return { conceptIds: changed };
}
//#endregion
//#region src/core/grading.js
const OBJECTIVE_KINDS = Object.freeze([
	"choice",
	"multi",
	"blank",
	"number",
	"order"
]);
const FULLWIDTH = /[！-～]/gu;
function normalizeAnswerText(value) {
	return String(value ?? "").normalize("NFKC").replace(FULLWIDTH, (char) => String.fromCharCode(char.charCodeAt(0) - 65248)).toLowerCase().replace(/[\s　]+/gu, " ").replace(/^[\s.,;:!?'"`，。；：！？、“”‘’]+|[\s.,;:!?'"`，。；：！？、“”‘’]+$/gu, "").trim();
}
function parseNumber(value) {
	if (typeof value === "number") return value;
	const text = normalizeAnswerText(value).replace(/,/gu, "").replace(/\s/gu, "");
	const fraction = /^(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/u.exec(text);
	if (fraction) return Number(fraction[1]) / Number(fraction[2]);
	const percent = /^(-?\d+(?:\.\d+)?)%$/u.exec(text);
	if (percent) return Number(percent[1]) / 100;
	const number = Number(text);
	return Number.isFinite(number) ? number : NaN;
}
function gradeObjective(item, response) {
	if (!item || !OBJECTIVE_KINDS.includes(item.kind)) return {
		score: 0,
		correct: false,
		gradable: false
	};
	if (item.kind === "choice") {
		const correct = String(response ?? "") === String(item.answer ?? "");
		return {
			score: correct ? 1 : 0,
			correct,
			gradable: true
		};
	}
	if (item.kind === "multi") {
		const expected = new Set((Array.isArray(item.answer) ? item.answer : [item.answer]).map(String));
		const given = new Set((Array.isArray(response) ? response : []).map(String));
		if (!expected.size) return {
			score: 0,
			correct: false,
			gradable: false
		};
		let hits = 0;
		let wrong = 0;
		for (const id of given) if (expected.has(id)) hits += 1;
		else wrong += 1;
		const score = Math.max(0, (hits - wrong) / expected.size);
		const correct = hits === expected.size && wrong === 0;
		return {
			score: round2(score),
			correct,
			gradable: true
		};
	}
	if (item.kind === "order") {
		const expected = (Array.isArray(item.answer) ? item.answer : []).map(String);
		const given = (Array.isArray(response) ? response : []).map(String);
		if (!expected.length) return {
			score: 0,
			correct: false,
			gradable: false
		};
		let inPlace = 0;
		expected.forEach((id, index) => {
			if (given[index] === id) inPlace += 1;
		});
		return {
			score: round2(inPlace / expected.length),
			correct: inPlace === expected.length,
			gradable: true
		};
	}
	if (item.kind === "number") {
		const expected = parseNumber(item.answer);
		const given = parseNumber(response);
		if (!Number.isFinite(expected)) return {
			score: 0,
			correct: false,
			gradable: false
		};
		if (!Number.isFinite(given)) return {
			score: 0,
			correct: false,
			gradable: true
		};
		const tolerance = Number.isFinite(Number(item.tolerance)) && Number(item.tolerance) >= 0 ? Number(item.tolerance) : Math.max(1e-9, Math.abs(expected) * .01);
		const correct = Math.abs(given - expected) <= tolerance;
		return {
			score: correct ? 1 : 0,
			correct,
			gradable: true
		};
	}
	const accepted = (Array.isArray(item.answer) ? item.answer : [item.answer]).map(normalizeAnswerText).filter(Boolean);
	if (!accepted.length) return {
		score: 0,
		correct: false,
		gradable: false
	};
	const given = normalizeAnswerText(response);
	const correct = accepted.includes(given);
	if (correct) return {
		score: 1,
		correct,
		gradable: true
	};
	const asNumber = parseNumber(response);
	const numeric = accepted.map(parseNumber).filter(Number.isFinite);
	if (Number.isFinite(asNumber) && numeric.some((value) => Math.abs(value - asNumber) <= Math.max(1e-9, Math.abs(value) * .001))) return {
		score: 1,
		correct: true,
		gradable: true
	};
	return {
		score: 0,
		correct: false,
		gradable: true
	};
}
function wrongLabel(item, response) {
	if (item.kind === "choice") return `chose ${String(response).toUpperCase()}: ${(item.options?.find((option) => option.id === response)?.text ?? "").slice(0, 50)}`;
	if (item.kind === "number" || item.kind === "blank") return `answered ${String(response).slice(0, 40)}`;
	return "wrong";
}
function round2(value) {
	return Math.round(value * 100) / 100;
}
//#endregion
//#region src/core/item-fix.js
const ITEM_VERDICTS = Object.freeze([
	"wrong",
	"unclear",
	"misgraded",
	"right"
]);
const MODEL_GRADED = Object.freeze(["short", "work"]);
const FIELDS = [
	"prompt",
	"options",
	"answer",
	"tolerance",
	"unit",
	"explanation",
	"hints",
	"rubric",
	"figure"
];
const modelGraded = (item) => MODEL_GRADED.includes(item?.kind);
function cleanResponse(item, response) {
	const ids = (item?.options ?? []).map((option) => option.id);
	if (item?.kind === "choice") return ids.includes(response) ? response : "";
	if (item?.kind === "multi" || item?.kind === "order") return [...new Set((Array.isArray(response) ? response : []).filter((id) => ids.includes(id)))];
	return typeof response === "string" || typeof response === "number" ? text(response, 4e3) : "";
}
function responseText(item, response) {
	const option = (id) => {
		const found = item.options?.find((entry) => entry.id === id);
		return found ? `${id.toUpperCase()}. ${found.text}` : String(id);
	};
	if (item.kind === "choice") return response ? option(response) : "";
	if (item.kind === "multi") return response.map(option).join("; ");
	if (item.kind === "order") return response.map(option).join(" → ");
	if (item.kind === "number" && item.unit && response) return `${response} ${item.unit}`;
	return String(response ?? "");
}
function itemForCheck(item) {
	const { id, conceptIds, difficulty, fixed, svg, plot, ...rest } = item;
	return JSON.stringify({
		...rest,
		...svg ? { svg: svg.slice(0, 8e3) } : {},
		...plot ? { plot } : {}
	});
}
function normalizeGrade(raw, kind) {
	if (!raw || typeof raw !== "object" || !Number.isFinite(Number(raw.score))) return null;
	const score = Math.min(1, Math.max(0, Number(raw.score)));
	return {
		score,
		verdict: [
			"correct",
			"partial",
			"incorrect"
		].includes(raw.verdict) ? raw.verdict : score >= .8 ? "correct" : score >= .4 ? "partial" : "incorrect",
		feedback: text(raw.feedback, 1200),
		errorTag: text(raw.errorTag, 80),
		...kind === "work" ? {
			wrongStep: text(raw.wrongStep, 400),
			why: text(raw.why, 400),
			fix: text(raw.fix, 400)
		} : {}
	};
}
const figureOf = (item) => item.svg ? { svg: item.svg } : item.plot ? { plot: item.plot } : {};
function correctedItem(old, raw) {
	if (!raw || typeof raw !== "object" || raw.kind !== void 0 && raw.kind !== old.kind) return null;
	const next = normalizeItem({
		...raw,
		kind: old.kind
	}, 0);
	if (!next || next.kind !== old.kind || (old.options?.length ?? 0) !== (next.options?.length ?? 0)) return null;
	const redrawn = [
		"svg",
		"figure",
		"plot"
	].some((key) => raw[key] !== void 0);
	const { svg, plot, ...rest } = next;
	return {
		...rest,
		...redrawn ? figureOf(next) : figureOf(old),
		id: old.id,
		conceptIds: old.conceptIds ?? [],
		difficulty: old.difficulty ?? next.difficulty
	};
}
const empty = (value) => value === void 0 || value === null || value === "" || Array.isArray(value) && !value.length;
const same = (a, b) => empty(a) && empty(b) || JSON.stringify(a) === JSON.stringify(b);
function changedParts(old, next) {
	const was = {};
	for (const field of FIELDS) if (field === "options") {
		const options = Object.fromEntries((old.options ?? []).filter((option, index) => option.text !== next.options?.[index]?.text).map((option) => [option.id, option.text]));
		if (Object.keys(options).length) was.options = options;
	} else if (field === "figure") {
		if (!same(figureOf(old), figureOf(next))) was.figure = true;
	} else if (!same(old[field], next[field])) was[field] = empty(old[field]) ? null : old[field];
	return was;
}
function normalizeItemVerdict(raw, item) {
	const verdict = ITEM_VERDICTS.includes(raw?.verdict) ? raw.verdict : null;
	if (!verdict) throw new Error("the check names no verdict");
	if (verdict === "misgraded" && !modelGraded(item)) throw new Error("a choice, multi, blank, number or order question is graded by its answer key: when the key misjudged the answer, the verdict is \"wrong\" with the key corrected in \"item\"");
	const summary = text(raw?.summary ?? raw?.reason, 400);
	const explanation = text(raw?.explanation, 2e3);
	const credit = verdict === "unclear" && raw?.credit === true;
	let fixed = null;
	if (verdict === "wrong" || verdict === "unclear") {
		fixed = correctedItem(item, raw?.item);
		if (!fixed) throw new Error(`a "${verdict}" verdict needs the whole corrected question in "item": the same kind, the same number of options`);
		if (!Object.keys(changedParts(item, fixed)).length) throw new Error("the corrected question in \"item\" changes nothing");
	}
	const grade = modelGraded(item) && verdict !== "right" && !credit ? normalizeGrade(raw?.grade, item.kind) : null;
	if (modelGraded(item) && verdict !== "right" && !credit && !grade) throw new Error("give the new \"grade\" of the learner's answer against the corrected question");
	return {
		verdict,
		summary,
		explanation,
		item: fixed,
		credit,
		grade
	};
}
function fixItem(stored, next, { at = (/* @__PURE__ */ new Date()).toISOString() } = {}) {
	const { fixed: note, ...old } = stored;
	const changed = changedParts(old, next);
	const was = {
		...changed,
		...note?.was
	};
	if (changed.options && note?.was?.options) was.options = {
		...changed.options,
		...note.was.options
	};
	return {
		...next,
		id: stored.id,
		conceptIds: stored.conceptIds ?? next.conceptIds ?? [],
		fixed: {
			was,
			at: note?.at ?? at
		}
	};
}
function regrade(item, response, checked) {
	if (checked.verdict === "right") return null;
	if (checked.credit) return {
		score: 1,
		correct: true,
		partial: false,
		errorTag: ""
	};
	if (OBJECTIVE_KINDS.includes(item.kind)) {
		const graded = gradeObjective(item, response);
		return {
			score: graded.score,
			correct: graded.correct,
			partial: !graded.correct && graded.score > 0
		};
	}
	if (!checked.grade) return null;
	const { verdict, ...grade } = checked.grade;
	return {
		...grade,
		correct: verdict === "correct",
		partial: verdict === "partial"
	};
}
function earlierGrade(item, response, { verdict, score, grade = null }) {
	if (verdict !== "wrong" && verdict !== "unclear") return null;
	let next;
	if (OBJECTIVE_KINDS.includes(item.kind)) {
		const answer = cleanResponse(item, response);
		const graded = gradeObjective(item, answer);
		if (!graded.gradable) return null;
		next = {
			score: graded.score,
			correct: graded.correct,
			errorTag: graded.correct ? "" : wrongLabel(item, answer)
		};
	} else {
		if (!grade || !Number.isFinite(Number(grade.score))) return null;
		const value = Math.min(1, Math.max(0, Number(grade.score)));
		const correct = grade.verdict ? grade.verdict === "correct" : value >= .8;
		next = {
			score: value,
			correct,
			errorTag: correct ? "" : text(grade.errorTag, 80)
		};
	}
	const before = Math.min(1, Math.max(0, Number(score) || 0));
	if (verdict === "unclear" && next.score <= before || Math.abs(next.score - before) < 1e-6) return null;
	return next;
}
//#endregion
//#region src/host/lessons.js
const EVENTS_KEPT = 200;
const STEP_ID = /^s\d{1,4}$/u;
const BOARD_JOBS = ["lesson/board", "lesson/prefetch"];
function createLessons({ store, llm, jobs, courses, learner, now = () => /* @__PURE__ */ new Date() }) {
	const stamp = () => now().toISOString();
	async function context(courseId, lessonId) {
		const course = await courses.readCourse(courseId);
		const row = findLesson(course, assertId(lessonId, "les"));
		if (!row) throw new TutorError("not-found", "Lesson not found");
		return {
			course,
			row
		};
	}
	async function get({ courseId, lessonId }) {
		const { course, row } = await context(courseId, lessonId);
		const [board, practice, progress, asides] = await Promise.all([
			store.readJson(store.paths.board(courseId, lessonId), null),
			store.readJson(store.paths.practice(courseId, lessonId), null),
			readProgress(store, courseId),
			store.readJson(store.paths.asides(courseId, lessonId), null)
		]);
		return {
			courseId,
			language: course.language,
			unit: {
				id: row.unit.id,
				title: row.unit.title
			},
			lecture: {
				id: row.lecture.id,
				title: row.lecture.title
			},
			lesson: row.lesson,
			board,
			practice,
			asides: Array.isArray(asides?.items) ? asides.items : [],
			state: progress.lessons?.[lessonId] ?? {
				status: "new",
				stepIndex: 0
			},
			next: lessonAfter(course, lessonId)?.lesson ?? null,
			job: jobs.running(`board:${courseId}:${lessonId}`),
			mastery: Object.fromEntries(row.lesson.concepts.map((concept) => [concept.id, masteryPercent(progress.concepts?.[concept.id] ?? createConceptState(concept.id, concept.name))]))
		};
	}
	async function buildBoard({ course, row, signal, onStep, onProgress, directive, style }) {
		const progress = await readProgress(store, course.id);
		const profile = await readProfile(store);
		const materials = await readMaterials(store, course.materialIds ?? []);
		const query = `${row.lesson.title} ${row.lesson.objectives.join(" ")} ${row.lesson.concepts.map((concept) => concept.name).join(" ")}`;
		const rows = conceptIndex(course);
		const lessonsInOrder = [...new Set([...rows.values()].map((concept) => concept.lessonId))];
		const previousId = lessonsInOrder[lessonsInOrder.indexOf(row.lesson.id) - 1];
		const previous = previousId ? findLesson(course, previousId)?.lesson : null;
		const kindDirective = row.lesson.kind === "remedial" ? "remediate" : row.lesson.kind === "review" ? "review" : row.lesson.kind === "challenge" ? "challenge" : void 0;
		return generateSteps(llm, {
			purpose: "teach",
			effort: "lowest",
			prompt: lessonPrompt({
				course,
				unit: row.unit,
				lecture: row.lecture,
				lesson: row.lesson,
				language: course.language,
				learner: {
					profile,
					mastery: masteryFor(course, progress, row.lesson.id)
				},
				passages: passagesFor(materials, query, 8e3),
				previous: previous ? `${previous.title}: ${previous.summary}` : "",
				directive: directive ?? kindDirective,
				style
			}),
			maxTokens: 14e3,
			signal,
			conceptIds: row.lesson.concepts.map((concept) => concept.id),
			onStep,
			onProgress,
			minSteps: 3
		});
	}
	async function prepare({ courseId, lessonId, force = false, style }) {
		const { course, row } = await context(courseId, lessonId);
		ensurePractice(course, row);
		if (force) {
			jobs.cancelKey(`board:${courseId}:${lessonId}`);
			await store.writeJson(store.paths.asides(courseId, lessonId), { items: [] });
		}
		if (!force) {
			const existing = await store.readJson(store.paths.board(courseId, lessonId), null);
			if (existing) {
				prefetchNext(course, lessonId);
				return { board: existing };
			}
		}
		return { job: jobs.start("lesson/board", async (api) => {
			api.progress(0, 1, "writing");
			const board = await buildBoard({
				course,
				row,
				signal: api.signal,
				onStep: (step) => api.push(step),
				onProgress: (info) => api.preview(info),
				style: text(style, 300) || void 0
			});
			const saved = {
				...board,
				title: board.title || row.lesson.title,
				lessonId,
				createdAt: stamp()
			};
			await store.writeJson(store.paths.board(courseId, lessonId), saved);
			api.progress(1, 1, "done");
			prefetchNext(course, lessonId);
			return { board: saved };
		}, {
			key: `board:${courseId}:${lessonId}`,
			meta: {
				courseId,
				lessonId
			}
		}) };
	}
	function prefetchNext(course, lessonId) {
		const next = lessonAfter(course, lessonId);
		if (!next) return;
		const key = `board:${course.id}:${next.lesson.id}`;
		if (jobs.running(key)) return;
		store.exists(store.paths.board(course.id, next.lesson.id)).then((exists) => {
			if (exists || jobs.running(key)) return;
			jobs.start("lesson/prefetch", async (api) => {
				const board = await buildBoard({
					course,
					row: next,
					signal: api.signal,
					onStep: (step) => api.push(step),
					onProgress: (info) => api.preview(info)
				});
				const saved = {
					...board,
					title: board.title || next.lesson.title,
					lessonId: next.lesson.id,
					createdAt: stamp()
				};
				await store.writeJson(store.paths.board(course.id, next.lesson.id), saved);
				return { board: saved };
			}, {
				key,
				meta: {
					courseId: course.id,
					lessonId: next.lesson.id,
					prefetch: true
				}
			});
		}).catch(() => void 0);
	}
	function followedJob(scope, kinds, meta) {
		const job = scope?.jobId ? jobs.get(scope.jobId) : null;
		return job && kinds.includes(job.kind) && Object.entries(meta).every(([key, value]) => job.meta?.[key] === value) ? job : null;
	}
	async function scopeBoard(scope) {
		if (scope?.kind === "lesson") {
			const { course, row } = await context(scope.courseId, scope.lessonId);
			const writing = followedJob(scope, BOARD_JOBS, {
				courseId: course.id,
				lessonId: row.lesson.id
			});
			const board = writing ? { steps: writing.partial } : await store.readJson(store.paths.board(course.id, row.lesson.id), null);
			return {
				course,
				lesson: row.lesson,
				board,
				language: course.language,
				writing
			};
		}
		if (scope?.kind === "thread" || scope?.kind === "short") {
			const thread = scope.kind === "thread";
			const writing = thread ? followedJob(scope, ["assist/turn"], { threadId: scope.id }) : followedJob(scope, ["short/make"], { id: scope.id });
			const item = await store.readJson(store.paths.item(thread ? "assist" : "shorts", scope.id), null);
			if (!item && !writing) throw new TutorError("not-found", "Not found");
			const board = writing ? { steps: writing.partial } : thread ? item.turns?.[Math.max(0, Math.min(item.turns.length - 1, Number(scope.turn) || 0))]?.board : item.board;
			const language = item?.language ?? detectLanguage((board?.steps ?? []).map((step) => step.say).join(" "));
			return {
				course: null,
				lesson: {
					title: item?.title ?? writing.meta?.title ?? "",
					objectives: []
				},
				board,
				language,
				writing
			};
		}
		throw new TutorError("invalid", "Unknown board");
	}
	async function keepAside(scope, aside) {
		if (scope?.kind !== "lesson") return null;
		const saved = {
			id: newId("asd"),
			...aside,
			at: stamp()
		};
		await store.updateJson(store.paths.asides(scope.courseId, scope.lessonId), null, (value) => ({ items: [...Array.isArray(value?.items) ? value.items : [], saved].slice(-30) }));
		return saved;
	}
	const anchorFor = (board, stepIndex, anchorStepId) => STEP_ID.test(String(anchorStepId)) ? anchorStepId : board?.steps?.[Math.max(0, Number(stepIndex) || 0)]?.id ?? "s1";
	function ask({ scope, stepIndex = 0, question, anchorStepId }) {
		const request = text(question, 1500);
		if (!request) throw new TutorError("empty-question", "Type your question");
		return jobs.start("lesson/ask", async (api) => {
			const { course, lesson, board, language } = await scopeBoard(scope);
			const profile = await readProfile(store);
			const answer = await generateSteps(llm, {
				purpose: "quick",
				prompt: askPrompt({
					course,
					lesson,
					language,
					boardSoFar: board ? boardToPlainText(board, {
						uptoStep: Number(stepIndex) || 0,
						maxChars: 6e3
					}) : "",
					question: request,
					learner: { profile }
				}),
				maxTokens: 5e3,
				signal: api.signal,
				conceptIds: lesson?.concepts?.map((concept) => concept.id) ?? [],
				onStep: (step) => api.push(step)
			});
			const aside = await keepAside(scope, {
				kind: "question",
				question: request,
				anchorStepId: anchorFor(board, stepIndex, anchorStepId),
				steps: answer.steps
			});
			if (scope.kind === "lesson") await logEvent(scope.courseId, {
				type: "question",
				lessonId: scope.lessonId,
				text: request.slice(0, 200)
			});
			return {
				steps: answer.steps,
				aside
			};
		});
	}
	function reexplain({ scope, stepIndex = 0, style = "example", anchorStepId }) {
		return jobs.start("lesson/reexplain", async (api) => {
			const { course, lesson, board, language } = await scopeBoard(scope);
			if (!board?.steps?.length) throw new TutorError("no-board", "The board is not written yet. Try again once its first step is up.");
			const index = Math.min(board.steps.length - 1, Math.max(0, Number(stepIndex) || 0));
			const answer = await generateSteps(llm, {
				purpose: "teach",
				effort: "lowest",
				prompt: reexplainPrompt({
					lesson,
					language,
					step: boardToPlainText({ steps: [board.steps[index]] }, { maxChars: 3e3 }),
					boardSoFar: boardToPlainText(board, {
						uptoStep: index,
						maxChars: 5e3
					}),
					style
				}),
				maxTokens: 6e3,
				signal: api.signal,
				conceptIds: lesson?.concepts?.map((concept) => concept.id) ?? [],
				onStep: (next) => api.push(next)
			});
			const aside = await keepAside(scope, {
				kind: "reexplain",
				style,
				anchorStepId: anchorFor(board, index, anchorStepId),
				steps: answer.steps
			});
			if (scope.kind === "lesson" && course) {
				const conceptIds = lesson.concepts.map((concept) => concept.id);
				await record({
					courseId: course.id,
					lessonId: lesson.id,
					conceptIds,
					evidence: { kind: "reexplain" }
				});
			}
			return {
				steps: answer.steps,
				aside
			};
		});
	}
	async function challengedPlace(scope, board, target) {
		const stepId = String(target?.stepId ?? "");
		if (target?.asideId) {
			const aside = (scope.kind === "lesson" ? await store.readJson(store.paths.asides(scope.courseId, scope.lessonId), null) : null)?.items?.find((item) => item.id === target.asideId);
			const index = aside?.steps?.findIndex((item) => item.id === stepId) ?? -1;
			if (index < 0) throw new TutorError("not-found", "Not found");
			const anchor = board?.steps?.findIndex((step) => step.id === aside.anchorStepId) ?? -1;
			return {
				ref: { asideId: aside.id },
				steps: aside.steps,
				step: aside.steps[index],
				context: [...(board?.steps ?? []).slice(0, anchor + 1), ...aside.steps.slice(0, index + 1)]
			};
		}
		if (target?.step) {
			const step = sanitizeStep(target.step);
			if (!step) throw new TutorError("invalid", "Nothing to check");
			const anchor = board?.steps?.findIndex((item) => item.id === target.anchorStepId) ?? -1;
			return {
				ref: { local: true },
				steps: [step],
				step,
				context: [...(board?.steps ?? []).slice(0, anchor + 1), step]
			};
		}
		const index = board?.steps?.findIndex((step) => step.id === stepId) ?? -1;
		if (index < 0) throw new TutorError(board?.steps?.length ? "not-found" : "no-board", board?.steps?.length ? "Not found" : "The board is not written yet. Try again once its first step is up.");
		return {
			ref: { main: true },
			steps: board.steps,
			step: board.steps[index],
			context: board.steps.slice(0, index + 1)
		};
	}
	async function storeFixes(scope, place, fixes, writing) {
		let applied = [];
		const fix = (steps) => {
			const result = applyFixes(Array.isArray(steps) ? steps : [], fixes);
			applied = result.applied;
			return result.steps;
		};
		if (place.ref.local) {
			fix(place.steps);
			return applied;
		}
		if (place.ref.asideId) {
			await store.updateJson(store.paths.asides(scope.courseId, scope.lessonId), null, (value) => ({ items: (Array.isArray(value?.items) ? value.items : []).map((item) => item.id === place.ref.asideId ? {
				...item,
				steps: fix(item.steps)
			} : item) }));
			return applied;
		}
		if (writing && (await jobs.wait(writing.id))?.status !== "done") return applyFixes(place.steps, fixes).applied;
		const missing = () => new TutorError("not-found", "Not found");
		if (scope.kind === "lesson") await store.updateJson(store.paths.board(scope.courseId, scope.lessonId), null, (saved) => {
			if (!saved) throw missing();
			return {
				...saved,
				steps: fix(saved.steps)
			};
		});
		else if (scope.kind === "thread") await store.updateJson(store.paths.item("assist", scope.id), null, (thread) => {
			const turn = thread?.turns?.[Math.max(0, Math.min(thread.turns.length - 1, Number(scope.turn) || 0))];
			if (!turn?.board) throw missing();
			turn.board = {
				...turn.board,
				steps: fix(turn.board.steps)
			};
			return thread;
		});
		else await store.updateJson(store.paths.item("shorts", scope.id), null, (short) => {
			if (!short?.board) throw missing();
			return {
				...short,
				board: {
					...short.board,
					steps: fix(short.board.steps)
				}
			};
		});
		return applied;
	}
	function challenge({ scope, stepIndex = 0, anchorStepId, target = {}, note }) {
		const doubt = text(note, 800);
		return jobs.start("lesson/challenge", async (api) => {
			const { course, lesson, board, language, writing } = await scopeBoard(scope);
			const place = await challengedPlace(scope, board, {
				...target,
				anchorStepId
			});
			api.preview({ phase: "checking" });
			const checked = await generateJson(llm, {
				purpose: "teach",
				effort: "low",
				prompt: verifyStepPrompt({
					course,
					lesson,
					language,
					board: boardForCheck(place.steps, place.step.id),
					step: stepJson(place.step, { full: true }),
					stepId: place.step.id,
					note: doubt
				}),
				maxTokens: 6e3,
				signal: api.signal,
				normalize: (raw) => normalizeVerdict(raw, place.steps)
			});
			api.preview({
				phase: "answering",
				verdict: checked.verdict
			});
			const answer = await generateSteps(llm, {
				purpose: "teach",
				effort: "lowest",
				prompt: challengePrompt({
					course,
					lesson,
					language,
					boardSoFar: boardToPlainText({ steps: place.context }, { maxChars: 5e3 }),
					step: boardToPlainText({ steps: [place.step] }, { maxChars: 3e3 }),
					note: doubt,
					verdict: checked.verdict,
					summary: checked.summary,
					fixes: describeFixes(checked.fixes, place.steps)
				}),
				maxTokens: 5e3,
				signal: api.signal,
				conceptIds: lesson?.concepts?.map((concept) => concept.id) ?? [],
				onStep: (step) => api.push(step)
			});
			const fixes = checked.fixes.length ? await storeFixes(scope, place, checked.fixes, writing) : [];
			const aside = await keepAside(scope, {
				kind: "challenge",
				verdict: checked.verdict,
				note: doubt,
				summary: checked.summary,
				anchorStepId: anchorFor(board, stepIndex, anchorStepId),
				steps: answer.steps
			});
			if (scope.kind === "lesson") await logEvent(scope.courseId, {
				type: "challenge",
				lessonId: scope.lessonId,
				verdict: checked.verdict
			});
			return {
				verdict: checked.verdict,
				summary: checked.summary,
				target: place.ref,
				fixes,
				steps: answer.steps,
				aside
			};
		});
	}
	async function record({ courseId, lessonId, conceptIds = [], evidence = {}, item = null }) {
		const course = await courses.readCourse(courseId);
		const index = conceptIndex(course);
		const ids = (Array.isArray(conceptIds) && conceptIds.length ? conceptIds : findLesson(course, lessonId)?.lesson.concepts.map((concept) => concept.id) ?? []).filter((id) => index.has(id)).slice(0, 8);
		const at = now().getTime();
		const evidenceId = newId("evd");
		const key = item?.source?.courseId === courseId ? itemKey(item.source) : null;
		const next = await store.updateJson(store.paths.progress(courseId), null, (progress) => {
			const value = progress ?? {
				courseId,
				lessons: {},
				concepts: {},
				reviews: {},
				practice: {},
				projects: {},
				events: []
			};
			value.concepts ??= {};
			value.reviews ??= {};
			const before = {};
			for (const id of ids) {
				before[id] = stateBefore(value.concepts[id], value.reviews[id]);
				const taken = takeEvidence(value.concepts[id] ?? createConceptState(id, index.get(id).name), value.reviews[id], evidence, at);
				value.concepts[id] = taken.state;
				if (taken.card) value.reviews[id] = taken.card;
			}
			if (ids.length) logEvidence(value, {
				id: evidenceId,
				at: new Date(at).toISOString(),
				lessonId: lessonId ?? null,
				conceptIds: ids,
				evidence: JSON.parse(JSON.stringify(evidence)),
				before,
				...key ? { item: {
					key,
					response: item.response ?? ""
				} } : {}
			});
			pushEvent(value, {
				type: "evidence",
				lessonId: lessonId ?? null,
				conceptIds: ids,
				kind: evidence.kind ?? "practice",
				score: evidence.score ?? null,
				confidence: evidence.confidence ?? null,
				at: new Date(at).toISOString()
			});
			return value;
		});
		const states = ids.map((id) => next.concepts[id]).filter(Boolean);
		return {
			mastery: Object.fromEntries(states.map((state) => [state.id, masteryPercent(state)])),
			recommendation: recommendNext(states),
			evidenceId: ids.length ? evidenceId : null
		};
	}
	async function regradeEvidence(course, evidenceId, patch) {
		const index = conceptIndex(course);
		let changed = null;
		const next = await store.updateJson(store.paths.progress(course.id), null, (progress) => {
			const value = progress ?? {
				courseId: course.id,
				lessons: {},
				concepts: {},
				reviews: {},
				events: []
			};
			changed = correctEvidence(value, evidenceId, patch, {
				known: (id) => index.get(id)?.name ?? null,
				at: stamp()
			});
			if (changed) pushEvent(value, {
				type: "regrade",
				evidenceId,
				conceptIds: changed.conceptIds,
				score: patch.score,
				at: stamp()
			});
			return value;
		});
		if (!changed?.conceptIds.length) return null;
		const states = changed.conceptIds.map((id) => next.concepts[id]).filter(Boolean);
		return {
			mastery: Object.fromEntries(states.map((state) => [state.id, masteryPercent(state)])),
			recommendation: recommendNext(states)
		};
	}
	async function itemPlace(source) {
		const missing = () => new TutorError("not-found", "Not found");
		const rewrite = (path, listOf) => async (change) => {
			let saved = null;
			await store.updateJson(path, null, (value) => {
				const items = listOf(value);
				const index = Array.isArray(items) ? items.findIndex((entry) => entry.id === source.itemId) : -1;
				if (index < 0) throw missing();
				saved = change(items[index]);
				items[index] = saved;
				return value;
			});
			return saved;
		};
		if (source.kind === "deck") {
			const path = store.paths.item("decks", source.deckId);
			const deck = await store.readJson(path, null);
			const item = deck?.kind === "quiz" ? deck.items?.find((entry) => entry.id === source.itemId) : null;
			if (!item) throw missing();
			return {
				item,
				course: null,
				lessonId: null,
				language: deck.language,
				scope: deck.title,
				save: rewrite(path, (value) => value?.kind === "quiz" ? value.items : null)
			};
		}
		const course = await courses.readCourse(source.courseId);
		if (source.kind === "quiz") {
			const unit = course.units?.find((entry) => entry.id === source.unitId);
			const path = unit ? store.paths.unitQuiz(course.id, unit.id) : null;
			const item = path ? (await store.readJson(path, null))?.items?.find((entry) => entry.id === source.itemId) : null;
			if (!item) throw missing();
			return {
				item,
				course,
				lessonId: null,
				language: course.language,
				scope: `${course.title} — ${unit.title}`,
				save: rewrite(path, (value) => value?.items)
			};
		}
		const row = findLesson(course, source.lessonId);
		if (!row) throw missing();
		const scope = `${course.title} — ${row.lesson.title}`;
		if (source.kind === "check") {
			const path = store.paths.board(course.id, row.lesson.id);
			const item = (await store.readJson(path, null))?.steps?.find((step) => step.id === source.stepId)?.check;
			if (!item) throw missing();
			const save = async (change) => {
				let saved = null;
				await store.updateJson(path, null, (board) => {
					const step = board?.steps?.find((entry) => entry.id === source.stepId);
					if (!step?.check) throw missing();
					saved = change(step.check);
					step.check = saved;
					return board;
				});
				return saved;
			};
			return {
				item,
				course,
				lessonId: row.lesson.id,
				language: course.language,
				scope,
				save
			};
		}
		const path = store.paths.practice(course.id, row.lesson.id);
		const item = (await store.readJson(path, null))?.items?.find((entry) => entry.id === source.itemId);
		if (!item) throw missing();
		return {
			item,
			course,
			lessonId: row.lesson.id,
			language: course.language,
			scope,
			save: rewrite(path, (value) => value?.items)
		};
	}
	async function regradeEarlier({ course, key, item, verdict, except, language, signal }) {
		const answers = answersTo(await store.readJson(store.paths.progress(course.id), null), key, except);
		const open = !OBJECTIVE_KINDS.includes(item.kind);
		const graded = await Promise.all((open ? answers.slice(-3) : answers).map(async (entry) => {
			const again = open ? await grade({
				item,
				response: entry.item.response,
				language,
				signal
			}).catch((error) => {
				if (signal?.aborted) throw error;
				return null;
			}) : null;
			if (open && !again) return null;
			return {
				id: entry.id,
				next: earlierGrade(item, entry.item.response, {
					verdict,
					score: entry.evidence.score,
					grade: again
				})
			};
		}));
		let found = null;
		for (const { id, next } of graded.filter((entry) => entry?.next)) {
			const corrected = await regradeEvidence(course, id, {
				score: next.score,
				errorTag: next.errorTag
			});
			if (corrected) found = {
				count: (found?.count ?? 0) + 1,
				mastery: {
					...found?.mastery,
					...corrected.mastery
				},
				recommendation: corrected.recommendation
			};
		}
		return found;
	}
	function challengeItem({ source, response, shown = {}, evidenceId, note }) {
		const doubt = text(note, 800);
		return jobs.start("item/challenge", async (api) => {
			const place = await itemPlace(source);
			const answer = cleanResponse(place.item, response);
			const told = place.item.kind === "short" || place.item.kind === "work" ? [
				`A grader gave this answer a score of ${shown.score} (${shown.correct ? "correct" : shown.partial ? "partial" : "incorrect"}).`,
				shown.feedback ? `Feedback shown: ${shown.feedback}` : "",
				shown.wrongStep ? `First wrong line found: ${shown.wrongStep}` : "",
				shown.fix ? `Fix shown: ${shown.fix}` : ""
			].filter(Boolean).join("\n") : `The answer key marked this answer ${shown.correct ? "correct" : shown.partial ? "partly correct" : "incorrect"}.`;
			api.preview({ phase: "checking" });
			const checked = await generateJson(llm, {
				purpose: "teach",
				effort: "low",
				prompt: verifyItemPrompt({
					scope: place.scope,
					language: place.language,
					item: itemForCheck(place.item),
					kind: place.item.kind,
					response: responseText(place.item, answer),
					grading: told,
					note: doubt
				}),
				maxTokens: 5e3,
				signal: api.signal,
				normalize: (raw) => normalizeItemVerdict(raw, place.item)
			});
			const item = checked.item ? await place.save((stored) => fixItem(stored, checked.item, { at: stamp() })) : place.item;
			const result = regrade(item, answer, checked);
			const changed = Boolean(result) && (result.correct !== Boolean(shown.correct) || Math.abs(result.score - (Number(shown.score) || 0)) > 1e-6);
			const corrected = changed && evidenceId && place.course ? await regradeEvidence(place.course, evidenceId, {
				score: result.score,
				...result.correct ? { errorTag: "" } : result.errorTag ? { errorTag: result.errorTag } : {}
			}) : null;
			const earlier = checked.item && place.course ? await regradeEarlier({
				course: place.course,
				key: itemKey(source),
				item,
				verdict: checked.verdict,
				except: evidenceId,
				language: place.language,
				signal: api.signal
			}) : null;
			if (place.course) await logEvent(place.course.id, {
				type: "item-challenge",
				lessonId: place.lessonId,
				verdict: checked.verdict,
				changed,
				earlier: earlier?.count ?? 0
			});
			const mastery = corrected || earlier ? {
				...corrected?.mastery,
				...earlier?.mastery
			} : null;
			return {
				verdict: checked.verdict,
				summary: checked.summary,
				explanation: checked.explanation,
				item: checked.item ? item : null,
				result: changed ? result : null,
				earlier: earlier?.count ?? 0,
				mastery,
				recommendation: earlier?.recommendation ?? corrected?.recommendation ?? null
			};
		});
	}
	async function grade({ item, response, language = "zh-CN", signal }) {
		if (!item?.prompt) throw new TutorError("invalid", "Missing question");
		const work = item.kind === "work";
		const answer = text(response, 4e3);
		if (!answer) return {
			score: 0,
			verdict: "incorrect",
			feedback: "",
			errorTag: "",
			misconception: false,
			...work ? {
				wrongStep: "",
				why: "",
				fix: ""
			} : {}
		};
		return await generateJson(llm, {
			purpose: "quick",
			prompt: gradePrompt({
				item: {
					kind: work ? "work" : "short",
					prompt: text(item.prompt, 2e3),
					answer: text(item.answer, 3e3),
					rubric: Array.isArray(item.rubric) ? item.rubric.map((entry) => text(entry, 300)) : []
				},
				response: answer,
				language
			}),
			maxTokens: work ? 1800 : 1200,
			signal,
			normalize: (raw) => ({
				score: Math.min(1, Math.max(0, Number(raw?.score) || 0)),
				verdict: [
					"correct",
					"partial",
					"incorrect"
				].includes(raw?.verdict) ? raw.verdict : Number(raw?.score) >= .8 ? "correct" : Number(raw?.score) >= .4 ? "partial" : "incorrect",
				feedback: text(raw?.feedback, 1200),
				errorTag: text(raw?.errorTag, 80),
				misconception: raw?.misconception === true,
				...work ? {
					wrongStep: text(raw?.wrongStep, 400),
					why: text(raw?.why, 400),
					fix: text(raw?.fix, 400)
				} : {}
			})
		});
	}
	function correct({ scope, stepIndex = 0, anchorStepId, item, response, grade: graded }) {
		const working = text(response, 4e3);
		if (!item?.prompt || !working) throw new TutorError("invalid", "Nothing to correct");
		const notes = graded && typeof graded === "object" ? graded : {};
		return jobs.start("lesson/correct", async (api) => {
			const { course, lesson, board, language } = await scopeBoard(scope);
			const answer = await generateSteps(llm, {
				purpose: "quick",
				prompt: correctionPrompt({
					course,
					lesson,
					language,
					boardSoFar: board ? boardToPlainText(board, {
						uptoStep: Number(stepIndex) || 0,
						maxChars: 5e3
					}) : "",
					item: {
						prompt: text(item.prompt, 2e3),
						answer: text(item.answer, 3e3)
					},
					response: working,
					grade: {
						feedback: text(notes.feedback, 1200),
						wrongStep: text(notes.wrongStep, 400),
						why: text(notes.why, 400),
						fix: text(notes.fix, 400)
					}
				}),
				maxTokens: 4e3,
				signal: api.signal,
				conceptIds: lesson?.concepts?.map((concept) => concept.id) ?? [],
				onStep: (step) => api.push(step)
			});
			const aside = await keepAside(scope, {
				kind: "correction",
				errorTag: text(notes.errorTag, 80),
				anchorStepId: anchorFor(board, stepIndex, anchorStepId),
				steps: answer.steps
			});
			return {
				steps: answer.steps,
				aside
			};
		});
	}
	async function savePosition({ courseId, lessonId, stepIndex = 0 }) {
		assertId(lessonId, "les");
		await store.updateJson(store.paths.progress(assertId(courseId, "crs")), null, (progress) => {
			const value = progress ?? {
				courseId,
				lessons: {},
				concepts: {},
				reviews: {},
				events: []
			};
			value.lessons ??= {};
			const current = value.lessons[lessonId] ?? { status: "new" };
			value.lessons[lessonId] = {
				...current,
				status: current.status === "done" ? "done" : "learning",
				stepIndex: Math.max(0, Math.min(500, Math.round(Number(stepIndex) || 0))),
				startedAt: current.startedAt ?? stamp(),
				lastAt: stamp()
			};
			value.lastLessonId = lessonId;
			return value;
		});
		return { ok: true };
	}
	async function complete({ courseId, lessonId, selfRating }) {
		const { course, row } = await context(courseId, lessonId);
		if (selfRating) await record({
			courseId,
			lessonId,
			evidence: {
				kind: "self",
				rating: selfRating
			}
		});
		const progress = await store.updateJson(store.paths.progress(courseId), null, (value) => {
			const next = value ?? {
				courseId,
				lessons: {},
				concepts: {},
				reviews: {},
				events: []
			};
			next.lessons ??= {};
			next.lessons[lessonId] = {
				...next.lessons[lessonId] ?? {},
				status: "done",
				completedAt: stamp()
			};
			pushEvent(next, {
				type: "lesson-done",
				lessonId,
				title: row.lesson.title,
				at: stamp()
			});
			return next;
		});
		const states = row.lesson.concepts.map((concept) => progress.concepts?.[concept.id]).filter(Boolean);
		const recommendation = recommendNext(states);
		let inserted = null;
		const alreadyRemedial = row.lesson.kind === "remedial";
		if (recommendation.action === "remediate" && !alreadyRemedial) {
			const weak = row.lesson.concepts.filter((concept) => recommendation.conceptIds.includes(concept.id));
			inserted = insertLesson(course, lessonId, {
				title: `${course.language?.startsWith("zh") ? "巩固：" : "Revisit: "}${weak.map((concept) => concept.name).join(course.language?.startsWith("zh") ? "、" : ", ") || row.lesson.title}`,
				summary: row.lesson.summary,
				objectives: row.lesson.objectives,
				concepts: weak,
				estMinutes: Math.min(15, row.lesson.estMinutes || 12),
				kind: "remedial"
			});
			await courses.saveCourse(course);
		}
		learner.noteLesson({
			course,
			lesson: row.lesson,
			states
		}).catch(() => void 0);
		return {
			recommendation,
			inserted,
			next: lessonAfter(course, lessonId)?.lesson ?? null
		};
	}
	async function practice({ courseId, lessonId }) {
		const { course, row } = await context(courseId, lessonId);
		const existing = await store.readJson(store.paths.practice(courseId, lessonId), null);
		if (existing) return { practice: existing };
		return { job: lecturePractice(course, row) };
	}
	function lecturePractice(course, row) {
		return jobs.start("lesson/practice", async (api) => {
			const missing = [];
			for (const lesson of row.lecture.lessons) if (!await store.exists(store.paths.practice(course.id, lesson.id))) missing.push(lesson);
			const written = missing.length ? await courses.writeLecturePractice({
				course,
				lecture: row.lecture,
				lessons: missing,
				signal: api.signal
			}) : {};
			const sets = {};
			for (const lesson of row.lecture.lessons) sets[lesson.id] = written[lesson.id] ?? await store.readJson(store.paths.practice(course.id, lesson.id), null);
			if (!Object.values(sets).some(Boolean)) throw new TutorError("bad-output", "No practice items came back. Try again.");
			return { sets };
		}, {
			key: `practice:${course.id}:${row.lecture.id}`,
			meta: {
				courseId: course.id,
				lectureId: row.lecture.id
			}
		});
	}
	function ensurePractice(course, row) {
		store.exists(store.paths.practice(course.id, row.lesson.id)).then((exists) => {
			if (!exists && !jobs.running(`practice:${course.id}:${row.lecture.id}`)) lecturePractice(course, row);
		}).catch(() => void 0);
	}
	async function handout({ courseId, lessonId, force = false }) {
		const { course, row } = await context(courseId, lessonId);
		if (!force) {
			const existing = await store.readJson(store.paths.handout(courseId, lessonId), null);
			if (existing) return { handout: existing };
		}
		const board = await store.readJson(store.paths.board(courseId, lessonId), null);
		if (!board?.steps?.length) throw new TutorError("no-board", "The board is not written yet. Try again once its first step is up.");
		return { job: jobs.start("lesson/handout", async (api) => {
			const made = await generateJson(llm, {
				purpose: "teach",
				effort: "lowest",
				prompt: handoutPrompt({
					course,
					lesson: row.lesson,
					language: course.language,
					board: boardToPlainText(board, { maxChars: 12e3 })
				}),
				maxTokens: 5e3,
				signal: api.signal,
				normalize: normalizeHandout
			});
			const saved = {
				...made,
				title: made.title || row.lesson.title,
				lessonId,
				createdAt: stamp()
			};
			await store.writeJson(store.paths.handout(courseId, lessonId), saved);
			return { handout: saved };
		}, {
			key: `handout:${courseId}:${lessonId}`,
			meta: {
				courseId,
				lessonId
			}
		}) };
	}
	async function unitSheet({ courseId, unitId, force = false }) {
		const course = await courses.readCourse(courseId);
		const unit = course.units?.find((item) => item.id === assertId(unitId, "unt"));
		if (!unit) throw new TutorError("not-found", "Unit not found");
		if (!force) {
			const existing = await store.readJson(store.paths.sheet(courseId, unitId), null);
			if (existing) return { sheet: existing };
		}
		return { job: jobs.start("unit/sheet", async (api) => {
			const materials = await readMaterials(store, course.materialIds ?? []);
			const outline = outlineForPrompt({ units: [unit] });
			const sheet = await generateJson(llm, {
				purpose: "teach",
				prompt: cheatsheetPrompt({
					scopeTitle: `${course.title} — ${unit.title}`,
					outline,
					passages: passagesFor(materials, outline, 9e3),
					language: course.language
				}),
				maxTokens: 9e3,
				signal: api.signal,
				normalize: normalizeCheatsheet
			});
			const saved = {
				...sheet,
				title: sheet.title || unit.title,
				unitId,
				createdAt: stamp()
			};
			await store.writeJson(store.paths.sheet(courseId, unitId), saved);
			return { sheet: saved };
		}, {
			key: `sheet:${courseId}:${unitId}`,
			meta: {
				courseId,
				unitId
			}
		}) };
	}
	async function saveSheetLayout({ courseId, unitId, layout }) {
		const path = store.paths.sheet(assertId(courseId, "crs"), assertId(unitId, "unt"));
		return { sheet: await store.updateJson(path, null, (sheet) => {
			if (!sheet) throw new TutorError("not-found", "Cheat sheet not found");
			sheet.layout = cleanLayout(layout, sheet);
			return sheet;
		}) };
	}
	async function unitOf(courseId, unitId) {
		const course = await courses.readCourse(courseId);
		const index = course.units?.findIndex((item) => item.id === assertId(unitId, "unt")) ?? -1;
		if (index < 0) throw new TutorError("not-found", "Unit not found");
		const unit = course.units[index];
		const concepts = unitConcepts(unit);
		const outline = outlineForPrompt({ units: [unit] });
		const passages = async () => passagesFor(await readMaterials(store, course.materialIds ?? []), `${outline}\n${concepts.map((concept) => concept.name).join(" ")}`, 9e3);
		return {
			course,
			unit,
			concepts,
			outline,
			passages,
			about: {
				title: unit.title,
				n: index + 1
			}
		};
	}
	async function unitQuiz({ courseId, unitId, force = false }) {
		const { course, unit, concepts, outline, passages } = await unitOf(courseId, unitId);
		const path = store.paths.unitQuiz(courseId, unitId);
		const key = `quiz:${courseId}:${unitId}`;
		const running = jobs.running(key);
		if (running) return { job: running };
		if (!force) {
			const existing = await store.readJson(path, null);
			if (existing) return { quiz: existing };
		}
		return { job: jobs.start("unit/quiz", async (api) => {
			const range = unitQuizRange(unit);
			const quiz = await generateJson(llm, {
				purpose: "teach",
				prompt: quizPrompt({
					scopeTitle: `${course.title} — ${unit.title}`,
					outline,
					concepts: concepts.map((concept) => `${concept.id}=${concept.name}`).join(", "),
					passages: await passages(),
					language: course.language,
					range
				}),
				maxTokens: 2e3 + range.max * 500,
				signal: api.signal,
				onText: countWritten(api, "\"prompt\"", range.max),
				normalize: (raw) => {
					const set = { items: thinEvenly(normalizePractice(raw, concepts.map((concept) => concept.id), LIMITS.quizItems * 2).items, range.max).map((item, index) => ({
						...item,
						id: `i${index + 1}`
					})) };
					if (set.items.length < Math.max(3, Math.ceil(range.min / 2))) throw new Error(`The quiz is too short: write at least ${range.min} questions.`);
					return set;
				}
			});
			const previous = await store.readJson(path, null);
			const round = previous ? (previous.round ?? 1) + 1 : 1;
			const saved = {
				unitId,
				round,
				items: round === 1 ? quiz.items : quiz.items.map((item) => ({
					...item,
					id: `r${round}${item.id}`
				})),
				createdAt: stamp()
			};
			await store.writeJson(path, saved);
			return { quiz: saved };
		}, {
			key,
			meta: {
				courseId,
				unitId
			}
		}) };
	}
	async function unitCards({ courseId, unitId }) {
		const { course, unit, concepts, outline, passages, about } = await unitOf(courseId, unitId);
		const path = store.paths.unitCards(courseId, unitId);
		const existing = await store.readJson(path, null);
		if (existing?.cards?.length) return {
			deck: existing,
			unit: about
		};
		return {
			job: jobs.start("unit/cards", async (api) => {
				const range = unitCardRange(unit);
				const deck = {
					unitId,
					cards: await generateJson(llm, {
						purpose: "teach",
						prompt: flashcardsPrompt({
							scopeTitle: `${course.title} — ${unit.title}`,
							outline,
							concepts: concepts.map((concept) => concept.name).join(", "),
							passages: await passages(),
							language: course.language,
							range
						}),
						maxTokens: 2e3 + range.max * 250,
						signal: api.signal,
						onText: countWritten(api, "\"front\"", range.max),
						normalize: (raw) => {
							const value = thinEvenly(normalizeCards(raw, LIMITS.cards * 2), range.max).map((card, index) => ({
								...card,
								id: `c${index + 1}`
							}));
							if (value.length < Math.max(4, Math.ceil(range.min / 2))) throw new Error(`Too few cards: write at least ${range.min}.`);
							return value;
						}
					}),
					srs: {},
					createdAt: stamp()
				};
				await store.writeJson(path, deck);
				return {
					deck,
					unit: about
				};
			}, {
				key: `cards:${courseId}:${unitId}`,
				meta: {
					courseId,
					unitId
				}
			}),
			unit: about
		};
	}
	async function cardSession({ courseId }) {
		const course = await courses.readCourse(courseId);
		const at = now().getTime();
		const due = [];
		const fresh = [];
		const take = (deck, unit) => {
			for (const card of deck?.cards ?? []) {
				const state = deck.srs?.[card.id];
				const entry = {
					...card,
					unitId: unit?.id ?? null,
					unit: unit ? {
						title: unit.title,
						n: course.units.indexOf(unit) + 1
					} : null
				};
				if (state && isDue(state, at)) due.push({
					entry,
					dueAt: Date.parse(state.dueAt)
				});
				else if (!state && !unit) fresh.push(entry);
			}
		};
		for (const unit of course.units ?? []) take(await store.readJson(store.paths.unitCards(courseId, unit.id), null), unit);
		take(await store.readJson(store.paths.cards(courseId), null), null);
		return { cards: [...due.sort((a, b) => a.dueAt - b.dueAt).map(({ entry }) => entry), ...fresh] };
	}
	async function reviewCard({ courseId, unitId, cardId, grade: answer }) {
		const path = unitId ? store.paths.unitCards(assertId(courseId, "crs"), unitId) : store.paths.cards(assertId(courseId, "crs"));
		return { srs: (await store.updateJson(path, null, (value) => {
			if (!value?.cards?.some((card) => card.id === cardId)) throw new TutorError("not-found", "Card not found");
			value.srs ??= {};
			value.srs[cardId] = review(value.srs[cardId] ?? createCard(cardId, now().getTime()), answer, now().getTime());
			return value;
		})).srs[cardId] };
	}
	async function logEvent(courseId, event) {
		await store.updateJson(store.paths.progress(courseId), null, (value) => {
			const next = value ?? {
				courseId,
				lessons: {},
				concepts: {},
				reviews: {},
				events: []
			};
			pushEvent(next, {
				...event,
				at: stamp()
			});
			return next;
		}).catch(() => void 0);
	}
	return Object.freeze({
		get,
		prepare,
		ask,
		reexplain,
		challenge,
		challengeItem,
		handout,
		record,
		grade,
		correct,
		savePosition,
		complete,
		practice,
		unitSheet,
		saveSheetLayout,
		unitQuiz,
		unitCards,
		cardSession,
		reviewCard
	});
}
function countWritten(api, field, total) {
	return fieldCounter(field, (count) => api.progress(Math.min(count, total), total, "writing"));
}
function pushEvent(progress, event) {
	progress.events ??= [];
	progress.events.push(event);
	if (progress.events.length > EVENTS_KEPT) progress.events.splice(0, progress.events.length - EVENTS_KEPT);
}
function cleanLayout(layout, sheet) {
	const sectionIds = sheet.sections.map((section) => section.id);
	const order = (Array.isArray(layout?.order) ? layout.order : []).filter((id) => sectionIds.includes(id));
	for (const id of sectionIds) if (!order.includes(id)) order.push(id);
	const hidden = (Array.isArray(layout?.hidden) ? layout.hidden : []).filter((id) => sectionIds.includes(id));
	return {
		columns: Math.min(4, Math.max(1, Math.round(Number(layout?.columns) || 3))),
		fontSize: Math.min(16, Math.max(8, Math.round(Number(layout?.fontSize) || 12))),
		highlight: layout?.highlight !== false,
		order,
		hidden
	};
}
//#endregion
//#region src/host/llm.js
const RETRYABLE$1 = /* @__PURE__ */ new Set([
	"EMPTY_RESPONSE",
	"RATE_LIMIT",
	"SERVER",
	"TIMEOUT",
	"TRANSPORT"
]);
const REASONING_ROOM = Object.freeze({
	off: 0,
	none: 0,
	minimal: 4e3,
	low: 16e3,
	medium: 16e3,
	high: 24e3,
	xhigh: 48e3,
	max: 48e3
});
const EFFORT_ORDER = [
	"off",
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max"
];
const STOPPED_AT_LIMIT = /* @__PURE__ */ new Set(["max-tokens", "length"]);
const CALL_TIMEOUT_MS = 6 * 6e4;
const MAX_RETRIES = 2;
const USER_ERRORS = Object.freeze({
	AUTH: ["llm-auth", "The model rejected the sign-in or key. Check the model provider in DSH settings."],
	MISSING_CREDENTIAL: ["llm-auth", "The selected model provider is not signed in. Set it up in DSH settings."],
	INVALID_CREDENTIAL: ["llm-auth", "The model provider key is invalid. Check it in DSH settings."],
	ACCOUNT_SIGN_IN_REQUIRED: ["llm-auth", "Sign in to the model provider in DSH first."],
	RATE_LIMIT: ["llm-quota", "The model is rate limiting requests. Wait a moment and try again."],
	QUOTA: ["llm-quota", "The model quota is used up."],
	ACCOUNT_QUOTA: ["llm-quota", "The model account quota is used up."],
	CONTEXT_WINDOW_EXCEEDED: ["llm-context", "The material is too long for this model. Pick fewer materials or a model with a larger context."],
	NO_ADAPTER: ["llm-unavailable", "The selected model is not available. Pick another model in Aha settings."],
	TIMEOUT: ["llm-timeout", "The model took too long to respond. Try again."],
	EMPTY_RESPONSE: ["llm-empty", "The model returned nothing this time. Try again."],
	ABORTED: ["cancelled", "Cancelled"]
});
function toTutorError(code, fallback) {
	const known = USER_ERRORS[code];
	if (known) return new TutorError(known[0], known[1]);
	return new TutorError("llm-failed", `The model call failed${code ? ` (${code})` : ""}${fallback ? `: ${fallback}` : ""}`);
}
function pickEffort(efforts, wanted) {
	if (!efforts?.length || !wanted) return void 0;
	if (wanted === "lowest") {
		const rank = (effort) => EFFORT_ORDER.includes(effort.id) ? EFFORT_ORDER.indexOf(effort.id) : EFFORT_ORDER.length;
		return efforts.reduce((lightest, effort) => rank(effort) < rank(lightest) ? effort : lightest).id;
	}
	return (efforts.find((effort) => effort.id === wanted) ?? efforts.find((effort) => effort.id !== "off" && effort.id !== "none") ?? efforts[0]).id;
}
function outputBudget(maxTokens, effort, model) {
	const cap = Number(model?.defaultMaxTokens) || 0;
	if (!cap || !model?.reasoning) return maxTokens;
	const room = REASONING_ROOM[effort ?? model.reasoning.defaultEffort] ?? REASONING_ROOM.high;
	return Math.max(Math.min(maxTokens, cap), Math.min(maxTokens + room, cap));
}
const sleep$1 = (ms, signal) => new Promise((resolve, reject) => {
	const timer = setTimeout(resolve, ms);
	signal?.addEventListener("abort", () => {
		clearTimeout(timer);
		reject(signal.reason ?? /* @__PURE__ */ new Error("aborted"));
	}, { once: true });
});
function createLlmPort({ getLlm, getDefault, getAttachments, prefs, logger }) {
	function route(purpose) {
		const settings = prefs.read();
		const provider = purpose === "quick" ? settings.quickProvider : settings.teachProvider;
		const model = purpose === "quick" ? settings.quickModel : settings.teachModel;
		if (provider && model) return {
			provider,
			model
		};
		if (purpose === "quick" && settings.teachProvider && settings.teachModel) return {
			provider: settings.teachProvider,
			model: settings.teachModel
		};
		const selection = getDefault();
		if (selection?.provider && selection?.model) return {
			provider: selection.provider,
			model: selection.model
		};
		throw new TutorError("llm-missing", "No model is configured in DSH yet.");
	}
	async function modalities(purpose, signal) {
		const llm = getLlm();
		const target = route(purpose);
		try {
			return (await llm.resolveModelInfo(target.provider, target.model, signal))?.inputModalities ?? null;
		} catch {
			return null;
		}
	}
	async function content(user, images, prepared, required) {
		const blocks = [{
			type: "text",
			text: String(user ?? "")
		}];
		if (!images?.length) return blocks;
		const attachments = getAttachments();
		if (prepared.inputModalities?.includes("image") !== true || typeof attachments?.saveImage !== "function") {
			if (required) throw new TutorError("llm-no-vision", "The selected model cannot see images. Pick one that can in Aha settings.");
			return blocks;
		}
		for (const [index, image] of images.slice(0, 4).entries()) try {
			const ref = await attachments.saveImage({
				data: Buffer.from(image.base64, "base64"),
				mediaType: image.mime,
				name: `material-${index + 1}.${image.mime.split("/")[1] ?? "png"}`
			});
			blocks.push({
				type: "image",
				attachment: ref
			});
		} catch (error) {
			if (required) throw new TutorError("image-unusable", "This picture could not be given to the model.");
			logger?.debug?.("aha-tutor could not attach an image: %s", error?.message);
		}
		return blocks;
	}
	async function attempt({ purpose, effort, system, user, images, requireImages = false, maxTokens, signal, onText, onReasoning }) {
		const llm = getLlm();
		if (!llm) throw new TutorError("llm-missing", "DSH has no model service in this profile.");
		const target = route(purpose);
		const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
		const fused = signal ? AbortSignal.any([signal, timeout]) : timeout;
		let prepared;
		try {
			prepared = await llm.prepareCall({
				...target,
				maxTokens
			}, fused, (controls, model) => {
				const chosen = pickEffort(model?.reasoning?.efforts, purpose === "quick" ? "lowest" : effort);
				return {
					...controls,
					...chosen ? { reasoningEffort: chosen } : {},
					maxTokens: outputBudget(maxTokens, chosen, model)
				};
			});
		} catch (error) {
			if (signal?.aborted) throw signal.reason ?? error;
			throw Object.assign(toTutorError(error?.code, error?.message), { retryable: false });
		}
		let textValue = "";
		let finish = null;
		const messages = [{
			role: "user",
			content: await content(user, images, prepared, requireImages)
		}];
		try {
			for await (const chunk of prepared.stream({
				...prepared.config,
				...system ? { system } : {},
				messages,
				signal: fused
			})) if (chunk.type === "text-delta" && typeof chunk.text === "string") {
				textValue += chunk.text;
				onText?.(chunk.text);
			} else if (chunk.type === "reasoning-delta" && typeof chunk.text === "string") onReasoning?.(chunk.text);
			else if (chunk.type === "finish") finish = chunk.reason;
		} catch (error) {
			if (signal?.aborted) throw signal.reason ?? error;
			throw Object.assign(toTutorError(timeout.aborted ? "TIMEOUT" : error?.code, error?.message), {
				retryable: RETRYABLE$1.has(error?.code),
				streamed: textValue.length > 0
			});
		}
		if (finish?.kind === "error" || finish?.kind === "aborted") {
			if (signal?.aborted) throw signal.reason ?? /* @__PURE__ */ new Error("aborted");
			const code = timeout.aborted ? "TIMEOUT" : finish.kind === "aborted" ? "ABORTED" : finish.failure?.code;
			throw Object.assign(toTutorError(code, finish.failure?.message), {
				retryable: RETRYABLE$1.has(code),
				retryAfterMs: finish.failure?.providerRetryAfterMs,
				streamed: textValue.length > 0
			});
		}
		if (!textValue.trim()) throw Object.assign(toTutorError("EMPTY_RESPONSE"), {
			retryable: true,
			streamed: false,
			grow: STOPPED_AT_LIMIT.has(finish?.kind)
		});
		return textValue;
	}
	async function call(options) {
		let lastError;
		let current = options;
		for (let tries = 0; tries <= MAX_RETRIES; tries += 1) try {
			return await attempt(current);
		} catch (error) {
			lastError = error;
			if (options.signal?.aborted || !error?.retryable || error?.streamed || tries === MAX_RETRIES) throw error;
			if (error.grow) current = {
				...current,
				maxTokens: current.maxTokens * 2
			};
			else await sleep$1(Math.min(2e4, Number(error.retryAfterMs) || 1500 * (tries + 1)), options.signal);
		}
		throw lastError;
	}
	return Object.freeze({
		complete: (options) => call({
			...options,
			onText: void 0,
			onReasoning: void 0
		}),
		stream: (options) => call(options),
		route,
		supportsImages: (purpose) => capabilities[purpose] === true,
		async refreshCapabilities(signal) {
			for (const purpose of ["teach", "quick"]) try {
				capabilities[purpose] = (await modalities(purpose, signal))?.includes("image") === true;
			} catch {
				capabilities[purpose] = false;
			}
			return { ...capabilities };
		},
		async listModels(signal) {
			const llm = getLlm();
			if (!llm) return [];
			const providers = typeof llm.listProviders === "function" ? llm.listProviders() : [];
			const rows = [];
			for (const provider of providers) {
				try {
					const models = await llm.listModels(provider.id);
					for (const model of models) rows.push({
						provider: provider.id,
						providerName: provider.name ?? provider.id,
						model: model.id,
						name: model.name ?? model.id,
						images: model.inputModalities?.includes("image") === true
					});
				} catch {}
				signal?.throwIfAborted();
			}
			return rows;
		}
	});
}
const capabilities = {
	teach: false,
	quick: false
};
//#endregion
//#region src/host/store.js
const DATA_DIR_NAME = "aha-tutor";
const RETRYABLE = /* @__PURE__ */ new Set([
	"EPERM",
	"EBUSY",
	"EACCES",
	"ENOTEMPTY"
]);
function resolveDshHome(env = process.env) {
	return typeof env.DSH_HOME === "string" && env.DSH_HOME.trim() !== "" ? env.DSH_HOME : join(homedir(), ".dsh");
}
function resolveProjectsRoot(env = process.env) {
	return join(homedir(), "AhaTutor", "projects");
}
const sleep = (ms) => new Promise((resolve) => {
	setTimeout(resolve, ms);
});
async function renameWithRetry(from, to, attempts = 8) {
	for (let attempt = 1;; attempt += 1) try {
		await rename(from, to);
		return;
	} catch (error) {
		if (!RETRYABLE.has(error?.code) || attempt >= attempts) throw error;
		await sleep(15 * 2 ** attempt);
	}
}
async function writeFileAtomic(path, data) {
	const temp = `${path}.${process.pid}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.tmp`;
	await writeFile(temp, data);
	try {
		await renameWithRetry(temp, path);
	} catch (error) {
		await unlink(temp).catch(() => void 0);
		throw error;
	}
}
function createStore({ root }) {
	if (typeof root !== "string" || !root) throw new TypeError("store root is required");
	const queues = /* @__PURE__ */ new Map();
	const exclusive = (path, task) => {
		const run = (queues.get(path) ?? Promise.resolve()).catch(() => void 0).then(task);
		const tail = run.catch(() => void 0);
		queues.set(path, tail);
		tail.then(() => {
			if (queues.get(path) === tail) queues.delete(path);
		});
		return run;
	};
	const paths = {
		root,
		courses: () => join(root, "courses"),
		courseDir: (id) => join(root, "courses", assertId(id, "crs")),
		course: (id) => join(paths.courseDir(id), "course.json"),
		progress: (id) => join(paths.courseDir(id), "progress.json"),
		intake: (id) => join(paths.courseDir(id), "intake.json"),
		proposal: (id) => join(paths.courseDir(id), "proposal.json"),
		cards: (id) => join(paths.courseDir(id), "cards.json"),
		unitCardsDir: (id) => join(paths.courseDir(id), "cards"),
		unitCards: (id, unitId) => join(paths.courseDir(id), "cards", `${assertId(unitId, "unt")}.json`),
		boardsDir: (id) => join(paths.courseDir(id), "boards"),
		practiceDir: (id) => join(paths.courseDir(id), "practice"),
		sheetsDir: (id) => join(paths.courseDir(id), "sheets"),
		board: (id, lessonId) => join(paths.courseDir(id), "boards", `${assertId(lessonId, "les")}.json`),
		practice: (id, lessonId) => join(paths.courseDir(id), "practice", `${assertId(lessonId, "les")}.json`),
		asides: (id, lessonId) => join(paths.courseDir(id), "asides", `${assertId(lessonId, "les")}.json`),
		sheet: (id, unitId) => join(paths.courseDir(id), "sheets", `${assertId(unitId, "unt")}.json`),
		handout: (id, lessonId) => join(paths.courseDir(id), "handouts", `${assertId(lessonId, "les")}.json`),
		unitQuiz: (id, unitId) => join(paths.courseDir(id), "quizzes", `${assertId(unitId, "unt")}.json`),
		materials: () => join(root, "materials"),
		materialDir: (id) => join(root, "materials", assertId(id, "mat")),
		material: (id) => join(paths.materialDir(id), "meta.json"),
		materialChunks: (id) => join(paths.materialDir(id), "chunks.json"),
		materialBlob: (id) => join(paths.materialDir(id), "original.bin"),
		collection: (kind) => join(root, assertKind(kind)),
		item: (kind, id) => join(root, assertKind(kind), `${assertId(id, KIND_PREFIX[kind])}.json`),
		profile: () => join(root, "profile.json"),
		plan: () => join(root, "plan.json"),
		prefs: () => join(root, "prefs.json"),
		ttsCache: () => join(root, "tts-cache")
	};
	async function readJson(path, fallback = null) {
		try {
			return JSON.parse(await readFile(path, "utf8"));
		} catch (error) {
			if (error?.code === "ENOENT") return fallback;
			if (error instanceof SyntaxError) return fallback;
			throw error;
		}
	}
	function writeJson(path, value) {
		return exclusive(path, async () => {
			await mkdir(join(path, ".."), { recursive: true });
			await writeFileAtomic(path, `${JSON.stringify(value, null, 1)}\n`);
			return value;
		});
	}
	function updateJson(path, fallback, mutate) {
		return exclusive(path, async () => {
			const current = await readJson(path, fallback);
			const next = await mutate(current) ?? current;
			await mkdir(join(path, ".."), { recursive: true });
			await writeFileAtomic(path, `${JSON.stringify(next, null, 1)}\n`);
			return next;
		});
	}
	function writeBlob(path, data) {
		return exclusive(path, async () => {
			await mkdir(join(path, ".."), { recursive: true });
			await writeFileAtomic(path, data);
		});
	}
	async function readBlob(path) {
		try {
			return await readFile(path);
		} catch (error) {
			if (error?.code === "ENOENT") return null;
			throw error;
		}
	}
	async function removeDir(path) {
		for (let attempt = 1;; attempt += 1) try {
			await rm(path, {
				recursive: true,
				force: true
			});
			return;
		} catch (error) {
			if (!RETRYABLE.has(error?.code) || attempt >= 6) throw error;
			await sleep(30 * 2 ** attempt);
		}
	}
	async function listIds(dir, prefix) {
		try {
			return (await readdir(dir, { withFileTypes: true })).map((entry) => entry.isDirectory() ? entry.name : entry.name.replace(/\.json$/u, "")).filter((name) => name.startsWith(`${prefix}_`) && /^[a-z]{2,6}_[a-z0-9]{6,40}$/u.test(name));
		} catch (error) {
			if (error?.code === "ENOENT") return [];
			throw error;
		}
	}
	async function exists(path) {
		try {
			await stat(path);
			return true;
		} catch {
			return false;
		}
	}
	return Object.freeze({
		paths,
		readJson,
		writeJson,
		updateJson,
		writeBlob,
		readBlob,
		removeDir,
		listIds,
		exists
	});
}
const KIND_PREFIX = Object.freeze({
	assist: "thd",
	shorts: "sht",
	decks: "dck",
	sheets: "chs"
});
function assertKind(kind) {
	if (!Object.hasOwn(KIND_PREFIX, kind)) throw new TypeError(`unknown collection "${kind}"`);
	return kind;
}
//#endregion
//#region src/host/plugin-version.js
const PACKAGE_NAME = "dsh-aha-tutor";
const REGISTRY_LATEST_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const VERSION_TTL_MS = 5 * 6e4;
const VERSION_TIMEOUT_MS = 1e4;
const UPDATE_TIMEOUT_MS = 18e4;
const SETTLE_DELAY_MS = 250;
const RELEASE_AGE_ERROR = /ERR_PNPM_(?:NO_MATURE_MATCHING_VERSION|MINIMUM_RELEASE_AGE_VIOLATION)/u;
const RELEASE_AGE_ENTRY = /(\S+@\S+) was published at (\S+?), within the minimumReleaseAge cutoff \((\S+?)\)/gu;
function releaseAgeRefusal(output, finishedAt) {
	const textValue = String(output ?? "").replace(/\u001b\[[0-9;]*m/gu, "");
	if (!RELEASE_AGE_ERROR.test(textValue)) return void 0;
	let availableAt;
	for (const [, , published, cutoff] of textValue.matchAll(RELEASE_AGE_ENTRY)) {
		const clears = Date.parse(published) + (finishedAt - Date.parse(cutoff));
		if (Number.isFinite(clears) && (availableAt === void 0 || clears > availableAt)) availableAt = clears;
	}
	return availableAt === void 0 ? {} : { availableAt };
}
function parseSemver(value) {
	if (typeof value !== "string") return void 0;
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value.trim());
	if (!match) return void 0;
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		pre: match[4]
	};
}
function compareSemver(a, b) {
	const left = parseSemver(a);
	const right = parseSemver(b);
	if (!left || !right) return void 0;
	for (const key of [
		"major",
		"minor",
		"patch"
	]) if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
	if (left.pre === right.pre) return 0;
	if (left.pre === void 0) return 1;
	if (right.pre === void 0) return -1;
	return left.pre < right.pre ? -1 : 1;
}
function classifySpec(spec) {
	if (typeof spec !== "string" || !spec) return "unknown";
	if (/^(?:link|file):/u.test(spec)) return "link";
	if (/^(?:\d|[~^*])/u.test(spec)) return "npm";
	return "unknown";
}
async function readManifest(path) {
	try {
		const parsed = JSON.parse(await readFile(path, "utf8"));
		return parsed && typeof parsed === "object" ? parsed : void 0;
	} catch {
		return;
	}
}
async function findInstall({ dshHome, ownPackageJsonUrl }) {
	let ownReal;
	try {
		ownReal = await realpath(fileURLToPath(ownPackageJsonUrl));
	} catch {
		ownReal = void 0;
	}
	let entries = [];
	try {
		entries = await readdir(join(dshHome, "profiles"), { withFileTypes: true });
	} catch {
		entries = [];
	}
	const declared = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const profileDir = join(dshHome, "profiles", entry.name);
		const spec = (await readManifest(join(profileDir, "package.json")))?.dependencies?.[PACKAGE_NAME];
		if (typeof spec !== "string") continue;
		declared.push({
			profile: entry.name,
			spec
		});
		if (!ownReal) continue;
		try {
			if (await realpath(join(profileDir, "node_modules", "dsh-aha-tutor", "package.json")) === ownReal) return {
				kind: classifySpec(spec),
				profile: entry.name
			};
		} catch {}
	}
	if (declared.length === 1) return {
		kind: classifySpec(declared[0].spec),
		profile: declared[0].profile
	};
	return { kind: "unknown" };
}
const PNPM_SCRIPT = /[\\/]pnpm\.(?:mjs|cjs|js)$/u;
const isExistingPath = (value) => typeof value === "string" && value !== "" && existsSync(value);
const dshRuntimeRoot = (value) => isExistingPath(value) && existsSync(join(value, "node_modules", "@deepseek-ai", "dsh", "package.json")) ? value : void 0;
function resolvePnpm({ argv } = {}) {
	const entries = Array.isArray(argv) ? argv : [];
	for (const entry of entries) if (isExistingPath(entry) && PNPM_SCRIPT.test(entry)) return entry;
	for (const entry of entries) {
		const root = dshRuntimeRoot(entry);
		if (!root) continue;
		const script = join(root, "..", "pnpm", "bin", "pnpm.mjs");
		if (existsSync(script)) return script;
	}
}
function resolveLauncher({ argv, execPath, platform = process.platform }) {
	const pnpm = resolvePnpm({ argv });
	if (pnpm) return {
		command: execPath,
		prefix: [pnpm],
		shell: false
	};
	return platform === "win32" ? {
		command: "pnpm.cmd",
		prefix: [],
		shell: true
	} : {
		command: "pnpm",
		prefix: [],
		shell: false
	};
}
function spawnRunCommand({ command, args, cwd, shell }, { signal, timeoutMs }) {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason instanceof Error ? signal.reason : /* @__PURE__ */ new Error("plugin update aborted"));
			return;
		}
		const controller = new AbortController();
		const onAbort = () => controller.abort(signal.reason);
		signal?.addEventListener("abort", onAbort, { once: true });
		const timer = setTimeout(() => controller.abort(/* @__PURE__ */ new Error("plugin update timed out")), timeoutMs);
		let settled = false;
		const settle = (callback, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			callback(value);
		};
		let child;
		try {
			child = spawn(command, args, {
				stdio: [
					"ignore",
					"pipe",
					"pipe"
				],
				signal: controller.signal,
				windowsHide: true,
				shell: shell === true,
				...cwd ? { cwd } : {}
			});
		} catch (error) {
			settle(reject, error);
			return;
		}
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk) => {
			stdout = (stdout + chunk).slice(-8192);
		});
		child.stderr?.on("data", (chunk) => {
			stderr = (stderr + chunk).slice(-8192);
		});
		child.on("error", (error) => settle(reject, error));
		child.on("close", (code) => {
			if (controller.signal.aborted) {
				const reason = controller.signal.reason;
				settle(reject, reason instanceof Error ? reason : /* @__PURE__ */ new Error("plugin update aborted"));
				return;
			}
			settle(resolve, {
				code: code ?? 1,
				stdout,
				stderr
			});
		});
	});
}
async function confirmInstalled({ profileDir, expected, settleDelayMs }) {
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		if ((await readManifest(join(profileDir, "node_modules", "dsh-aha-tutor", "package.json")))?.version === expected) return;
		if (attempt < 3) await new Promise((resolve) => {
			setTimeout(resolve, settleDelayMs);
		});
	}
	throw new Error("plugin update did not install the requested version");
}
function createPluginManager({ fetchImpl = globalThis.fetch, runCommand = spawnRunCommand, execPath = process.execPath, argv = process.argv, env = process.env, platform = process.platform, ownPackageJsonUrl = new URL("../package.json", import.meta.url), registryUrl = REGISTRY_LATEST_URL, now = Date.now, ttlMs = VERSION_TTL_MS, timeoutMs = VERSION_TIMEOUT_MS, updateTimeoutMs = UPDATE_TIMEOUT_MS, settleDelayMs = SETTLE_DELAY_MS } = {}) {
	const dshHome = resolveDshHome(env);
	const launcher = resolveLauncher({
		argv,
		execPath,
		platform
	});
	let updating = false;
	let cached;
	let inflight;
	const fetchLatest = async (signal) => {
		const timeout = AbortSignal.timeout(timeoutMs);
		let response;
		try {
			response = await fetchImpl(registryUrl, {
				headers: { Accept: "application/json" },
				redirect: "error",
				signal: signal ? AbortSignal.any([signal, timeout]) : timeout
			});
		} catch (error) {
			if (signal?.aborted) throw signal.reason ?? error;
			throw new Error("plugin version check failed");
		}
		if (!response.ok) throw new Error("plugin version check failed");
		let version;
		try {
			version = (await response.json())?.version;
		} catch {
			version = void 0;
		}
		if (!parseSemver(version)) throw new Error("plugin version check failed");
		return version;
	};
	const readOwnVersion = async () => {
		const version = (await readManifest(fileURLToPath(ownPackageJsonUrl)))?.version;
		if (!parseSemver(version)) throw new Error("plugin version is unavailable");
		return version;
	};
	async function load(signal) {
		const [current, install, latest] = await Promise.all([
			readOwnVersion(),
			findInstall({
				dshHome,
				ownPackageJsonUrl
			}),
			fetchLatest(signal).catch((error) => {
				if (signal?.aborted) throw error;
				return null;
			})
		]);
		return {
			current,
			latest,
			latestUnknown: latest === null,
			updateAvailable: latest !== null && compareSemver(latest, current) === 1,
			install,
			fetchedAt: now()
		};
	}
	async function read({ force = false, signal } = {}) {
		if (!force && cached && now() - cached.fetchedAt < ttlMs) return cached;
		inflight ??= load(signal).then((value) => {
			cached = value;
			return value;
		}).finally(() => {
			inflight = void 0;
		});
		return inflight;
	}
	async function update({ signal } = {}) {
		signal?.throwIfAborted();
		if (updating) throw new Error("plugin update is already running");
		updating = true;
		try {
			const install = await findInstall({
				dshHome,
				ownPackageJsonUrl
			});
			if (install.kind === "link") throw new Error("plugin is installed from a local checkout");
			if (install.kind !== "npm" || !install.profile) throw new Error("plugin update could not find the owning profile");
			const latest = await fetchLatest(signal);
			if (!parseSemver(latest)) throw new Error("plugin version check failed");
			const profileDir = join(dshHome, "profiles", install.profile);
			let result;
			try {
				result = await runCommand({
					command: launcher.command,
					args: [
						...launcher.prefix,
						"add",
						"--save-exact",
						`${PACKAGE_NAME}@${latest}`
					],
					cwd: profileDir,
					shell: launcher.shell
				}, {
					signal,
					timeoutMs: updateTimeoutMs
				});
			} catch (error) {
				if (signal?.aborted) throw error;
				throw new Error("plugin update failed");
			}
			if (result.code !== 0) {
				const refusal = releaseAgeRefusal(`${result.stdout ?? ""}\n${result.stderr ?? ""}`, now());
				if (refusal) return {
					version: latest,
					profile: install.profile,
					pending: true,
					...refusal
				};
				throw new Error("plugin update failed");
			}
			await confirmInstalled({
				profileDir,
				expected: latest,
				settleDelayMs
			});
			cached = void 0;
			return {
				version: latest,
				profile: install.profile
			};
		} finally {
			updating = false;
		}
	}
	return Object.freeze({
		read,
		update,
		invalidate: () => {
			cached = void 0;
		}
	});
}
//#endregion
//#region src/host/projects.js
const READ_LIMIT_FILES = 40;
const READ_LIMIT_BYTES = 200 * 1024;
const SKIP_DIRS = /* @__PURE__ */ new Set([
	"node_modules",
	".git",
	".venv",
	"venv",
	"__pycache__",
	".idea",
	".vscode",
	"dist",
	"build",
	".next"
]);
const TEXT_FILE = /\.(md|txt|py|ipynb|js|mjs|ts|tsx|jsx|json|csv|tsv|sql|r|java|c|cc|cpp|h|hpp|cs|go|rs|rb|php|swift|kt|html|css|scss|yaml|yml|toml|ini|sh|ps1|tex)$/iu;
function createProjects({ store, llm, jobs, courses, projectsRoot = resolveProjectsRoot(), now = () => /* @__PURE__ */ new Date() }) {
	async function find(courseId, projectId) {
		const course = await courses.readCourse(courseId);
		const project = course.projects?.find((item) => item.id === assertId(projectId, "prj"));
		if (!project) throw new TutorError("not-found", "Project not found");
		return {
			course,
			project
		};
	}
	const folderOf = (course, project) => join(projectsRoot, `${safeFileName(course.title)}-${project.id.slice(4, 12)}`);
	async function get({ courseId, projectId }) {
		const { course, project } = await find(courseId, projectId);
		const progress = await store.readJson(store.paths.progress(courseId), null) ?? {};
		const folder = folderOf(course, project);
		let exists = false;
		try {
			exists = (await stat(folder)).isDirectory();
		} catch {
			exists = false;
		}
		return {
			project,
			language: course.language,
			workspace: exists ? folder : null,
			submissions: progress.projects?.[projectId]?.submissions ?? []
		};
	}
	async function openWorkspace({ courseId, projectId }) {
		const { course, project } = await find(courseId, projectId);
		const folder = folderOf(course, project);
		await mkdir(folder, { recursive: true });
		const zh = String(course.language).startsWith("zh");
		const files = [{
			path: "PROJECT.md",
			content: [
				`# ${project.title}`,
				"",
				project.brief,
				"",
				zh ? "## 里程碑" : "## Milestones",
				...project.milestones.map((item, index) => `${index + 1}. **${item.title}** ${item.detail ?? ""}`.trim()),
				"",
				zh ? "## 评分标准" : "## Rubric",
				...project.rubric.map((item) => `- ${item.criterion} (${item.points}) ${item.detail ?? ""}`.trim()),
				"",
				zh ? `> 来自课程「${course.title}」。完成后回到「开窍」提交，AI 老师会按评分标准点评。` : `> From the course "${course.title}". When you are done, submit it in Aha Tutor for a rubric-based review.`,
				""
			].join("\n")
		}, ...project.starterFiles];
		const written = [];
		for (const file of files) {
			const path = safeRelativePath(file.path);
			if (!path) continue;
			const target = join(folder, ...path.split("/"));
			if (!target.startsWith(folder + sep)) continue;
			try {
				await stat(target);
				continue;
			} catch {}
			await mkdir(join(target, ".."), { recursive: true });
			await writeFileAtomic(target, file.content);
			written.push(path);
		}
		return {
			path: folder,
			written,
			prompt: zh ? `我在做课程「${course.title}」里的实战项目「${project.title}」。请先阅读 PROJECT.md，帮我规划步骤，然后一步一步陪我完成。不要直接给出完整答案，先让我尝试，在我卡住时再提示。` : `I'm working on the project "${project.title}" from my course "${course.title}". Read PROJECT.md first, help me plan the steps, then guide me through them one at a time. Don't hand me the full solution; let me try first and give hints when I'm stuck.`,
			title: project.title
		};
	}
	async function readWorkspace(folder) {
		const files = [];
		let total = 0;
		const walk = async (dir) => {
			let entries;
			try {
				entries = await readdir(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				if (files.length >= READ_LIMIT_FILES || total >= READ_LIMIT_BYTES) return;
				const full = join(dir, entry.name);
				const info = await lstat(full).catch(() => null);
				if (!info || info.isSymbolicLink()) continue;
				if (info.isDirectory()) {
					if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) await walk(full);
					continue;
				}
				if (!TEXT_FILE.test(entry.name) || info.size > 80 * 1024) continue;
				const slice = (await readFile(full, "utf8").catch(() => "")).slice(0, Math.max(0, READ_LIMIT_BYTES - total));
				total += slice.length;
				files.push(`--- ${relative(folder, full).split(sep).join("/")} ---\n${slice}`);
			}
		};
		await walk(folder);
		return files.join("\n\n");
	}
	function submit({ courseId, projectId, notes, includeWorkspace = true }) {
		return jobs.start("project/review", async (api) => {
			const { course, project } = await find(courseId, projectId);
			const parts = [];
			const note = text(notes, 8e3);
			if (note) parts.push(`Learner's notes:\n${note}`);
			if (includeWorkspace) {
				const content = await readWorkspace(folderOf(course, project));
				if (content) parts.push(`Files in the project folder:\n${content}`);
			}
			if (!parts.length) throw new TutorError("nothing-to-review", "Nothing to review yet: write a note or work in the project folder first");
			const result = await generateJson(llm, {
				purpose: "teach",
				prompt: projectReviewPrompt({
					project,
					submission: parts.join("\n\n"),
					language: course.language
				}),
				maxTokens: 5e3,
				signal: api.signal,
				normalize: (raw) => {
					const scores = project.rubric.map((criterion) => {
						const entry = (raw?.scores ?? []).find((item) => item?.criterionId === criterion.id) ?? (raw?.scores ?? [])[project.rubric.indexOf(criterion)];
						const points = Math.min(criterion.points, Math.max(0, Math.round(Number(entry?.points) || 0)));
						return {
							criterionId: criterion.id,
							criterion: criterion.criterion,
							max: criterion.points,
							points,
							comment: text(entry?.comment, 600)
						};
					});
					return {
						scores,
						total: scores.reduce((sum, item) => sum + item.points, 0),
						max: scores.reduce((sum, item) => sum + item.max, 0),
						summary: text(raw?.summary, 1500),
						strengths: (raw?.strengths ?? []).map((item) => text(item, 300)).filter(Boolean).slice(0, 6),
						nextSteps: (raw?.nextSteps ?? []).map((item) => text(item, 300)).filter(Boolean).slice(0, 6)
					};
				}
			});
			const submission = {
				at: now().toISOString(),
				notes: note,
				review: result
			};
			await store.updateJson(store.paths.progress(courseId), null, (value) => {
				const next = value ?? {
					courseId,
					lessons: {},
					concepts: {},
					reviews: {},
					events: []
				};
				next.projects ??= {};
				const entry = next.projects[projectId] ?? { submissions: [] };
				entry.submissions = [...entry.submissions, submission].slice(-10);
				entry.status = result.max && result.total / result.max >= .7 ? "passed" : "in-progress";
				next.projects[projectId] = entry;
				return next;
			});
			return { submission };
		}, { key: `project:${courseId}:${projectId}` });
	}
	return Object.freeze({
		get,
		openWorkspace,
		submit
	});
}
//#endregion
//#region src/host/research.js
const MAX_QUERIES = 3;
const RESULTS_PER_QUERY = 6;
const MAX_SOURCES = 10;
const UNAVAILABLE = /* @__PURE__ */ new Set([
	"WEB_PROVIDER_UNAVAILABLE",
	"WEB_PROVIDER_CONFIGURED_MISSING",
	"WEB_PROVIDER_CONFIGURED_UNAVAILABLE",
	"WEB_PROVIDER_AMBIGUOUS"
]);
function cleanQueries(raw, goal) {
	const queries = [...new Set((Array.isArray(raw) ? raw : []).map((query) => text(query, 120)).filter(Boolean))].slice(0, MAX_QUERIES);
	return queries.length ? queries : [text(goal, 120)].filter(Boolean);
}
function mergeSources(lists) {
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	const longest = Math.max(0, ...lists.map((list) => list.length));
	for (let rank = 0; rank < longest && out.length < MAX_SOURCES; rank += 1) for (const list of lists) {
		const source = list[rank];
		const url = safeUrl(source?.url);
		if (!url || seen.has(url) || out.length >= MAX_SOURCES) continue;
		seen.add(url);
		out.push({
			url,
			title: text(source.title, 200) || new URL(url).hostname,
			snippet: text(source.snippet ?? source.text ?? source.excerpt, 400),
			publishedAt: text(source.publishedAt ?? source.date, 40)
		});
	}
	return out;
}
function safeUrl(value) {
	const raw = text(value, 500);
	if (!raw) return "";
	try {
		const url = new URL(raw);
		return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
	} catch {
		return "";
	}
}
function skipReason(error) {
	const code = String(error?.code ?? "");
	if (code === "WEB_PROVIDER_CREDENTIAL_MISSING") return "no-credential";
	if (UNAVAILABLE.has(code)) return "unavailable";
	return error ? "failed" : "empty";
}
function createResearch({ getWeb, llm, logger }) {
	async function run({ goal, language, signal, onSearching }) {
		const web = getWeb?.();
		if (typeof web?.search !== "function") return {
			skipped: "unavailable",
			sources: []
		};
		let queries;
		try {
			queries = await generateJson(llm, {
				purpose: "quick",
				prompt: researchQueriesPrompt({
					goal,
					language
				}),
				maxTokens: 400,
				signal,
				normalize: (raw) => cleanQueries(raw?.queries, goal)
			});
		} catch (error) {
			if (signal?.aborted) throw error;
			queries = cleanQueries([], goal);
		}
		onSearching?.(queries);
		const settled = await Promise.allSettled(queries.map((query) => web.search({
			query,
			maxResults: RESULTS_PER_QUERY
		}, signal)));
		signal?.throwIfAborted?.();
		const failure = settled.find((result) => result.status === "rejected")?.reason;
		if (failure) logger?.debug?.("aha-tutor web research: %s", failure?.code ?? failure?.message);
		const sources = mergeSources(settled.filter((result) => result.status === "fulfilled").map((result) => result.value?.sources ?? []));
		if (!sources.length) return {
			skipped: skipReason(failure),
			queries,
			sources: []
		};
		return {
			queries,
			sources,
			at: (/* @__PURE__ */ new Date()).toISOString()
		};
	}
	return Object.freeze({ run });
}
//#endregion
//#region src/host/rpc.js
const ID = (prefix) => new RegExp(`^${prefix}_[a-z0-9]{6,40}$`, "u");
const IDS = {
	crs: ID("crs"),
	les: ID("les"),
	unt: ID("unt"),
	prj: ID("prj"),
	mat: ID("mat"),
	job: ID("job"),
	thd: ID("thd"),
	sht: ID("sht"),
	chs: ID("chs"),
	dck: ID("dck"),
	exm: ID("exm"),
	nte: ID("nte"),
	asd: ID("asd"),
	evd: ID("evd")
};
function need(payload, key, prefix) {
	const value = payload?.[key];
	if (typeof value !== "string" || !IDS[prefix].test(value)) throw new TutorError("invalid", `Invalid ${key}`);
	return value;
}
function optional(payload, key, prefix) {
	return payload?.[key] === void 0 || payload?.[key] === null ? void 0 : need(payload, key, prefix);
}
function idList(value, prefix, max = 8) {
	return (Array.isArray(value) ? value : []).filter((item) => typeof item === "string" && IDS[prefix].test(item)).slice(0, max);
}
function scopeOf(payload) {
	const scope = payload?.scope ?? {};
	const jobId = optional(scope, "jobId", "job");
	const writing = jobId ? { jobId } : {};
	if (scope.kind === "lesson") return {
		kind: "lesson",
		courseId: need(scope, "courseId", "crs"),
		lessonId: need(scope, "lessonId", "les"),
		...writing
	};
	if (scope.kind === "thread") return {
		kind: "thread",
		id: need(scope, "id", "thd"),
		turn: Number(scope.turn) || 0,
		...writing
	};
	if (scope.kind === "short") return {
		kind: "short",
		id: need(scope, "id", "sht"),
		...writing
	};
	throw new TutorError("invalid", "Invalid board scope");
}
function challengeTarget(payload) {
	const target = payload?.target && typeof payload.target === "object" ? payload.target : {};
	if (target.step && typeof target.step === "object") return { step: target.step };
	if (typeof target.stepId !== "string" || !/^s\d{1,4}$/u.test(target.stepId)) throw new TutorError("invalid", "Invalid step");
	return {
		stepId: target.stepId,
		...target.asideId === void 0 ? {} : { asideId: need(target, "asideId", "asd") }
	};
}
function itemSource(payload) {
	const source = payload?.source && typeof payload.source === "object" ? payload.source : {};
	const itemId = () => {
		if (typeof source.itemId !== "string" || !/^[a-z0-9_-]{1,24}$/iu.test(source.itemId)) throw new TutorError("invalid", "Invalid question");
		return source.itemId;
	};
	if (source.kind === "practice") return {
		kind: "practice",
		courseId: need(source, "courseId", "crs"),
		lessonId: need(source, "lessonId", "les"),
		itemId: itemId()
	};
	if (source.kind === "quiz") return {
		kind: "quiz",
		courseId: need(source, "courseId", "crs"),
		unitId: need(source, "unitId", "unt"),
		itemId: itemId()
	};
	if (source.kind === "deck") return {
		kind: "deck",
		deckId: need(source, "deckId", "dck"),
		itemId: itemId()
	};
	if (source.kind === "check") {
		if (typeof source.stepId !== "string" || !/^s\d{1,4}$/u.test(source.stepId)) throw new TutorError("invalid", "Invalid step");
		return {
			kind: "check",
			courseId: need(source, "courseId", "crs"),
			lessonId: need(source, "lessonId", "les"),
			stepId: source.stepId
		};
	}
	throw new TutorError("invalid", "Invalid question");
}
function answerOf(value) {
	if (typeof value === "string") return value.slice(0, 4e3);
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	return Array.isArray(value) ? value.filter((id) => typeof id === "string" && /^[a-z]$/u.test(id)).slice(0, 12) : "";
}
function answeredItem(payload, courseId) {
	if (!payload?.source || payload.source.kind === "deck") return null;
	try {
		const source = itemSource(payload);
		return source.courseId === courseId ? {
			source,
			response: answerOf(payload.response)
		} : null;
	} catch {
		return null;
	}
}
function shownGrade(value) {
	const grade = value && typeof value === "object" ? value : {};
	const words = (key, max) => typeof grade[key] === "string" ? grade[key].slice(0, max) : "";
	return {
		score: Math.min(1, Math.max(0, Number(grade.score) || 0)),
		correct: grade.correct === true,
		partial: grade.partial === true,
		feedback: words("feedback", 1200),
		wrongStep: words("wrongStep", 400),
		fix: words("fix", 400)
	};
}
const ITEM_KINDS = {
	sheets: "chs",
	decks: "dck",
	assist: "thd",
	shorts: "sht"
};
const GRADES = [
	"again",
	"hard",
	"good",
	"easy"
];
const STYLES = [
	"analogy",
	"visual",
	"example",
	"simpler",
	"deeper"
];
function createRoutes({ courses, lessons, learner, studio, projects, jobs, settings, tts, plugin, info, speechInput }) {
	return {
		"app/info": () => info(),
		"job/get": (payload) => jobs.get(need(payload, "id", "job"), { since: Math.max(0, Number(payload.since) || 0) }) ?? { status: "missing" },
		"job/cancel": (payload) => jobs.cancel(need(payload, "id", "job")),
		"course/list": () => courses.list(),
		"course/get": (payload) => courses.get({ courseId: need(payload, "courseId", "crs") }),
		"course/start": (payload) => ({ job: courses.startCraft({
			goal: payload.goal,
			materialIds: idList(payload.materialIds, "mat"),
			quick: payload.quick === true,
			web: payload.web === true,
			language: typeof payload.language === "string" ? payload.language.slice(0, 12) : void 0
		}) }),
		"course/proposal-apply": (payload) => courses.applyProposal({ courseId: need(payload, "courseId", "crs") }),
		"course/proposal-discard": (payload) => courses.discardProposal({ courseId: need(payload, "courseId", "crs") }),
		"course/rework-lesson": (payload) => ({ job: courses.reworkLesson({
			courseId: need(payload, "courseId", "crs"),
			lesson: payload.lesson,
			unitTitle: payload.unitTitle,
			lectureTitle: payload.lectureTitle,
			mode: payload.mode === "split" ? "split" : "deepen"
		}) }),
		"course/intake": (payload) => ({ job: courses.submitIntake({
			courseId: need(payload, "courseId", "crs"),
			answers: payload.answers,
			timeline: payload.timeline,
			size: payload.size,
			weeklyMinutes: payload.weeklyMinutes,
			deadline: payload.deadline
		}) }),
		"course/revise": (payload) => ({ job: courses.revise({
			courseId: need(payload, "courseId", "crs"),
			instruction: payload.instruction
		}) }),
		"course/add-materials": (payload) => ({ job: courses.addMaterials({
			courseId: need(payload, "courseId", "crs"),
			materialIds: idList(payload.materialIds, "mat", 12),
			instruction: payload.instruction
		}) }),
		"course/save-blueprint": (payload) => courses.saveBlueprint({
			courseId: need(payload, "courseId", "crs"),
			blueprint: payload.blueprint
		}),
		"course/confirm": (payload) => ({ job: courses.confirm({ courseId: need(payload, "courseId", "crs") }) }),
		"course/update": (payload) => courses.update({
			courseId: need(payload, "courseId", "crs"),
			title: payload.title,
			archived: payload.archived,
			settings: payload.settings
		}),
		"course/remove": (payload) => courses.remove({ courseId: need(payload, "courseId", "crs") }),
		"course/export": async (payload) => courses.exportPack({
			courseId: need(payload, "courseId", "crs"),
			includeProgress: payload.includeProgress === true,
			appVersion: (await info()).version
		}),
		"course/import": (payload) => {
			if (typeof payload.json !== "string") throw new TutorError("invalid", "Choose a course pack file");
			return courses.importPack({ json: payload.json });
		},
		"course/card-session": (payload) => lessons.cardSession({ courseId: need(payload, "courseId", "crs") }),
		"course/card-review": (payload) => {
			if (!GRADES.includes(payload.grade)) throw new TutorError("invalid", "Invalid grade");
			return lessons.reviewCard({
				courseId: need(payload, "courseId", "crs"),
				unitId: optional(payload, "unitId", "unt"),
				cardId: String(payload.cardId ?? "").slice(0, 12),
				grade: payload.grade
			});
		},
		"lesson/get": (payload) => lessons.get({
			courseId: need(payload, "courseId", "crs"),
			lessonId: need(payload, "lessonId", "les")
		}),
		"lesson/prepare": (payload) => lessons.prepare({
			courseId: need(payload, "courseId", "crs"),
			lessonId: need(payload, "lessonId", "les"),
			force: payload.force === true,
			style: payload.style
		}),
		"lesson/ask": (payload) => ({ job: lessons.ask({
			scope: scopeOf(payload),
			stepIndex: payload.stepIndex,
			question: payload.question,
			anchorStepId: payload.anchorStepId
		}) }),
		"lesson/reexplain": (payload) => ({ job: lessons.reexplain({
			scope: scopeOf(payload),
			stepIndex: payload.stepIndex,
			style: STYLES.includes(payload.style) ? payload.style : "example",
			anchorStepId: payload.anchorStepId
		}) }),
		"lesson/challenge": (payload) => ({ job: lessons.challenge({
			scope: scopeOf(payload),
			stepIndex: payload.stepIndex,
			anchorStepId: payload.anchorStepId,
			target: challengeTarget(payload),
			note: typeof payload.note === "string" ? payload.note : ""
		}) }),
		"lesson/record": (payload) => lessons.record({
			courseId: need(payload, "courseId", "crs"),
			lessonId: optional(payload, "lessonId", "les"),
			item: answeredItem(payload, need(payload, "courseId", "crs")),
			conceptIds: (Array.isArray(payload.conceptIds) ? payload.conceptIds : []).filter((id) => /^cpt_[a-z0-9]{6,40}$/u.test(String(id))).slice(0, 8),
			evidence: {
				kind: payload.evidence?.kind,
				score: payload.evidence?.score,
				confidence: payload.evidence?.confidence,
				hintsUsed: payload.evidence?.hintsUsed,
				timeMs: payload.evidence?.timeMs,
				expectedMs: payload.evidence?.expectedMs,
				errorTag: typeof payload.evidence?.errorTag === "string" ? payload.evidence.errorTag.slice(0, 80) : void 0,
				rating: payload.evidence?.rating
			}
		}),
		"lesson/grade": (payload) => lessons.grade({
			item: payload.item,
			response: payload.response,
			language: typeof payload.language === "string" ? payload.language.slice(0, 12) : void 0
		}),
		"item/challenge": (payload) => ({ job: lessons.challengeItem({
			source: itemSource(payload),
			response: answerOf(payload.response),
			shown: shownGrade(payload.shown),
			evidenceId: optional(payload, "evidenceId", "evd"),
			note: typeof payload.note === "string" ? payload.note : ""
		}) }),
		"lesson/correct": (payload) => ({ job: lessons.correct({
			scope: scopeOf(payload),
			stepIndex: payload.stepIndex,
			anchorStepId: payload.anchorStepId,
			item: payload.item,
			response: payload.response,
			grade: payload.grade
		}) }),
		"lesson/position": (payload) => lessons.savePosition({
			courseId: need(payload, "courseId", "crs"),
			lessonId: need(payload, "lessonId", "les"),
			stepIndex: payload.stepIndex
		}),
		"lesson/complete": (payload) => lessons.complete({
			courseId: need(payload, "courseId", "crs"),
			lessonId: need(payload, "lessonId", "les"),
			selfRating: Number(payload.selfRating) || void 0
		}),
		"lesson/handout": (payload) => lessons.handout({
			courseId: need(payload, "courseId", "crs"),
			lessonId: need(payload, "lessonId", "les"),
			force: payload.force === true
		}),
		"lesson/practice": (payload) => lessons.practice({
			courseId: need(payload, "courseId", "crs"),
			lessonId: need(payload, "lessonId", "les")
		}),
		"unit/sheet": (payload) => lessons.unitSheet({
			courseId: need(payload, "courseId", "crs"),
			unitId: need(payload, "unitId", "unt"),
			force: payload.force === true
		}),
		"unit/sheet-layout": (payload) => lessons.saveSheetLayout({
			courseId: need(payload, "courseId", "crs"),
			unitId: need(payload, "unitId", "unt"),
			layout: payload.layout
		}),
		"unit/quiz": (payload) => lessons.unitQuiz({
			courseId: need(payload, "courseId", "crs"),
			unitId: need(payload, "unitId", "unt"),
			force: payload.force === true
		}),
		"unit/cards": (payload) => lessons.unitCards({
			courseId: need(payload, "courseId", "crs"),
			unitId: need(payload, "unitId", "unt")
		}),
		"profile/get": () => learner.getProfile(),
		"profile/save": (payload) => learner.saveProfile({
			name: payload.name,
			background: payload.background,
			goals: payload.goals,
			strengths: payload.strengths,
			weaknesses: payload.weaknesses,
			preferences: payload.preferences,
			notes: payload.notes
		}),
		"profile/clear": () => learner.clearProfile(),
		"profile/remove-note": (payload) => learner.removeNote({ id: need(payload, "id", "nte") }),
		"plan/get": (payload) => learner.plan({ today: payload.today }),
		"plan/check": (payload) => learner.check({
			today: payload.today,
			day: payload.day,
			item: payload.item
		}),
		"plan/uncheck": (payload) => learner.uncheck({
			today: payload.today,
			day: String(payload.day ?? "").slice(0, 10),
			refId: String(payload.refId ?? "").slice(0, 80)
		}),
		"plan/settings": (payload) => learner.savePlanSettings({
			weeklyMinutes: payload.weeklyMinutes,
			studyDays: payload.studyDays
		}),
		"plan/add-exam": (payload) => learner.addExam({
			title: payload.title,
			day: payload.day,
			courseId: payload.courseId
		}),
		"plan/remove-exam": (payload) => learner.removeExam({ id: need(payload, "id", "exm") }),
		"review/session": (payload) => learner.reviewSession({ courseId: optional(payload, "courseId", "crs") }),
		"material/upload": (payload) => ({ job: studio.upload({
			name: payload.name,
			base64: payload.base64
		}) }),
		"material/url": (payload) => ({ job: studio.addUrl({ url: payload.url }) }),
		"material/list": () => studio.listMaterials(),
		"material/search": (payload) => studio.searchMaterials({ query: typeof payload.query === "string" ? payload.query : "" }),
		"material/get": (payload) => studio.getMaterial({ id: need(payload, "id", "mat") }),
		"material/rename": (payload) => studio.renameMaterial({
			id: need(payload, "id", "mat"),
			title: payload.title
		}),
		"material/remove": (payload) => studio.removeMaterial({ id: need(payload, "id", "mat") }),
		"material/digest": (payload) => ({ job: studio.digest({ id: need(payload, "id", "mat") }) }),
		"studio/sheet": (payload) => ({ job: studio.makeSheet({
			materialIds: idList(payload.materialIds, "mat"),
			focus: payload.focus
		}) }),
		"studio/notes": (payload) => ({ job: studio.makeNotes({
			materialIds: idList(payload.materialIds, "mat"),
			focus: payload.focus
		}) }),
		"studio/cards": (payload) => ({ job: studio.makeCards({
			materialIds: idList(payload.materialIds, "mat"),
			focus: payload.focus
		}) }),
		"studio/quiz": (payload) => ({ job: studio.makeQuiz({
			materialIds: idList(payload.materialIds, "mat"),
			focus: payload.focus
		}) }),
		"items/list": (payload) => {
			if (!ITEM_KINDS[payload.kind]) throw new TutorError("invalid", "Unknown collection");
			return studio.listItems({ kind: payload.kind });
		},
		"items/get": (payload) => {
			const prefix = ITEM_KINDS[payload.kind];
			if (!prefix) throw new TutorError("invalid", "Unknown collection");
			return studio.getItem({
				kind: payload.kind,
				id: need(payload, "id", prefix)
			});
		},
		"items/remove": (payload) => {
			const prefix = ITEM_KINDS[payload.kind];
			if (!prefix) throw new TutorError("invalid", "Unknown collection");
			return studio.removeItem({
				kind: payload.kind,
				id: need(payload, "id", prefix)
			});
		},
		"items/sheet-layout": (payload) => studio.saveStandaloneLayout({
			id: need(payload, "id", "chs"),
			layout: payload.layout
		}),
		"items/card-review": (payload) => {
			if (!GRADES.includes(payload.grade)) throw new TutorError("invalid", "Invalid grade");
			return studio.reviewDeckCard({
				id: need(payload, "id", "dck"),
				cardId: String(payload.cardId ?? "").slice(0, 12),
				grade: payload.grade
			});
		},
		"assist/ask": (payload) => ({ job: studio.assist({
			mode: payload.mode,
			request: payload.request,
			materialIds: idList(payload.materialIds, "mat"),
			threadId: optional(payload, "threadId", "thd"),
			newThreadId: optional(payload, "newThreadId", "thd")
		}) }),
		"short/make": (payload) => ({ job: studio.makeShort({
			topic: payload.topic,
			url: typeof payload.url === "string" && payload.url.trim() ? payload.url.trim().slice(0, 2e3) : void 0,
			newId: optional(payload, "newId", "sht")
		}) }),
		"project/get": (payload) => projects.get({
			courseId: need(payload, "courseId", "crs"),
			projectId: need(payload, "projectId", "prj")
		}),
		"project/open": (payload) => projects.openWorkspace({
			courseId: need(payload, "courseId", "crs"),
			projectId: need(payload, "projectId", "prj")
		}),
		"project/submit": (payload) => ({ job: projects.submit({
			courseId: need(payload, "courseId", "crs"),
			projectId: need(payload, "projectId", "prj"),
			notes: payload.notes,
			includeWorkspace: payload.includeWorkspace !== false
		}) }),
		"tts/speak": async (payload) => {
			const textValue = typeof payload.text === "string" ? payload.text.slice(0, 4e3) : "";
			const result = await tts.speak({
				text: textValue,
				provider: payload.provider
			});
			return {
				base64: result.audio.toString("base64"),
				mime: result.mime,
				cached: result.cached === true
			};
		},
		"speech/status": () => speechInput.status(),
		"speech/transcribe": async (payload) => {
			const encoded = typeof payload.base64 === "string" ? payload.base64 : "";
			if (encoded.length > Math.ceil(3840044 / 3) * 4) throw new TutorError("speech-too-long", "The recording is too long");
			const audio = Buffer.from(encoded, "base64");
			if (!encoded || audio.toString("base64") !== encoded) throw new TutorError("speech-audio", "The recording could not be read");
			return speechInput.transcribe({ audio: new Uint8Array(audio.buffer, audio.byteOffset, audio.byteLength) });
		},
		"settings/get": () => settings.get(),
		"settings/save": (payload) => settings.save(payload.settings ?? {}),
		"settings/set-key": (payload) => settings.setKey({
			provider: payload.provider,
			key: payload.key
		}),
		"settings/clear-key": (payload) => settings.clearKey({ provider: payload.provider }),
		"models/list": () => settings.models(),
		"plugin/version": (payload) => plugin.read({ force: payload.force === true }),
		"plugin/update": () => plugin.update()
	};
}
const isOwner = (peer) => peer === void 0 || peer?.principal?.kind === "owner" || peer?.kind === "owner";
function createRpcHandler(routes, { logger, checkPeer = isOwner } = {}) {
	return async (endpoint, payload, signal, peer) => {
		if (!checkPeer(peer)) return failure("forbidden", "Not allowed");
		const route = Object.hasOwn(routes, endpoint) ? routes[endpoint] : void 0;
		if (!route) return failure("unknown-endpoint", "Unknown request");
		try {
			return {
				ok: true,
				value: await route(payload && typeof payload === "object" ? payload : {}, signal) ?? null
			};
		} catch (error) {
			if (signal?.aborted) throw error;
			if (![
				"TutorError",
				"MaterialError",
				"TtsError"
			].includes(error?.name)) logger?.warn?.("aha-tutor %s failed: %s", endpoint, error?.message);
			return failure(publicCode(error), publicMessage(error));
		}
	};
}
function failure(code, message) {
	return {
		ok: false,
		error: {
			code: `aha-tutor/${code}`,
			message,
			details: {}
		}
	};
}
//#endregion
//#region src/host/samples.js
const FILE = /^([a-z0-9-]{2,60})\.aha-course\.json$/u;
function createSamples({ dirUrl, courses }) {
	const dir = fileURLToPath(dirUrl);
	async function list() {
		let names = [];
		try {
			names = await readdir(dir);
		} catch {
			return [];
		}
		const rows = [];
		for (const name of names.sort()) {
			const match = FILE.exec(name);
			if (!match) continue;
			try {
				const pack = parseCoursePack(await readFile(join(dir, name), "utf8"));
				rows.push({
					id: match[1],
					title: pack.course.title,
					subtitle: pack.course.subtitle ?? "",
					emoji: pack.course.emoji ?? "📘",
					language: pack.course.language ?? "zh-CN"
				});
			} catch {}
		}
		return rows;
	}
	async function importSample({ id }) {
		if (!/^[a-z0-9-]{2,60}$/u.test(String(id))) throw new TutorError("invalid", "Unknown sample");
		let json;
		try {
			json = await readFile(join(dir, `${id}.aha-course.json`), "utf8");
		} catch {
			throw new TutorError("not-found", "Sample not found");
		}
		return courses.importPack({ json });
	}
	return Object.freeze({
		list,
		importSample
	});
}
//#endregion
//#region src/host/tts.js
const TTS_PROVIDERS = Object.freeze([
	"openai",
	"volcengine",
	"minimax",
	"azure"
]);
const TTS_LIMITS = Object.freeze({
	totalMs: 45e3,
	quietMs: 1e4
});
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_JSON_BYTES = 3 * MAX_AUDIO_BYTES;
const CACHE_MAX_BYTES = 300 * 1024 * 1024;
var TtsError = class extends Error {
	constructor(code, message, status) {
		super(message);
		this.name = "TtsError";
		this.code = code;
		this.status = status;
	}
};
const PROVIDER_FIELDS = Object.freeze({
	openai: [
		{
			key: "baseUrl",
			default: "https://api.openai.com/v1"
		},
		{
			key: "model",
			default: "gpt-4o-mini-tts"
		},
		{
			key: "voice",
			default: "alloy"
		},
		{
			key: "apiKey",
			secret: true
		}
	],
	volcengine: [
		{
			key: "appId",
			default: ""
		},
		{
			key: "cluster",
			default: "volcano_tts"
		},
		{
			key: "voice",
			default: "BV001_streaming"
		},
		{
			key: "apiKey",
			secret: true
		}
	],
	minimax: [
		{
			key: "baseUrl",
			default: "https://api.minimaxi.com"
		},
		{
			key: "groupId",
			default: ""
		},
		{
			key: "model",
			default: "speech-02-hd"
		},
		{
			key: "voice",
			default: "female-shaonv"
		},
		{
			key: "apiKey",
			secret: true
		}
	],
	azure: [
		{
			key: "region",
			default: "eastasia"
		},
		{
			key: "voice",
			default: "zh-CN-XiaoxiaoNeural"
		},
		{
			key: "apiKey",
			secret: true
		}
	]
});
function providerDefaults(provider) {
	const fields = PROVIDER_FIELDS[provider] ?? [];
	return Object.fromEntries(fields.filter((field) => !field.secret).map((field) => [field.key, field.default]));
}
function checkEndpoint(value) {
	let url;
	try {
		url = new URL(String(value));
	} catch {
		throw new TtsError("address", "TTS address is not a valid URL");
	}
	const local = [
		"localhost",
		"127.0.0.1",
		"[::1]"
	].includes(url.hostname);
	if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new TtsError("address", "TTS address must use https (http only for localhost)");
	if (url.username || url.password) throw new TtsError("address", "TTS address must not contain credentials");
	return url;
}
const SENTENCE_END = /([。！？!?；;…]+|\.(?=\s)|\n+)/u;
function splitForTts(content, maxUnits) {
	const textValue = String(content ?? "").trim();
	if (!textValue) return [];
	const units = (value) => [...value].reduce((sum, char) => sum + (char.charCodeAt(0) > 127 ? 3 : 1), 0);
	if (units(textValue) <= maxUnits) return [textValue];
	const pieces = textValue.split(SENTENCE_END).reduce((acc, part, index, all) => {
		if (index % 2 === 0) acc.push(part + (all[index + 1] ?? ""));
		return acc;
	}, []).map((part) => part.trim()).filter(Boolean);
	const chunks = [];
	let current = "";
	for (const piece of pieces) {
		if (units(piece) > maxUnits) {
			if (current) chunks.push(current);
			current = "";
			let buffer = "";
			for (const char of piece) {
				if (units(buffer + char) > maxUnits) {
					chunks.push(buffer);
					buffer = "";
				}
				buffer += char;
			}
			if (buffer) current = buffer;
			continue;
		}
		if (units(`${current}${piece}`) > maxUnits) {
			chunks.push(current);
			current = piece;
		} else current += piece;
	}
	if (current) chunks.push(current);
	return chunks;
}
function firstByteMs(text, limits = TTS_LIMITS) {
	return Math.min(limits.totalMs, limits.quietMs + Math.round(estimateSpeechMs(text) / 10));
}
async function boundedFetch(fetchImpl, url, init, { text, signal, limits, maxBytes }) {
	const limit = new AbortController();
	let reason = null;
	const stop = (code) => {
		reason ??= code;
		limit.abort();
	};
	const total = setTimeout(() => stop("timeout"), limits.totalMs);
	let quiet = setTimeout(() => stop("stalled"), firstByteMs(text, limits));
	const combined = signal ? AbortSignal.any([signal, limit.signal]) : limit.signal;
	const failure = (error) => {
		if (signal?.aborted) return signal.reason ?? error;
		if (reason === "stalled") return new TtsError("stalled", "The TTS service is not responding");
		if (reason === "timeout") return new TtsError("timeout", "TTS request timed out");
		return null;
	};
	try {
		let response;
		try {
			response = await fetchImpl(url, {
				...init,
				redirect: "error",
				signal: combined
			});
		} catch (error) {
			throw failure(error) ?? new TtsError("network", "Could not reach the TTS service");
		}
		if (!response.ok) {
			response.body?.cancel().catch(() => void 0);
			throw httpError(response.status);
		}
		const length = Number(response.headers.get("content-length"));
		if (Number.isFinite(length) && length > maxBytes) throw new TtsError("too-large", "TTS response is too large");
		const parts = [];
		let size = 0;
		const reader = response.body?.getReader();
		while (reader) {
			let chunk;
			try {
				chunk = await reader.read();
			} catch (error) {
				throw failure(error) ?? error;
			}
			if (chunk.done) break;
			if (!chunk.value?.byteLength) continue;
			clearTimeout(quiet);
			quiet = setTimeout(() => stop("stalled"), limits.quietMs);
			size += chunk.value.byteLength;
			if (size > maxBytes) {
				reader.cancel().catch(() => void 0);
				throw new TtsError("too-large", "TTS response is too large");
			}
			parts.push(chunk.value);
		}
		return Buffer.concat(parts);
	} finally {
		clearTimeout(total);
		clearTimeout(quiet);
	}
}
function parseJson(body, service) {
	try {
		return JSON.parse(body.toString("utf8"));
	} catch {
		throw new TtsError("response", `${service} returned an unreadable response`);
	}
}
function httpError(status) {
	if (status === 401 || status === 403) return new TtsError("auth", "The TTS service rejected the key", status);
	if (status === 429) return new TtsError("rate-limit", "The TTS service is rate limiting requests", status);
	if (status >= 500) return new TtsError("server", "The TTS service returned a server error", status);
	return new TtsError("request", `The TTS service refused the request (${status})`, status);
}
function rateNumber(rate) {
	const value = Number(rate);
	return Number.isFinite(value) ? Math.min(2, Math.max(.5, value)) : 1;
}
function xmlEscape(value) {
	return String(value).replace(/[<>&'"]/gu, (char) => ({
		"<": "&lt;",
		">": "&gt;",
		"&": "&amp;",
		"'": "&apos;",
		"\"": "&quot;"
	})[char]);
}
const synthesizers = {
	async openai({ text, config, secret, rate, send }) {
		const base = checkEndpoint(config.baseUrl || "https://api.openai.com/v1");
		const path = base.pathname.replace(/\/+$/u, "");
		return send(new URL(`${path}/audio/speech`, base), {
			method: "POST",
			headers: {
				Authorization: `Bearer ${secret}`,
				"Content-Type": "application/json",
				Accept: "audio/mpeg"
			},
			body: JSON.stringify({
				model: config.model || "gpt-4o-mini-tts",
				input: text,
				voice: config.voice || "alloy",
				response_format: "mp3",
				speed: rateNumber(rate)
			})
		}, MAX_AUDIO_BYTES);
	},
	async volcengine({ text, config, secret, rate, send }) {
		if (!config.appId) throw new TtsError("app-id", "Volcengine App ID is required");
		const body = parseJson(await send("https://openspeech.bytedance.com/api/v1/tts", {
			method: "POST",
			headers: {
				Authorization: `Bearer;${secret}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				app: {
					appid: config.appId,
					token: "access_token",
					cluster: config.cluster || "volcano_tts"
				},
				user: { uid: "aha-tutor" },
				audio: {
					voice_type: config.voice || "BV001_streaming",
					encoding: "mp3",
					speed_ratio: rateNumber(rate)
				},
				request: {
					reqid: randomUUID(),
					text,
					operation: "query"
				}
			})
		}, MAX_JSON_BYTES), "Volcengine");
		if (body?.code !== 3e3 || typeof body?.data !== "string") throw new TtsError(body?.code === 3001 || body?.code === 3003 ? "auth" : "request", `Volcengine TTS failed (${body?.code ?? "unknown"})`);
		const audio = Buffer.from(body.data, "base64");
		if (audio.length > MAX_AUDIO_BYTES) throw new TtsError("too-large", "TTS response is too large");
		return audio;
	},
	async minimax({ text, config, secret, rate, send }) {
		const base = checkEndpoint(config.baseUrl || "https://api.minimaxi.com");
		const url = new URL("/v1/t2a_v2", base);
		if (config.groupId) url.searchParams.set("GroupId", config.groupId);
		const body = parseJson(await send(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${secret}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				model: config.model || "speech-02-hd",
				text,
				stream: false,
				voice_setting: {
					voice_id: config.voice || "female-shaonv",
					speed: rateNumber(rate),
					vol: 1,
					pitch: 0
				},
				audio_setting: {
					sample_rate: 32e3,
					bitrate: 128e3,
					format: "mp3",
					channel: 1
				}
			})
		}, MAX_JSON_BYTES), "MiniMax");
		const status = body?.base_resp?.status_code;
		if (status !== 0 || typeof body?.data?.audio !== "string") throw new TtsError(status === 1004 || status === 2049 ? "auth" : "request", `MiniMax TTS failed (${status ?? "unknown"})`);
		const audio = Buffer.from(body.data.audio, "hex");
		if (audio.length > MAX_AUDIO_BYTES) throw new TtsError("too-large", "TTS response is too large");
		return audio;
	},
	async azure({ text, config, secret, rate, send }) {
		const region = String(config.region || "").trim().toLowerCase();
		if (!/^[a-z0-9]{2,30}$/u.test(region)) throw new TtsError("azure", "Azure region is invalid");
		const voice = String(config.voice || "zh-CN-XiaoxiaoNeural");
		if (!/^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z0-9:]+$/u.test(voice)) throw new TtsError("azure", "Azure voice name is invalid");
		const lang = voice.split("-").slice(0, 2).join("-");
		const percent = Math.round((rateNumber(rate) - 1) * 100);
		const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}"><prosody rate="${percent >= 0 ? "+" : ""}${percent}%">${xmlEscape(text)}</prosody></voice></speak>`;
		return send(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
			method: "POST",
			headers: {
				"Ocp-Apim-Subscription-Key": secret,
				"Content-Type": "application/ssml+xml",
				"X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
				"User-Agent": "dsh-aha-tutor"
			},
			body: ssml
		}, MAX_AUDIO_BYTES);
	}
};
const CHUNK_UNITS = Object.freeze({
	openai: 3800,
	volcengine: 900,
	minimax: 9e3,
	azure: 6e3
});
function createTts({ cacheDir, fetchImpl = globalThis.fetch, getSecret, limits = TTS_LIMITS }) {
	if (typeof getSecret !== "function") throw new TypeError("createTts needs getSecret");
	let pruning;
	const cacheKey = (provider, config, rate, text) => createHash("sha256").update(JSON.stringify([
		provider,
		config.baseUrl ?? "",
		config.model ?? "",
		config.voice ?? "",
		config.cluster ?? "",
		config.region ?? "",
		rateNumber(rate),
		text
	])).digest("hex").slice(0, 40);
	async function synthesize({ provider, config = {}, text, rate = 1, signal }) {
		if (!TTS_PROVIDERS.includes(provider)) throw new TtsError("config", "Unknown TTS provider");
		const content = String(text ?? "").trim().slice(0, 4e3);
		if (!content) throw new TtsError("empty", "Nothing to speak");
		const merged = {
			...providerDefaults(provider),
			...config
		};
		const key = cacheKey(provider, merged, rate, content);
		const file = cacheDir ? join(cacheDir, `${key}.mp3`) : null;
		if (file) try {
			const cached = await readFile(file);
			if (cached.length > 0) return {
				audio: cached,
				mime: "audio/mpeg",
				cached: true
			};
		} catch {}
		const secret = await getSecret(provider);
		if (!secret) throw new TtsError("no-key", "No key saved for this TTS provider");
		const parts = [];
		for (const chunk of splitForTts(content, CHUNK_UNITS[provider])) {
			const send = (url, init, maxBytes) => boundedFetch(fetchImpl, url, init, {
				text: chunk,
				signal,
				limits,
				maxBytes
			});
			parts.push(await synthesizers[provider]({
				text: chunk,
				config: merged,
				secret,
				rate,
				send
			}));
		}
		const audio = Buffer.concat(parts);
		if (!audio.length) throw new TtsError("response", "The TTS service returned no audio");
		if (file) {
			await mkdir(cacheDir, { recursive: true }).then(() => writeFileAtomic(file, audio)).catch(() => void 0);
			pruning ??= prune().finally(() => {
				pruning = void 0;
			});
		}
		return {
			audio,
			mime: "audio/mpeg",
			cached: false
		};
	}
	async function prune() {
		if (!cacheDir) return;
		let names;
		try {
			names = await readdir(cacheDir);
		} catch {
			return;
		}
		const files = [];
		for (const name of names) {
			if (!name.endsWith(".mp3")) continue;
			try {
				const info = await stat(join(cacheDir, name));
				files.push({
					name,
					size: info.size,
					time: info.mtimeMs
				});
			} catch {}
		}
		let total = files.reduce((sum, file) => sum + file.size, 0);
		for (const file of files.sort((a, b) => a.time - b.time)) {
			if (total <= CACHE_MAX_BYTES) break;
			await unlink(join(cacheDir, file.name)).catch(() => void 0);
			total -= file.size;
		}
	}
	return Object.freeze({
		synthesize,
		prune
	});
}
//#endregion
//#region src/host/settings.js
const PREF_DEFAULTS = Object.freeze({
	teachProvider: "",
	teachModel: "",
	quickProvider: "",
	quickModel: "",
	voiceEngine: "browser",
	voiceRate: 1,
	boardTheme: "auto",
	boardFont: "hand",
	boardView: "canvas",
	textSize: "standard",
	ttsProvider: "openai",
	tts: Object.fromEntries(TTS_PROVIDERS.map((provider) => [provider, providerDefaults(provider)]))
});
const ROUTE = /^[\w.:@/-]{0,200}$/u;
function cleanPrefs(input = {}, base = PREF_DEFAULTS) {
	const next = {
		...base,
		tts: { ...base.tts }
	};
	for (const key of [
		"teachProvider",
		"teachModel",
		"quickProvider",
		"quickModel"
	]) if (input[key] !== void 0) next[key] = ROUTE.test(String(input[key])) ? String(input[key]) : base[key];
	if ([
		"browser",
		"cloud",
		"off"
	].includes(input.voiceEngine)) next.voiceEngine = input.voiceEngine;
	if (input.voiceRate !== void 0) {
		const rate = Number(input.voiceRate);
		if (Number.isFinite(rate)) next.voiceRate = Math.min(2, Math.max(.5, Math.round(rate * 100) / 100));
	}
	if ([
		"auto",
		"light",
		"dark"
	].includes(input.boardTheme)) next.boardTheme = input.boardTheme;
	if (["hand", "standard"].includes(input.boardFont)) next.boardFont = input.boardFont;
	if (["canvas", "pages"].includes(input.boardView)) next.boardView = input.boardView;
	if ([
		"standard",
		"large",
		"larger"
	].includes(input.textSize)) next.textSize = input.textSize;
	if (TTS_PROVIDERS.includes(input.ttsProvider)) next.ttsProvider = input.ttsProvider;
	for (const provider of TTS_PROVIDERS) {
		const patch = input.tts?.[provider];
		if (!patch || typeof patch !== "object") continue;
		for (const field of PROVIDER_FIELDS[provider]) {
			if (field.secret || patch[field.key] === void 0) continue;
			next.tts[provider] = {
				...next.tts[provider],
				[field.key]: String(patch[field.key]).trim().slice(0, 300)
			};
		}
	}
	return next;
}
function createPrefs(store) {
	let cache = { ...PREF_DEFAULTS };
	return {
		async load() {
			cache = cleanPrefs(await store.readJson(store.paths.prefs(), null) ?? {}, PREF_DEFAULTS);
			return cache;
		},
		read: () => cache,
		async save(patch) {
			cache = cleanPrefs(patch, cache);
			await store.writeJson(store.paths.prefs(), cache);
			return cache;
		}
	};
}
function createKeyStore({ getCredentials, credentialKey }) {
	const keyOf = (provider) => {
		if (!TTS_PROVIDERS.includes(provider)) throw new TutorError("invalid", "Unknown TTS provider");
		return credentialKey("aha-tutor", `tts-${provider}`);
	};
	const service = () => {
		const credentials = getCredentials();
		if (!credentials) throw new TutorError("no-credentials", "DSH credentials are not available in this profile");
		return credentials;
	};
	return {
		async read(provider) {
			const record = await service().readRecord(keyOf(provider));
			return record?.kind === "api-key" && typeof record.key === "string" ? record.key : void 0;
		},
		async status() {
			const result = {};
			for (const provider of TTS_PROVIDERS) try {
				result[provider] = (await service().describeRecord(keyOf(provider)))?.configured === true;
			} catch {
				result[provider] = false;
			}
			return result;
		},
		async write(provider, value) {
			const key = String(value ?? "").trim();
			if (!/^[\x21-\x7E]{8,1024}$/u.test(key)) throw new TutorError("bad-key", "The key looks wrong (8–1024 printable characters, no spaces)");
			await service().modifyRecord(keyOf(provider), async () => ({
				kind: "api-key",
				key
			}));
		},
		async remove(provider) {
			await service().deleteRecord(keyOf(provider));
		}
	};
}
function createSettingsService({ prefs, keys, llmPort }) {
	return {
		async get() {
			const value = prefs.read();
			let keyStatus = {};
			try {
				keyStatus = await keys.status();
			} catch {
				keyStatus = {};
			}
			return {
				...value,
				keys: keyStatus,
				fields: PROVIDER_FIELDS,
				images: {
					teach: llmPort.supportsImages("teach"),
					quick: llmPort.supportsImages("quick")
				}
			};
		},
		async save(patch) {
			await prefs.save(patch);
			llmPort.refreshCapabilities().catch(() => void 0);
			return this.get();
		},
		async setKey({ provider, key }) {
			await keys.write(provider, key);
			return this.get();
		},
		async clearKey({ provider }) {
			await keys.remove(provider);
			return this.get();
		},
		models: () => llmPort.listModels()
	};
}
//#endregion
//#region src/host/recognize.js
const AT_ONCE = 3;
const STOPS = /* @__PURE__ */ new Set([
	"llm-auth",
	"llm-quota",
	"llm-missing",
	"llm-unavailable",
	"llm-no-vision"
]);
const MAX_TOKENS = 6e3;
async function visionPurpose(llm, signal) {
	await llm.refreshCapabilities?.(signal);
	return ["quick", "teach"].find((purpose) => llm.supportsImages?.(purpose)) ?? null;
}
function cleanTranscript(value) {
	return String(value ?? "").trim().replace(/^```[\w-]*\n([\s\S]*?)\n```$/u, "$1").replaceAll(RECOGNIZE_EMPTY, "").trim();
}
function createRecognizer({ llm, signal, onProgress, atOnce = AT_ONCE }) {
	let route = null;
	async function read(purpose, image) {
		const prompt = recognizePrompt();
		return cleanTranscript(await llm.complete({
			purpose,
			effort: "lowest",
			system: prompt.system,
			user: prompt.user,
			images: [{
				mime: image.mime,
				base64: Buffer.from(image.data).toString("base64")
			}],
			requireImages: true,
			maxTokens: MAX_TOKENS,
			signal
		}));
	}
	return async (sources) => {
		route ??= visionPurpose(llm, signal);
		const purpose = await route;
		if (!purpose) return null;
		const results = new Array(sources.length).fill(null);
		let next = 0;
		let done = 0;
		let stopped = null;
		onProgress?.(0, sources.length);
		const worker = async () => {
			while (next < sources.length) {
				const index = next;
				next += 1;
				signal?.throwIfAborted();
				try {
					if (stopped) throw stopped;
					const image = await sources[index].image();
					results[index] = { text: image ? await read(purpose, image) : "" };
				} catch (error) {
					if (signal?.aborted) throw signal.reason ?? error;
					if (STOPS.has(error?.code)) stopped ??= error;
					results[index] = { error };
				}
				done += 1;
				onProgress?.(done, sources.length);
			}
		};
		await Promise.all(Array.from({ length: Math.max(1, Math.min(atOnce, sources.length)) }, worker));
		return results;
	};
}
//#endregion
//#region src/host/studio.js
const ASSIST_MODES = [
	"explain",
	"solve",
	"visualize"
];
const DIGEST_SINGLE_CHARS = 24e3;
const DIGEST_NOTES_CHARS = 48e3;
const PART_WORKERS = 3;
const PART_FAILURES = /* @__PURE__ */ new Set([
	"bad-output",
	"llm-empty",
	"llm-timeout",
	"llm-failed",
	"llm-context"
]);
const titleOf = (scope, focus) => focus ? `${scope.title} · ${focus}` : scope.title;
function createStudio({ store, llm, jobs, now = () => /* @__PURE__ */ new Date(), uiLanguage = () => "zh-CN" }) {
	const stamp = () => now().toISOString();
	async function saveMaterial(result, { bytes, signal, extra = {} }) {
		const id = newId("mat");
		const meta = {
			id,
			title: text(result.title, 160) || "Untitled",
			kind: result.kind,
			pages: result.pages ?? null,
			slides: result.slides ?? null,
			chars: result.chars ?? 0,
			truncated: result.truncated === true,
			mime: result.mime ?? null,
			url: result.url ?? null,
			ocr: result.ocr ?? null,
			createdAt: stamp(),
			brief: null,
			...extra
		};
		if (result.kind === "image" && bytes) await store.writeBlob(store.paths.materialBlob(id), bytes);
		if (result.chunks?.length) await store.writeJson(store.paths.materialChunks(id), result.chunks);
		if (result.chunks?.length) try {
			meta.brief = await generateJson(llm, {
				purpose: "quick",
				prompt: materialBriefPrompt({
					title: meta.title,
					passages: formatPassages(spreadPassages(result.chunks, { maxChars: 12e3 }), ""),
					language: detectLanguage(result.chunks[0].text, uiLanguage())
				}),
				maxTokens: 1500,
				signal,
				normalize: (raw) => ({
					summary: text(raw?.summary, 800),
					topics: (Array.isArray(raw?.topics) ? raw.topics : []).map((topic) => text(topic, 80)).filter(Boolean).slice(0, 30),
					level: text(raw?.level, 20),
					suggestedGoal: text(raw?.suggestedGoal, 300)
				})
			});
		} catch (error) {
			if (signal?.aborted) throw error;
			meta.brief = null;
		}
		await store.writeJson(store.paths.material(id), meta);
		return meta;
	}
	const recognizer = (api) => createRecognizer({
		llm,
		signal: api.signal,
		onProgress: (done, total) => api.progress(done, total, "recognizing")
	});
	function upload({ name, base64, bytes: raw }) {
		const fileName = text(name, 200) || "file";
		if (!raw && (typeof base64 !== "string" || !base64)) throw new TutorError("invalid", "No file data");
		if (raw ? raw.length > 209715200 : base64.length > Math.ceil(209715200 * 4 / 3) + 8) throw new TutorError("too-large", `The file is larger than 200 MB`);
		return jobs.start("material/upload", async (api) => {
			api.progress(0, 2, "reading");
			const bytes = raw ? Buffer.isBuffer(raw) ? raw : Buffer.from(raw) : Buffer.from(base64, "base64");
			const result = await ingestFile({
				name: fileName,
				bytes,
				signal: api.signal,
				recognize: recognizer(api)
			});
			api.progress(1, 2, "summarizing");
			return { material: await saveMaterial(result, {
				bytes,
				signal: api.signal,
				extra: { fileName }
			}) };
		});
	}
	function addUrl({ url }) {
		return jobs.start("material/url", async (api) => {
			api.progress(0, 2, "fetching");
			const result = await ingestUrl(url, {
				signal: api.signal,
				recognize: recognizer(api)
			});
			api.progress(1, 2, "summarizing");
			return { material: await saveMaterial(result, { signal: api.signal }) };
		});
	}
	async function listMaterials() {
		const ids = await store.listIds(store.paths.materials(), "mat");
		return (await Promise.all(ids.map((id) => store.readJson(store.paths.material(id), null)))).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
	}
	let libraryIndex = null;
	const SEARCH_CHUNKS = 3e4;
	async function searchMaterials({ query }) {
		const wanted = text(query, 200);
		if (!wanted) return { results: [] };
		const metas = (await listMaterials()).filter((meta) => meta.kind !== "image" || meta.chars > 0);
		const key = metas.map((meta) => `${meta.id}:${meta.title}:${meta.chars ?? meta.pages ?? ""}`).join("|");
		if (libraryIndex?.key !== key) {
			const chunks = [];
			for (const meta of metas) {
				if (chunks.length >= SEARCH_CHUNKS) break;
				const own = await store.readJson(store.paths.materialChunks(meta.id), []) ?? [];
				for (const chunk of own.slice(0, SEARCH_CHUNKS - chunks.length)) chunks.push({
					...chunk,
					materialId: meta.id,
					materialTitle: meta.title
				});
			}
			libraryIndex = {
				key,
				index: buildIndex(chunks)
			};
		}
		return { results: search(libraryIndex.index, wanted, { limit: 12 }).map(({ chunk }) => ({
			materialId: chunk.materialId,
			title: chunk.materialTitle,
			page: chunk.page ?? null,
			slide: chunk.slide ?? null,
			snippet: snippetOf(chunk.text, wanted)
		})) };
	}
	async function getMaterial({ id }) {
		const meta = await store.readJson(store.paths.material(assertId(id, "mat")), null);
		if (!meta) throw new TutorError("not-found", "Material not found");
		const chunks = await store.readJson(store.paths.materialChunks(id), []) ?? [];
		return {
			material: meta,
			preview: chunks.slice(0, 3).map((chunk) => ({
				page: chunk.page ?? null,
				slide: chunk.slide ?? null,
				text: chunk.text.slice(0, 600)
			})),
			chunkCount: chunks.length
		};
	}
	async function renameMaterial({ id, title }) {
		return { material: await store.updateJson(store.paths.material(assertId(id, "mat")), null, (value) => {
			if (!value) throw new TutorError("not-found", "Material not found");
			return {
				...value,
				title: text(title, 160) || value.title
			};
		}) };
	}
	async function removeMaterial({ id }) {
		await store.removeDir(store.paths.materialDir(assertId(id, "mat")));
		return { removed: id };
	}
	function digest({ id }) {
		return jobs.start("material/digest", async (api) => {
			const [material] = await readMaterials(store, [assertId(id, "mat")]);
			if (!material?.chunks.length) throw new TutorError("material-no-text", "This material has no text to digest");
			const title = material.meta.title;
			const language = detectLanguage(material.chunks[0].text, uiLanguage());
			const size = material.chunks.reduce((sum, chunk) => sum + chunk.text.length, 0);
			let prompt;
			let missing = [];
			if (size <= DIGEST_SINGLE_CHARS) {
				api.progress(0, 1, "writing");
				prompt = digestPrompt({
					title,
					passages: formatPassages(material.chunks, ""),
					language
				});
			} else {
				const parts = documentParts(material.chunks);
				const notes = new Array(parts.length).fill(null);
				const readPart = async (index) => {
					try {
						notes[index] = await generateJson(llm, {
							purpose: "teach",
							prompt: digestPartPrompt({
								title,
								part: index + 1,
								parts: parts.length,
								range: passageRange(parts[index]),
								passages: formatPassages(parts[index], ""),
								language
							}),
							maxTokens: 6e3,
							signal: api.signal,
							normalize: normalizeDigestPart
						});
					} catch (error) {
						if (api.signal.aborted) throw error;
					}
				};
				const queue = parts.map((part, index) => index);
				let done = 0;
				api.progress(0, parts.length + 1, "reading");
				const worker = async () => {
					while (queue.length) {
						api.signal.throwIfAborted();
						await readPart(queue.shift());
						done += 1;
						api.progress(done, parts.length + 1, "reading");
					}
				};
				await Promise.all([worker(), worker()]);
				for (const [index, note] of notes.entries()) if (!note) await readPart(index);
				const read = notes.map((note, index) => note ? {
					part: index + 1,
					of: parts.length,
					range: passageRange(parts[index]),
					...note
				} : null).filter(Boolean);
				if (read.length < Math.ceil(parts.length / 2)) throw new TutorError("bad-output", "The model could not read enough of this document. Try again or pick a stronger model in settings.");
				missing = parts.map((part, index) => notes[index] ? null : passageRange(part) || `${index + 1}/${parts.length}`).filter(Boolean);
				api.progress(parts.length, parts.length + 1, "writing");
				prompt = digestPrompt({
					title,
					notes: digestNotesText(read, DIGEST_NOTES_CHARS),
					language
				});
			}
			const result = await generateJson(llm, {
				purpose: "teach",
				prompt,
				maxTokens: 9e3,
				signal: api.signal,
				normalize: normalizeDigest
			});
			if (missing.length) result.missing = missing;
			return { material: await store.updateJson(store.paths.material(id), null, (value) => ({
				...value,
				digest: {
					...result,
					createdAt: stamp()
				}
			})) };
		}, { key: `digest:${id}` });
	}
	async function scopeOf(materialIds) {
		const ids = (Array.isArray(materialIds) ? materialIds : []).filter((id) => /^mat_[a-z0-9]+$/u.test(String(id))).slice(0, 8);
		if (!ids.length) throw new TutorError("no-material", "Pick at least one material");
		const materials = await readMaterials(store, ids);
		if (!materials.some((item) => item.chunks.length)) throw new TutorError("material-no-text", "These materials have no text");
		const title = materials.map((item) => item.meta.title).join(" + ");
		return {
			ids,
			materials,
			title,
			language: detectLanguage(materials.find((item) => item.chunks.length)?.chunks[0]?.text ?? title, uiLanguage()),
			outline: materials.map((item) => item.meta.brief?.topics?.join("; ") ?? "").filter(Boolean).join("\n")
		};
	}
	function makeSheet({ materialIds, focus }) {
		return jobs.start("studio/sheet", async (api) => {
			const scope = await scopeOf(materialIds);
			const sheet = await generateJson(llm, {
				purpose: "teach",
				prompt: cheatsheetPrompt({
					scopeTitle: scope.title,
					outline: scope.outline,
					passages: passagesFor(scope.materials, text(focus, 300) || scope.outline, 22e3),
					language: scope.language,
					focus: text(focus, 300)
				}),
				maxTokens: 1e4,
				signal: api.signal,
				normalize: normalizeCheatsheet
			});
			const item = {
				id: newId("chs"),
				kind: "cheatsheet",
				title: sheet.title || scope.title,
				language: scope.language,
				materialIds: scope.ids,
				sheet,
				createdAt: stamp()
			};
			await store.writeJson(store.paths.item("sheets", item.id), item);
			return { item };
		});
	}
	function makeTopicSheet({ topic, focus, signal }) {
		const subject = text(topic, 300);
		if (!subject) throw new TutorError("invalid", "Give a topic");
		return (async () => {
			const language = detectLanguage(subject, uiLanguage());
			const sheet = await generateJson(llm, {
				purpose: "teach",
				prompt: cheatsheetPrompt({
					scopeTitle: subject,
					outline: "",
					passages: "",
					language,
					focus: text(focus, 300)
				}),
				maxTokens: 9e3,
				signal,
				normalize: normalizeCheatsheet
			});
			const item = {
				id: newId("chs"),
				kind: "cheatsheet",
				title: sheet.title || subject,
				language,
				materialIds: [],
				sheet,
				createdAt: stamp()
			};
			await store.writeJson(store.paths.item("sheets", item.id), item);
			return item;
		})();
	}
	function makeNotes({ materialIds, focus }) {
		return jobs.start("studio/notes", async (api) => {
			const scope = await scopeOf(materialIds);
			const wanted = text(focus, 300);
			const markdown = await generateText(llm, {
				purpose: "teach",
				prompt: summaryPrompt({
					scopeTitle: scope.title,
					outline: scope.outline,
					passages: passagesFor(scope.materials, wanted || scope.outline, 22e3),
					language: scope.language,
					focus: wanted
				}),
				maxTokens: 8e3,
				signal: api.signal
			});
			const item = {
				id: newId("chs"),
				kind: "notes",
				title: titleOf(scope, wanted),
				language: scope.language,
				materialIds: scope.ids,
				markdown: markdown.slice(0, 6e4),
				createdAt: stamp()
			};
			await store.writeJson(store.paths.item("sheets", item.id), item);
			return { item };
		});
	}
	function partsOf(scope) {
		const parts = materialParts(scope.materials.map(({ meta, chunks }) => ({
			title: meta.title,
			chunks
		})));
		return parts.map((part, index) => ({
			...part,
			label: parts.length > 1 ? {
				n: index + 1,
				of: parts.length,
				range: passageRange(part.passages)
			} : null
		}));
	}
	async function eachPart(api, parts, { field, maxOf, limit }, write) {
		const lists = parts.map(() => null);
		const written = parts.map(() => 0);
		let done = 0;
		const show = () => {
			api.progress(done, parts.length, "reading");
			api.preview({ written: Math.min(limit, written.reduce((sum, count) => sum + count, 0)) });
		};
		const attempt = async (index) => {
			try {
				lists[index] = await write(parts[index], fieldCounter(field, (count) => {
					written[index] = Math.min(count, maxOf(parts[index]));
					show();
				}));
			} catch (error) {
				if (api.signal.aborted || !PART_FAILURES.has(error?.code)) throw error;
				written[index] = 0;
			}
		};
		const queue = parts.map((part, index) => index);
		const worker = async () => {
			while (queue.length) {
				api.signal.throwIfAborted();
				const index = queue.shift();
				await attempt(index);
				if (!lists[index]) await attempt(index);
				written[index] = lists[index]?.length ?? 0;
				done += 1;
				show();
			}
		};
		show();
		await Promise.all(Array.from({ length: Math.min(PART_WORKERS, parts.length) }, worker));
		if (lists.filter(Boolean).length < Math.ceil(parts.length / 2)) throw new TutorError("bad-output", "The model could not read enough of these materials. Try again or pick a stronger model in settings.");
		return {
			lists: lists.map((list) => list ?? []),
			missing: parts.filter((part, index) => !lists[index]).map((part) => part.label?.range || part.title)
		};
	}
	function makeCards({ materialIds, focus }) {
		return jobs.start("studio/cards", async (api) => {
			const scope = await scopeOf(materialIds);
			const wanted = text(focus, 300);
			const { lists, missing } = await eachPart(api, partsOf(scope), {
				field: "\"front\"",
				maxOf: (part) => partCardRange(part.chars).max,
				limit: LIMITS.libraryCards
			}, (part, onText) => {
				const range = partCardRange(part.chars);
				return generateJson(llm, {
					purpose: "teach",
					effort: "lowest",
					prompt: flashcardsPrompt({
						scopeTitle: scope.title,
						outline: scope.outline,
						passages: formatPassages(part.passages, part.title),
						language: scope.language,
						range,
						part: part.label,
						focus: wanted
					}),
					maxTokens: 2e3 + range.max * 250,
					signal: api.signal,
					onText,
					normalize: (raw) => {
						const cards = thinEvenly(normalizeCards(raw, LIMITS.cards * 2), range.max);
						if (!cards.length && !wanted) throw new Error(`No cards came back: write at least ${range.min}.`);
						return cards;
					}
				});
			});
			const cards = takeEvenly(uniqueCards(lists), LIMITS.libraryCards).map((card, index) => ({
				...card,
				id: `c${index + 1}`
			}));
			if (!cards.length) throw new TutorError("focus-empty", "Nothing in these materials falls within the focus");
			const item = {
				id: newId("dck"),
				kind: "cards",
				title: titleOf(scope, wanted),
				language: scope.language,
				materialIds: scope.ids,
				...wanted ? { focus: wanted } : {},
				...missing.length ? { missing } : {},
				cards,
				srs: {},
				createdAt: stamp()
			};
			await store.writeJson(store.paths.item("decks", item.id), item);
			return { item };
		});
	}
	function makeQuiz({ materialIds, focus }) {
		return jobs.start("studio/quiz", async (api) => {
			const scope = await scopeOf(materialIds);
			const wanted = text(focus, 300);
			const parts = partsOf(scope);
			const whole = materialQuizRange(parts.reduce((sum, part) => sum + part.chars, 0));
			const rangeOf = (part) => wanted ? materialQuizRange(part.chars) : shareRange(whole, parts.length);
			const { lists, missing } = await eachPart(api, parts, {
				field: "\"prompt\"",
				maxOf: (part) => rangeOf(part).max,
				limit: LIMITS.quizItems
			}, (part, onText) => {
				const range = rangeOf(part);
				return generateJson(llm, {
					purpose: "teach",
					prompt: quizPrompt({
						scopeTitle: scope.title,
						outline: scope.outline,
						concepts: "",
						passages: formatPassages(part.passages, part.title),
						language: scope.language,
						range,
						part: part.label,
						focus: wanted
					}),
					maxTokens: 2e3 + range.max * 500,
					signal: api.signal,
					onText,
					normalize: (raw) => {
						const items = thinEvenly(normalizePractice(raw, [], LIMITS.quizItems).items, range.max);
						if (!wanted && items.length < Math.min(3, range.min)) throw new Error(`The quiz is too short: write at least ${range.min} questions.`);
						return items;
					}
				});
			});
			const items = takeEvenly(lists, LIMITS.quizItems).map((entry, index) => ({
				...entry,
				id: `i${index + 1}`
			}));
			if (!items.length) throw new TutorError("focus-empty", "Nothing in these materials falls within the focus");
			const item = {
				id: newId("dck"),
				kind: "quiz",
				title: titleOf(scope, wanted),
				language: scope.language,
				materialIds: scope.ids,
				...wanted ? { focus: wanted } : {},
				...missing.length ? { missing } : {},
				items,
				createdAt: stamp()
			};
			await store.writeJson(store.paths.item("decks", item.id), item);
			return { item };
		});
	}
	async function listItems({ kind }) {
		if (![
			"sheets",
			"decks",
			"assist",
			"shorts"
		].includes(kind)) throw new TutorError("invalid", "Unknown collection");
		const ids = await store.listIds(store.paths.collection(kind), {
			sheets: "chs",
			decks: "dck",
			assist: "thd",
			shorts: "sht"
		}[kind]);
		return (await Promise.all(ids.map((id) => store.readJson(store.paths.item(kind, id), null)))).filter(Boolean).map((item) => ({
			id: item.id,
			kind: item.kind ?? kind,
			title: item.title,
			language: item.language,
			createdAt: item.createdAt,
			updatedAt: item.updatedAt ?? item.createdAt,
			count: item.cards?.length ?? item.items?.length ?? item.turns?.length ?? item.board?.steps?.length ?? null
		})).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
	}
	async function getItem({ kind, id }) {
		const item = await store.readJson(store.paths.item(kind, id), null);
		if (!item) throw new TutorError("not-found", "Not found");
		return { item };
	}
	async function removeItem({ kind, id }) {
		const path = store.paths.item(kind, id);
		await store.removeDir(path);
		return { removed: id };
	}
	async function saveStandaloneLayout({ id, layout }) {
		return { item: await store.updateJson(store.paths.item("sheets", assertId(id, "chs")), null, (value) => {
			if (!value?.sheet) throw new TutorError("not-found", "Cheat sheet not found");
			value.sheet.layout = cleanLayout(layout, value.sheet);
			return value;
		}) };
	}
	async function reviewDeckCard({ id, cardId, grade }) {
		return { srs: (await store.updateJson(store.paths.item("decks", assertId(id, "dck")), null, (value) => {
			if (!value?.cards?.some((card) => card.id === cardId)) throw new TutorError("not-found", "Card not found");
			value.srs ??= {};
			value.srs[cardId] = review(value.srs[cardId] ?? createCard(cardId, now().getTime()), grade, now().getTime());
			value.updatedAt = stamp();
			return value;
		})).srs[cardId] };
	}
	function assist({ mode = "explain", request, materialIds = [], threadId, newThreadId }) {
		const ask = text(request, 4e3);
		if (!ask) throw new TutorError("empty-question", "Type your question");
		const chosen = ASSIST_MODES.includes(mode) ? mode : "explain";
		const fresh = /^thd_[a-z0-9]{6,40}$/u.test(String(newThreadId)) ? newThreadId : null;
		return jobs.start("assist/turn", async (api) => {
			let thread = threadId ? await store.readJson(store.paths.item("assist", assertId(threadId, "thd")), null) : null;
			const ids = [.../* @__PURE__ */ new Set([...thread?.materialIds ?? [], ...Array.isArray(materialIds) ? materialIds : []])].filter((id) => /^mat_[a-z0-9]+$/u.test(String(id))).slice(0, 8);
			const materials = await readMaterials(store, ids);
			const language = thread?.language ?? detectLanguage(ask, uiLanguage());
			const profile = await readProfile(store);
			const history = (thread?.turns ?? []).slice(-4).map((turn) => `Learner (${turn.mode}): ${turn.request}\nTutor board: ${(turn.board?.steps ?? []).slice(0, 6).map((step) => step.say).join(" ")}`).join("\n\n");
			const images = await assistImages(ids);
			const board = await generateSteps(llm, {
				purpose: "teach",
				effort: "lowest",
				prompt: assistPrompt({
					mode: chosen,
					request: ask,
					language,
					passages: passagesFor(materials, ask, 8e3),
					history,
					learner: { profile }
				}),
				images: images.length ? images : void 0,
				maxTokens: 1e4,
				signal: api.signal,
				onStep: (step) => api.push(step),
				minSteps: 1
			});
			const turn = {
				mode: chosen,
				request: ask,
				board,
				at: stamp()
			};
			const id = thread?.id ?? fresh ?? newId("thd");
			const saved = await store.updateJson(store.paths.item("assist", id), null, (current) => {
				const next = current ?? {
					id,
					title: board.title || ask.slice(0, 60),
					language,
					materialIds: [],
					turns: [],
					createdAt: stamp()
				};
				next.turns = [...next.turns ?? [], turn].slice(-30);
				next.materialIds = [.../* @__PURE__ */ new Set([...next.materialIds ?? [], ...ids])].slice(0, 8);
				next.updatedAt = stamp();
				return next;
			});
			return {
				threadId: saved.id,
				turn: saved.turns.length - 1,
				board
			};
		}, { meta: {
			threadId: threadId ?? fresh,
			title: ask.slice(0, 60)
		} });
	}
	async function assistImages(ids) {
		return llm.supportsImages?.("teach") ? materialImages(store, await readMaterials(store, ids)) : [];
	}
	function makeShort({ topic, url, newId: presetId }) {
		const subject = text(topic, 300);
		if (!subject && !url) throw new TutorError("empty-topic", "Give a topic or a web address");
		const id = /^sht_[a-z0-9]{6,40}$/u.test(String(presetId)) ? presetId : newId("sht");
		return jobs.start("short/make", async (api) => {
			let passages = "";
			let sourceTitle = "";
			if (url) {
				api.progress(0, 2, "fetching");
				const page = await ingestUrl(url, { signal: api.signal });
				sourceTitle = page.title;
				passages = page.chunks.slice(0, 10).map((chunk) => chunk.text).join("\n\n").slice(0, 12e3);
			}
			api.progress(1, 2, "writing");
			const language = detectLanguage(subject || passages, uiLanguage());
			const board = await generateSteps(llm, {
				purpose: "teach",
				effort: "lowest",
				prompt: shortPrompt({
					topic: subject || sourceTitle,
					passages,
					language
				}),
				maxTokens: 8e3,
				signal: api.signal,
				onStep: (step) => api.push(step),
				minSteps: 3
			});
			const item = {
				id,
				title: board.title || subject || sourceTitle,
				topic: subject,
				sourceUrl: url ? String(url) : null,
				language,
				board,
				createdAt: stamp()
			};
			await store.writeJson(store.paths.item("shorts", item.id), item);
			return { item };
		}, { meta: {
			id,
			title: subject
		} });
	}
	return Object.freeze({
		upload,
		addUrl,
		listMaterials,
		searchMaterials,
		getMaterial,
		renameMaterial,
		removeMaterial,
		digest,
		makeSheet,
		makeTopicSheet,
		makeNotes,
		makeCards,
		makeQuiz,
		listItems,
		getItem,
		removeItem,
		saveStandaloneLayout,
		reviewDeckCard,
		assist,
		assistImages,
		makeShort
	});
}
function normalizeDigest(raw) {
	return {
		overview: text(raw?.overview, 2e3),
		structure: (Array.isArray(raw?.structure) ? raw.structure : []).slice(0, 30).map((item) => ({
			heading: text(item?.heading, 160),
			points: (item?.points ?? []).map((point) => text(point, 400)).filter(Boolean).slice(0, 10),
			pages: text(item?.pages, 30)
		})).filter((item) => item.heading),
		keyIdeas: (raw?.keyIdeas ?? []).map((item) => text(item, 400)).filter(Boolean).slice(0, 15),
		arguments: (raw?.arguments ?? []).slice(0, 15).map((item) => ({
			claim: text(item?.claim, 400),
			support: text(item?.support, 600),
			page: text(item?.page, 20)
		})).filter((item) => item.claim),
		glossary: (raw?.glossary ?? []).slice(0, 30).map((item) => ({
			term: text(item?.term, 80),
			meaning: text(item?.meaning, 400)
		})).filter((item) => item.term),
		questions: (raw?.questions ?? []).map((item) => text(item, 300)).filter(Boolean).slice(0, 8)
	};
}
function normalizeDigestPart(raw) {
	const value = {
		sections: (Array.isArray(raw?.sections) ? raw.sections : []).slice(0, 12).map((item) => ({
			heading: text(item?.heading, 160),
			pages: text(item?.pages, 30),
			points: (Array.isArray(item?.points) ? item.points : []).map((point) => text(point, 300)).filter(Boolean).slice(0, 6)
		})).filter((item) => item.heading),
		keyIdeas: (Array.isArray(raw?.keyIdeas) ? raw.keyIdeas : []).map((item) => text(item, 300)).filter(Boolean).slice(0, 8),
		arguments: (Array.isArray(raw?.arguments) ? raw.arguments : []).slice(0, 8).map((item) => ({
			claim: text(item?.claim, 300),
			support: text(item?.support, 400),
			page: text(item?.page, 20)
		})).filter((item) => item.claim),
		glossary: (Array.isArray(raw?.glossary) ? raw.glossary : []).slice(0, 12).map((item) => ({
			term: text(item?.term, 80),
			meaning: text(item?.meaning, 300)
		})).filter((item) => item.term)
	};
	if (!value.sections.length && !value.keyIdeas.length) throw new Error("no notes for this part");
	return value;
}
function digestNotesText(notes, maxChars) {
	const share = Math.max(600, Math.floor(maxChars / Math.max(1, notes.length)));
	return notes.map((note) => {
		const lines = [`[Part ${note.part}/${note.of}${note.range ? ` · ${note.range}` : ""}]`];
		for (const section of note.sections) lines.push(`- ${section.heading}${section.pages ? ` (p.${section.pages})` : ""}: ${section.points.join("; ")}`);
		if (note.keyIdeas.length) lines.push(`Key ideas: ${note.keyIdeas.join("; ")}`);
		for (const argument of note.arguments) lines.push(`Claim: ${argument.claim}${argument.page ? ` (p.${argument.page})` : ""} — ${argument.support}`);
		if (note.glossary.length) lines.push(`Terms: ${note.glossary.map((entry) => `${entry.term}: ${entry.meaning}`).join("; ")}`);
		const block = lines.join("\n");
		return block.length > share ? `${block.slice(0, share)}…` : block;
	}).join("\n\n");
}
//#endregion
//#region src/index.js
const name = "aha-tutor";
const inject = ["llm"];
const CHANNEL = "/aha-tutor";
function apply(ctx) {
	const logger = ctx.logger;
	const store = createStore({ root: join(resolveDshHome(), DATA_DIR_NAME) });
	const prefs = createPrefs(store);
	const keys = createKeyStore({
		getCredentials: () => ctx.get?.("credentials"),
		credentialKey
	});
	const llm = createLlmPort({
		getLlm: () => ctx.llm ?? ctx.get?.("llm"),
		getDefault: () => ctx.get?.("agentDefaultModel")?.currentSelection?.(),
		getAttachments: () => ctx.get?.("attachments"),
		prefs,
		logger
	});
	const ready = prefs.load().catch(() => void 0).then(() => llm.refreshCapabilities().catch(() => void 0));
	ctx.on?.("llm/adapters-updated", () => {
		llm.refreshCapabilities().catch(() => void 0);
	});
	let uiLanguage = "zh-CN";
	const jobs = createJobs({ logger });
	const learner = createLearner({
		store,
		llm,
		logger
	});
	const courses = createCourses({
		store,
		llm,
		jobs,
		research: createResearch({
			getWeb: () => ctx.get?.("web"),
			llm,
			logger
		})
	});
	const lessons = createLessons({
		store,
		llm,
		jobs,
		courses,
		learner
	});
	const studio = createStudio({
		store,
		llm,
		jobs,
		uiLanguage: () => uiLanguage
	});
	const projects = createProjects({
		store,
		llm,
		jobs,
		courses
	});
	const samples = createSamples({
		dirUrl: new URL("../samples/", import.meta.url),
		courses
	});
	const tts = createTts({
		cacheDir: store.paths.ttsCache(),
		getSecret: (provider) => keys.read(provider)
	});
	const plugin = createPluginManager();
	const settings = createSettingsService({
		prefs,
		keys,
		llmPort: llm
	});
	const speechInput = createSpeechInput({
		getSpeech: () => ctx.get?.("speechToText"),
		logger
	});
	async function speak({ text, provider, signal }) {
		await ready;
		const current = prefs.read();
		const chosen = provider ?? current.ttsProvider;
		return tts.synthesize({
			provider: chosen,
			config: current.tts?.[chosen] ?? {},
			text,
			rate: 1,
			signal
		});
	}
	async function info(payload) {
		if (typeof payload?.language === "string") uiLanguage = payload.language.startsWith("zh") ? "zh-CN" : "en";
		let version = null;
		try {
			version = (await plugin.read()).current;
		} catch {
			version = null;
		}
		return {
			version,
			language: uiLanguage
		};
	}
	const handler = createRpcHandler({
		...createRoutes({
			courses,
			lessons,
			learner,
			studio,
			projects,
			jobs,
			settings,
			tts: { speak },
			plugin,
			info,
			speechInput
		}),
		"app/info": (payload) => info(payload),
		"samples/list": () => samples.list(),
		"samples/import": (payload) => samples.importSample({ id: payload.id })
	}, { logger });
	ctx.inject(["connection", "webServer"], (connectionCtx) => {
		const service = connectionCtx.connection;
		connectionCtx.effect(() => typeof service.register === "function" ? service.register(connectionCtx, CHANNEL, handler) : service.rpc.handle(CHANNEL, handler), "aha-tutor: rpc channel");
	});
	ctx.inject(["connection"], (connectionCtx) => {
		const fetchRoutes = connectionCtx.connection?.fetch;
		if (typeof fetchRoutes?.register !== "function") return;
		connectionCtx.effect(() => fetchRoutes.register(uploadRoute({ studio })), "aha-tutor: upload route");
		connectionCtx.effect(() => fetchRoutes.register(ttsRoute({ speak })), "aha-tutor: tts route");
		connectionCtx.effect(() => fetchRoutes.register(speechRoute({ speechInput })), "aha-tutor: speech route");
		connectionCtx.effect(() => fetchRoutes.register(fontRoute()), "aha-tutor: font route");
	});
	ctx.effect(() => publishRuntime({
		store,
		llm,
		jobs,
		courses,
		lessons,
		learner,
		studio,
		ready
	}), "aha-tutor: runtime");
	ctx.effect(() => () => jobs.dispose(), "aha-tutor: jobs");
}
//#endregion
export { CHANNEL, TutorError, apply, inject, name };
