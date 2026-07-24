import { useEffect, useState } from "react"

export interface DrawerProps {
  isOpen: boolean
  onClose: () => void
  title?: React.ReactNode
  children: React.ReactNode
  width?: string
  noPadding?: boolean
}

export function Drawer({ isOpen, onClose, title, children, width = "w-full sm:w-[540px] md:w-[720px] lg:w-[900px] xl:w-[1100px]", noPadding }: DrawerProps) {
  const [mounted, setMounted] = useState(false)

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onClose])

  // Delay unmounting to allow for exit animation
  useEffect(() => {
    if (isOpen) {
      setMounted(true)
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
      const timer = setTimeout(() => setMounted(false), 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  if (!mounted) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div 
        className={`fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Drawer Panel */}
      <div 
        className={`fixed inset-y-0 right-0 z-50 flex flex-col border-l border-border bg-background shadow-2xl transition-transform duration-300 ease-in-out transform ${isOpen ? "translate-x-0" : "translate-x-full"} ${width}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div className="text-lg font-semibold">{title}</div>
          <button 
            onClick={onClose}
            className="flex items-center justify-center rounded-lg p-2 text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-colors"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>
        
        {/* Content */}
        <div className={`flex-1 overflow-y-auto flex flex-col ${noPadding ? "" : "p-6"}`}>
          {children}
        </div>
      </div>
    </div>
  )
}
