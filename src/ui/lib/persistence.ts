// Persistence: localStorage for designs, progress, and lesson state

export const STORAGE_KEYS = {
  DESIGNS: 'sysdesign_lab_designs',
  CURRENT_DESIGN: 'sysdesign_lab_current_design',
  LESSON_PROGRESS: 'sysdesign_lab_lesson_progress',
  SETTINGS: 'sysdesign_lab_settings',
  RECENT: 'sysdesign_lab_recent',
} as const

export interface SavedDesign {
  id: string
  name: string
  graph: import('../../engine/graph').GraphConfig
  createdAt: number
  updatedAt: number
  thumbnail?: string
}

export interface LessonProgress {
  lessonId: string
  completedSteps: string[]
  thinkAnswers: Record<string, string>
  quizAnswers: Record<number, number>
  testResults: any[]
  bestScore: number
  lastAttempt: number
  completed: boolean
}

export interface Settings {
  theme: 'dark' | 'light'
  speed: number
  showNodeLabels: boolean
  showEdgeAnimation: boolean
  autoSave: boolean
  soundEnabled: boolean
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  speed: 5,
  showNodeLabels: true,
  showEdgeAnimation: true,
  autoSave: true,
  soundEnabled: false,
}

function safeGet<T>(key: string, fallback: T): T {
  try {
    const item = localStorage.getItem(key)
    return item ? JSON.parse(item) : fallback
  } catch {
    return fallback
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.warn('Failed to save to localStorage:', e)
  }
}

export function getDesigns(): SavedDesign[] {
  return safeGet(STORAGE_KEYS.DESIGNS, [])
}

export function saveDesign(design: Omit<SavedDesign, 'id' | 'createdAt' | 'updatedAt'>): SavedDesign {
  const designs = getDesigns()
  const now = Date.now()
  const newDesign: SavedDesign = {
    ...design,
    id: `design_${now}_${Math.random().toString(36).slice(2, 9)}`,
    createdAt: now,
    updatedAt: now,
  }
  designs.unshift(newDesign)
  safeSet(STORAGE_KEYS.DESIGNS, designs.slice(0, 50))
  return newDesign
}

export function updateDesign(id: string, updates: Partial<SavedDesign>): SavedDesign | null {
  const designs = getDesigns()
  const idx = designs.findIndex((d) => d.id === id)
  if (idx === -1) return null
  designs[idx] = { ...designs[idx], ...updates, updatedAt: Date.now() } as SavedDesign
  safeSet(STORAGE_KEYS.DESIGNS, designs)
  return designs[idx]
}

export function deleteDesign(id: string): void {
  const designs = getDesigns().filter((d) => d.id !== id)
  safeSet(STORAGE_KEYS.DESIGNS, designs)
}

export function getCurrentDesign(): SavedDesign | null {
  const id = localStorage.getItem(STORAGE_KEYS.CURRENT_DESIGN)
  if (!id) return null
  return getDesigns().find((d) => d.id === id) ?? null
}

export function setCurrentDesign(id: string | null): void {
  if (id) localStorage.setItem(STORAGE_KEYS.CURRENT_DESIGN, id)
  else localStorage.removeItem(STORAGE_KEYS.CURRENT_DESIGN)
}

export function getLessonProgress(lessonId: string): LessonProgress | null {
  const all = safeGet<Record<string, LessonProgress>>(STORAGE_KEYS.LESSON_PROGRESS, {})
  return all[lessonId] ?? null
}

export function saveLessonProgress(lessonId: string, progress: LessonProgress): void {
  const all = safeGet<Record<string, LessonProgress>>(STORAGE_KEYS.LESSON_PROGRESS, {})
  all[lessonId] = progress
  safeSet(STORAGE_KEYS.LESSON_PROGRESS, all)
}

export function getSettings(): Settings {
  return safeGet(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS)
}

export function saveSettings(settings: Partial<Settings>): Settings {
  const current = getSettings()
  const updated = { ...current, ...settings }
  safeSet(STORAGE_KEYS.SETTINGS, updated)
  return updated
}

export function getRecentDesigns(limit = 5): SavedDesign[] {
  return getDesigns().slice(0, limit)
}