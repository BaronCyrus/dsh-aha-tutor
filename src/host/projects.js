// Hands-on projects: a real folder with the brief and starter files that a
// DSH coding session can open, and rubric-based reviews of what was built.

import { lstat, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import { safeRelativePath, text } from '../core/course-model.js'
import { assertId } from '../core/ids.js'
import { generateJson, TutorError } from './generate.js'
import { safeFileName } from './courses.js'
import { projectReviewPrompt } from './prompts.js'
import { resolveProjectsRoot, writeFileAtomic } from './store.js'

const READ_LIMIT_FILES = 40
const READ_LIMIT_BYTES = 200 * 1024
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', '.idea', '.vscode', 'dist', 'build', '.next'])
const TEXT_FILE = /\.(md|txt|py|ipynb|js|mjs|ts|tsx|jsx|json|csv|tsv|sql|r|java|c|cc|cpp|h|hpp|cs|go|rs|rb|php|swift|kt|html|css|scss|yaml|yml|toml|ini|sh|ps1|tex)$/iu

export function createProjects({ store, llm, jobs, courses, projectsRoot = resolveProjectsRoot(), now = () => new Date() }) {
  async function find(courseId, projectId) {
    const course = await courses.readCourse(courseId)
    const project = course.projects?.find(item => item.id === assertId(projectId, 'prj'))
    if (!project) throw new TutorError('not-found', 'Project not found')
    return { course, project }
  }

  const folderOf = (course, project) => join(projectsRoot, `${safeFileName(course.title)}-${project.id.slice(4, 12)}`)

  async function get({ courseId, projectId }) {
    const { course, project } = await find(courseId, projectId)
    const progress = (await store.readJson(store.paths.progress(courseId), null)) ?? {}
    const folder = folderOf(course, project)
    let exists = false
    try {
      exists = (await stat(folder)).isDirectory()
    } catch {
      exists = false
    }
    return { project, language: course.language, workspace: exists ? folder : null, submissions: progress.projects?.[projectId]?.submissions ?? [] }
  }

  // Create (or reuse) the project folder. Existing files are never overwritten.
  async function openWorkspace({ courseId, projectId }) {
    const { course, project } = await find(courseId, projectId)
    const folder = folderOf(course, project)
    await mkdir(folder, { recursive: true })
    const zh = String(course.language).startsWith('zh')
    const brief = [
      `# ${project.title}`,
      '',
      project.brief,
      '',
      zh ? '## 里程碑' : '## Milestones',
      ...project.milestones.map((item, index) => `${index + 1}. **${item.title}** ${item.detail ?? ''}`.trim()),
      '',
      zh ? '## 评分标准' : '## Rubric',
      ...project.rubric.map(item => `- ${item.criterion} (${item.points}) ${item.detail ?? ''}`.trim()),
      '',
      zh ? `> 来自课程「${course.title}」。完成后回到「开窍」提交，AI 老师会按评分标准点评。` : `> From the course "${course.title}". When you are done, submit it in Aha Tutor for a rubric-based review.`,
      '',
    ].join('\n')
    const files = [{ path: 'PROJECT.md', content: brief }, ...project.starterFiles]
    const written = []
    for (const file of files) {
      const path = safeRelativePath(file.path)
      if (!path) continue
      const target = join(folder, ...path.split('/'))
      if (!target.startsWith(folder + sep)) continue
      try {
        await stat(target)
        continue
      } catch {
        // absent: write it
      }
      await mkdir(join(target, '..'), { recursive: true })
      await writeFileAtomic(target, file.content)
      written.push(path)
    }
    const prompt = zh
      ? `我在做课程「${course.title}」里的实战项目「${project.title}」。请先阅读 PROJECT.md，帮我规划步骤，然后一步一步陪我完成。不要直接给出完整答案，先让我尝试，在我卡住时再提示。`
      : `I'm working on the project "${project.title}" from my course "${course.title}". Read PROJECT.md first, help me plan the steps, then guide me through them one at a time. Don't hand me the full solution; let me try first and give hints when I'm stuck.`
    return { path: folder, written, prompt, title: project.title }
  }

  async function readWorkspace(folder) {
    const files = []
    let total = 0
    const walk = async dir => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (files.length >= READ_LIMIT_FILES || total >= READ_LIMIT_BYTES) return
        const full = join(dir, entry.name)
        const info = await lstat(full).catch(() => null)
        if (!info || info.isSymbolicLink()) continue
        if (info.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) await walk(full)
          continue
        }
        if (!TEXT_FILE.test(entry.name) || info.size > 80 * 1024) continue
        const content = await readFile(full, 'utf8').catch(() => '')
        const slice = content.slice(0, Math.max(0, READ_LIMIT_BYTES - total))
        total += slice.length
        files.push(`--- ${relative(folder, full).split(sep).join('/')} ---\n${slice}`)
      }
    }
    await walk(folder)
    return files.join('\n\n')
  }

  function submit({ courseId, projectId, notes, includeWorkspace = true }) {
    return jobs.start('project/review', async api => {
      const { course, project } = await find(courseId, projectId)
      const parts = []
      const note = text(notes, 8000)
      if (note) parts.push(`Learner's notes:\n${note}`)
      if (includeWorkspace) {
        const folder = folderOf(course, project)
        const content = await readWorkspace(folder)
        if (content) parts.push(`Files in the project folder:\n${content}`)
      }
      if (!parts.length) throw new TutorError('nothing-to-review', 'Nothing to review yet: write a note or work in the project folder first')
      const result = await generateJson(llm, {
        purpose: 'teach',
        prompt: projectReviewPrompt({ project, submission: parts.join('\n\n'), language: course.language }),
        maxTokens: 5000,
        signal: api.signal,
        normalize: raw => {
          const scores = project.rubric.map(criterion => {
            const entry = (raw?.scores ?? []).find(item => item?.criterionId === criterion.id) ?? (raw?.scores ?? [])[project.rubric.indexOf(criterion)]
            const points = Math.min(criterion.points, Math.max(0, Math.round(Number(entry?.points) || 0)))
            return { criterionId: criterion.id, criterion: criterion.criterion, max: criterion.points, points, comment: text(entry?.comment, 600) }
          })
          return {
            scores,
            total: scores.reduce((sum, item) => sum + item.points, 0),
            max: scores.reduce((sum, item) => sum + item.max, 0),
            summary: text(raw?.summary, 1500),
            strengths: (raw?.strengths ?? []).map(item => text(item, 300)).filter(Boolean).slice(0, 6),
            nextSteps: (raw?.nextSteps ?? []).map(item => text(item, 300)).filter(Boolean).slice(0, 6),
          }
        },
      })
      const submission = { at: now().toISOString(), notes: note, review: result }
      await store.updateJson(store.paths.progress(courseId), null, value => {
        const next = value ?? { courseId, lessons: {}, concepts: {}, reviews: {}, events: [] }
        next.projects ??= {}
        const entry = next.projects[projectId] ?? { submissions: [] }
        entry.submissions = [...entry.submissions, submission].slice(-10)
        entry.status = result.max && result.total / result.max >= 0.7 ? 'passed' : 'in-progress'
        next.projects[projectId] = entry
        return next
      })
      return { submission }
    }, { key: `project:${courseId}:${projectId}` })
  }

  return Object.freeze({ get, openWorkspace, submit })
}
