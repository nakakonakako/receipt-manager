import React from 'react'

interface NumberInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'value'
> {
  value: number | ''
  onChange: (value: number | '') => void
  maxLength?: number
}

export const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onChange,
  maxLength = 7,
  className = '',
  ...props
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value

    val = val.replace(/\D/g, '')

    if (val.length > 1 && val.startsWith('0')) {
      val = val.replace(/^0+/, '')
      if (val === '') val = '0'
    }

    if (maxLength && val.length > maxLength) {
      val = val.slice(0, maxLength)
    }

    onChange(val === '' ? '' : Number(val))
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={value}
      onChange={handleChange}
      className={`p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none ${className}`}
      {...props}
    />
  )
}
