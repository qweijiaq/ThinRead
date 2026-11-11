import { useCallback, useEffect, useState } from 'react'

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
  /** 成书页一旦打开就保持挂载，切视图时不会丢失进度和结果。 */
  composeMountedBookId: string | null
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
  const [composeMountedBookId, setComposeMountedBookId] = useState<string | null>(null)
  const [contentFocusId, setContentFocusId] = useState<string | null>(null)

  const leaveReader = useCallback(() => {
    resetGeneration()
    clearBook()
    setComposeMountedBookId(null)
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
      const mounted = targetBookId ?? bookId
      if (mounted) setComposeMountedBookId(mounted)
      setMainView('compose')
    },
    [bookId, openBook],
  )

  // 通过搜索等方式切换了书，但视图仍在成书页时，直接为当前书挂载。
  useEffect(() => {
    if (mainView === 'compose' && bookId) setComposeMountedBookId(bookId)
  }, [mainView, bookId])

  return {
    settingsOpen,
    setSettingsOpen,
    searchOpen,
    setSearchOpen,
    mainView,
    setMainView,
    labMounted,
    setLabMounted,
    composeMountedBookId,
    contentFocusId,
    setContentFocusId,
    leaveReader,
    openLab,
    openCompose,
  }
}
