import { useState, useEffect, useMemo } from 'react'
import { useApiConfig } from '@/hooks/useApiConfig'
import {
  fetchTransactions,
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

export const useHistory = () => {
  const { getHeaders } = useApiConfig()

  const [activeTab, setActiveTab] = useState<'receipts' | 'csv'>('receipts')
  const [receipts, setReceipts] = useState<HistoryReceipt[]>([])
  const [csvData, setCsvData] = useState<HistoryCsvTransaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(
    null
  )

  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
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
    const loadData = async () => {
      setIsLoading(true)
      const headers = await getHeaders()
      if (headers) {
        try {
          const data = await fetchTransactions(headers)
          setReceipts(data.receipts || [])
          setCsvData(data.csv_transactions || [])
        } catch (error) {
          console.error('データの取得に失敗しました:', error)
        }
      }
      setIsLoading(false)
    }
    loadData()
  }, [])

  const allMonths = useMemo(() => {
    const mSet = new Set<string>()

    if (activeTab === 'receipts') {
      receipts.forEach((r) => mSet.add(r.date.substring(0, 7)))
    } else {
      csvData.forEach((c) => mSet.add(c.date.substring(0, 7)))
    }

    mSet.add(currentMonth)
    mSet.add(new Date().toISOString().substring(0, 7))

    return Array.from(mSet).sort().reverse()
  }, [receipts, csvData, activeTab, currentMonth])

  const currentIndex = allMonths.indexOf(currentMonth)

  const handlePrevMonth = () => {
    if (currentIndex < allMonths.length - 1) {
      setCurrentMonth(allMonths[currentIndex + 1])
    }
  }
  const handleNextMonth = () => {
    if (currentIndex > 0) {
      setCurrentMonth(allMonths[currentIndex - 1])
    }
  }

  const requestDeleteReceipt = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleteTarget({ type: 'receipt', id })
  }
  const requestDeleteCsv = (id: string) => setDeleteTarget({ type: 'csv', id })

  const executeDelete = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    const headers = await getHeaders()
    if (!headers) {
      setIsDeleting(false)
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
    } catch (error) {
      console.error('削除に失敗しました:', error)
      alert('削除に失敗しました。もう一度お試しください。')
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
    const headers = await getHeaders()
    if (!headers) {
      setIsSaving(false)
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
      }
      setEditTarget(null)
      setEditType(null)
    } catch (error) {
      console.error('更新に失敗しました:', error)
      alert('更新に失敗しました。もう一度お試しください。')
    } finally {
      setIsSaving(false)
    }
  }

  const formattedCurrentMonth = `${currentMonth.split('-')[0]}年 ${parseInt(currentMonth.split('-')[1])}月`

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

  const toggleAccordion = (id: string) => {
    setExpandedReceiptId((prev) => (prev === id ? null : id))
  }

  return {
    activeTab,
    setActiveTab,
    isLoading,
    expandedReceiptId,
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
  }
}
