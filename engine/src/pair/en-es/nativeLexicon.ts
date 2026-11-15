/**
 * Common English words, normalized (lowercase, in-word apostrophes kept), used to spot
 * English words inside a Spanish reply ("quiero ir a the beach").
 *
 * Every word that is also a common Spanish word or form is left out, including forms
 * that differ only by an accent, so a Spanish reply is never flagged as English. The
 * word list below was written without them, and SPANISH_LOOKALIKES is applied as a
 * filter as well, which also records the decisions. Clipped Caribbean forms that look
 * English (to = to', pa = pa', toy = 'toy, chin = un chin) are left out too.
 */

/**
 * English-looking words that are Spanish words or forms (or anglicisms common in
 * Spanish, especially in music), never treated as English: function words (a, no, me,
 * he, has, ha, con, sin, son, era, van, hay), verb forms (come, comes, dice, sale, use,
 * vote, decide, quite, note, verse, vine, tender, dame, dime, ate), nouns (as = ace,
 * do = the note C), accentless twins (menu,
 * cafe, area, video, region, version, record, corner, pure), and shared words (hotel,
 * animal, idea, plan, total, normal, final, general, real, solo, chocolate, radio...).
 */
export const SPANISH_LOOKALIKES: ReadonlySet<string> = new Set(
  `
a no me he has ha van dan den era son sea come comes dice sale use late mate base pose
debate tape cure fume tome tire cede nave dale hare dare dame dime mire pare vote invite
decide describe produce reduce introduce imagine prepare continue complete note quite
verse vine tender grave suave cobra mole media red pie once ten tan con sin fin par hay
pan mar ave plan total normal hotel motel animal actor idea final general real solo mesa
dos uno un la lo el en ya yo pro nada eh oh ah ay uh wow hey ok okay bye area menu cafe
sofa video region religion opinion union reunion legion version decision television
explosion invasion division confusion conclusion fusion tension pension extension
dimension expansion mansion color error doctor director editor factor sector motor
tractor monitor pastor tutor mentor horror terror honor favor labor humor rumor tumor
valor vapor tenor superior interior exterior inferior anterior posterior mayor
particular regular popular similar familiar peculiar solar lunar polar nuclear circular
singular vulgar neutral plural liberal federal oral dental formal informal casual usual
actual virtual visual sexual manual gradual individual ritual criminal terminal
original digital vital brutal metal pedal vocal tropical radical musical personal
mental sentimental fundamental accidental horizontal capital festival canal ideal legal
material industrial editorial colonial cordial crucial racial facial artificial trivial
genial universal central natural rural mural moral coral floral funeral lateral
integral global fatal postal cereal local social simple terrible horrible noble cable
probable notable variable flexible visible invisible sensible admirable adorable
inevitable considerable miserable favorable cruel civil chocolate radio piano pizza
pasta salsa patio plaza fiesta siesta taco macho loco amigo burro tornado mosquito cargo
rodeo vista alto cola coma opera chile tuna banana drama tango mango papaya tequila
whisky soda polo golf gas gel auto papa mama taxi bus club bar show shows test set top
box rock pop jazz rap fan web blog chat sexy baby hobby zoo kilo metro foto virus crisis
chef ballet alcohol melon sandwich hockey ranking marketing camping parking shopping
jeans shorts short pin mini super extra mega kit pub ring stand tour chip clip link post
record corner manager ticket shock hit single relax puzzle pure toy chin violin eleven
fallen to pa ta na ma
as do ate
`.split(/\s+/).filter(Boolean),
);

const DATA = `
i you she it we they him her us them my your his its our their mine yours hers ours
theirs myself yourself himself herself itself ourselves yourselves themselves this that
these those the an and but or if because so than then when where why how what which who
whom whose there here all any some each every both either neither few many much more
most less least other another such own same very too also just only even still already
yet again ever never always often sometimes usually really maybe perhaps about above
across after against along among around at before behind below beneath beside besides
between beyond by down during except for from in inside into near of off on onto out
outside over past since through throughout till toward towards under until up upon with
within without not yes nothing something anything everything nobody somebody anybody
everybody someone anyone everyone nowhere somewhere anywhere everywhere whatever
whenever wherever however whether while although though unless as do does did done doing
be am is are was were been being have had having would could should might must shall
will may can cannot

don't doesn't didn't can't couldn't won't wouldn't shouldn't isn't aren't wasn't weren't
haven't hasn't hadn't i'm you're he's she's it's we're they're i've you've we've they've
i'll you'll he'll she'll we'll they'll i'd you'd he'd she'd we'd they'd let's that's
there's what's who's here's where's how's

one two three four five six seven eight nine twelve thirteen fourteen fifteen
sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty
ninety hundred thousand million billion first second third fourth fifth half twice dozen
zero

say says said saying go goes went gone going get gets got gotten getting make makes made
making know knows knew known knowing think thinks thought thinking take takes took taken
taking see sees saw seen seeing came coming want wants wanted wanting look looks looked
looking used using find finds found finding give gives gave given giving tell tells told
telling work works worked working call calls called calling try tries tried trying ask
asks asked asking need needs needed needing feel feels felt feeling become becomes
became leave leaves left leaving put puts putting mean means meant keep keeps kept
keeping let lets begin begins began begun beginning seem seems seemed help helps helped
helping talk talks talked talking turn turns turned turning start starts started
starting showed shown hear hears heard hearing play plays played playing run runs ran
running move moves moved moving like likes liked live lives lived living believe
believed bring brings brought happen happens happened write writes wrote written writing
sit sits sat sitting stands stood standing lose loses lost losing pay pays paid paying
meet meets met meeting include included continued learn learns learned learning change
changes changed changing lead leads led understand understood watch watches watched
watching follow follows followed following speak speaks spoke spoken speaking read reads
reading spend spends spent grow grows grew grown growing open opens opened opening walk
walks walked walking win wins won winning offer offered remember remembered love loves
loved loving appear appeared buy buys bought buying wait waits waited waiting serve
served die dies died dying send sends sent sending expect expected build builds built
building stay stays stayed staying fall falls fell falling cut cuts cutting reach
reached kill killed killing remain remained suggest suggested raise raised pass passed
passing sell sells sold selling require required report reported decided pull pulled
push pushed eat eats ate eaten eating drink drinks drank drinking sleep sleeps slept
sleeping drive drives drove driven driving ride rode riding fly flies flew flying swim
swam swimming sing sings sang sung singing dance dances danced dancing laugh laughed
laughing cry cried crying smile smiled wash washed clean cleaned cook cooked cooking
carry carried catch caught throw threw thrown break broke broken fix fixed fill filled
finish finished hope hoped hoping hate hated wish wished worry worried forget forgot
forgotten choose chose chosen explain explained answer answered agree agreed allow
allowed add added enjoy enjoyed travel traveled travelling visit visited visiting close
closed closing hold holds held holding hurt kiss kissed hug join joined jump jumped kick
knock lie lying lay lift listen listened listening marry married miss missed missing
owned pick picked plant point pointed pour pray prefer preferred prepared promise
promised protect prove rain raining rest return returned rise rose rush save saved
search share shared shout shut sign signed smell sound sounds spell steal stole stick
study studied studying taste teach teaches taught teaching thank thanks touch touched
train trust wake woke wear wore worn wonder wondered belong borrow lend lent burn burned
climb collect count cover covered cross dress drop dropped enter explore fail failed fit
fold guess guessed hang hide hid improve invited kneel knit manage managed measure mix
nod notice noticed obey pack paint painted park pat pause planned pretend print pump
punish rescue remove repeat repair replace reply rob rub sail scream shake shook shine
shop sink skip slip sneeze solve spill spin spread squeeze stamp stare steer
step stir stretch suffer suppose surprise surprised swallow sweep switch tear tie trip
type wander warn waste weigh whisper wipe wrap yell discover discovered destroy develop
mention prevent provide receive received recognize refuse relate replied seek settle
shoot shot supply support supported treat voted

time times year years people way ways day days man men woman women child children world
life hand hands part place week weeks company question questions government night nights
home water room rooms mother money story stories fact month months lot right book books
eye eyes job jobs word words business issue side kind head house houses service friend
friends father power hour hours game games line end member law car cars city community
name president team face kid kids body back parent parents level office door doors
health person war history party result morning reason research girl girls guy guys
moment air teacher teachers force education foot feet boy boys age policy music market
sense nation college interest death experience effect class care field development role
effort rate heart leader light voice wife husband police mind price view relationship
town road arm arms difference value action season society tax position player paper
space ground form event matter center couple site project activity star table court oil
situation cost industry figure street image phone data picture practice piece land
product wall patient worker news movie movies north south east west culture church
summer winter spring computer user source window windows ball bed chair dog dogs cat
cats bird birds fish horse cow pig chicken egg eggs bread meat rice milk coffee tea
juice beer wine cake apple apples fruit vegetable vegetables potato potatoes tomato
cheese butter cream sugar salt pepper soup dinner lunch breakfast food meal kitchen bathroom
bedroom garden yard floor roof stairs key keys bag bottle cup glass plate knife fork
spoon shirt shoe shoes hat coat jacket pants clothes bank store hardware school university
library airport plane boat ship bike truck bridge river lake ocean beach island mountain
hill forest tree trees flower flowers grass sky sun moon snow wind weather fire ice
stone sand earth country state village family brother brothers sister sisters uncle aunt
cousin grandmother grandfather grandma grandpa daughter boyfriend girlfriend neighbor
guest stranger king queen prince princess soldier army enemy gun weapon fight peace
freedom truth dream dreams fear joy anger pain problem problems mistake luck choice gift
letter message song songs noise silence language english spanish sentence page poem
novel magazine newspaper map vacation holiday weekend birthday wedding christmas monday
tuesday wednesday thursday friday saturday sunday january february march april june july
august september october november december tomorrow yesterday today tonight clock
afternoon evening noon midnight future present middle bottom front edge sort size shape
colour weight height length speed distance amount bit group crowd thing things stuff
path spot hair skin nose mouth tooth teeth tongue ear ears neck shoulder finger fingers
knee leg legs stomach blood bone brain throat chest lip lips beard cheek toe toes wrist
ankle wives mom dad mommy daddy sir madam lady ladies gentleman boss owner customer
waiter nurse lawyer judge farmer driver pilot artist singer writer student students
officer chief captain neighbours friendship marriage kindness happiness sadness beauty
strength weakness knowledge wisdom skill skills habit habits advice anxiety argument
attention attitude behaviour behavior belief birth blame breath brightness bubble budget
castle chain chalk childhood cloud clouds coast coin comfort contest corn cotton crime
crown curtain cushion damage danger deal debt degree desert desk dirt discovery disease
dish dust duty engine envy evidence exercise exit fame fashion fault feather fence fever
flag flame flight flood flour fog fool fortune fountain frog fun fur gate gesture ghost
glove goal goat god gold growth guard guilt gum harbor harm hatred heat heaven hell hero
hole honey hook horn host hunger hunt illness ink insect iron jail jewel journey jungle
justice kingdom kite knot ladder lamb lamp laughter lawn leaf leather lesson liar lid
lion liquid loaf lock loss luggage machine magic maid mail medicine memory mile mirror
mist mood mouse mud muscle nail needle nest net nonsense nut oak oath onion oven owl ox
pair palace paragraph pearl pen pencil penny pet pile pillow pipe planet pleasure plenty
pocket poison pole pond pool pot powder prayer pride prison prize proof pumpkin purse
quarter quilt rabbit race rail rainbow rat recipe relief rent reward rhythm ribbon
riddle robber rope rubbish rug ruler saddle sailor salad scale scar scarf scene scent
science scissors screen seat seed shade shadow shame sheep sheet shell shelter shelf
shore sight silk silver skirt skull slave sleeve slope smoke snake soap sock soil soul
spider spirit sponge sport square stable stage stain steam steel sting stitch storm
stove straw stream string suit sunlight sunshine supper surface swamp sweat sword tail
tale tank temper tent theory thief thread thumb thunder tide tiger tin toast tool towel
tower track trade traffic trail treasure trick trouble trunk tube tune twig umbrella
valley vase vein vessel vest voyage wage wagon wave wax wealth weed wheat wheel whip
whistle wing wire witch wolf wood wool worm wound youth

good better best bad worse worst big bigger biggest small smaller smallest little large
larger great greater long longer shorter tall high higher low lower old older young
younger new newer early earlier hot cold colder warm cool nice fine happy happier sad
angry tired hungry thirsty sick ill healthy strong stronger weak fast faster slow slower
quick easy easier hard harder difficult heavy dark bright dirty full empty rich poor
cheap expensive free busy ready sure true wrong important different next last whole
beautiful pretty ugly cute funny serious quiet loud safe dangerous friendly lonely lucky
careful afraid alone alive dead awake asleep sweet sour bitter fresh wet dry soft smooth
rough deep wide narrow thick thin fat round flat straight strange weird wonderful
amazing awesome perfect possible impossible likely main major minor certain clear common
current public private national political economic black white blue green yellow brown
gray grey pink purple orange golden able available basic blind brave broad calm cheerful
clever comfortable correct crazy curious deaf delicious dear dull eager elderly entire
equal exact excellent excited exciting fair false famous fancy far favorite fierce
foreign foolish fond fortunate frank frequent frozen gentle giant glad gorgeous grateful
greedy guilty handsome harsh helpful helpless honest huge humble innocent interesting
jealous joyful keen lazy lively loose lovely loyal mad massive mere messy mighty modern
modest moist naked nasty native naughty nervous noisy obvious odd ordinary pale plain
pleasant polite positive powerful precious proud rare raw recent relevant reliable rude
sacred scared secret selfish sensitive severe shallow sharp shiny shy silent silly
sincere skinny sleepy slight sore sorry spare special spicy splendid stiff strict stupid
sudden sunny terrific thankful thoughtful tight tiny tough tricky typical unhappy
unknown unusual upset useful useless valuable various vast violent wealthy weekly wicked
wild wise wooden worth worthy yearly

now soon later almost rather enough together away forward ahead actually probably
certainly especially finally quickly slowly easily suddenly simply exactly nearly
recently clearly completely else instead anyway seldom rarely indeed please hello hi
goodbye yeah yep nope oops well somehow sometime anymore afterwards backwards upstairs
downstairs abroad alright apart aside badly barely briefly carefully constantly daily
directly entirely eventually fairly forever frankly freely fully gently gladly happily
hardly heavily honestly hopefully immediately largely lately loudly mainly mostly
naturally neatly newly obviously openly partly perfectly politely possibly previously
properly quietly rapidly readily roughly sadly safely seriously sharply shortly silently
slightly softly strongly surely terribly thankfully thoroughly truly ultimately
unfortunately warmly wildly
`;

/**
 * Parse the word list: split on whitespace, NFC-compose and lowercase, drop duplicates
 * and anything in SPANISH_LOOKALIKES, keep source order.
 */
export function parseWords(data: string, exclude: ReadonlySet<string> = SPANISH_LOOKALIKES): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of data.split(/\s+/)) {
    if (!raw) continue;
    const w = raw.normalize('NFC').toLowerCase();
    if (seen.has(w) || exclude.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/** The English lexicon as a list, in source order, without duplicates. */
export const NATIVE_LEXICON_WORDS: readonly string[] = parseWords(DATA);
