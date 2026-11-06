import React from 'react'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'icon'
  children: React.ReactNode
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  className = '',
  children,
  ...props
}) => {
  const baseStyle =
    'min-h-11 sm:min-h-9 inline-flex items-center justify-center gap-2 font-semibold rounded-md transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed disabled:active:translate-y-0'

  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 py-2 px-5 shadow-sm',
    secondary: 'border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 active:bg-stone-100 py-2 px-4',
    danger: 'text-red-700 hover:bg-red-50 active:bg-red-100 px-3',
    icon: 'text-blue-700 hover:bg-blue-50 active:bg-blue-100 px-3 text-sm',
  }

  return (
    <button
      className={`${baseStyle} ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
