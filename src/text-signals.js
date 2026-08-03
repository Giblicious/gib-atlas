export const TEXT_ANALYSIS_VERSION = 2;

const quality = (key, name, hypothesis, extra = {}) => ({ key, name, description: hypothesis, hypothesis, ...extra });

// These are landmarks in one continuous affect profile, not mutually exclusive buckets.
// Their stable hues make emotional maps readable without affecting node placement.
export const EMOTION_LANDMARKS = [
  quality('joy', 'Joy', 'The writer expresses joy, delight, happiness, or celebration.', { hue: 48 }),
  quality('contentment', 'Contentment', 'The writer expresses contentment, peace, satisfaction, or quiet wellbeing.', { hue: 72 }),
  quality('gratitude', 'Gratitude', 'The writer expresses gratitude, thankfulness, appreciation, or being blessed.', { hue: 92 }),
  quality('hope', 'Hope', 'The writer expresses hope, optimism, encouragement, or expectation of a good future.', { hue: 112 }),
  quality('love', 'Love', 'The writer expresses love, affection, tenderness, devotion, or deep attachment.', { hue: 338 }),
  quality('compassion', 'Compassion', 'The writer expresses compassion, empathy, mercy, care, or concern for suffering.', { hue: 318 }),
  quality('awe', 'Awe', 'The writer expresses awe, reverence, wonder, sublimity, or profound amazement.', { hue: 278 }),
  quality('relief', 'Relief', 'The writer expresses relief, release from worry, reassurance, or burdens lifting.', { hue: 152 }),
  quality('longing', 'Longing', 'The writer expresses longing, yearning, homesickness, wistfulness, or desire for what is absent.', { hue: 228 }),
  quality('loneliness', 'Loneliness', 'The writer expresses loneliness, isolation, disconnection, abandonment, or feeling unseen.', { hue: 218 }),
  quality('sadness', 'Sadness', 'The writer expresses sadness, sorrow, disappointment, melancholy, or unhappiness.', { hue: 208 }),
  quality('grief', 'Grief', 'The writer expresses grief, bereavement, mourning, anguish over loss, or heartbreak.', { hue: 248 }),
  quality('despondency', 'Despondency', 'The writer expresses despondency, hopelessness, dejection, despair, or loss of spirit.', { hue: 258 }),
  quality('fear', 'Fear', 'The writer expresses fear, dread, danger, alarm, vulnerability, or being afraid.', { hue: 188 }),
  quality('anxiety', 'Anxiety', 'The writer expresses anxiety, worry, unease, apprehension, nervousness, or uncertainty.', { hue: 178 }),
  quality('confusion', 'Confusion', 'The writer expresses confusion, perplexity, disorientation, uncertainty, or inability to understand.', { hue: 168 }),
  quality('surprise', 'Surprise', 'The writer expresses surprise, shock, astonishment, or an unexpected discovery.', { hue: 58 }),
  quality('frustration', 'Frustration', 'The writer expresses frustration, exasperation, irritation, obstruction, or being thwarted.', { hue: 18 }),
  quality('anger', 'Anger', 'The writer expresses anger, rage, fury, hostility, or strong displeasure.', { hue: 4 }),
  quality('indignation', 'Indignation', 'The writer expresses indignation, moral outrage, anger at injustice, or offense at wrongdoing.', { hue: 350 }),
  quality('contempt', 'Contempt', 'The writer expresses contempt, scorn, disdain, disgust, or moral superiority toward someone.', { hue: 300 }),
  quality('guilt', 'Guilt', 'The writer expresses guilt, remorse, regret, responsibility for harm, or a need to make amends.', { hue: 288 }),
  quality('shame', 'Shame', 'The writer expresses shame, humiliation, self-condemnation, worthlessness, or wanting to hide.', { hue: 268 }),
  quality('determination', 'Determination', 'The writer expresses determination, resolve, courage, perseverance, or commitment to act.', { hue: 132 }),
];

export const EMOTION_HYPOTHESES = Object.fromEntries(EMOTION_LANDMARKS.map(item => [item.key, item.hypothesis]));

export const TEXT_SIGNALS = {
  semantic: { label: 'Meaning', description: 'Similarity in subject matter and ideas.', engine: 'embedding' },
  emotion: { label: 'Emotion', description: 'Similarity in the feelings expressed by the writing.', engine: 'nli' },
  purpose: { label: 'Purpose', description: 'Similarity in what the writing is trying to accomplish.', engine: 'nli' },
  position: { label: 'Position', description: 'Similarity in how passages relate to a reference claim.', engine: 'nli', needsReference: true },
  form: { label: 'Form', description: 'Similarity in the kind and presentation of the writing.', engine: 'hybrid' },
  links: { label: 'Links', description: 'Authored wikilinks create direct relationships.', engine: 'metadata' },
};

const PURPOSE_QUALITIES = [
  quality('questioning', 'Questioning', 'This passage primarily asks, investigates, or opens a question.'),
  quality('explaining', 'Explaining', 'This passage primarily explains, defines, or clarifies an idea.'),
  quality('reflecting', 'Reflecting', 'This passage primarily interprets an experience or works through its meaning.'),
  quality('persuading', 'Persuading', 'This passage primarily argues for a conclusion or tries to convince the reader.'),
  quality('comparing', 'Comparing', 'This passage primarily compares, contrasts, or distinguishes alternatives.'),
  quality('planning', 'Planning', 'This passage primarily decides, plans, instructs, or identifies concrete action.'),
  quality('summarizing', 'Summarizing', 'This passage primarily condenses or records information without developing a new argument.'),
];

const POSITION_QUALITIES = [
  quality('supports', 'Supports', 'The writer supports or affirms the reference claim.'),
  quality('opposes', 'Opposes', 'The writer rejects or contradicts the reference claim.'),
  quality('questions', 'Questions', 'The writer questions or tests the reference claim without clearly rejecting it.'),
  quality('uncertain', 'Uncertain', 'The writer is unsure or unresolved about the reference claim.'),
  quality('reports', 'Reports', 'The writer reports the reference claim without personally endorsing or rejecting it.'),
];

const FORM_QUALITIES = [
  quality('journal', 'Journal reflection', 'This is personal journal writing centered on lived experience, introspection, or self-understanding.'),
  quality('analysis', 'Analytical essay', 'This is sustained analytical prose using definitions, reasons, distinctions, or evidence.'),
  quality('conversation', 'Conversation', 'This is dialogue, an interview, or a transcript containing exchanges between speakers.'),
  quality('reference', 'Reference note', 'This is reference material organized to preserve facts, quotations, sources, or definitions.'),
  quality('narrative', 'Narrative', 'This is a story or chronological account of events and experiences.'),
  quality('outline', 'Outline or plan', 'This is an outline, checklist, set of instructions, or structured action plan.'),
];

export const TEXT_SIGNAL_PROFILES = {
  emotion: EMOTION_LANDMARKS,
  purpose: PURPOSE_QUALITIES,
  position: POSITION_QUALITIES,
  form: FORM_QUALITIES,
};

export const TEXT_SIGNAL_TEMPLATES = {
  emotions: { name: 'Emotional landscape', signal: 'emotion', description: 'Let emotional similarities form an anchor-free landscape.', frameMode: 'natural', relationships: { emotion: 1 }, categories: [] },
  emotionCompass: { name: 'Emotion compass', signal: 'emotion', description: 'Orient the emotional landscape around several readable landmarks.', frameMode: 'guided', relationships: { emotion: 1 }, categories: EMOTION_LANDMARKS.filter(item => ['joy', 'love', 'sadness', 'fear', 'indignation', 'despondency'].includes(item.key)).map(item => ({ ...item, modelLabel: item.key })) },
  purpose: { name: 'Purpose landscape', signal: 'purpose', description: 'Let similar communicative intentions gather naturally.', frameMode: 'natural', relationships: { purpose: 1 }, categories: [] },
  position: { name: 'Position toward a claim', signal: 'position', description: 'Orient passages by their relationship to one claim.', frameMode: 'guided', relationships: { position: 1 }, reference: '', categories: POSITION_QUALITIES },
  form: { name: 'Writing-form landscape', signal: 'form', description: 'Let similar kinds of writing gather naturally.', frameMode: 'natural', relationships: { form: 1 }, categories: [] },
};

export function validTextSignal(value) { return TEXT_SIGNALS[value] ? value : 'semantic'; }

export function signalHypothesis(signal, categoryValue, reference = '') {
  const category = categoryValue || {}, description = String(category.hypothesis || category.description || '').trim(), name = String(category.name || '').trim();
  if (signal !== 'position') return description || `This passage is primarily ${name.toLowerCase()}.`;
  const claim = String(reference || '').trim();
  if (!claim) return description || `The writer takes a ${name.toLowerCase()} position.`;
  const prefix = {
    supports: 'The writer supports the claim that',
    opposes: 'The writer opposes the claim that',
    questions: 'The writer questions whether',
    uncertain: 'The writer is uncertain whether',
    reports: 'The writer reports without endorsing the claim that',
  }[category.key] || `The writer takes a ${name.toLowerCase()} position toward the claim that`;
  return `${prefix} ${claim}`;
}
