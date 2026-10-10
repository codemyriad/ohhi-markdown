/**
 * The shell's paste/drop host (editor-usability E5) over a fake workspace:
 * the Obsidian setting is read, the placement and the name are Obsidian's, the
 * write goes through `writeAttachment`, the link is the shortest unique one,
 * and a note in a shared folder gets the honest notice — never a claim that
 * the picture synced.
 */
import { i18nObject } from '@ohhi/i18n/i18n-util'
import { describe, expect, it, vi } from 'vitest'
import { createAttachmentHost, loadAttachmentFolderSetting, OBSIDIAN_APP_CONFIG } from './attachment-host.js'
import type { Workspace } from './workspace.svelte.js'

const LL = i18nObject('en')
const AT = new Date(2026, 9, 10, 14, 3, 7).getTime()

function fakeWorkspace(opts: { files?: string[]; mounts?: string[]; app?: string | null } = {}) {
  const files = (opts.files ?? []).map((path) => ({ path, guid: path, kind: 'binary' as const }))
  const writes: { path: string; bytes: Uint8Array }[] = []
  const flash = vi.fn()
  const ws = {
    ui: { files, mounts: (opts.mounts ?? []).map((path) => ({ path })) },
    readAppFile: async (p: string) => (p === OBSIDIAN_APP_CONFIG ? (opts.app ?? null) : null),
    writeAttachment: async (path: string, bytes: Uint8Array) => {
      writes.push({ path, bytes })
      files.push({ path, guid: path, kind: 'binary' })
      return path
    },
    flash,
  } as unknown as Workspace
  return { ws, writes, flash }
}

const png = (name = 'image.png'): File => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0])], name, { type: 'image/png' })

describe('loadAttachmentFolderSetting', () => {
  it('reads attachmentFolderPath, and is null for the default, an absent file or bad JSON', async () => {
    expect(await loadAttachmentFolderSetting(async () => '{"attachmentFolderPath":"./"}')).toBe('./')
    expect(await loadAttachmentFolderSetting(async () => '{"alwaysUpdateLinks":true}')).toBeNull()
    expect(await loadAttachmentFolderSetting(async () => null)).toBeNull()
    expect(await loadAttachmentFolderSetting(async () => '{not json')).toBeNull()
    expect(
      await loadAttachmentFolderSetting(async () => {
        throw new Error('no')
      })
    ).toBeNull()
  })
})

describe('which files it takes', () => {
  it('is libs/workspace’s rule: pictures and PDFs, by name and then by type', () => {
    const host = createAttachmentHost({ workspace: () => null, notePath: () => null, now: () => AT })
    expect(host.accepts({ name: 'a.PNG', type: '' })).toBe(true)
    expect(host.accepts({ name: '', type: 'image/png' })).toBe(true)
    expect(host.accepts({ name: 'a.zip', type: 'image/png' })).toBe(false)
    expect(host.acceptsType('application/pdf')).toBe(true)
    expect(host.acceptsType('text/html')).toBe(false)
  })
})

describe('createAttachmentHost', () => {
  it("names a paste Obsidian's way at the vault root and links it by name", async () => {
    const { ws, writes, flash } = fakeWorkspace({ files: ['Notes/n.md'] })
    const host = createAttachmentHost({ workspace: () => ws, notePath: () => 'Notes/n.md', now: () => AT })
    const saved = await host.save([png()], 'paste')
    expect(writes.map((w) => w.path)).toEqual(['Pasted image 20261010140307.png'])
    expect(saved).toEqual([{ link: 'Pasted image 20261010140307.png' }])
    host.inserted?.(saved.filter((s) => s !== null))
    expect(flash).not.toHaveBeenCalled()
  })

  it('follows the Obsidian setting, keeps a dropped name and de-duplicates two pastes in one second', async () => {
    const { ws, writes } = fakeWorkspace({ app: '{"attachmentFolderPath":"./assets"}', files: ['Notes/assets/diagram.png'] })
    const host = createAttachmentHost({ workspace: () => ws, notePath: () => 'Notes/n.md', now: () => AT })
    await host.save([png('diagram.png')], 'drop')
    await host.save([png(), png()], 'paste')
    expect(writes.map((w) => w.path)).toEqual([
      'Notes/assets/diagram 1.png',
      'Notes/assets/Pasted image 20261010140307.png',
      'Notes/assets/Pasted image 20261010140307 1.png',
    ])
  })

  it('links by the shortest unique path when the name is taken elsewhere', async () => {
    const { ws } = fakeWorkspace({ app: '{"attachmentFolderPath":"./"}', files: ['Other/diagram.png'] })
    const host = createAttachmentHost({ workspace: () => ws, notePath: () => 'Notes/n.md', now: () => AT })
    expect(await host.save([png('diagram.png')], 'drop')).toEqual([{ link: 'Notes/diagram.png' }])
  })

  it('keeps a shared note’s picture in the share and says the picture has not synced', async () => {
    const { ws, writes, flash } = fakeWorkspace({ mounts: ['Team'] })
    const host = createAttachmentHost({ workspace: () => ws, notePath: () => 'Team/plan.md', now: () => AT })
    const saved = await host.save([png()], 'paste')
    expect(writes[0]!.path).toBe('Team/Pasted image 20261010140307.png')
    host.inserted?.(saved.filter((s) => s !== null))
    expect(flash).toHaveBeenCalledWith({
      level: 'info',
      text: LL.web.attachments.shared_notice({ share: 'Team' }),
      path: 'Team/plan.md',
    })
  })

  it('answers null for a file the workspace refused, and saves nothing without a note', async () => {
    const { ws } = fakeWorkspace()
    ;(ws as unknown as { writeAttachment: () => Promise<null> }).writeAttachment = async () => null
    const host = createAttachmentHost({ workspace: () => ws, notePath: () => 'n.md', now: () => AT })
    expect(await host.save([png()], 'paste')).toEqual([null])
    const none = createAttachmentHost({ workspace: () => ws, notePath: () => null, now: () => AT })
    expect(await none.save([png()], 'paste')).toEqual([null])
  })

  it('names the folder on the drop overlay', async () => {
    const { ws } = fakeWorkspace({ app: '{"attachmentFolderPath":"Attachments"}' })
    const host = createAttachmentHost({ workspace: () => ws, notePath: () => 'n.md', now: () => AT })
    await host.save([], 'drop') // the setting is read before every save
    expect(host.dropLabels(1, ['image/png'])).toEqual({
      title: LL.web.attachments.drop_title(),
      detail: LL.web.attachments.saved_in({ folder: 'Attachments' }),
    })
    const root = createAttachmentHost({ workspace: () => fakeWorkspace().ws, notePath: () => 'n.md', now: () => AT })
    expect(root.dropLabels(2, []).detail).toBe(
      LL.web.attachments.saved_in_many({ count: 2, folder: LL.web.attachments.vault_root() })
    )
  })
})
