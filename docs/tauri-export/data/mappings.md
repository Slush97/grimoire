# Internal Mappings

> Hero IDs, rank names, and experimental hero filtering.

---

## Hero Names

```rust
use std::collections::HashMap;
use lazy_static::lazy_static;

lazy_static! {
    pub static ref HERO_NAMES: HashMap<u32, &'static str> = {
        let mut m = HashMap::new();
        m.insert(1, "Infernus");
        m.insert(2, "Seven");
        m.insert(3, "Vindicta");
        m.insert(4, "Lady Geist");
        m.insert(6, "Abrams");
        m.insert(7, "Wraith");
        m.insert(8, "McGinnis");
        m.insert(10, "Paradox");
        m.insert(11, "Dynamo");
        m.insert(12, "Kelvin");
        m.insert(13, "Haze");
        m.insert(14, "Holliday");
        m.insert(15, "Bebop");
        m.insert(16, "Grey Talon");
        m.insert(17, "Mo & Krill");
        m.insert(18, "Shiv");
        m.insert(19, "Ivy");
        m.insert(20, "Warden");
        m.insert(25, "Yamato");
        m.insert(27, "Lash");
        m.insert(31, "Viscous");
        m.insert(35, "Pocket");
        m.insert(50, "Mirage");
        m.insert(55, "Calico");
        m.insert(58, "Sinclair");
        m.insert(59, "Billy");
        m.insert(60, "Mina");
        m.insert(61, "Drifter");
        m.insert(62, "Paige");
        m.insert(63, "Victor");
        m.insert(64, "Doorman");
        m.insert(67, "Vyper");
        m
    };
}
```

---

## Experimental Heroes (Exclude from Analytics)

```rust
use std::collections::HashSet;

lazy_static! {
    pub static ref EXPERIMENTAL_HERO_IDS: HashSet<u32> = {
        let mut s = HashSet::new();
        s.insert(52);  // Wrecker
        s.insert(66);  // Fathom
        s.insert(68);  // Trapper
        s.insert(69);  // Raven
        s.insert(72);  // The Warden
        s
    };
}

pub fn is_experimental(hero_id: u32) -> bool {
    EXPERIMENTAL_HERO_IDS.contains(&hero_id)
}
```

---

## Rank System

| Group | Badge Levels | Rank Name | Color Hex |
|-------|--------------|-----------|-----------|
| 1 | 12-16 | Initiate | #9ca3af |
| 2 | 21-26 | Seeker | #a16207 |
| 3 | 31-36 | Alchemist | #fbbf24 |
| 4 | 41-46 | Arcanist | #22c55e |
| 5 | 51-56 | Ritualist | #06b6d4 |
| 6 | 61-66 | Emissary | #3b82f6 |
| 7 | 71-76 | Archon | #8b5cf6 |
| 8 | 81-86 | Oracle | #ec4899 |
| 9 | 91-96 | Phantom | #ef4444 |
| 10 | 101-106 | Ascendant | #f97316 |
| 11 | 111-116 | Eternus | #fbbf24 |

```rust
pub struct RankInfo {
    pub name: String,
    pub group: String,
    pub color: String,
}

pub fn get_rank_info(badge_level: u32) -> RankInfo {
    let group = badge_level / 10;
    let sublevel = badge_level % 10;
    
    let (group_name, color) = match group {
        1 => ("Initiate", "#9ca3af"),
        2 => ("Seeker", "#a16207"),
        3 => ("Alchemist", "#fbbf24"),
        4 => ("Arcanist", "#22c55e"),
        5 => ("Ritualist", "#06b6d4"),
        6 => ("Emissary", "#3b82f6"),
        7 => ("Archon", "#8b5cf6"),
        8 => ("Oracle", "#ec4899"),
        9 => ("Phantom", "#ef4444"),
        10 => ("Ascendant", "#f97316"),
        11 => ("Eternus", "#fbbf24"),
        _ => ("Unknown", "#6b7280"),
    };
    
    let roman = match sublevel {
        2 => " I", 3 => " II", 4 => " III", 5 => " IV", 6 => " V",
        _ => "",
    };
    
    RankInfo {
        name: format!("{}{}", group_name, roman),
        group: group_name.to_string(),
        color: color.to_string(),
    }
}
```

---

## Notes

- Hero IDs are **not sequential** (5, 9, 21-24, etc. are gaps)
- Experimental heroes may change IDs between patches
- Rank sublevels 2-6 map to Roman numerals I-V
