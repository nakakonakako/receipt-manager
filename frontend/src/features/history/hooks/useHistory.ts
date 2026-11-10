import { useState, useEffect, useEffectEvent, useMemo, useRef, useReducer } from 'react'
import { useApiConfig } from '@/hooks/useApiConfig'
import {
  fetchTransactions,
  fetchAvailableMonths,
  deleteCsvTransaction,
  deleteReceipt,
  updateReceipt,
  updateCsvTransaction,
} from '../api/historyApi'
import type {
  HistoryReceipt,
  HistoryCsvTransaction,
  HistoryReceiptItem,
} from '../types'
import { toast } from 'sonner'
import { createMonthLoader, loadMonths } from './monthLoader'
import { searchReducer } from './searchState'

export const useHistory = () => {
  const { getHeaders } = useApiConfig()

  const [activeTab, setActiveTab] = useState<'receipts' | 'csv'>('receipts')
  const [receipts, setReceipts] = useState<HistoryReceipt[]>([])
  const [csvData, setCsvData] = useState<HistoryCsvTransaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(
    null
  )
  const [isMonthDropdownOpen, setIsMonthDropdownOpen] = useState(false)

  const [receiptMonths, setReceiptMonths] = useState<string[]>([])
  const [csvMonths, setCsvMonths] = useState<string[]>([])
  const [currentReceiptMonth, setCurrentReceiptMonth] = useState('')
  const [currentCsvMonth, setCurrentCsvMonth] = useState('')

  const [search, dispatchSearch] = useReducer(searchReducer, {
    draft: '',
    submitted: '',
  })
  const searchQuery = search.draft
  const submittedQuery = search.submitted
  const setSearchQuery = (value: string) =>
    dispatchSearch({ type: 'edit', value })
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [loadState, setLoadState] = useState<{
    key: string
    status: 'loading' | 'ready' | 'error'
  }>({ key: '', status: 'loading' })
  const [retry, setRetry] = useState(0)

  const [deleteTarget, setDeleteTarget] = useState<{
    type: 'receipt' | 'csv'
    id: string
  } | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [editTarget, setEditTarget] = useState<
    HistoryReceipt | HistoryCsvTransaction | null
  >(null)
  const [editType, setEditType] = useState<'receipt' | 'csv' | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const getHeadersForEffect = useEffectEvent(getHeaders)

  const loader = useRef(createMonthLoader())

  useEffect(() => {
    const initLoad = async () => {
      setIsLoading(true)
      const headers = await getHeadersForEffect()
      if (headers) {
        try {
          const monthsData = await fetchAvailableMonths(headers)
          setReceiptMonths(monthsData.receipts)
          setCsvMonths(monthsData.csv)

          const d = new Date()
          const fallbackMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

          const latestReceiptMonth =
            monthsData.receipts.length > 0
              ? monthsData.receipts[0]
              : fallbackMonth
          const latestCsvMonth =
            monthsData.csv.length > 0 ? monthsData.csv[0] : fallbackMonth

          const initialMonthToLoad = latestReceiptMonth

          setCurrentReceiptMonth(latestReceiptMonth)
          setCurrentCsvMonth(latestCsvMonth)

          const data = await fetchTransactions(initialMonthToLoad, headers)
          setReceipts(data.receipts || [])
          setCsvData(data.csv_transactions || [])

          loader.current.markLoaded(initialMonthToLoad)
        } catch (error) {
          console.error('データの取得に失敗しました:', error)
          toast.error('データの取得に失敗しました。')
        }
      }
      setIsLoading(false)
    }
    initLoad()
  }, [])

  const currentMonth =
    activeTab === 'receipts' ? currentReceiptMonth : currentCsvMonth
  const allMonths = activeTab === 'receipts' ? receiptMonths : csvMonths
  const setCurrentMonth =
    activeTab === 'receipts' ? setCurrentReceiptMonth : setCurrentCsvMonth

  const searchScope = submittedQuery ? 'all' : 'current'
  const loadKey = JSON.stringify([
    searchScope,
    activeTab,
    searchScope === 'all' ? submittedQuery : currentMonth,
    retry,
  ])
  const loadForView = useEffectEvent(
    async (months: string[], isActive: () => boolean) => {
      await loadMonths(
        months,
        (month) =>
          loader.current.ensure(month, async (requestedMonth) => {
            const headers = await getHeaders()
            if (!headers) throw new Error('認証情報を取得できませんでした')
            const data = await fetchTransactions(requestedMonth, headers)
            setReceipts((prev) => {
              const ids = new Set(prev.map((item) => item.id))
              return [
                ...prev,
                ...(data.receipts || []).filter((item) => !ids.has(item.id)),
              ]
            })
            setCsvData((prev) => {
              const ids = new Set(prev.map((item) => item.id))
              return [
                ...prev,
                ...(data.csv_transactions || []).filter(
                  (item) => !ids.has(item.id)
                ),
              ]
            })
          }),
        isActive
      )
    }
  )
  useEffect(() => {
    if (isLoading) return
    let active = true
    const months = searchScope === 'all' ? allMonths : [currentMonth]
    setLoadState({ key: loadKey, status: 'loading' })
    void loadForView(months, () => active)
      .then(() => {
        if (active) setLoadState({ key: loadKey, status: 'ready' })
      })
      .catch(() => {
        if (active) setLoadState({ key: loadKey, status: 'error' })
      })
    return () => {
      active = false
    }
  }, [loadKey, isLoading, allMonths, currentMonth, searchScope])
  const viewStatus = loadState.key === loadKey ? loadState.status : 'loading'
  const isFetchingMonth = viewStatus === 'loading'
  const submitSearch = () => dispatchSearch({ type: 'submit' })
  const clearSearch = () => dispatchSearch({ type: 'clear' })

  const currentIndex = allMonths.indexOf(currentMonth)
  const handlePrevMonth = () => {
    if (currentIndex < allMonths.length - 1)
      setCurrentMonth(allMonths[currentIndex + 1])
  }
  const handleNextMonth = () => {
    if (currentIndex > 0) setCurrentMonth(allMonths[currentIndex - 1])
  }

  const requestDeleteReceipt = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleteTarget({ type: 'receipt', id })
  }
  const requestDeleteCsv = (id: string) => setDeleteTarget({ type: 'csv', id })

  const executeDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    const id = toast.loading('削除しています...')
    const headers = await getHeaders()
    if (!headers) {
      setIsDeleting(false)
      toast.dismiss(id)
      return
    }

    try {
      if (deleteTarget.type === 'receipt') {
        await deleteReceipt(deleteTarget.id, headers)
        setReceipts((prev) => prev.filter((r) => r.id !== deleteTarget.id))
      } else {
        await deleteCsvTransaction(deleteTarget.id, headers)
        setCsvData((prev) => prev.filter((c) => c.id !== deleteTarget.id))
      }
      setDeleteTarget(null)
      toast.success('削除が完了しました！', { id })
    } catch (error) {
      console.error('削除に失敗しました:', error)
      toast.error('削除に失敗しました。もう一度お試しください。', { id })
    } finally {
      setIsDeleting(false)
    }
  }

  const openEditReceipt = (receipt: HistoryReceipt, e: React.MouseEvent) => {
    e.stopPropagation()
    const copied: HistoryReceipt = JSON.parse(JSON.stringify(receipt))
    copied.receipt_items = copied.receipt_items.filter(
      (item: HistoryReceiptItem) =>
        !item.item_name.includes('自動調整額') &&
        !item.item_name.includes('消費税')
    )
    setEditTarget(copied)
    setEditType('receipt')
  }

  const openEditCsv = (csv: HistoryCsvTransaction) => {
    setEditTarget({ ...csv })
    setEditType('csv')
  }

  const executeEdit = async () => {
    if (!editTarget || !editType) return
    setIsSaving(true)
    const id = toast.loading('保存しています...')
    const headers = await getHeaders()
    if (!headers) {
      setIsSaving(false)
      toast.dismiss(id)
      return
    }

    try {
      if (editType === 'receipt') {
        await updateReceipt(
          editTarget.id,
          editTarget as HistoryReceipt,
          headers
        )
        setReceipts((prev) =>
          prev.map((r) =>
            r.id === editTarget.id ? (editTarget as HistoryReceipt) : r
          )
        )

        const newMonth = editTarget.date.substring(0, 7)
        if (!receiptMonths.includes(newMonth))
          setReceiptMonths((prev) => [...prev, newMonth].sort().reverse())
      } else {
        await updateCsvTransaction(
          editTarget.id,
          editTarget as HistoryCsvTransaction,
          headers
        )
        setCsvData((prev) =>
          prev.map((c) =>
            c.id === editTarget.id ? (editTarget as HistoryCsvTransaction) : c
          )
        )

        const newMonth = editTarget.date.substring(0, 7)
        if (!csvMonths.includes(newMonth))
          setCsvMonths((prev) => [...prev, newMonth].sort().reverse())
      }

      setEditTarget(null)
      setEditType(null)
      toast.success('更新が完了しました！', { id })
    } catch (error) {
      console.error('更新に失敗しました:', error)
      toast.error('更新に失敗しました。もう一度お試しください。', { id })
    } finally {
      setIsSaving(false)
    }
  }

  const formattedCurrentMonth = currentMonth
    ? `${currentMonth.split('-')[0]}年 ${parseInt(currentMonth.split('-')[1])}月`
    : ''

  const { filteredReceipts, receiptTotal } = useMemo(() => {
    let filtered =
      searchScope === 'current'
        ? receipts.filter((r) => r.date.startsWith(currentMonth))
        : [...receipts]
    if (submittedQuery) {
      filtered = filtered.filter(
        (r) =>
          r.store_name.includes(submittedQuery) ||
          r.receipt_items.some(
            (item) =>
              item.item_name.includes(submittedQuery) ||
              (item.search_tags ?? []).some((tag) =>
                tag.includes(submittedQuery)
              )
          )
      )
    }
    filtered.sort((a, b) =>
      sortOrder === 'desc'
        ? b.date.localeCompare(a.date)
        : a.date.localeCompare(b.date)
    )
    const total = receipts
      .filter((r) => r.date.startsWith(currentMonth))
      .reduce((sum, r) => sum + r.total_amount, 0)
    return { filteredReceipts: filtered, receiptTotal: total }
  }, [receipts, currentMonth, submittedQuery, sortOrder, searchScope])

  const { filteredCsv, csvTotal } = useMemo(() => {
    let filtered =
      searchScope === 'current'
        ? csvData.filter((c) => c.date.startsWith(currentMonth))
        : [...csvData]
    if (submittedQuery) {
      filtered = filtered.filter((c) => c.store.includes(submittedQuery))
    }
    filtered.sort((a, b) =>
      sortOrder === 'desc'
        ? b.date.localeCompare(a.date)
        : a.date.localeCompare(b.date)
    )
    const total = csvData
      .filter((c) => c.date.startsWith(currentMonth))
      .reduce((sum, c) => sum + c.price, 0)
    return { filteredCsv: filtered, csvTotal: total }
  }, [csvData, currentMonth, submittedQuery, sortOrder, searchScope])

  const toggleAccordion = (id: string) =>
    setExpandedReceiptId((prev) => (prev === id ? null : id))

  return {
    activeTab,
    setActiveTab,
    isLoading,
    expandedReceiptId,
    setExpandedReceiptId,
    toggleAccordion,
    currentMonth,
    setCurrentMonth,
    allMonths,
    currentIndex,
    formattedCurrentMonth,
    handlePrevMonth,
    handleNextMonth,
    searchQuery,
    setSearchQuery,
    searchScope,
    submittedQuery,
    submitSearch,
    clearSearch,
    viewStatus,
    retryLoad: () => setRetry((value) => value + 1),
    sortOrder,
    setSortOrder,
    filteredReceipts,
    receiptTotal,
    filteredCsv,
    csvTotal,
    deleteTarget,
    setDeleteTarget,
    requestDeleteReceipt,
    requestDeleteCsv,
    executeDelete,
    isDeleting,
    editTarget,
    setEditTarget,
    editType,
    openEditReceipt,
    openEditCsv,
    executeEdit,
    isSaving,
    isMonthDropdownOpen,
    setIsMonthDropdownOpen,
    isFetchingMonth,
  }
}
