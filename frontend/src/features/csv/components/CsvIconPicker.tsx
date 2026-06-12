import React from 'react'
import { PRESET_ICON_SUGGESTIONS, resolvePresetIcon } from '../utils/emoji'

interface CsvIconPickerProps {
  value: string
  onChange: (icon: string) => void
}

export const CsvIconPicker: React.FC<CsvIconPickerProps> = ({
  value,
  onChange,
}) => {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 shrink-0 flex items-center justify-center text-2xl bg-gray-50 border border-gray-200 rounded-lg">
          {resolvePresetIcon(value)}
        </div>
        <span className="text-sm text-gray-500 font-medium">
          下から選んでください
        </span>
      </div>
      <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5">
        {PRESET_ICON_SUGGESTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onChange(emoji)}
            className={`aspect-square flex items-center justify-center text-xl rounded-lg border transition-colors ${
              value === emoji
                ? 'bg-blue-100 border-blue-300'
                : 'bg-white border-gray-200 hover:bg-gray-50'
            }`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  )
}
