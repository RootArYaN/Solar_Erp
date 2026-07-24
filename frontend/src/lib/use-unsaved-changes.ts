import { useEffect } from 'react'

export function useUnsavedChanges(hasChanges: boolean): void {
  useEffect(() => {
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasChanges) return
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasChanges])
}
