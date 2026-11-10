// Design Manager panel: save, load, delete designs

import { Save, FolderOpen, Trash2, Plus } from 'lucide-react'
import { useSimStore } from '../../store/simStore'

export function DesignManager() {
  const { savedDesigns, designName, setDesignName, saveCurrentDesign, loadDesign, deleteDesign, newDesign } = useSimStore()

  return (
    <div className="flex flex-col h-full border-l border-white/[0.07] bg-[#0a0e15]">
      <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
        <div className="flex items-center gap-2">
          <FolderOpen size={18} className="text-amber-300" />
          <div className="text-[13px] font-semibold">My Designs</div>
        </div>
        <button
          onClick={newDesign}
          title="New design"
          className="p-1.5 rounded-lg bg-white/[0.04] text-slate-300 ring-1 ring-white/10 transition-colors hover:bg-white/[0.08]"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1 px-3 py-3">
        {savedDesigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-600">
            <FolderOpen size={32} className="text-slate-500 mb-2" />
            <div className="text-[12px] font-medium text-slate-400">No saved designs yet</div>
            <div className="text-[10px] text-slate-500 mt-1">Create a topology and save it</div>
          </div>
        ) : (
          savedDesigns.map((d) => (
            <div
              key={d.id}
              className="group rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 hover:border-white/15 hover:bg-white/[0.05] transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <input
                    type="text"
                    value={d.name}
                    onChange={(e) => setDesignName(e.target.value)}
                    onBlur={() => useSimStore.getState().saveCurrentDesign(d.name)}
                    className="w-full bg-transparent border-none text-[12px] font-medium text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-400/30 rounded px-1"
                  />
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500 mt-0.5">
                    <span>{new Date(d.updatedAt).toLocaleDateString()}</span>
                    <span>·</span>
                    <span>{d.graph.nodes.length} nodes</span>
                    <span>·</span>
                    <span>{d.graph.edges.length} edges</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => loadDesign(d.id)}
                    title="Load"
                    className="p-1.5 rounded-lg bg-white/[0.04] text-slate-300 ring-1 ring-white/10 transition-colors hover:bg-sky-400/20 hover:text-sky-200 hover:ring-sky-400/30"
                  >
                    <FolderOpen size={12} />
                  </button>
                  <button
                    onClick={() => deleteDesign(d.id)}
                    title="Delete"
                    className="p-1.5 rounded-lg bg-white/[0.04] text-slate-300 ring-1 ring-white/10 transition-colors hover:bg-rose-400/20 hover:text-rose-200 hover:ring-rose-400/30"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-white/[0.07] px-4 py-3 space-y-2">
        <input
          type="text"
          value={designName}
          onChange={(e) => setDesignName(e.target.value)}
          placeholder="Design name"
          className="w-full rounded-lg border border-white/[0.1] bg-[#080b11] px-3 py-2 text-[12px] text-slate-200 placeholder-slate-600 focus:ring-1 focus:ring-sky-400/30 focus:border-transparent outline-none"
        />
        <button
          onClick={() => saveCurrentDesign()}
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-400/15 px-3 py-2 text-[12px] font-medium text-emerald-200 ring-1 ring-emerald-400/30 hover:bg-emerald-400/25 transition-colors"
        >
          <Save size={14} />
          Save Design
        </button>
      </div>
    </div>
  )
}