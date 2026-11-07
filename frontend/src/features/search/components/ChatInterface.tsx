import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { useApiConfig } from '@/hooks/useApiConfig'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { searchReceipts } from '../api/searchApi'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { type Message } from '../types'

export const ChatInterface: React.FC = () => {
  const { getHeaders } = useApiConfig()
  const { session } = useAuth()

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isFetchingHistory, setIsFetchingHistory] = useState(true)
  const [historyQueries, setHistoryQueries] = useState<string[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [dataType, setDataType] = useState('all')
  const [period, setPeriod] = useState('3months')

  useEffect(() => {
    const fetchHistory = async () => {
      if (!session?.user?.id) return

      setIsFetchingHistory(true)

      const { data, error } = await supabase
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30)

      if (error) {
        console.error('履歴の取得に失敗しました:', error)
        setIsFetchingHistory(false)
        return
      }

      if (data) {
        const chronologicalData = data.reverse()

        setMessages(
          chronologicalData.map((d) => ({
            role: d.role as 'user' | 'assistant',
            content: d.content,
          }))
        )

        const userQueries = chronologicalData
          .filter((d) => d.role === 'user')
          .map((d) => d.content)
        setHistoryQueries(Array.from(new Set(userQueries)))
      }

      setIsFetchingHistory(false)
    }

    fetchHistory()
  }, [session])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    const headers = await getHeaders()
    if (!headers || !query.trim() || !session?.user?.id) return

    const currentQuery = query
    const userMessage: Message = { role: 'user', content: currentQuery }

    setMessages((prev) => [...prev, userMessage])
    setQuery('')
    setShowSuggestions(false)
    setIsLoading(true)

    try {
      await supabase.from('chat_messages').insert({
        user_id: session.user.id,
        role: 'user',
        content: currentQuery,
      })

      const answer = await searchReceipts(
        currentQuery,
        dataType,
        period,
        headers
      )
      const assistantMessage: Message = { role: 'assistant', content: answer }

      setMessages((prev) => [...prev, assistantMessage])

      await supabase.from('chat_messages').insert({
        user_id: session.user.id,
        role: 'assistant',
        content: answer,
      })

      if (!historyQueries.includes(currentQuery)) {
        setHistoryQueries((prev) => [...prev, currentQuery])
      }
    } catch (error) {
      const status = axios.isAxiosError(error) ? error.response?.status : undefined
      if (status === 422) setQuery(currentQuery)
      const errorMessage: Message = {
        role: 'assistant',
        isError: true,
        content:
          status === 413
            ? '送信内容が大きすぎます。質問を短くして再度お試しください。'
            : status === 422
              ? '質問は500文字以内で入力してください。対象データが多い場合は、対象期間を短くして再度お試しください。'
              : '質問の処理に失敗しました。時間をおいて再度お試しください。',
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const filteredSuggestions = historyQueries.filter(
    (q) => q.toLowerCase().includes(query.toLowerCase()) && q !== query
  )

  return (
    <div className="rm-card flex flex-col h-[600px] sm:h-auto sm:flex-1 sm:min-h-0 overflow-hidden relative">
      <div className="bg-[var(--rm-surface-muted)] border-b border-[var(--rm-border-subtle)] p-4 text-[var(--rm-text-primary)] font-semibold flex justify-between items-center shrink-0 z-10">
        <span>家計簿AIチャット</span>
      </div>

      <div className="bg-[var(--rm-surface-subtle)] border-b border-[var(--rm-border-subtle)] p-3 flex flex-col sm:flex-row gap-3 text-sm shrink-0">
        <div className="flex items-center gap-2 flex-1">
          <span className="text-[var(--rm-text-secondary)] font-semibold text-xs whitespace-nowrap">
            対象データ:
          </span>
          <select
            value={dataType}
            onChange={(e) => setDataType(e.target.value)}
            className="rm-field flex-1 px-2 py-1.5 font-medium"
          >
            <option value="all">すべて</option>
            <option value="receipt">レシート詳細のみ</option>
            <option value="log">決済履歴のみ</option>
          </select>
        </div>
        <div className="flex items-center gap-2 flex-1">
          <span className="text-[var(--rm-text-secondary)] font-semibold text-xs whitespace-nowrap">
            対象期間:
          </span>
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rm-field flex-1 px-2 py-1.5 font-medium"
          >
            <option value="3months">過去3ヶ月</option>
            <option value="1month">今月のみ</option>
            <option value="all">全期間</option>
          </select>
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto space-y-5 bg-[var(--rm-surface-subtle)] custom-scrollbar relative">
        {isFetchingHistory ? (
          <div
            role="status"
            className="flex flex-col items-center justify-center h-full text-[var(--rm-text-secondary)] gap-3"
          >
            <span className="w-8 h-8 border-4 border-[var(--rm-receipt)] border-t-transparent rounded-full animate-spin"></span>
            <span className="font-semibold text-sm">履歴を読み込み中...</span>
          </div>
        ) : messages.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--rm-text-secondary)] gap-2">
            <span className="text-4xl mb-2 text-[var(--rm-receipt)]" aria-hidden="true">
              ⌕
            </span>
            <span className="font-semibold text-sm text-center">
              こんにちは！
              <br />
              過去のデータから何でも検索できます。
            </span>
          </div>
        ) : (
          messages.map((msg, index) => (
            <div
              key={index}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] sm:max-w-[75%] rounded-[var(--rm-radius-panel)] p-3.5 whitespace-pre-wrap [overflow-wrap:anywhere] shadow-[var(--rm-shadow-raised)] ${
                  msg.role === 'user'
                    ? 'bg-[var(--rm-receipt)] text-white rounded-br-[var(--rm-radius-control)]'
                    : msg.isError
                      ? 'bg-[var(--rm-danger-subtle)] text-[var(--rm-danger)] border border-[var(--rm-danger)] rounded-bl-[var(--rm-radius-control)]'
                      : 'bg-[var(--rm-surface)] text-[var(--rm-text-primary)] border border-[var(--rm-border-subtle)] rounded-bl-[var(--rm-radius-control)]'
                }`}
                role={msg.isError ? 'alert' : undefined}
              >
                {msg.role === 'assistant' && !msg.isError ? (
                  <div className="prose prose-sm max-w-none prose-p:text-[var(--rm-text-primary)] prose-headings:text-[var(--rm-text-primary)] prose-strong:text-[var(--rm-text-primary)] prose-li:text-[var(--rm-text-primary)] prose-a:text-[var(--rm-receipt)] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw, rehypeSanitize]}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <span className="font-medium">{msg.content}</span>
                )}
              </div>
            </div>
          ))
        )}

        {isLoading && (
          <div className="flex justify-start">
            <div
              role="status"
              aria-label="回答を生成中"
              className="bg-[var(--rm-surface)] border border-[var(--rm-border-subtle)] shadow-[var(--rm-shadow-raised)] rounded-[var(--rm-radius-panel)] rounded-bl-[var(--rm-radius-control)] p-4 flex gap-1.5 items-center"
            >
              <div
                className="w-2 h-2 bg-[var(--rm-text-muted)] rounded-full animate-bounce"
                style={{ animationDelay: '0ms' }}
              ></div>
              <div
                className="w-2 h-2 bg-[var(--rm-text-muted)] rounded-full animate-bounce"
                style={{ animationDelay: '150ms' }}
              ></div>
              <div
                className="w-2 h-2 bg-[var(--rm-text-muted)] rounded-full animate-bounce"
                style={{ animationDelay: '300ms' }}
              ></div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-3 sm:p-4 bg-[var(--rm-surface)] border-t border-[var(--rm-border-subtle)] flex flex-col relative shrink-0">
        {showSuggestions && query.trim() && filteredSuggestions.length > 0 && (
          <div
            ref={suggestionsRef}
            onBlurCapture={(event) => {
              if (
                !(event.relatedTarget instanceof Node) ||
                !event.currentTarget.contains(event.relatedTarget)
              ) {
                setShowSuggestions(false)
              }
            }}
            className="absolute bottom-full left-0 mb-2 w-full bg-[var(--rm-surface)] border border-[var(--rm-border)] rounded-[var(--rm-radius-panel)] shadow-[var(--rm-shadow-popover)] z-20 max-h-48 overflow-y-auto custom-scrollbar"
          >
            <div className="text-xs text-[var(--rm-text-secondary)] bg-[var(--rm-surface-muted)] px-4 py-2 border-b border-[var(--rm-border-subtle)] font-semibold sticky top-0">
              過去の質問から検索
            </div>
            {filteredSuggestions.map((suggestion, index) => (
              <button
                key={index}
                type="button"
                onClick={() => {
                  setQuery(suggestion)
                  setShowSuggestions(false)
                }}
                className="w-full text-left px-4 py-3 text-sm font-medium text-[var(--rm-text-secondary)] hover:bg-[var(--rm-surface-subtle)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-focus)] border-b border-[var(--rm-border-subtle)] last:border-0 transition-colors"
              >
                <span aria-hidden="true" className="mr-2 text-[var(--rm-text-muted)]">
                  ⌕
                </span>
                {suggestion}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-end">
          <div className="flex-1 relative">
            <Input
              placeholder="質問を入力..."
              value={query}
              onChange={(e) => {
                setQuery(Array.from(e.target.value).slice(0, 500).join(''))
                setShowSuggestions(true)
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={(event) => {
                if (
                  event.relatedTarget instanceof Node &&
                  suggestionsRef.current?.contains(event.relatedTarget)
                ) {
                  return
                }
                setTimeout(() => setShowSuggestions(false), 200)
              }}
              onKeyDown={(e) =>
                e.key === 'Enter' && !e.nativeEvent.isComposing && handleSend()
              }
              className="rm-field w-full !rounded-[var(--rm-radius-control)] !border-[var(--rm-border)] !bg-[var(--rm-surface-subtle)] !text-[var(--rm-text-primary)] focus:!bg-[var(--rm-surface)] focus:!ring-0 pr-10"
            />
            <span className="mt-1 block text-right text-xs text-[var(--rm-text-muted)]">
              {Array.from(query).length}/500
            </span>
          </div>
          <Button
            onClick={handleSend}
            disabled={isLoading || !query.trim()}
            className="!rounded-[var(--rm-radius-control)] !bg-[var(--rm-receipt)] hover:!bg-[var(--rm-receipt)] !shadow-[var(--rm-shadow-raised)] px-5 py-2.5 font-semibold flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--rm-focus)] disabled:!bg-[var(--rm-surface-muted)] disabled:!text-[var(--rm-text-muted)] disabled:!shadow-none"
          >
            送信
          </Button>
        </div>
      </div>
    </div>
  )
}
