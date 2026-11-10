// Lesson player UI: Story -> Think First -> Build -> Test -> Debrief -> Compare -> Quiz

import { useState, useCallback } from 'react'
import { ChevronRight, ChevronLeft, CheckCircle, XCircle, BookOpen, Zap, Trophy, HelpCircle, Target, Lightbulb } from 'lucide-react'
import { LESSONS, getLesson, runCheckpoint, type Lesson, type Checkpoint } from '../../engine/lessons/runner'
import { fmtMs, fmtNum } from '../lib/format'

type Step = 'story' | 'think' | 'build' | 'test' | 'debrief' | 'compare' | 'quiz'

const STEPS: { id: Step; label: string; icon: any }[] = [
  { id: 'story', label: 'Story', icon: BookOpen },
  { id: 'think', label: 'Think First', icon: Lightbulb },
  { id: 'build', label: 'Build', icon: Zap },
  { id: 'test', label: 'Test', icon: Target },
  { id: 'debrief', label: 'Debrief', icon: HelpCircle },
  { id: 'compare', label: 'Compare', icon: Trophy },
  { id: 'quiz', label: 'Quiz', icon: CheckCircle },
]

export function LessonPlayer({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('story')
  const [thinkAnswers, setThinkAnswers] = useState<Record<string, string>>({})
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({})
  const [testResults, setTestResults] = useState<{ checkpoint: Checkpoint; passed: boolean; results: any[] }[]>([])
  const [currentCheckpoint, setCurrentCheckpoint] = useState(0)
  const [runningTest, setRunningTest] = useState(false)

  const lesson = getLesson(LESSONS[0]?.id ?? '')
  if (!lesson) return null
  const stepIndex = STEPS.findIndex((s) => s.id === step)

  const nextStep = () => {
    if (stepIndex < STEPS.length - 1) {
      const next = STEPS[stepIndex + 1]
      if (next) setStep(next.id)
    }
  }
  const prevStep = () => {
    if (stepIndex > 0) {
      const prev = STEPS[stepIndex - 1]
      if (prev) setStep(prev.id)
    }
  }

  const runTests = useCallback(async () => {
    setRunningTest(true)
    const results: { checkpoint: Checkpoint; passed: boolean; results: any[] }[] = []
    for (let i = 0; i < lesson.checkpoints.length; i++) {
      setCurrentCheckpoint(i)
      const cp = lesson.checkpoints[i]
      if (!cp) continue
      const res = await runCheckpoint(lesson, cp)
      results.push({ checkpoint: cp, passed: res.passed, results: res.results })
    }
    setTestResults(results)
    setRunningTest(false)
    setStep('debrief')
  }, [lesson])

  const renderStep = () => {
    switch (step) {
      case 'story':
        return <StoryStep lesson={lesson} />
      case 'think':
        return <ThinkStep lesson={lesson} answers={thinkAnswers} onChange={setThinkAnswers} />
      case 'build':
        return <BuildStep lesson={lesson} onStartTest={runTests} />
      case 'test':
        return <TestStep lesson={lesson} results={testResults} current={currentCheckpoint} running={runningTest} onRun={runTests} />
      case 'debrief':
        return <DebriefStep lesson={lesson} results={testResults} />
      case 'compare':
        return <CompareStep lesson={lesson} />
      case 'quiz':
        return <QuizStep lesson={lesson} answers={quizAnswers} onChange={setQuizAnswers} />
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#080b11] text-slate-100">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/[0.07] bg-[#0a0e15] px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/[0.06] transition-colors">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <div>
            <div className="text-[14px] font-semibold">{lesson.title}</div>
            <div className="text-[11px] text-slate-500 capitalize">{lesson.difficulty}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setStep(s.id)}
              disabled={i > stepIndex + 1 && step !== 'quiz'}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-colors ${
                i === stepIndex
                  ? 'bg-sky-400/20 text-sky-200 ring-1 ring-sky-400/30'
                  : i <= stepIndex
                    ? 'bg-emerald-400/15 text-emerald-200'
                    : 'bg-white/[0.02] text-slate-500 hover:bg-white/[0.06]'
              }`}
            >
              <s.icon size={11} />
              {s.label}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto">{renderStep()}</div>
      </main>

      {/* Footer navigation */}
      <footer className="flex shrink-0 items-center justify-between border-t border-white/[0.07] bg-[#0a0e15] px-4 py-3">
        <button
          onClick={prevStep}
          disabled={stepIndex === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
        >
          <ChevronLeft size={13} /> Back
        </button>
        <div className="text-[11px] text-slate-500">
          Step {stepIndex + 1} of {STEPS.length}
        </div>
        <button
          onClick={nextStep}
          disabled={stepIndex === STEPS.length - 1}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed bg-sky-400/15 text-sky-200 ring-1 ring-sky-400/30 hover:bg-sky-400/25"
        >
          Next <ChevronRight size={13} />
        </button>
      </footer>
    </div>
  )
}

function StoryStep({ lesson }: { lesson: Lesson }) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-3">Scenario</div>
        <div className="prose prose-invert max-w-none text-slate-300 whitespace-pre-wrap">{lesson.story}</div>
      </div>
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-6">
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-3">Requirements</div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-[11px] text-slate-500 mb-2">Functional</div>
            <ul className="space-y-1 text-[12px] text-slate-300">
              {lesson.requirements.functional.map((f: string, i: number) => (
                <li key={i} className="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-emerald-400 shrink-0">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 mb-2">Traffic & Targets</div>
            <ul className="space-y-2 text-[12px] text-slate-300">
              <li className="flex justify-between"><span>Reads/sec</span><span className="font-mono text-sky-200">{fmtNum(lesson.requirements.traffic.readsPerSec)}</span></li>
              <li className="flex justify-between"><span>Writes/sec</span><span className="font-mono text-amber-200">{fmtNum(lesson.requirements.traffic.writesPerSec)}</span></li>
              <li className="flex justify-between"><span>p99 target</span><span className="font-mono text-emerald-200">{fmtMs(lesson.requirements.targets.p99LatencyMs)}</span></li>
              <li className="flex justify-between"><span>Availability</span><span className="font-mono text-slate-200">{lesson.requirements.targets.availability}</span></li>
            </ul>
          </div>
        </div>
      </div>
      <div className="rounded-xl border border-sky-400/30 bg-sky-400/5 p-4">
        <div className="flex items-start gap-3">
          <Lightbulb size={16} className="text-sky-300 shrink-0 mt-0.5" />
          <div className="text-[12px] text-sky-200">
            <strong>Allowed components:</strong> {lesson.allowedComponents.join(', ')}
          </div>
        </div>
      </div>
    </div>
  )
}

function ThinkStep({ lesson, answers, onChange }: { lesson: Lesson; answers: Record<string, string>; onChange: (a: Record<string, string>) => void }) {
  return (
    <div className="space-y-6">
      <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-3">Think First</div>
      <div className="text-[12px] text-slate-400 mb-6">
        Before building, answer these questions. They're designed to surface your mental model — there are no wrong answers here.
      </div>
      <div className="space-y-4">
        {lesson.thinkFirstQuestions.map((q: { q: string; hint?: string; answerNotes: string }, i: number) => (
          <div key={i} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5">
            <div className="flex items-start gap-3 mb-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-400/20 text-sky-300 font-bold text-[13px]">{i + 1}</span>
              <div className="text-[13px] font-semibold text-slate-100">{q.q}</div>
            </div>
            <textarea
              value={answers[i] || ''}
              onChange={(e) => onChange({ ...answers, [i]: e.target.value })}
              placeholder="Your answer..."
              rows={3}
              className="w-full rounded-lg border border-white/[0.1] bg-[#080b11] px-3 py-2 text-[12px] text-slate-200 placeholder-slate-600 focus:ring-1 focus:ring-sky-400/30 focus:border-transparent outline-none resize-none"
            />
            {q.hint && (
              <button
                onClick={() => alert(q.hint)}
                className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300"
              >
                <HelpCircle size={11} /> Show hint
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5">
        <div className="text-[12px] font-semibold text-slate-300 mb-3">Answer Notes (revealed after Test phase)</div>
        <div className="space-y-2 text-[12px] text-slate-500">
          {lesson.thinkFirstQuestions.map((q: { q: string; hint?: string; answerNotes: string }, i: number) => (
            <div key={i} className="text-sm opacity-50">
              <strong>Q{i + 1}:</strong> {q.answerNotes}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function BuildStep({ lesson, onStartTest }: { lesson: Lesson; onStartTest: () => void }) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-6">
        <div className="flex items-center gap-3 mb-4">
          <Zap size={20} className="text-amber-300" />
          <div>
            <div className="text-[14px] font-semibold">Build Your Topology</div>
            <div className="text-[11px] text-slate-500">Use the canvas to design a system that meets the requirements.</div>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {lesson.allowedComponents.map((kind: string) => (
            <button
              key={kind}
              className="text-left rounded-lg border border-white/[0.07] bg-white/[0.02] p-4 hover:border-white/15 hover:bg-white/[0.05] transition-colors"
            >
              <div className="font-medium text-slate-100 capitalize">{kind}</div>
              <div className="text-[11px] text-slate-500 mt-1">Drag to canvas</div>
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-5">
        <div className="flex items-center gap-3">
          <CheckCircle size={20} className="text-emerald-300" />
          <div className="text-[13px] font-semibold text-emerald-200">Ready to test?</div>
        </div>
        <div className="mt-2 text-[12px] text-slate-400">Your topology will be tested against the checkpoints.</div>
      </div>
      <button
        onClick={onStartTest}
        className="w-full rounded-lg bg-emerald-400/15 px-4 py-3 text-center text-[14px] font-semibold text-emerald-200 ring-1 ring-emerald-400/30 hover:bg-emerald-400/25 transition-colors"
      >
        Run Checkpoints
      </button>
    </div>
  )
}

function TestStep({ lesson, results, current, running, onRun }: { lesson: Lesson; results: any[]; current: number; running: boolean; onRun: () => void }) {
  if (!running && results.length === 0) {
    return (
      <div className="text-center py-12">
        <Target size={48} className="mx-auto text-slate-500 mb-4" />
        <div className="text-[14px] font-semibold text-slate-300 mb-2">Run Checkpoints</div>
        <div className="text-[12px] text-slate-500 mb-6 max-w-md mx-auto">
          Each checkpoint tests your topology against a specific scenario. All must pass to complete the lesson.
        </div>
        <button onClick={onRun} className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-sky-400/15 text-sky-200 ring-1 ring-sky-400/30 hover:bg-sky-400/25 transition-colors">
          <Target size={16} /> Start Testing
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-semibold">Checkpoints</div>
        {running && (
          <div className="flex items-center gap-2 text-[11px] text-amber-300">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            Running checkpoint {current + 1} of {lesson.checkpoints.length}...
          </div>
        )}
      </div>
      <div className="space-y-2">
        {lesson.checkpoints.map((_cp: Checkpoint, i: number) => {
          const cp = lesson.checkpoints[i]!
          const res = results[i]
          const isCurrent = i === current && running
          const isDone = !!res
          return (
            <div
              key={i}
              className={`flex items-center justify-between rounded-lg p-4 transition-colors ${
                isCurrent
                  ? 'bg-sky-400/10 ring-1 ring-sky-400/30'
                  : isDone
                    ? res.passed
                      ? 'bg-emerald-400/10 ring-1 ring-emerald-400/30'
                      : 'bg-rose-400/10 ring-1 ring-rose-400/30'
                    : 'bg-white/[0.02] border border-white/[0.07]'
              }`}
            >
              <div className="flex items-center gap-3">
                {isCurrent && <svg className="animate-spin h-5 w-5 text-sky-300" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>}
                {isDone && res.passed && <CheckCircle size={18} className="text-emerald-300" />}
                {isDone && !res.passed && <XCircle size={18} className="text-rose-300" />}
                <span className="font-medium text-slate-100">{cp.name}</span>
              </div>
              {isDone && (
                <div className="flex items-center gap-2 text-[11px]">
                  {res.results.map((r: any) => (
                    <span key={r.assertion.metric} className={`px-2 py-0.5 rounded text-[10px] font-mono ${r.passed ? 'bg-emerald-400/20 text-emerald-300' : 'bg-rose-400/20 text-rose-300'}`}>
                      {r.assertion.metric}: {r.actual.toFixed(2)} {r.assertion.op} {r.assertion.value} {'✓'}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {results.length > 0 && results.every((r) => r.passed) && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-5 text-center">
          <Trophy size={32} className="mx-auto text-emerald-300 mb-2" />
          <div className="text-[14px] font-semibold text-emerald-200">All Checkpoints Passed!</div>
          <div className="text-[12px] text-slate-400 mt-1">Your topology meets all requirements.</div>
        </div>
      )}
    </div>
  )
}

function DebriefStep({ lesson, results }: { lesson: Lesson; results: any[] }) {
  const allPassed = results.length > 0 && results.every((r) => r.passed)
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-6">
        <div className="flex items-center gap-3 mb-4">
          <HelpCircle size={20} className={allPassed ? 'text-emerald-300' : 'text-amber-300'} />
          <div>
            <div className="text-[14px] font-semibold">Debrief</div>
            <div className="text-[11px] text-slate-500">{allPassed ? 'All checkpoints passed. Here\'s what happened.' : 'Some checkpoints failed. Let\'s analyze.'}</div>
          </div>
        </div>
        <div className="prose prose-invert max-w-none text-slate-300 text-[12px]">
          <h4 className="text-slate-100 mb-2">Key Takeaways</h4>
          <ul className="list-disc list-inside space-y-1">
            {lesson.hints.map((h: string, i: number) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </div>
      </div>
      {results.length > 0 && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5">
          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-3">Checkpoint Details</div>
          <div className="space-y-2">
            {results.map((r: any, i: number) => (
              <div key={i} className={`rounded-lg p-3 ${r.passed ? 'bg-emerald-400/10' : 'bg-rose-400/10'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-100">{lesson.checkpoints[i]?.name ?? 'Unknown'}</span>
                  <span className={`font-mono text-[11px] ${r.passed ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {r.passed ? 'PASSED' : 'FAILED'}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {r.results.map((ar: any) => (
                    <span key={ar.assertion.metric} className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${ar.passed ? 'bg-emerald-400/20 text-emerald-300' : 'bg-rose-400/20 text-rose-300'}`}>
                      {ar.assertion.metric}: {ar.actual.toFixed(2)} {ar.assertion.op} {ar.assertion.value}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CompareStep({ lesson }: { lesson: Lesson }) {
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-6">
        <div className="flex items-center gap-3 mb-4">
          <Trophy size={20} className="text-amber-300" />
          <div>
            <div className="text-[14px] font-semibold">Compare with Reference</div>
            <div className="text-[11px] text-slate-500">The reference solution uses these components:</div>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(lesson.referenceSolution).filter(([k]) => k !== 'name' && k !== 'edges' && k !== 'seed' && k !== 'latencyTargetMs').map(([k, v]: [string, any]) => (
            <div key={k} className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{k}</div>
              <pre className="mt-1 text-[10px] text-slate-400 overflow-auto max-h-48">{JSON.stringify(v, null, 2)}</pre>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-sky-400/30 bg-sky-400/5 p-5">
        <div className="flex items-center gap-3">
          <Zap size={20} className="text-sky-300" />
          <div className="text-[13px] font-semibold text-sky-200">Load reference solution</div>
        </div>
        <div className="mt-2 text-[12px] text-slate-400">Click to load the reference topology on the main canvas for comparison.</div>
      </div>
    </div>
  )
}

function QuizStep({ lesson, answers, onChange }: { lesson: Lesson; answers: Record<number, number>; onChange: (a: Record<number, number>) => void }) {
  const score = lesson.quiz.filter((q, i) => answers[i] === q.answerIndex).length
  const completed = Object.keys(answers).length === lesson.quiz.length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[14px] font-semibold">Quiz</div>
          <div className="text-[11px] text-slate-500">{completed ? `Score: ${score}/${lesson.quiz.length}` : `${Object.keys(answers).length}/${lesson.quiz.length} answered`}</div>
        </div>
        {completed && score === lesson.quiz.length && (
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-400/30 text-[11px] font-semibold">
            <CheckCircle size={11} /> Perfect!
          </div>
        )}
      </div>
      <div className="space-y-4">
        {lesson.quiz.map((q: { q: string; options: string[]; answerIndex: number; explanation: string }, i: number) => (
          <div key={i} className={`rounded-xl p-5 transition-colors ${answers[i] !== undefined ? (answers[i] === q.answerIndex ? 'bg-emerald-400/10 ring-1 ring-emerald-400/30' : 'bg-rose-400/10 ring-1 ring-rose-400/30') : 'bg-white/[0.02] border border-white/[0.07]'}`}>
            <div className="text-[12px] font-semibold text-slate-100 mb-3">{q.q}</div>
            <div className="space-y-2">
              {q.options.map((opt: string, oi: number) => (
                <button
                  key={oi}
                  onClick={() => onChange({ ...answers, [i]: oi })}
                  className={`w-full text-left rounded-lg p-3 text-[12px] transition-colors flex items-center gap-3 ${
                    answers[i] === oi
                      ? (answers[i] === q.answerIndex ? 'bg-emerald-400/20 text-emerald-200 ring-1 ring-emerald-400/30' : 'bg-rose-400/20 text-rose-200 ring-1 ring-rose-400/30')
                      : 'bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]'
                  }`}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/20 text-[11px] font-medium">
                    {String.fromCharCode(65 + oi)}
                  </span>
                  <span>{opt}</span>
                  {answers[i] === oi && answers[i] === q.answerIndex && <CheckCircle size={14} className="text-emerald-300 ml-auto" />}
                  {answers[i] === oi && answers[i] !== q.answerIndex && <XCircle size={14} className="text-rose-300 ml-auto" />}
                </button>
              ))}
            </div>
            {answers[i] !== undefined && (
              <div className={`mt-3 p-3 rounded-lg text-[11px] ${answers[i] === q.answerIndex ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>
                <strong>Explanation:</strong> {q.explanation}
              </div>
            )}
          </div>
        ))}
      </div>
      {completed && (
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-6 text-center">
          <div className="text-[24px] font-bold text-slate-100">{score}/{lesson.quiz.length}</div>
          <div className="text-[12px] text-slate-400 mt-1">{score === lesson.quiz.length ? 'Excellent! You\'ve mastered this lesson.' : 'Review the explanations and try again.'}</div>
        </div>
      )}
    </div>
  )
}