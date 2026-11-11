import type { InputHTMLAttributes } from 'react'

type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  wrapClassName?: string
}

export function DateInput({ wrapClassName = 'px-3', className = '', ...props }: DateInputProps) {
  return (
    <div className={`rm-field rm-date-wrap w-full ${wrapClassName}`}>
      <input type="date" className={`rm-date-input ${className}`} {...props} />
    </div>
  )
}
