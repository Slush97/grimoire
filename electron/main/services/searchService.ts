import { initDatabase, mapRowToMod } from './modDatabase';
// SearchOptions/SearchResult are the canonical SearchLocalModsOptions and
// LocalSearchResult from src/types/electron.ts under this module's
// historical names.
import type {
    SearchLocalModsOptions as SearchOptions,
    LocalSearchResult as SearchResult,
} from '../../../src/types/electron';
export type { SearchOptions, SearchResult };

/**
 * Escape special FTS5 characters in search terms
 * FTS5 treats these as operators: AND, OR, NOT, -, ", *, ^, :
 * and ' opens a string literal, so an unbalanced one is a syntax error
 * (a name like "Tu'er Shen" crashed the whole query). The unicode61
 * tokenizer already splits on these, so replacing them with a space and
 * prefix-matching each token matches the same content.
 */
function escapeFts5Term(term: string): string {
    // Remove characters that could break FTS5 queries
    // Keep alphanumeric and basic punctuation that's safe
    return term.replace(/["\-*^:()']/g, ' ').trim();
}


/**
 * Order-by clause for a sort option. `hasQuery` differentiates relevance:
 * with a query, sort by FTS5 rank; without one, fall back to recency.
 */
function buildOrderBy(sortBy: SearchOptions['sortBy'], hasQuery: boolean): string {
    switch (sortBy) {
        case 'relevance':
            return hasQuery ? 'rank ASC' : 'date_modified DESC';
        case 'likes':
            return 'like_count DESC';
        case 'date':
            return 'date_modified DESC';
        case 'date_added':
            return 'date_added DESC';
        case 'views':
            return 'view_count DESC';
        case 'name':
            return 'name COLLATE NOCASE ASC';
        default:
            return 'date_modified DESC';
    }
}

/**
 * Append the content-rating and recency filters shared by the FTS and fallback
 * paths. Mutates the passed conditions/params so both code paths stay in sync.
 */
function applyContentFilters(
    conditions: string[],
    params: Record<string, unknown>,
    nsfw: SearchOptions['nsfw'],
    addedWithin: SearchOptions['addedWithin'],
    addedFrom?: number,
    addedTo?: number
): void {
    if (nsfw === 'sfw') {
        conditions.push('mods.is_nsfw = 0');
    } else if (nsfw === 'nsfw') {
        conditions.push('mods.is_nsfw = 1');
    }

    // date_added is a Unix timestamp in seconds (GameBanana's _tsDateAdded).
    if (addedWithin === 'custom') {
        if (typeof addedFrom === 'number') {
            params.addedAfter = addedFrom;
            conditions.push('mods.date_added >= @addedAfter');
        }
        if (typeof addedTo === 'number') {
            params.addedBefore = addedTo;
            conditions.push('mods.date_added <= @addedBefore');
        }
    } else if (addedWithin && addedWithin !== 'all') {
        const windowSeconds =
            addedWithin === 'today' ? 86_400 : addedWithin === 'week' ? 7 * 86_400 : 30 * 86_400;
        params.addedAfter = Math.floor(Date.now() / 1000) - windowSeconds;
        conditions.push('mods.date_added >= @addedAfter');
    }
}

/**
 * Category/hero scoping, shared by the FTS and fallback paths.
 *
 * The cached catalog has no usable `category_id`. GameBanana's list endpoint
 * returns `_aRootCategory` with a name but no `_idRow`, so sync writes null for
 * every row (6625 of 6625 on a full mirror). Matching on it therefore returned
 * nothing, silently: no rows, no error, no fallback. It stayed hidden because a
 * category filter only routes to the local catalog when some *other*
 * catalog-only filter is already active (a search, an NSFW or date window, or
 * any hidden creator), so most installs never saw it, and the ones that did saw
 * an empty grid rather than a failure.
 *
 * `category_name` is stored, so the renderer resolves the picked category to its
 * root name and we match on that instead. A root-level pick is exact; a
 * subcategory pick widens to its root rather than returning nothing, which is
 * the best the cached columns allow. The id comparison stays as a last resort
 * for the day rows carry real ids.
 */
function applyCategoryFilter(
    conditions: string[],
    params: Record<string, unknown>,
    categoryId: SearchOptions['categoryId'],
    categoryName: SearchOptions['categoryName'],
    heroName: SearchOptions['heroName'],
    skinsCategoryId: SearchOptions['skinsCategoryId']
): void {
    if (categoryId === undefined) return;

    if (heroName && skinsCategoryId !== undefined) {
        // Hero search: find ALL mods with the hero name in the title, whatever
        // their category. Same missing-id constraint as above, which is why this
        // cannot simply scope to the hero's subcategory.
        params.heroNamePattern = `%${heroName.toLowerCase()}%`;
        conditions.push('LOWER(mods.name) LIKE @heroNamePattern');
        console.log(`[searchMods] Hero search: heroName="${heroName}" (searching all categories)`);
        return;
    }

    if (categoryName) {
        params.categoryName = categoryName;
        conditions.push('mods.category_name = @categoryName COLLATE NOCASE');
        console.log(`[searchMods] Category search: categoryName="${categoryName}" (root category of ${categoryId})`);
        return;
    }

    conditions.push('mods.category_id = @categoryId');
    params.categoryId = categoryId;
    console.log(`[searchMods] Category search: falling back to category_id=${categoryId} (no root name resolved)`);
}

/** Exclude hidden GameBanana submitters at query time so counts and pagination
 *  describe the visible catalog. Null submitter ids remain visible because
 *  there is no stable creator identity to compare against. */
export function normalizeHiddenCreatorIds(hiddenCreatorIds: SearchOptions['hiddenCreatorIds']): number[] {
    if (!hiddenCreatorIds?.length) return [];
    return [...new Set(hiddenCreatorIds)]
        .filter((id) => Number.isSafeInteger(id) && id > 0)
        .slice(0, 1000);
}

function applyHiddenCreatorFilter(
    conditions: string[],
    params: Record<string, unknown>,
    hiddenCreatorIds: SearchOptions['hiddenCreatorIds']
): void {
    const ids = normalizeHiddenCreatorIds(hiddenCreatorIds);
    if (ids.length === 0) return;

    const placeholders = ids.map((id, index) => {
        const key = `hidden_creator_${index}`;
        params[key] = id;
        return `@${key}`;
    });
    conditions.push(`(mods.submitter_id IS NULL OR mods.submitter_id NOT IN (${placeholders.join(', ')}))`);
}

/**
 * Fallback search used when the FTS5 path returns zero results. FTS5 is
 * tokenized and prefix-only, so creative names ("MìnaMod-v2", typos, partial
 * substrings inside a word) miss even when they should match. This runs a
 * substring LIKE against the mod name as a safety net — slower (no FTS
 * index), but only fires when FTS5 would have shown an empty page.
 */
function runFallbackSubstringSearch(
    database: ReturnType<typeof initDatabase>,
    rawQuery: string,
    // Every scoping value here is forwarded verbatim from the caller's options.
    // Passing the object rather than fourteen positional arguments is what stops
    // a new filter from being silently threaded into the wrong slot.
    options: SearchOptions,
    limit: number,
    offset: number
): SearchResult {
    const {
        section,
        categoryId,
        categoryName,
        heroName,
        skinsCategoryId,
        sortBy,
        nsfw,
        addedWithin,
        addedFrom,
        addedTo,
        hiddenCreatorIds,
    } = options;
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    // Split on whitespace so multi-term searches still all have to match.
    // Cap at 10 terms; longer queries get truncated rather than bloating the SQL.
    const terms = rawQuery
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 0)
        .slice(0, 10);

    terms.forEach((term, i) => {
        const key = `fallback_term_${i}`;
        params[key] = `%${term.toLowerCase()}%`;
        conditions.push(`LOWER(mods.name) LIKE @${key}`);
    });

    if (section) {
        conditions.push('mods.section = @section');
        params.section = section;
    }

    applyCategoryFilter(conditions, params, categoryId, categoryName, heroName, skinsCategoryId);
    applyContentFilters(conditions, params, nsfw, addedWithin, addedFrom, addedTo);
    applyHiddenCreatorFilter(conditions, params, hiddenCreatorIds);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = buildOrderBy(sortBy, false); // no FTS rank in fallback

    const countRow = database
        .prepare(`SELECT COUNT(*) as count FROM mods ${whereClause}`)
        .get(params) as { count: number };
    const totalCount = countRow.count;

    params.limit = limit;
    params.offset = offset;
    const rows = database
        .prepare(
            `SELECT mods.*, 0 as rank FROM mods ${whereClause} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`
        )
        .all(params) as Record<string, unknown>[];

    return {
        mods: rows.map(mapRowToMod),
        totalCount,
        offset,
        limit,
    };
}

/**
 * Search mods using FTS5 full-text search
 */
export function searchMods(options: SearchOptions): SearchResult {
    const database = initDatabase();
    const {
        query,
        section,
        categoryId,
        categoryName,
        heroName,
        skinsCategoryId,
        sortBy = 'relevance',
        nsfw = 'all',
        addedWithin = 'all',
        addedFrom,
        addedTo,
        hiddenCreatorIds,
    } = options;

    // Validate and cap pagination values
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const offset = Math.max(options.offset ?? 0, 0);

    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    // FTS5 search if query provided
    let fromClause = 'FROM mods';
    let rankSelect = '0 as rank';
    let appliedFtsQuery = false;
    if (query && query.trim()) {
        // P2 fix #15: Limit query length to prevent ReDoS/expensive queries
        const truncatedQuery = query.slice(0, 500);

        // Escape special FTS5 characters and use prefix matching
        const escapedQuery = escapeFts5Term(truncatedQuery);
        if (escapedQuery) {
            const searchTerms = escapedQuery.split(/\s+/)
                .filter(term => term.length > 0)
                .slice(0, 20) // Limit number of search terms
                .map(term => `${term}*`)
                .join(' ');
            if (searchTerms) {
                params.query = searchTerms;
                fromClause = 'FROM mods JOIN mods_fts ON mods.id = mods_fts.rowid';
                rankSelect = 'bm25(mods_fts) as rank';
                conditions.push('mods_fts MATCH @query');
                appliedFtsQuery = true;
            }
        }
    }

    // Filter by section
    if (section) {
        conditions.push('mods.section = @section');
        params.section = section;
    }

    applyCategoryFilter(conditions, params, categoryId, categoryName, heroName, skinsCategoryId);
    applyContentFilters(conditions, params, nsfw, addedWithin, addedFrom, addedTo);
    applyHiddenCreatorFilter(conditions, params, hiddenCreatorIds);

    // Build WHERE clause
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Debug logging for hero search issues
    if (heroName && skinsCategoryId !== undefined) {
        console.log(`[searchMods] WHERE clause: ${whereClause}`);
        console.log(`[searchMods] Params:`, JSON.stringify(params));
    }

    const orderBy = buildOrderBy(sortBy, !!query?.trim());

    // Count query
    const countQuery = `SELECT COUNT(*) as count ${fromClause} ${whereClause}`;
    const countStmt = database.prepare(countQuery);
    const countRow = countStmt.get(params) as { count: number };
    const totalCount = countRow.count;

    if (heroName && skinsCategoryId !== undefined) {
        console.log(`[searchMods] Result count: ${totalCount}`);
    }

    // FTS5 missed — fall back to substring matching so creative names / typos
    // still surface something instead of an empty page. Only triggers when a
    // real query was applied (avoids running an unnecessary second query when
    // the user hasn't typed anything yet).
    if (totalCount === 0 && appliedFtsQuery && query) {
        return runFallbackSubstringSearch(
            database,
            query.slice(0, 500),
            { ...options, sortBy, nsfw, addedWithin },
            limit,
            offset
        );
    }

    // Main query with pagination
    const mainQuery = `SELECT mods.*, ${rankSelect} ${fromClause} ${whereClause} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`;
    params.limit = limit;
    params.offset = offset;

    const stmt = database.prepare(mainQuery);
    const rows = stmt.all(params) as Record<string, unknown>[];

    const mods = rows.map(mapRowToMod);

    return {
        mods,
        totalCount,
        offset,
        limit,
    };
}

/**
 * Get all unique categories/heroes in the database
 */
export function getCategories(section?: string): Array<{ id: number; name: string; count: number }> {
    const database = initDatabase();
    let query = `
        SELECT category_id as id, category_name as name, COUNT(*) as count
        FROM mods
        WHERE category_id IS NOT NULL AND category_name IS NOT NULL
    `;
    const params: Record<string, unknown> = {};

    if (section) {
        query += ' AND section = @section';
        params.section = section;
    }

    query += ' GROUP BY category_id, category_name ORDER BY name COLLATE NOCASE';

    const stmt = database.prepare(query);
    return stmt.all(params) as Array<{ id: number; name: string; count: number }>;
}

/**
 * Get section statistics
 */
export function getSectionStats(): Array<{ section: string; count: number }> {
    const database = initDatabase();
    const stmt = database.prepare(`
        SELECT section, COUNT(*) as count
        FROM mods
        GROUP BY section
        ORDER BY count DESC
    `);
    return stmt.all() as Array<{ section: string; count: number }>;
}
