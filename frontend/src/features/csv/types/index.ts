export interface CsvMapping {
  date_col_idx: number
  item_col_idx: number
  store_col_idx: number
  price_col_idx: number
  confidence: number
}

export interface ParsedTransaction {
  date: string
  store: string
  price: number
}

export type EditingTransaction = Omit<ParsedTransaction, 'price'> & {
  price: number | ''
}

export interface CsvPreset {
  id?: string
  user_id?: string
  name: string
  mapping: CsvMapping
}

export interface CsvAnalysisFormProps {
  csvText: string
  presets: CsvPreset[]
  selectedPresetId: string
  onSelectPreset: (id: string) => void
  isAnalyzing: boolean
  onAnalyze: () => void
  onReset: () => void
}

export interface CsvEditorTableProps {
  parsedData: EditingTransaction[]
  onDataChange: (
    index: number,
    field: keyof ParsedTransaction,
    value: string | number
  ) => void
  onDeleteRow: (index: number) => void
  isSaving: boolean
  isWaiting: boolean
  waitTime: number
  progress: { current: number; total: number }
  onReset: () => void
  onSaveClick: () => void
}
