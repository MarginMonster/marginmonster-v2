/* THE GENRES ARE MOVIE CATEGORIES — one table the Movie Maker's page and its engine share.
 *
 * The owner, 2026-11-25: "Our genres need to be movie categories (drama, horror, comedy, etch)". The shelves
 * carried our own formats ("Short Film", "Moral Story", "Horror Story"); a film shelf has Drama, Comedy,
 * Horror, Thriller, Action, Romance, Sci-Fi, Fantasy, Mystery. And, the same morning, of the writer: "the
 * "write your dialogue" button generates a random scene and dialogue, atleast need a starter "nudge" couple
 * sentences to hand to the writer".
 *
 * So for EVERY story genre — keyed by the engine's template key, which never changes (a saved draft, a link
 * and every finished film hold it) — this file says:
 *
 *   · `card`      the word on the shelf ("Drama"; the Short Film template, `testmovie`, is SHOWN as Drama);
 *   · `backdrops` nine places a scene of that genre is set in. The key is one plain word of its own `where`
 *                 — that is how the chip of the place a scene is in lights up (a lighthouse once lit "Old
 *                 house", so the page matches the key as a WHOLE word). Horror's, Moral's, the Kids
 *                 Cartoon's and the general nine (now Drama's) are the page's own, copied exactly;
 *   · `starters`  eight ideas of one or two sentences — who, where, what goes wrong; each filmable by two
 *                 people talking; no real person, brand or show. A few are DEALT as chips under the idea box,
 *                 and an idea of fewer than three words is given one, so the writer is never handed nothing;
 *   · `notes`     the director's four one-tap notes for rewriting a scene of that genre ("Scarier", "Funnier",
 *                 "Shorter"…): `label` is on the button, `ask` is the sentence handed to the writer.
 *
 * And for the seven NEW genres, what makes each a template of the engine (film-engine.server.ts spreads the
 * Short Film's template under each, so they are acted and told by the same pipelines, at its lengths): a
 * `brief` that is a promise about what HAPPENS and how it ends — never an adjective — the brief for when it
 * is told by a narrator, a photographed LOOK (light, lens, palette), a score, and how the faces are.
 *
 * Pure: no imports. tests/film-genres.test.ts. */

export type Backdrop = { key: string; label: string; where: string };
export type DirectorNote = { key: string; label: string; ask: string };
export type FilmGenre = {
  /** the engine's template key */
  tmpl: string;
  /** the word on the shelf */
  card: string;
  backdrops: readonly Backdrop[];
  starters: readonly string[];
  notes: readonly DirectorNote[];
};

/* ---- the notes two or more genres share: said once, so "Shorter" asks for the same thing everywhere ---- */
const SHORTER: DirectorNote = { key: "shorter", label: "Shorter", ask: "Tighten this scene: cut every line to what must be said, and drop any line that repeats another. Keep who speaks and what happens." };
const TWIST: DirectorNote = { key: "twist", label: "Add a twist", ask: "End this scene on a turn that makes what came before it mean something else — one that leaves every fact already said true." };

export const FILM_GENRES: readonly FilmGenre[] = [
  {
    tmpl: "testmovie",
    card: "Drama",
    // (the page's general nine — FILM_BACKDROPS — word for word)
    backdrops: [
      { key: "diner", label: "Diner", where: "a warm dim diner at night, rain on the windows" },
      { key: "street", label: "Street", where: "a rain-soaked city street at night, neon reflections on the wet asphalt" },
      { key: "office", label: "Office", where: "a quiet modern office after hours, city lights through the glass" },
      { key: "kitchen", label: "Kitchen", where: "a stainless-steel restaurant kitchen late at night, one lamp burning" },
      { key: "car", label: "Car", where: "inside a parked car at night, streetlights sliding past the windows" },
      { key: "living", label: "Living room", where: "a cozy living room in the evening, warm lamplight" },
      { key: "bar", label: "Bar", where: "a moody, dimly lit bar at night" },
      { key: "park", label: "Park", where: "a quiet park bench at dusk, soft golden light" },
      { key: "warehouse", label: "Warehouse", where: "a cold empty warehouse at night, shafts of moonlight" },
    ],
    starters: [
      "Two siblings meet at their late father's diner the night before it is sold. One has already signed the papers; the other has come to ask for one more year.",
      "A mother drives her daughter to the airport before dawn. Halfway there the daughter admits the ticket is one-way.",
      "A retiring mechanic hands his garage keys to his apprentice, who has come to tell him she is taking a job in another city.",
      "Two old friends meet on a park bench to split the last of the band's savings. One of them needs all of it and cannot say why.",
      "A nurse coming off a night shift finds her estranged brother waiting by her car, asking for a favour she swore she would never do again.",
      "A father teaches his teenage son to drive in an empty car park, the week before he moves out of the family home.",
      "A restaurant owner has to tell her head chef, her oldest friend, that tonight's service is their last.",
      "Two neighbours who have not spoken in ten years share a porch during a power cut, and the old argument is finally said out loud.",
    ],
    notes: [
      { key: "stakes", label: "More at stake", ask: "Raise what this scene costs them: one of the two stands to lose something they name, and the other knows it." },
      { key: "quieter", label: "Quieter", ask: "Play this scene quieter: fewer words, more left unsaid; let one small action carry what a line was saying." },
      SHORTER,
      { key: "choice", label: "End on a choice", ask: "Change the end of this scene so that it ends on one of them deciding something — the decision made, not explained." },
    ],
  },
  {
    tmpl: "comedy",
    card: "Comedy",
    backdrops: [
      { key: "office", label: "Office", where: "an open-plan office on a Monday morning, one wilting balloon tied to a chair" },
      { key: "wedding", label: "Wedding", where: "a wedding reception in a marquee, the cake table a little too close to the dance floor" },
      { key: "kitchen", label: "Kitchen", where: "a cramped flat kitchen at dinner time, every pan in use" },
      { key: "elevator", label: "Elevator", where: "a stuck elevator between two floors, the light humming" },
      { key: "restaurant", label: "Restaurant", where: "a restaurant far too fancy for them, candles and white tablecloths" },
      { key: "gym", label: "Gym", where: "a bright gym at six in the morning, mirrors on every wall" },
      { key: "car", label: "Car", where: "inside a small car packed to the roof, parked on a driveway in daylight" },
      { key: "supermarket", label: "Supermarket", where: "a supermarket aisle under bright lights, a trolley with one wobbly wheel" },
      { key: "waiting", label: "Waiting room", where: "a dentist's waiting room, a fish tank bubbling in the corner" },
    ],
    starters: [
      "A man told his new boss he speaks fluent Italian. On Monday an Italian client arrives, and his only way out is the coworker who really does.",
      "Two flatmates break their landlord's ugly vase an hour before the inspection and try to pass off a worse one as the original.",
      "A best man has lost the rings. He has four minutes, one bridesmaid and a vending machine to fix it before the music starts.",
      "A woman joined a gym to impress a trainer and said she runs marathons. He has just signed them both up for one on Sunday.",
      "Two strangers stuck in an elevator each believe the other is the famous food critic they came to impress.",
      "A dad promised a magician for the birthday party. The magician has cancelled, the guests arrive in ten minutes, and his brother knows one card trick.",
      "A couple house-sitting for her boss had one job: keep the fern alive. By day two it is brown, and they are buying lookalikes.",
      "Two rival neighbours have both secretly entered the village bake-off with the same shop-bought cake.",
    ],
    notes: [
      { key: "funnier", label: "Funnier", ask: "Make this scene funnier by pushing the same comic problem one step further — something they do, not a joke they tell; nobody notices it is funny." },
      { key: "drier", label: "Drier", ask: "Play this scene drier: both are completely serious about something ridiculous; shorter lines, no exclamation marks." },
      SHORTER,
      { key: "button", label: "Bigger button", ask: "Give this scene a stronger last line: a short one that turns the whole scene, set up by something said earlier in it." },
    ],
  },
  {
    tmpl: "horror",
    card: "Horror",
    // (the page's own nine for a horror story, word for word)
    backdrops: [
      { key: "house", label: "Old house", where: "the hallway of an old house at night, wallpaper peeling, one bulb flickering" },
      { key: "woods", label: "Woods", where: "dark woods at night, thin fog between the trees, a pale moon" },
      { key: "hospital", label: "Hospital", where: "an empty hospital corridor at night, one fluorescent light flickering" },
      { key: "basement", label: "Basement", where: "a damp basement lit by a single bare bulb" },
      { key: "cemetery", label: "Cemetery", where: "an old cemetery at night, mist low over the headstones" },
      { key: "motel", label: "Motel", where: "a highway motel room at night, the neon sign buzzing behind thin curtains" },
      { key: "attic", label: "Attic", where: "a dusty attic at night, moonlight through a round window" },
      { key: "road", label: "Empty road", where: "an empty country road at night, headlights fading into fog" },
      { key: "chapel", label: "Chapel", where: "an abandoned chapel at night, candles guttering in the draft" },
    ],
    starters: [
      "Two sisters clearing out their late mother's house at night hear her lullaby being hummed behind the locked door of the sewing room.",
      "A night nurse and a new porter find a patient in a ward that closed ten years ago, and the patient knows both their names.",
      "A couple's car breaks down on an empty road. The only house has its lights on, its door open and dinner laid for two.",
      "A babysitter and the baby's older brother watch the monitor: someone is standing over the cot. The room is empty when they look.",
      "Two friends house-sitting play the owner's voicemail of house rules. They have already broken the last one.",
      "Two night cleaners in an old theatre keep finding one seat in the royal box folded down, and it is warm.",
      "A brother and sister snowed in at a cabin count the footprints leading to the door: three sets coming in, none going out.",
      "A woman is driving her husband home from the last train when her phone rings. It is her husband, still waiting at the station.",
    ],
    notes: [
      { key: "scarier", label: "Scarier", ask: "Make this scene more frightening without gore: one more thing that is wrong and not explained, noticed by one of them before the other." },
      { key: "slower", label: "Slower burn", ask: "Slow this scene down: hold the dread longer before anything happens; they talk around what they are afraid of." },
      SHORTER,
      TWIST,
    ],
  },
  {
    tmpl: "thriller",
    card: "Thriller",
    backdrops: [
      { key: "garage", label: "Parking garage", where: "an underground parking garage at night, one strip light buzzing" },
      { key: "motel", label: "Motel", where: "a roadside motel room at night, the curtains drawn, a car idling outside" },
      { key: "office", label: "Office", where: "a glass-walled office after hours, one desk lamp on, the city dark below" },
      { key: "train", label: "Night train", where: "a near-empty night train, the windows black, the carriage swaying" },
      { key: "stairwell", label: "Stairwell", where: "a concrete stairwell lit by emergency lights" },
      { key: "apartment", label: "Apartment", where: "a high-rise apartment at night, rain on the glass, the lights off" },
      { key: "pier", label: "Pier", where: "a fishing pier before dawn, fog on the water, one boat tied up" },
      { key: "diner", label: "Diner", where: "an all-night diner off the highway, two cups going cold" },
      { key: "cabin", label: "Cabin", where: "a cabin by a frozen lake, snow against the door, the stove ticking" },
    ],
    starters: [
      "A bank teller working late learns that the quiet colleague who offered her a lift home has had a copy of her house keys for months.",
      "Two strangers share a night-train compartment. One is carrying the other's photograph, and has been told to get off before the next station.",
      "A woman's brother begs her to say he was with her last night. The police are ten minutes away, and she has just seen what is in his bag.",
      "An accountant shows his boss a mistake in the books after hours. It is not a mistake, and the doors lock from the security desk.",
      "A couple renting a lake cabin find the last guests' car still in the shed. The owner is on his way over with the spare key.",
      "A rideshare driver realises the address her passenger gave is her own home.",
      "A whistleblower meets a journalist in a parking garage at midnight. Only one of them was told the meeting had been moved.",
      "A nurse recognises the man sitting by her patient's bed: an hour ago she watched him let the air out of a car's tyres outside.",
    ],
    notes: [
      { key: "stakes", label: "Raise the stakes", ask: "Raise the stakes of this scene: say what happens to one of them if this goes wrong, and make it a little worse than they thought." },
      { key: "clock", label: "Tighter clock", ask: "Put a clock on this scene: something is due in minutes, both of them know it, and one line says how long is left." },
      SHORTER,
      { key: "turn", label: "Add a turn", ask: "End this scene on a turn the story already planted: one of them knew something, and a line earlier in the scene is why." },
    ],
  },
  {
    tmpl: "action",
    card: "Action",
    backdrops: [
      { key: "rooftop", label: "Rooftop", where: "a city rooftop at dusk, air vents and a long drop to the street" },
      { key: "alley", label: "Alley", where: "a narrow back alley after rain, fire escapes overhead" },
      { key: "market", label: "Market", where: "a crowded street market at midday, awnings and crates on every side" },
      { key: "garage", label: "Parking garage", where: "a multi-storey parking garage, ramps curling down into shadow" },
      { key: "docks", label: "Docks", where: "container docks at night, cranes and floodlights" },
      { key: "train", label: "Train", where: "the gangway between two carriages of a moving train, countryside streaking past" },
      { key: "stairwell", label: "Stairwell", where: "a tower-block stairwell, twelve floors of concrete steps" },
      { key: "highway", label: "Highway", where: "the hard shoulder of a desert highway in the heat, a car with its doors open" },
      { key: "warehouse", label: "Warehouse", where: "a warehouse stacked with pallets, daylight through the high windows" },
    ],
    starters: [
      "A bike courier is handed the wrong package. Its owner wants it back, and she has six blocks, one rooftop and a river to cross to reach the police first.",
      "Two siblings must get their grandfather's truck out of an impound yard before the gates lock at six: over the fence, past the dog, with no keys.",
      "A night guard and a thief who has just changed her mind have four minutes to get out of a building whose doors are sealing floor by floor.",
      "A climber and her injured partner must cross a rope bridge in a rising storm before the last cable goes.",
      "A stunt driver has to get a witness across the city in twenty minutes, with two cars behind them and every bridge closing.",
      "Two firefighters cut off on the ninth floor of a tower have one hose, one stairwell and a door that will not open.",
      "A fisherman and his daughter race a storm back to harbour with a failing engine, and another boat that will not let them pass.",
      "A train guard and a passenger chase a bag thief down the length of a moving night train, carriage by carriage.",
    ],
    notes: [
      { key: "bigger", label: "Bigger moment", ask: "Give this scene one bigger physical thing that happens in it — a jump, a fall, a door forced — said as what is done, with no gunfire and no gore." },
      { key: "faster", label: "Faster", ask: "Make this scene move faster: shorter lines, said while doing something; nobody stops to explain." },
      SHORTER,
      { key: "obstacle", label: "Harder obstacle", ask: "Put one more thing between them and what they are after in this scene, and let them get past it with what is already there." },
    ],
  },
  {
    tmpl: "romance",
    card: "Romance",
    backdrops: [
      { key: "cafe", label: "Café", where: "a small cafe on a rainy afternoon, steam on the windows" },
      { key: "bookshop", label: "Bookshop", where: "a narrow second-hand bookshop at dusk, ladders against the shelves" },
      { key: "rooftop", label: "Rooftop", where: "a rooftop at golden hour, string lights and two folding chairs" },
      { key: "station", label: "Train station", where: "a train station platform at night, the last train due" },
      { key: "beach", label: "Beach", where: "an empty beach at sunrise, the tide going out" },
      { key: "kitchen", label: "Kitchen", where: "a small apartment kitchen late at night, one pan on the stove and two glasses" },
      { key: "market", label: "Flower market", where: "a flower market early in the morning, buckets of tulips on wet cobbles" },
      { key: "wedding", label: "Wedding", where: "the garden of somebody else's wedding at dusk, music from the marquee" },
      { key: "laundromat", label: "Laundromat", where: "a laundromat at midnight, the machines turning, nobody else in" },
    ],
    starters: [
      "Two strangers shelter from the rain in a bookshop doorway and argue over the one umbrella one of them is holding.",
      "A baker leaves a coffee on the same bench every morning for the night-bus driver. Today he is early, and she has to hand it to him herself.",
      "Two exes are seated side by side at a friend's wedding. Each has a speech to give, and neither has said they kept the letters.",
      "A translator reads a widower his late wife's letters, one a week. They have reached the last one, and neither wants it read.",
      "Two rival food-truck owners share one parking space, one generator and, tonight, the only customer on the street.",
      "A man has missed the last train home on purpose three weeks running, to talk to the woman who sweeps the platform.",
      "Two best friends rehearse how he will propose to somebody else. She plays the bride, and the line comes out wrong.",
      "A florist delivers the same apology bouquet to the same door every Friday. This Friday the woman asks who is really sending them.",
    ],
    notes: [
      { key: "tension", label: "More tension", ask: "Put more unsaid between them in this scene: each wants to say one thing and says something beside it instead." },
      { key: "sweeter", label: "Sweeter", ask: "Make this scene warmer: one small kind thing one of them does for the other without being asked." },
      SHORTER,
      { key: "gesture", label: "End on a gesture", ask: "End this scene on something one of them DOES instead of a declaration — a hand held out, a coat lent, a door left open." },
    ],
  },
  {
    tmpl: "scifi",
    card: "Sci-Fi",
    backdrops: [
      { key: "apartment", label: "Apartment", where: "a small near-future apartment at night, the windows dimming themselves" },
      { key: "lab", label: "Lab", where: "a university lab after hours, one machine still humming under a dust sheet" },
      { key: "clinic", label: "Clinic", where: "a bright white clinic waiting room, soft seats and no reception desk" },
      { key: "train", label: "Train", where: "a silent high-speed train crossing farmland at dawn" },
      { key: "farm", label: "Indoor farm", where: "an indoor farm, racks of lettuce under violet grow lights" },
      { key: "station", label: "Ice station", where: "a research station on the ice, wind turbines turning in the dusk" },
      { key: "rooftop", label: "Rooftop", where: "a rooftop garden above the city at dusk, delivery drones crossing the sky far off" },
      { key: "workshop", label: "Workshop", where: "a home workshop in a garage, a half-built machine on the bench" },
      { key: "kitchen", label: "Kitchen", where: "a family kitchen in the morning, a household robot standing folded in the corner" },
    ],
    starters: [
      "A woman gets a call from herself, eleven minutes in the future, begging her not to open the door to her brother.",
      "A widower's home assistant has started answering in his late wife's voice. His daughter wants it wiped tonight.",
      "A couple can afford one memory backup between them. The clinic closes in an hour, and they still disagree on whose year to keep.",
      "A technician testing a machine that shows tomorrow's weather sees her own kitchen in it, and her husband packing a suitcase.",
      "Two siblings inherit their mother's house and the caretaker robot she taught to lie to them about how ill she was.",
      "A long-haul driver is told his truck will drive itself from Monday. He has one last night shift to teach it the road.",
      "A man wakes from a medical sleep that was meant to last a week. His wife is sitting by the bed, thirty years older.",
      "A girl's translator earpiece stops working on the day she meets her grandmother, and for once the two have to manage without it.",
    ],
    notes: [
      { key: "weirder", label: "Weirder", ask: "Push the one speculative idea of this scene a step further, so that it costs one of them something personal." },
      { key: "human", label: "More human", ask: "Keep the idea and make this scene about the two people: what it changes between them, in plain words, with nobody explaining how it works." },
      SHORTER,
      TWIST,
    ],
  },
  {
    tmpl: "fantasy",
    card: "Fantasy",
    backdrops: [
      { key: "tavern", label: "Tavern", where: "a low-beamed tavern at night, a fire in the hearth, rain on the shutters" },
      { key: "forest", label: "Forest", where: "an old forest at dawn, moss on the roots, mist between the trunks" },
      { key: "castle", label: "Castle hall", where: "a cold stone castle hall, tall windows, banners gone grey with age" },
      { key: "village", label: "Village", where: "a hillside village at market time, thatched roofs and a muddy lane" },
      { key: "forge", label: "Forge", where: "a blacksmith's forge at dusk, the coals low, tools on the wall" },
      { key: "tower", label: "Tower", where: "the top room of a stone tower, shelves of jars, one narrow window" },
      { key: "harbour", label: "Harbour", where: "a fishing harbour under a grey sky, wooden boats and drying nets" },
      { key: "mountain", label: "Mountain pass", where: "a high mountain pass in the snow, a rope bridge ahead" },
      { key: "ruins", label: "Ruins", where: "the ruins of a temple overgrown with ivy, afternoon sun through the broken roof" },
    ],
    starters: [
      "A ferryman may ask every passenger for one true thing as the fare. The queen's messenger pays with a lie, and the river will not let the boat move.",
      "A village healer can cure any fever by giving up a year of her own life. Tonight the blacksmith carries in his son.",
      "Two sisters inherit a lantern that shows the way to whatever its holder wants most. It points each of them somewhere different.",
      "A young mapmaker reaches the tavern at the edge of her map. The innkeeper says the road beyond is only there for those who leave something behind.",
      "A knight brings a borrowed sword home to the smith who forged it. It will not leave his hand until he says what he did with it.",
      "A baker's bread makes whoever eats it tell the truth until sundown. The tax collector has just bought a loaf for the mayor.",
      "A shepherd finds that the wolf at his fire can speak, and that it will trade one winter of safety for one name.",
      "An apprentice opens the one jar her master told her never to open. Now every door in the tower opens onto yesterday.",
    ],
    notes: [
      { key: "wonder", label: "More wonder", ask: "Show the magic once more in this scene through what it DOES to something ordinary — never as glow, sparks or light." },
      { key: "price", label: "Higher price", ask: "Make the magic cost more in this scene: say what using it takes from the one who uses it, and let them hesitate." },
      SHORTER,
      TWIST,
    ],
  },
  {
    tmpl: "mystery",
    card: "Mystery",
    backdrops: [
      { key: "study", label: "Study", where: "a book-lined study in the evening, a desk lamp on, one drawer left open" },
      { key: "hotel", label: "Hotel", where: "the lobby of a faded seaside hotel out of season, keys on a board behind the desk" },
      { key: "library", label: "Library", where: "a public library at closing time, the last reading lamp on" },
      { key: "station", label: "Police station", where: "an interview room in a small police station, two chairs and a table" },
      { key: "train", label: "Sleeper train", where: "the corridor of a sleeper train at night, compartment doors down one side" },
      { key: "village", label: "Village", where: "a village green on a grey morning, a church and a row of cottages" },
      { key: "gallery", label: "Art gallery", where: "a small art gallery after closing, one empty space on the wall" },
      { key: "greenhouse", label: "Greenhouse", where: "an old greenhouse in the rain, ferns against the glass" },
      { key: "attic", label: "Attic", where: "an attic full of boxes, dust in the light from one small window" },
    ],
    starters: [
      "Who moved the clock? A hotel night manager and a guest who cannot sleep work out why the lobby clock is ten minutes fast, and who needed it to be.",
      "A grandmother's ring vanishes during Sunday lunch. The door was locked, nobody left the table, and the dog will not go near the piano.",
      "A librarian finds the same book returned every Friday with one more page missing. Tonight she and the caretaker wait to see who brings it.",
      "A village postman notices that one house has had no post for a month, though he puts a letter through its door every single day.",
      "Two cousins sorting their uncle's study find his chess game against himself, one move from mate, and a third coffee cup.",
      "A gallery guard and a cleaner find a painting hanging where a blank wall was yesterday. Nothing was stolen. Something was added.",
      "A baker's dough has been shaped overnight in a locked shop by somebody else's hands. She and her nephew sit up to find out whose.",
      "A sleeper-train steward counts nine breakfasts for eight berths. Every passenger swears they are travelling alone.",
    ],
    notes: [
      { key: "clue", label: "Another clue", ask: "Add one more clue to this scene: a small physical detail one of them notices and the other explains wrongly." },
      { key: "doubt", label: "More doubt", ask: "Let each of them suspect the other a little in this scene: one line that could be innocent, or not." },
      SHORTER,
      { key: "reveal", label: "Sharper reveal", ask: "Make the answer land harder in this scene: it turns on something already seen earlier, and is said in one plain line." },
    ],
  },
  {
    tmpl: "moral",
    card: "Moral",
    // (the page's own nine for a moral story, word for word)
    backdrops: [
      { key: "home", label: "At home", where: "a modest family home in the evening, warm lamplight" },
      { key: "school", label: "School", where: "a school corridor after the bell, lockers along the wall" },
      { key: "market", label: "Market", where: "a lively open-air market in the morning, stalls of fruit and bread" },
      { key: "office", label: "Office", where: "a small open office in the afternoon, desks by the window" },
      { key: "park", label: "Park", where: "a quiet park bench at dusk, soft golden light" },
      { key: "kitchen", label: "Kitchen", where: "a small family kitchen at dinner time, steam rising from a pot" },
      { key: "shop", label: "Corner shop", where: "a small corner shop, shelves to the ceiling, a bell on the door" },
      { key: "bus", label: "Bus stop", where: "a bus stop in the rain, one shelter light on" },
      { key: "street", label: "Street", where: "a neighbourhood street in the late afternoon, long shadows" },
    ],
    starters: [
      "A girl finds a phone on the bus and means to keep it, until it rings and she hears who is looking for it.",
      "A shopkeeper short-changes an old customer by mistake, and her new assistant must decide whether to say so in front of the queue.",
      "Two brothers share one bicycle. The older one wins every argument about whose turn it is, until the day he needs a push home.",
      "A student copies her best friend's homework and gets the higher mark. The teacher asks the friend to stay behind.",
      "A man laughs at the neighbour who sweeps the whole street every morning. Then the storm comes, and only one drain is clear.",
      "A girl promised to visit her grandmother on Saturday. Her friends have one spare ticket for the fair.",
      "A young cook blames the new dishwasher for a burnt order. The owner saw who was on the phone.",
      "Two market sellers have fought over the same corner for years. Today one of them cannot open her stall alone.",
    ],
    notes: [
      { key: "warmer", label: "Warmer", ask: "Make this scene warmer: one of them shows the other a small kindness, and it is noticed." },
      { key: "lesson", label: "Clearer lesson", ask: "Make what is learned plainer in this scene — shown by what one of them does, then said in one simple line." },
      SHORTER,
      { key: "real", label: "More real", ask: "Make this scene sound like two real people: everyday words, one small true detail, nobody making a speech." },
    ],
  },
  {
    tmpl: "kidstv",
    card: "Kids Cartoon",
    // (the page's own nine for a kids' cartoon, word for word)
    backdrops: [
      { key: "park", label: "Park", where: "a sunny park with a big green lawn and a red slide" },
      { key: "playground", label: "Playground", where: "a bright playground with swings and a sandbox under a blue sky" },
      { key: "bedroom", label: "Bedroom", where: "a cozy bedroom full of toys, warm morning light through the curtains" },
      { key: "classroom", label: "Classroom", where: "a cheerful classroom with crayon drawings on the walls" },
      { key: "backyard", label: "Backyard", where: "a leafy backyard with a treehouse in the afternoon sun" },
      { key: "beach", label: "Beach", where: "a sandy beach with gentle waves and a bright blue sky" },
      { key: "farm", label: "Farm", where: "a friendly farm with a red barn and a white fence" },
      { key: "forest", label: "Forest", where: "a sunlit forest clearing with tall trees and wildflowers" },
      { key: "kitchen", label: "Kitchen", where: "a bright family kitchen in the morning, sunlight through the window" },
    ],
    starters: [
      "A little fox loses his red kite in the tallest tree in the park, and his friend the rabbit has an idea that needs both of them.",
      "A bear cub wants to bake a birthday cake for his mum, but he and his duckling friend have only ever made mud pies.",
      "Two kittens come to a puddle too wide to jump, and one of them does not want to get her new boots wet.",
      "A small robot and a puppy build the tallest block tower in the playroom, and must decide who puts the last block on top.",
      "A shy hedgehog wants to join the ball game but worries about her prickles. Her friend the mouse finds a way she can play.",
      "A penguin chick is nervous about his first swimming lesson, until his big sister shows him her trick with the float.",
      "Two bunnies plant one carrot seed and cannot agree whose turn it is to water it. By teatime the pot has had far too much to drink.",
      "A little elephant is too big for hide-and-seek, until her friend the bird finds her the perfect hiding place on the farm.",
    ],
    notes: [
      { key: "sillier", label: "Sillier", ask: "Make this scene sillier in a gentle way: one funny thing goes a little wrong and both of them giggle; nothing scary, nothing mean." },
      { key: "gentler", label: "Gentler", ask: "Make this scene softer and calmer: slower, kinder words that a three-year-old can follow." },
      SHORTER,
      { key: "happy", label: "Happier ending", ask: "End this scene with both friends happy together, the little problem solved by sharing or by helping." },
    ],
  },
];

const BY_TMPL: Record<string, FilmGenre> = Object.fromEntries(FILM_GENRES.map((g) => [g.tmpl, g]));
/** The genre a template is shown as — undefined for a format that is not a story genre (a music video). */
export const genreOf = (tmplKey: string | null | undefined): FilmGenre | undefined => (tmplKey ? BY_TMPL[tmplKey] : undefined);
/** The word on the shelf for a template ("Drama" for `testmovie`); "" when it is not a story genre. */
export const categoryOf = (tmplKey: string | null | undefined): string => genreOf(tmplKey)?.card || "";
/** The nine places a scene of this genre is offered; a format with none of its own is offered Drama's — the
 *  general nine, as the page did (`BACKDROPS_BY_FORMAT[format] || FILM_BACKDROPS`). */
export const backdropsOf = (tmplKey: string | null | undefined): readonly Backdrop[] => (genreOf(tmplKey) || BY_TMPL.testmovie).backdrops;
/** The genre's eight starter ideas; none for a format that is not a story genre. */
export const startersOf = (tmplKey: string | null | undefined): readonly string[] => genreOf(tmplKey)?.starters || [];
/** The director's four notes for rewriting a scene of this genre; Drama's for a format with none of its own. */
export const notesOf = (tmplKey: string | null | undefined): readonly DirectorNote[] => (genreOf(tmplKey) || BY_TMPL.testmovie).notes;

/** Dice from a seed (mulberry32): the same seed deals the same hand, the next seed another. */
function diceOf(seed: number): () => number {
  let a = (Math.floor(Number.isFinite(seed) ? seed : 0) >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A FEW STARTERS, DEALT: `n` of the genre's eight (three unless said), a different few for another seed and
 *  never the same one twice in a deal. Fewer than `n` only when the genre has fewer; none for a format that is
 *  not a story genre. */
export function dealStarters(tmplKey: string | null | undefined, seed: number, n = 3): string[] {
  const left = [...startersOf(tmplKey)];
  const dice = diceOf(seed);
  const out: string[] = [];
  const want = Math.max(0, Math.floor(n));
  while (out.length < want && left.length) out.push(left.splice(Math.min(left.length - 1, Math.floor(dice() * left.length)), 1)[0]);
  return out;
}

/* ---- THE STARTER FALLBACK ---- the writer is never handed nothing */

/** An idea of fewer than this many words is not an idea yet. */
export const IDEA_MIN_WORDS = 3;
/** Scripts written without spaces between words (Chinese, Japanese, Thai, Lao, Khmer, Burmese). Not Korean:
 *  Hangul puts a space between its words, so it is counted as any spaced language is — counted two syllables to
 *  a word, "유령 이야기" ("ghost story", two words) was three and went to the writer as a whole idea. */
const UNSPACED = /[฀-໿က-႟ក-៿぀-ヿ㐀-䶿一-鿿]/gu;
/** How many words an idea has. A language written without spaces is counted two characters to a word — or
 *  "两个姐妹在老房子里听到敲门声", a whole premise, would be one "word" and be thrown away for a starter. */
export function ideaWords(idea: string | null | undefined): number {
  const s = String(idea || "");
  const unspaced = (s.match(UNSPACED) || []).length;
  const spaced = s.replace(UNSPACED, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return spaced + Math.ceil(unspaced / 2);
}

/** What the writer is handed when the maker gave it (almost) nothing. */
export type Nudge = {
  /** the idea the story is written from: the starter */
  topic: string;
  /** the starter that was dealt — kept on the treatment (`nudge`) so the page can show which */
  nudge: string;
  /** the one or two words the maker did type, when the starter does not already hold them: to be worked in */
  typed: string;
};
/** THE STARTER FALLBACK. An idea of fewer than three words becomes one of the genre's starters (the owner,
 *  2026-11-25: "atleast need a starter "nudge" couple sentences to hand to the writer"). A word or two the maker
 *  DID type is not thrown away: the starter that has that word in it is the one taken ("lighthouse" → the
 *  lighthouse one) and, when none has, the words ride along to be worked in. null: the idea stands as it is
 *  (three words or more), or the format is not a story genre and has no starters. */
export function nudgeFor(tmplKey: string | null | undefined, idea: string | null | undefined, seed: number): Nudge | null {
  const typed = String(idea || "").replace(/\s+/g, " ").trim();
  if (ideaWords(typed) >= IDEA_MIN_WORDS) return null;
  const all = startersOf(tmplKey);
  if (!all.length) return null;
  // (a word of four letters or more: "the" and "and" are at the start of a word in every starter)
  const words = typed.toLowerCase().split(" ").map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")).filter((w) => w.length >= 4);
  const has = (s: string, w: string): boolean => new RegExp(`(^|[^\\p{L}])${w}`, "iu").test(s);
  // (the starters that hold the MOST of what was typed: "night train" is the one with both, not every "last night")
  const held = all.map((s) => words.filter((w) => has(s, w)).length);
  const most = Math.max(0, ...held);
  const fitting = most ? all.filter((_, i) => held[i] === most) : [];
  const dice = diceOf(seed);
  const from = fitting.length ? fitting : all;
  const nudge = from[Math.min(from.length - 1, Math.floor(dice() * from.length))];
  // (only WORDS ride along: "?" or "…" typed into the box is nothing to work in — the writer was told 'The maker
  //  typed only "?" … work it into the story')
  return { topic: nudge, nudge, typed: fitting.length || !/[\p{L}\p{N}]/u.test(typed) ? "" : typed.slice(0, 60) };
}
/** …and what the writer is told about a theme that was DEALT, right after it (film-engine → the THEME line):
 *   · a word or two the maker typed that the starter does not hold is worked in;
 *   · a cast the maker CHOSE is the starter's people. A starter names its own ("two siblings", "a mother and
 *     her daughter") and the rules after it hold a story to its idea's people — their number, ages, what they
 *     are to each other. A maker who picked two presenters, or a werewolf, and typed nothing asked for a story
 *     about THEM: so for a dealt theme the cast decides who the people are, and the rules that follow are told
 *     that this is what "the idea" means here.
 *  "" when there is nothing to add (the starter alone, no cast chosen). */
export function startLine(n: Nudge, castChosen: boolean): string {
  const typed = n.typed ? `The maker typed only "${n.typed.replace(/["“”]/g, "'")}" — the theme above was dealt to start from that: work it into the story. ` : "";
  const cast = castChosen
    ? "The theme above was dealt as a place to start, and the cast was chosen separately: its people ARE the chosen cast below — how many they are, who they are to each other, their ages and whether each is a man, a woman, a creature or a cartoon are the cast's, not the theme's; keep the theme's place and what goes wrong. For every rule that follows, \"the idea\" is this theme with the chosen cast as its people. "
    : "";
  return typed || cast ? `${typed}${cast}`.trim() + "\n" : "";
}

/* ---- THE SEVEN NEW GENRES AS TEMPLATES ---- */

/** What makes a new genre a template of the engine. Everything else — that it is acted by the dialogue engine,
 *  can be told by a narrator, its captions, its scene counts — is the Short Film's (`genreTemplate`). */
export type GenreFilm = {
  key: string;
  /** the template's own name: what its ACTED film is called ("Comedy Film") */
  name: string;
  /** how the writer of the ACTED film is briefed — "Write <brief>." */
  brief: string;
  /** …and of the story told by a NARRATOR */
  narrated: string;
  /** the LOOK: light, lens, palette — said to the writer and to every picture */
  sceneHint: string;
  /** the score the track falls back to */
  musicHint: string;
  /** how the people in a picture look, where the genre has a say */
  faceMood?: string;
  /** THE GENRE'S WORLD IS ITS OWN, NOT TODAY'S (Fantasy). Every grown-up story's writer is told "IT IS TODAY'S
   *  REAL WORLD … no castle, no lone stone cottage, no cabin" (premise-rules.ts → REAL_WORLD, earned by a horror
   *  story whose children lived in a fairytale cottage). Said to a fantasy, that rule forbids the genre. So its
   *  writer is not told it — and its brief asks for every place to be SAID as what it is in that old world,
   *  because the pictures are still drawn from the words (story-picture.ts → TODAY_LOOK holds only "where these
   *  words do not say how old a place is"). */
  ownWorld?: boolean;
};

/* (every look ends the way the Short Film's does: the pictures are drawn from these words, and a set with
 *  papers, signs or screens in it is drawn with letters that are not letters) */
const NOTHING_TO_READ = "real-looking people; a clean, uncluttered set with NO readable text, documents, papers, signage, posters or screens visible";

/** DRAMA is the Short Film (`testmovie`), sharpened. Its brief was a line of our own praise — "a cinematic
 *  SHORT FILM where your cast actually SPEAKS real dialogue … The flagship movie maker." — which told the
 *  writer nothing about what happens. */
export const DRAMA_BRIEF =
  "a short DRAMA, acted: ONE relationship under pressure — two people who matter to each other, and a choice that will cost one of them something. They say less than they mean; what they feel shows in small physical actions (a key put down, a coat kept on, a chair pulled closer). It ends on a decision being MADE, never on a speech about it";
/* (told by a narrator, a Drama's brief is written in the engine's own list — NARRATED_BRIEF.testmovie — beside
 *  horror's and the moral's, where a test of the shows reads it.) */

export const GENRE_FILMS: readonly GenreFilm[] = [
  {
    key: "comedy",
    name: "Comedy Film",
    brief: "a short COMEDY, acted: ONE comic engine — a lie that keeps growing, a mismatch, or a plan going wrong — pushed further three times, each worse than the last. The laugh is in what they DO and how seriously they take it, never a joke about jokes; neither of them knows it is funny, and nobody winks at the camera. Short lines; the last line is the button — it turns the whole scene, and something said earlier set it up",
    narrated: "a short NARRATED COMEDY — a storyteller tells, completely deadpan, how one small lie, mismatch or plan got out of hand: it goes wrong three times, each worse than the last, and the last line is the button that turns it all",
    sceneHint: `a photorealistic live-action film scene from a comedy — bright even daylight or warm household lamps, a 28mm lens that keeps both people and the whole room in frame, clean saturated colours (warm yellow, sky blue, a red or two), everything in focus; ${NOTHING_TO_READ}`,
    musicHint: "light, dry comedy underscore — pizzicato strings, a walking bass, a clarinet",
    faceMood: "Everybody in it is completely serious about what they are doing — nobody mugs, winks or looks at the camera.",
  },
  {
    key: "thriller",
    name: "Thriller Film",
    brief: "a short THRILLER, acted: the threat is a PERSON or a situation — never a ghost, a monster or anything supernatural. There is a clock or a secret, and it is said early; every line brings it closer or makes it worse; and it ends on a turn the story already planted, so that an earlier line now means something else. Tension, not violence: nothing graphic is shown",
    narrated: "a short NARRATED THRILLER — a storyteller's voice, tight and plain: the threat is a person or a situation, never the supernatural; a clock or a secret from the first lines, every scene closer to it, and an ending that turns on something the story already told",
    sceneHint: `a photorealistic live-action film scene from a thriller — night, or a room with the blinds drawn, lit by one hard practical source (a desk lamp, a street light through glass), a 50mm lens at eye level, cold steel-blue shadow against sodium-orange light, deep blacks, fine film grain; ${NOTHING_TO_READ}`,
    musicHint: "taut thriller score — a low pulse, ticking percussion, held strings",
    faceMood: "Everybody in it looks watchful or under strain — nobody smiles, grins or laughs.",
  },
  {
    key: "action",
    name: "Action Film",
    brief: "a short ACTION film, acted: a physical goal, said in the first line, and an obstacle in the way of it. Something HAPPENS in every shot that a camera can film in one take — a run, a climb, a door forced, a jump, a getaway on foot — and the lines are terse, said while doing it. No gunfire, no gore and no explosion near the camera: the danger is height, speed, time and whoever is behind them. It ends in one move, the goal reached or lost",
    narrated: "a short NARRATED ACTION STORY — a storyteller's voice at a run: a physical goal, an obstacle, and something that HAPPENS in every scene (a chase on foot, a climb, a crossing, a getaway); no gunfire and no gore; it ends in one move, won or lost",
    sceneHint: `a photorealistic live-action film scene from an action film — hard low sun or floodlight, a 24mm lens low and close to the people, teal shadow and warm skin, dust or rain in the air, a fast shutter that freezes the movement; ${NOTHING_TO_READ}`,
    musicHint: "driving action score — fast drums, low brass, urgent strings",
    faceMood: "Everybody in it looks set and out of breath — nobody smiles or poses.",
  },
  {
    key: "romance",
    name: "Romance Film",
    brief: "a short ROMANCE, acted: two people, what each wants from the other, and the one thing in the way. They talk about something else — the feeling is in what is not said, in a look held a moment too long, in what their hands do. It ends on a GESTURE instead of a declaration: an umbrella shared, a seat kept, a door left open. Tender, never explicit",
    narrated: "a short NARRATED LOVE STORY — a storyteller's voice, warm and unhurried: two people, what each wants and what is in the way, told through the small things they do for each other; it ends on a gesture, not a declaration",
    sceneHint: `a photorealistic live-action film scene from a romance — soft window light or golden hour, an 85mm lens with the background fallen out of focus, warm amber and rose tones, gentle contrast, a little halation round the lights; ${NOTHING_TO_READ}`,
    musicHint: "tender romance score — solo piano and warm strings",
  },
  {
    key: "scifi",
    name: "Sci-Fi Film",
    brief: "a short SCIENCE-FICTION film, acted: ONE speculative idea in an otherwise ordinary near-future world — everything else is as real and as familiar as today. The idea is never explained: it is seen in what it changes between two people, and the story is about them. No space battles, no aliens, no laboratory full of screens — and any screen in a shot shows nothing that can be read. It ends on what the idea has cost one of them, or given them",
    narrated: "a short NARRATED SCIENCE-FICTION STORY — a storyteller's voice: ONE speculative idea in an otherwise ordinary near-future world, never explained, seen in what it changes between two people; no space battles; it ends on what the idea cost them, or gave them",
    sceneHint: `a photorealistic live-action film scene set a few years from now — clean architecture and ordinary clothes, cool overcast daylight or soft white practical light, a 35mm lens, a restrained palette of slate, white and one accent of cyan; a device or a screen shows only soft abstract light, never words or numbers; real-looking people; a clean, uncluttered set with NO readable text, documents, papers, signage or posters visible`,
    musicHint: "spare, glassy electronic score — soft analogue synths over a slow pulse",
  },
  {
    key: "fantasy",
    name: "Fantasy Film",
    brief: "a short FANTASY film, acted: a world that feels lived in — worn tools, mended clothes, mud on the boots — with ONE piece of magic in it, and that magic has a PRICE, which is said. The magic is seen only through what it does to ordinary things (a door that opens on the wrong room, bread that makes people tell the truth), never as glow, sparks, beams or light. It is an old world of its own, before engines and electricity: say every place as what it is there — its stone, timber, thatch and firelight — because the pictures are drawn from those words. It ends on the price being paid, or refused",
    narrated: "a short NARRATED FANTASY TALE — the kind told by a fire: an old world of its own, before engines and electricity, that feels lived in (say each place's stone, timber, thatch and firelight); ONE piece of magic with a price, seen through what it does and never as glow or sparks; it ends on the price being paid, or refused",
    ownWorld: true,
    sceneHint: `a photorealistic live-action film scene from a fantasy film shot on real locations — firelight, candlelight or grey northern daylight, a 35mm lens, earth colours (moss green, ochre, undyed wool, weathered wood), hand-made costumes and props that have been used, no visual effects and nothing that glows; ${NOTHING_TO_READ}`,
    musicHint: "folk-coloured fantasy score — low strings, a wooden flute, a frame drum",
  },
  {
    key: "mystery",
    name: "Mystery Film",
    brief: "a short MYSTERY, acted: the first line asks the QUESTION the story answers. Every shot holds one clue — a physical thing that is seen or picked up — and the two reason it out aloud, getting it wrong before they get it right. The answer was in plain sight earlier: the last line names it, and a viewer can look back and find it. Nothing gory and no killing shown; the puzzle is the pleasure",
    narrated: "a short NARRATED MYSTERY — a storyteller's voice that opens on the question: a clue in every scene, one wrong answer on the way, and a solution that was in plain sight in an earlier scene",
    sceneHint: `a photorealistic live-action film scene from a mystery — pools of lamplight in a dim room, or flat grey daylight through rain, a 40mm lens with the object that matters sharp in the foreground, muted greens, browns and brass, soft shadow; ${NOTHING_TO_READ}`,
    musicHint: "quiet, curious mystery score — plucked bass, vibraphone, brushed drums",
    faceMood: "Everybody in it looks curious or guarded — nobody grins or laughs.",
  },
];

/** A new genre's template: the Short Film's, with the genre's own key, name, briefing, look, score and faces.
 *  Its lengths (default / fewest / most shots), its captions and that it is acted and can be told are the
 *  base's — one place to change them, and a genre never drifts from the film it is made like. */
export function genreTemplate<T extends { key: string; name: string; brief: string; sceneHint: string; musicHint: string; faceMood?: string; ownWorld?: boolean }>(base: T, g: GenreFilm): T {
  const out: T = { ...base, key: g.key, name: g.name, brief: g.brief, sceneHint: g.sceneHint, musicHint: g.musicHint };
  // (the faces and the world are the genre's own, or nobody's: neither is ever inherited)
  if (g.faceMood) out.faceMood = g.faceMood; else delete out.faceMood;
  if (g.ownWorld) out.ownWorld = true; else delete out.ownWorld;
  return out;
}
