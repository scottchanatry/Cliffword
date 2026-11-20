# Illustrations

Flat, friendly pictures for Cliffword: experience covers, the San Juan cast, the San Juan
episode scenes and vocabulary pictures. The SVGs in `src/` are the sources (drawn by hand, in
code); the PNGs next to them are generated. The app shows the PNGs with `<Image>` (there is no
react-native-svg), through `src/illustrations/index.ts`.

## Skin

Everyone has the same skin, everywhere: amber `#FFC46B`, like the default emoji yellow. That
holds for the cast, for people in scenes and on covers, and for any hand or face in a vocabulary
picture, in every story and every country, now and later. Never vary skin by character or by
country: nobody is drawn darker or lighter than anyone else. Characters differ by age, hair,
clothes, props and expression.

- Mark every skin shape (face, ears, neck, arms, hands, legs, feet, a skin colored eyelid) with
  `class="skin"`. The fill is the skin; for a shape drawn as a line with `fill="none"` (a tube
  arm or leg, a finger), the stroke is.
- A shadow on skin, if a figure ever needs one, is amber deep `#F08A1D` for everyone, marked
  `class="skin-shade"`. No picture uses one today.
- Amber is also gold, bread, straw and sand: only shapes marked `skin` are skin. Animals are not
  people (Pancho keeps his colors).
- The colors are defined once, as `SKIN` and `SKIN_SHADE` in `scripts/make-illustrations.js`.
  Before rendering, the script paints every marked shape with them (and rewrites a source that
  says otherwise), so changing the skin is that one line plus a run of the script.
- `src/illustrations/skin.test.ts` fails if a marked shape has any other color, or if a picture
  with people marks no skin: every cast picture but Pancho, plus the scenes and covers it lists.
  When a new scene or cover shows a person, add it to that list.

```
src/<group>/<id>.svg        the source; edit these
<group>/<id>.png            1x (Jest, Android mdpi and the web export resolve this name)
<group>/<id>@2x.png         2x
<group>/<id>@3x.png         3x
```

| group  | what                                        | canvas (viewBox) | 1x size (points) | background |
| ------ | ------------------------------------------- | ---------------- | ---------------- | ---------- |
| covers | one per experience, on the picker cards     | 1200 x 600 (2:1) | 400 x 200        | opaque, light |
| scenes | one per San Juan episode, top of the episode | 1200 x 500 (2.4:1) | 432 x 180      | opaque, light |
| cast   | avatars next to a speaker's line            | 256 x 256        | 96 x 96          | a palette disc (r 124), transparent outside it |
| vocab  | one object per word, in the word sheet      | 256 x 256        | 128 x 128        | transparent |

The 1x size is the largest size a screen should show the picture at; the @3x file is sharp up
to there on every iPhone. Render with:

```
node scripts/make-illustrations.js                 # everything
node scripts/make-illustrations.js --only gallo    # one or more ids, comma separated
node scripts/make-illustrations.js --sheet <dir>   # also contact sheets per group, at 1x
```

It needs Playwright with Chromium (like `npm run icons`), renders each SVG at 1x, 2x and 3x,
and writes 8-bit palette PNGs (at most 256 colors; the flat fills keep their exact colors, the
edges are clustered) with its own small encoder, so nothing is added to the app's
dependencies. All 59 pictures at three densities come to about 1.8 MB.

## Style guide

**Look.** Flat vector, friendly and a little funny. Rounded shapes, round line joins and caps,
no gradients, no transparency effects (no `opacity`), no blur, no drop shadows, no textures
beyond a few drawn lines or dots. Front or three-quarter views, drawn flat: no 3D, no
perspective floors (a checkered floor is a flat band of squares).

**Never in a picture.** Text, letters or numbers (signs, labels, screens, money and phones stay
blank or use bars, dots and icons), flags, brand logos, real people or anyone's likeness.

**Characters.** Simple geometric bodies: a round head (radius 58 in the figure's units), a
rounded torso, tube arms and legs, round hands. Big expressive eyes: a ground-colored eye with an
ink outline, a large ink pupil and a small ground highlight; or a happy closed `^` eye; a skin
colored lid for proud or wise looks. Simple faces: thick ink brows (their tilt carries the
mood), a small hooked nose line, one mouth (smile, grin, laugh with a coral tongue, small `o`),
pastel pink cheeks. Everyone's skin is the one shared amber, marked `class="skin"` (see
"Skin" above). Animals follow the same eyes and lines.

**Lines.** Ink `#16181D`. Every foreground shape has a 4 px outline on the canvas; inner details
are 3 px (fine textures 2.5 px). The line weight is the same everywhere in a picture, however
small an object is drawn: a scaled group divides its stroke widths by its scale. Background
scenery (sky, sun, distant hills and buildings, clouds, steam) has no outline. Shine marks,
steam and sound marks are plain strokes in a palette color.

**Backgrounds.** Light, so the pictures sit well on ground `#F3F4F1` and white cards: covers and
scenes fill their canvas with a light palette color (amber light, sky, pastel pink, lilac,
amber); cast discs use one palette color each; vocab objects are transparent, centered, about
208 px on their long side with at least 20 px of margin.

### Palette

Use only these 13 colors.

| role | name | hex |
| ---- | ---- | --- |
| app ground; eye whites, highlights, white things | ground | `#F3F4F1` |
| outlines and details, dark things | ink | `#16181D` |
| grey things (asphalt, metal, stone) | muted | `#5B616B` |
| light amber: cream, sand, light backgrounds | amber light | `#FFE9C7` |
| amber: everyone's skin (the only skin color), gold, bread, straw, sun | amber | `#FFC46B` |
| deep amber: orange, fried food, the rooster, a shadow on skin | amber deep | `#F08A1D` |
| accent brown: wood, caramel, brown hair | accent | `#B4530A` |
| Caribbean extension: sea, shutters, aprons | sea teal | `#2E9C92` |
| | palm green | `#62AD52` |
| | sky blue | `#A8DBF0` |
| | coral (the red) | `#EF6A57` |
| | pastel pink (cheeks, flowers, facades) | `#F7BBCB` |
| | lilac (facades, evening sky, red onion) | `#C3B3EA` |

### The San Juan cast (keep them the same everywhere)

| id | who | look |
| -- | --- | ---- |
| `dona-mari` | Doña Mari, the older neighbor | white curly hair with coral, sky and lilac rollers, half-moon reading glasses, teal housecoat with amber dots and a white collar, a café cup; curious, one brow up; pink disc |
| `pancho` | Pancho, the rooster | deep amber body, brown wing, amber neck feathers, coral comb and wattle, teal, green and ink tail; proud half-closed eye, a few feathers out of place; sky disc |
| `wilfredo` | Wilfredo, the colmado owner | short ink hair grey at the temples, big ink mustache, a pencil behind the ear, coral shirt, teal apron; calm half-closed eyes; amber light disc |
| `yari` | Yari, young neighbor | big ink curls, teal sunglasses pushed up, amber hoop earrings, coral top, sky jeans, a phone; laughing; lilac disc |
| `abuelo` | Abuelo (Don Tito) | white brows, sideburns and mustache, a straw pava hat with a coral band, white guayabera, a domino tile; laughing; teal disc |
| `nando` | Nando, the baker who answers in English | brown curls under a tall white baker's hat, white jacket with grey buttons and a coral neckerchief, a loaf of pan sobao; a cheerful wink and a big laugh; palm green disc |
| `migdalia` | Migdalia, the over-enthusiastic shop assistant | an ink high bun with a coral scrunchie, coral earrings, lilac top, a sky tape measure round the neck, a coral shirt on a hanger held up; wide delighted eyes with lashes, a big laugh, two ground sparkles; teal disc |
| `rafa` | Rafa, the proud waiter | slicked ink hair with a grey shine, a thin mustache curled up, proud half-closed eyes and high brows, a smug smile, white shirt, ink vest, coral bow tie, a steaming mofongo held high on a plate; sky disc |
| `dona-lourdes` | Doña Lourdes, the pharmacist, Doña Mari's sister | Doña Mari's face and white curls (the family look), pulled up in a bun with a coral flower, round teal glasses, a knowing smile, white coat over a pink top with a green cross on the pocket, a pot of aloe (sábila); lilac disc |
| `you` | the learner | a friendly, warm figure of no particular gender: short tousled brown hair, a teal t-shirt, a big open smile, waving hello; coral disc |

Pancho turns up in the San Juan cover and in scenes 1, 4 and 8. The app maps a story's cast id
(`neighbor`, `rooster`, `grocer`, `friend`, `grandpa`, `baker`, `clerk`, `waiter`, `pharmacist`)
to these pictures in `src/illustrations/index.ts` (`SERIES_CAST`).

### You avatars

The learner chooses who they are in a story: one of these nine characters, or their own photo
(a selfie or one from the library, which is not an illustration). Their own lines ("You"
bubbles) show the choice. `you`, the waving figure from the cast table, is the default and
stays first. The other eight are drawn like the cast (same canvas, disc, line weight and shared
skin), funny and of different ages, a mix of genders with some left open, each with a prop that
says something about them. Every disc has a color no other avatar has. In code:
`YOU_AVATAR_IDS` (default first), `YOU_AVATARS`, `DEFAULT_YOU_AVATAR` and `isYouAvatarId` in
`src/illustrations/index.ts`; `index.test.ts` checks that every one has its source and PNGs and
its own disc color, and that every source in `src/cast` is either a cast picture or an avatar.

| id | who | description |
| -- | --- | ----------- |
| `you` | anyone (the default) | see the cast table: no particular gender, tousled brown hair, a teal t-shirt, waving hello; coral disc |
| `you-teen` | a teenager of about fifteen, of no particular gender | shaggy ink hair with a teal streak, big coral headphones, freckles, a green hoodie with drawstrings, blowing a pink bubble-gum bubble and going cross-eyed at it, a teal skateboard held upright (seen from below, trucks and wheels showing); amber disc |
| `you-backpacker` | a backpacker in her twenties | a messy ginger top bun, ink sunglasses pushed up, a huge coral backpack with a teal rolled mat sticking out behind her head, deep amber straps and chest strap, a sky t-shirt, one brow up and a big grin at a folded map with a dotted route and a coral pin; palm green disc |
| `you-remote` | a remote worker in their thirties, of no particular gender | brown bed hair with a cowlick, square ink glasses, sleepy half-closed eyes and a content smile, a lilac hoodie, a grey laptop covered in stickers under one arm, a huge steaming coral mug; sky disc |
| `you-chef` | a chef in his forties | a tall white chef's hat tilted, short ink hair grey at the temples, a big ink mustache, eyes shut in bliss and a big laugh, a white double-breasted jacket with a teal neckerchief, a wooden spoon of coral sauce just tasted and still steaming; deep amber disc |
| `you-photographer` | a photographer in her fifties | a wide sky sun hat with a coral band, a salt-and-pepper grey bob, small white earrings, a wink with smile lines as if lining up a shot, a teal shirt, a big grey camera with a sky lens on a coral strap, held in both hands; pink disc |
| `you-musician` | a musician in his sixties | bald and shiny on top with forehead lines, white hair at the sides and a white ponytail with a teal tie, round ink glasses over laughing eyes, a white goatee, a coral shirt with pink dots, a deep amber guitar slung across on a teal strap; lilac disc |
| `you-grandma` | a grandma in her seventies | a wide pink beach hat with a coral band and a big coral flower, white curls, huge round sunglasses with coral frames, smile lines and a coral lipstick grin, pearls, a lilac blouse with white dots, a teal and pink folding fan; amber light disc |
| `you-captain` | an old sea captain in his eighties | a white captain's cap with an ink visor, a deep amber braid and anchor badge, bushy white brows, crinkly laughing eyes, a round rosy nose, a big white beard and mustache, an ink jacket with grey lapels and deep amber buttons, a toy sailboat held up proudly; teal disc |

To add one: draw `src/cast/you-<who>.svg` from one of these, give it a disc color the others do
not use, render it, and add it to `YOU_AVATAR_IDS` and `YOU_AVATARS` (after `you`, by age).

## Adding or changing a picture

1. Edit or add `src/<group>/<id>.svg` (kebab-case id) with the group's viewBox. Start from a
   picture in the same group; characters and repeated objects can be copied from other files
   (each file is self-contained; clip-path ids are prefixed with the file id so files can be
   inlined together on one page).
2. Keep to the palette, the line rules and the "never" list above, and mark every person's skin
   with `class="skin"` ("Skin" above). A new scene or cover that shows a person goes in the
   list in `src/illustrations/skin.test.ts`; new cast pictures are checked as they appear.
3. Run `node scripts/make-illustrations.js --only <id> --sheet /tmp/sheets` and look at the
   picture at 1x next to the others.
4. Add the `require` to `src/illustrations/index.ts` (and, for vocab, its words to
   `VOCAB_BY_WORD`). `src/illustrations/index.test.ts` checks that every id has its source and
   its three PNGs, and that every word maps to a picture that exists.
