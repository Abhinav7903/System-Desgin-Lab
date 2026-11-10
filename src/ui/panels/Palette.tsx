// Left rail: preset gallery + component palette + design manager + lessons.
// Components are draggable onto the canvas.

import { Check, GraduationCap, FolderOpen, Save, Database, GripVertical } from 'lucide-react'
import { useState } from 'react'
import { PRESETS } from '../../engine/presets'
import { NODE_META } from '../canvas/nodeMeta'
import { useSimStore } from '../../store/simStore'
import type { NodeKind } from '../../engine/core/types'
import { LESSONS } from '../../engine/lessons/runner'
import { DesignManager } from './DesignManager'

const IMPLEMENTED: NodeKind[] = ['client', 'loadbalancer', 'api', 'redis', 'postgres', 'kafka', 'queue', 'mongo', 'cdn', 'ratelimiter']

const PRESET_ICONS: Record<string, string> = {
  'cache-aside': '⚡',
  'no-cache': '🗄️',
  lb: '⚖️',
}

type PaletteTab = 'scenarios' | 'components' | 'designs' | 'lessons'

export const COMPONENT_DRAG_TYPE = 'sysdesign/component'

export function Palette() {
  const presetId = useSimStore((s) => s.presetId)
  const setPreset = useSimStore((s) => s.setPreset)
  const [activeTab, setActiveTab] = useState<PaletteTab>('scenarios')

  const handleDragStart = (e: React.DragEvent, kind: NodeKind) => {
    e.dataTransfer.setData(COMPONENT_DRAG_TYPE, kind)
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-white/[0.07] bg-[#0a0e15]">
      <div className="flex gap-1 px-3 py-2 border-b border-white/[0.06]">
        {(['scenarios', 'components', 'designs', 'lessons'] as PaletteTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] transition-colors ${
              activeTab === tab
                ? 'bg-sky-400/15 text-sky-200 ring-1 ring-sky-400/30'
                : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-300'
            }`}
          >
            {tab === 'scenarios' && <Database size={11} />}
            {tab === 'components' && <Save size={11} />}
            {tab === 'designs' && <FolderOpen size={11} />}
            {tab === 'lessons' && <GraduationCap size={11} />}
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'scenarios' && (
          <div className="space-y-1.5 px-3 pt-3">
            {PRESETS.map((p) => {
              const active = p.id === presetId
              return (
                <button
                  key={p.id}
                  onClick={() => setPreset(p.id)}
                  className={`group w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    active
                      ? 'border-sky-400/40 bg-sky-400/10'
                      : 'border-white/[0.06] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px]">{PRESET_ICONS[p.id] ?? '▦'}</span>
                    <span className={`flex-1 text-[12px] font-semibold ${active ? 'text-sky-200' : 'text-slate-200'}`}>
                      {p.name}
                    </span>
                    {active && <Check size={12} className="text-sky-300" />}
                  </div>
                  <div className="mt-0.5 text-[10px] leading-snug text-slate-500">{p.desc}</div>
                </button>
              )
            })}
          </div>
        )}

        {activeTab === 'components' && (
          <div className="space-y-0.5 overflow-y-auto px-2 pt-3 pb-3">
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Drag onto canvas
            </div>
            {(Object.keys(NODE_META) as NodeKind[]).map((kind) => {
              const meta = NODE_META[kind]
              const ready = IMPLEMENTED.includes(kind)
              const Icon = meta.icon
              return (
                <div
                  key={kind}
                  draggable={ready}
                  onDragStart={(e) => handleDragStart(e, kind)}
                  title={ready ? 'Drag to canvas' : 'Coming soon'}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 cursor-grab active:cursor-grabbing ${
                    ready ? 'text-slate-300 hover:bg-white/[0.04]' : 'text-slate-600 opacity-50'
                  }`}
                >
                  <GripVertical size={13} className="text-slate-500 shrink-0" />
                  <div
                    className="flex h-6 w-6 items-center justify-center rounded-md"
                    style={{ background: ready ? meta.tile : 'rgba(148,163,184,0.05)' }}
                  >
                    <Icon size={13} style={{ color: ready ? meta.accent : '#475569' }} />
                  </div>
                  <span className="flex-1 text-[11.5px]">{meta.kindLabel}</span>
                  {!ready && (
                    <span className="rounded bg-white/[0.04] px-1 py-0.5 text-[8px] uppercase tracking-wide text-slate-600">
                      soon
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {activeTab === 'designs' && (
          <DesignManager />
        )}

        {activeTab === 'lessons' && (
          <div className="space-y-1.5 px-3 pt-3">
            {LESSONS.map((l) => (
              <button
                key={l.id}
                onClick={() => useSimStore.getState().startLesson(l.id)}
                className="group w-full rounded-lg border px-3 py-2 text-left transition-colors hover:border-white/15 hover:bg-white/[0.05]"
              >
                <div className="flex items-center gap-2">
                  <GraduationCap size={13} className="text-amber-300" />
                  <span className="flex-1 text-[12px] font-semibold text-slate-200">{l.title}</span>
                  <span className={`rounded bg-white/[0.04] px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-slate-500 capitalize`}>
                    {l.difficulty}
                  </span>
                </div>
                <div className="mt-0.5 text-[10px] leading-snug text-slate-500">{l.story.split('.')[0]}.</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-white/[0.06] px-4 py-3 text-[10px] leading-relaxed text-slate-600">
        Click a node to inspect it. Drag components from the <strong>Components</strong> tab onto the canvas.
        Press <kbd className="rounded bg-white/[0.06] px-1 text-slate-400">Space</kbd> to run or pause.
      </div>
    </aside>
  )
}
