import React, { useId } from 'react'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

export const Input: React.FC<InputProps> = ({
  label,
  className = '',
  ...props
}) => {
  const generatedId = useId()
  const inputId = props.id ?? generatedId
  const inputClassName = [
    'rm-field w-full px-3 py-2 focus:border-blue-600',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (label) {
    return (
      <div>
        <label htmlFor={inputId} className="block text-sm font-medium text-stone-700 mb-1">
          {label}
        </label>
        <input id={inputId} className={inputClassName} {...props} />
      </div>
    )
  }

  return <input className={inputClassName} {...props} />
}
