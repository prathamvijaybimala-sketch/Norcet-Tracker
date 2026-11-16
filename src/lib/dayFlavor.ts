/**
 * Personal touches for the daily experience: the name (with the nickname
 * roulette), the time-of-day greeting, the daily "chalo padhte hai" line,
 * the "today done" victory message, and streak milestone messages.
 *
 * Everything is seeded off the ISO date, so a given day shows the SAME
 * flavor all day long (like the quote) and a new one the next day.
 *
 * House style: warm Hinglish, like a close friend texting. No em dashes.
 */

/** Deterministic 32-bit hash (FNV-1a) of a string. */
export function hashDay(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick<T>(list: readonly T[], seed: string): T {
  return list[hashDay(seed) % list.length];
}

/**
 * The name shown in the greeting (and used inside messages).
 *
 * When the saved name is "saloni" (any casing), it flips daily with the
 * nickname roulette: 70% Saloni, 20% Shalu, 10% Meloni. Stable for the
 * whole day. Any other saved name is shown as-is.
 */
export function nameForDay(savedName: string, day: string): string {
  const name = savedName.trim();
  if (name.toLowerCase() !== 'saloni') return name;
  const r = hashDay(`${day}:nickname`) % 100;
  if (r < 20) return 'Shalu';
  if (r < 30) return 'Meloni';
  return 'Saloni';
}

/** Time-of-day greeting + emoji (her local clock). */
export function greetingFor(hour: number): { text: string; emoji: string } {
  if (hour >= 5 && hour < 12) return { text: 'Good Morning', emoji: '🌅' };
  if (hour >= 12 && hour < 16) return { text: 'Good Afternoon', emoji: '🌞' };
  if (hour >= 16 && hour < 19) return { text: 'Good Evening', emoji: '🌇' };
  if (hour >= 19) return { text: 'Good Night', emoji: '🌃' };
  return { text: 'Still up? It\'s late', emoji: '🌙' }; // 12:00 am - 4:59 am
}

export const STUDY_LINES = {
  morning: [
    'Uth gayi? Chalo ab shuru karte hai ☕',
    'Fresh chai, fresh padhai, let\'s go 🌤️',
    'Subah ka time golden hai, padhai lock karo 🔒😊',
    'Breakfast ho gaya? Perfect, ab table pe 😄',
    'Din abhi shuru hua hai, aaj ka target bhi 🎯',
  ],
  afternoon: [
    'Dopahar ka mood, padhai ka boost ☀️',
    'Lunch done? Chalo, ab focus mode 😊',
    'Thakan aaye toh thodi chai, phir wapas table pe 🫖',
    'Afternoon slump? Chai + 20 min focused = full energy ⚡',
  ],
  evening: [
    'Library agayi? Ab karenge solid padhai 💪',
    'Sunset + notes = perfect combo 🌇',
    'Shaam ka batch shuru, full concentration on 💯',
    'Evening vibes, ek hi goal, aaj ka target pura ✅',
  ],
  night: [
    'Raat ka focus sabse alag hota hai 🌙 Chalo?',
    'Lights low, goals high, let\'s go ✨',
    'Aaj ki last session, strong end karte hai 🚀',
  ],
} as const;

/** Monday and Sunday get their own line, whatever the time. */
export const DAY_LINES = {
  monday: 'Naya hafte, nayi energy, Monday ko beat karte hai 💪',
  sunday: 'Aaj rest day hai, par thoda revision bhi toh kar lena 😌',
} as const;

function bandFor(hour: number): keyof typeof STUDY_LINES {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 16) return 'afternoon';
  if (hour >= 16 && hour < 19) return 'evening';
  return 'night';
}

/** The daily "let's study" line under the greeting. Stable per day. */
export function studyLineFor(day: string, hour: number): string {
  const weekday = new Date(`${day}T12:00:00`).getDay(); // 0 = Sunday
  if (weekday === 1) return DAY_LINES.monday;
  if (weekday === 0) return DAY_LINES.sunday;
  return pick(STUDY_LINES[bandFor(hour)], `${day}:study`);
}

/** Victory messages for the "day done" box. `{name}` = that day's nickname. */
export const DONE_MESSAGES = [
  'You killed it today! 🥳 Proud of you, my Topper 🙂‍↕️',
  'Aaj tune bhut padha hai 😎, you deserve a Thriller movie tonight 😁',
  'Day done, goals done. Chalo ab thoda self-care 🧘‍♀️✨',
  'Health-conscious topper: padhai done, ab walk ya chai? 🚶‍♀️',
  'Yay! Aaj ka target pakka kar diya 💪🎉',
  'Consistency > intensity, and you\'re consistent, {name} 📈😊',
  'Full marks for effort aaj! Topper behavior 💯',
  'Aaj ka din tere naam, well done health-conscious topper 🏅',
  'All lectures done! Ab ghar jao aur thodi rest karo 😌💤',
  'Solid day, solid topper. Kal phir milte hai, taazgi ke saath 🌅',
  'Aaj ki mehnat ka reward: guilt-free chai break ☕😄',
  'Done. Fully done. Completely done. You\'re a legend 🥇',
] as const;

/** The "today done" message for a day. Stable per day. */
export function doneMessageFor(day: string, name: string): string {
  return pick(DONE_MESSAGES, `${day}:done`).replace('{name}', name);
}

/** Streak milestone dialogue (5, 10, 15, ... days). One pick per streak value. */
export const MILESTONE_MESSAGES = [
  'Yay! You did {x} days of study 🎉 You\'ve unlocked a reward, for which contact Pratham 😉',
  '{x} din ki streak! 🏆 Reward unlocked, ab baat Pratham se karo 📞😄',
  '{x} days strong, Topper 💪🔥 A reward is waiting, contact: Pratham 😌',
  '{x} days of showing up! 🌟 You earned a reward, Pratham se sampark karo 😁',
] as const;

export function milestoneMessageFor(streak: number): string {
  return pick(MILESTONE_MESSAGES, `milestone:${streak}`).replace('{x}', String(streak));
}
