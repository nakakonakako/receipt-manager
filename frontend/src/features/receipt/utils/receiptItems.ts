import type { EditingItem, ReceiptItem } from '../types/index.ts'

export function emptyLineItem(): EditingItem {
  return {
    item_name: '',
    price: '',
    main_category: '食費',
    sub_category: 'その他',
    search_tags: [],
  }
}

export function toSavedItem(item: EditingItem): ReceiptItem {
  return {
    item_name: item.item_name.trim(),
    price: item.price === '' ? 0 : item.price,
    main_category: (item.main_category ?? 'その他').trim() || 'その他',
    sub_category: (item.sub_category ?? 'その他').trim() || 'その他',
    search_tags: (item.search_tags ?? []).filter((tag) => tag.trim().length > 0),
  }
}
