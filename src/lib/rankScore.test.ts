import { describe, expect, it } from 'vitest'
import { badgeScore } from './rankScore'

describe('badgeScore', () => {
    it('places a badge on the 6-per-tier ladder', () => {
        expect(badgeScore(11)).toBe(1) // Initiate 1
        expect(badgeScore(86)).toBe(48) // Oracle 6, top of Oracle
        expect(badgeScore(91)).toBe(49) // Phantom 1
        expect(badgeScore(116)).toBe(66) // Eternus 6
    })

    it('treats a missing or zero badge as unranked', () => {
        expect(badgeScore(0)).toBeNull()
        expect(badgeScore(null)).toBeNull()
        expect(badgeScore(undefined)).toBeNull()
        expect(badgeScore(70)).toBeNull()
    })
})
