export type NodeType = 'word' | 'root' | 'surah'

export type GraphNode = {
  id: string
  slug: string
  type: NodeType
  label: string
  title: string
  color: string
  searchText?: string
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

export type SearchDoc = Pick<GraphNode, 'id' | 'slug' | 'type' | 'label' | 'title'> & {
  searchText: string
}

export type NoteVerse = {
  ref: string
  surah: string
  arabic: string
  wordForm: string
  gloss: string
  sahihInternational: string
  yusufAli?: string
  urdu?: string
  url: string
  fromWord?: string
}

export type TrMode = 'all' | 'en' | 'ur'

export type NoteData = {
  id: string
  slug: string
  type: NodeType
  title: string
  html: string
  meaning?: string
  lemma?: string
  root?: string
  surahCount?: number
  ayahCount?: number
  surahs?: string[]
  words?: string[]
  roots?: string[]
  verses?: NoteVerse[]
  versesTotal?: number
  versesFile?: string
  versesLoaded?: boolean
}
