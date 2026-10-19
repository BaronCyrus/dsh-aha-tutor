//#region src/core/ids.js
const ID_PATTERN = /^[a-z]{2,6}_[a-z0-9]{6,40}$/u;
function randomPart(length) {
	const bytes = new Uint8Array(length);
	globalThis.crypto.getRandomValues(bytes);
	let text = "";
	for (const byte of bytes) text += (byte % 36).toString(36);
	return text;
}
function newId(prefix) {
	if (!/^[a-z]{2,6}$/u.test(prefix)) throw new TypeError(`invalid id prefix "${prefix}"`);
	return `${prefix}_${Date.now().toString(36)}${randomPart(6)}`;
}
function isId(value, prefix) {
	if (typeof value !== "string" || !ID_PATTERN.test(value)) return false;
	return prefix === void 0 || value.startsWith(`${prefix}_`);
}
function assertId(value, prefix) {
	if (!isId(value, prefix)) throw new TypeError(`invalid ${prefix ?? ""} id`);
	return value;
}
//#endregion
//#region src/core/course-model.js
const LIMITS = Object.freeze({
	questions: 6,
	options: 5,
	units: 12,
	lecturesPerUnit: 8,
	lessonsPerLecture: 8,
	lessons: 120,
	objectives: 5,
	concepts: 6,
	projects: 3,
	milestones: 6,
	rubric: 8,
	starterFiles: 12,
	starterFileBytes: 64 * 1024,
	practiceItems: 12,
	options4: 6,
	cards: 60,
	sheetSections: 24,
	sheetItems: 16
});
function text(value, max = 400) {
	if (value === null || value === void 0) return "";
	return String(value).replace(/\u0000/gu, "").trim().slice(0, max);
}
function list(value, max, mapper) {
	return (Array.isArray(value) ? value : []).slice(0, max).map(mapper).filter(Boolean);
}
function strings(value, max, length = 200) {
	return list(value, max, (item) => text(typeof item === "object" ? item?.text ?? item?.name ?? item?.title : item, length) || null);
}
function minutes(value, fallback = 15) {
	const number = Math.round(Number(value));
	return Number.isFinite(number) ? Math.min(90, Math.max(5, number)) : fallback;
}
const EMOJI = /\p{Extended_Pictographic}/u;
function emoji(value) {
	const match = EMOJI.exec(String(value ?? ""));
	return match ? match[0] : "📘";
}
function normalizeQuestionnaire(raw) {
	return { questions: list(Array.isArray(raw) ? raw : raw?.questions, LIMITS.questions, (question, index) => {
		const prompt = text(question?.prompt ?? question?.question ?? question?.title, 200);
		if (!prompt) return null;
		const options = list(question?.options, LIMITS.options, (option, optionIndex) => {
			const label = text(typeof option === "string" ? option : option?.label ?? option?.title, 80);
			if (!label) return null;
			return {
				id: String.fromCharCode(97 + optionIndex),
				label,
				detail: text(option?.detail ?? option?.description, 160)
			};
		});
		if (options.length < 2) return null;
		return {
			id: `q${index + 1}`,
			prompt,
			topic: text(question?.topic ?? question?.key, 40),
			multi: question?.multi === true || question?.multiple === true,
			options
		};
	}).map((question, index) => ({
		...question,
		id: `q${index + 1}`
	})) };
}
function intakeSummary(questionnaire, answers) {
	const lines = [];
	for (const question of questionnaire?.questions ?? []) {
		const answer = answers?.[question.id];
		if (!answer) continue;
		const picked = (answer.choice ?? []).map((id) => question.options.find((option) => option.id === id)).filter(Boolean).map((option) => option.detail ? `${option.label}（${option.detail}）` : option.label);
		const other = text(answer.other, 300);
		if (other) picked.push(other);
		if (picked.length) lines.push(`- ${question.prompt}：${picked.join("；")}`);
	}
	return lines.join("\n");
}
function normalizeConcepts(raw, fallbackName) {
	const concepts = list(raw, LIMITS.concepts, (item) => {
		const name = text(typeof item === "string" ? item : item?.name ?? item?.title, 80);
		if (!name) return null;
		return {
			id: typeof item?.id === "string" && /^cpt_[a-z0-9]+$/u.test(item.id) ? item.id : newId("cpt"),
			name
		};
	});
	if (!concepts.length && fallbackName) concepts.push({
		id: newId("cpt"),
		name: text(fallbackName, 80)
	});
	return concepts;
}
function keepId(value, prefix) {
	return typeof value === "string" && new RegExp(`^${prefix}_[a-z0-9]{6,40}$`, "u").test(value) ? value : newId(prefix);
}
function normalizeLesson(raw) {
	const title = text(raw?.title, 120);
	if (!title) return null;
	return {
		id: keepId(raw?.id, "les"),
		title,
		summary: text(raw?.summary ?? raw?.description, 300),
		objectives: strings(raw?.objectives ?? raw?.goals, LIMITS.objectives),
		concepts: normalizeConcepts(raw?.concepts, title),
		estMinutes: minutes(raw?.estMinutes ?? raw?.minutes),
		kind: [
			"lesson",
			"remedial",
			"review",
			"challenge"
		].includes(raw?.kind) ? raw.kind : "lesson"
	};
}
function normalizeUnits(rawUnits) {
	let lessonBudget = LIMITS.lessons;
	return list(rawUnits, LIMITS.units, (unit) => {
		const title = text(unit?.title, 120);
		if (!title) return null;
		const lectures = list(unit?.lectures, LIMITS.lecturesPerUnit, (lecture) => {
			const lectureTitle = text(lecture?.title, 120);
			if (!lectureTitle) return null;
			const lessons = list(lecture?.lessons, LIMITS.lessonsPerLecture, (lesson) => {
				if (lessonBudget <= 0) return null;
				const normalized = normalizeLesson(lesson);
				if (normalized) lessonBudget -= 1;
				return normalized;
			});
			if (!lessons.length) return null;
			return {
				id: keepId(lecture?.id, "lec"),
				title: lectureTitle,
				summary: text(lecture?.summary, 300),
				lessons
			};
		});
		if (!lectures.length) return null;
		return {
			id: keepId(unit?.id, "unt"),
			title,
			summary: text(unit?.summary, 400),
			objectives: strings(unit?.objectives, LIMITS.objectives),
			lectures
		};
	});
}
function normalizeProject(raw) {
	const title = text(raw?.title, 120);
	if (!title) return null;
	const kind = [
		"code",
		"writing",
		"analysis",
		"design",
		"practice",
		"other"
	].includes(raw?.kind) ? raw.kind : "other";
	const starterFiles = list(raw?.starterFiles ?? raw?.files, LIMITS.starterFiles, (file) => {
		const path = safeRelativePath(file?.path ?? file?.name);
		if (!path) return null;
		return {
			path,
			content: String(file?.content ?? "").slice(0, LIMITS.starterFileBytes)
		};
	});
	return {
		id: keepId(raw?.id, "prj"),
		title,
		kind,
		brief: text(raw?.brief ?? raw?.description, 2e3),
		skills: strings(raw?.skills, 8, 80),
		milestones: list(raw?.milestones, LIMITS.milestones, (item, index) => {
			const milestone = text(typeof item === "string" ? item : item?.title, 160);
			return milestone ? {
				id: `m${index + 1}`,
				title: milestone,
				detail: text(item?.detail, 600)
			} : null;
		}),
		rubric: list(raw?.rubric, LIMITS.rubric, (item, index) => {
			const criterion = text(typeof item === "string" ? item : item?.criterion ?? item?.title, 160);
			if (!criterion) return null;
			const points = Math.round(Number(item?.points));
			return {
				id: `r${index + 1}`,
				criterion,
				points: Number.isFinite(points) && points > 0 ? Math.min(100, points) : 10,
				detail: text(item?.detail, 400)
			};
		}),
		starterFiles,
		unitId: typeof raw?.unitId === "string" ? raw.unitId : null
	};
}
function safeRelativePath(value) {
	const raw = String(value ?? "").replace(/\\/gu, "/").trim();
	if (!raw || raw.startsWith("/") || /^[a-z]:/iu.test(raw)) return null;
	const parts = raw.split("/").filter((part) => part && part !== ".");
	if (!parts.length || parts.length > 6) return null;
	for (const part of parts) {
		if (part === ".." || /[<>:"|?*\u0000-\u001f]/u.test(part) || /[. ]$/u.test(part)) return null;
		if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/iu.test(part)) return null;
		if (part.length > 80) return null;
	}
	return parts.join("/");
}
function normalizeBlueprint(raw, { language } = {}) {
	const units = normalizeUnits(raw?.units);
	if (!units.length) throw new Error("blueprint has no usable units");
	return {
		title: text(raw?.title, 120) || units[0].title,
		subtitle: text(raw?.subtitle ?? raw?.tagline, 200),
		emoji: emoji(raw?.emoji),
		summary: text(raw?.summary ?? raw?.description, 1200),
		level: text(raw?.level, 40),
		language: text(raw?.language ?? language, 20) || "zh-CN",
		units,
		projects: list(raw?.projects, LIMITS.projects, normalizeProject)
	};
}
const ITEM_KINDS = [
	"choice",
	"multi",
	"blank",
	"number",
	"short",
	"order"
];
function normalizeItem(raw, index = 0, conceptIds = []) {
	const kind = ITEM_KINDS.includes(raw?.kind) ? raw.kind : raw?.options ? "choice" : "short";
	const prompt = text(raw?.prompt ?? raw?.question, 2e3);
	if (!prompt) return null;
	const item = {
		id: typeof raw?.id === "string" && /^[a-z0-9_-]{1,24}$/iu.test(raw.id) ? raw.id : `i${index + 1}`,
		kind,
		prompt,
		explanation: text(raw?.explanation, 2e3),
		hints: strings(raw?.hints, 3, 400),
		difficulty: Math.min(3, Math.max(1, Math.round(Number(raw?.difficulty) || 2))),
		conceptIds: (Array.isArray(raw?.conceptIds) ? raw.conceptIds : []).filter((id) => conceptIds.includes(id)).slice(0, 4)
	};
	if (kind === "choice" || kind === "multi" || kind === "order") {
		item.options = list(raw?.options, LIMITS.options4, (option, optionIndex) => {
			const label = text(typeof option === "string" ? option : option?.text ?? option?.label, 400);
			return label ? {
				id: String.fromCharCode(97 + optionIndex),
				text: label
			} : null;
		});
		if (item.options.length < 2) return null;
		const ids = item.options.map((option) => option.id);
		const toId = (value) => {
			if (typeof value === "number") return ids[value] ?? null;
			const raw = String(value ?? "").trim().toLowerCase();
			if (ids.includes(raw)) return raw;
			const byText = item.options.find((option) => option.text.toLowerCase() === raw);
			return byText ? byText.id : null;
		};
		if (kind === "choice") {
			item.answer = toId(Array.isArray(raw?.answer) ? raw.answer[0] : raw?.answer);
			if (!item.answer) return null;
		} else {
			item.answer = (Array.isArray(raw?.answer) ? raw.answer : [raw?.answer]).map(toId).filter(Boolean);
			if (!item.answer.length) return null;
		}
	} else if (kind === "number") {
		item.answer = Number(raw?.answer);
		if (!Number.isFinite(item.answer)) return null;
		const tolerance = Number(raw?.tolerance);
		if (Number.isFinite(tolerance) && tolerance >= 0) item.tolerance = tolerance;
		item.unit = text(raw?.unit, 20);
	} else if (kind === "blank") {
		item.answer = strings(Array.isArray(raw?.answer) ? raw.answer : [raw?.answer], 6, 200);
		if (!item.answer.length) return null;
	} else {
		item.answer = text(raw?.answer ?? raw?.reference, 3e3);
		item.rubric = strings(raw?.rubric, 6, 300);
	}
	return item;
}
function normalizePractice(raw, conceptIds = []) {
	return { items: list(raw?.items ?? raw, LIMITS.practiceItems, (item, index) => normalizeItem(item, index, conceptIds)).map((item, index) => ({
		...item,
		id: `i${index + 1}`
	})) };
}
function normalizeCards(raw) {
	return list(raw?.cards ?? raw, LIMITS.cards, (card, index) => {
		const front = text(card?.front ?? card?.q ?? card?.question, 600);
		const back = text(card?.back ?? card?.a ?? card?.answer, 1500);
		if (!front || !back) return null;
		return {
			id: `c${index + 1}`,
			front,
			back,
			tag: text(card?.tag ?? card?.topic, 60)
		};
	}).map((card, index) => ({
		...card,
		id: `c${index + 1}`
	}));
}
const SHEET_KINDS = [
	"definition",
	"formula",
	"fact",
	"tip",
	"pitfall",
	"example",
	"compare"
];
function normalizeCheatsheet(raw) {
	const sections = list(raw?.sections, LIMITS.sheetSections, (section, index) => {
		const title = text(section?.title, 120);
		if (!title) return null;
		const items = list(section?.items, LIMITS.sheetItems, (item) => {
			const body = text(typeof item === "string" ? item : item?.text ?? item?.body, 800);
			const tex = text(item?.tex ?? item?.latex, 400);
			if (!body && !tex) return null;
			const page = Math.round(Number(item?.cite?.page ?? item?.page));
			return {
				kind: SHEET_KINDS.includes(item?.kind) ? item.kind : "fact",
				title: text(item?.title ?? item?.term, 120),
				text: body,
				tex,
				cite: Number.isFinite(page) && page > 0 ? {
					page,
					source: text(item?.cite?.source ?? item?.source, 120)
				} : null
			};
		});
		if (!items.length) return null;
		return {
			id: `sec${index + 1}`,
			title,
			items,
			related: strings(section?.related, 4, 120)
		};
	});
	if (!sections.length) throw new Error("cheatsheet has no sections");
	return {
		title: text(raw?.title, 160),
		sections: sections.map((section, index) => ({
			...section,
			id: `sec${index + 1}`
		})),
		layout: {
			columns: 3,
			fontSize: 12,
			highlight: true,
			order: sections.map((_, index) => `sec${index + 1}`)
		}
	};
}
function flattenLessons(course) {
	const rows = [];
	for (const unit of course?.units ?? []) for (const lecture of unit.lectures ?? []) for (const lesson of lecture.lessons ?? []) rows.push({
		unit,
		lecture,
		lesson,
		index: rows.length
	});
	return rows;
}
function findLesson(course, lessonId) {
	return flattenLessons(course).find((row) => row.lesson.id === lessonId) ?? null;
}
function conceptIndex(course) {
	const index = /* @__PURE__ */ new Map();
	for (const { lesson } of flattenLessons(course)) for (const concept of lesson.concepts ?? []) index.set(concept.id, {
		...concept,
		lessonId: lesson.id
	});
	return index;
}
function lessonStatus(progress, lessonId) {
	return progress?.lessons?.[lessonId]?.status ?? "new";
}
function courseProgress(course, progress) {
	const rows = flattenLessons(course);
	const done = rows.filter((row) => lessonStatus(progress, row.lesson.id) === "done");
	const minutesLeft = rows.filter((row) => lessonStatus(progress, row.lesson.id) !== "done").reduce((sum, row) => sum + (row.lesson.estMinutes || 15), 0);
	return {
		total: rows.length,
		done: done.length,
		percent: rows.length ? Math.round(done.length / rows.length * 100) : 0,
		minutesLeft
	};
}
function nextLesson(course, progress) {
	const rows = flattenLessons(course);
	return rows.find((row) => lessonStatus(progress, row.lesson.id) === "learning") ?? rows.find((row) => lessonStatus(progress, row.lesson.id) === "new") ?? null;
}
function lessonAfter(course, lessonId) {
	const rows = flattenLessons(course);
	const index = rows.findIndex((row) => row.lesson.id === lessonId);
	return index >= 0 ? rows[index + 1] ?? null : null;
}
function insertLesson(course, afterLessonId, lesson) {
	const normalized = normalizeLesson(lesson);
	if (!normalized) throw new Error("invalid lesson");
	for (const unit of course.units) for (const lecture of unit.lectures) {
		const index = lecture.lessons.findIndex((item) => item.id === afterLessonId);
		if (index >= 0) {
			lecture.lessons.splice(index + 1, 0, normalized);
			return normalized;
		}
	}
	throw new Error("lesson not found");
}
function outlineForPrompt(course, { withIds = false, maxChars = 6e3 } = {}) {
	const lines = [];
	course?.units?.forEach((unit, unitIndex) => {
		lines.push(`Unit ${unitIndex + 1}: ${unit.title}${withIds ? ` [${unit.id}]` : ""}`);
		unit.lectures.forEach((lecture, lectureIndex) => {
			lines.push(`  Lecture ${unitIndex + 1}.${lectureIndex + 1}: ${lecture.title}`);
			lecture.lessons.forEach((lesson) => {
				lines.push(`    - ${lesson.title}${withIds ? ` [${lesson.id}]` : ""}`);
			});
		});
	});
	const outline = lines.join("\n");
	return outline.length > maxChars ? `${outline.slice(0, maxChars)}\n…` : outline;
}
//#endregion
//#region src/core/board-script.js
const BOARD_LIMITS = Object.freeze({
	steps: 48,
	opsPerStep: 14,
	say: 1200,
	opText: 1600,
	listItems: 12,
	tableRows: 16,
	tableCols: 8,
	svgBytes: 48 * 1024,
	animBytes: 64 * 1024,
	codeBytes: 12 * 1024,
	chartPoints: 400,
	chartSeries: 6
});
const OP_TYPES = Object.freeze([
	"title",
	"h",
	"p",
	"math",
	"list",
	"svg",
	"chart",
	"table",
	"code",
	"note",
	"mark",
	"anim",
	"col",
	"page"
]);
const OP_ALIASES = Object.freeze({
	heading: "h",
	header: "h",
	subtitle: "h",
	text: "p",
	paragraph: "p",
	write: "p",
	formula: "math",
	equation: "math",
	latex: "math",
	bullets: "list",
	bullet: "list",
	diagram: "svg",
	drawing: "svg",
	figure: "svg",
	graph: "chart",
	plot: "chart",
	callout: "note",
	highlight: "mark",
	underline: "mark",
	animation: "anim",
	interactive: "anim",
	column: "col",
	newcolumn: "col",
	newpage: "page",
	clear: "page"
});
const CHART_KINDS = [
	"line",
	"bar",
	"scatter",
	"pie",
	"area"
];
const NOTE_TONES = [
	"tip",
	"warn",
	"key",
	"example"
];
const MARK_STYLES = [
	"underline",
	"circle",
	"box"
];
function opType(raw) {
	const type = String(raw?.t ?? raw?.type ?? raw?.op ?? "").toLowerCase().replace(/[^a-z]/gu, "");
	return OP_TYPES.includes(type) ? type : OP_ALIASES[type];
}
function chartSeries(raw) {
	return {
		series: (Array.isArray(raw?.series) ? raw.series : []).slice(0, BOARD_LIMITS.chartSeries).map((item) => {
			const points = (Array.isArray(item?.points) ? item.points : []).slice(0, BOARD_LIMITS.chartPoints).map((point) => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : [Number(point?.x), Number(point?.y)]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
			return points.length ? {
				name: text(item?.name, 60),
				points
			} : null;
		}).filter(Boolean),
		data: (Array.isArray(raw?.data) ? raw.data : []).slice(0, 40).map((item) => {
			const value = Number(item?.value ?? item?.y);
			const label = text(item?.label ?? item?.x ?? item?.name, 60);
			return label && Number.isFinite(value) ? {
				label,
				value
			} : null;
		}).filter(Boolean)
	};
}
function normalizeOp(raw, index) {
	const t = opType(raw);
	if (!t) return null;
	const id = typeof raw?.id === "string" && /^[a-z0-9_-]{1,24}$/iu.test(raw.id) ? raw.id : `o${index + 1}`;
	switch (t) {
		case "title":
		case "h":
		case "p": {
			const value = text(raw?.text ?? raw?.content ?? raw?.value, t === "p" ? BOARD_LIMITS.opText : 160);
			return value ? {
				id,
				t,
				text: value
			} : null;
		}
		case "math": {
			const tex = text(raw?.tex ?? raw?.latex ?? raw?.formula, 600);
			return tex ? {
				id,
				t,
				tex,
				text: text(raw?.text ?? raw?.plain, 300)
			} : null;
		}
		case "list": {
			const items = (Array.isArray(raw?.items) ? raw.items : []).slice(0, BOARD_LIMITS.listItems).map((item) => text(item, 400)).filter(Boolean);
			return items.length ? {
				id,
				t,
				items,
				ordered: raw?.ordered === true
			} : null;
		}
		case "svg": {
			const svg = String(raw?.svg ?? raw?.content ?? "").trim();
			if (!/^<svg[\s>]/iu.test(svg) || svg.length > BOARD_LIMITS.svgBytes) return null;
			return {
				id,
				t,
				svg,
				caption: text(raw?.caption, 200),
				wide: raw?.wide === true
			};
		}
		case "chart": {
			const kind = CHART_KINDS.includes(raw?.kind) ? raw.kind : "line";
			const { series, data } = chartSeries(raw);
			if (!series.length && !data.length) return null;
			return {
				id,
				t,
				kind,
				title: text(raw?.title, 120),
				xLabel: text(raw?.xLabel ?? raw?.x?.label, 60),
				yLabel: text(raw?.yLabel ?? raw?.y?.label, 60),
				series,
				data
			};
		}
		case "table": {
			const head = (Array.isArray(raw?.head ?? raw?.columns) ? raw.head ?? raw.columns : []).slice(0, BOARD_LIMITS.tableCols).map((cell) => text(cell, 120));
			const rows = (Array.isArray(raw?.rows) ? raw.rows : []).slice(0, BOARD_LIMITS.tableRows).map((row) => (Array.isArray(row) ? row : []).slice(0, BOARD_LIMITS.tableCols).map((cell) => text(cell, 200))).filter((row) => row.length);
			return rows.length ? {
				id,
				t,
				head,
				rows
			} : null;
		}
		case "code": {
			const code = String(raw?.code ?? raw?.content ?? "").replace(/\r\n/gu, "\n").slice(0, BOARD_LIMITS.codeBytes);
			return code.trim() ? {
				id,
				t,
				lang: text(raw?.lang ?? raw?.language, 24).toLowerCase(),
				code,
				caption: text(raw?.caption, 200)
			} : null;
		}
		case "note": {
			const value = text(raw?.text ?? raw?.content, 800);
			return value ? {
				id,
				t,
				text: value,
				tone: NOTE_TONES.includes(raw?.tone) ? raw.tone : "key"
			} : null;
		}
		case "mark": {
			const ref = text(raw?.ref ?? raw?.target, 24);
			return ref ? {
				id,
				t,
				ref,
				style: MARK_STYLES.includes(raw?.style) ? raw.style : "underline"
			} : null;
		}
		case "anim": {
			const html = String(raw?.html ?? raw?.content ?? "").trim();
			if (!html || html.length > BOARD_LIMITS.animBytes) return null;
			const height = Math.round(Number(raw?.height));
			const poster = String(raw?.poster ?? "").trim();
			return {
				id,
				t,
				html,
				height: Number.isFinite(height) ? Math.min(520, Math.max(160, height)) : 300,
				caption: text(raw?.caption, 200),
				poster: /^<svg[\s>]/iu.test(poster) && poster.length <= BOARD_LIMITS.svgBytes ? poster : ""
			};
		}
		case "col": return {
			id,
			t
		};
		case "page": return {
			id,
			t,
			title: text(raw?.title, 160)
		};
		default: return null;
	}
}
function normalizeBoard(raw, { conceptIds = [] } = {}) {
	const sourceSteps = Array.isArray(raw) ? raw : Array.isArray(raw?.steps) ? raw.steps : [];
	const steps = [];
	let opCounter = 0;
	const idMap = /* @__PURE__ */ new Map();
	for (const rawStep of sourceSteps.slice(0, BOARD_LIMITS.steps)) {
		const say = text(rawStep?.say ?? rawStep?.narration ?? rawStep?.speech, BOARD_LIMITS.say);
		const ops = [];
		for (const rawOp of (Array.isArray(rawStep?.ops ?? rawStep?.board) ? rawStep.ops ?? rawStep.board : []).slice(0, BOARD_LIMITS.opsPerStep)) {
			const op = normalizeOp(rawOp, opCounter);
			if (!op) continue;
			const originalId = typeof rawOp?.id === "string" ? rawOp.id : null;
			op.id = `o${++opCounter}`;
			if (originalId) idMap.set(originalId, op.id);
			ops.push(op);
		}
		const check = rawStep?.check ? normalizeItem(rawStep.check, steps.length, conceptIds) : null;
		if (!say && !ops.length && !check) continue;
		steps.push({
			id: `s${steps.length + 1}`,
			say,
			ops,
			...check && check.kind !== "order" ? { check: {
				...check,
				id: `k${steps.length + 1}`
			} } : {}
		});
	}
	const known = new Set(steps.flatMap((step) => step.ops.map((op) => op.id)));
	for (const step of steps) step.ops = step.ops.filter((op) => {
		if (op.t !== "mark") return true;
		op.ref = idMap.get(op.ref) ?? op.ref;
		return known.has(op.ref);
	});
	if (!steps.length) throw new Error("lesson script has no steps");
	return {
		title: text(raw?.title, 160),
		steps
	};
}
function boardToPlainText(board, { maxChars = 8e3, uptoStep } = {}) {
	const lines = [];
	for (const [index, step] of board.steps.entries()) {
		if (uptoStep !== void 0 && index > uptoStep) break;
		if (step.say) lines.push(`[${step.id}] ${step.say}`);
		for (const op of step.ops) if (op.t === "math") lines.push(`  $${op.tex}$`);
		else if (op.t === "list") lines.push(...op.items.map((item) => `  • ${item}`));
		else if (op.t === "table") lines.push(`  | ${op.head.join(" | ")} |`, ...op.rows.map((row) => `  | ${row.join(" | ")} |`));
		else if (op.t === "code") lines.push(`  \`\`\`${op.lang}\n${op.code}\n  \`\`\``);
		else if (op.text) lines.push(`  ${op.text}`);
		else if (op.caption) lines.push(`  (${op.t}: ${op.caption})`);
	}
	const output = lines.join("\n");
	return output.length > maxChars ? `${output.slice(0, maxChars)}\n…` : output;
}
//#endregion
//#region src/core/mastery.js
const BKT_DEFAULTS = Object.freeze({
	pInit: .2,
	pTransit: .15,
	pSlip: .1,
	pGuess: .2
});
const MASTERY_LEVELS = Object.freeze([
	{
		id: "struggling",
		min: 0
	},
	{
		id: "learning",
		min: .4
	},
	{
		id: "proficient",
		min: .7
	},
	{
		id: "mastered",
		min: .9
	}
]);
const CONFIDENCE = /* @__PURE__ */ new Set([
	"sure",
	"unsure",
	"guess"
]);
const EVIDENCE_KINDS = /* @__PURE__ */ new Set([
	"check",
	"practice",
	"quiz",
	"project",
	"flashcard",
	"reexplain",
	"self"
]);
const HISTORY_LIMIT = 50;
const MISCONCEPTION_LIMIT = 10;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round4 = (value) => Math.round(value * 1e4) / 1e4;
function createConceptState(id, name = "", params = {}) {
	if (typeof id !== "string" || !id) throw new TypeError("concept id must be a non-empty string");
	const pInit = clamp(Number(params.pInit ?? BKT_DEFAULTS.pInit), .01, .99);
	return {
		id,
		name: String(name || id),
		pKnown: pInit,
		attempts: 0,
		correct: 0,
		streak: 0,
		fragile: 0,
		reexplains: 0,
		lastSeenAt: null,
		misconceptions: [],
		history: []
	};
}
function applyEvidence(state, evidence, now = Date.now()) {
	const kind = EVIDENCE_KINDS.has(evidence?.kind) ? evidence.kind : "practice";
	const next = {
		...state,
		misconceptions: [...state.misconceptions],
		history: [...state.history],
		lastSeenAt: new Date(now).toISOString()
	};
	if (kind === "reexplain") {
		next.reexplains += 1;
		next.pKnown = round4(clamp(next.pKnown * .9, .01, .99));
		pushHistory(next, {
			kind,
			at: next.lastSeenAt,
			pKnown: next.pKnown
		});
		return next;
	}
	if (kind === "self") {
		const rating = clamp(Math.round(Number(evidence.rating) || 3), 1, 5);
		const target = (rating - 1) / 4;
		next.pKnown = round4(clamp(next.pKnown * .8 + target * .2, .01, .99));
		pushHistory(next, {
			kind,
			rating,
			at: next.lastSeenAt,
			pKnown: next.pKnown
		});
		return next;
	}
	const score = clamp(Number(evidence.score), 0, 1);
	if (!Number.isFinite(score)) throw new TypeError("evidence.score must be a number between 0 and 1");
	const confidence = CONFIDENCE.has(evidence.confidence) ? evidence.confidence : null;
	const { pSlip, pGuess } = adjustedParams(evidence, confidence);
	const prior = next.pKnown;
	const pCorrect = prior * (1 - pSlip) + (1 - prior) * pGuess;
	const posteriorIfCorrect = prior * (1 - pSlip) / pCorrect;
	const posteriorIfWrong = prior * pSlip / (1 - pCorrect);
	const posterior = score * posteriorIfCorrect + (1 - score) * posteriorIfWrong;
	const pTransit = kind === "quiz" ? BKT_DEFAULTS.pTransit / 2 : BKT_DEFAULTS.pTransit;
	next.pKnown = round4(clamp(posterior + (1 - posterior) * pTransit, .01, .99));
	next.attempts += 1;
	if (score >= .6) {
		next.correct += 1;
		next.streak += 1;
		if (confidence === "unsure" || confidence === "guess") next.fragile += 1;
	} else {
		next.streak = 0;
		if (confidence === "sure") {
			const tag = String(evidence.errorTag || "confident-error").slice(0, 80);
			next.misconceptions = [tag, ...next.misconceptions.filter((item) => item !== tag)].slice(0, MISCONCEPTION_LIMIT);
		}
	}
	pushHistory(next, {
		kind,
		score: round4(score),
		confidence,
		at: next.lastSeenAt,
		pKnown: next.pKnown
	});
	return next;
}
function adjustedParams(evidence, confidence) {
	let pSlip = BKT_DEFAULTS.pSlip;
	let pGuess = BKT_DEFAULTS.pGuess;
	if (confidence === "guess") pGuess = .5;
	else if (confidence === "unsure") pGuess = .32;
	else if (confidence === "sure") pSlip = .05;
	const hints = clamp(Math.floor(Number(evidence.hintsUsed) || 0), 0, 5);
	pGuess += hints * .08;
	const timeMs = Number(evidence.timeMs);
	const expectedMs = Number(evidence.expectedMs);
	if (timeMs > 0 && expectedMs > 0 && timeMs > expectedMs * 2) pGuess += .08;
	return {
		pSlip: clamp(pSlip, .01, .4),
		pGuess: clamp(pGuess, .05, .65)
	};
}
function pushHistory(state, entry) {
	state.history.push(entry);
	if (state.history.length > HISTORY_LIMIT) state.history.splice(0, state.history.length - HISTORY_LIMIT);
}
function masteryPercent(state) {
	return Math.round(clamp(Number(state?.pKnown) || 0, 0, 1) * 100);
}
function masteryLevel(state) {
	const p = clamp(Number(state?.pKnown) || 0, 0, 1);
	let level = MASTERY_LEVELS[0].id;
	for (const item of MASTERY_LEVELS) if (p >= item.min) level = item.id;
	return level;
}
function recommendNext(states, { passThreshold = .7 } = {}) {
	const list = (states || []).filter(Boolean);
	if (!list.length) return {
		action: "advance",
		conceptIds: [],
		reason: "no-evidence"
	};
	const misconceived = list.filter((state) => state.misconceptions.length && state.pKnown < .9);
	if (misconceived.length) return {
		action: "remediate",
		conceptIds: misconceived.map((state) => state.id),
		reason: "misconception"
	};
	const weak = list.filter((state) => state.attempts > 0 && state.pKnown < .4);
	if (weak.length) return {
		action: "remediate",
		conceptIds: weak.map((state) => state.id),
		reason: "low-mastery"
	};
	const shaky = list.filter((state) => state.pKnown < passThreshold || state.fragile > state.correct / 2);
	if (shaky.length) return {
		action: "review",
		conceptIds: shaky.map((state) => state.id),
		reason: "fragile"
	};
	if (list.every((state) => state.pKnown >= .9 && state.reexplains === 0)) return {
		action: "challenge",
		conceptIds: list.map((state) => state.id),
		reason: "mastered"
	};
	return {
		action: "advance",
		conceptIds: [],
		reason: "on-track"
	};
}
function summarizeForPrompt(states, limit = 12) {
	return (states || []).filter(Boolean).sort((a, b) => a.pKnown - b.pKnown).slice(0, limit).map((state) => ({
		concept: state.name,
		mastery: masteryPercent(state),
		level: masteryLevel(state),
		misconceptions: state.misconceptions.slice(0, 3),
		fragile: state.fragile > 0
	}));
}
//#endregion
//#region src/core/retrieval.js
const CJK_RUN = /[぀-ヿ㐀-䶿一-鿿가-힯]+/gu;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'_-]*/gu;
const STOP = /* @__PURE__ */ new Set([
	"the",
	"a",
	"an",
	"and",
	"or",
	"of",
	"to",
	"in",
	"on",
	"for",
	"is",
	"are",
	"was",
	"be",
	"with",
	"as",
	"by",
	"at",
	"it",
	"this",
	"that",
	"from"
]);
function tokenize(value) {
	const textValue = String(value ?? "").toLowerCase();
	const tokens = [];
	for (const run of textValue.match(CJK_RUN) ?? []) {
		if (run.length === 1) tokens.push(run);
		for (let index = 0; index < run.length - 1; index += 1) tokens.push(run.slice(index, index + 2));
	}
	for (const word of textValue.replace(CJK_RUN, " ").match(WORD) ?? []) if (word.length > 1 && !STOP.has(word)) tokens.push(word);
	return tokens;
}
function buildIndex(chunks) {
	const docs = chunks.map((chunk) => {
		const counts = /* @__PURE__ */ new Map();
		const tokens = tokenize(chunk.text);
		for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
		return {
			chunk,
			counts,
			length: tokens.length
		};
	});
	const df = /* @__PURE__ */ new Map();
	for (const doc of docs) for (const token of doc.counts.keys()) df.set(token, (df.get(token) ?? 0) + 1);
	return {
		docs,
		df,
		avg: docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(1, docs.length)
	};
}
function search(index, query, { limit = 6, k1 = 1.4, b = .75 } = {}) {
	const terms = [...new Set(tokenize(query))];
	if (!terms.length || !index.docs.length) return [];
	const total = index.docs.length;
	return index.docs.map((doc) => {
		let score = 0;
		for (const term of terms) {
			const tf = doc.counts.get(term);
			if (!tf) continue;
			const df = index.df.get(term) ?? 0;
			const idf = Math.log(1 + (total - df + .5) / (df + .5));
			score += idf * (tf * (k1 + 1) / (tf + k1 * (1 - b + b * (doc.length / (index.avg || 1)))));
		}
		return {
			chunk: doc.chunk,
			score
		};
	}).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
function selectPassages(chunks, query, { maxChars = 12e3, limit = 12 } = {}) {
	if (!chunks?.length) return [];
	const picked = query ? search(buildIndex(chunks), query, { limit }).map((entry) => entry.chunk) : chunks.slice(0, limit);
	const result = [];
	let used = 0;
	for (const chunk of picked) {
		if (used + chunk.text.length > maxChars) {
			const room = maxChars - used;
			if (room > 400) result.push({
				...chunk,
				text: `${chunk.text.slice(0, room)}…`
			});
			break;
		}
		result.push(chunk);
		used += chunk.text.length;
	}
	return result;
}
function spreadPassages(chunks, { maxChars = 12e3, samples = 16 } = {}) {
	if (!chunks?.length) return [];
	if (chunks.reduce((sum, chunk) => sum + chunk.text.length, 0) <= maxChars) return chunks.slice();
	const count = Math.min(chunks.length, Math.max(2, samples));
	const share = Math.max(200, Math.floor(maxChars / count));
	const picked = [];
	for (let index = 0; index < count; index += 1) {
		const at = Math.round(index * (chunks.length - 1) / (count - 1));
		if (picked.at(-1) !== at) picked.push(at);
	}
	return picked.map((at) => {
		const chunk = chunks[at];
		return chunk.text.length > share ? {
			...chunk,
			text: `${chunk.text.slice(0, share)}…`
		} : chunk;
	});
}
function documentParts(chunks, { partChars = 2e4, maxParts = 24, maxPartChars = 4e4 } = {}) {
	if (!chunks?.length) return [];
	const total = Math.max(1, chunks.reduce((sum, chunk) => sum + chunk.text.length, 0));
	const count = Math.min(maxParts, Math.max(1, Math.ceil(total / partChars)));
	const parts = Array.from({ length: count }, () => []);
	let seen = 0;
	for (const chunk of chunks) {
		parts[Math.min(count - 1, Math.floor(seen / total * count))].push(chunk);
		seen += chunk.text.length;
	}
	return parts.filter((part) => part.length).map((part) => {
		return part.reduce((sum, chunk) => sum + chunk.text.length, 0) > maxPartChars ? spreadPassages(part, {
			maxChars: maxPartChars,
			samples: 24
		}) : part;
	});
}
function locationOf(passage) {
	return passage?.page ? `p.${passage.page}` : passage?.slide ? `slide ${passage.slide}` : passage?.section ?? "";
}
function passageRange(passages) {
	const first = locationOf(passages?.[0]);
	const last = locationOf(passages?.at(-1));
	return first && last && first !== last ? `${first}–${last}` : first || last;
}
function formatPassages(passages, sourceTitle) {
	return passages.map((passage) => {
		const where = locationOf(passage);
		return `<<${[sourceTitle ?? passage.source ?? "source", where].filter(Boolean).join(" · ") || "excerpt"}>>\n${passage.text}`;
	}).join("\n\n");
}
//#endregion
//#region src/host/context.js
const EMPTY_PROFILE = Object.freeze({
	background: "",
	goals: [],
	strengths: [],
	weaknesses: [],
	preferences: {},
	notes: [],
	updatedAt: null
});
async function readProfile(store) {
	return {
		...EMPTY_PROFILE,
		...await store.readJson(store.paths.profile(), null) ?? {}
	};
}
function emptyProgress(courseId) {
	return {
		courseId,
		lessons: {},
		concepts: {},
		reviews: {},
		practice: {},
		projects: {},
		events: [],
		lastLessonId: null
	};
}
async function readProgress(store, courseId) {
	return {
		...emptyProgress(courseId),
		...await store.readJson(store.paths.progress(courseId), null) ?? {}
	};
}
function masteryFor(course, progress, lessonId) {
	const row = findLesson(course, lessonId);
	if (!row) return [];
	const index = conceptIndex(course);
	const ids = new Set(row.lesson.concepts.map((concept) => concept.id));
	const all = [...index.values()];
	const position = all.findIndex((concept) => concept.lessonId === lessonId);
	for (const concept of all.slice(Math.max(0, position - 6), position)) ids.add(concept.id);
	return summarizeForPrompt([...ids].map((id) => progress.concepts?.[id]).filter(Boolean));
}
async function readMaterials(store, materialIds = []) {
	const items = [];
	for (const id of materialIds.slice(0, 8)) try {
		const meta = await store.readJson(store.paths.material(id), null);
		if (!meta) continue;
		const chunks = meta.kind === "image" ? [] : await store.readJson(store.paths.materialChunks(id), []) ?? [];
		items.push({
			meta,
			chunks
		});
	} catch {}
	return items;
}
function materialsSummary(materials) {
	return materials.map(({ meta }) => {
		const size = meta.pages ? `${meta.pages} pages` : meta.slides ? `${meta.slides} slides` : meta.kind;
		const lines = [`- ${meta.title} (${size})`];
		if (meta.brief?.summary) lines.push(`  ${meta.brief.summary}`);
		if (meta.brief?.topics?.length) lines.push(`  Topics: ${meta.brief.topics.slice(0, 24).join("; ")}`);
		return lines.join("\n");
	}).join("\n");
}
function passagesFor(materials, query, maxChars = 9e3) {
	const blocks = [];
	let budget = maxChars;
	for (const { meta, chunks } of materials) {
		if (!chunks.length || budget < 600) continue;
		const share = Math.max(1200, Math.floor(budget / Math.max(1, materials.length)));
		const picked = selectPassages(chunks.map((chunk) => ({
			...chunk,
			source: meta.title
		})), query, { maxChars: share });
		if (!picked.length) continue;
		const block = formatPassages(picked, meta.title);
		blocks.push(block);
		budget -= block.length;
	}
	return blocks.join("\n\n");
}
async function materialImages(store, materials) {
	const images = [];
	for (const { meta } of materials) {
		if (meta.kind !== "image" || images.length >= 4) continue;
		const blob = await store.readBlob(store.paths.materialBlob(meta.id));
		if (blob) images.push({
			mime: meta.mime ?? "image/png",
			base64: blob.toString("base64")
		});
	}
	return images;
}
//#endregion
//#region src/core/json-extract.js
var JsonExtractError = class extends Error {
	constructor(message, { cause, text } = {}) {
		super(message, cause ? { cause } : void 0);
		this.name = "JsonExtractError";
		this.preview = typeof text === "string" ? text.slice(0, 200) : void 0;
	}
};
const FENCE = /```(?:json|jsonl|javascript|js)?\s*\n?([\s\S]*?)```/giu;
function stripTrailingCommas(text) {
	let out = "";
	let inString = false;
	let escaped = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (inString) {
			out += char;
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === "\"") inString = false;
			continue;
		}
		if (char === "\"") {
			inString = true;
			out += char;
			continue;
		}
		if (char === ",") {
			let next = index + 1;
			while (next < text.length && /\s/u.test(text[next])) next += 1;
			if (text[next] === "}" || text[next] === "]") continue;
		}
		out += char;
	}
	return out;
}
function balancedSlice(text, from = 0) {
	const start = text.slice(from).search(/[{[]/u);
	if (start < 0) return void 0;
	const begin = from + start;
	const stack = [];
	let inString = false;
	let escaped = false;
	for (let index = begin; index < text.length; index += 1) {
		const char = text[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === "\"") inString = false;
			continue;
		}
		if (char === "\"") inString = true;
		else if (char === "{" || char === "[") stack.push(char);
		else if (char === "}" || char === "]") {
			const open = stack.pop();
			if (char === "}" && open !== "{" || char === "]" && open !== "[") return void 0;
			if (stack.length === 0) return {
				begin,
				end: index + 1,
				text: text.slice(begin, index + 1)
			};
		}
	}
	return {
		begin,
		end: text.length,
		text: text.slice(begin),
		truncated: true,
		stack
	};
}
function repairTruncated(text) {
	let body = text;
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const closed = closeOpen(body);
		if (closed !== void 0) try {
			return JSON.parse(stripTrailingCommas(closed));
		} catch {}
		const cut = Math.max(body.lastIndexOf(","), body.lastIndexOf("{"), body.lastIndexOf("["));
		if (cut <= 0) break;
		body = body.slice(0, body[cut] === "," ? cut : cut + 1);
	}
	throw new JsonExtractError("model output was truncated beyond repair", { text });
}
function closeOpen(text) {
	const stack = [];
	let inString = false;
	let escaped = false;
	for (const char of text) {
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === "\"") inString = false;
			continue;
		}
		if (char === "\"") inString = true;
		else if (char === "{" || char === "[") stack.push(char);
		else if (char === "}" || char === "]") stack.pop();
	}
	if (inString) return void 0;
	return text + stack.reverse().map((open) => open === "{" ? "}" : "]").join("");
}
function extractJson(raw, { allowTruncated = true } = {}) {
	if (raw !== null && typeof raw === "object") return raw;
	const text = String(raw ?? "").replace(/^﻿/u, "").trim();
	if (!text) throw new JsonExtractError("model returned an empty response", { text });
	const candidates = [];
	for (const match of text.matchAll(FENCE)) candidates.push(match[1].trim());
	candidates.push(text);
	let lastError;
	for (const candidate of candidates) {
		try {
			return JSON.parse(candidate);
		} catch (error) {
			lastError = error;
		}
		const slice = balancedSlice(candidate);
		if (slice === void 0) continue;
		if (!slice.truncated) try {
			return JSON.parse(stripTrailingCommas(slice.text));
		} catch (error) {
			lastError = error;
		}
		else if (allowTruncated) try {
			return repairTruncated(slice.text);
		} catch (error) {
			lastError = error;
		}
	}
	throw new JsonExtractError("model output did not contain valid JSON", {
		cause: lastError,
		text
	});
}
function parseJsonLines(raw, { final = true } = {}) {
	const lines = String(raw ?? "").replace(/```(?:jsonl|json)?/giu, "").split(/\r?\n/u);
	const rest = final ? "" : lines.pop() ?? "";
	const items = [];
	const errors = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || !/^[{[]/u.test(trimmed)) continue;
		try {
			items.push(JSON.parse(stripTrailingCommas(trimmed)));
		} catch (error) {
			errors.push({
				line: trimmed.slice(0, 120),
				message: error.message
			});
		}
	}
	return {
		items,
		errors,
		rest
	};
}
//#endregion
//#region src/host/generate.js
var TutorError = class extends Error {
	constructor(code, message) {
		super(message);
		this.name = "TutorError";
		this.code = code;
	}
};
const REPAIR = "Your previous reply could not be parsed as JSON. Reply again with the complete answer as valid JSON only — no code fences, no commentary.";
async function generateJson(llm, { purpose = "teach", prompt, maxTokens = 8e3, images, signal, normalize = (value) => value, onText }) {
	const request = {
		purpose,
		system: prompt.system,
		user: prompt.user,
		images,
		maxTokens,
		signal
	};
	const first = onText ? await llm.stream({
		...request,
		onText
	}) : await llm.complete(request);
	try {
		return normalize(extractJson(first));
	} catch (error) {
		if (signal?.aborted) throw signal.reason ?? error;
		const retryUser = `${prompt.user}\n\n<previous_reply>\n${String(first).slice(0, 12e3)}\n</previous_reply>\n\n${REPAIR}${error instanceof JsonExtractError ? "" : `\nProblem: ${error.message}`}`;
		const second = await llm.complete({
			purpose,
			system: prompt.system,
			user: retryUser,
			images,
			maxTokens,
			signal
		});
		try {
			return normalize(extractJson(second));
		} catch {
			throw new TutorError("bad-output", "The model did not return a usable answer. Try again or pick a stronger model in settings.");
		}
	}
}
async function generateSteps(llm, { purpose = "teach", prompt, maxTokens = 12e3, signal, conceptIds = [], onStep, minSteps = 1, images }) {
	const raw = [];
	let buffer = "";
	let emitted = 0;
	const emit = () => {
		if (!raw.length) return;
		let board;
		try {
			board = normalizeBoard(raw, { conceptIds });
		} catch {
			return;
		}
		while (emitted < board.steps.length) {
			onStep?.(board.steps[emitted], emitted);
			emitted += 1;
		}
	};
	const take = (final) => {
		const { items, rest } = parseJsonLines(buffer, { final });
		buffer = rest;
		for (const item of items) if (Array.isArray(item)) raw.push(...item);
		else if (Array.isArray(item?.steps)) raw.push(...item.steps);
		else raw.push(item);
		if (items.length) emit();
	};
	const full = await llm.stream({
		purpose,
		system: prompt.system,
		user: prompt.user,
		images,
		maxTokens,
		signal,
		onText: (delta) => {
			buffer += delta;
			if (buffer.includes("\n")) take(false);
		}
	});
	take(true);
	if (!raw.length) try {
		const parsed = extractJson(full);
		raw.push(...Array.isArray(parsed) ? parsed : parsed?.steps ?? []);
		emit();
	} catch {}
	let board;
	try {
		board = normalizeBoard(raw, { conceptIds });
	} catch {
		throw new TutorError("bad-output", "The model did not return a usable lesson. Try again or pick a stronger model in settings.");
	}
	if (board.steps.length < minSteps) throw new TutorError("bad-output", "The lesson came back too short. Try again.");
	while (emitted < board.steps.length) {
		onStep?.(board.steps[emitted], emitted);
		emitted += 1;
	}
	return board;
}
function streamCounter(marker, onCount) {
	let tail = "";
	let count = 0;
	return (delta) => {
		const textValue = tail + String(delta ?? "");
		let found = 0;
		for (let at = textValue.indexOf(marker); at !== -1; at = textValue.indexOf(marker, at + marker.length)) found += 1;
		tail = textValue.slice(-(marker.length - 1));
		if (found) {
			count += found;
			onCount(count);
		}
	};
}
async function generateText(llm, { purpose = "teach", prompt, maxTokens = 6e3, signal, onText }) {
	const textValue = onText ? await llm.stream({
		purpose,
		system: prompt.system,
		user: prompt.user,
		maxTokens,
		signal,
		onText
	}) : await llm.complete({
		purpose,
		system: prompt.system,
		user: prompt.user,
		maxTokens,
		signal
	});
	const cleaned = String(textValue ?? "").replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/u, "$1").trim();
	if (!cleaned) throw new TutorError("bad-output", "The model returned an empty answer. Try again.");
	return cleaned;
}
//#endregion
//#region src/host/prompts.js
const LANGUAGE_NAMES = Object.freeze({
	"zh-CN": "Simplified Chinese (简体中文)",
	"zh-TW": "Traditional Chinese (繁體中文)",
	en: "English",
	ja: "Japanese (日本語)",
	ko: "Korean (한국어)",
	fr: "French",
	de: "German",
	es: "Spanish"
});
function languageName(code) {
	if (LANGUAGE_NAMES[code]) return LANGUAGE_NAMES[code];
	const base = String(code ?? "").split("-")[0];
	return LANGUAGE_NAMES[base] ?? (code ? String(code) : "the learner's language");
}
function detectLanguage(textValue, fallback = "zh-CN") {
	const value = String(textValue ?? "");
	if (/[\u3040-\u30ff]/u.test(value)) return "ja";
	if (/[\uac00-\ud7af]/u.test(value)) return "ko";
	if (/[\u4e00-\u9fff]/u.test(value)) return "zh-CN";
	if (/[a-z]{3,}/iu.test(value)) return "en";
	return fallback;
}
const PERSONA = `You are Aha, a brilliant and warm private tutor who teaches one learner at a time. You explain like the best teacher the learner ever had: you start from intuition or a concrete puzzle, build ideas step by step, check understanding often, and adapt to the learner instead of reciting a textbook. You never invent facts; when unsure you say so.`;
const JSON_ONLY = "Reply with JSON only: no code fences, no comments, no text before or after.";
const JSONL_ONLY = "Reply with JSON Lines only: one compact JSON object per line, nothing else — no code fences, no numbering, no blank commentary lines. Escape newlines inside strings as \\n.";
function languageRule(language) {
	return `Write every learner-facing string (narration, board text, questions, options, explanations) in ${languageName(language)}. Keep standard notation — math, code, units, proper names — as is.`;
}
function block(label, content) {
	const value = typeof content === "string" ? content.trim() : content ? JSON.stringify(content, null, 1) : "";
	return value ? `<${label}>\n${value}\n</${label}>` : "";
}
function join(...parts) {
	return parts.filter(Boolean).join("\n\n");
}
function learnerBlock({ profile, mastery } = {}) {
	const lines = [];
	if (profile?.background) lines.push(`Background: ${profile.background}`);
	if (profile?.goals?.length) lines.push(`Goals: ${profile.goals.join("; ")}`);
	if (profile?.preferences?.style) lines.push(`Prefers explanations that are: ${profile.preferences.style}`);
	if (profile?.strengths?.length) lines.push(`Strengths: ${profile.strengths.join("; ")}`);
	if (profile?.weaknesses?.length) lines.push(`Known weak spots: ${profile.weaknesses.join("; ")}`);
	for (const note of (profile?.notes ?? []).slice(-6)) lines.push(`Note: ${note.text}`);
	if (mastery?.length) {
		lines.push("Mastery of related concepts (0–100):");
		for (const row of mastery) lines.push(`- ${row.concept}: ${row.mastery}${row.misconceptions?.length ? ` (misconceptions: ${row.misconceptions.join("; ")})` : ""}${row.fragile ? " (fragile)" : ""}`);
	}
	return lines.length ? block("learner", lines.join("\n")) : "";
}
const BOARD_SPEC = `THE WHITEBOARD
The board has two columns and is written by hand while you speak. Put on it only what deserves to stay visible: headings, key phrases, formulas, diagrams, worked steps. Say the rest aloud.

Board operations (each is a JSON object with field "t"; give an op an "id" only if you will refer to it later):
- {"t":"title","text":"…"}  page title, once per page
- {"t":"h","text":"…"}  short section heading
- {"t":"p","text":"…"}  one to three short lines; inline math $…$, **bold**, ==highlight==
- {"t":"math","tex":"…","text":"…"}  one display formula in KaTeX-compatible LaTeX; "text" is a plain-Unicode reading of it (e.g. "θ(t) = θ₀·cos(ωt + φ)")
- {"t":"list","items":["…","…"],"ordered":false}
- {"t":"svg","svg":"<svg viewBox=\\"0 0 480 300\\" xmlns=\\"http://www.w3.org/2000/svg\\">…</svg>","caption":"…"}  a clean hand-drawn-style diagram: viewBox at most 640×420, strokes and simple shapes, <text> labels (font-size 14–18), colors only from ink #2b2b2b, blue #2f6fde, red #d64545, green #2f9e6e, orange #e08a1e, purple #7a4fd6; no scripts, no images, no foreignObject, no external links
- {"t":"chart","kind":"line|bar|scatter|pie|area","title":"…","xLabel":"…","yLabel":"…","series":[{"name":"…","points":[[x,y],…]}]}  or "data":[{"label":"…","value":n}] for bar/pie; use real, computed numbers
- {"t":"table","head":["…"],"rows":[["…","…"]]}
- {"t":"code","lang":"python","code":"…"}
- {"t":"note","tone":"key|tip|warn|example","text":"…"}  boxed takeaway or warning
- {"t":"mark","ref":"<id of an earlier op>","style":"underline|circle|box"}  point back at something already written
- {"t":"anim","html":"<!doctype html>…","height":300,"caption":"…","poster":"<svg …>…</svg>"}  only when motion is the point (orbits, waves, sorting); a self-contained page under 8 KB using canvas or SVG and plain JavaScript, no network access, starts automatically and loops; "poster" is one representative still frame as an SVG with the same rules as svg ops, shown where the animation cannot play (exported videos)
- {"t":"col"}  continue in the right column;  {"t":"page","title":"…"}  wipe the board and start a new page

Fill the left column, then {"t":"col"}, then the right column; start a new page when both are full (roughly 8–12 ops per page).`;
const STEP_SPEC = `Each output line is ONE teaching step:
{"say":"what you say while writing — natural spoken sentences, 1–4 sentences, no markdown","ops":[ …board ops written during this step… ],"check":{ …optional quick question… }}

A check is a short question asked right after the step, to see whether the idea landed:
{"kind":"choice|multi|blank|number|short","prompt":"…","options":["…","…"],"answer":<option index (0-based) for choice, list of indexes for multi, accepted strings for blank, a number for number, a model answer for short>,"tolerance":<number, for number>,"explanation":"why the answer is right, in one or two sentences","conceptIds":["<ids from the concept list>"]}
Make wrong options plausible (common mistakes), never trick questions.`;
function questionnairePrompt({ goal, language, materialsSummary, profile }) {
	return {
		system: join(PERSONA, `Before designing a course you ask a few sharp questions, the way a good tutor does in a first meeting. ${languageRule(language)}`, JSON_ONLY),
		user: join(block("learning_goal", goal), block("materials", materialsSummary), learnerBlock({ profile }), `Write 3 to 5 multiple-choice questions whose answers would most change how you design this particular course. Typical topics: why they want to learn it (exam, job, project, curiosity), what they already know, how much time they have and by when, how they like to learn, and which applied project or focus area they care about. Skip anything already clear from the goal, the materials or the learner notes. Make every option concrete and specific to this subject (not generic), with a short detail line. 3–5 options each; set "multi": true only when several answers can apply.

Return {"questions":[{"prompt":"…","topic":"purpose|level|timeline|style|focus|other","multi":false,"options":[{"label":"…","detail":"…"}]}]}`)
	};
}
function sizeGuidance(timeline) {
	return `Size the course to the goal first. When the goal is a single idea or names a time budget ("in 20 minutes", "one evening", "this weekend"), fit it: one unit with a single lecture of 1–4 lessons can be the whole course. Never pad with filler lessons. ${timeline === "intensive" ? "Intensive pace: for a broad subject, up to 4–6 units and 18–30 lessons, focused on what matters most for the goal." : timeline === "relaxed" ? "No fixed deadline: for a broad subject, up to 6–10 units and 35–70 lessons, with room for depth, connections and enrichment." : "Balanced pace: for a broad subject, up to 5–8 units and 26–45 lessons, covering foundations, practice and an applied project."}`;
}
function blueprintPrompt({ goal, language, intake, materialsSummary, profile, timeline, weeklyMinutes }) {
	return {
		system: join(PERSONA, `You design personal courses with the care of an experienced curriculum designer: clear prerequisites first, one new idea per lesson, frequent practice, and applied projects that make the knowledge usable. ${languageRule(language)}`, JSON_ONLY),
		user: join(block("learning_goal", goal), block("intake_answers", intake), block("materials", materialsSummary), learnerBlock({ profile }), `Design the course blueprint.
- ${sizeGuidance(timeline)}${weeklyMinutes ? ` The learner can study about ${weeklyMinutes} minutes per week.` : ""}
- Structure: units → lectures (1–5 per unit) → lessons (1–5 per lecture). Each lesson takes 10–25 minutes and teaches one coherent idea.
- Order lessons so every prerequisite comes first. Start from where the learner is, not from zero if they already know the basics.
- If materials were provided, follow their scope and order where sensible.
- Each lesson lists 1–3 learning objectives (observable: "compute…", "explain why…") and 1–4 key concepts (short names).
- Add 1–3 projects (one is enough for a short course) that apply the course to something real for this learner, placed after the units they depend on. Use "kind":"code" only when the project is mainly programming or data work.
- Pick one emoji that fits the subject.

Return {"title":"…","subtitle":"one line promise of the course","emoji":"…","summary":"2–3 sentences: who it is for, what they will be able to do","level":"beginner|intermediate|advanced","units":[{"title":"…","summary":"…","objectives":["…"],"lectures":[{"title":"…","summary":"…","lessons":[{"title":"…","summary":"…","objectives":["…"],"concepts":["…"],"estMinutes":15}]}]}],"projects":[{"title":"…","kind":"code|writing|analysis|design|practice|other","brief":"…","skills":["…"],"unitIndex":<0-based unit after which it fits>,"milestones":["…"],"rubric":[{"criterion":"…","points":10}]}]}`)
	};
}
function revisePrompt({ blueprint, instruction, language }) {
	return {
		system: join(PERSONA, `You revise course blueprints precisely as asked, keeping everything else intact. ${languageRule(language)}`, JSON_ONLY),
		user: join(block("current_blueprint", blueprint), block("change_request", instruction), "Apply the change request and return the complete revised blueprint in the same JSON shape. Keep the \"id\" field of every unit, lecture, lesson and concept you do not substantially change; new items get no id.")
	};
}
function practicePrompt({ course, lecture, lessons, language, passages }) {
	const lessonLines = lessons.map((lesson) => `- [${lesson.id}] ${lesson.title}: ${lesson.objectives.join("; ")} | concepts: ${lesson.concepts.map((concept) => `${concept.id}=${concept.name}`).join(", ")}`).join("\n");
	return {
		system: join(PERSONA, `You write practice that builds real understanding: retrieval, application, and common-mistake traps, from easy to harder. ${languageRule(language)}`, JSON_ONLY),
		user: join(block("course", `${course.title} — ${course.summary ?? ""}`), block("lecture", lecture.title), block("lessons", lessonLines), block("source_passages", passages), `For EACH lesson write 4–6 practice items. Mix kinds: "choice" (4 options), "multi", "blank" (short exact answer; list accepted spellings), "number" (with tolerance), "short" (a sentence or two, with a model answer and 2–3 rubric points). At least one item per lesson asks the learner to apply the idea to a new situation. Give each item 1–2 hints that nudge without giving the answer, an explanation, a difficulty 1–3, and the conceptIds it tests (use the ids given).

Return {"lessons":{"<lesson id>":{"items":[{"kind":"choice","prompt":"…","options":["…"],"answer":0,"hints":["…"],"explanation":"…","difficulty":1,"conceptIds":["…"]}]}}}`)
	};
}
function projectsPrompt({ course, projects, language }) {
	return {
		system: join(PERSONA, `You turn project ideas into briefs a learner can actually start today. ${languageRule(language)}`, JSON_ONLY),
		user: join(block("course", `${course.title} — ${course.summary ?? ""}`), block("outline", course.outline), block("projects", projects.map((project) => ({
			id: project.id,
			title: project.title,
			kind: project.kind,
			brief: project.brief
		}))), `Expand every project: a motivating brief (the scenario, the deliverable, what "done" looks like), 3–6 milestones with details, a rubric (4–6 criteria with points summing to 100 and what earns full marks), and the skills it exercises. For "code" projects also include starter files: a README.md with instructions, a main script with TODOs (not the solution), and a small realistic sample dataset when data is involved (CSV under 200 rows). Use relative paths only.

Return {"projects":[{"id":"<same id>","title":"…","kind":"…","brief":"…","skills":["…"],"milestones":[{"title":"…","detail":"…"}],"rubric":[{"criterion":"…","points":20,"detail":"…"}],"starterFiles":[{"path":"README.md","content":"…"}]}]}`)
	};
}
const DIRECTIVES = Object.freeze({
	remediate: "This is a REMEDIAL lesson: the learner struggled with these concepts. Re-teach them from a different angle than before (new analogy, picture, or worked example), name and dismantle the specific misconceptions listed, and check understanding more often (a check every 2 steps).",
	challenge: "The learner has mastered the prerequisites easily: move briskly through basics, add depth (why it works, edge cases, connections) and make the checks harder.",
	review: "This is a REVIEW lesson: retrieve before re-explaining. Open with a question, then consolidate the key ideas with a compact board and mixed checks."
});
function lessonPrompt({ course, unit, lecture, lesson, language, learner, passages, previous, directive, style }) {
	const steps = Math.min(18, Math.max(7, Math.round((lesson.estMinutes || 15) * .7)));
	return {
		system: join(PERSONA, BOARD_SPEC, STEP_SPEC, languageRule(language), JSONL_ONLY),
		user: join(block("course", `${course.title} (${course.level || "mixed level"}) — ${course.summary ?? ""}`), block("position", `Unit: ${unit.title}\nLecture: ${lecture.title}\nLesson: ${lesson.title}\nObjectives: ${lesson.objectives.join("; ")}\nConcepts (id=name): ${lesson.concepts.map((concept) => `${concept.id}=${concept.name}`).join(", ")}`), block("previous_lesson", previous), learnerBlock(learner), block("source_passages", passages), style ? block("style_request", style) : "", DIRECTIVES[directive] ?? "", `Teach this lesson in about ${steps} steps (~${lesson.estMinutes || 15} minutes).
- Open with a hook: a question, a surprising fact, or a concrete situation the idea explains. Connect to the previous lesson when there is one.
- Build intuition before formalism; then make it precise; then work at least one example fully on the board.
- Draw a diagram or chart whenever a picture makes the idea click.
- Put 2–4 checks after the key ideas, plus one at the end; every check must name its conceptIds.
- If source passages are given, stay consistent with them and mention the page when you lean on one.
- Close with a recap step: a "key" note with the 2–3 takeaways, and say what comes next.
Start with a step whose ops begin with {"t":"title","text":"${lesson.title.replace(/"/gu, "\\\"")}"}.`)
	};
}
function askPrompt({ course, lesson, language, boardSoFar, question, learner }) {
	return {
		system: join(PERSONA, BOARD_SPEC, STEP_SPEC, languageRule(language), JSONL_ONLY),
		user: join(block("course", course ? `${course.title}` : ""), block("lesson", lesson ? `${lesson.title}: ${lesson.objectives?.join("; ") ?? ""}` : ""), block("board_so_far", boardSoFar), learnerBlock(learner), block("learner_question", question), `The learner raised a hand with this question in the middle of the lesson. Answer it at the board in 1–4 steps: start with {"t":"page","title":"…"} only if the answer needs a fresh board, otherwise keep writing. Be direct, use a small example or picture if it helps, and connect back to where the lesson was. If the question reveals a misunderstanding, address it kindly and end with one quick check. Do not continue the lesson itself.`)
	};
}
const REEXPLAIN_STYLES = Object.freeze({
	analogy: "with an everyday analogy that maps closely onto the idea",
	visual: "mainly with a diagram or chart, explaining what each part of the picture means",
	example: "through a concrete worked example with real numbers, step by step",
	simpler: "more simply, with shorter sentences, no jargon, and smaller steps",
	deeper: "more rigorously, showing why it is true and where it breaks down"
});
function reexplainPrompt({ lesson, language, step, boardSoFar, style }) {
	return {
		system: join(PERSONA, BOARD_SPEC, STEP_SPEC, languageRule(language), JSONL_ONLY),
		user: join(block("lesson", lesson ? lesson.title : ""), block("board_so_far", boardSoFar), block("step_to_reexplain", step), `The learner did not get this step. Explain the same idea again ${REEXPLAIN_STYLES[style] ?? REEXPLAIN_STYLES.example}, in 2–4 steps, starting with {"t":"page","title":"…"}. End with one quick check.`)
	};
}
function gradePrompt({ item, response, language }) {
	return {
		system: join(PERSONA, `You grade open answers fairly: credit correct ideas expressed in the learner's own words, ignore spelling and phrasing, and pinpoint the exact gap. ${languageRule(language)}`, JSON_ONLY),
		user: join(block("question", item.prompt), block("model_answer", item.answer), block("rubric", (item.rubric ?? []).join("\n")), block("learner_answer", response), "Return {\"score\":<0 to 1>,\"verdict\":\"correct|partial|incorrect\",\"feedback\":\"2–3 encouraging sentences: what is right, what is missing, how to fix it\",\"errorTag\":\"<3–6 word label of the main mistake, or empty>\",\"misconception\":<true if the answer shows a confident wrong belief rather than a gap>}")
	};
}
function projectReviewPrompt({ project, submission, language }) {
	return {
		system: join(PERSONA, `You review learner projects like a supportive senior mentor: specific, honest, and actionable. ${languageRule(language)}`, JSON_ONLY),
		user: join(block("project", {
			title: project.title,
			brief: project.brief,
			milestones: project.milestones,
			rubric: project.rubric
		}), block("submission", submission), "Score each rubric criterion (0 to its points) with a one-sentence justification that quotes or points to the submission. Then summarize strengths and the 2–4 most valuable next improvements.\n\nReturn {\"scores\":[{\"criterionId\":\"r1\",\"points\":0,\"comment\":\"…\"}],\"total\":0,\"summary\":\"…\",\"strengths\":[\"…\"],\"nextSteps\":[\"…\"]}")
	};
}
function cheatsheetPrompt({ scopeTitle, outline, passages, language, focus }) {
	return {
		system: join(PERSONA, `You make dense, exam-ready cheat sheets that a student can print on one or two pages. ${languageRule(language)}`, JSON_ONLY),
		user: join(block("scope", scopeTitle), block("outline", outline), block("source_passages", passages), block("focus", focus), `Write a cheat sheet organized by THEME (not by chapter): group what belongs together even if it was taught in different places, and link related sections. Items are terse: definitions, formulas (LaTeX in "tex"), key facts, worked mini-examples, comparisons, and common pitfalls. Cite the page or slide when an item comes from a source passage. 6–14 sections, 3–10 items each.

Return {"title":"…","sections":[{"title":"…","related":["<other section title>"],"items":[{"kind":"definition|formula|fact|tip|pitfall|example|compare","title":"…","text":"…","tex":"…","cite":{"page":12,"source":"…"}}]}]}`)
	};
}
function flashcardsPrompt({ scopeTitle, outline, passages, language, count = 24 }) {
	return {
		system: join(PERSONA, `You write flashcards that test one fact or idea each, phrased as questions that force recall. ${languageRule(language)}`, JSON_ONLY),
		user: join(block("scope", scopeTitle), block("outline", outline), block("source_passages", passages), `Write ${count} flashcards covering the most important ideas, definitions and formulas. Fronts are short questions or prompts; backs are precise answers (LaTeX allowed as $…$), at most three sentences. Avoid yes/no fronts.

Return {"cards":[{"front":"…","back":"…","tag":"<topic>"}]}`)
	};
}
function quizPrompt({ scopeTitle, outline, concepts, language, count = 10 }) {
	return {
		system: join(PERSONA, `You write fair, well-balanced quizzes. ${languageRule(language)}`, JSON_ONLY),
		user: join(block("scope", scopeTitle), block("outline", outline), block("concepts", concepts), `Write a ${count}-question quiz across the whole scope: about 30% recall, 50% application, 20% harder transfer questions. Mix choice, multi, blank, number and short items, each with explanation, difficulty and conceptIds (use the ids given).

Return {"items":[…same item shape as practice items…]}`)
	};
}
function summaryPrompt({ scopeTitle, passages, outline, language }) {
	return {
		system: join(PERSONA, `You write study notes that are clear, structured and faithful to the source. ${languageRule(language)}`),
		user: join(block("scope", scopeTitle), block("outline", outline), block("source_passages", passages), "Write structured study notes in Markdown: a 3–5 sentence overview, then sections with headings, key points, formulas ($…$ / $$…$$), and short examples, then a \"Check yourself\" list of 5 questions. Cite pages as (p. N) where the source says so.")
	};
}
function digestPrompt({ title, passages, notes, language }) {
	return {
		system: join(PERSONA, `You help learners digest long readings: you surface the structure and the argument, not just a summary. ${languageRule(language)}`, JSON_ONLY),
		user: join(block("document", title), notes ? block("notes_on_each_part", notes) : block("passages", passages), notes ? "The notes above cover the whole document part by part, in order. Combine them into one digest of the whole document: follow its structure from beginning to end, merge points that repeat, and keep the page references from the notes." : "", "Return {\"overview\":\"3–5 sentences\",\"structure\":[{\"heading\":\"…\",\"points\":[\"…\"],\"pages\":\"e.g. 3–7\"}],\"keyIdeas\":[\"…\"],\"arguments\":[{\"claim\":\"…\",\"support\":\"…\",\"page\":\"…\"}],\"glossary\":[{\"term\":\"…\",\"meaning\":\"…\"}],\"questions\":[\"5 questions worth discussing or testing\"]}")
	};
}
function digestPartPrompt({ title, part, parts, range, passages, language }) {
	return {
		system: join(PERSONA, `You are reading a long document one part at a time for a learner. Take faithful notes on this part only; a later pass combines the notes of all parts. ${languageRule(language)}`, JSON_ONLY),
		user: join(block("document", title), block("part", `Part ${part} of ${parts}${range ? ` (${range})` : ""}`), block("passages", passages), "Take notes on this part only. Return {\"sections\":[{\"heading\":\"the chapter or section title as the text gives it\",\"pages\":\"e.g. 12–18\",\"points\":[\"…\"]}],\"keyIdeas\":[\"…\"],\"arguments\":[{\"claim\":\"…\",\"support\":\"…\",\"page\":\"…\"}],\"glossary\":[{\"term\":\"…\",\"meaning\":\"…\"}]}. Take page numbers from the passage labels; never invent them.")
	};
}
const ASSIST_MODES = Object.freeze({
	explain: "Explain the concept the learner asked about, at their level, intuition first, then precise, with one worked example. 5–9 steps, 1–2 checks.",
	solve: "Solve the problem WITH the learner: restate it, identify the method, then work it step by step on the board, explaining why each move is made. Show the final answer clearly in a key note and add one similar practice check at the end. 4–10 steps.",
	visualize: "Make the idea visible: lead with charts, diagrams or an animation built from correct numbers, and narrate what to notice in each picture. 3–7 steps."
});
function assistPrompt({ mode, request, language, passages, history, learner }) {
	return {
		system: join(PERSONA, BOARD_SPEC, STEP_SPEC, languageRule(language), JSONL_ONLY),
		user: join(learnerBlock(learner), block("earlier_in_this_session", history), block("source_passages", passages), block("request", request), ASSIST_MODES[mode] ?? ASSIST_MODES.explain, "Start with a step whose ops begin with a {\"t\":\"title\"} op naming the topic.")
	};
}
function shortPrompt({ topic, passages, language }) {
	return {
		system: join(PERSONA, BOARD_SPEC, STEP_SPEC, languageRule(language), JSONL_ONLY),
		user: join(block("topic", topic), block("source", passages), `Make a two-minute explainer short for this topic, the kind someone shares because it made an idea finally click: a gripping first sentence, one core idea, a memorable visual (diagram, chart or animation), one concrete example, and a one-line takeaway. 6–9 steps; total narration about 260–320 words (or 450–550 Chinese characters). No checks. Use at most two board pages.`)
	};
}
function materialBriefPrompt({ title, passages, language }) {
	return {
		system: join(PERSONA, languageRule(language), JSON_ONLY),
		user: join(block("document", title), block("passages", passages), "The passages are excerpts spread across the whole document, each labelled with where it comes from. Describe this material as a whole for a course designer, not just its opening. Return {\"summary\":\"3–4 sentences\",\"topics\":[\"main topics in the order the document covers them\"],\"level\":\"beginner|intermediate|advanced\",\"suggestedGoal\":\"one sentence learning goal a student might have for it\"}")
	};
}
function profilePrompt({ profile, events, language }) {
	return {
		system: join(PERSONA, `You keep a short, respectful profile of the learner so future lessons fit them better. Only record what the evidence supports. ${languageRule(language)}`, JSON_ONLY),
		user: join(block("current_profile", profile), block("recent_learning_events", events), "Update the profile. Keep it short; merge rather than append duplicates; drop weaknesses the learner has clearly overcome. Return {\"background\":\"…\",\"goals\":[\"…\"],\"strengths\":[\"…\"],\"weaknesses\":[\"…\"],\"preferences\":{\"style\":\"…\"},\"newNote\":\"<one sentence worth remembering, or empty>\"}")
	};
}
//#endregion
//#region src/host/runtime.js
const KEY = Symbol.for("dsh-aha-tutor.runtime");
function publishRuntime(runtime) {
	globalThis[KEY] = runtime;
	return () => {
		if (globalThis[KEY] === runtime) delete globalThis[KEY];
	};
}
function getRuntime() {
	const runtime = globalThis[KEY];
	if (!runtime) throw new Error("Aha Tutor is still starting. Try again in a moment.");
	return runtime;
}
//#endregion
export { intakeSummary as $, emptyProgress as A, passageRange as B, summaryPrompt as C, generateText as D, generateSteps as E, readMaterials as F, recommendNext as G, applyEvidence as H, readProfile as I, conceptIndex as J, boardToPlainText as K, readProgress as L, materialImages as M, materialsSummary as N, streamCounter as O, passagesFor as P, insertLesson as Q, documentParts as R, shortPrompt as S, generateJson as T, createConceptState as U, spreadPassages as V, masteryPercent as W, findLesson as X, courseProgress as Y, flattenLessons as Z, projectsPrompt as _, blueprintPrompt as a, normalizePractice as at, reexplainPrompt as b, digestPartPrompt as c, outlineForPrompt as ct, gradePrompt as d, assertId as dt, lessonAfter as et, lessonPrompt as f, newId as ft, projectReviewPrompt as g, profilePrompt as h, assistPrompt as i, normalizeCheatsheet as it, masteryFor as j, EMPTY_PROFILE as k, digestPrompt as l, safeRelativePath as lt, practicePrompt as m, publishRuntime as n, normalizeBlueprint as nt, cheatsheetPrompt as o, normalizeProject as ot, materialBriefPrompt as p, normalizeBoard as q, askPrompt as r, normalizeCards as rt, detectLanguage as s, normalizeQuestionnaire as st, getRuntime as t, nextLesson as tt, flashcardsPrompt as u, text as ut, questionnairePrompt as v, TutorError as w, revisePrompt as x, quizPrompt as y, formatPassages as z };
