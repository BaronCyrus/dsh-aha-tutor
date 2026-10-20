import { O as generateJson, b as quizPrompt, c as detectLanguage, dt as normalizePractice, gt as text, t as getRuntime, vt as newId, z as readProfile } from "./runtime-BPdNjfsp.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
//#region src/agent.js
const name = "aha-tutor-agent";
const inject = ["tools", "systemPrompt"];
const TOOL_GUIDE = `## Teaching tools (Aha Tutor)
- aha_whiteboard: explain a concept, solve a problem step by step, or visualize an idea on a narrated handwriting whiteboard in the side panel. Prefer it over long chat answers whenever a picture, a formula derivation or a worked example would help. After calling it, reply with at most two sentences; never repeat the board in chat.
- aha_quiz: check understanding with a few interactive questions shown to the learner. Use it after explaining something important. The learner's answers arrive in their next message; then give feedback and fill the gaps.
- aha_course: when the learner wants to learn a whole subject systematically, design a personal course in Aha Tutor instead of teaching everything in chat.
- aha_cheatsheet: make a printable cheat sheet before exams or at the end of a topic.
- aha_learner: read what Aha remembers about the learner (background, goals, weak spots, active courses) before planning or when personalizing.
Teach for understanding: ask what the learner already knows, check often, and do not just hand over homework answers.`;
const MODES = [
	"explain",
	"solve",
	"visualize"
];
const TIMELINES = [
	"intensive",
	"balanced",
	"relaxed"
];
async function waitForJob(jobs, id, signal, timeoutMs = 9e4) {
	const started = Date.now();
	for (;;) {
		signal?.throwIfAborted();
		const job = jobs.get(id);
		if (!job) throw new Error("The task was lost");
		if (job.status === "done") return job.result;
		if (job.status !== "running") throw new Error(job.error?.message ?? "The task failed");
		if (Date.now() - started > timeoutMs) throw new Error("The task is taking longer than expected");
		await new Promise((resolve) => {
			setTimeout(resolve, 400);
		});
	}
}
function apply(ctx) {
	ctx.systemPrompt.section({
		name: "aha-tutor:tools",
		order: 2950,
		interpolate: false,
		text: TOOL_GUIDE
	});
	ctx.tools.register(defineTool({
		name: "aha_whiteboard",
		description: "Teach on Aha Tutor's narrated whiteboard in the side panel: the tutor writes by hand, draws diagrams and charts, and speaks. Returns immediately while the board streams to the learner.",
		parameters: {
			topic: {
				type: "string",
				required: true,
				description: "Short title of what the board covers"
			},
			request: {
				type: "string",
				required: true,
				description: "What exactly to explain, solve or visualize, with the learner's context (level, what confused them, the problem statement)"
			},
			mode: {
				type: "string",
				enum: MODES,
				description: "explain (default), solve (step-by-step problem solving) or visualize (charts, diagrams, animations)"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					threadId: {
						type: "string",
						required: true
					},
					jobId: {
						type: "string",
						required: true
					},
					title: {
						type: "string",
						required: true
					}
				}
			},
			render: (args, value) => [{
				type: "text",
				text: `The whiteboard "${value.title}" is now being written for the learner in the side panel (Aha thread ${value.threadId}). Keep your chat reply to one or two sentences and do not repeat its content.`
			}],
			presentationMeta: (args, value) => ({
				kind: "aha-tutor/board",
				threadId: value.threadId,
				jobId: value.jobId,
				title: value.title,
				mode: MODES.includes(args.mode) ? args.mode : "explain"
			})
		},
		timeoutMs: 3e4,
		async execute(args) {
			const runtime = getRuntime();
			await runtime.ready;
			const threadId = newId("thd");
			return {
				threadId,
				jobId: runtime.studio.assist({
					mode: MODES.includes(args.mode) ? args.mode : "explain",
					request: `${text(args.topic, 200)}\n\n${text(args.request, 3800)}`,
					newThreadId: threadId
				}).id,
				title: text(args.topic, 200)
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "aha_quiz",
		description: "Show the learner a short interactive quiz (multiple choice, fill-in, numeric or short answer). Answers are not revealed to you; the learner reports results in the next message.",
		parameters: {
			topic: {
				type: "string",
				required: true,
				description: "What to test, including the scope just taught"
			},
			count: {
				type: "integer",
				description: "Number of questions, 2–8 (default 4)"
			},
			level: {
				type: "string",
				description: "Difficulty or learner level, e.g. beginner, exam-level"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					count: {
						type: "integer",
						required: true
					},
					items: {
						type: "json",
						required: true
					}
				}
			},
			render: (args, value) => [{
				type: "text",
				text: `Showing ${value.count} interactive question(s) on "${args.topic}":\n${value.items.map((item, index) => `${index + 1}. ${item.prompt}`).join("\n")}\nWait for the learner's results before explaining the answers.`
			}],
			presentationMeta: (args, value) => ({
				kind: "aha-tutor/quiz",
				topic: text(args.topic, 200),
				items: value.items
			})
		},
		timeoutMs: 15e4,
		async execute(args, exec) {
			const runtime = getRuntime();
			await runtime.ready;
			const count = Math.min(8, Math.max(2, Math.round(Number(args.count) || 4)));
			const topic = text(args.topic, 600);
			const language = detectLanguage(topic);
			const quiz = await generateJson(runtime.llm, {
				purpose: "quick",
				prompt: quizPrompt({
					scopeTitle: `${topic}${args.level ? ` (${text(args.level, 80)})` : ""}`,
					outline: "",
					concepts: "",
					language,
					count
				}),
				maxTokens: 6e3,
				signal: exec.signal,
				normalize: (raw) => {
					const set = normalizePractice(raw, []);
					if (!set.items.length) throw new Error("no questions");
					return set;
				}
			});
			return {
				count: quiz.items.length,
				items: quiz.items
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "aha_course",
		description: "Design a personal, structured course in Aha Tutor (units, lessons, practice, projects) for a learning goal. Starts the blueprint and returns at once; the learner reviews and confirms it in Aha.",
		parameters: {
			goal: {
				type: "string",
				required: true,
				description: "The learning goal with the learner's context: why, current level, constraints"
			},
			timeline: {
				type: "string",
				enum: TIMELINES,
				description: "intensive (~6 weeks), balanced (~3 months, default) or relaxed (no deadline)"
			},
			weeklyMinutes: {
				type: "integer",
				description: "Study time per week in minutes"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					courseId: {
						type: "string",
						required: true
					},
					goal: {
						type: "string",
						required: true
					}
				}
			},
			render: (args, value) => [{
				type: "text",
				text: `Started designing a course in Aha Tutor for: ${value.goal}. The learner can open it from the card to review and confirm the blueprint.`
			}],
			presentationMeta: (args, value) => ({
				kind: "aha-tutor/course",
				courseId: value.courseId,
				goal: value.goal
			})
		},
		timeoutMs: 12e4,
		async execute(args, exec) {
			const runtime = getRuntime();
			await runtime.ready;
			const goal = text(args.goal, 2e3);
			const started = runtime.courses.startCraft({
				goal,
				quick: true
			});
			const { courseId } = await waitForJob(runtime.jobs, started.id, exec.signal);
			runtime.courses.submitIntake({
				courseId,
				answers: {},
				timeline: TIMELINES.includes(args.timeline) ? args.timeline : "balanced",
				weeklyMinutes: args.weeklyMinutes
			});
			return {
				courseId,
				goal
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "aha_cheatsheet",
		description: "Make a dense, printable cheat sheet on a topic (organized by theme, with formulas and pitfalls) and save it in Aha Tutor.",
		parameters: {
			topic: {
				type: "string",
				required: true,
				description: "Topic or exam scope"
			},
			focus: {
				type: "string",
				description: "What to emphasize"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					sheetId: {
						type: "string",
						required: true
					},
					title: {
						type: "string",
						required: true
					},
					sections: {
						type: "integer",
						required: true
					}
				}
			},
			render: (args, value) => [{
				type: "text",
				text: `Saved the cheat sheet "${value.title}" (${value.sections} sections) in Aha Tutor; the learner can open and print it from the card.`
			}],
			presentationMeta: (args, value) => ({
				kind: "aha-tutor/sheet",
				sheetId: value.sheetId,
				title: value.title
			})
		},
		timeoutMs: 2e5,
		async execute(args, exec) {
			const runtime = getRuntime();
			await runtime.ready;
			const item = await runtime.studio.makeTopicSheet({
				topic: args.topic,
				focus: args.focus,
				signal: exec.signal
			});
			return {
				sheetId: item.id,
				title: item.title,
				sections: item.sheet.sections.length
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "aha_learner",
		description: "Read what Aha Tutor remembers about the learner: background, goals, strengths, weak spots, preferred explanations and active courses.",
		parameters: {},
		output: {
			schema: { type: "string" },
			render: (args, value) => [{
				type: "text",
				text: value
			}]
		},
		timeoutMs: 15e3,
		isConcurrencySafe: () => true,
		async execute() {
			const runtime = getRuntime();
			const profile = await readProfile(runtime.store);
			const courses = (await runtime.courses.list()).filter((course) => course.status === "ready" && !course.archived);
			const lines = [];
			if (profile.background) lines.push(`Background: ${profile.background}`);
			if (profile.goals.length) lines.push(`Goals: ${profile.goals.join("; ")}`);
			if (profile.strengths.length) lines.push(`Strengths: ${profile.strengths.join("; ")}`);
			if (profile.weaknesses.length) lines.push(`Weak spots: ${profile.weaknesses.join("; ")}`);
			if (profile.preferences?.style) lines.push(`Prefers: ${profile.preferences.style}`);
			for (const note of profile.notes.slice(-5)) lines.push(`Note: ${note.text}`);
			for (const course of courses.slice(0, 6)) lines.push(`Course: ${course.title} — ${course.progress.percent}% done${course.next ? `, next: ${course.next.title}` : ""}`);
			return lines.length ? lines.join("\n") : "Aha Tutor does not know anything about this learner yet.";
		}
	}));
}
//#endregion
export { TOOL_GUIDE, apply, inject, name };
