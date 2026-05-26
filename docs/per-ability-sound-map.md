# Deadlock per-ability sound map

Generated from base `pak01_dir.vpk` + deadlock-api. For each hero: the 4 ability
slots (deadlock-api `signatureN`, slot 4 = ultimate) with display name + icon, the
count of ability sound files auto-assigned to each slot, and any sound groups that
still need a manual slot (newest heroes use renamed dev-tokens the API does not match).

**45 heroes, 2533 ability sound files. Auto-slotted 2348 (92%).**

Slot source per file (priority): `aN` path token > deadlock-api ability name/display match > hand-curated override.
Residual is classified: _non-ability_ (weapon/movement, correctly has no slot),
_orphaned_ (sounds from removed/reworked abilities), _uncertain_ (verify in-game; no real mod exists to confirm).
Validated against real GameBanana mods: Wraith Card Trick=a1, Ivy Stone Form=a3, Doorman Hotel ult=a4, Graves hauntingdead=a1.

## Abrams  (`abrams`)
- **a1** Siphon Life  (`heal`) - 3 files
- **a2** Shoulder Charge  (`charge`) - 24 files
- **a3** Infernal Resilience  (`beefy`) - 0 files
- **a4 [ULT]** Seismic Impact  (`leap`) - 10 files

## Apollo  (`fencer`)
- **a1** Disengaging Sigil  (`throwblade`) - 8 files
- **a2** Riposte  (`riposte`) - 8 files
- **a3** Flawless Advance  (`lunge`) - 17 files
- **a4 [ULT]** Itani Lo Sahn  (`ultimate`) - 0 files
- _non-ability (weapon/movement):_ weapon (1)
- _uncertain (verify in-game):_ super (13)

## Bebop  (`bebop`)
- **a1** Exploding Uppercut  (`uppercut`) - 11 files
- **a2** Sticky Bomb  (`bomb`) - 7 files
- **a3** Grapple Arm  (`hook`) - 16 files
- **a4 [ULT]** Hyper Beam  (`laser_beam`) - 36 files

## Billy  (`punkgoat`)
- **a1** Bashdown  (`ult`) - 13 files
- **a2** Rising Ram  (`goatflip`) - 5 files
- **a3** Blasted  (`blasted`) - 12 files
- **a4 [ULT]** Chain Gang  (`tether`) - 10 files
- _non-ability (weapon/movement):_ slide (1)

## Cadence  (`cadence`)
- **a1** cadence_ability_anthem  (`ability_anthem`) - 0 files
- **a2** cadence_ability_silencecontraptions  (`ability_silencecontraptions`) - 6 files
- **a3** cadence_ability_lullaby  (`ability_lullaby`) - 0 files
- **a4 [ULT]** cadence_ability_crescendo  (`ability_crescendo`) - 0 files

## Calico  (`nano`)
- **a1** Gloom Bombs  (`clustergrenade`) - 28 files
- **a2** Leaping Slash  (`dash`) - 14 files
- **a3** Ava  (`catform`) - 38 files
- **a4 [ULT]** Return to Shadows  (`shadow_pulse`) - 32 files
- _non-ability (weapon/movement):_ calico (19)

## Celeste  (`unicorn`)
- **a1** Light Eater  (`radiantblast`) - 17 files
- **a2** Dazzling Trick  (`prismaticguard`) - 11 files
- **a3** Radiant Daggers  (`luminousstrike`) - 14 files
- **a4 [ULT]** Shining Wonder  (`dazzlingorb`) - 21 files

## Doorman  (`doorman`)
- **a1** Call Bell  (`bomb`) - 17 files
- **a2** Doorway  (`doorway`) - 32 files
- **a3** Luggage Cart  (`luggage_cart`) - 18 files
- **a4 [ULT]** Hotel Guest  (`hotel`) - 15 files

## Drifter  (`drifter`)
- **a1** Rend  (`blood_blast`) - 7 files
- **a2** Stalker's Mark  (`shadow_mark`) - 13 files
- **a3** Bloodscent  (`hunger`) - 5 files
- **a4 [ULT]** Eternal Night  (`darkness`) - 11 files
- _non-ability (weapon/movement):_ claw (1)

## Dynamo  (`dynamo`)
- **a1** Kinetic Pulse  (`stomp`) - 6 files
- **a2** Quantum Entanglement  (`sphere`) - 12 files
- **a3** Rejuvenating Aurora  (`nikuman`) - 4 files
- **a4 [ULT]** Singularity  (`vacuum`) - 10 files

## Fathom  (`fathom`)
- **a1** ?  (`scalding_spray`) - 5 files
- **a2** ?  (`breach`) - 2 files
- **a3** ?  (`reefdweller_harpoon`) - 4 files
- **a4 [ULT]** ?  (`lurkers_ambush`) - 11 files

## Graves  (`necro`)
- **a1** Jar of Dead  (`hauntingskull`) - 51 files
- **a2** Grasping Hands  (`zombiewall`) - 33 files
- **a3** Essence Theft  (`fear`) - 0 files
- **a4 [ULT]** Borrowed Decree  (`gravestone`) - 22 files
- _uncertain (verify in-game):_ shambler (44), gravedigging (4)

## Grey Talon  (`orion`)
- **a1** Charged Shot  (`shot`) - 27 files
- **a2** Rain of Arrows  (`jump`) - 4 files
- **a3** Spirit Snare  (`trap`) - 9 files
- **a4 [ULT]** Guided Owl  (`arrow`) - 3 files

## Haze  (`haze`)
- **a1** Sleep Dagger  (`dagger`) - 18 files
- **a2** Smoke Bomb  (`bomb`) - 14 files
- **a3** Fixation  (`damage`) - 0 files
- **a4 [ULT]** Bullet Dance  (`flurry`) - 4 files

## Holliday  (`astro`)
- **a1** Powder Keg  (`barrel`) - 8 files
- **a2** Bounce Pad  (`pad`) - 25 files
- **a3** Crackshot  (`crackshot`) - 7 files
- **a4 [ULT]** Spirit Lasso  (`lasso`) - 12 files

## Infernus  (`inferno`)
- **a1** Napalm  (`projectile`) - 8 files
- **a2** Flame Dash  (`dash`) - 4 files
- **a3** Afterburn  (`afterburn`) - 7 files
- **a4 [ULT]** Concussive Combustion  (`bomb`) - 2 files
- _non-ability (weapon/movement):_ fire (1)

## Ivy  (`tengu`)
- **a1** Entangling Thorns  (`urn`) - 5 files
- **a2** Kudzu Connection  (`tangotether`) - 14 files
- **a3** Stone Form  (`stone_form`) - 19 files
- **a4 [ULT]** Air Drop  (`airlift`) - 6 files
- _non-ability (weapon/movement):_ ivy (13)

## Kali  (`kali`)
- **a1** citadel_ability_kali_spinning_blade  (`spinning_blade`) - 10 files
- **a2** citadel_ability_kali_disruptive_charge  (`disruptive_charge`) - 4 files
- **a3** ability_kali_dust_storm  (`dust_storm`) - 3 files
- **a4 [ULT]** ability_kali_trappers_bolo  (`trappers_bolo`) - 15 files

## Kelvin  (`kelvin`)
- **a1** Frost Grenade  (`grenade`) - 29 files
- **a2** Ice Path  (`icepath`) - 9 files
- **a3** Arctic Beam  (`icebeam`) - 6 files
- **a4 [ULT]** Frozen Shelter  (`dome`) - 8 files
- _non-ability (weapon/movement):_ ice (1)

## Lady Geist  (`ghost`)
- **a1** Essence Bomb  (`bomb`) - 13 files
- **a2** Life Drain  (`drain`) - 9 files
- **a3** Malice  (`shards`) - 30 files
- **a4 [ULT]** Soul Exchange  (`swap`) - 6 files

## Lash  (`lash`)
- **a1** Ground Strike  (`down_strike`) - 14 files
- **a2** Grapple  (`lash`) - 7 files
- **a3** Flog  (`flog`) - 9 files
- **a4 [ULT]** Death Slam  (`ultimate`) - 12 files

## McGinnis  (`forge`)
- **a1** Mini Turret  (`shieldedsentry`) - 27 files
- **a2** Medicinal Specter  (`resupply`) - 14 files
- **a3** Spectral Wall  (`wall`) - 30 files
- **a4 [ULT]** Heavy Barrage  (`barrage`) - 20 files

## Mina  (`vampirebat`)
- **a1** Rake  (`steallife`) - 7 files
- **a2** Sanguine Retreat  (`batblink`) - 16 files
- **a3** Love Bites  (`lovebites`) - 18 files
- **a4 [ULT]** Nox Nostra  (`batswarm`) - 22 files

## Mirage  (`mirage`)
- **a1** Fire Scarabs  (`fire_beetles`) - 14 files
- **a2** Dust Devil  (`tornado`) - 19 files
- **a3** Djinn's Mark  (`sand_phantom`) - 5 files
- **a4 [ULT]** Traveler  (`teleport`) - 18 files
- _uncertain (verify in-game):_ tempest (20)

## Mo & Krill  (`mokrill`)
- **a1** Scorn  (`intimidate`) - 6 files
- **a2** Burrow  (`burrow`) - 25 files
- **a3** Sand Blast  (`sand`) - 5 files
- **a4 [ULT]** Combo  (`combo`) - 36 files

## Paige  (`bookworm`)
- **a1** Bookwyrm  (`dragonfire`) - 13 files
- **a2** Plot Armor  (`knightbarrier`) - 6 files
- **a3** Captivating Read  (`aoemagic`) - 6 files
- **a4 [ULT]** Rallying Charge  (`knightcharge`) - 8 files

## Paradox  (`chrono`)
- **a1** Pulse Grenade  (`pulse_grenade`) - 21 files
- **a2** Time Wall  (`time_wall`) - 12 files
- **a3** Kinetic Carbine  (`kinetic_carbine`) - 5 files
- **a4 [ULT]** Paradoxical Swap  (`swap`) - 8 files

## Pocket  (`synth`)
- **a1** Barrage  (`barrage`) - 27 files
- **a2** Flying Cloak  (`plasma_flux`) - 18 files
- **a3** Enchanter's Satchel  (`pulse`) - 5 files
- **a4 [ULT]** Affliction  (`affliction`) - 21 files

## Raven  (`operative`)
- **a1** Blindside  (`blindside`) - 0 files
- **a2** Umbrella Maneuver  (`umbrella_maneuver`) - 2 files
- **a3** Full Auto  (`rapidfire`) - 0 files
- **a4 [ULT]** Revelation  (`revelation`) - 0 files

## Rem  (`familiar`)
- **a1** Pillow Toss  (`ability02`) - 10 files
- **a2** Tag Along  (`attach`) - 15 files
- **a3** Lil Helpers  (`helpinghands`) - 62 files
- **a4 [ULT]** Naptime  (`ability01`) - 13 files

## Seven  (`gigawatt`)
- **a1** Lightning Ball  (`ball`) - 11 files
- **a2** Static Charge  (`charge`) - 8 files
- **a3** Power Surge  (`surge`) - 17 files
- **a4 [ULT]** Storm Cloud  (`cloud`) - 16 files

## Shiv  (`shiv`)
- **a1** Serrated Knives  (`dagger`) - 43 files
- **a2** Slice and Dice  (`dash`) - 4 files
- **a3** Bloodletting  (`defer_damage`) - 2 files
- **a4 [ULT]** Killing Blow  (`killing_blow`) - 3 files
- _non-ability (weapon/movement):_ rage (2), transform (1)

## Silver  (`werewolf`)
- **a1** Slam Fire  (`unloadgun`) - 10 files
- **a2** Boot Kick  (`kickflip`) - 12 files
- **a3** Entangling Bola  (`netshot`) - 14 files
- **a4 [ULT]** Lycan Curse  (`transformation`) - 5 files

## Sinclair  (`magician`)
- **a1** Vexing Bolt  (`magicbolt`) - 11 files
- **a2** Spectral Assistant  (`cloneturret`) - 18 files
- **a3** Rabbit Hex  (`animalhexarea`) - 23 files
- **a4 [ULT]** Audience Participation  (`copyult`) - 9 files

## Tokamak  (`tokamak`)
- **a1** tokamak_hot_shot  (`hot_shot`) - 11 files
- **a2** tokamak_dying_star  (`dying_star`) - 6 files
- **a3** tokamak_radiance  (`radiance`) - 6 files
- **a4 [ULT]** tokamak_crimson_cannon  (`crimson_cannon`) - 16 files
- _non-ability (weapon/movement):_ modifier (1)

## Trapper  (`trapper`)
- **a1** Bottled Phantasmicide  (`poisonjar`) - 8 files
- **a2** Silktrap  (`webwall`) - 4 files
- **a3** Pest Barrier  (`spidershield`) - 4 files
- **a4 [ULT]** Crawling Plague  (`spiderwave`) - 6 files

## Venator  (`priest`)
- **a1** Consecrating Grenade  (`flashbang`) - 0 files
- **a2** Gutshot  (`knockback`) - 9 files
- **a3** Hex-Lined Snap Trap  (`beartrap`) - 25 files
- **a4 [ULT]** Ira Domini  (`weaponswap`) - 0 files
- _non-ability (weapon/movement):_ crossbow (9)
- _orphaned (removed ability):_ witching (22), shredding (17)

## Victor  (`frank`)
- **a1** Pain Battery  (`shocktarget2`) - 10 files
- **a2** Jumpstart  (`selfzap`) - 5 files
- **a3** Aura of Suffering  (`painaura`) - 0 files
- **a4 [ULT]** Shocking Reanimation  (`revive`) - 2 files

## Vindicta  (`hornet`)
- **a1** Stake  (`chain`) - 14 files
- **a2** Flight  (`leap`) - 33 files
- **a3** Crow Familiar  (`sting`) - 25 files
- **a4 [ULT]** Assassinate  (`snipe`) - 18 files

## Viscous  (`viscous`)
- **a1** Splatter  (`goo_grenade`) - 64 files
- **a2** The Cube  (`restorative_goo`) - 14 files
- **a3** Puddle Punch  (`telepunch`) - 9 files
- **a4 [ULT]** Goo Ball  (`goo_bowling_ball`) - 22 files
- _non-ability (weapon/movement):_ goo (3)

## Vyper  (`viper`)
- **a1** Screwjab Dagger  (`debuffdagger`) - 18 files
- **a2** Lethal Venom  (`venom`) - 5 files
- **a3** Slither  (`snakedash`) - 19 files
- **a4 [ULT]** Petrifying Bola  (`petrifybola`) - 12 files

## Warden  (`warden`)
- **a1** Alchemical Flask  (`crowd_control`) - 12 files
- **a2** Willpower  (`high_alert`) - 3 files
- **a3** Binding Word  (`lock_down`) - 8 files
- **a4 [ULT]** Last Stand  (`riot_protocol`) - 10 files

## Wraith  (`wraith`)
- **a1** Card Trick  (`toss`) - 38 files
- **a2** Project Mind  (`projectmind`) - 31 files
- **a3** Full Auto  (`rapidfire`) - 1 files
- **a4 [ULT]** Telekinesis  (`lift`) - 5 files

## Wrecker  (`wrecker`)
- **a1** Wrecking Ball  (`bouldergrenade`) - 10 files
- **a2** Consume  (`salvage`) - 8 files
- **a3** Bio Blast  (`blast`) - 0 files
- **a4 [ULT]** Overload  (`garbage_suck`) - 11 files
- _non-ability (weapon/movement):_ trap (2)

## Yamato  (`yamato`)
- **a1** Power Slash  (`slash`) - 50 files
- **a2** Flying Slash  (`strike`) - 10 files
- **a3** Crimson Slash  (`slash`) - 0 files
- **a4 [ULT]** Shadow Transformation  (`slash`) - 27 files
- _non-ability (weapon/movement):_ stance (1)
- _uncertain (verify in-game):_ blinding (4), blink (3), decimate (2)
