import { $ as intakeSummary, A as emptyProgress, B as passageRange, C as summaryPrompt, D as generateText, E as generateSteps, F as readMaterials, G as recommendNext, H as applyEvidence, I as readProfile, J as conceptIndex, K as boardToPlainText, L as readProgress, M as materialImages, N as materialsSummary, O as streamCounter, P as passagesFor, Q as insertLesson, R as documentParts, S as shortPrompt, T as generateJson, U as createConceptState, V as spreadPassages, W as masteryPercent, X as findLesson, Y as courseProgress, Z as flattenLessons, _ as projectsPrompt, a as blueprintPrompt, at as normalizePractice, b as reexplainPrompt, c as digestPartPrompt, ct as outlineForPrompt, d as gradePrompt, dt as assertId, et as lessonAfter, f as lessonPrompt, ft as newId, g as projectReviewPrompt, h as profilePrompt, i as assistPrompt, it as normalizeCheatsheet, j as masteryFor, k as EMPTY_PROFILE, l as digestPrompt, lt as safeRelativePath, m as practicePrompt, n as publishRuntime, nt as normalizeBlueprint, o as cheatsheetPrompt, ot as normalizeProject, p as materialBriefPrompt, q as normalizeBoard, r as askPrompt, rt as normalizeCards, s as detectLanguage, st as normalizeQuestionnaire, tt as nextLesson, u as flashcardsPrompt, ut as text, v as questionnairePrompt, w as TutorError, x as revisePrompt, y as quizPrompt, z as formatPassages } from "./runtime-DC1u2GE8.js";
import { createRequire } from "node:module";
import { dirname, join, relative, sep } from "node:path";
import { credentialKey } from "@deepseek-ai/dsh-credentials";
import { lookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { pipeline } from "node:stream";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
//#region src/core/coursepack.js
const COURSEPACK_FORMAT = "aha-tutor.coursepack";
function exportCoursePack({ course, progress, boards = {}, practice = {}, sheets = {}, cards = [] }, { includeProgress = false, app = {} } = {}) {
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
		progress: includeProgress ? progress ?? null : null
	};
}
function parseCoursePack(input) {
	let pack = input;
	if (typeof input === "string") {
		if (input.length > 8388608) throw new Error("course pack is too large");
		try {
			pack = JSON.parse(input);
		} catch {
			throw new Error("course pack is not valid JSON");
		}
	}
	if (pack?.format !== "aha-tutor.coursepack") throw new Error("not a course pack");
	if (!Number.isInteger(pack.version) || pack.version > 1) throw new Error("course pack was made by a newer version of the plugin");
	return pack;
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
	return {
		course,
		boards,
		practice,
		sheets,
		cards: normalizeCards(pack.cards ?? []),
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
//#region src/host/courses.js
const TIMELINES = [
	"intensive",
	"balanced",
	"relaxed"
];
function createCourses({ store, llm, jobs, now = () => /* @__PURE__ */ new Date() }) {
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
		const [progress, intake] = await Promise.all([readProgress(store, courseId), store.readJson(store.paths.intake(courseId), null)]);
		const boards = new Set(await store.listIds(store.paths.boardsDir(courseId), "les"));
		const practice = new Set(await store.listIds(store.paths.practiceDir(courseId), "les"));
		const sheets = new Set(await store.listIds(store.paths.sheetsDir(courseId), "unt"));
		return {
			course,
			progress,
			intake,
			jobs: {
				questions: jobs.running(`questions:${courseId}`),
				blueprint: jobs.running(`blueprint:${courseId}`),
				confirm: jobs.running(`confirm:${courseId}`)
			},
			ready: {
				boards: [...boards],
				practice: [...practice],
				sheets: [...sheets]
			}
		};
	}
	function startCraft({ goal, materialIds = [], quick = false, language }) {
		const cleanGoal = text(goal, 2e3);
		if (!cleanGoal && !materialIds.length) throw new TutorError("invalid", "Tell me what you want to learn");
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
			if (quick) return {
				courseId,
				questionnaire: null
			};
			const profile = await readProfile(store);
			const questionnaire = await generateJson(llm, {
				purpose: "teach",
				prompt: questionnairePrompt({
					goal: draft.goal,
					language: draft.language,
					materialsSummary: materialsSummary(materials),
					profile
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
				at: stamp()
			});
			api.progress(1, 2, "questions");
			return {
				courseId,
				questionnaire
			};
		}, {
			key: `questions:${courseId}`,
			meta: { courseId }
		});
	}
	function submitIntake({ courseId, answers = {}, timeline = "balanced", weeklyMinutes, deadline }) {
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
			const materials = await readMaterials(store, course.materialIds ?? []);
			const profile = await readProfile(store);
			const settings = {
				timeline: TIMELINES.includes(timeline) ? timeline : "balanced",
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
					weeklyMinutes: settings.weeklyMinutes
				}),
				images: llm.supportsImages?.("teach") ? await materialImages(store, materials) : void 0,
				maxTokens: 16e3,
				signal: api.signal,
				onText: streamCounter("\"estMinutes\"", (count) => api.progress(count, 0, "blueprint")),
				normalize: (raw) => attachProjectUnits(raw, normalizeBlueprint(raw, { language: course.language }))
			});
			const next = {
				...course,
				...blueprint,
				language: course.language,
				status: "blueprint",
				settings
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
		if (!request) throw new TutorError("invalid", "Describe the change you want");
		return jobs.start("craft/revise", async (api) => {
			const course = await readCourse(courseId);
			if (!course.units) throw new TutorError("invalid", "There is no blueprint to revise yet");
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
			const next = {
				...course,
				...revised,
				language: course.language,
				status: course.status === "ready" ? "ready" : "blueprint"
			};
			await saveCourse(next);
			return { course: next };
		}, {
			key: `blueprint:${courseId}`,
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
			maxTokens: Math.min(16e3, 3e3 + lessons.length * 2200),
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
			if (!course.units) throw new TutorError("invalid", "Generate a blueprint first");
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
		const pack = exportCoursePack({
			course,
			progress,
			boards,
			practice,
			sheets,
			cards: (await store.readJson(store.paths.cards(courseId), null))?.cards ?? []
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
		const imported = importCoursePack(json);
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
//#endregion
//#region src/host/materials.js
const MAX_UPLOAD_BYTES = 60 * 1024 * 1024;
const MAX_TEXT_CHARS = 2e6;
const CHUNK_CHARS = 1600;
const FETCH_TIMEOUT_MS = 2e4;
const MAX_PAGE_BYTES = 6 * 1024 * 1024;
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
		if (lower.endsWith(".doc") || lower.endsWith(".ppt")) throw new MaterialError("unsupported", "Old .doc/.ppt files are not supported; save as .docx/.pptx");
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
let pdfjsModule;
async function loadPdfjs() {
	pdfjsModule ??= import("pdfjs-dist/legacy/build/pdf.mjs");
	return pdfjsModule;
}
function pdfjsAssetUrls(root, { join: joinPath = join } = {}) {
	return {
		cMapUrl: `${joinPath(root, "cmaps")}/`,
		standardFontDataUrl: `${joinPath(root, "standard_fonts")}/`
	};
}
function pdfjsAssets() {
	return pdfjsAssetUrls(dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")));
}
async function extractPdf(bytes, { signal } = {}) {
	const pdfjs = await loadPdfjs();
	const { cMapUrl, standardFontDataUrl } = pdfjsAssets();
	const task = pdfjs.getDocument({
		data: new Uint8Array(bytes),
		cMapUrl,
		cMapPacked: true,
		standardFontDataUrl,
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
		const chunks = [];
		let title = "";
		try {
			const meta = await doc.getMetadata();
			title = String(meta?.info?.Title ?? "").trim();
		} catch {}
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
			chunks.push(...chunkText(pageText, { page: pageNumber }));
		}
		if (!chunks.length) throw new MaterialError("no-text", "No text found in this PDF (it may be a scan)");
		return {
			title,
			pages: doc.numPages,
			chunks
		};
	} finally {
		await Promise.resolve(task.destroy?.()).catch(() => void 0);
	}
}
async function extractDocx(bytes) {
	const mammoth = await import("mammoth");
	const extract = mammoth.extractRawText ?? mammoth.default?.extractRawText;
	let result;
	try {
		result = await extract({ buffer: Buffer.from(bytes) });
	} catch {
		throw new MaterialError("unreadable", "This Word document could not be read");
	}
	const sections = String(result?.value ?? "").split(/\n{2,}/u);
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
	if (buffer.trim()) chunks.push(...chunkText(buffer, { section: `§${section}` }));
	if (!chunks.length) throw new MaterialError("no-text", "No text found in this document");
	return { chunks };
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
async function extractPptx(bytes) {
	const JSZip = (await import("jszip")).default;
	let zip;
	try {
		zip = await JSZip.loadAsync(bytes);
	} catch {
		throw new MaterialError("unreadable", "This PowerPoint file could not be read");
	}
	const slideNumber = (name) => Number(/(\d+)\.xml$/u.exec(name)?.[1] ?? 0);
	const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name)).sort((a, b) => slideNumber(a) - slideNumber(b));
	const chunks = [];
	for (const name of slides) {
		const number = slideNumber(name);
		const body = slideText(await zip.file(name).async("string"));
		const notesFile = zip.file(`ppt/notesSlides/notesSlide${number}.xml`);
		const notes = notesFile ? slideText(await notesFile.async("string")) : "";
		const combined = notes ? `${body}\n[notes] ${notes}` : body;
		chunks.push(...chunkText(combined, { slide: number }));
	}
	if (!chunks.length) throw new MaterialError("no-text", "No text found in these slides");
	return {
		slides: slides.length,
		chunks
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
	if (!chunks.length) throw new MaterialError("no-text", "This file is empty");
	return {
		title: kind === "markdown" ? /^#\s+(.+)$/mu.exec(value)?.[1]?.trim() ?? "" : "",
		chunks
	};
}
async function ingestFile({ name, bytes, signal }) {
	if (!bytes?.length) throw new MaterialError("empty", "The file is empty");
	if (bytes.length > 62914560) throw new MaterialError("too-large", "The file is larger than 60 MB");
	const kind = detectKind(name, bytes);
	const baseTitle = String(name ?? "").replace(/\.[^.]+$/u, "").slice(0, 120) || "Untitled";
	if (kind === "image") {
		if (bytes.length > 10485760) throw new MaterialError("too-large", "Images must be smaller than 10 MB");
		return {
			kind,
			title: baseTitle,
			chunks: [],
			chars: 0,
			truncated: false,
			mime: imageMime(name, bytes)
		};
	}
	if (kind === "pdf") {
		const result = await extractPdf(bytes, { signal });
		return finish(kind, result.title || baseTitle, result.chunks, { pages: result.pages });
	}
	if (kind === "docx") return finish(kind, baseTitle, (await extractDocx(bytes)).chunks);
	if (kind === "pptx") {
		const result = await extractPptx(bytes);
		return finish(kind, baseTitle, result.chunks, { slides: result.slides });
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
async function ingestUrl(address, { fetchImpl = pageFetch, signal } = {}) {
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
			if (error?.code === "ETOOLARGE") throw new MaterialError("too-large", "The page is too large");
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
	if (bytes.length > MAX_PAGE_BYTES && !type.includes("pdf")) throw new MaterialError("too-large", "The page is too large");
	if (type.includes("application/pdf") || bytes.subarray(0, 5).toString("latin1") === "%PDF-") return {
		...await ingestFile({
			name: `${url.pathname.split("/").pop() || "page"}.pdf`,
			bytes,
			signal
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
	if (!chunks.length) throw new MaterialError("no-text", "No readable text on this page");
	return finish("url", title, chunks, { url: url.href });
}
//#endregion
//#region src/host/http.js
const UPLOAD_PATH = "/api/aha-tutor/upload";
const TTS_PATH = "/api/aha-tutor/tts";
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
			if (bytes === null) return failure$1("too-large", "The file is larger than 60 MB", 413);
			try {
				return json({
					ok: true,
					value: { job: studio.upload({
						name,
						bytes
					}) }
				});
			} catch (error) {
				return failure$1(error?.code ?? "failed", error?.name === "TutorError" ? error.message : "Upload failed", 400);
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
				return failure$1(error?.code ?? "tts", known ? error.message : "Speech synthesis failed", error?.code === "auth" ? 401 : 502);
			}
		}
	};
}
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
			}
		};
		const aborted = new Promise((_, reject) => {
			controller.signal.addEventListener("abort", () => reject(controller.signal.reason ?? /* @__PURE__ */ new Error("cancelled")), { once: true });
		});
		Promise.race([Promise.resolve().then(() => run(api)), aborted]).then((result) => {
			job.status = "done";
			job.result = result;
		}).catch((error) => {
			job.status = controller.signal.aborted ? "cancelled" : "failed";
			job.error = controller.signal.aborted ? {
				code: "cancelled",
				message: "Cancelled"
			} : {
				code: error?.code ?? "failed",
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
		cancel,
		cancelKey,
		running,
		dispose
	});
}
function publicMessage(error) {
	if (error?.userMessage) return String(error.userMessage);
	if ([
		"MaterialError",
		"TtsError",
		"TutorError"
	].includes(error?.name)) return String(error.message);
	return "Generation failed";
}
//#endregion
//#region src/core/planner.js
const DAY_MS$1 = 1440 * 60 * 1e3;
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
	return Math.round((parseDay(toDayValue) - parseDay(fromDay)) / DAY_MS$1);
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
function buildPlan({ today, settings, courses = [], reviews = [], exams = [] }) {
	const start = today ?? toDay(/* @__PURE__ */ new Date());
	const { studyDays, weeklyMinutes, dailyMinutes } = normalizeSettings(settings);
	const queues = courses.map((course) => ({
		id: course.id,
		title: course.title,
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
			let budget = dailyMinutes;
			const reviewBudget = Math.round(dailyMinutes * REVIEW_SHARE);
			let reviewUsed = 0;
			while (pendingReviews.length && pendingReviews[0].dueDay <= day && reviewUsed + pendingReviews[0].minutes <= reviewBudget) {
				const review = pendingReviews.shift();
				reviewUsed += review.minutes;
				items.push({
					kind: "review",
					refId: review.id,
					courseId: review.courseId ?? null,
					title: review.title,
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
					const dayIsEmpty = !items.some((item) => item.kind === "lesson");
					if (lesson.minutes <= budget || dayIsEmpty) {
						queue.remaining.shift();
						budget -= lesson.minutes;
						items.push({
							kind: "lesson",
							refId: lesson.id,
							courseId: queue.id,
							title: lesson.title,
							courseTitle: queue.title,
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
//#endregion
//#region src/host/learner.js
const PROFILE_REFRESH_MS = 10 * 6e4;
function createLearner({ store, llm, now = () => /* @__PURE__ */ new Date(), logger }) {
	let lastRefresh = 0;
	let refreshing = null;
	async function getProfile() {
		return readProfile(store);
	}
	async function saveProfile(patch = {}) {
		return store.updateJson(store.paths.profile(), { ...EMPTY_PROFILE }, (current) => cleanProfile({
			...current,
			...patch,
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
			exams: Array.isArray(plan.exams) ? plan.exams : []
		};
	}
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
		const day = /^\d{4}-\d{2}-\d{2}$/u.test(String(today ?? "")) ? today : toDay(now());
		const active = await activeCourses();
		const reviews = [];
		for (const { course, progress } of active) {
			const index = conceptIndex(course);
			for (const [conceptId, card] of Object.entries(progress.reviews ?? {})) {
				const concept = index.get(conceptId);
				if (!concept) continue;
				reviews.push({
					id: `${course.id}:${conceptId}`,
					courseId: course.id,
					title: concept.name,
					dueDay: toDay(new Date(card.dueAt)),
					minutes: 5
				});
			}
		}
		const built = buildPlan({
			today: day,
			settings: file.settings,
			courses: active.map(({ course, progress }) => ({
				id: course.id,
				title: course.title,
				deadline: course.settings?.deadline ?? null,
				lessons: flattenLessons(course).map(({ lesson }) => ({
					id: lesson.id,
					title: lesson.title,
					minutes: lesson.estMinutes,
					done: progress.lessons?.[lesson.id]?.status === "done"
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
		return {
			settings: file.settings,
			exams: file.exams,
			plan: built,
			today: built.days.find((entry) => entry.day === day)?.items ?? []
		};
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
		if (!name || !/^\d{4}-\d{2}-\d{2}$/u.test(String(day))) throw new Error("Exam needs a title and a date");
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
	async function reviewSession({ limit = 8 } = {}) {
		const at = now().getTime();
		const items = [];
		for (const { course, progress } of await activeCourses()) {
			const index = conceptIndex(course);
			const due = Object.entries(progress.reviews ?? {}).filter(([id, card]) => index.has(id) && Date.parse(card.dueAt) <= at).sort((a, b) => Date.parse(a[1].dueAt) - Date.parse(b[1].dueAt));
			for (const [conceptId] of due) {
				if (items.length >= limit) break;
				const concept = index.get(conceptId);
				const lesson = findLesson(course, concept.lessonId)?.lesson;
				const set = await store.readJson(store.paths.practice(course.id, concept.lessonId), null);
				const board = await store.readJson(store.paths.board(course.id, concept.lessonId), null);
				const candidates = [...set?.items ?? [], ...(board?.steps ?? []).map((step) => step.check).filter(Boolean)].filter((item) => item.conceptIds?.includes(conceptId) && item.kind !== "short");
				const item = candidates[Math.floor(Math.random() * candidates.length)];
				if (item) items.push({
					courseId: course.id,
					courseTitle: course.title,
					lessonId: concept.lessonId,
					lessonTitle: lesson?.title ?? "",
					conceptId,
					conceptName: concept.name,
					item
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
const DAY_MS = 1440 * 60 * 1e3;
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
	next.ease = Math.max(MIN_EASE, round2(card.ease + .1 - (5 - quality) * (.08 + (5 - quality) * .02)));
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
		next.dueAt = new Date(now + next.intervalDays * DAY_MS).toISOString();
	}
	next.lastReviewedAt = new Date(now).toISOString();
	return next;
}
function gradeFromScore(score, confidence) {
	if (score < .5) return "again";
	if (score < .8 || confidence === "guess") return "hard";
	if (score >= .95 && confidence === "sure") return "easy";
	return "good";
}
function round2(value) {
	return Math.round(value * 100) / 100;
}
//#endregion
//#region src/host/lessons.js
const EVENTS_KEPT = 200;
const STEP_ID = /^s\d{1,4}$/u;
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
	async function buildBoard({ course, row, signal, onStep, directive, style }) {
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
					onStep: (step) => api.push(step)
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
	async function scopeBoard(scope) {
		if (scope?.kind === "lesson") {
			const { course, row } = await context(scope.courseId, scope.lessonId);
			const board = await store.readJson(store.paths.board(course.id, row.lesson.id), null);
			return {
				course,
				lesson: row.lesson,
				board,
				language: course.language
			};
		}
		if (scope?.kind === "thread" || scope?.kind === "short") {
			const kind = scope.kind === "thread" ? "assist" : "shorts";
			const item = await store.readJson(store.paths.item(kind, scope.id), null);
			if (!item) throw new TutorError("not-found", "Not found");
			const board = scope.kind === "thread" ? item.turns?.[Math.max(0, Math.min(item.turns.length - 1, Number(scope.turn) || 0))]?.board : item.board;
			return {
				course: null,
				lesson: {
					title: item.title,
					objectives: []
				},
				board,
				language: item.language
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
		if (!request) throw new TutorError("invalid", "Type your question");
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
			if (!board?.steps?.length) throw new TutorError("invalid", "Nothing to re-explain yet");
			const index = Math.min(board.steps.length - 1, Math.max(0, Number(stepIndex) || 0));
			const answer = await generateSteps(llm, {
				purpose: "teach",
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
	async function record({ courseId, lessonId, conceptIds = [], evidence = {} }) {
		const course = await courses.readCourse(courseId);
		const index = conceptIndex(course);
		const ids = (Array.isArray(conceptIds) && conceptIds.length ? conceptIds : findLesson(course, lessonId)?.lesson.concepts.map((concept) => concept.id) ?? []).filter((id) => index.has(id)).slice(0, 8);
		const at = now().getTime();
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
			for (const id of ids) {
				const state = value.concepts[id] ?? createConceptState(id, index.get(id).name);
				value.concepts[id] = applyEvidence(state, evidence, at);
				if (evidence.kind !== "reexplain" && evidence.kind !== "self" && Number.isFinite(Number(evidence.score))) {
					const card = value.reviews[id] ?? createCard(id, at);
					value.reviews[id] = review(card, gradeFromScore(Number(evidence.score), evidence.confidence), at);
				}
			}
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
			recommendation: recommendNext(states)
		};
	}
	async function grade({ item, response, language = "zh-CN" }) {
		if (!item?.prompt) throw new TutorError("invalid", "Missing question");
		const answer = text(response, 4e3);
		if (!answer) return {
			score: 0,
			verdict: "incorrect",
			feedback: "",
			errorTag: "",
			misconception: false
		};
		return await generateJson(llm, {
			purpose: "quick",
			prompt: gradePrompt({
				item: {
					prompt: text(item.prompt, 2e3),
					answer: text(item.answer, 3e3),
					rubric: Array.isArray(item.rubric) ? item.rubric.map((entry) => text(entry, 300)) : []
				},
				response: answer,
				language
			}),
			maxTokens: 1200,
			normalize: (raw) => ({
				score: Math.min(1, Math.max(0, Number(raw?.score) || 0)),
				verdict: [
					"correct",
					"partial",
					"incorrect"
				].includes(raw?.verdict) ? raw.verdict : Number(raw?.score) >= .8 ? "correct" : Number(raw?.score) >= .4 ? "partial" : "incorrect",
				feedback: text(raw?.feedback, 1200),
				errorTag: text(raw?.errorTag, 80),
				misconception: raw?.misconception === true
			})
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
	async function unitQuiz({ courseId, unitId, force = false }) {
		const course = await courses.readCourse(courseId);
		const unit = course.units?.find((item) => item.id === assertId(unitId, "unt"));
		if (!unit) throw new TutorError("not-found", "Unit not found");
		if (!force) {
			const existing = await store.readJson(store.paths.unitQuiz(courseId, unitId), null);
			if (existing) return { quiz: existing };
		}
		return { job: jobs.start("unit/quiz", async (api) => {
			const concepts = unit.lectures.flatMap((lecture) => lecture.lessons.flatMap((lesson) => lesson.concepts));
			const saved = {
				unitId,
				...await generateJson(llm, {
					purpose: "teach",
					prompt: quizPrompt({
						scopeTitle: `${course.title} — ${unit.title}`,
						outline: outlineForPrompt({ units: [unit] }),
						concepts: concepts.map((concept) => `${concept.id}=${concept.name}`).join(", "),
						language: course.language,
						count: 10
					}),
					maxTokens: 9e3,
					signal: api.signal,
					normalize: (raw) => {
						const set = normalizePractice(raw, concepts.map((concept) => concept.id));
						if (set.items.length < 3) throw new Error("quiz too short");
						return set;
					}
				}),
				createdAt: stamp()
			};
			await store.writeJson(store.paths.unitQuiz(courseId, unitId), saved);
			return { quiz: saved };
		}, {
			key: `quiz:${courseId}:${unitId}`,
			meta: {
				courseId,
				unitId
			}
		}) };
	}
	async function flashcards({ courseId, force = false }) {
		const course = await courses.readCourse(courseId);
		if (!force) {
			const existing = await store.readJson(store.paths.cards(courseId), null);
			if (existing?.cards?.length) return { deck: existing };
		}
		return { job: jobs.start("course/cards", async (api) => {
			const materials = await readMaterials(store, course.materialIds ?? []);
			const outline = outlineForPrompt(course);
			const deck = {
				cards: await generateJson(llm, {
					purpose: "teach",
					prompt: flashcardsPrompt({
						scopeTitle: course.title,
						outline,
						passages: passagesFor(materials, outline, 6e3),
						language: course.language,
						count: 30
					}),
					maxTokens: 8e3,
					signal: api.signal,
					normalize: (raw) => {
						const value = normalizeCards(raw);
						if (!value.length) throw new Error("no cards");
						return value;
					}
				}),
				srs: {},
				createdAt: stamp()
			};
			await store.writeJson(store.paths.cards(courseId), deck);
			return { deck };
		}, {
			key: `cards:${courseId}`,
			meta: { courseId }
		}) };
	}
	async function reviewCard({ courseId, cardId, grade: answer }) {
		return { srs: (await store.updateJson(store.paths.cards(assertId(courseId, "crs")), null, (value) => {
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
		record,
		grade,
		savePosition,
		complete,
		practice,
		unitSheet,
		saveSheetLayout,
		unitQuiz,
		flashcards,
		reviewCard
	});
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
	ABORTED: ["cancelled", "Cancelled"]
});
function toTutorError(code, fallback) {
	const known = USER_ERRORS[code];
	if (known) return new TutorError(known[0], known[1]);
	return new TutorError("llm-failed", `The model call failed${code ? ` (${code})` : ""}${fallback ? `: ${fallback}` : ""}`);
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
		throw new TutorError("llm-unavailable", "No model is configured in DSH yet.");
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
	async function content(user, images, prepared) {
		const blocks = [{
			type: "text",
			text: String(user ?? "")
		}];
		if (!images?.length || prepared.inputModalities?.includes("image") !== true) return blocks;
		const attachments = getAttachments();
		if (typeof attachments?.saveImage !== "function") return blocks;
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
			logger?.debug?.("aha-tutor could not attach an image: %s", error?.message);
		}
		return blocks;
	}
	async function attempt({ purpose, system, user, images, maxTokens, signal, onText }) {
		const llm = getLlm();
		if (!llm) throw new TutorError("llm-unavailable", "DSH has no model service in this profile.");
		const target = route(purpose);
		const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
		const fused = signal ? AbortSignal.any([signal, timeout]) : timeout;
		let prepared;
		try {
			prepared = await llm.prepareCall({
				...target,
				maxTokens
			}, fused, purpose === "quick" ? (controls, model) => {
				const lowest = model?.reasoning?.efforts?.[0];
				return lowest ? {
					...controls,
					reasoningEffort: lowest.id
				} : controls;
			} : void 0);
		} catch (error) {
			if (signal?.aborted) throw signal.reason ?? error;
			throw Object.assign(toTutorError(error?.code, error?.message), { retryable: false });
		}
		let textValue = "";
		let finish = null;
		const messages = [{
			role: "user",
			content: await content(user, images, prepared)
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
			} else if (chunk.type === "finish") finish = chunk.reason;
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
			streamed: false
		});
		return textValue;
	}
	async function call(options) {
		let lastError;
		for (let tries = 0; tries <= MAX_RETRIES; tries += 1) try {
			return await attempt(options);
		} catch (error) {
			lastError = error;
			if (options.signal?.aborted || !error?.retryable || error?.streamed || tries === MAX_RETRIES) throw error;
			await sleep$1(Math.min(2e4, Number(error.retryAfterMs) || 1500 * (tries + 1)), options.signal);
		}
		throw lastError;
	}
	return Object.freeze({
		complete: (options) => call({
			...options,
			onText: void 0
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
		cards: (id) => join(paths.courseDir(id), "cards.json"),
		boardsDir: (id) => join(paths.courseDir(id), "boards"),
		practiceDir: (id) => join(paths.courseDir(id), "practice"),
		sheetsDir: (id) => join(paths.courseDir(id), "sheets"),
		board: (id, lessonId) => join(paths.courseDir(id), "boards", `${assertId(lessonId, "les")}.json`),
		practice: (id, lessonId) => join(paths.courseDir(id), "practice", `${assertId(lessonId, "les")}.json`),
		asides: (id, lessonId) => join(paths.courseDir(id), "asides", `${assertId(lessonId, "les")}.json`),
		sheet: (id, unitId) => join(paths.courseDir(id), "sheets", `${assertId(unitId, "unt")}.json`),
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
			if (!parts.length) throw new TutorError("invalid", "Nothing to review yet: write a note or work in the project folder first");
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
	nte: ID("nte")
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
	if (scope.kind === "lesson") return {
		kind: "lesson",
		courseId: need(scope, "courseId", "crs"),
		lessonId: need(scope, "lessonId", "les")
	};
	if (scope.kind === "thread") return {
		kind: "thread",
		id: need(scope, "id", "thd"),
		turn: Number(scope.turn) || 0
	};
	if (scope.kind === "short") return {
		kind: "short",
		id: need(scope, "id", "sht")
	};
	throw new TutorError("invalid", "Invalid board scope");
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
function createRoutes({ courses, lessons, learner, studio, projects, jobs, settings, tts, plugin, info }) {
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
			language: typeof payload.language === "string" ? payload.language.slice(0, 12) : void 0
		}) }),
		"course/intake": (payload) => ({ job: courses.submitIntake({
			courseId: need(payload, "courseId", "crs"),
			answers: payload.answers,
			timeline: payload.timeline,
			weeklyMinutes: payload.weeklyMinutes,
			deadline: payload.deadline
		}) }),
		"course/revise": (payload) => ({ job: courses.revise({
			courseId: need(payload, "courseId", "crs"),
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
		"course/cards": (payload) => lessons.flashcards({
			courseId: need(payload, "courseId", "crs"),
			force: payload.force === true
		}),
		"course/card-review": (payload) => {
			if (!GRADES.includes(payload.grade)) throw new TutorError("invalid", "Invalid grade");
			return lessons.reviewCard({
				courseId: need(payload, "courseId", "crs"),
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
		"lesson/record": (payload) => lessons.record({
			courseId: need(payload, "courseId", "crs"),
			lessonId: optional(payload, "lessonId", "les"),
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
		"profile/get": () => learner.getProfile(),
		"profile/save": (payload) => learner.saveProfile({
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
		"review/session": () => learner.reviewSession(),
		"material/upload": (payload) => ({ job: studio.upload({
			name: payload.name,
			base64: payload.base64
		}) }),
		"material/url": (payload) => ({ job: studio.addUrl({ url: payload.url }) }),
		"material/list": () => studio.listMaterials(),
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
		"studio/notes": (payload) => ({ job: studio.makeNotes({ materialIds: idList(payload.materialIds, "mat") }) }),
		"studio/cards": (payload) => ({ job: studio.makeCards({
			materialIds: idList(payload.materialIds, "mat"),
			count: payload.count
		}) }),
		"studio/quiz": (payload) => ({ job: studio.makeQuiz({
			materialIds: idList(payload.materialIds, "mat"),
			count: payload.count
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
			const known = [
				"TutorError",
				"MaterialError",
				"TtsError"
			].includes(error?.name);
			if (!known) logger?.warn?.("aha-tutor %s failed: %s", endpoint, error?.message);
			return failure(known ? error.code ?? "failed" : "failed", known ? error.message : publicMessage(error));
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
const REQUEST_TIMEOUT_MS = 45e3;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
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
		throw new TtsError("config", "TTS address is not a valid URL");
	}
	const local = [
		"localhost",
		"127.0.0.1",
		"[::1]"
	].includes(url.hostname);
	if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new TtsError("config", "TTS address must use https (http only for localhost)");
	if (url.username || url.password) throw new TtsError("config", "TTS address must not contain credentials");
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
async function boundedFetch(fetchImpl, url, init, signal) {
	const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
	const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
	let response;
	try {
		response = await fetchImpl(url, {
			...init,
			redirect: "error",
			signal: combined
		});
	} catch (error) {
		if (signal?.aborted) throw signal.reason ?? error;
		throw new TtsError(timeout.aborted ? "timeout" : "network", timeout.aborted ? "TTS request timed out" : "Could not reach the TTS service");
	}
	return response;
}
async function readBounded(response) {
	const length = Number(response.headers.get("content-length"));
	if (Number.isFinite(length) && length > MAX_AUDIO_BYTES) throw new TtsError("too-large", "TTS response is too large");
	const buffer = Buffer.from(await response.arrayBuffer());
	if (buffer.length > MAX_AUDIO_BYTES) throw new TtsError("too-large", "TTS response is too large");
	return buffer;
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
	async openai({ text, config, secret, rate, fetchImpl, signal }) {
		const base = checkEndpoint(config.baseUrl || "https://api.openai.com/v1");
		const path = base.pathname.replace(/\/+$/u, "");
		const response = await boundedFetch(fetchImpl, new URL(`${path}/audio/speech`, base), {
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
		}, signal);
		if (!response.ok) throw httpError(response.status);
		return readBounded(response);
	},
	async volcengine({ text, config, secret, rate, fetchImpl, signal }) {
		if (!config.appId) throw new TtsError("config", "Volcengine App ID is required");
		const response = await boundedFetch(fetchImpl, "https://openspeech.bytedance.com/api/v1/tts", {
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
		}, signal);
		if (!response.ok) throw httpError(response.status);
		let body;
		try {
			body = await response.json();
		} catch {
			throw new TtsError("response", "Volcengine returned an unreadable response");
		}
		if (body?.code !== 3e3 || typeof body?.data !== "string") throw new TtsError(body?.code === 3001 || body?.code === 3003 ? "auth" : "request", `Volcengine TTS failed (${body?.code ?? "unknown"})`);
		const audio = Buffer.from(body.data, "base64");
		if (audio.length > MAX_AUDIO_BYTES) throw new TtsError("too-large", "TTS response is too large");
		return audio;
	},
	async minimax({ text, config, secret, rate, fetchImpl, signal }) {
		const base = checkEndpoint(config.baseUrl || "https://api.minimaxi.com");
		const url = new URL("/v1/t2a_v2", base);
		if (config.groupId) url.searchParams.set("GroupId", config.groupId);
		const response = await boundedFetch(fetchImpl, url, {
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
		}, signal);
		if (!response.ok) throw httpError(response.status);
		let body;
		try {
			body = await response.json();
		} catch {
			throw new TtsError("response", "MiniMax returned an unreadable response");
		}
		const status = body?.base_resp?.status_code;
		if (status !== 0 || typeof body?.data?.audio !== "string") throw new TtsError(status === 1004 || status === 2049 ? "auth" : "request", `MiniMax TTS failed (${status ?? "unknown"})`);
		const audio = Buffer.from(body.data.audio, "hex");
		if (audio.length > MAX_AUDIO_BYTES) throw new TtsError("too-large", "TTS response is too large");
		return audio;
	},
	async azure({ text, config, secret, rate, fetchImpl, signal }) {
		const region = String(config.region || "").trim().toLowerCase();
		if (!/^[a-z0-9]{2,30}$/u.test(region)) throw new TtsError("config", "Azure region is invalid");
		const voice = String(config.voice || "zh-CN-XiaoxiaoNeural");
		if (!/^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z0-9:]+$/u.test(voice)) throw new TtsError("config", "Azure voice name is invalid");
		const lang = voice.split("-").slice(0, 2).join("-");
		const percent = Math.round((rateNumber(rate) - 1) * 100);
		const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><voice name="${voice}"><prosody rate="${percent >= 0 ? "+" : ""}${percent}%">${xmlEscape(text)}</prosody></voice></speak>`;
		const response = await boundedFetch(fetchImpl, `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
			method: "POST",
			headers: {
				"Ocp-Apim-Subscription-Key": secret,
				"Content-Type": "application/ssml+xml",
				"X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
				"User-Agent": "dsh-aha-tutor"
			},
			body: ssml
		}, signal);
		if (!response.ok) throw httpError(response.status);
		return readBounded(response);
	}
};
const CHUNK_UNITS = Object.freeze({
	openai: 3800,
	volcengine: 900,
	minimax: 9e3,
	azure: 6e3
});
function createTts({ cacheDir, fetchImpl = globalThis.fetch, getSecret }) {
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
		if (!content) throw new TtsError("request", "Nothing to speak");
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
		if (!secret) throw new TtsError("auth", "No key saved for this TTS provider");
		const parts = [];
		for (const chunk of splitForTts(content, CHUNK_UNITS[provider])) parts.push(await synthesizers[provider]({
			text: chunk,
			config: merged,
			secret,
			rate,
			fetchImpl,
			signal
		}));
		const audio = Buffer.concat(parts);
		if (!audio.length) throw new TtsError("response", "The TTS service returned no audio");
		if (file) {
			await writeFileAtomic(file, audio).catch(() => void 0);
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
		if (!credentials) throw new TutorError("unavailable", "DSH credentials are not available in this profile");
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
			if (!/^[\x21-\x7E]{8,1024}$/u.test(key)) throw new TutorError("invalid", "The key looks wrong (8–1024 printable characters, no spaces)");
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
//#region src/host/studio.js
const ASSIST_MODES = [
	"explain",
	"solve",
	"visualize"
];
const DIGEST_SINGLE_CHARS = 24e3;
const DIGEST_NOTES_CHARS = 48e3;
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
	function upload({ name, base64, bytes: raw }) {
		const fileName = text(name, 200) || "file";
		if (!raw && (typeof base64 !== "string" || !base64)) throw new TutorError("invalid", "No file data");
		if (raw ? raw.length > 62914560 : base64.length > Math.ceil(62914560 * 4 / 3) + 8) throw new TutorError("too-large", "The file is larger than 60 MB");
		return jobs.start("material/upload", async (api) => {
			api.progress(0, 2, "reading");
			const bytes = raw ? Buffer.from(raw) : Buffer.from(base64, "base64");
			const result = await ingestFile({
				name: fileName,
				bytes,
				signal: api.signal
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
			const result = await ingestUrl(url, { signal: api.signal });
			api.progress(1, 2, "summarizing");
			return { material: await saveMaterial(result, { signal: api.signal }) };
		});
	}
	async function listMaterials() {
		const ids = await store.listIds(store.paths.materials(), "mat");
		return (await Promise.all(ids.map((id) => store.readJson(store.paths.material(id), null)))).filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
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
			if (!material?.chunks.length) throw new TutorError("invalid", "This material has no text to digest");
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
		if (!ids.length) throw new TutorError("invalid", "Pick at least one material");
		const materials = await readMaterials(store, ids);
		if (!materials.some((item) => item.chunks.length)) throw new TutorError("invalid", "These materials have no text");
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
	function makeNotes({ materialIds }) {
		return jobs.start("studio/notes", async (api) => {
			const scope = await scopeOf(materialIds);
			const markdown = await generateText(llm, {
				purpose: "teach",
				prompt: summaryPrompt({
					scopeTitle: scope.title,
					outline: scope.outline,
					passages: passagesFor(scope.materials, scope.outline, 22e3),
					language: scope.language
				}),
				maxTokens: 8e3,
				signal: api.signal
			});
			const item = {
				id: newId("chs"),
				kind: "notes",
				title: scope.title,
				language: scope.language,
				materialIds: scope.ids,
				markdown: markdown.slice(0, 6e4),
				createdAt: stamp()
			};
			await store.writeJson(store.paths.item("sheets", item.id), item);
			return { item };
		});
	}
	function makeCards({ materialIds, count = 24 }) {
		return jobs.start("studio/cards", async (api) => {
			const scope = await scopeOf(materialIds);
			const cards = await generateJson(llm, {
				purpose: "teach",
				prompt: flashcardsPrompt({
					scopeTitle: scope.title,
					outline: scope.outline,
					passages: passagesFor(scope.materials, scope.outline, 18e3),
					language: scope.language,
					count: Math.min(60, Math.max(8, Math.round(Number(count) || 24)))
				}),
				maxTokens: 9e3,
				signal: api.signal,
				normalize: (raw) => {
					const value = normalizeCards(raw);
					if (!value.length) throw new Error("no cards");
					return value;
				}
			});
			const item = {
				id: newId("dck"),
				kind: "cards",
				title: scope.title,
				language: scope.language,
				materialIds: scope.ids,
				cards,
				srs: {},
				createdAt: stamp()
			};
			await store.writeJson(store.paths.item("decks", item.id), item);
			return { item };
		});
	}
	function makeQuiz({ materialIds, count = 10 }) {
		return jobs.start("studio/quiz", async (api) => {
			const scope = await scopeOf(materialIds);
			const quiz = await generateJson(llm, {
				purpose: "teach",
				prompt: quizPrompt({
					scopeTitle: scope.title,
					outline: `${scope.outline}\n\n${passagesFor(scope.materials, scope.outline, 16e3)}`,
					concepts: "",
					language: scope.language,
					count: Math.min(25, Math.max(5, Math.round(Number(count) || 10)))
				}),
				maxTokens: 9e3,
				signal: api.signal,
				normalize: (raw) => {
					const set = normalizePractice(raw, []);
					if (set.items.length < 3) throw new Error("quiz too short");
					return set;
				}
			});
			const item = {
				id: newId("dck"),
				kind: "quiz",
				title: scope.title,
				language: scope.language,
				materialIds: scope.ids,
				items: quiz.items,
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
		if (!ask) throw new TutorError("invalid", "Type your question");
		const chosen = ASSIST_MODES.includes(mode) ? mode : "explain";
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
			const id = thread?.id ?? (/^thd_[a-z0-9]{6,40}$/u.test(String(newThreadId)) ? newThreadId : newId("thd"));
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
		}, { meta: { threadId: threadId ?? null } });
	}
	async function assistImages(ids) {
		return llm.supportsImages?.("teach") ? materialImages(store, await readMaterials(store, ids)) : [];
	}
	function makeShort({ topic, url, newId: presetId }) {
		const subject = text(topic, 300);
		if (!subject && !url) throw new TutorError("invalid", "Give a topic or a web address");
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
				id: /^sht_[a-z0-9]{6,40}$/u.test(String(presetId)) ? presetId : newId("sht"),
				title: board.title || subject || sourceTitle,
				topic: subject,
				sourceUrl: url ? String(url) : null,
				language,
				board,
				createdAt: stamp()
			};
			await store.writeJson(store.paths.item("shorts", item.id), item);
			return { item };
		});
	}
	return Object.freeze({
		upload,
		addUrl,
		listMaterials,
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
		jobs
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
			info
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
