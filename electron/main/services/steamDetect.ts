// Steam User Detection Service
// Detects the currently logged-in Steam user from Steam's config files

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface SteamUser {
    steamId64: string
    accountId: number
    personaName: string
    mostRecent: boolean
}

/**
 * Get platform-specific Steam config paths
 */
function getSteamConfigPaths(): string[] {
    const paths: string[] = []
    const home = homedir()

    if (process.platform === 'linux') {
        paths.push(join(home, '.steam/steam/config'))
        paths.push(join(home, '.local/share/Steam/config'))
        paths.push(join(home, '.var/app/com.valvesoftware.Steam/.steam/steam/config'))
    } else if (process.platform === 'win32') {
        paths.push('C:\\Program Files (x86)\\Steam\\config')
        paths.push('C:\\Program Files\\Steam\\config')
    } else if (process.platform === 'darwin') {
        paths.push(join(home, 'Library/Application Support/Steam/config'))
    }

    return paths
}

/**
 * Parse VDF (Valve Data Format) file content
 * This is a simple parser for the loginusers.vdf format
 */
function parseVDF(content: string): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    const lines = content.split('\n')
    const stack: Array<Record<string, unknown>> = [result]
    let currentKey = ''

    for (const rawLine of lines) {
        const line = rawLine.trim()

        // Skip empty lines
        if (!line) continue

        // Opening brace - create new nested object
        if (line === '{') {
            const newObj: Record<string, unknown> = {}
            const parent = stack[stack.length - 1]
            parent[currentKey] = newObj
            stack.push(newObj)
            continue
        }

        // Closing brace - pop stack
        if (line === '}') {
            stack.pop()
            continue
        }

        // Key-value pair or just key
        // Format: "key" or "key" "value"
        const match = line.match(/^"([^"]+)"(?:\s+"([^"]*)")?$/)
        if (match) {
            const [, key, value] = match
            if (value !== undefined) {
                // Key-value pair
                const parent = stack[stack.length - 1]
                parent[key] = value
            } else {
                // Just a key (next line will be '{')
                currentKey = key
            }
        }
    }

    return result
}

/**
 * Convert SteamID64 to Account ID
 * SteamID64 = Account ID + 76561197960265728
 */
export function steamId64ToAccountId(steamId64: string): number {
    const id64 = BigInt(steamId64)
    const baseId = BigInt('76561197960265728')
    return Number(id64 - baseId)
}

/**
 * Convert Account ID to SteamID64
 */
export function accountIdToSteamId64(accountId: number): string {
    const baseId = BigInt('76561197960265728')
    return String(baseId + BigInt(accountId))
}

/**
 * Detect logged-in Steam users from loginusers.vdf
 */
export function detectSteamUsers(): SteamUser[] {
    const configPaths = getSteamConfigPaths()
    const users: SteamUser[] = []

    for (const configPath of configPaths) {
        const loginUsersPath = join(configPath, 'loginusers.vdf')

        if (!existsSync(loginUsersPath)) {
            continue
        }

        try {
            const content = readFileSync(loginUsersPath, 'utf-8')
            const data = parseVDF(content)

            // The root key is "users"
            const usersData = data['users'] as Record<string, Record<string, string>> | undefined
            if (!usersData) continue

            for (const [steamId64, userData] of Object.entries(usersData)) {
                if (typeof userData !== 'object') continue

                const personaName = userData['PersonaName'] || userData['personaname'] || 'Unknown'
                const mostRecent =
                    userData['MostRecent'] === '1' || userData['mostrecent'] === '1'

                users.push({
                    steamId64,
                    accountId: steamId64ToAccountId(steamId64),
                    personaName,
                    mostRecent,
                })
            }

            // If we found users, break (don't search other paths)
            if (users.length > 0) break
        } catch (err) {
            console.error('[detectSteamUsers] Error reading loginusers.vdf:', err)
        }
    }

    // Sort so most recent is first
    users.sort((a, b) => {
        if (a.mostRecent && !b.mostRecent) return -1
        if (!a.mostRecent && b.mostRecent) return 1
        return 0
    })

    return users
}

/**
 * Get the most recently logged-in Steam user
 */
export function getMostRecentSteamUser(): SteamUser | null {
    const users = detectSteamUsers()
    return users.find((u) => u.mostRecent) || users[0] || null
}

/**
 * Find a Steam user by account ID
 */
export function findSteamUserByAccountId(accountId: number): SteamUser | null {
    const users = detectSteamUsers()
    return users.find((u) => u.accountId === accountId) || null
}

/**
 * Validate that an account ID looks valid
 */
export function isValidAccountId(accountId: number): boolean {
    // Account IDs should be positive and reasonable size
    return accountId > 0 && accountId < 4294967295 // Max 32-bit unsigned
}

/**
 * Parse a Steam ID from various formats
 * Supports: SteamID64, Account ID, Steam profile URL
 */
export function parseSteamId(input: string): number | null {
    const trimmed = input.trim()

    // Check if it's a number (could be SteamID64 or Account ID)
    const numericMatch = trimmed.match(/^(\d+)$/)
    if (numericMatch) {
        const num = BigInt(numericMatch[1])

        // If it's larger than max 32-bit, it's probably a SteamID64
        if (num > BigInt(4294967295)) {
            const accountId = steamId64ToAccountId(numericMatch[1])
            if (isValidAccountId(accountId)) {
                return accountId
            }
        } else {
            // It's probably an Account ID
            const accountId = Number(num)
            if (isValidAccountId(accountId)) {
                return accountId
            }
        }
    }

    // Check for Steam profile URL
    // https://steamcommunity.com/profiles/76561198012345678
    // https://steamcommunity.com/id/customurl
    const profileMatch = trimmed.match(/steamcommunity\.com\/profiles\/(\d+)/)
    if (profileMatch) {
        const accountId = steamId64ToAccountId(profileMatch[1])
        if (isValidAccountId(accountId)) {
            return accountId
        }
    }

    return null
}
