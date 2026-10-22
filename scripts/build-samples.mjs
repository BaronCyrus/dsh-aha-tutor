#!/usr/bin/env node
// Builds the sample course packs in samples/ from the sources below. Every
// pack goes through the plugin's own normalizers, so a sample is always in
// exactly the shape a generated course has.
//
//   node scripts/build-samples.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { normalizeBoard } from '../src/core/board-script.js'
import { exportCoursePack } from '../src/core/coursepack.js'
import { flattenLessons, normalizeBlueprint, normalizePractice } from '../src/core/course-model.js'

const INK = '#2b2b2b'
const range = (from, to, step) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, index) => Number((from + index * step).toFixed(4)))
const wave = (period, amplitude = 1) => range(0, 8, 0.1).map(t => [t, Number((amplitude * Math.cos((2 * Math.PI * t) / period)).toFixed(3))])

// ── 简谐运动 ────────────────────────────────────────────────────────────────

const SPRING_SVG = `<svg viewBox="0 0 480 220" xmlns="http://www.w3.org/2000/svg">
<line x1="34" y1="40" x2="34" y2="150" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
<line x1="34" y1="60" x2="20" y2="74" stroke="${INK}" stroke-width="2"/><line x1="34" y1="85" x2="20" y2="99" stroke="${INK}" stroke-width="2"/><line x1="34" y1="110" x2="20" y2="124" stroke="${INK}" stroke-width="2"/><line x1="34" y1="135" x2="20" y2="149" stroke="${INK}" stroke-width="2"/>
<polyline points="34,120 62,120 74,98 98,142 122,98 146,142 170,98 194,142 206,120 232,120" fill="none" stroke="#2f6fde" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
<rect x="232" y="90" width="72" height="60" rx="8" fill="#ffe7a3" stroke="${INK}" stroke-width="2.5"/>
<text x="268" y="126" font-size="18" text-anchor="middle" fill="${INK}">m</text>
<line x1="20" y1="150" x2="460" y2="150" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>
<line x1="268" y1="58" x2="268" y2="182" stroke="#7a4fd6" stroke-width="2" stroke-dasharray="6 5"/>
<text x="268" y="204" font-size="16" text-anchor="middle" fill="#7a4fd6">平衡位置 O</text>
<line x1="320" y1="70" x2="420" y2="70" stroke="#d64545" stroke-width="2.6" stroke-linecap="round"/>
<polyline points="410,63 420,70 410,77" fill="none" stroke="#d64545" stroke-width="2.6" stroke-linecap="round"/>
<text x="370" y="58" font-size="15" text-anchor="middle" fill="#d64545">向右拉开 x</text>
</svg>`

const FORCE_SVG = `<svg viewBox="0 0 480 200" xmlns="http://www.w3.org/2000/svg">
<line x1="20" y1="120" x2="460" y2="120" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
<line x1="240" y1="70" x2="240" y2="150" stroke="#7a4fd6" stroke-width="2" stroke-dasharray="6 5"/>
<text x="240" y="172" font-size="15" text-anchor="middle" fill="#7a4fd6">O</text>
<rect x="330" y="88" width="50" height="32" rx="6" fill="#ffe7a3" stroke="${INK}" stroke-width="2"/>
<line x1="330" y1="76" x2="270" y2="76" stroke="#d64545" stroke-width="3" stroke-linecap="round"/>
<polyline points="280,69 270,76 280,83" fill="none" stroke="#d64545" stroke-width="3" stroke-linecap="round"/>
<text x="355" y="150" font-size="15" text-anchor="middle" fill="${INK}">x &gt; 0</text>
<text x="300" y="64" font-size="15" text-anchor="middle" fill="#d64545">F &lt; 0</text>
<rect x="100" y="88" width="50" height="32" rx="6" fill="#ffe7a3" stroke="${INK}" stroke-width="2"/>
<line x1="150" y1="76" x2="210" y2="76" stroke="#d64545" stroke-width="3" stroke-linecap="round"/>
<polyline points="200,69 210,76 200,83" fill="none" stroke="#d64545" stroke-width="3" stroke-linecap="round"/>
<text x="125" y="150" font-size="15" text-anchor="middle" fill="${INK}">x &lt; 0</text>
<text x="180" y="64" font-size="15" text-anchor="middle" fill="#d64545">F &gt; 0</text>
</svg>`

const CIRCLE_ANIMATION = `<!doctype html><html><head><style>html,body{margin:0;background:transparent}canvas{display:block;width:100%;height:auto}</style></head><body><canvas id="c" width="600" height="280"></canvas><script>
const c=document.getElementById('c'),g=c.getContext('2d');const R=92,cx=130,cy=140,X0=290;let t=0;const trail=[];
function frame(){g.clearRect(0,0,600,280);g.lineWidth=1.6;g.strokeStyle='rgba(120,120,130,.6)';g.beginPath();g.arc(cx,cy,R,0,Math.PI*2);g.stroke();
g.beginPath();g.moveTo(cx-R-14,cy);g.lineTo(cx+R+14,cy);g.moveTo(X0,cy);g.lineTo(590,cy);g.stroke();
const px=cx+R*Math.cos(t),py=cy-R*Math.sin(t);g.strokeStyle='#2f6fde';g.beginPath();g.moveTo(cx,cy);g.lineTo(px,py);g.stroke();
g.fillStyle='#2f6fde';g.beginPath();g.arc(px,py,7,0,7);g.fill();g.setLineDash([5,5]);g.strokeStyle='#e08a1e';g.beginPath();g.moveTo(px,py);g.lineTo(X0,py);g.stroke();g.setLineDash([]);
g.strokeStyle='rgba(120,120,130,.9)';g.beginPath();g.moveTo(X0,40);g.lineTo(X0,240);g.stroke();g.fillStyle='#d64545';g.beginPath();g.arc(X0,py,7,0,7);g.fill();
trail.unshift(py);if(trail.length>290)trail.pop();g.strokeStyle='#d64545';g.lineWidth=2.4;g.beginPath();trail.forEach((y,i)=>{const x=X0+i;i?g.lineTo(x,y):g.moveTo(x,y)});g.stroke();
t+=0.028;requestAnimationFrame(frame)}frame();
</script></body></html>`

// One still frame of CIRCLE_ANIMATION, for exported videos.
function circlePoster() {
  const R = 92
  const cx = 130
  const cy = 140
  const X0 = 290
  const t = 2.1
  const px = (cx + R * Math.cos(t)).toFixed(1)
  const py = (cy - R * Math.sin(t)).toFixed(1)
  const trail = []
  for (let i = 0; i <= 290; i += 2) trail.push(`${X0 + i},${(cy - R * Math.sin(t - i * 0.028)).toFixed(1)}`)
  return `<svg viewBox="0 0 600 280" width="600" height="280" xmlns="http://www.w3.org/2000/svg">
<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="#787882" stroke-opacity="0.6" stroke-width="1.6"/>
<line x1="${cx - R - 14}" y1="${cy}" x2="${cx + R + 14}" y2="${cy}" stroke="#787882" stroke-opacity="0.6" stroke-width="1.6"/>
<line x1="${X0}" y1="${cy}" x2="590" y2="${cy}" stroke="#787882" stroke-opacity="0.6" stroke-width="1.6"/>
<line x1="${X0}" y1="40" x2="${X0}" y2="240" stroke="#787882" stroke-opacity="0.9" stroke-width="1.6"/>
<polyline points="${trail.join(' ')}" fill="none" stroke="#d64545" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
<line x1="${cx}" y1="${cy}" x2="${px}" y2="${py}" stroke="#2f6fde" stroke-width="1.6"/>
<line x1="${px}" y1="${py}" x2="${X0}" y2="${py}" stroke="#e08a1e" stroke-width="1.6" stroke-dasharray="5 5"/>
<circle cx="${px}" cy="${py}" r="7" fill="#2f6fde"/>
<circle cx="${X0}" cy="${py}" r="7" fill="#d64545"/>
</svg>`
}

const SHM_BLUEPRINT = {
  title: '简谐运动：从弹簧到单摆',
  subtitle: '用一个旋转的圆，看懂世界上所有的来回振动',
  emoji: '🌀',
  summary: '适合高中到大一的学习者。从“为什么会来回振动”出发，建立回复力、周期、相位的直觉，再推出单摆公式，最后用自己测的数据验证它。',
  level: 'beginner',
  language: 'zh-CN',
  units: [
    {
      title: '振动从哪里来',
      summary: '回复力让物体来回运动；一个旋转的圆告诉我们它的样子。',
      objectives: ['说清回复力的方向与大小', '用参考圆理解简谐运动'],
      lectures: [
        { title: '回复力', lessons: [
          { title: '回复力：为什么会来回振动', summary: '从弹簧振子出发认识回复力与胡克定律。', objectives: ['判断回复力的方向', '用 F = −kx 计算回复力'], concepts: ['回复力', '胡克定律'], estMinutes: 12 },
          { title: '振幅、周期与频率', summary: '描述振动的三个基本量。', objectives: ['区分振幅、周期和频率', '在图像上读出这三个量'], concepts: ['振幅', '周期与频率'], estMinutes: 12 },
        ] },
        { title: '运动的样子', lessons: [
          { title: '从圆周运动看简谐运动', summary: '简谐运动是匀速圆周运动的“影子”。', objectives: ['写出 x = A cos(ωt + φ)', '理解 ω 与周期的关系'], concepts: ['参考圆', '角频率'], estMinutes: 15 },
          { title: '位移、速度与加速度的相位关系', summary: '三个量依次相差四分之一个周期。', objectives: ['画出 x、v、a 随时间的图像', '判断各点速度与加速度的方向'], concepts: ['相位', '速度与加速度'], estMinutes: 15 },
        ] },
      ],
    },
    {
      title: '单摆与能量',
      summary: '把方法用到单摆上，并从能量的角度再看一次振动。',
      objectives: ['推导单摆周期公式', '用能量守恒分析简谐运动'],
      lectures: [
        { title: '单摆', lessons: [
          { title: '小角度近似：单摆为什么是简谐运动', summary: 'sin θ ≈ θ 让单摆满足回复力的形式。', objectives: ['解释小角度近似', '推出单摆的回复力'], concepts: ['小角度近似', '单摆的回复力'], estMinutes: 15 },
          { title: '周期公式与测量重力加速度', summary: 'T = 2π√(L/g)，以及如何用它测出 g。', objectives: ['使用单摆周期公式', '设计测量 g 的实验'], concepts: ['单摆周期', '重力加速度'], estMinutes: 12 },
        ] },
        { title: '能量视角', lessons: [
          { title: '动能与势能的来回交换', summary: '振动的过程就是能量在两种形式之间流动。', objectives: ['描述振动中动能与势能的变化', '计算简谐运动的总能量'], concepts: ['机械能守恒', '振动的能量'], estMinutes: 12 },
        ] },
      ],
    },
  ],
  projects: [{
    title: '用一根绳子测出重力加速度',
    kind: 'code',
    brief: '用手机秒表和一根绳子做一个单摆，测出不同摆长下的周期，再用 Python 画出 T² 与 L 的关系，从直线斜率求出你所在地的重力加速度 g，并和 9.8 m/s² 比较、分析误差来源。',
    skills: ['单摆周期公式', '线性拟合', '误差分析'],
    unitIndex: 1,
    milestones: [
      { title: '做一个单摆并测量', detail: '至少 5 个不同摆长，每个摆长测 10 次全振动的总时间。' },
      { title: '整理数据', detail: '把摆长 L（米）和周期 T（秒）记进 data.csv。' },
      { title: '拟合并求 g', detail: '画出 T² 关于 L 的散点图并做线性拟合，由斜率 4π²/g 求 g。' },
      { title: '分析误差', detail: '说明最主要的误差来源，以及怎样改进。' },
    ],
    rubric: [
      { criterion: '数据采集', points: 25, detail: '摆长分布合理，重复测量减小了计时误差。' },
      { criterion: '分析方法', points: 30, detail: '正确用 T² 对 L 线性拟合并由斜率求 g。' },
      { criterion: '结果', points: 20, detail: 'g 的结果合理，并给出与 9.8 m/s² 的相对误差。' },
      { criterion: '误差讨论', points: 25, detail: '指出关键误差来源（计时、摆长测量、摆角过大等）并提出改进。' },
    ],
    starterFiles: [
      { path: 'README.md', content: '# 用单摆测重力加速度\n\n1. 把你的测量结果填进 `data.csv`（摆长单位：米；`time_10` 是 10 次全振动的总时间，单位：秒）。\n2. 运行 `python analyze.py`。\n3. 完成 `analyze.py` 里的 TODO，得到 g 并写下误差分析。\n' },
      { path: 'data.csv', content: 'length_m,time_10_s\n0.30,11.02\n0.45,13.48\n0.60,15.55\n0.75,17.41\n0.90,19.05\n' },
      { path: 'analyze.py', content: 'import csv\nimport math\n\n# 读取数据\nrows = list(csv.DictReader(open("data.csv", encoding="utf-8")))\nL = [float(r["length_m"]) for r in rows]\nT = [float(r["time_10_s"]) / 10 for r in rows]\n\n# TODO 1：计算每个摆长对应的 T 的平方\nT2 = []\n\n# TODO 2：对 T2 关于 L 做最小二乘线性拟合，求斜率 k\n# 提示：k = Σ(L - L̄)(T2 - T̄2) / Σ(L - L̄)²\nk = None\n\n# TODO 3：由 T² = (4π²/g)·L 求 g\ng = None\n\nprint("g =", g)\n' },
    ],
  }],
}

const conceptRef = name => ({ concept: name })

const SHM_BOARDS = {
  '回复力：为什么会来回振动': [
    { say: '想象你拉开一根弹簧，再松手。它不会乖乖停在原地，而是来回振动。今天我们就来弄清楚：到底是什么力在一直把它往回拉？', ops: [{ t: 'title', text: '回复力：为什么会来回振动' }, { t: 'h', text: '一个熟悉的现象' }, { t: 'p', text: '拉开 → 松手 → ==来回振动==' }] },
    { say: '先画一个最简单的模型：一个木块连着弹簧，放在光滑的桌面上。木块静止时的位置，我们叫它平衡位置，记作 O。', ops: [{ t: 'svg', svg: SPRING_SVG, caption: '弹簧振子：光滑水平面上的木块和弹簧' }] },
    { say: '把木块往右拉开，弹簧被拉长，就会把木块往左拉；往左压缩，弹簧又会往右推。不管在哪一边，力的方向总是指向平衡位置。', ops: [{ t: 'h', text: '回复力的方向' }, { t: 'p', text: '力总是**指向平衡位置**' }, { t: 'svg', svg: FORCE_SVG, caption: '两侧的回复力都指向 O' }] },
    { say: '而且拉得越远，力越大。胡克发现，在弹性限度内，弹簧的力和形变量成正比。写成公式，就是 F 等于负 k 乘 x。', ops: [{ t: 'col' }, { t: 'h', text: '胡克定律' }, { t: 'math', id: 'hooke', tex: 'F=-kx', text: 'F = −kx' }, { t: 'p', text: '$k$：劲度系数，单位 N/m' }] },
    { say: '注意这个负号。它不是说力是负的，而是说力和位移的方向相反。这正是“往回拉”的数学写法。', ops: [{ t: 'mark', ref: 'hooke', style: 'circle' }, { t: 'note', tone: 'key', text: '负号 = 方向相反 = 拉回平衡位置' }], check: { kind: 'choice', prompt: '木块在平衡位置左边 3 cm 处（$x = -3$ cm），回复力的方向是？', options: ['向右', '向左', '为零', '取决于木块的质量'], answer: 0, explanation: '$x$ 为负，$F=-kx$ 为正，所以力向右，指向平衡位置。', concepts: ['回复力'] } },
    { say: '那为什么木块不会停在平衡位置呢？因为它回到 O 点时已经有了最大的速度，惯性让它冲过头；冲过头之后，另一侧的回复力又开始把它往回拉。', ops: [{ t: 'h', text: '为什么会冲过头？' }, { t: 'list', items: ['在 O 点：回复力为 0，但速度最大', '惯性让它冲过 O 点', '另一侧的回复力把它减速、拉回'] }] },
    { say: '把木块的位置随时间画出来，会得到一条平滑的波浪线。这就是简谐运动的样子。拖动图下面的滑块试试：振幅 A 决定波浪有多高，角频率 ω 决定它有多密。下一讲我们会揭开它和圆的关系。', ops: [{ t: 'page', title: '振动的图像' }, { t: 'plot', title: '位置随时间变化', x: [0, 8], xLabel: 't / s', yLabel: 'x / cm', fns: [{ y: 'A*cos(ω*t)', name: 'x(t)' }], params: [{ name: 'A', value: 5, min: 1, max: 8, step: 0.5, label: '振幅 A' }, { name: 'ω', value: 'pi/2', min: 0.5, max: 4, step: 0.05, label: '角频率 ω' }] }] },
    { say: '来算一个数。劲度系数是 200 牛每米的弹簧，被拉长 5 厘米，回复力有多大？先把厘米换成米，再代入公式。', ops: [{ t: 'h', text: '算一算' }, { t: 'p', text: '$k = 200$ N/m，$x = 5$ cm $= 0.05$ m' }, { t: 'math', tex: '|F| = kx = 200 \\times 0.05 = 10\\ \\text{N}', text: '|F| = kx = 200 × 0.05 = 10 N' }], check: { kind: 'number', prompt: '同一根弹簧（$k = 200$ N/m）被压缩 2 cm，回复力的大小是多少牛？', answer: 4, tolerance: 0.01, explanation: '$|F| = kx = 200 \\times 0.02 = 4$ N，方向指向平衡位置。', concepts: ['胡克定律'] } },
    { say: '最后总结今天的三个关键点。回复力总是指向平衡位置；它的大小和位移成正比；而冲过头靠的是惯性。下一讲，我们用一个旋转的圆，彻底看懂那条波浪线。', ops: [{ t: 'col' }, { t: 'note', tone: 'key', text: '① 回复力总指向平衡位置\n② $F=-kx$：离得越远，拉得越用力\n③ 惯性让它冲过头 → 来回振动' }], check: { kind: 'choice', prompt: '下面哪种情况中，物体受到的合力满足 $F=-kx$ 的形式？', options: ['光滑水平面上的弹簧振子', '自由下落的苹果', '匀速圆周运动中的向心力', '在平直公路上匀速行驶的汽车'], answer: 0, explanation: '只有弹簧振子的合力与偏离平衡位置的位移成正比且方向相反。', concepts: ['回复力', '胡克定律'] } },
  ],
  '从圆周运动看简谐运动': [
    { say: '上一讲我们看到，弹簧振子的位置随时间变成一条波浪线。这条曲线到底从哪里来？答案藏在一个匀速旋转的圆里。', ops: [{ t: 'title', text: '从圆周运动看简谐运动' }, { t: 'h', text: '一个关键的想象' }, { t: 'p', text: '圆周运动的**影子**会怎样运动？' }] },
    { say: '想象一个小球沿着圆周匀速转动，从侧面用光照它。墙上的影子会上下来回移动。仔细看右边画出的轨迹，是不是和上一讲的波浪线一模一样？', ops: [{ t: 'anim', html: CIRCLE_ANIMATION, poster: circlePoster(), height: 280, caption: '蓝点匀速转圈，红点是它在竖直方向上的“影子”' }] },
    { say: '设圆的半径是 A，小球转过的角度是 ω t 加上起始角 φ，那么影子的位置，就是 A 乘以这个角度的余弦。', ops: [{ t: 'math', id: 'shm', tex: 'x(t)=A\\cos(\\omega t+\\varphi)', text: 'x(t) = A·cos(ωt + φ)' }, { t: 'list', items: ['$A$：振幅，也就是圆的半径', '$\\omega$：角频率，转得有多快', '$\\varphi$：初相位，从哪里开始转'] }], check: { kind: 'choice', prompt: '把参考圆的半径变成原来的 2 倍，影子振动的哪个量会变成 2 倍？', options: ['振幅', '周期', '频率', '初相位'], answer: 0, explanation: '半径就是振幅；转速不变，所以周期和频率都不变。', concepts: ['参考圆'] } },
    { say: '小球转一整圈所用的时间就是周期 T。一圈是 2π 弧度，所以 ω 等于 2π 除以 T，也等于 2π 乘以频率。', ops: [{ t: 'col' }, { t: 'h', text: '周期与角频率' }, { t: 'math', tex: '\\omega=\\frac{2\\pi}{T}=2\\pi f', text: 'ω = 2π/T = 2πf' }, { t: 'p', text: '转得越快 → $\\omega$ 越大 → 周期越短' }] },
    { say: '弹簧振子的 ω 由什么决定？可以证明，ω 的平方等于 k 除以 m。弹簧越硬，振得越快；物体越重，振得越慢。', ops: [{ t: 'math', tex: '\\omega=\\sqrt{\\frac{k}{m}},\\qquad T=2\\pi\\sqrt{\\frac{m}{k}}', text: 'ω = √(k/m)，T = 2π√(m/k)' }, { t: 'note', tone: 'tip', text: '周期和振幅无关！拉得远一点，跑得也快一点，用时刚好一样。' }], check: { kind: 'number', prompt: '$k = 100$ N/m、$m = 1$ kg 的弹簧振子，角频率 $\\omega$ 是多少 rad/s？', answer: 10, tolerance: 0.01, explanation: '$\\omega=\\sqrt{k/m}=\\sqrt{100}=10$ rad/s。', concepts: ['角频率'] } },
    { say: '来比较两条曲线。它们的振幅一样，但周期不同。周期短的那条，波峰挨得更紧。', ops: [{ t: 'page', title: '比较不同的周期' }, { t: 'chart', kind: 'line', title: '振幅相同、周期不同', xLabel: 't / s', yLabel: 'x', series: [{ name: 'T = 2 s', points: wave(2) }, { name: 'T = 4 s', points: wave(4) }] }] },
    { say: '最后总结。简谐运动就是匀速圆周运动的投影；它的位置写成 A cos 括号 ω t 加 φ；周期只由质量和劲度系数决定，和振幅无关。下一讲，我们看速度和加速度又是什么样子。', ops: [{ t: 'note', tone: 'key', text: '① 简谐运动 = 匀速圆周运动的“影子”\n② $x = A\\cos(\\omega t+\\varphi)$\n③ $T = 2\\pi\\sqrt{m/k}$，与振幅无关' }], check: { kind: 'choice', prompt: '把弹簧振子的振幅从 2 cm 增大到 4 cm，周期会怎样？', options: ['不变', '变为原来的 2 倍', '变为原来的一半', '变为原来的 √2 倍'], answer: 0, explanation: '$T=2\\pi\\sqrt{m/k}$ 与振幅无关。', concepts: ['角频率', '参考圆'] } },
  ],
}

const SHM_PRACTICE = {
  '回复力：为什么会来回振动': [
    { kind: 'choice', prompt: '关于弹簧振子的回复力，下列说法正确的是？', options: ['回复力的方向总是指向平衡位置', '回复力的方向总与速度方向相同', '回复力在平衡位置时最大', '回复力与位移的大小成反比'], answer: 0, hints: ['想想木块在平衡位置两侧时，力分别朝哪边'], explanation: '回复力 $F=-kx$，方向总与位移相反，即指向平衡位置；在平衡位置时 $x=0$，回复力为零。', difficulty: 1, concepts: ['回复力'] },
    { kind: 'number', prompt: '劲度系数 $k = 50$ N/m 的弹簧被拉长 0.1 m，回复力的大小是多少牛？', answer: 5, tolerance: 0.01, unit: 'N', hints: ['直接代入 $|F| = kx$'], explanation: '$|F| = 50 \\times 0.1 = 5$ N。', difficulty: 1, concepts: ['胡克定律'] },
    { kind: 'blank', prompt: '胡克定律可以写成 $F =$ ____（用 $k$ 和 $x$ 表示）。', answer: ['-kx', '−kx', '-k x', '−k x', '-k*x'], hints: ['别忘了表示方向的符号'], explanation: '$F=-kx$，负号表示力与位移方向相反。', difficulty: 1, concepts: ['胡克定律'] },
    { kind: 'choice', prompt: '木块经过平衡位置时，下列哪个量最大？', options: ['速度', '回复力', '加速度', '位移'], answer: 0, hints: ['在平衡位置，回复力和加速度都是多少？'], explanation: '平衡位置处位移、回复力、加速度都为零，速度最大。', difficulty: 2, concepts: ['回复力'] },
    { kind: 'short', prompt: '用你自己的话解释：为什么弹簧振子不会停在平衡位置，而是会来回振动？', answer: '到达平衡位置时回复力为零但速度最大，由于惯性会冲过平衡位置；冲过之后回复力反向，使它减速并被拉回，如此往复。', rubric: ['指出在平衡位置时速度不为零（最大）', '指出惯性使它冲过平衡位置', '指出另一侧的回复力把它拉回'], explanation: '振动是“回复力”和“惯性”共同作用的结果。', difficulty: 2, concepts: ['回复力'] },
  ],
  '从圆周运动看简谐运动': [
    { kind: 'choice', prompt: '简谐运动可以看成哪种运动在一条直线上的投影？', options: ['匀速圆周运动', '匀加速直线运动', '平抛运动', '自由落体运动'], answer: 0, explanation: '匀速圆周运动在任一直径方向上的投影就是简谐运动。', difficulty: 1, concepts: ['参考圆'] },
    { kind: 'number', prompt: '周期 $T = 0.5$ s 的简谐运动，角频率 $\\omega$ 约为多少 rad/s？（保留一位小数）', answer: 12.566, tolerance: 0.06, hints: ['$\\omega = 2\\pi / T$'], explanation: '$\\omega = 2\\pi/0.5 = 4\\pi \\approx 12.6$ rad/s。', difficulty: 1, concepts: ['角频率'] },
    { kind: 'choice', prompt: '$x = 3\\cos(2t)$（单位：cm）中，振幅是多少？', options: ['3 cm', '2 cm', '6 cm', '1.5 cm'], answer: 0, explanation: '余弦前面的系数就是振幅。', difficulty: 1, concepts: ['参考圆'] },
    { kind: 'number', prompt: '$m = 4$ kg、$k = 100$ N/m 的弹簧振子，周期是多少秒？（保留两位小数）', answer: 1.2566, tolerance: 0.01, hints: ['$T=2\\pi\\sqrt{m/k}$'], explanation: '$T = 2\\pi\\sqrt{4/100} = 2\\pi \\times 0.2 \\approx 1.26$ s。', difficulty: 2, concepts: ['角频率'] },
    { kind: 'multi', prompt: '下列哪些量会影响弹簧振子的周期？（多选）', options: ['物体质量 $m$', '劲度系数 $k$', '振幅 $A$', '初相位 $\\varphi$'], answer: [0, 1], explanation: '$T = 2\\pi\\sqrt{m/k}$，只与 $m$ 和 $k$ 有关。', difficulty: 2, concepts: ['角频率'] },
  ],
}

// ── 贝叶斯思维 ──────────────────────────────────────────────────────────────

const BAYES_BLUEPRINT = {
  title: '贝叶斯思维：一次阳性，你真的病了吗？',
  subtitle: '学会在不确定的世界里，用证据一点点更新判断',
  emoji: '🎲',
  summary: '不需要高深数学，从掷骰子和人数表格出发，理解条件概率、基础比率和贝叶斯公式，最后亲手写一个会“学习”的垃圾短信过滤器。',
  level: 'beginner',
  language: 'zh-CN',
  units: [
    {
      title: '条件概率的直觉',
      summary: '新信息会把世界变小，概率要在小世界里重新计算。',
      objectives: ['计算条件概率', '区分 P(A|B) 与 P(B|A)'],
      lectures: [
        { title: '条件概率', lessons: [
          { title: '条件概率：知道一点之后', summary: '在信息划定的小世界里重新数一遍。', objectives: ['用缩小样本空间的方法求条件概率', '使用条件概率公式'], concepts: ['条件概率', 'P(A|B) 与 P(B|A)'], estMinutes: 12 },
          { title: '独立与不独立', summary: '什么时候一个信息完全不改变另一个事件的概率。', objectives: ['判断两个事件是否独立', '计算独立事件同时发生的概率'], concepts: ['独立事件'], estMinutes: 12 },
        ] },
        { title: '全概率', lessons: [
          { title: '把世界切成几块：全概率公式', summary: '分情况讨论，再把各部分加起来。', objectives: ['用树状图分情况计算', '使用全概率公式'], concepts: ['全概率公式'], estMinutes: 15 },
        ] },
      ],
    },
    {
      title: '贝叶斯公式',
      summary: '从结果反推原因，用证据更新信念。',
      objectives: ['理解基础比率的作用', '用贝叶斯公式计算后验概率'],
      lectures: [
        { title: '贝叶斯', lessons: [
          { title: '医学检测悖论：基础比率的力量', summary: '准确率 99% 的检测，阳性也未必意味着得病。', objectives: ['用人数表格计算阳性者的患病概率', '解释基础比率被忽略时会发生什么'], concepts: ['基础比率', '贝叶斯公式'], estMinutes: 15 },
          { title: '先验、似然与后验', summary: '贝叶斯公式里每一项的含义。', objectives: ['说出先验、似然、后验的含义', '用公式完成一次更新'], concepts: ['先验与后验', '似然'], estMinutes: 12 },
        ] },
        { title: '用起来', lessons: [
          { title: '一次次更新你的判断', summary: '每一个新证据，都让昨天的后验变成今天的先验。', objectives: ['连续多次应用贝叶斯更新', '用贝叶斯思维分析生活中的判断'], concepts: ['贝叶斯更新'], estMinutes: 12 },
        ] },
      ],
    },
  ],
  projects: [{
    title: '写一个会学习的垃圾短信过滤器',
    kind: 'code',
    brief: '用朴素贝叶斯的思路，统计正常短信和垃圾短信里各个词出现的频率，对一条新短信计算它是垃圾短信的后验概率。完成后，试着输入几条你自己的短信，看看过滤器的判断是否合理。',
    skills: ['条件概率', '贝叶斯公式', '拉普拉斯平滑'],
    unitIndex: 1,
    milestones: [
      { title: '统计词频', detail: '分别统计垃圾短信和正常短信中每个词出现的次数。' },
      { title: '计算先验', detail: '训练集中垃圾短信所占的比例就是先验 P(垃圾)。' },
      { title: '计算后验并分类', detail: '对新短信的每个词连乘似然（取对数相加），比较两类的后验。' },
      { title: '测试与反思', detail: '用几条新短信测试，讨论“朴素”的独立性假设有什么问题。' },
    ],
    rubric: [
      { criterion: '词频与先验', points: 25, detail: '正确统计并计算先验概率。' },
      { criterion: '后验计算', points: 35, detail: '正确使用贝叶斯公式，使用平滑避免零概率。' },
      { criterion: '测试', points: 20, detail: '用新样本测试并记录结果。' },
      { criterion: '反思', points: 20, detail: '能说清独立性假设的含义与局限。' },
    ],
    starterFiles: [
      { path: 'README.md', content: '# 朴素贝叶斯短信过滤器\n\n`messages.csv` 里有带标签的短信（spam = 垃圾，ham = 正常）。完成 `filter.py` 中的 TODO，然后运行 `python filter.py`。\n' },
      { path: 'messages.csv', content: 'label,text\nspam,恭喜 您 中奖 了 点击 领取\nspam,免费 领取 话费 点击 链接\nspam,限时 优惠 贷款 秒 到账\nspam,中奖 通知 请 回复 领取\nham,今晚 一起 吃饭 吗\nham,明天 的 会议 改到 下午\nham,记得 带 伞 要 下雨\nham,作业 写完 了 吗\nham,周末 一起 去 爬山\nspam,点击 链接 领取 优惠\n' },
      { path: 'filter.py', content: 'import csv\nimport math\nfrom collections import Counter\n\nrows = list(csv.DictReader(open("messages.csv", encoding="utf-8")))\n\n# TODO 1：分别统计 spam 和 ham 中每个词出现的次数\nspam_words, ham_words = Counter(), Counter()\n\n# TODO 2：计算先验 P(spam) 和 P(ham)\np_spam = None\np_ham = None\n\ndef score(text):\n    """返回 log P(spam|text) - log P(ham|text)。大于 0 判为垃圾短信。"""\n    # TODO 3：对每个词累加 log 似然，记得做拉普拉斯平滑（每个词的计数 +1）\n    return 0.0\n\nfor text in ["恭喜 中奖 点击 领取", "明天 一起 吃饭"]:\n    print(text, "->", "垃圾" if score(text) > 0 else "正常")\n' },
    ],
  }],
}

const BAYES_BOARDS = {
  '条件概率：知道一点之后': [
    { say: '你掷了一颗骰子，朋友偷看了一眼，告诉你：是偶数。现在，它是 6 的概率是多少？', ops: [{ t: 'title', text: '条件概率：知道一点之后' }, { t: 'h', text: '一个小谜题' }, { t: 'p', text: '掷骰子 → 朋友说“是偶数” → 是 6 的概率？' }] },
    { say: '没有任何信息时，6 的概率是六分之一。但“偶数”这个信息，把可能的结果缩小到了 2、4、6 三种。', ops: [{ t: 'table', head: ['点数', '1', '2', '3', '4', '5', '6'], rows: [['偶数？', '✗', '✓', '✗', '✓', '✗', '✓']] }, { t: 'p', text: '新的“世界”只剩下 ==$\\{2, 4, 6\\}$==' }] },
    { say: '在这个新世界里，6 只是三种可能之一，所以答案是三分之一。条件概率的本质就是：在新信息划定的小世界里，重新数一遍。', ops: [{ t: 'math', tex: 'P(6\\mid \\text{偶数})=\\frac{1}{3}', text: 'P(6 | 偶数) = 1/3' }, { t: 'note', tone: 'key', text: '条件概率 = 在缩小后的世界里重新计算' }], check: { kind: 'choice', prompt: '掷一颗骰子，已知点数大于 3，点数是 5 的概率是？', options: ['1/3', '1/6', '1/2', '2/3'], answer: 0, explanation: '大于 3 的结果是 {4, 5, 6}，其中 5 占一种，概率为 1/3。', concepts: ['条件概率'] } },
    { say: '把它写成公式：在 B 发生的条件下 A 的概率，等于 A 和 B 同时发生的概率，除以 B 的概率。分母是新世界的大小，分子是新世界里我们关心的那部分。', ops: [{ t: 'col' }, { t: 'h', text: '条件概率公式' }, { t: 'math', id: 'cond', tex: 'P(A\\mid B)=\\frac{P(A\\cap B)}{P(B)}', text: 'P(A|B) = P(A∩B) / P(B)' }, { t: 'list', items: ['分母：新世界有多大', '分子：新世界里我们关心的部分'] }] },
    { say: '用一个班级的人数表来感受一下。一个班 100 人，40 人戴眼镜。戴眼镜的人里有 10 个左撇子，不戴眼镜的 60 人里有 6 个左撇子。', ops: [{ t: 'page', title: '用人数来想' }, { t: 'table', head: ['', '左撇子', '右撇子', '合计'], rows: [['戴眼镜', '10', '30', '40'], ['不戴眼镜', '6', '54', '60'], ['合计', '16', '84', '100']] }] },
    { say: '随机挑一个左撇子，他戴眼镜的概率是多少？新世界是 16 个左撇子，其中 10 个戴眼镜，所以是 16 分之 10，也就是 62.5%。', ops: [{ t: 'math', tex: 'P(\\text{戴眼镜}\\mid\\text{左撇子})=\\frac{10}{16}=62.5\\%', text: 'P(戴眼镜 | 左撇子) = 10/16 = 62.5%' }], check: { kind: 'number', prompt: '从这个班随机挑一个**戴眼镜**的人，他是左撇子的概率是多少？（填小数）', answer: 0.25, tolerance: 0.005, explanation: '新世界是 40 个戴眼镜的人，其中 10 个是左撇子：10/40 = 0.25。', concepts: ['条件概率'] } },
    { say: '注意：戴眼镜的人里左撇子的比例只有 25%，而左撇子里戴眼镜的比例却有 62.5%。这两个方向完全不是一回事。把它们搞混，是生活中最常见的概率错误之一。', ops: [{ t: 'col' }, { t: 'note', tone: 'warn', text: '$P(A\\mid B) \\neq P(B\\mid A)$！' }, { t: 'chart', kind: 'bar', title: '方向不同，结果不同', yLabel: '%', data: [{ label: 'P(左撇子|戴眼镜)', value: 25 }, { label: 'P(戴眼镜|左撇子)', value: 62.5 }] }] },
    { say: '总结一下：条件概率就是在新信息划出的小世界里重新计算；公式是交集除以条件；而两个方向的条件概率，千万不要混为一谈。下一讲，我们看看什么时候一个信息完全不影响另一个事件。', ops: [{ t: 'note', tone: 'key', text: '① 新信息 → 世界变小 → 重新数\n② $P(A\\mid B)=P(A\\cap B)/P(B)$\n③ 分清方向：$P(A\\mid B)$ 与 $P(B\\mid A)$' }], check: { kind: 'choice', prompt: '“大多数小偷都是男性”，能推出“大多数男性都是小偷”吗？', options: ['不能，P(男 | 小偷) 和 P(小偷 | 男) 是两回事', '能，两个说法是等价的', '只有在人口足够多时才能', '取决于调查的样本量'], answer: 0, explanation: '前者在“小偷”的世界里看男性比例，后者在“男性”的世界里看小偷比例，分母完全不同。', concepts: ['P(A|B) 与 P(B|A)'] } },
  ],
  '医学检测悖论：基础比率的力量': [
    { say: '某种病的发病率是千分之一。有一种检测，病人去测，99% 会显示阳性；健康人去测，只有 1% 会被误报成阳性。现在你测出了阳性。你真正得病的概率有多大？先凭直觉猜一猜。', ops: [{ t: 'title', text: '医学检测悖论' }, { t: 'h', text: '你会怎么猜？' }, { t: 'list', items: ['发病率：1/1000', '病人测出阳性：99%', '健康人被误报阳性：1%'] }], check: { kind: 'choice', prompt: '凭直觉猜：测出阳性后，真正患病的概率大约是？', options: ['约 99%', '约 50%', '约 9%', '约 1%'], answer: 2, explanation: '正确答案约 9%。猜错很正常，接下来我们一起算出来。', concepts: ['基础比率'] } },
    { say: '别急着套公式，我们把概率变成人数。想象有 10 万人来做这个检测。按千分之一的发病率，其中有 100 个病人，99900 个健康人。', ops: [{ t: 'h', text: '用 10 万人来想' }, { t: 'p', text: '患病：**100** 人　　健康：**99,900** 人' }] },
    { say: '100 个病人里，99 个会测出阳性。99900 个健康人里，有 1%，也就是 999 人被误报成阳性。', ops: [{ t: 'table', head: ['', '阳性', '阴性', '合计'], rows: [['患病', '99', '1', '100'], ['健康', '999', '98,901', '99,900'], ['合计', '1,098', '98,902', '100,000']] }] },
    { say: '现在，你是这 1098 个阳性中的一员。其中真正患病的只有 99 人，大约只占 9%。剩下的九成多，都是虚惊一场。', ops: [{ t: 'col' }, { t: 'math', tex: 'P(\\text{患病}\\mid\\text{阳性})=\\frac{99}{1098}\\approx 9\\%', text: 'P(患病 | 阳性) = 99/1098 ≈ 9%' }, { t: 'chart', kind: 'pie', title: '阳性的 1098 人', data: [{ label: '真阳性', value: 99 }, { label: '假阳性', value: 999 }] }] },
    { say: '为什么直觉会错得这么离谱？因为健康人实在太多了。即使只有 1% 的误报，人数也远远超过了真正的病人。这叫基础比率，也是我们最容易忽略的东西。', ops: [{ t: 'h', text: '基础比率' }, { t: 'note', tone: 'warn', text: '忽略发病率 → 被大量的误报淹没' }] },
    { say: '把刚才的推理写成公式，就是著名的贝叶斯公式。分子是“真阳性”的那部分，分母是所有阳性的人。', ops: [{ t: 'page', title: '贝叶斯公式' }, { t: 'math', id: 'bayes', tex: 'P(D\\mid +)=\\frac{P(+\\mid D)\\,P(D)}{P(+\\mid D)\\,P(D)+P(+\\mid \\bar D)\\,P(\\bar D)}', text: 'P(D|+) = P(+|D)P(D) / [P(+|D)P(D) + P(+|¬D)P(¬D)]' }, { t: 'list', items: ['$P(D)$：先验，检测之前的患病概率', '$P(+\\mid D)$：似然，病人测出阳性的概率', '$P(D\\mid +)$：后验，看到阳性之后的患病概率'] }], check: { kind: 'number', prompt: '如果发病率提高到 1/100（其他条件不变），阳性者真正患病的概率约是百分之多少？（填数字，例如 50）', answer: 50, tolerance: 1, explanation: '$0.01\\times0.99 \\div (0.01\\times0.99+0.99\\times0.01) = 50\\%$。基础比率一变，结论就大不相同。', concepts: ['贝叶斯公式', '基础比率'] } },
    { say: '这也是医生常常让你复查的原因。第一次阳性后，你的患病概率已经从千分之一升到了 9%。把 9% 当成新的先验再测一次，如果还是阳性，患病概率就会跳到九成以上。', ops: [{ t: 'col' }, { t: 'h', text: '复查的力量' }, { t: 'chart', kind: 'bar', title: '每一次证据都在更新判断', yLabel: '患病概率 %', data: [{ label: '检测前', value: 0.1 }, { label: '一次阳性', value: 9 }, { label: '两次阳性', value: 90.7 }] }] },
    { say: '总结一下：判断一个结果意味着什么，先问它的基础比率；贝叶斯公式就是“真阳性除以所有阳性”；而每一次新的证据，都会让后验变成下一次的先验。', ops: [{ t: 'note', tone: 'key', text: '① 先问基础比率\n② 后验 = 真阳性 ÷ 所有阳性\n③ 今天的后验 = 明天的先验' }], check: { kind: 'choice', prompt: '在贝叶斯公式里，“后验概率”指的是？', options: ['看到证据之后，对假设成立的概率', '看到证据之前的概率', '证据本身出现的概率', '检测的准确率'], answer: 0, explanation: '后验是结合了新证据之后的判断。', concepts: ['贝叶斯公式'] } },
  ],
}

const BAYES_PRACTICE = {
  '条件概率：知道一点之后': [
    { kind: 'choice', prompt: '掷一颗骰子，已知点数是奇数，点数小于 3 的概率是？', options: ['1/3', '1/2', '1/6', '2/3'], answer: 0, hints: ['奇数的世界里有哪几个点数？'], explanation: '奇数为 {1, 3, 5}，其中小于 3 的只有 1，概率 1/3。', difficulty: 1, concepts: ['条件概率'] },
    { kind: 'number', prompt: '已知 $P(A\\cap B) = 0.12$，$P(B) = 0.4$，求 $P(A\\mid B)$。（填小数）', answer: 0.3, tolerance: 0.001, hints: ['直接用条件概率公式'], explanation: '$0.12 / 0.4 = 0.3$。', difficulty: 1, concepts: ['条件概率'] },
    { kind: 'choice', prompt: '下面哪个推理把 $P(A\\mid B)$ 和 $P(B\\mid A)$ 搞混了？', options: ['“大部分车祸发生在离家 5 公里内，所以家附近的路最危险”', '“骰子是偶数时，是 6 的概率为 1/3”', '“袋子里红球多，摸到红球的可能更大”', '“连续两次掷硬币都是正面的概率是 1/4”'], answer: 0, hints: ['人们大部分时间就在家附近开车'], explanation: '“车祸里离家近的比例高”不等于“离家近时发生车祸的概率高”，因为大部分驾驶本来就发生在家附近。', difficulty: 2, concepts: ['P(A|B) 与 P(B|A)'] },
    { kind: 'blank', prompt: '条件概率公式：$P(A\\mid B) = P(A\\cap B)\\,/$ ____', answer: ['P(B)', 'p(b)', 'P（B）'], explanation: '分母是条件 $B$ 的概率，也就是“新世界”的大小。', difficulty: 1, concepts: ['条件概率'] },
    { kind: 'short', prompt: '举一个生活中的例子，说明 $P(A\\mid B)$ 和 $P(B\\mid A)$ 可以相差很大。', answer: '例如：P(会游泳 | 是游泳运动员) 接近 100%，但 P(是游泳运动员 | 会游泳) 很小，因为会游泳的人里只有极少数是运动员。', rubric: ['给出具体例子', '正确写出两个方向的条件概率', '解释差别来自“新世界”（分母）不同'], explanation: '两个方向的条件概率，所在的“世界”不同。', difficulty: 2, concepts: ['P(A|B) 与 P(B|A)'] },
  ],
  '医学检测悖论：基础比率的力量': [
    { kind: 'number', prompt: '发病率 1/1000，病人测阳性率 99%，健康人误报率 1%。10 万人中，假阳性大约有多少人？', answer: 999, tolerance: 1, hints: ['先算健康人有多少'], explanation: '健康人 99,900，乘以 1% 约 999 人。', difficulty: 1, concepts: ['基础比率'] },
    { kind: 'choice', prompt: '对于发病率很低的病，改进检测的哪一项，最能让“阳性就是患病”更可信？', options: ['降低健康人的误报率', '提高病人的检出率', '增加参与检测的人数', '延长每次检测的时间'], answer: 0, hints: ['阳性里大部分是谁？'], explanation: '低发病率时，阳性大多来自健康人的误报，降低误报率最关键。', difficulty: 2, concepts: ['基础比率'] },
    { kind: 'number', prompt: '发病率 2%，检出率 90%，误报率 5%。阳性者真正患病的概率约是多少？（填小数，保留两位）', answer: 0.2687, tolerance: 0.01, hints: ['分子：0.02 × 0.9；分母：再加上 0.98 × 0.05'], explanation: '$0.018 \\div (0.018 + 0.049) \\approx 0.27$。', difficulty: 2, concepts: ['贝叶斯公式'] },
    { kind: 'choice', prompt: '贝叶斯公式中，$P(D)$ 叫做？', options: ['先验概率', '后验概率', '似然', '误报率'], answer: 0, explanation: '$P(D)$ 是看到证据之前的概率，即先验。', difficulty: 1, concepts: ['贝叶斯公式'] },
    { kind: 'short', prompt: '为什么医生在一次阳性之后常会安排复查？请用“先验”和“后验”来解释。', answer: '一次阳性后，患病的后验概率从很低升到较高（如从 0.1% 到约 9%）；复查时这个后验成为新的先验，若再次阳性，患病概率会大幅提高（约 91%），判断更可靠。', rubric: ['指出第一次阳性后概率上升（后验）', '指出这个后验成为复查时的先验', '说明两次阳性后结论更可信'], explanation: '证据会不断累积：昨天的后验就是今天的先验。', difficulty: 3, concepts: ['贝叶斯公式', '基础比率'] },
  ],
}

// ── assembly ────────────────────────────────────────────────────────────────

function conceptIdsByName(lesson) {
  return Object.fromEntries(lesson.concepts.map(concept => [concept.name, concept.id]))
}

function attachConcepts(item, lesson) {
  const ids = conceptIdsByName(lesson)
  const conceptIds = (item.concepts ?? []).map(name => ids[name]).filter(Boolean)
  if (item.concepts?.length && conceptIds.length !== item.concepts.length) throw new Error(`unknown concept in "${lesson.title}": ${item.concepts.join(', ')}`)
  const { concepts, ...rest } = item
  return { ...rest, conceptIds }
}

function build({ file, blueprint, boards, practice }) {
  const normalized = normalizeBlueprint(blueprint, { language: blueprint.language })
  normalized.projects = normalized.projects.map(project => ({ ...project, unitId: normalized.units[1].id }))
  const course = { id: 'crs_sample000', ...normalized, goal: blueprint.summary }
  const rows = flattenLessons(course)
  const byTitle = title => {
    const row = rows.find(entry => entry.lesson.title === title)
    if (!row) throw new Error(`no lesson titled ${title}`)
    return row.lesson
  }
  const packBoards = {}
  for (const [title, steps] of Object.entries(boards)) {
    const lesson = byTitle(title)
    const raw = steps.map(step => (step.check ? { ...step, check: attachConcepts(step.check, lesson) } : step))
    const board = normalizeBoard({ title, steps: raw }, { conceptIds: lesson.concepts.map(concept => concept.id) })
    if (board.steps.length !== steps.length) throw new Error(`a step of "${title}" was dropped by normalization`)
    for (const [index, step] of board.steps.entries()) {
      if (steps[index].check && !step.check) throw new Error(`a check of "${title}" step ${index + 1} was dropped`)
      if (step.ops.length !== steps[index].ops.length) throw new Error(`an op of "${title}" step ${index + 1} was dropped`)
    }
    packBoards[lesson.id] = { ...board, lessonId: lesson.id }
  }
  const packPractice = {}
  for (const [title, items] of Object.entries(practice)) {
    const lesson = byTitle(title)
    const set = normalizePractice({ items: items.map(item => attachConcepts(item, lesson)) }, lesson.concepts.map(concept => concept.id))
    if (set.items.length !== items.length) throw new Error(`a practice item of "${title}" was dropped`)
    packPractice[lesson.id] = { lessonId: lesson.id, ...set }
  }
  const pack = exportCoursePack({ course, boards: packBoards, practice: packPractice }, { app: { name: 'dsh-aha-tutor', version: 'sample' } })
  const dir = fileURLToPath(new URL('../samples/', import.meta.url))
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}${file}.aha-course.json`, `${JSON.stringify(pack, null, 1)}\n`)
  console.log(`samples/${file}.aha-course.json: ${rows.length} lessons, ${Object.keys(packBoards).length} boards, ${Object.keys(packPractice).length} practice sets`)
}

build({ file: 'harmonic-motion', blueprint: SHM_BLUEPRINT, boards: SHM_BOARDS, practice: SHM_PRACTICE })
build({ file: 'bayes-thinking', blueprint: BAYES_BLUEPRINT, boards: BAYES_BOARDS, practice: BAYES_PRACTICE })
void conceptRef
