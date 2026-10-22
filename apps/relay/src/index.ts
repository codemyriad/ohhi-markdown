/** Library surface of the relay, for hosts that embed it (apps/nextcloud). */
export {
  createRelay,
  RoomCapError,
  type Relay,
  type RelayOptions,
  type RelayHooks,
  type RoomCaps,
  type AuthenticateInput,
  type AuthenticateResult,
} from './server.ts'
export { RelayDb, MAX_ANCESTRY_HOPS, type Share, type ShareKind } from './db.ts'
