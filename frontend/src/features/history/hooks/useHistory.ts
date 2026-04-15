import { useState, useEffect, useMemo } from 'react'
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

export const useHistory = () => {
  const { getHeaders } = useApiConfig()

  const [activeTab, setActiveTab] = useState<'receipts' | 'csv'>('receipts')
  const [receipts, setReceipts] = useState<HistoryReceipt[]>([])
  const [csvData, setCsvData] = useState<HistoryCsvTransaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isFetchingMonth, setIsFetchingMonth] = useState(false)
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(
    null
  )
  const [isMonthDropdownOpen, setIsMonthDropdownOpen] = useState(false)

  const [receiptMonths, setReceiptMonths] = useState<string[]>([])
  const [csvMonths, setCsvMonths] = useState<string[]>([])
  const [currentReceiptMonth, setCurrentReceiptMonth] = useState('')
  const [currentCsvMonth, setCurrentCsvMonth] = useState('')

  const [loadedMonths, setLoadedMonths] = useState<Set<string>>(new Set())

  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')

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

  useEffect(() => {
    const initLoad = async () => {
      setIsLoading(true)
      const headers = await getHeaders()
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

          setCurrentReceiptMonth(latestReceiptMonth)
          setCurrentCsvMonth(latestCsvMonth)

          const initialMonthToLoad =
            activeTab === 'receipts' ? latestReceiptMonth : latestCsvMonth
          const data = await fetchTransactions(initialMonthToLoad, headers)
          setReceipts(data.receipts || [])
          setCsvData(data.csv_transactions || [])

          setLoadedMonths(new Set([initialMonthToLoad]))
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

  useEffect(() => {
    const loadMonthData = async () => {
      if (!currentMonth || loadedMonths.has(currentMonth) || isLoading) return

      setIsFetchingMonth(true)
      const headers = await getHeaders()
      if (headers) {
        try {
          const data = await fetchTransactions(currentMonth, headers)

          setReceipts((prev) => {
            const existingIds = new Set(prev.map((r) => r.id))
            const newReceipts = (data.receipts || []).filter(
              (r) => !existingIds.has(r.id)
            )
            return [...prev, ...newReceipts]
          })
          setCsvData((prev) => {
            const existingIds = new Set(prev.map((c) => c.id))
            const newCsv = (data.csv_transactions || []).filter(
              (c) => !existingIds.has(c.id)
            )
            return [...prev, ...newCsv]
          })

          setLoadedMonths((prev) => new Set(prev).add(currentMonth))
        } catch (error) {
          console.error('データの取得に失敗しました:', error)
          toast.error('データの取得に失敗しました。')
        } finally {
          setIsFetchingMonth(false)
        }
      } else {
        setIsFetchingMonth(false)
      }
    }
    loadMonthData()
  }, [currentMonth])

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
    let filtered = receipts.filter((r) => r.date.startsWith(currentMonth))
    if (searchQuery) {
      filtered = filtered.filter(
        (r) =>
          r.store_name.includes(searchQuery) ||
          r.receipt_items.some((item) => item.item_name.includes(searchQuery))
      )
    }
    filtered.sort((a, b) =>
      sortOrder === 'desc'
        ? b.date.localeCompare(a.date)
        : a.date.localeCompare(b.date)
    )
    const total = filtered.reduce((sum, r) => sum + r.total_amount, 0)
    return { filteredReceipts: filtered, receiptTotal: total }
  }, [receipts, currentMonth, searchQuery, sortOrder])

  const { filteredCsv, csvTotal } = useMemo(() => {
    let filtered = csvData.filter((c) => c.date.startsWith(currentMonth))
    if (searchQuery) {
      filtered = filtered.filter((c) => c.store.includes(searchQuery))
    }
    filtered.sort((a, b) =>
      sortOrder === 'desc'
        ? b.date.localeCompare(a.date)
        : a.date.localeCompare(b.date)
    )
    const total = filtered.reduce((sum, c) => sum + c.price, 0)
    return { filteredCsv: filtered, csvTotal: total }
  }, [csvData, currentMonth, searchQuery, sortOrder])

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
