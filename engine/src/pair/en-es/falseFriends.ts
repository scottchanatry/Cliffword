/**
 * Spanish words that look like an English word but mean something else. Shown as a
 * warning when the learner meets or uses one, and never marked as known cognates.
 */
export interface FalseFriend {
  /** Spanish lemma. */
  es: string;
  /** The English word it resembles. */
  looksLike: string;
  /** What it actually means, in short. */
  means: string;
  /** One-sentence warning for the learner, with the Spanish word they probably wanted. */
  warning: string;
}

/** Build a FalseFriend entry. */
function ff(es: string, looksLike: string, means: string, warning: string): FalseFriend {
  return { es, looksLike, means, warning };
}

export const FALSE_FRIENDS: readonly FalseFriend[] = [
  ff('embarazada', 'embarrassed', 'pregnant', 'Embarazada means pregnant. Embarrassed is "avergonzado" or "me da vergüenza".'),
  ff('actual', 'actual', 'current, present-day', 'Actual means current. Actual (real) is "real" or "verdadero".'),
  ff('actualmente', 'actually', 'currently, nowadays', 'Actualmente means currently. Actually is "en realidad".'),
  ff('librería', 'library', 'bookstore', 'Librería is a bookstore. A library is a "biblioteca".'),
  ff('éxito', 'exit', 'success', 'Éxito means success. An exit is a "salida".'),
  ff('carpeta', 'carpet', 'folder', 'Carpeta is a folder. A carpet is an "alfombra".'),
  ff('constipado', 'constipated', 'having a cold', 'Estar constipado means to have a cold. Constipated is "estreñido".'),
  ff('sensible', 'sensible', 'sensitive', 'Sensible means sensitive. Sensible (reasonable) is "sensato".'),
  ff('asistir', 'assist', 'to attend', 'Asistir a means to attend. To assist is "ayudar".'),
  ff('realizar', 'realize', 'to carry out, achieve', 'Realizar means to carry out or make happen. To realize is "darse cuenta".'),
  ff('molestar', 'molest', 'to bother, annoy', 'Molestar just means to bother or annoy; it has no sexual meaning.'),
  ff('recordar', 'record', 'to remember, remind', 'Recordar means to remember. To record is "grabar".'),
  ff('soportar', 'support', 'to put up with, bear', 'Soportar means to put up with. To support someone is "apoyar".'),
  ff('pretender', 'pretend', 'to intend, aim to', 'Pretender means to intend or try to. To pretend is "fingir".'),
  ff('contestar', 'contest', 'to answer', 'Contestar means to answer (a question, the phone), not to contest.'),
  ff('introducir', 'introduce', 'to insert, put in', 'Introducir means to insert or put in. To introduce a person is "presentar".'),
  ff('compromiso', 'compromise', 'commitment, engagement', 'Compromiso usually means commitment or engagement. A compromise is a "término medio".'),
  ff('decepción', 'deception', 'disappointment', 'Decepción means disappointment. Deception is "engaño".'),
  ff('largo', 'large', 'long', 'Largo means long. Large is "grande".'),
  ff('once', 'once', 'eleven', 'Once is the number eleven. Once (one time) is "una vez".'),
  ff('pie', 'pie', 'foot', 'Pie means foot. A pie is a "pastel" or "tarta".'),
  ff('red', 'red', 'net, network', 'Red means net or network. The color red is "rojo".'),
  ff('sin', 'sin', 'without', 'Sin means without. A sin is a "pecado".'),
  ff('fábrica', 'fabric', 'factory', 'Fábrica means factory. Fabric is "tela".'),
  ff('lectura', 'lecture', 'reading', 'Lectura means reading. A lecture is a "conferencia" or "clase".'),
  ff('ropa', 'rope', 'clothes', 'Ropa means clothes. A rope is a "cuerda".'),
  ff('vaso', 'vase', 'drinking glass', 'Vaso is a drinking glass. A vase is a "florero" or "jarrón".'),
  ff('sano', 'sane', 'healthy', 'Sano means healthy. Sane is "cuerdo".'),
  ff('suceso', 'success', 'event, incident', 'Suceso means an event or incident. Success is "éxito".'),
  ff('colegio', 'college', 'school', 'Colegio usually means school for children. College is "universidad".'),
  ff('campo', 'camp', 'field, countryside', 'Campo means field or countryside. A camp is a "campamento".'),
  ff('discutir', 'discuss', 'to argue', 'Discutir often means to argue. To talk something over calmly is "hablar de" or "comentar".'),
  ff('aviso', 'advice', 'notice, warning', 'Aviso means notice or warning. Advice is "consejo".'),
  ff('casualidad', 'casualty', 'coincidence', 'Casualidad means coincidence. A casualty is a "víctima".'),
  ff('conductor', 'conductor', 'driver', 'Conductor usually means driver. An orchestra conductor is a "director".'),
  ff('dirección', 'direction', 'address; also direction', 'Dirección often means a street address, as well as direction or management.'),
  ff('educado', 'educated', 'polite, well-mannered', 'Educado means polite. Educated is "culto" or "instruido".'),
  ff('emocionante', 'emotional', 'exciting, moving', 'Emocionante means exciting. Emotional is "emocional" or "sensible".'),
  ff('excitado', 'excited', 'sexually aroused', 'Excitado usually means aroused. For excited, say "emocionado" or "entusiasmado".'),
  ff('particular', 'particular', 'private, personal', 'Particular often means private (clases particulares). Picky is "exigente".'),
  ff('quitar', 'quit', 'to remove, take away', 'Quitar means to remove. To quit is "dejar" or "renunciar".'),
  ff('simpático', 'sympathetic', 'nice, friendly', 'Simpático means nice or friendly. Sympathetic is "comprensivo".'),
  ff('noticia', 'notice', 'piece of news', 'Noticia means news. A notice is an "aviso".'),
  ff('pariente', 'parent', 'relative', 'Pariente means any relative. Parents are "padres".'),
  ff('jubilación', 'jubilation', 'retirement', 'Jubilación means retirement. Jubilation is "júbilo".'),
  ff('disgusto', 'disgust', 'upset, annoyance', 'Disgusto means upset or annoyance. Disgust is "asco".'),
  ff('atender', 'attend', 'to serve, look after', 'Atender means to serve or look after. To attend an event is "asistir".'),
  ff('lujuria', 'luxury', 'lust', 'Lujuria means lust. Luxury is "lujo".'),
  ff('ganga', 'gang', 'bargain', 'Ganga means a bargain. A gang is a "pandilla".'),
  ff('billón', 'billion', 'a million million', 'Un billón is a million million (an English trillion). A billion is "mil millones".'),
  ff('codo', 'code', 'elbow', 'Codo means elbow. A code is a "código".'),
  ff('tópico', 'topic', 'cliché', 'Tópico usually means a cliché. A topic is a "tema".'),
  ff('resumir', 'resume', 'to summarize', 'Resumir means to summarize. To resume is "reanudar".'),
  ff('advertir', 'advertise', 'to warn', 'Advertir means to warn. To advertise is "anunciar".'),
  ff('preservativo', 'preservative', 'condom', 'Preservativo means condom. A food preservative is a "conservante".'),
  ff('argumento', 'argument', 'reasoning; plot of a story', 'Argumento means a line of reasoning or a plot, not a quarrel. A quarrel is a "pelea".'),
  ff('mayor', 'mayor', 'older, bigger', 'Mayor means older or bigger. A mayor is an "alcalde".'),
  ff('grosería', 'grocery', 'rude remark, rudeness', 'Grosería means a rude remark. Groceries are "la compra" or "comestibles".'),
  ff('dormitorio', 'dormitory', 'bedroom', 'Dormitorio usually means bedroom. A student dorm is a "residencia".'),
  ff('injuria', 'injury', 'insult', 'Injuria means an insult. An injury is a "herida" or "lesión".'),
  ff('rato', 'rat', 'a short while', 'Rato means a short while. A rat is a "rata".'),
  ff('eventual', 'eventual', 'possible, temporary', 'Eventual means possible or temporary. Eventual (in the end) is "final".'),
  ff('carta', 'card', 'letter; menu', 'Carta means a letter or a menu. A card is a "tarjeta".'),
  ff('recipiente', 'recipient', 'container', 'Recipiente means a container. A recipient is a "destinatario".'),
  ff('receta', 'receipt', 'recipe; prescription', 'Receta means a recipe or prescription. A receipt is a "recibo".'),
];

const BY_LEMMA = new Map(FALSE_FRIENDS.map((f) => [f.es, f]));

/** The false-friend entry for a Spanish lemma (exact, then lowercased NFC), or undefined. */
export function falseFriend(lemma: string): FalseFriend | undefined {
  return BY_LEMMA.get(lemma) ?? BY_LEMMA.get(lemma.normalize('NFC').toLowerCase().trim());
}
