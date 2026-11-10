import { useCallback, useRef, useState, useEffect } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useNodesState,
  useEdgesState,
  type Node,
} from '@xyflow/react'
import { useSimStore } from '../../store/simStore'
import { SimNodeCard } from './SimNodeCard'
import { NODE_META } from './nodeMeta'
import { defaultConfigFor } from '../../engine/nodes/registry'
import type { GraphConfig } from '../../engine/graph'
import type { NodeKind } from '../../engine/core/types'
import { ConnectionMode } from '@xyflow/system'
import { sendUi } from '../workerClient'

function toNodes(graph: GraphConfig): Node<any>[] {
  return graph.nodes.map((n) => ({
    id: n.id,
    type: 'sim',
    position: { x: n.x, y: n.y },
    data: { kind: n.kind, label: n.label },
  }))
}

const toEdgesFn = (graph: GraphConfig) => {
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.from,
    target: e.to,
    type: 'smoothstep',
    className: 'edge-live',
    style: { stroke: '#31405a', strokeWidth: 1.5 },
  }))
}

function Flow({ graph }: { graph: GraphConfig }) {
  const [nodes, , onNodesChange] = useNodesState<Node<any>>(toNodes(graph))
  const [edges, setEdges, onEdgesChange] = useEdgesState(toEdgesFn(graph))
  const running = useSimStore((s) => s.running)
  const select = useSimStore((s) => s.select)
  const setNodePosition = useSimStore((s) => s.setNodePosition)
  const setGraph = useSimStore((s) => s.setGraph)
  const [, forceUpdate] = useState(0)
  const rfInstance = useRef<any>(null)
  const instanceReady = useRef(false)

  const syncGraph = useCallback(() => {
    const newGraph = {
      ...graph,
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: n.data.kind,
        label: n.data.label,
        x: n.position.x,
        y: n.position.y,
        config: graph.nodes.find((gn) => gn.id === n.id)?.config ?? {},
      })),
      edges: edges.map((e) => ({
        id: e.id,
        from: e.source as string,
        to: e.target as string,
        latencyMs: 1,
      })),
    }
    setGraph(newGraph)
    forceUpdate((v) => v + 1)
    // Send graph update to worker so simulation knows about new nodes/edges
    sendUi({ type: 'updateGraph', graph: newGraph })
  }, [nodes, edges, graph, setGraph])

  const handleNodesChange = (changes: any[]) => {
    onNodesChange(changes)
    setTimeout(syncGraph, 0)
  }

  const handleEdgesChange = (changes: any[]) => {
    onEdgesChange(changes)
    setTimeout(syncGraph, 0)
  }

  const handleConnect = useCallback(
    (connection: any) => {
      const newEdge = { 
        ...connection, 
        id: 'edge_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
        type: 'smoothstep', 
        className: 'edge-live', 
        style: { stroke: '#31405a', strokeWidth: 1.5 },
        // Ensure handle IDs are set for proper edge rendering
        sourceHandle: connection.sourceHandle || 'source',
        targetHandle: connection.targetHandle || 'target',
      }
      setEdges((eds: any[]) => 
        eds.find((e: any) => e.id === connection.id) ? eds : [...eds, newEdge]
      )
    },
    [setEdges]
  )

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    
    const kind = event.dataTransfer.getData('sysdesign/component') as string
    console.log('[Drop] Received drop event, kind:', kind)
    if (!kind) {
      console.log('[Drop] No component kind in dataTransfer')
      return
    }

    const instance = rfInstance.current
    console.log('[Drop] Instance:', instance, 'Ready:', instanceReady.current)
    if (!instance || !instanceReady.current) {
      console.log('[Drop] Instance not ready')
      return
    }

    const { x, y } = instance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    
    const meta = NODE_META[kind as keyof typeof NODE_META]
    // Get default config for this node type
    const defaultConfig = defaultConfigFor(kind as NodeKind)
    const newNode = {
      id: 'node_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9),
      type: 'sim',
      position: { x, y },
      data: { kind, label: meta?.kindLabel ?? kind, ...defaultConfig },
    }

    instance.setNodes((nds: any[]) => [...nds, newNode])
    console.log('[Drop] Added node:', newNode)
  }, [])

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    console.log('[DragOver] Drag over canvas')
  }, [])

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      // Delete selected nodes/edges - React Flow handles this automatically
      // when edges/nodes are selected and Delete/Backspace is pressed
      console.log('[Delete] Delete key pressed - React Flow handles selection deletion automatically')
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className={'h-full w-full ' + (running ? 'flow-playing' : '')}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={{ sim: SimNodeCard }}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onInit={(instance) => { 
          console.log('[Init] React Flow instance initialized:', !!instance)
          rfInstance.current = instance
          instanceReady.current = true
        }}
        colorMode='dark'
        fitView
        fitViewOptions={{ padding: 0.28 }}
        minZoom={0.3}
        maxZoom={1.6}
        nodesConnectable={true}
        connectionMode={ConnectionMode.Loose}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => select(node.id)}
        onPaneClick={() => select(null)}
        onNodeDragStop={(_, node) => setNodePosition(node.id, node.position.x, node.position.y)}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.3} color='#1c2740' />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) => NODE_META[n.data.kind as keyof typeof NODE_META]?.accent ?? '#64748b'}
          maskColor='rgba(2,6,12,0.75)'
          style={{ background: '#0a0e15' }}
        />
        <Controls showInteractive={false} position='bottom-left' />
      </ReactFlow>
    </div>
  )
}

export function SimCanvas() {
  const graph = useSimStore((s) => s.graph)
  const presetId = useSimStore((s) => s.presetId)
  return <Flow key={presetId} graph={graph} />
}
