import { useCallback, useState } from 'react'

export type MainView = 'reader' | 'notes' | 'map' | 'lab' | 'compose' | 'content' | 'stats' | 'weekly' | 'manual'

interface ViewOptions {
  bookId: string | null
  openBook(bookId: string): Promise<void>
  clearBook(): void
  resetGeneration(): void
  resetOrganize(): void
}

export interface ViewState {
  settingsOpen: boolean
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>
  searchOpen: boolean
  setSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  mainView: MainView
  setMainView: React.Dispatch<React.SetStateAction<MainView>>
  labMounted: boolean
  setLabMounted: React.Dispatch<React.SetStateAction<boolean>>
  contentFocusId: string | null
  setContentFocusId: React.Dispatch<React.SetStateAction<string | null>>
  leaveReader(): void
  openLab(): void
  openCompose(bookId?: string): Promise<void>
}

/** 顶栏视图切换和对话框开关：书架/阅读器/地图/工作台/成书/内容库。 */
export function useViews(options: ViewOptions): ViewState {
  const { bookId, openBook, clearBook, resetGeneration, resetOrganize } = options
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [mainView, setMainView] = useState<MainView>('reader')
  const [labMounted, setLabMounted] = useState(false)
  const [contentFocusId, setContentFocusId] = useState<string | null>(null)

  const leaveReader = useCallback(() => {
    resetGeneration()
    clearBook()
    setMainView('reader')
    resetOrganize()
  }, [clearBook, resetGeneration, resetOrganize])

  const openLab = useCallback(() => {
    setLabMounted(true)
    setMainView('lab')
  }, [])

  const openCompose = useCallback(
    async (targetBookId?: string) => {
      if (targetBookId && bookId !== targetBookId) await openBook(targetBookId)
      setMainView('compose')
    },
    [bookId, openBook],
  )

  return {
    settingsOpen,
    setSettingsOpen,
    searchOpen,
    setSearchOpen,
    mainView,
    setMainView,
    labMounted,
    setLabMounted,
    contentFocusId,
    setContentFocusId,
    leaveReader,
    openLab,
    openCompose,
  }
}
