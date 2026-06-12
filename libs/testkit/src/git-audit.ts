/**
 * Post-session vault audit: after any Editor session over a git-tracked
 * vault, the diff should contain only edits a human/agent actually made —
 * no churn (EOL flips, frontmatter reordering, whitespace noise).
 * V1 precondition (plans/slices.md): test subfolder git-committed clean
 * before a session; run this after.
 */
import { execFileSync } from 'node:child_process'

export interface GitAuditResult {
  clean: boolean
  /** `git status --porcelain` output (empty when clean). */
  status: string
  /** `git diff --stat` output for context. */
  diffStat: string
}

export function runGitAudit(vaultDir: string): GitAuditResult {
  const status = execFileSync('git', ['-C', vaultDir, 'status', '--porcelain'], {
    encoding: 'utf8',
  }).trim()
  const diffStat = execFileSync('git', ['-C', vaultDir, 'diff', '--stat'], {
    encoding: 'utf8',
  }).trim()
  return { clean: status.length === 0, status, diffStat }
}
