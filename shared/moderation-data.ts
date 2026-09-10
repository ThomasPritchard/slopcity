// Chat moderation blocklist: BLOCKED_* are slurs, hate terms and severe sexual/violent/shock content.
// ALLOWED_MILD documents ordinary swearing and crude slang that this product deliberately permits.
export const BLOCKED_TERMS: readonly string[] = [
  // 0-9
  '2 girls 1 cup', '2g1c',
  // a
  'acrotomophilia', 'alabama hot pocket', 'alaskan pipeline', 'anal beads', 'anal sex', 'anilingus', 'auto erotic', 'autoerotic',
  // b
  'baby batter', 'baby juice', 'ball gag', 'ball licking', 'ball sucking', 'bareback', 'barely legal', 'beaner', 'beaners',
  'beastiality', 'bestiality', 'blow job', 'blowjob', 'blue waffle', 'blumpkin', 'brown showers', 'bukkake', 'bulldyke', 'butt pirate',
  // c
  'camgirl', 'camslut', 'camwhore', 'carpet muncher', 'child porn', 'chink', 'cleveland steamer', 'coprolagnia', 'coprophilia',
  'creampie', 'cumming', 'cumshot', 'cunnilingus',
  // d
  'darkie', 'darky', 'date rape', 'daygo', 'deep throat', 'deepthroat', 'dego', 'dirty sanchez', 'doggy style', 'doggystyle',
  'donkey punch', 'double penetration', 'dyke',
  // d — 'dike' as a full word only (see WORD_END in moderation.ts): the substring hits 'diketone'.
  'dike',
  // f
  'fag', 'fag1t', 'fagget', 'faggit', 'faggot', 'faggott', 'fagit', 'fagot', 'fagott', 'fagots', 'fags', 'fagz', 'faig', 'faigs',
  'felch', 'felcher', 'felching', 'fellatio', 'female squirting', 'figging', 'fingerbang', 'fisting', 'footjob',
  'frotting', 'fudge packer',
  // g
  'gang bang', 'gangbang', 'gay sex', 'goatcx', 'goatse', 'gokkun', 'golden shower', 'gook', 'group sex',
  // h
  'hand job', 'handjob', 'hentai', 'hitler', 'honkey', 'honky', 'hot carl', 'how to kill', 'how to murder',
  // i
  'incest', 'injun', 'intercourse',
  // j
  'jack off', 'jackoff', 'jailbait', 'japs', 'jerk off', 'jigaboo', 'jiggaboo', 'jiggerboo',
  // k
  'kike', 'kkk', 'kraut', 'kyke',
  // l
  'lemon party', 'lesbo', 'lezzian', 'lipshits', 'lipshitz', 'lolicon', 'lolita',
  // m
  'masterbat', 'masturbat', 'meatspin', 'menage a trois', 'midget', 'milf', 'molest', 'molestation', 'molester', 'mongoloid',
  'mr hands', 'muff diver', 'muffdiving',
  // n
  'n1gr', 'nambla', 'nazi', 'necrophilia', 'negro', 'neonazi', 'nig nog', 'nigga', 'niggah', 'niggar', 'niggaz', 'nigger',
  'niggur', 'niglet', 'nignog', 'niiger', 'niigr', 'nigur',
  // o
  'one cup two girls', 'one guy one jar', 'orgy',
  // p
  'paedophile', 'pajeet', 'pakie', 'paky', 'pedobear', 'pedophile', 'pegging', 'phone sex',
  'pikey', 'pole smoker', 'polack', 'polak', 'poofta', 'poofter', 'porn', 'porno', 'pornography', 'porch monkey', 'pthc',
  // r
  'raghead', 'rape', 'rapist', 'redskin', 'retard', 'reverse cowgirl', 'rimjob', 'rusty trombone',
  // s
  'scissoring', 'shemale', 'shota', 'sodom', 'spastic', 'spaz', 'spick', 'spics', 'swastika',
  // t
  'threesome', 'throating', 'towelhead', 'trannie', 'tranny', 'tribadism', 'tub girl', 'tubgirl', 'twinks', 'two girls 1 cup',
  'two girls one cup',
  // u
  'upskirt', 'urophilia',
  // v
  'voyeur',
  // w
  'wetback', 'white power', 'white pride', 'wigger', 'whigger', 'wop',
  // y
  'yellow showers',
  // z
  'zoophilia',
];

export const BLOCKED_STEMS: readonly string[] = [
  'fag', 'kike', 'masterbat', 'masturbat', 'nigger', 'retard', 'tranny', 'wetback', 'wop',
];

// Documented for tests and review: these never match, and are excluded from BLOCKED_*.
export const ALLOWED_MILD: readonly string[] = [
  'arse', 'arsehole', 'arseholes', 'ass', 'asses', 'asshole', 'assholes', 'bastard', 'bastards', 'bimbo', 'bitch', 'bitches',
  'bitchy', 'bollocks', 'boner', 'boob', 'boobs', 'bugger', 'buggered', 'bullshit', 'butt', 'cock', 'crap', 'cunt', 'cunts',
  'damn', 'dick', 'dicks', 'dildo', 'douchebag', 'dumbass', 'ejaculate', 'erotic', 'fart', 'fuck', 'fucked', 'fucker', 'fucking',
  'hell', 'hooker', 'horny', 'jackass', 'jism', 'jizz', 'knob', 'motherfucker', 'nude', 'orgasm', 'panties', 'penis', 'piss',
  'pissing', 'poop', 'prick', 'pricks', 'pussy', 'quim', 'schmuck', 'screw', 'semen', 'sex', 'shit', 'shitty', 'skank', 'slut',
  'splooge', 'spunk', 'sucks', 'testicle', 'tits', 'topless', 'tosser', 'turd', 'twat', 'vagina', 'wanker', 'whore', 'willy',
];
