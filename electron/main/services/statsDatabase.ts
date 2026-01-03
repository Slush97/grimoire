// Deadlock Stats Database Service
// SQLite storage for player stats, match history, and MMR tracking

import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import type {
    TrackedPlayer,
    MMRSnapshot,
    StoredMatch,
    HeroStatsSnapshot,
    AggregatedStats,
    PlayerSteamProfile,
    PlayerMMR,
    PlayerMatch,
    PlayerHeroStat,
} from '../../../src/types/deadlock-stats'

let db: Database.Database | null = null

/**
 * Get the database file path
 */
function getDbPath(): string {
    const userDataPath = app.getPath('userData')
    return path.join(userDataPath, 'stats.db')
}

/**
 * Initialize the database connection and create tables
 */
export function initDatabase(): Database.Database {
    if (db) return db

    const dbPath = getDbPath()
    console.log('[StatsDatabase] Initializing database at:', dbPath)

    // Ensure directory exists
    const dir = path.dirname(dbPath)
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
    }

    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')

    // Create tables
    db.exec(`
        -- Tracked players
        CREATE TABLE IF NOT EXISTS players (
            account_id INTEGER PRIMARY KEY,
            steam_id TEXT,
            persona_name TEXT,
            avatar_url TEXT,
            is_primary INTEGER DEFAULT 0,
            added_at INTEGER DEFAULT (unixepoch()),
            last_updated INTEGER
        );

        -- Historical MMR snapshots (for charting trends)
        CREATE TABLE IF NOT EXISTS mmr_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            mmr INTEGER,
            rank INTEGER,
            rank_badge INTEGER,
            rank_tier TEXT,
            snapshot_date TEXT NOT NULL,
            created_at INTEGER DEFAULT (unixepoch()),
            UNIQUE(account_id, snapshot_date),
            FOREIGN KEY (account_id) REFERENCES players(account_id) ON DELETE CASCADE
        );

        -- Full match history with all details
        CREATE TABLE IF NOT EXISTS match_history (
            match_id INTEGER NOT NULL,
            account_id INTEGER NOT NULL,
            hero_id INTEGER,
            hero_name TEXT,
            start_time INTEGER,
            duration_s INTEGER,
            game_mode INTEGER,
            match_outcome TEXT,
            player_team TEXT,
            kills INTEGER,
            deaths INTEGER,
            assists INTEGER,
            last_hits INTEGER,
            denies INTEGER,
            net_worth INTEGER,
            player_damage INTEGER,
            player_healing INTEGER,
            obj_damage INTEGER,
            items TEXT,
            fetched_at INTEGER DEFAULT (unixepoch()),
            PRIMARY KEY (match_id, account_id),
            FOREIGN KEY (account_id) REFERENCES players(account_id) ON DELETE CASCADE
        );

        -- Per-hero stats snapshots (weekly trends)
        CREATE TABLE IF NOT EXISTS hero_stats_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_id INTEGER NOT NULL,
            hero_id INTEGER NOT NULL,
            hero_name TEXT,
            matches_played INTEGER,
            wins INTEGER,
            losses INTEGER,
            total_kills INTEGER,
            total_deaths INTEGER,
            total_assists INTEGER,
            avg_damage REAL,
            avg_healing REAL,
            snapshot_date TEXT NOT NULL,
            UNIQUE(account_id, hero_id, snapshot_date),
            FOREIGN KEY (account_id) REFERENCES players(account_id) ON DELETE CASCADE
        );

        -- Computed aggregated stats
        CREATE TABLE IF NOT EXISTS aggregated_stats (
            account_id INTEGER PRIMARY KEY,
            total_matches INTEGER DEFAULT 0,
            total_wins INTEGER DEFAULT 0,
            total_losses INTEGER DEFAULT 0,
            total_kills INTEGER DEFAULT 0,
            total_deaths INTEGER DEFAULT 0,
            total_assists INTEGER DEFAULT 0,
            current_win_streak INTEGER DEFAULT 0,
            best_win_streak INTEGER DEFAULT 0,
            current_loss_streak INTEGER DEFAULT 0,
            worst_loss_streak INTEGER DEFAULT 0,
            last_match_id INTEGER,
            last_updated INTEGER,
            FOREIGN KEY (account_id) REFERENCES players(account_id) ON DELETE CASCADE
        );

        -- Stats settings
        CREATE TABLE IF NOT EXISTS stats_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        -- Indexes for performance
        CREATE INDEX IF NOT EXISTS idx_mmr_snapshots_account ON mmr_snapshots(account_id, snapshot_date DESC);
        CREATE INDEX IF NOT EXISTS idx_match_history_account ON match_history(account_id, start_time DESC);
        CREATE INDEX IF NOT EXISTS idx_match_history_hero ON match_history(account_id, hero_id);
        CREATE INDEX IF NOT EXISTS idx_hero_stats_account ON hero_stats_snapshots(account_id, snapshot_date DESC);
    `)

    console.log('[StatsDatabase] Database initialized successfully')
    return db
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
    if (db) {
        db.close()
        db = null
    }
}

// ============================================
// Player Management
// ============================================

/**
 * Add a tracked player
 */
export function addTrackedPlayer(profile: PlayerSteamProfile, isPrimary = false): void {
    const database = initDatabase()
    const stmt = database.prepare(`
        INSERT INTO players (account_id, steam_id, persona_name, avatar_url, is_primary, last_updated)
        VALUES (@account_id, @steam_id, @persona_name, @avatar_url, @is_primary, unixepoch())
        ON CONFLICT(account_id) DO UPDATE SET
            steam_id = excluded.steam_id,
            persona_name = excluded.persona_name,
            avatar_url = excluded.avatar_url,
            is_primary = CASE WHEN excluded.is_primary = 1 THEN 1 ELSE players.is_primary END,
            last_updated = excluded.last_updated
    `)
    stmt.run({
        account_id: profile.account_id,
        steam_id: profile.steam_id,
        persona_name: profile.persona_name,
        avatar_url: profile.avatar_url,
        is_primary: isPrimary ? 1 : 0,
    })

    // If setting as primary, unset other primaries
    if (isPrimary) {
        database
            .prepare('UPDATE players SET is_primary = 0 WHERE account_id != ?')
            .run(profile.account_id)
    }

    // Initialize aggregated stats
    database
        .prepare(
            `
        INSERT OR IGNORE INTO aggregated_stats (account_id, last_updated)
        VALUES (?, unixepoch())
    `
        )
        .run(profile.account_id)
}

/**
 * Remove a tracked player (cascades to all related data)
 */
export function removeTrackedPlayer(accountId: number): void {
    const database = initDatabase()
    database.prepare('DELETE FROM players WHERE account_id = ?').run(accountId)
}

/**
 * Get all tracked players
 */
export function getTrackedPlayers(): TrackedPlayer[] {
    const database = initDatabase()
    const rows = database
        .prepare('SELECT * FROM players ORDER BY is_primary DESC, added_at DESC')
        .all() as TrackedPlayer[]
    return rows
}

/**
 * Get the primary player
 */
export function getPrimaryPlayer(): TrackedPlayer | null {
    const database = initDatabase()
    const row = database
        .prepare('SELECT * FROM players WHERE is_primary = 1')
        .get() as TrackedPlayer | undefined
    return row || null
}

/**
 * Set a player as primary
 */
export function setPrimaryPlayer(accountId: number): void {
    const database = initDatabase()
    database.prepare('UPDATE players SET is_primary = 0').run()
    database.prepare('UPDATE players SET is_primary = 1 WHERE account_id = ?').run(accountId)
}

/**
 * Update player profile
 */
export function updatePlayerProfile(profile: PlayerSteamProfile): void {
    const database = initDatabase()
    database
        .prepare(
            `
        UPDATE players SET
            steam_id = ?,
            persona_name = ?,
            avatar_url = ?,
            last_updated = unixepoch()
        WHERE account_id = ?
    `
        )
        .run(profile.steam_id, profile.persona_name, profile.avatar_url, profile.account_id)
}

// ============================================
// MMR Snapshots
// ============================================

/**
 * Save an MMR snapshot (one per day per player)
 */
export function saveMMRSnapshot(mmr: PlayerMMR): void {
    const database = initDatabase()
    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD

    database
        .prepare(
            `
        INSERT INTO mmr_snapshots (account_id, mmr, rank, rank_badge, rank_tier, snapshot_date)
        VALUES (@account_id, @mmr, @rank, @rank_badge, @rank_tier, @snapshot_date)
        ON CONFLICT(account_id, snapshot_date) DO UPDATE SET
            mmr = excluded.mmr,
            rank = excluded.rank,
            rank_badge = excluded.rank_badge,
            rank_tier = excluded.rank_tier
    `
        )
        .run({
            account_id: mmr.account_id,
            mmr: mmr.mmr,
            rank: mmr.rank,
            rank_badge: mmr.rank_badge,
            rank_tier: mmr.rank_tier,
            snapshot_date: today,
        })
}

/**
 * Get MMR history for a player
 */
export function getMMRHistory(accountId: number, limit = 30): MMRSnapshot[] {
    const database = initDatabase()
    const rows = database
        .prepare(
            `
        SELECT * FROM mmr_snapshots
        WHERE account_id = ?
        ORDER BY snapshot_date DESC
        LIMIT ?
    `
        )
        .all(accountId, limit) as MMRSnapshot[]
    return rows.reverse() // Return chronological order
}

/**
 * Get latest MMR for a player
 */
export function getLatestMMR(accountId: number): MMRSnapshot | null {
    const database = initDatabase()
    const row = database
        .prepare(
            `
        SELECT * FROM mmr_snapshots
        WHERE account_id = ?
        ORDER BY snapshot_date DESC
        LIMIT 1
    `
        )
        .get(accountId) as MMRSnapshot | undefined
    return row || null
}

// ============================================
// Match History
// ============================================

/**
 * Save matches to history
 */
export function saveMatches(accountId: number, matches: PlayerMatch[]): void {
    const database = initDatabase()
    const stmt = database.prepare(`
        INSERT INTO match_history (
            match_id, account_id, hero_id, hero_name, start_time, duration_s,
            game_mode, match_outcome, player_team, kills, deaths, assists,
            last_hits, denies, net_worth, player_damage, player_healing, obj_damage, items
        ) VALUES (
            @match_id, @account_id, @hero_id, @hero_name, @start_time, @duration_s,
            @game_mode, @match_outcome, @player_team, @kills, @deaths, @assists,
            @last_hits, @denies, @net_worth, @player_damage, @player_healing, @obj_damage, @items
        )
        ON CONFLICT(match_id, account_id) DO NOTHING
    `)

    const insertMany = database.transaction((items: PlayerMatch[]) => {
        for (const match of items) {
            stmt.run({
                match_id: match.match_id,
                account_id: accountId,
                hero_id: match.hero_id,
                hero_name: match.hero_name,
                start_time: match.start_time,
                duration_s: match.duration_s,
                game_mode: match.game_mode,
                match_outcome: match.match_outcome,
                player_team: match.player_team,
                kills: match.kills,
                deaths: match.deaths,
                assists: match.assists,
                last_hits: match.last_hits,
                denies: match.denies,
                net_worth: match.net_worth,
                player_damage: match.player_damage,
                player_healing: match.player_healing,
                obj_damage: match.obj_damage,
                items: '[]', // Will be populated from full match data if needed
            })
        }
    })

    insertMany(matches)
    updateAggregatedStats(accountId)
}

/**
 * Get match history for a player
 */
export function getMatchHistory(accountId: number, limit = 50, offset = 0): StoredMatch[] {
    const database = initDatabase()
    const rows = database
        .prepare(
            `
        SELECT * FROM match_history
        WHERE account_id = ?
        ORDER BY start_time DESC
        LIMIT ? OFFSET ?
    `
        )
        .all(accountId, limit, offset) as StoredMatch[]
    return rows
}

/**
 * Get match count for a player
 */
export function getMatchCount(accountId: number): number {
    const database = initDatabase()
    const row = database
        .prepare('SELECT COUNT(*) as count FROM match_history WHERE account_id = ?')
        .get(accountId) as { count: number }
    return row.count
}

/**
 * Get the latest match ID for a player (for incremental sync)
 */
export function getLatestMatchId(accountId: number): number | null {
    const database = initDatabase()
    const row = database
        .prepare(
            `
        SELECT match_id FROM match_history
        WHERE account_id = ?
        ORDER BY match_id DESC
        LIMIT 1
    `
        )
        .get(accountId) as { match_id: number } | undefined
    return row?.match_id || null
}

// ============================================
// Hero Stats
// ============================================

/**
 * Save hero stats snapshot
 */
export function saveHeroStatsSnapshot(accountId: number, heroes: PlayerHeroStat[]): void {
    const database = initDatabase()
    const today = new Date().toISOString().split('T')[0]

    const stmt = database.prepare(`
        INSERT INTO hero_stats_snapshots (
            account_id, hero_id, hero_name, matches_played, wins, losses,
            total_kills, total_deaths, total_assists, avg_damage, avg_healing, snapshot_date
        ) VALUES (
            @account_id, @hero_id, @hero_name, @matches_played, @wins, @losses,
            @total_kills, @total_deaths, @total_assists, @avg_damage, @avg_healing, @snapshot_date
        )
        ON CONFLICT(account_id, hero_id, snapshot_date) DO UPDATE SET
            matches_played = excluded.matches_played,
            wins = excluded.wins,
            losses = excluded.losses,
            total_kills = excluded.total_kills,
            total_deaths = excluded.total_deaths,
            total_assists = excluded.total_assists,
            avg_damage = excluded.avg_damage,
            avg_healing = excluded.avg_healing
    `)

    const insertMany = database.transaction((items: PlayerHeroStat[]) => {
        for (const hero of items) {
            stmt.run({
                account_id: accountId,
                hero_id: hero.hero_id,
                hero_name: hero.hero_name,
                matches_played: hero.matches_played,
                wins: hero.wins,
                losses: hero.losses,
                total_kills: hero.kills,
                total_deaths: hero.deaths,
                total_assists: hero.assists,
                avg_damage: hero.avg_damage,
                avg_healing: hero.avg_healing,
                snapshot_date: today,
            })
        }
    })

    insertMany(heroes)
}

/**
 * Get hero stats history for a player
 */
export function getHeroStatsHistory(
    accountId: number,
    heroId?: number,
    limit = 30
): HeroStatsSnapshot[] {
    const database = initDatabase()
    if (heroId) {
        return database
            .prepare(
                `
            SELECT * FROM hero_stats_snapshots
            WHERE account_id = ? AND hero_id = ?
            ORDER BY snapshot_date DESC
            LIMIT ?
        `
            )
            .all(accountId, heroId, limit) as HeroStatsSnapshot[]
    }

    // Get latest snapshot for all heroes
    return database
        .prepare(
            `
        SELECT hs.* FROM hero_stats_snapshots hs
        INNER JOIN (
            SELECT hero_id, MAX(snapshot_date) as max_date
            FROM hero_stats_snapshots
            WHERE account_id = ?
            GROUP BY hero_id
        ) latest ON hs.hero_id = latest.hero_id AND hs.snapshot_date = latest.max_date
        WHERE hs.account_id = ?
        ORDER BY hs.matches_played DESC
    `
        )
        .all(accountId, accountId) as HeroStatsSnapshot[]
}

// ============================================
// Aggregated Stats
// ============================================

/**
 * Update aggregated stats from match history
 */
export function updateAggregatedStats(accountId: number): void {
    const database = initDatabase()

    // Calculate stats from match history
    const stats = database
        .prepare(
            `
        SELECT
            COUNT(*) as total_matches,
            SUM(CASE WHEN match_outcome = 'Win' THEN 1 ELSE 0 END) as total_wins,
            SUM(CASE WHEN match_outcome = 'Loss' THEN 1 ELSE 0 END) as total_losses,
            SUM(kills) as total_kills,
            SUM(deaths) as total_deaths,
            SUM(assists) as total_assists,
            MAX(match_id) as last_match_id
        FROM match_history
        WHERE account_id = ?
    `
        )
        .get(accountId) as {
        total_matches: number
        total_wins: number
        total_losses: number
        total_kills: number
        total_deaths: number
        total_assists: number
        last_match_id: number | null
    }

    // Calculate streaks
    const matches = database
        .prepare(
            `
        SELECT match_outcome FROM match_history
        WHERE account_id = ?
        ORDER BY start_time DESC
    `
        )
        .all(accountId) as Array<{ match_outcome: string }>

    let currentWinStreak = 0
    let currentLossStreak = 0
    let bestWinStreak = 0
    let worstLossStreak = 0
    let tempWinStreak = 0
    let tempLossStreak = 0

    for (let i = 0; i < matches.length; i++) {
        const outcome = matches[i].match_outcome
        if (outcome === 'Win') {
            tempWinStreak++
            tempLossStreak = 0
            if (tempWinStreak > bestWinStreak) bestWinStreak = tempWinStreak
            if (i === 0) currentWinStreak = tempWinStreak
        } else {
            tempLossStreak++
            tempWinStreak = 0
            if (tempLossStreak > worstLossStreak) worstLossStreak = tempLossStreak
            if (i === 0) currentLossStreak = tempLossStreak
        }
    }

    // Current streak: count consecutive from start
    currentWinStreak = 0
    currentLossStreak = 0
    for (const match of matches) {
        if (match.match_outcome === 'Win') {
            if (currentLossStreak === 0) currentWinStreak++
            else break
        } else {
            if (currentWinStreak === 0) currentLossStreak++
            else break
        }
    }

    database
        .prepare(
            `
        INSERT INTO aggregated_stats (
            account_id, total_matches, total_wins, total_losses,
            total_kills, total_deaths, total_assists,
            current_win_streak, best_win_streak,
            current_loss_streak, worst_loss_streak,
            last_match_id, last_updated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
        ON CONFLICT(account_id) DO UPDATE SET
            total_matches = excluded.total_matches,
            total_wins = excluded.total_wins,
            total_losses = excluded.total_losses,
            total_kills = excluded.total_kills,
            total_deaths = excluded.total_deaths,
            total_assists = excluded.total_assists,
            current_win_streak = excluded.current_win_streak,
            best_win_streak = excluded.best_win_streak,
            current_loss_streak = excluded.current_loss_streak,
            worst_loss_streak = excluded.worst_loss_streak,
            last_match_id = excluded.last_match_id,
            last_updated = excluded.last_updated
    `
        )
        .run(
            accountId,
            stats.total_matches || 0,
            stats.total_wins || 0,
            stats.total_losses || 0,
            stats.total_kills || 0,
            stats.total_deaths || 0,
            stats.total_assists || 0,
            currentWinStreak,
            bestWinStreak,
            currentLossStreak,
            worstLossStreak,
            stats.last_match_id,
        )
}

/**
 * Get aggregated stats for a player
 */
export function getAggregatedStats(accountId: number): AggregatedStats | null {
    const database = initDatabase()
    const row = database
        .prepare('SELECT * FROM aggregated_stats WHERE account_id = ?')
        .get(accountId) as AggregatedStats | undefined
    return row || null
}

// ============================================
// Settings
// ============================================

/**
 * Get a setting value
 */
export function getSetting(key: string): string | null {
    const database = initDatabase()
    const row = database
        .prepare('SELECT value FROM stats_settings WHERE key = ?')
        .get(key) as { value: string } | undefined
    return row?.value || null
}

/**
 * Set a setting value
 */
export function setSetting(key: string, value: string): void {
    const database = initDatabase()
    database
        .prepare(
            `
        INSERT INTO stats_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
        )
        .run(key, value)
}

/**
 * Get all settings
 */
export function getAllSettings(): Record<string, string> {
    const database = initDatabase()
    const rows = database.prepare('SELECT key, value FROM stats_settings').all() as Array<{
        key: string
        value: string
    }>
    const result: Record<string, string> = {}
    for (const row of rows) {
        result[row.key] = row.value
    }
    return result
}
