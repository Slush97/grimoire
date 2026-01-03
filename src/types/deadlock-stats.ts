// Deadlock Stats API Types
// Updated to match actual API responses from api.deadlock-api.com/v1

// ============================================
// Player Types
// ============================================

/**
 * MMR data from /players/mmr endpoint
 * API returns array of these
 */
export interface PlayerMMR {
  account_id: number
  match_id: number
  start_time: number
  player_score: number  // This is the "MMR" value
  rank: number
  division: number      // Badge level (was rank_badge)
  division_tier: number // Subtier within division
}

export interface PlayerMMRHistoryEntry {
  match_id: number
  mmr: number
  mmr_change: number
  timestamp: number
}

export interface PlayerMMRHistory {
  account_id: number
  history: PlayerMMRHistoryEntry[]
}

/**
 * Hero stats from /players/hero-stats endpoint
 * API returns array of these directly (not wrapped)
 */
export interface PlayerHeroStat {
  account_id: number
  hero_id: number
  matches_played: number
  last_played: number
  time_played: number
  wins: number
  ending_level: number
  kills: number
  deaths: number
  assists: number
  denies_per_match: number
  kills_per_min: number
  deaths_per_min: number
  assists_per_min: number
  denies_per_min: number
  networth_per_min: number
  last_hits_per_min: number
  damage_per_min: number
  damage_per_soul: number
  damage_mitigated_per_min: number
  damage_taken_per_min: number
  damage_taken_per_soul: number
  creeps_per_min: number
  obj_damage_per_min: number
  obj_damage_per_soul: number
  accuracy: number
  crit_shot_rate: number
  matches: unknown[]
  // Computed fields (added by service layer)
  hero_name?: string
  win_rate?: number
  kda?: number
}

/**
 * Wrapper type for hero stats (created by service layer)
 */
export interface PlayerHeroStats {
  account_id: number
  heroes: PlayerHeroStat[]
}

/**
 * Match from /players/{id}/match-history endpoint
 * API returns array of these directly (not wrapped in {matches:[]})
 */
export interface PlayerMatch {
  account_id: number
  match_id: number
  hero_id: number
  hero_level: number
  start_time: number
  game_mode: number
  match_mode: number
  player_team: number  // 0 or 1
  player_kills: number
  player_deaths: number
  player_assists: number
  denies: number
  net_worth: number
  last_hits: number
  team_abandoned: boolean
  abandoned_time_s: number | null
  match_duration_s: number
  match_result: number  // 0 = loss, 1 = win
  objectives_mask_team0: number
  objectives_mask_team1: number
  username: string
  // Computed fields (added by service layer)
  hero_name?: string
  match_outcome?: 'Win' | 'Loss'
  duration_s?: number
  kills?: number
  deaths?: number
  assists?: number
  player_damage?: number
  player_healing?: number
  obj_damage?: number
}

/**
 * Wrapper type for match history (created by service layer)
 */
export interface PlayerMatchHistory {
  matches: PlayerMatch[]
}

/**
 * Steam profile from /players/steam endpoint
 * API returns array of these
 */
export interface PlayerSteamProfile {
  account_id: number
  personaname: string
  profileurl: string
  avatar: string
  avatarmedium: string
  avatarfull: string
  realname?: string
  countrycode?: string
  last_updated: number
  // Computed fields for backwards compatibility
  steam_id?: string
  persona_name?: string
  avatar_url?: string
  profile_url?: string
  is_private?: boolean
}

// ============================================
// Match Types
// ============================================

export interface MatchPlayer {
  account_id: number
  player_slot: number
  team: 'Team0' | 'Team1'
  hero_id: number
  kills: number
  deaths: number
  assists: number
  last_hits: number
  denies: number
  net_worth: number
  player_damage: number
  player_healing: number
  obj_damage: number
  items: number[]
  abilities: number[]
}

export interface MatchObjective {
  team: 'Team0' | 'Team1'
  type: string
  destroyed_time_s: number
}

export interface MatchMetadata {
  match_id: number
  start_time: number
  duration_s: number
  game_mode: number
  match_mode: string
  winning_team: 'Team0' | 'Team1'
  players: MatchPlayer[]
  objectives: MatchObjective[]
}

export interface ActiveMatchPlayer {
  account_id: number
  hero_id: number
  team: string
}

export interface ActiveMatch {
  match_id: number
  start_time: number
  game_mode: number
  players: ActiveMatchPlayer[]
  spectators: number
  average_badge: number
}

// ============================================
// Leaderboard Types
// ============================================

export type LeaderboardRegion = 'Europe' | 'NAmerica' | 'SAmerica' | 'Asia' | 'Oceania'

/**
 * Leaderboard entry from /leaderboard/{region}
 * API returns { entries: LeaderboardEntry[] }
 */
export interface LeaderboardEntry {
  account_name: string
  possible_account_ids: number[]
  rank: number
  top_hero_ids: number[]
  badge_level: number
  ranked_rank: number
  ranked_subrank: number
  // Computed fields for backwards compatibility
  account_id?: number
  persona_name?: string
  avatar_url?: string
  ranked_badge_level?: number | null
  wins?: number
  matches_played?: number
}

/**
 * API response wrapper for leaderboard
 */
export interface LeaderboardResponse {
  entries: LeaderboardEntry[]
}

export interface HeroLeaderboardEntry extends LeaderboardEntry {
  hero_id: number
  hero_matches: number
  hero_wins: number
}

// ============================================
// Analytics Types
// ============================================

/**
 * Hero analytics from /analytics/hero-stats
 * API returns array with totals, not rates
 */
export interface HeroAnalytics {
  hero_id: number
  bucket: number
  wins: number
  losses: number
  matches: number
  matches_per_bucket: number
  players: number
  total_kills: number
  total_deaths: number
  total_assists: number
  total_net_worth: number
  total_last_hits: number
  total_denies: number
  total_player_damage: number
  total_player_damage_taken: number
  total_boss_damage: number
  total_creep_damage: number
  total_neutral_damage: number
  total_max_health: number
  total_shots_hit: number
  total_shots_missed: number
  // Computed fields (added by service layer)
  hero_name?: string
  win_rate?: number
  pick_rate?: number
  avg_kills?: number
  avg_deaths?: number
  avg_assists?: number
}

export interface HeroCounterEntry {
  enemy_hero_id: number
  matches: number
  wins: number
  win_rate: number
}

export interface HeroCounteredByEntry {
  enemy_hero_id: number
  matches: number
  losses: number
  loss_rate: number
}

export interface HeroCounterStats {
  hero_id: number
  counters: HeroCounterEntry[]
  countered_by: HeroCounteredByEntry[]
}

export interface HeroSynergyEntry {
  ally_hero_id: number
  matches: number
  wins: number
  win_rate: number
}

export interface HeroSynergyStats {
  hero_id: number
  synergies: HeroSynergyEntry[]
}

export interface ItemAnalytics {
  item_id: number
  item_name: string
  pick_rate: number
  win_rate: number
  avg_purchase_time: number
  hero_pick_rates: Record<number, number>
}

export interface BadgeDistribution {
  badge_level: number
  badge_name: string
  player_count: number
  percentage: number
}

// ============================================
// Builds Types
// ============================================

export interface BuildItem {
  item_id: number
  slot: 'weapon' | 'vitality' | 'spirit' | 'flex'
  priority: number
  notes?: string
}

export interface Build {
  id: string
  name: string
  hero_id: number
  author_id: number
  author_name: string
  description: string
  tags: string[]
  language: string
  favorites: number
  version: string
  published_at: string
  updated_at: string
  items: BuildItem[]
  ability_order: number[]
}

// ============================================
// API Parameters
// ============================================

export interface HeroStatsParams {
  min_badge?: number
  max_badge?: number
  match_mode?: string
  min_unix_timestamp?: number
  max_unix_timestamp?: number
}

export interface BuildSearchParams {
  hero_id?: number
  search?: string
  author_id?: number
  tags?: string[]
  language?: string
  sort_by?: 'favorites' | 'updated' | 'published' | 'version'
  sort_direction?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

// ============================================
// Database Types (Local Storage)
// ============================================

export interface TrackedPlayer {
  account_id: number
  steam_id: string
  persona_name: string
  avatar_url: string
  is_primary: number
  added_at: number
  last_updated: number | null
}

export interface MMRSnapshot {
  id: number
  account_id: number
  mmr: number
  rank: number
  rank_badge: number
  rank_tier: string
  snapshot_date: string
  created_at: number
}

export interface StoredMatch {
  match_id: number
  account_id: number
  hero_id: number
  hero_name: string
  start_time: number
  duration_s: number
  game_mode: number
  match_outcome: string
  player_team: string
  kills: number
  deaths: number
  assists: number
  last_hits: number
  denies: number
  net_worth: number
  player_damage: number
  player_healing: number
  obj_damage: number
  items: string
  fetched_at: number
}

export interface HeroStatsSnapshot {
  id: number
  account_id: number
  hero_id: number
  hero_name: string
  matches_played: number
  wins: number
  losses: number
  total_kills: number
  total_deaths: number
  total_assists: number
  avg_damage: number
  avg_healing: number
  snapshot_date: string
}

export interface AggregatedStats {
  account_id: number
  total_matches: number
  total_wins: number
  total_losses: number
  total_kills: number
  total_deaths: number
  total_assists: number
  current_win_streak: number
  best_win_streak: number
  current_loss_streak: number
  worst_loss_streak: number
  last_match_id: number | null
  last_updated: number
}

// ============================================
// Settings
// ============================================

export interface StatsSettings {
  tracked_account_ids: number[]
  default_region: LeaderboardRegion
  refresh_interval_minutes: number
  show_mmr_history: boolean
  show_hero_breakdown: boolean
}

// ============================================
// Hero Name Lookup
// ============================================

export const HERO_NAMES: Record<number, string> = {
  1: 'Infernus',
  2: 'Seven',
  3: 'Vindicta',
  4: 'Lady Geist',
  6: 'Abrams',
  7: 'Wraith',
  8: 'McGinnis',
  10: 'Paradox',
  11: 'Dynamo',
  12: 'Kelvin',
  13: 'Haze',
  14: 'Holliday',
  15: 'Bebop',
  16: 'Grey Talon',
  17: 'Mo & Krill',
  18: 'Shiv',
  19: 'Ivy',
  20: 'Warden',
  25: 'Yamato',
  27: 'Lash',
  31: 'Viscous',
  35: 'Pocket',
  50: 'Mirage',
  55: 'Calico',
  58: 'Sinclair',
  59: 'Billy',
  60: 'Mina',
  61: 'Drifter',
  62: 'Paige',
  63: 'Victor',
  64: 'Doorman',
  65: 'Sinclair',  // Note: ID 58 is also Sinclair - 65 was previously Magician but corrected
  67: 'Vyper',
  // Experimental heroes (52, 66, 68, 69, 72) intentionally excluded
}

// Set of experimental hero IDs to filter from displays
export const EXPERIMENTAL_HERO_IDS = new Set([52, 66, 68, 69, 72])

