/**
 * Imported FIRST by `main.ts`, so it runs before any module that reads config
 * at import time (the theme, the pane hints). Inside Nextcloud the uid is not
 * known yet — `prepareNextcloudHost` asks `/api/me` before the shell mounts —
 * so until then every key resolves under a namespace no uid can have: an
 * import-time read or a first-run write never lands in the un-namespaced keys
 * another account on the same origin would share (decision 16).
 */
import { detectHost, setStorageNamespace } from '../host.js'
import { UNKNOWN_NAMESPACE } from './host-boot.js'

if (detectHost().kind === 'nextcloud') setStorageNamespace(UNKNOWN_NAMESPACE)
