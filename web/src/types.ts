export type NodeType = 'word' | 'root' | 'surah'

export type GraphNode = {
  id: string
  slug: string
  type: NodeType
  label: string
  title: string
  color: string
  searchText: string
  surahCount?: number
  ayahCount?: number
  surah?: number
}

export type GraphLink = {
  source: string
  target: string
}

export type GraphData = {
  nodes: GraphNode[]
  links: GraphLink[]
  colors: Record<string, string>
  meta: { nodeCount: number; linkCount: number; attribution: string }
}

export type NoteData = {
  id: string
  slug: string
  type: NodeType
  title: string
  html: string
}
