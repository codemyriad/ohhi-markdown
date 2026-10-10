/**
 * Attachment placement, naming and link text (editor-usability E5) — pure.
 * The oracle is Obsidian: `attachmentFolderPath` in `.obsidian/app.json`
 * (Chris's vault has none, so the vault root), and `Pasted image
 * YYYYMMDDHHmmss.png` for a paste.
 */
import { describe, expect, it } from 'vitest'
import {
  attachmentFolder,
  attachmentLinkText,
  cleanAttachmentName,
  dedupeName,
  extensionForType,
  isAttachmentFile,
  pasteStamp,
  placeAttachment,
} from '../src/attachments.js'

// Local time on purpose: Obsidian stamps in the device's own time zone.
const AT = new Date(2026, 9, 10, 14, 3, 7).getTime()
const none = new Set<string>()

describe('pasteStamp', () => {
  it('is YYYYMMDDHHmmss, zero-padded, local time', () => {
    expect(pasteStamp(AT)).toBe('20261010140307')
    expect(pasteStamp(new Date(2027, 0, 2, 3, 4, 5).getTime())).toBe('20270102030405')
  })
})

describe('attachmentFolder — Obsidian\'s setting', () => {
  const note = 'Projects/Roadmap/plan.md'
  it.each([
    [undefined, ''],
    [null, ''],
    ['', ''],
    ['/', ''],
    ['./', 'Projects/Roadmap'],
    ['.', 'Projects/Roadmap'],
    ['./assets', 'Projects/Roadmap/assets'],
    ['./assets/', 'Projects/Roadmap/assets'],
    ['./../shared', 'Projects/shared'],
    ['Attachments', 'Attachments'],
    ['Files/Images/', 'Files/Images'],
  ])('%s → %j', (setting, folder) => {
    expect(attachmentFolder({ notePath: note, mountPath: '', attachmentFolderPath: setting })).toBe(folder)
  })

  it('a note at the vault root with ./ is the vault root', () => {
    expect(attachmentFolder({ notePath: 'a.md', mountPath: '', attachmentFolderPath: './' })).toBe('')
  })

  it('never resolves into an app folder or out of the vault', () => {
    expect(attachmentFolder({ notePath: 'n/a.md', mountPath: '', attachmentFolderPath: '.obsidian' })).toBe('n')
    expect(attachmentFolder({ notePath: 'n/a.md', mountPath: '', attachmentFolderPath: '.ohhi/x' })).toBe('n')
    expect(attachmentFolder({ notePath: 'a.md', mountPath: '', attachmentFolderPath: './../..' })).toBe('')
  })
})

describe('attachmentFolder — a note in a shared folder keeps the file in the share', () => {
  const note = 'Team/notes/plan.md'
  it.each([
    ['/', 'Team'],
    [undefined, 'Team'],
    ['Attachments', 'Team/Attachments'],
    ['./', 'Team/notes'],
    ['./img', 'Team/notes/img'],
    ['./../..', 'Team'],
    ['../outside', 'Team'],
    ['Team/Pics', 'Team/Pics'],
  ])('%s → %j', (setting, folder) => {
    expect(attachmentFolder({ notePath: note, mountPath: 'Team', attachmentFolderPath: setting })).toBe(folder)
  })

  it('a nested share reads the rule against its own root', () => {
    expect(
      attachmentFolder({ notePath: 'Work/Team/a.md', mountPath: 'Work/Team', attachmentFolderPath: '/' })
    ).toBe('Work/Team')
  })
})

describe('placeAttachment', () => {
  it('names a paste the way Obsidian does', () => {
    expect(placeAttachment({ notePath: 'n/a.md', mountPath: '', type: 'image/png', at: AT, taken: none })).toEqual({
      path: 'Pasted image 20261010140307.png',
      folder: '',
      name: 'Pasted image 20261010140307.png',
    })
  })

  it('takes the extension from the media type', () => {
    const at = { notePath: 'a.md', mountPath: '', at: AT, taken: none }
    expect(placeAttachment({ ...at, type: 'image/jpeg' }).name).toBe('Pasted image 20261010140307.jpg')
    expect(placeAttachment({ ...at, type: 'image/svg+xml' }).name).toBe('Pasted image 20261010140307.svg')
    expect(placeAttachment({ ...at, type: 'image/webp' }).name).toBe('Pasted image 20261010140307.webp')
  })

  it('de-duplicates with " 1", " 2" — case-insensitively, as a Mac or Windows disk would', () => {
    const taken = new Set(['Pasted image 20261010140307.png', 'pasted image 20261010140307 1.PNG'])
    expect(placeAttachment({ notePath: 'a.md', mountPath: '', type: 'image/png', at: AT, taken }).path).toBe(
      'Pasted image 20261010140307 2.png'
    )
  })

  it('a dropped file keeps its own name, cleaned and de-duplicated, in the setting\'s folder', () => {
    const taken = new Set(['Attachments/diagram.png'])
    expect(
      placeAttachment({
        notePath: 'a.md',
        mountPath: '',
        attachmentFolderPath: 'Attachments',
        type: 'image/png',
        fileName: 'diagram.png',
        at: AT,
        taken,
      })
    ).toEqual({ path: 'Attachments/diagram 1.png', folder: 'Attachments', name: 'diagram 1.png' })
  })

  it('a dropped file with no extension gets one from its type', () => {
    expect(
      placeAttachment({ notePath: 'a.md', mountPath: '', type: 'image/gif', fileName: 'loop', at: AT, taken: none }).name
    ).toBe('loop.gif')
  })

  it('places a shared note\'s paste inside the share', () => {
    expect(
      placeAttachment({ notePath: 'Team/plan.md', mountPath: 'Team', type: 'image/png', at: AT, taken: none }).path
    ).toBe('Team/Pasted image 20261010140307.png')
  })
})

describe('dedupeName', () => {
  it('keeps a free name and suffixes before the extension', () => {
    expect(dedupeName('', 'a.png', none)).toBe('a.png')
    expect(dedupeName('f', 'a.png', new Set(['f/a.png']))).toBe('f/a 1.png')
    expect(dedupeName('', 'README', new Set(['README']))).toBe('README 1')
  })
})

describe('cleanAttachmentName', () => {
  it('drops the folder part and the characters a name or a link cannot hold', () => {
    expect(cleanAttachmentName('C:\\Users\\me\\shot.png')).toBe('shot.png')
    expect(cleanAttachmentName('a/b/c.png')).toBe('c.png')
    expect(cleanAttachmentName('fig [1] #2 | v^3?.png')).toBe('fig -1- -2 - v-3-.png')
    expect(cleanAttachmentName('.hidden.png')).toBe('hidden.png')
  })
})

describe('types', () => {
  it('knows the pictures and PDFs, nothing else', () => {
    for (const n of ['a.png', 'a.JPG', 'a.jpeg', 'a.gif', 'a.webp', 'a.avif', 'a.svg', 'a.bmp', 'a.pdf']) {
      expect(isAttachmentFile(n, '')).toBe(true)
    }
    expect(isAttachmentFile('a.zip', 'application/zip')).toBe(false)
    expect(isAttachmentFile('a.txt', 'image/png')).toBe(false)
    expect(isAttachmentFile('', 'image/png')).toBe(true)
    expect(extensionForType('image/jpeg')).toBe('jpg')
    expect(extensionForType('text/plain')).toBe('')
  })
})

describe('attachmentLinkText', () => {
  it('is the bare name when no other file shares it', () => {
    expect(attachmentLinkText('Attachments/x.png', ['Attachments/x.png', 'a.md', 'y.png'])).toBe('x.png')
  })

  it('is the shortest unique trailing path when the name is taken elsewhere', () => {
    const files = ['a/img/x.png', 'b/img/x.png', 'c/x.png']
    expect(attachmentLinkText('c/x.png', files)).toBe('c/x.png')
    expect(attachmentLinkText('a/img/x.png', files)).toBe('a/img/x.png')
    expect(attachmentLinkText('d/pics/x.png', ['a/x.png', 'd/pics/x.png'])).toBe('pics/x.png')
  })

  it('compares names case-insensitively, as Obsidian resolves them', () => {
    expect(attachmentLinkText('a/X.png', ['a/X.png', 'b/x.PNG'])).toBe('a/X.png')
  })
})
