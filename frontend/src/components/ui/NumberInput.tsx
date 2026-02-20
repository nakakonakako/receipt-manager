import React from 'react'
import { Input } from './Input'

interface NumberInputProps {
  value: number | ''
  onChange: (value: number | '') => void
  className?: string
}

export const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onChange,
  className,
}) => {
  return (
    <Input
      type="number"
      className={`text-right ${className || ''}`}
      value={value}
      onChange={(e) => {
        const val = e.target.value
        onChange(val === '' ? '' : Number(val))
      }}
      onBlur={() => {
        if (value === '') {
          onChange(0)
        }
      }}
      onKeyDown={(e) => {
        if (['e', 'E', '+', '-'].includes(e.key)) {
          e.preventDefault()
        }
      }}
    />
  )
}
