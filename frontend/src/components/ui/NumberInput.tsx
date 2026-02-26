import React from 'react'

interface NumberInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'value'
> {
  value: number | ''
  onChange: (value: number | string) => void
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

    val = val.replace(/(?!^-)[^0-9]/g, '')

    const isNagative = val.startsWith('-')
    const numPart = val.replace('-', '')

    if (numPart.length > 1 && numPart.startsWith('0')) {
      val = isNagative
        ? '-' + numPart.replace(/^0+/, '')
        : val.replace(/^0+/, '')
    }

    if (maxLength && numPart.length > maxLength) {
      val = val.slice(0, isNagative ? maxLength + 1 : maxLength)
    }

    if (val === '-' || val === '') {
      onChange(val)
    } else {
      onChange(Number(val))
    }
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
