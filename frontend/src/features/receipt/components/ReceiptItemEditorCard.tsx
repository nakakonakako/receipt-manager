import React from 'react'
import { MAIN_CATEGORIES } from '../constants/categories'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { NumberInput } from '@/components/ui/NumberInput'

export interface ReceiptItemEditorCardProps {
  /** 1-based display index */
  lineNumber: number
  itemName: string
  price: number | ''
  searchTagsDisplay: string
  /** Resolved for UI (default ON when undefined) */
  isComparable: boolean
  onItemNameChange: (value: string) => void
  onSearchTagsChange: (value: string) => void
  onPriceChange: (value: number | string) => void
  onComparableToggle: () => void
  onDelete: () => void
  /** 履歴編集などで大／小分類を触るときだけ渡す */
  mainCategory?: string
  subCategory?: string
  onMainCategoryChange?: (value: string) => void
  onSubCategoryChange?: (value: string) => void
  /** true のとき、分類・タグセクションを初期状態で閉じる */
  collapseMetaSectionByDefault?: boolean
}

export const ReceiptItemEditorCard: React.FC<ReceiptItemEditorCardProps> = ({
  lineNumber,
  itemName,
  price,
  searchTagsDisplay,
  isComparable,
  onItemNameChange,
  onSearchTagsChange,
  onPriceChange,
  onComparableToggle,
  onDelete,
  mainCategory,
  subCategory,
  onMainCategoryChange,
  onSubCategoryChange,
  collapseMetaSectionByDefault = false,
}) => {
  const categoryEditable =
    onMainCategoryChange !== undefined && onSubCategoryChange !== undefined
  const [isMetaSectionOpen, setIsMetaSectionOpen] = React.useState(
    !collapseMetaSectionByDefault
  )

  return (
    <div className="border border-gray-200 rounded-xl p-3 sm:p-4 bg-gray-50/40 shadow-sm">
      <div className="flex justify-between items-center gap-2 mb-2 pb-2 border-b border-gray-200">
        <span className="text-xs font-extrabold text-gray-500 tracking-wide">
          品目 {lineNumber}
        </span>
        <Button
          variant="danger"
          onClick={onDelete}
          className="px-2.5 py-1 text-xs font-bold shrink-0 !bg-white !text-red-600 border border-red-200 hover:!bg-red-50"
        >
          削除
        </Button>
      </div>

      <div className="space-y-2.5">
        {/* ラベル行の高さを揃え、入力行は h-10 で金額・商品名・相場を同一ベースラインに */}
        <div className="flex flex-wrap items-stretch gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-[12rem] flex flex-col">
            <label className="text-xs font-bold text-gray-600 h-8 shrink-0 flex items-end mb-1">
              商品名 <span className="text-red-500">*</span>
            </label>
            <Input
              value={itemName}
              onChange={(e) => onItemNameChange(e.target.value)}
              placeholder="レシートの表記どおり"
              className="h-10 box-border font-semibold text-gray-900 border-gray-300 !py-0 px-2"
            />
          </div>
          <div className="flex shrink-0 gap-2">
            <div className="w-[6.75rem] flex flex-col">
              <label className="text-xs font-bold text-gray-600 h-8 shrink-0 flex items-end mb-1 whitespace-nowrap">
                金額
                <span className="font-normal text-gray-400 ml-0.5 hidden sm:inline">
                  (7桁)
                </span>
              </label>
              <NumberInput
                value={price}
                onChange={onPriceChange}
                maxLength={7}
                className="h-10 box-border w-full text-right font-bold tabular-nums border-gray-300 bg-white !py-0 px-2"
                placeholder="0"
              />
            </div>
            <div className="w-[6.75rem] sm:w-auto sm:min-w-[9.25rem] flex flex-col">
              <label className="text-xs font-bold text-gray-600 h-8 shrink-0 flex items-end mb-1 whitespace-nowrap">
                相場グラフ
              </label>
              <button
                type="button"
                onClick={onComparableToggle}
                title={
                  isComparable
                    ? '買い物メモのグラフに含めています（クリックで除外）'
                    : 'グラフから除外中（クリックで含める）'
                }
                className={`h-10 box-border w-full px-2 text-xs font-bold rounded-lg border flex items-center justify-center select-none touch-manipulation shadow-sm transition-[transform,box-shadow,background-color] duration-150 ease-out active:scale-[0.96] active:shadow-inner motion-reduce:transition-none motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-1 ${
                  isComparable
                    ? 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-200/90 active:bg-blue-300/80'
                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 active:bg-gray-200/90'
                }`}
              >
                {isComparable ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </div>
        {categoryEditable ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setIsMetaSectionOpen((prev) => !prev)}
              className="w-full flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 transition"
            >
              <span>大分類・小分類・検索タグ</span>
              <span className="text-xs text-gray-500">
                {isMetaSectionOpen ? '▲ 閉じる' : '▼ 開く'}
              </span>
            </button>

            {isMetaSectionOpen && (
              <div className="flex flex-wrap items-stretch gap-x-2 gap-y-2">
                <div className="w-32 shrink-0 flex flex-col">
                  <label className="text-xs font-bold text-gray-600 h-8 shrink-0 flex items-end mb-1">
                    大分類
                  </label>
                  <select
                    value={mainCategory ?? 'その他'}
                    onChange={(e) => onMainCategoryChange(e.target.value)}
                    className="h-10 box-border w-full px-1.5 border border-gray-300 rounded-lg text-xs bg-white"
                  >
                    {MAIN_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-24 sm:w-28 shrink-0 flex flex-col">
                  <label className="text-xs font-bold text-gray-600 h-8 shrink-0 flex items-end mb-1">
                    小分類
                  </label>
                  <Input
                    value={subCategory ?? ''}
                    onChange={(e) => onSubCategoryChange(e.target.value)}
                    placeholder="野菜"
                    className="h-10 box-border w-full text-xs border-gray-300 bg-white !py-0 px-2"
                  />
                </div>
                <div className="min-w-0 flex-1 basis-[12rem] flex flex-col">
                  <label className="text-xs font-bold text-gray-600 min-h-8 flex flex-wrap items-end gap-x-1 mb-1">
                    検索タグ
                    <span className="font-normal text-gray-400 text-[10px] sm:text-xs">
                      （カンマ区切り）
                    </span>
                  </label>
                  <Input
                    value={searchTagsDisplay}
                    onChange={(e) => onSearchTagsChange(e.target.value)}
                    placeholder="ねぎ, 青ねぎ"
                    className="h-10 box-border w-full text-sm border-gray-300 bg-white !py-0 px-2"
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <label className="block text-xs font-bold text-gray-600 min-h-8 flex flex-wrap items-end gap-x-1 mb-1">
              検索タグ
              <span className="font-normal text-gray-400">
                （買い物メモ・カンマ区切り）
              </span>
            </label>
            <Input
              value={searchTagsDisplay}
              onChange={(e) => onSearchTagsChange(e.target.value)}
              placeholder="ねぎ, 青ねぎ"
              className="h-10 box-border w-full text-sm border-gray-300 bg-white !py-0 px-2"
            />
          </div>
        )}
      </div>
    </div>
  )
}
