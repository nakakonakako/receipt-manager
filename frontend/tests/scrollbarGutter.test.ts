import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

const indexCss = new URL('../src/index.css', import.meta.url)
const mainLayout = new URL('../src/components/MainLayout.tsx', import.meta.url)
const chatInterface = new URL(
  '../src/features/search/components/ChatInterface.tsx',
  import.meta.url
)

describe('scrollbar gutter styling', () => {
  it('reserves a thin, visible scrollbar only in the shared scroll containers', async () => {
    const css = await readFile(indexCss, 'utf8')
    const layout = await readFile(mainLayout, 'utf8')
    const chat = await readFile(chatInterface, 'utf8')

    assert.doesNotMatch(css, /html\s*\{[^}]*scrollbar-gutter\s*:/)
    assert.match(
      css,
      /\.rm-scrollbar-stable\s*\{\s*scrollbar-gutter:\s*stable;\s*scrollbar-width:\s*thin;\s*scrollbar-color:\s*#8b8580 transparent;\s*\}/
    )
    assert.match(layout, /overflow-y-auto rm-scrollbar-stable/)
    assert.match(chat, /overflow-y-auto rm-scrollbar-stable/)
  })
})
