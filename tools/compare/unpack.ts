import { execFileSync } from 'node:child_process'

/**
 * Unpacks a tar archive into `dir`, which must exist. The folder goes in as `cwd`, not `-C`: GNU tar, the one in Git Bash,
 * unquotes its arguments, so the `\b` in `C:\...\base` was a backspace and the folder didn't exist (#307).
 */
export function unpack(archive: Buffer, dir: string): void {
  execFileSync('tar', ['-x'], { cwd: dir, input: archive })
}
