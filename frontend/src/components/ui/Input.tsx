import React from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

export const Input: React.FC<InputProps> = ({
  label,
  className = '',
  ...props
}) => {
  const inputClassName = [
    'w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none transition-shadow',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (label) {
    return (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
        <input className={inputClassName} {...props} />
      </div>
    )
  }

  return <input className={inputClassName} {...props} />
}
