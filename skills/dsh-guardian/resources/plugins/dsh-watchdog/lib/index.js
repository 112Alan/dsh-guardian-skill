// dsh-watchdog (host plugin)
// 1. Settings card: registers the 'watchdog' namespace (enabled / intervalSeconds /
//    watchVisionProxy) into ~/.dsh/settings.yaml; the watchdog script re-reads it
//    every loop.
// 2. On startup spawns watchdog.ps1 (detached) if no live watchdog exists.
// 3. Clears the intentional-stop marker on startup.
// 4. /dsh-stop command: writes the stop marker and exits the process.
//
// Bulletproof: every section is try/catch guarded and logs to
// C:\Users\16021\AppData\Local\dsh\dsh-watchdog-plugin.log so a failure in one
// part never kills the whole fiber and the real error is always visible.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'

export const name = 'dsh-watchdog'

const WATCHDOG_DIR = 'C:\\Users\\16021\\AppData\\Local\\dsh'
const WATCHDOG_SCRIPT = path.join(WATCHDOG_DIR, 'watchdog.ps1')
const PID_FILE = path.join(WATCHDOG_DIR, 'watchdog.pid')
const STOP_MARKER = path.join(WATCHDOG_DIR, 'watchdog.stop')
const DIAG_LOG = path.join(WATCHDOG_DIR, 'dsh-watchdog-plugin.log')

function logDiag(msg) {
  try { fs.appendFileSync(DIAG_LOG, new Date().toISOString() + '  ' + msg + '\n') } catch {}
}

const Config = z.object({
  enabled: z.boolean().default(true),
  intervalSeconds: z.number().min(2).max(300).default(10),
  watchVisionProxy: z.boolean().default(false),
})

export function apply(ctx) {
  const entry = { enabled: true, intervalSeconds: 10, watchVisionProxy: false }
  let current = () => entry
  logDiag('apply start')

  // --- settings card ---
  try {
    installSettingsSection(ctx, settingsNamespace('watchdog'), Config, entry, {
      setSource: (source) => { current = () => source(); logDiag('settings scope attached') },
      onChange: () => {},
      validate: (value) => {
        if (value.intervalSeconds < 2) throw new Error('watchdog: intervalSeconds must be >= 2')
      },
    })
    logDiag('settings section installed')
  } catch (e) {
    logDiag('settings section FAILED: ' + String(e && e.message || e))
  }

  function watchdogAlive() {
    try {
      const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim())
      if (!Number.isFinite(pid) || pid <= 0) return false
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  }

  function ensureWatchdog() {
    try {
      if (!current().enabled) return
      if (!fs.existsSync(WATCHDOG_SCRIPT)) return
      if (watchdogAlive()) return
      const child = spawn('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-WindowStyle', 'Hidden',
        '-File', WATCHDOG_SCRIPT,
        '-Detached',
      ], { detached: true, stdio: 'ignore' })
      child.unref()
      logDiag('watchdog spawned')
    } catch (e) {
      logDiag('ensureWatchdog FAILED: ' + String(e && e.message || e))
    }
  }

  // --- startup: clear stop marker + ensure watchdog ---
  try { fs.rmSync(STOP_MARKER, { force: true }) } catch {}
  ensureWatchdog()

  // --- periodic re-arm (60s) ---
  try {
    ctx.inject(['timer'], (tctx) => {
      const disposeArm = tctx.timer.interval(() => ensureWatchdog(), 60000)
      tctx.effect(() => disposeArm)
      logDiag('re-arm timer installed')
    })
  } catch (e) {
    logDiag('timer setup FAILED: ' + String(e && e.message || e))
  }

  // --- /dsh-stop command ---
  try {
    ctx.inject(['commands'], (cctx) => {
      const disposeCommand = cctx.commands.register({
        name: 'dsh-stop',
        description: 'Stop DSH (the watchdog will NOT restart it). Restart by opening the DeepSeek Harness shortcut.',
        handler: async () => {
          try { fs.writeFileSync(STOP_MARKER, new Date().toISOString(), 'utf8') } catch {}
          logDiag('/dsh-stop: stop marker written; exiting')
          setTimeout(() => process.exit(0), 300)
          return { kind: 'success', text: 'Stop marker written; DSH is exiting (watchdog will not restart it).' }
        },
      })
      cctx.effect(() => disposeCommand)
      logDiag('command /dsh-stop registered')
    })
  } catch (e) {
    logDiag('command registration FAILED: ' + String(e && e.message || e))
  }

  logDiag('apply complete')
}
