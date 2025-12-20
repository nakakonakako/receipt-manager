import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "icon";
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  className = "",
  children,
  ...props
}) => {
  const baseStyle =
    "font-bold rounded transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed";
  
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 py-2 px-6 shadow",
    secondary: "bg-gray-200 text-gray-700 hover:bg-gray-300 py-2 px-4",
    danger: "text-red-500 hover:text-red-700 px-2",
    icon: "text-blue-600 hover:text-blue-800 text-sm font-medium flex items-center"
  }

  return (
    <button
      className={`${baseStyle} ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
};