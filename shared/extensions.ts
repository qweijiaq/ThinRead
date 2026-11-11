export type ExtensionCapability =
  | 'browser:capture'
  | 'reader:quote'
  | 'notes:write'
  | 'model:call'
  | 'network:fetch'
  | 'ui:panel'

export interface ExtensionManifest {
  id: string
  name: string
  description: string
  capabilities: ExtensionCapability[]
  entry: string
}

/** 当前内置扩展；未来可替换成从 extensions/ 目录读取的清单。 */
export const BUILTIN_EXTENSIONS: ExtensionManifest[] = [
  {
    id: 'browser-capture',
    name: '浏览器网页收录',
    description: '把当前网页或选中段落发送到 ThinRead。',
    capabilities: ['browser:capture'],
    entry: 'browser-extension/',
  },
]
