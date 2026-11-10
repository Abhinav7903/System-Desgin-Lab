// App shell: top bar, palette, canvas + fate dock, inspector.

import { useEffect } from 'react'
import { TopBar } from './controls/TopBar'
import { Palette } from './panels/Palette'
import { SimCanvas } from './canvas/SimCanvas'
import { Inspector } from './panels/Inspector'
import { GlobalStrip } from './panels/GlobalStrip'
import { LessonPlayer } from './lessons/LessonPlayer'
import { sendUi, startWorker } from './workerClient'
import { useSimStore } from '../store/simStore'

export default function App() {
  const lessonOpen = useSimStore((s) => s.lessonOpen)

  useEffect(() => {
    const store = useSimStore.getState()
    startWorker({
      onSnapshot: (g, nodes) => useSimStore.getState().applySnapshot(g, nodes),
      onReady: () => useSimStore.getState().markConnected(),
      onError: (m) => console.error('[sim worker]', m),
    })
    sendUi({ type: 'init', graph: store.graph })
    sendUi({ type: 'speed', speed: store.speed })
    // Start live immediately: the lab should feel alive on open.
    sendUi({ type: 'play' })
    useSimStore.setState({ running: true })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Space') return
      const t = e.target as HTMLElement | null
      if (t !== null && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        return
      }
      e.preventDefault()
      useSimStore.getState().toggleRunning()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (lessonOpen) {
    return <LessonPlayer onClose={() => useSimStore.getState().closeLesson()} />
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#080b11] text-slate-200">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Palette />
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <SimCanvas />
          </div>
          <GlobalStrip />
        </main>
        <Inspector />
      </div>
    </div>
  )
}
